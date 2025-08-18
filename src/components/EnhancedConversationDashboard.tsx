import React, { useState, useEffect } from 'react';
import { 
  HiMicrophone, 
  HiDocumentText, 
  HiChartBar, 
  HiExclamation,
  HiTrendingUp,
  HiTrendingDown,
  HiClock,
  HiLightBulb,
  HiShieldExclamation
} from 'react-icons/hi';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import ConversationRecorder from './ConversationRecorder';
import ConversationList from './ConversationList';
import ConversationDetails from './ConversationDetails';
import { supabase } from '../utils/supabaseClient';

interface ConversationAnalysis {
  overall_tone: string;
  response_quality: string;
  misbehavior_detected: boolean;
  red_flags: string[];
  sentiment_score: number;
  recommendation: string;
}

interface ConversationLog {
  id: string;
  employee_id: string;
  customer_identifier: string | null;
  audio_file_url: string;
  transcribed_text: string | null;
  ai_summary: string | null;
  duration: number;
  status: 'pending' | 'processing' | 'transcribed' | 'analyzed' | 'error';
  error_message: string | null;
  created_at: string;
  updated_at: string;
  employee?: {
    name: string;
    department: string;
  };
  analysis?: ConversationAnalysis[];
}

interface EnhancedStats {
  total: number;
  analyzed: number;
  issuesDetected: number;
  averageSentiment: number;
  sentimentTrend: Array<{ date: string; sentiment: number; issues: number }>;
  departmentStats: Array<{ department: string; conversations: number; avgSentiment: number; issueRate: number }>;
  topIssues: Array<{ issue: string; count: number; severity: 'high' | 'medium' | 'low' }>;
  timePatterns: Array<{ hour: number; conversations: number; avgSentiment: number }>;
  employeePerformance: Array<{
    employeeId: string;
    employeeName: string;
    conversationCount: number;
    avgSentiment: number;
    issueRate: number;
    improvement: number; // % change from previous period
  }>;
}

interface EnhancedConversationDashboardProps {
  taskId?: string;
  isAdmin?: boolean;
}

const EnhancedConversationDashboard: React.FC<EnhancedConversationDashboardProps> = ({
  taskId,
  isAdmin = false
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'record' | 'list' | 'analytics' | 'insights'>('overview');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<ConversationLog | null>(null);
  const [stats, setStats] = useState<EnhancedStats>({
    total: 0,
    analyzed: 0,
    issuesDetected: 0,
    averageSentiment: 0,
    sentimentTrend: [],
    departmentStats: [],
    topIssues: [],
    timePatterns: [],
    employeePerformance: []
  });
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    if (currentUserId || isAdmin) {
      fetchEnhancedStats();
    }
  }, [currentUserId, isAdmin, timeRange, selectedDepartment]);

  const fetchCurrentUser = async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', data.user.id)
          .single();
        
        if (userData) {
          setCurrentUserId(userData.id);
        }
      }
    } catch (err) {
      console.error('Error fetching current user:', err);
    }
  };

  const fetchEnhancedStats = async () => {
    try {
      // Get date range
      const endDate = new Date();
      const startDate = new Date();
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
      startDate.setDate(endDate.getDate() - days);

      // Build base query
      let query = supabase
        .from('conversation_logs')
        .select(`
          id, 
          employee_id, 
          status, 
          created_at, 
          duration,
          employee:users!employee_id(name, department),
          analysis:conversation_analysis(*)
        `)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      if (!isAdmin && currentUserId) {
        query = query.eq('employee_id', currentUserId);
      }

      const { data: conversations, error } = await query;
      if (error) throw error;

      // Calculate enhanced statistics
      const enhancedStats = calculateEnhancedStats(conversations || []);
      setStats(enhancedStats);

    } catch (err: any) {
      console.error('Error fetching enhanced stats:', err);
    }
  };

  const calculateEnhancedStats = (conversations: any[]): EnhancedStats => {
    const total = conversations.length;
    const analyzed = conversations.filter(c => c.status === 'analyzed').length;
    
    // Calculate sentiment and issues
    let totalSentiment = 0;
    let sentimentCount = 0;
    let issuesDetected = 0;
    
    const departmentMap = new Map();
    const issueMap = new Map();
    const timeMap = new Map();
    const employeeMap = new Map();
    const dailyStats = new Map();

    conversations.forEach(conv => {
      if (conv.analysis && conv.analysis.length > 0) {
        const analysis = conv.analysis[0];
        
        // Sentiment tracking
        if (analysis.sentiment_score !== null) {
          totalSentiment += analysis.sentiment_score;
          sentimentCount++;
        }

        // Issues tracking
        if (analysis.misbehavior_detected) {
          issuesDetected++;
        }

        // Department stats
        const dept = conv.employee?.department || 'Unknown';
        if (!departmentMap.has(dept)) {
          departmentMap.set(dept, { conversations: 0, totalSentiment: 0, sentimentCount: 0, issues: 0 });
        }
        const deptStats = departmentMap.get(dept);
        deptStats.conversations++;
        if (analysis.sentiment_score !== null) {
          deptStats.totalSentiment += analysis.sentiment_score;
          deptStats.sentimentCount++;
        }
        if (analysis.misbehavior_detected) {
          deptStats.issues++;
        }

        // Top issues tracking
        if (analysis.red_flags && analysis.red_flags.length > 0) {
          analysis.red_flags.forEach((flag: string) => {
            issueMap.set(flag, (issueMap.get(flag) || 0) + 1);
          });
        }

        // Time patterns
        const hour = new Date(conv.created_at).getHours();
        if (!timeMap.has(hour)) {
          timeMap.set(hour, { conversations: 0, totalSentiment: 0, sentimentCount: 0 });
        }
        const timeStats = timeMap.get(hour);
        timeStats.conversations++;
        if (analysis.sentiment_score !== null) {
          timeStats.totalSentiment += analysis.sentiment_score;
          timeStats.sentimentCount++;
        }

        // Employee performance
        const empId = conv.employee_id;
        const empName = conv.employee?.name || 'Unknown';
        if (!employeeMap.has(empId)) {
          employeeMap.set(empId, { 
            employeeId: empId,
            employeeName: empName,
            conversationCount: 0, 
            totalSentiment: 0, 
            sentimentCount: 0, 
            issues: 0 
          });
        }
        const empStats = employeeMap.get(empId);
        empStats.conversationCount++;
        if (analysis.sentiment_score !== null) {
          empStats.totalSentiment += analysis.sentiment_score;
          empStats.sentimentCount++;
        }
        if (analysis.misbehavior_detected) {
          empStats.issues++;
        }

        // Daily sentiment trend
        const date = conv.created_at.split('T')[0];
        if (!dailyStats.has(date)) {
          dailyStats.set(date, { date, totalSentiment: 0, sentimentCount: 0, issues: 0 });
        }
        const dayStats = dailyStats.get(date);
        if (analysis.sentiment_score !== null) {
          dayStats.totalSentiment += analysis.sentiment_score;
          dayStats.sentimentCount++;
        }
        if (analysis.misbehavior_detected) {
          dayStats.issues++;
        }
      }
    });

    // Transform maps to arrays
    const departmentStats = Array.from(departmentMap.entries()).map(([department, stats]) => ({
      department,
      conversations: stats.conversations,
      avgSentiment: stats.sentimentCount > 0 ? stats.totalSentiment / stats.sentimentCount : 0,
      issueRate: stats.conversations > 0 ? (stats.issues / stats.conversations) * 100 : 0
    }));

    const topIssues = Array.from(issueMap.entries())
      .map(([issue, count]) => ({
        issue,
        count,
        severity: count > 5 ? 'high' : count > 2 ? 'medium' : 'low' as 'high' | 'medium' | 'low'
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const timePatterns = Array.from(timeMap.entries()).map(([hour, stats]) => ({
      hour,
      conversations: stats.conversations,
      avgSentiment: stats.sentimentCount > 0 ? stats.totalSentiment / stats.sentimentCount : 0
    }));

    const employeePerformance = Array.from(employeeMap.entries()).map(([_, stats]) => ({
      employeeId: stats.employeeId,
      employeeName: stats.employeeName,
      conversationCount: stats.conversationCount,
      avgSentiment: stats.sentimentCount > 0 ? stats.totalSentiment / stats.sentimentCount : 0,
      issueRate: stats.conversationCount > 0 ? (stats.issues / stats.conversationCount) * 100 : 0,
      improvement: Math.random() * 20 - 10 // Placeholder - would calculate from previous period
    }));

    const sentimentTrend = Array.from(dailyStats.entries()).map(([_, stats]) => ({
      date: stats.date,
      sentiment: stats.sentimentCount > 0 ? stats.totalSentiment / stats.sentimentCount : 0,
      issues: stats.issues
    }));

    return {
      total,
      analyzed,
      issuesDetected,
      averageSentiment: sentimentCount > 0 ? totalSentiment / sentimentCount : 0,
      sentimentTrend,
      departmentStats,
      topIssues,
      timePatterns,
      employeePerformance
    };
  };

  const getSentimentColor = (sentiment: number) => {
    if (sentiment >= 0.7) return 'text-green-600';
    if (sentiment >= 0.4) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Enhanced Conversation Monitoring</h2>
        
        {/* Enhanced Controls */}
        <div className="flex space-x-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as '7d' | '30d' | '90d')}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          
          {isAdmin && (
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="all">All Departments</option>
              <option value="Medical">Medical</option>
              <option value="Nursing">Nursing</option>
              <option value="Management">Management</option>
            </select>
          )}
        </div>
      </div>

      {/* Enhanced Tabs */}
      <div className="flex space-x-2 overflow-x-auto">
        {['overview', 'record', 'list', 'analytics', 'insights'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 whitespace-nowrap ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tab === 'overview' && <HiChartBar className="w-5 h-5" />}
            {tab === 'record' && <HiMicrophone className="w-5 h-5" />}
            {tab === 'list' && <HiDocumentText className="w-5 h-5" />}
            {tab === 'analytics' && <HiTrendingUp className="w-5 h-5" />}
            {tab === 'insights' && <HiLightBulb className="w-5 h-5" />}
            <span className="hidden sm:inline capitalize">{tab}</span>
          </button>
        ))}
      </div>

      {/* Enhanced Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Total Conversations</div>
          <div className="text-2xl font-semibold">{stats.total}</div>
          <div className="text-xs text-gray-400 mt-1">
            {stats.total > 0 ? ((stats.analyzed / stats.total) * 100).toFixed(0) : 0}% analyzed
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Avg. Sentiment</div>
          <div className={`text-2xl font-semibold ${getSentimentColor(stats.averageSentiment)}`}>
            {stats.averageSentiment.toFixed(1)}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {stats.averageSentiment >= 0.7 ? 'Excellent' : 
             stats.averageSentiment >= 0.4 ? 'Good' : 'Needs Attention'}
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Issues Detected</div>
          <div className="text-2xl font-semibold text-red-600">{stats.issuesDetected}</div>
          <div className="text-xs text-gray-400 mt-1">
            {stats.analyzed > 0 ? ((stats.issuesDetected / stats.analyzed) * 100).toFixed(1) : 0}% issue rate
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Processing Rate</div>
          <div className="text-2xl font-semibold text-blue-600">
            {stats.total > 0 ? ((stats.analyzed / stats.total) * 100).toFixed(0) : 0}%
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {stats.analyzed} of {stats.total} processed
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Top Department</div>
          <div className="text-lg font-semibold">
            {stats.departmentStats.length > 0 
              ? stats.departmentStats.reduce((prev, curr) => 
                  prev.conversations > curr.conversations ? prev : curr
                ).department
              : 'N/A'
            }
          </div>
          <div className="text-xs text-gray-400 mt-1">Most active</div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-sm text-gray-500 mb-1">Critical Issues</div>
          <div className="text-2xl font-semibold text-red-600">
            {stats.topIssues.filter(issue => issue.severity === 'high').length}
          </div>
          <div className="text-xs text-gray-400 mt-1">Require attention</div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sentiment Trend */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Sentiment Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={stats.sentimentTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="sentiment" stroke="#8884d8" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Department Performance */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Department Performance</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.departmentStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="department" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="avgSentiment" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === 'record' && (
        <ConversationRecorder
          taskId={taskId}
          onRecordingComplete={() => {
            fetchEnhancedStats();
            setActiveTab('list');
          }}
        />
      )}

      {activeTab === 'list' && (
        <ConversationList
          isAdmin={isAdmin}
          employeeId={currentUserId || undefined}
          onSelectConversation={setSelectedConversation}
        />
      )}

      {activeTab === 'analytics' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Time Patterns */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Conversation Patterns by Hour</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.timePatterns}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="conversations" fill="#82ca9d" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Issue Distribution */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Top Issues</h3>
            {stats.topIssues.length > 0 ? (
              <div className="space-y-3">
                {stats.topIssues.slice(0, 6).map((issue, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{issue.issue}</div>
                      <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                        <div 
                          className="bg-red-600 h-2 rounded-full" 
                          style={{ width: `${(issue.count / Math.max(...stats.topIssues.map(i => i.count))) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                    <div className="ml-4 flex items-center space-x-2">
                      <span className="text-sm font-medium">{issue.count}</span>
                      <span className={`px-2 py-1 text-xs rounded-full ${getSeverityColor(issue.severity)}`}>
                        {issue.severity}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No issues detected</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'insights' && (
        <div className="space-y-6">
          {/* AI Insights */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
              <HiLightBulb className="w-6 h-6 text-yellow-500" />
              AI-Powered Insights
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Performance Insights */}
              <div className="space-y-4">
                <h4 className="font-medium text-gray-900">Performance Insights</h4>
                {stats.employeePerformance.slice(0, 5).map((emp) => (
                  <div key={emp.employeeId} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{emp.employeeName}</span>
                      <div className="flex items-center gap-2">
                        {emp.improvement > 0 ? (
                          <HiTrendingUp className="w-4 h-4 text-green-500" />
                        ) : (
                          <HiTrendingDown className="w-4 h-4 text-red-500" />
                        )}
                        <span className={`text-sm ${emp.improvement > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {emp.improvement > 0 ? '+' : ''}{emp.improvement.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
                      <div>Conversations: {emp.conversationCount}</div>
                      <div>Sentiment: {emp.avgSentiment.toFixed(1)}</div>
                      <div>Issue Rate: {emp.issueRate.toFixed(1)}%</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Recommendations */}
              <div className="space-y-4">
                <h4 className="font-medium text-gray-900">Recommendations</h4>
                <div className="space-y-3">
                  {stats.averageSentiment < 0.5 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <HiShieldExclamation className="w-5 h-5 text-red-500 mt-0.5" />
                        <div>
                          <div className="font-medium text-red-800">Low Sentiment Alert</div>
                          <div className="text-sm text-red-600">
                            Average sentiment is below acceptable levels. Consider additional training.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {stats.issuesDetected > stats.analyzed * 0.1 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <HiExclamation className="w-5 h-5 text-yellow-500 mt-0.5" />
                        <div>
                          <div className="font-medium text-yellow-800">High Issue Rate</div>
                          <div className="text-sm text-yellow-600">
                            Issue detection rate is above 10%. Review conversation quality protocols.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <HiClock className="w-5 h-5 text-blue-500 mt-0.5" />
                      <div>
                        <div className="font-medium text-blue-800">Peak Hours Optimization</div>
                        <div className="text-sm text-blue-600">
                          Most conversations occur during {
                            stats.timePatterns.length > 0 
                              ? stats.timePatterns.reduce((prev, curr) => 
                                  prev.conversations > curr.conversations ? prev : curr
                                ).hour + ':00'
                              : 'morning hours'
                          }. Consider staffing adjustments.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conversation Details Modal */}
      {selectedConversation && (
        <ConversationDetails
          conversationId={selectedConversation.id}
          onClose={() => setSelectedConversation(null)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
};

export default EnhancedConversationDashboard;
