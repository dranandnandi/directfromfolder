import { supabase } from './supabaseClient';

/**
 * Enhanced conversation analysis interface
 */
export interface EnhancedConversationAnalysis {
  overall_tone: string;
  response_quality: string;
  misbehavior_detected: boolean;
  red_flags: string[];
  sentiment_score: number;
  recommendation: string;
  communication_effectiveness: number;
  empathy_level: number;
  problem_resolution: 'resolved' | 'partially_resolved' | 'unresolved' | 'escalated';
  customer_satisfaction_indicator: number;
  key_issues: string[];
  positive_aspects: string[];
  improvement_areas: string[];
  urgency_level: 'low' | 'medium' | 'high' | 'critical';
  follow_up_required: boolean;
  compliance_score: number;
}

/**
 * Uploads a conversation recording and creates a conversation log entry
 */
export const uploadConversationRecording = async (
  audioBlob: Blob,
  employeeId: string,
  customerIdentifier?: string,
  taskId?: string
): Promise<{ data: any; error: any }> => {
  try {
    // Generate a unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${employeeId}_${timestamp}.webm`;
    
    // Upload to Supabase Storage
    const { error } = await supabase
      .storage
      .from('conversation-recordings')
      .upload(filename, audioBlob, {
        cacheControl: '3600',
        upsert: false,
        contentType: audioBlob.type
      });
    
    if (error) throw error;
    
    // Get the public URL
    const { data: urlData } = supabase
      .storage
      .from('conversation-recordings')
      .getPublicUrl(filename);
    
    // Calculate duration (rough estimate based on file size and bit rate)
    const estimatedDuration = Math.floor(audioBlob.size / 16000); // Assuming 128kbps
    
    // Create a record in the conversation_logs table
    const { data: logData, error: logError } = await supabase
      .from('conversation_logs')
      .insert([
        {
          employee_id: employeeId,
          customer_identifier: customerIdentifier || null,
          audio_file_url: urlData.publicUrl,
          duration: estimatedDuration,
          status: 'pending',
          task_id: taskId || null
        }
      ])
      .select()
      .single();
    
    if (logError) throw logError;
    
    // Automatically trigger processing
    await triggerConversationProcessing(logData.id);
    
    return { data: logData, error: null };
    
  } catch (error) {
    console.error('Error uploading conversation:', error);
    return { data: null, error };
  }
};

/**
 * Triggers conversation processing via edge function
 */
export const triggerConversationProcessing = async (conversationId: string) => {
  try {
    const { data, error } = await supabase.functions.invoke('process-conversation', {
      body: { conversationId }
    });
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error triggering conversation processing:', error);
    return { data: null, error };
  }
};

/**
 * Fetches conversation logs with enhanced filtering and pagination
 */
export const fetchConversationLogs = async (options: {
  employeeId?: string;
  status?: string;
  timeframe?: string;
  misbehavior?: string;
  urgencyLevel?: string;
  problemResolution?: string;
  limit?: number;
  offset?: number;
  isAdmin?: boolean;
}) => {
  try {
    let query = supabase
      .from('conversation_logs')
      .select(`
        id,
        employee_id,
        customer_identifier,
        audio_file_url,
        transcribed_text,
        ai_summary,
        duration,
        status,
        error_message,
        created_at,
        updated_at,
        task_id,
        employee:users!employee_id(name, department, role),
        analysis:conversation_analysis(
          overall_tone,
          response_quality,
          misbehavior_detected,
          red_flags,
          sentiment_score,
          recommendation,
          communication_effectiveness,
          empathy_level,
          problem_resolution,
          customer_satisfaction_indicator,
          key_issues,
          positive_aspects,
          improvement_areas,
          urgency_level,
          follow_up_required,
          compliance_score,
          created_at
        )
      `)
      .order('created_at', { ascending: false });

    // Apply filters
    if (!options.isAdmin && options.employeeId) {
      query = query.eq('employee_id', options.employeeId);
    }

    if (options.status) {
      query = query.eq('status', options.status);
    }

    if (options.timeframe) {
      const now = new Date();
      let startDate = new Date();
      
      switch (options.timeframe) {
        case '24h':
          startDate.setDate(now.getDate() - 1);
          break;
        case '7d':
          startDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(now.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(now.getDate() - 90);
          break;
      }
      
      query = query.gte('created_at', startDate.toISOString());
    }

    // Apply pagination
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data, error } = await query;
    
    if (error) throw error;

    // Post-process to filter by analysis fields
    let filteredData = data || [];
    
    if (options.misbehavior === 'true') {
      filteredData = filteredData.filter(conv => 
        conv.analysis && conv.analysis.length > 0 && 
        conv.analysis[0].misbehavior_detected
      );
    } else if (options.misbehavior === 'false') {
      filteredData = filteredData.filter(conv => 
        !conv.analysis || conv.analysis.length === 0 || 
        !conv.analysis[0].misbehavior_detected
      );
    }

    if (options.urgencyLevel) {
      filteredData = filteredData.filter(conv => 
        conv.analysis && conv.analysis.length > 0 && 
        conv.analysis[0].urgency_level === options.urgencyLevel
      );
    }

    if (options.problemResolution) {
      filteredData = filteredData.filter(conv => 
        conv.analysis && conv.analysis.length > 0 && 
        conv.analysis[0].problem_resolution === options.problemResolution
      );
    }

    return { data: filteredData, error: null };
    
  } catch (error) {
    console.error('Error fetching conversation logs:', error);
    return { data: null, error };
  }
};

/**
 * Fetches enhanced conversation statistics using the new conversation_insights view
 */
export const fetchEnhancedConversationStats = async (options: {
  employeeId?: string;
  timeframe?: string;
  department?: string;
  isAdmin?: boolean;
}) => {
  try {
    // Build date filter
    const now = new Date();
    let startDate = new Date();
    
    switch (options.timeframe) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 30);
    }

    // Use the new conversation_insights view for enhanced analytics
    let query = supabase
      .from('conversation_insights')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', now.toISOString());

    // Apply filters
    if (!options.isAdmin && options.employeeId) {
      query = query.eq('employee_id', options.employeeId);
    }

    if (options.department && options.department !== 'all') {
      query = query.eq('department', options.department);
    }

    const { data: conversations, error } = await query;
    
    if (error) throw error;

    // Calculate comprehensive statistics using enhanced schema fields
    const stats = {
      total: conversations?.length || 0,
      analyzed: conversations?.filter(c => c.sentiment_score !== null).length || 0,
      issuesDetected: conversations?.filter(c => c.misbehavior_detected).length || 0,
      averageSentiment: 0,
      averageCommunication: 0,
      averageEmpathy: 0,
      averageCompliance: 0,
      sentimentTrend: [] as Array<{ date: string; sentiment: number; issues: number }>,
      departmentStats: [] as Array<{ 
        department: string; 
        conversations: number; 
        avgSentiment: number; 
        issueRate: number;
        avgCommunication: number;
        avgCompliance: number;
      }>,
      topIssues: [] as Array<{ issue: string; count: number; severity: 'high' | 'medium' | 'low' }>,
      employeePerformance: [] as Array<{
        employeeId: string;
        employeeName: string;
        conversationCount: number;
        avgSentiment: number;
        avgCommunication: number;
        avgEmpathy: number;
        avgCompliance: number;
        issueRate: number;
      }>
    };

    if (conversations && conversations.length > 0) {
      const analyzedConversations = conversations.filter(c => c.sentiment_score !== null);
      
      if (analyzedConversations.length > 0) {
        stats.averageSentiment = analyzedConversations.reduce((sum, c) => 
          sum + (c.sentiment_score || 0), 0) / analyzedConversations.length;
        
        const withCommunication = analyzedConversations.filter(c => 
          c.communication_effectiveness !== null
        );
        if (withCommunication.length > 0) {
          stats.averageCommunication = withCommunication.reduce((sum, c) => 
            sum + (c.communication_effectiveness || 0), 0) / withCommunication.length;
        }

        const withEmpathy = analyzedConversations.filter(c => 
          c.empathy_level !== null
        );
        if (withEmpathy.length > 0) {
          stats.averageEmpathy = withEmpathy.reduce((sum, c) => 
            sum + (c.empathy_level || 0), 0) / withEmpathy.length;
        }

        const withCompliance = analyzedConversations.filter(c => 
          c.compliance_score !== null
        );
        if (withCompliance.length > 0) {
          stats.averageCompliance = withCompliance.reduce((sum, c) => 
            sum + (c.compliance_score || 0), 0) / withCompliance.length;
        }
      }

      // Calculate department stats using enhanced view
      const departmentMap = new Map();
      conversations.forEach(c => {
        const dept = c.department || 'Unknown';
        if (!departmentMap.has(dept)) {
          departmentMap.set(dept, {
            department: dept,
            conversations: 0,
            totalSentiment: 0,
            sentimentCount: 0,
            totalCommunication: 0,
            communicationCount: 0,
            totalCompliance: 0,
            complianceCount: 0,
            issues: 0
          });
        }
        const deptStats = departmentMap.get(dept);
        deptStats.conversations++;
        
        if (c.sentiment_score !== null) {
          deptStats.totalSentiment += c.sentiment_score;
          deptStats.sentimentCount++;
        }
        if (c.communication_effectiveness !== null) {
          deptStats.totalCommunication += c.communication_effectiveness;
          deptStats.communicationCount++;
        }
        if (c.compliance_score !== null) {
          deptStats.totalCompliance += c.compliance_score;
          deptStats.complianceCount++;
        }
        if (c.misbehavior_detected) {
          deptStats.issues++;
        }
      });

      stats.departmentStats = Array.from(departmentMap.values()).map(dept => ({
        department: dept.department,
        conversations: dept.conversations,
        avgSentiment: dept.sentimentCount > 0 ? dept.totalSentiment / dept.sentimentCount : 0,
        avgCommunication: dept.communicationCount > 0 ? dept.totalCommunication / dept.communicationCount : 0,
        avgCompliance: dept.complianceCount > 0 ? dept.totalCompliance / dept.complianceCount : 0,
        issueRate: dept.conversations > 0 ? (dept.issues / dept.conversations) * 100 : 0
      }));

      // Calculate employee performance using enhanced view
      const employeeMap = new Map();
      conversations.forEach(c => {
        const empId = c.employee_id;
        const empName = c.employee_name || 'Unknown';
        if (!employeeMap.has(empId)) {
          employeeMap.set(empId, {
            employeeId: empId,
            employeeName: empName,
            conversationCount: 0,
            totalSentiment: 0,
            sentimentCount: 0,
            totalCommunication: 0,
            communicationCount: 0,
            totalEmpathy: 0,
            empathyCount: 0,
            totalCompliance: 0,
            complianceCount: 0,
            issues: 0
          });
        }
        const empStats = employeeMap.get(empId);
        empStats.conversationCount++;
        
        if (c.sentiment_score !== null) {
          empStats.totalSentiment += c.sentiment_score;
          empStats.sentimentCount++;
        }
        if (c.communication_effectiveness !== null) {
          empStats.totalCommunication += c.communication_effectiveness;
          empStats.communicationCount++;
        }
        if (c.empathy_level !== null) {
          empStats.totalEmpathy += c.empathy_level;
          empStats.empathyCount++;
        }
        if (c.compliance_score !== null) {
          empStats.totalCompliance += c.compliance_score;
          empStats.complianceCount++;
        }
        if (c.misbehavior_detected) {
          empStats.issues++;
        }
      });

      stats.employeePerformance = Array.from(employeeMap.values()).map(emp => ({
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        conversationCount: emp.conversationCount,
        avgSentiment: emp.sentimentCount > 0 ? emp.totalSentiment / emp.sentimentCount : 0,
        avgCommunication: emp.communicationCount > 0 ? emp.totalCommunication / emp.communicationCount : 0,
        avgEmpathy: emp.empathyCount > 0 ? emp.totalEmpathy / emp.empathyCount : 0,
        avgCompliance: emp.complianceCount > 0 ? emp.totalCompliance / emp.complianceCount : 0,
        issueRate: emp.conversationCount > 0 ? (emp.issues / emp.conversationCount) * 100 : 0
      }));

      // Calculate sentiment trend (daily) using enhanced view
      const dailyMap = new Map();
      conversations.forEach(c => {
        const date = c.created_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { date, totalSentiment: 0, sentimentCount: 0, issues: 0 });
        }
        const dayStats = dailyMap.get(date);
        if (c.sentiment_score !== null) {
          dayStats.totalSentiment += c.sentiment_score;
          dayStats.sentimentCount++;
        }
        if (c.misbehavior_detected) {
          dayStats.issues++;
        }
      });

      stats.sentimentTrend = Array.from(dailyMap.values())
        .map(day => ({
          date: day.date,
          sentiment: day.sentimentCount > 0 ? day.totalSentiment / day.sentimentCount : 0,
          issues: day.issues
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Calculate top issues from red_flags using enhanced view
      const issueMap = new Map();
      conversations.forEach(c => {
        if (c.red_flags && Array.isArray(c.red_flags)) {
          c.red_flags.forEach((flag: string) => {
            issueMap.set(flag, (issueMap.get(flag) || 0) + 1);
          });
        }
      });

      stats.topIssues = Array.from(issueMap.entries())
        .map(([issue, count]) => ({
          issue,
          count,
          severity: count > 5 ? 'high' : count > 2 ? 'medium' : 'low' as 'high' | 'medium' | 'low'
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }

    return { data: stats, error: null };
    
  } catch (error) {
    console.error('Error fetching enhanced conversation stats:', error);
    return { data: null, error };
  }
};

/**
 * Updates conversation analysis with supervisor notes
 */
export const updateConversationAnalysis = async (
  conversationId: string,
  updates: {
    supervisorNotes?: string;
    followUpRequired?: boolean;
    urgencyLevel?: string;
  }
) => {
  try {
    const { data, error } = await supabase
      .from('conversation_analysis')
      .update(updates)
      .eq('conversation_log_id', conversationId)
      .select()
      .single();
    
    if (error) throw error;
    return { data, error: null };
    
  } catch (error) {
    console.error('Error updating conversation analysis:', error);
    return { data: null, error };
  }
};

/**
 * Generate comprehensive performance report using database function
 */
export const generatePerformanceReport = async (
  userId: string,
  periodStart: string,
  periodEnd: string,
  reportType: string = 'monthly'
) => {
  try {
    const { data, error } = await supabase.rpc('generate_performance_report', {
      p_user_id: userId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_report_type: reportType
    });
    
    if (error) throw error;
    return { data, error: null };
    
  } catch (error) {
    console.error('Error generating performance report:', error);
    return { data: null, error };
  }
};

/**
 * Calculate performance score using database function
 */
export const calculatePerformanceScore = async (
  completionRate: number,
  avgSentiment: number,
  avgCommunication: number,
  avgCompliance: number,
  overdueRate: number
) => {
  try {
    const { data, error } = await supabase.rpc('calculate_performance_score', {
      p_completion_rate: completionRate,
      p_avg_sentiment: avgSentiment,
      p_avg_communication: avgCommunication,
      p_avg_compliance: avgCompliance,
      p_overdue_rate: overdueRate
    });
    
    if (error) throw error;
    return { data, error: null };
    
  } catch (error) {
    console.error('Error calculating performance score:', error);
    return { data: null, error };
  }
};

/**
 * Fetch performance analytics using the enhanced view
 */
export const fetchPerformanceAnalytics = async (options: {
  userId?: string;
  department?: string;
  isAdmin?: boolean;
}) => {
  try {
    let query = supabase
      .from('performance_analytics')
      .select('*');

    if (!options.isAdmin && options.userId) {
      query = query.eq('user_id', options.userId);
    }

    if (options.department && options.department !== 'all') {
      query = query.eq('department', options.department);
    }

    const { data, error } = await query;
    
    if (error) throw error;
    return { data, error: null };
    
  } catch (error) {
    console.error('Error fetching performance analytics:', error);
    return { data: null, error };
  }
};

/**
 * Fetch conversation insights with enhanced categorization
 */
export const fetchConversationInsights = async (options: {
  employeeId?: string;
  department?: string;
  sentimentCategory?: string;
  complianceStatus?: string;
  urgencyLevel?: string;
  timeframe?: string;
  limit?: number;
  offset?: number;
}) => {
  try {
    let query = supabase
      .from('conversation_insights')
      .select('*')
      .order('created_at', { ascending: false });

    // Apply filters
    if (options.employeeId) {
      query = query.eq('employee_id', options.employeeId);
    }

    if (options.department) {
      query = query.eq('department', options.department);
    }

    if (options.sentimentCategory) {
      query = query.eq('sentiment_category', options.sentimentCategory);
    }

    if (options.complianceStatus) {
      query = query.eq('compliance_status', options.complianceStatus);
    }

    if (options.urgencyLevel) {
      query = query.eq('urgency_level', options.urgencyLevel);
    }

    if (options.timeframe) {
      const now = new Date();
      let startDate = new Date();
      
      switch (options.timeframe) {
        case '24h':
          startDate.setDate(now.getDate() - 1);
          break;
        case '7d':
          startDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(now.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(now.getDate() - 90);
          break;
      }
      
      query = query.gte('created_at', startDate.toISOString());
    }

    // Apply pagination
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data, error } = await query;
    
    if (error) throw error;
    return { data, error: null };
    
  } catch (error) {
    console.error('Error fetching conversation insights:', error);
    return { data: null, error };
  }
};
