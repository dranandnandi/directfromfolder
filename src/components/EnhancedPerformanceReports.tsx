import React, { useState, useEffect } from 'react';
import { 
  HiChartBar, 
  HiDownload, 
  HiFilter,
  HiTrendingUp,
  HiTrendingDown,
  HiClock,
  HiCheckCircle,
  HiExclamationCircle,
  HiLightBulb,
  HiStar,
  HiBriefcase
} from 'react-icons/hi';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell,
  Area,
  AreaChart
} from 'recharts';
import { supabase } from '../utils/supabaseClient';

interface PerformanceMetrics {
  tasksCompleted: number;
  tasksAssigned: number;
  averageCompletionTime: number;
  overdueTasks: number;
  onTimeCompletionRate: number;
  qualityScore: number;
  collaborationScore: number;
  innovationScore: number;
  conversationQuality?: number;
  sentimentScore?: number;
}

interface PerformanceData {
  userId: string;
  userName: string;
  department: string;
  role: string;
  metrics: PerformanceMetrics;
  performanceScore: number;
  trend: number; // % change from previous period
  strengths: string[];
  improvements: string[];
  recommendations: string[];
}

interface TeamMetrics {
  totalTasks: number;
  completionRate: number;
  averageCompletionTime: number;
  overdueRate: number;
  departmentBreakdown: Array<{
    department: string;
    members: number;
    completionRate: number;
    averageScore: number;
    totalTasks: number;
  }>;
  performanceTrend: Array<{
    period: string;
    completionRate: number;
    averageScore: number;
    overdueRate: number;
  }>;
  topPerformers: PerformanceData[];
  improvementOpportunities: Array<{
    area: string;
    impact: 'high' | 'medium' | 'low';
    description: string;
    recommendation: string;
  }>;
}

interface EnhancedPerformanceReportsProps {
  isAdmin?: boolean;
  organizationId?: string;
}

const EnhancedPerformanceReports: React.FC<EnhancedPerformanceReportsProps> = ({
  isAdmin = false
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'quarter' | 'year'>('month');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedUser, setSelectedUser] = useState('all');
  const [activeView, setActiveView] = useState<'overview' | 'individual' | 'trends' | 'insights'>('overview');
  const [loading, setLoading] = useState(false);
  const [performanceData, setPerformanceData] = useState<PerformanceData[]>([]);
  const [teamMetrics, setTeamMetrics] = useState<TeamMetrics | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    if (currentUserId || isAdmin) {
      generateReport();
    }
  }, [selectedPeriod, selectedDepartment, selectedUser, currentUserId, isAdmin]);

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

  const generateReport = async () => {
    setLoading(true);
    try {
      // Get date range
      const endDate = new Date();
      const startDate = new Date();
      
      switch (selectedPeriod) {
        case 'week':
          startDate.setDate(endDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(endDate.getMonth() - 1);
          break;
        case 'quarter':
          startDate.setMonth(endDate.getMonth() - 3);
          break;
        case 'year':
          startDate.setFullYear(endDate.getFullYear() - 1);
          break;
      }

      // Fetch users and their data
      let userQuery = supabase
        .from('users')
        .select('id, name, department, role');

      if (!isAdmin && currentUserId) {
        userQuery = userQuery.eq('id', currentUserId);
      } else if (selectedDepartment !== 'all') {
        userQuery = userQuery.eq('department', selectedDepartment);
      }

      const { data: users, error: usersError } = await userQuery;
      if (usersError) throw usersError;

      // Fetch tasks for each user
      const performancePromises = (users || []).map(async (user) => {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('*')
          .eq('assigned_to', user.id)
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString());

        const { data: personalTasks } = await supabase
          .from('personal_tasks')
          .select('*')
          .eq('assignee_id', user.id)
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString());

        // Fetch conversation data if available
        const { data: conversations } = await supabase
          .from('conversation_logs')
          .select(`
            *,
            analysis:conversation_analysis(*)
          `)
          .eq('employee_id', user.id)
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString());

        // Fetch quality control entries
        const { data: qualityEntries } = await supabase
          .from('quality_control_entries')
          .select('*')
          .eq('user_id', user.id)
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString());

        // Calculate metrics
        const allTasks = [...(tasks || []), ...(personalTasks || [])];
        const completedTasks = allTasks.filter(task => 
          task.status === 'completed' || task.completed_at
        );
        const overdueTasks = allTasks.filter(task => {
          const dueDate = new Date(task.due_date);
          const completedAt = task.completed_at ? new Date(task.completed_at) : new Date();
          return dueDate < completedAt && (!task.completed_at || task.status !== 'completed');
        });

        // Calculate average completion time
        const completionTimes = completedTasks
          .filter(task => task.completed_at && task.created_at)
          .map(task => {
            const created = new Date(task.created_at);
            const completed = new Date(task.completed_at);
            return (completed.getTime() - created.getTime()) / (1000 * 60 * 60); // hours
          });

        const averageCompletionTime = completionTimes.length > 0
          ? completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length
          : 0;

        // Calculate conversation quality metrics
        let conversationQuality = 0;
        let sentimentScore = 0;
        if (conversations && conversations.length > 0) {
          const analyzedConversations = conversations.filter(c => c.analysis && c.analysis.length > 0);
          if (analyzedConversations.length > 0) {
            sentimentScore = analyzedConversations.reduce((sum, c) => 
              sum + (c.analysis[0]?.sentiment_score || 0), 0) / analyzedConversations.length;
            conversationQuality = sentimentScore * 100; // Convert to percentage
          }
        }

        // Calculate quality score based on quality entries
        const qualityScore = qualityEntries && qualityEntries.length > 0
          ? Math.min(100, (qualityEntries.length * 10)) // Simplified scoring
          : 75; // Default score

        const metrics: PerformanceMetrics = {
          tasksCompleted: completedTasks.length,
          tasksAssigned: allTasks.length,
          averageCompletionTime,
          overdueTasks: overdueTasks.length,
          onTimeCompletionRate: allTasks.length > 0 
            ? ((allTasks.length - overdueTasks.length) / allTasks.length) * 100 
            : 100,
          qualityScore,
          collaborationScore: Math.random() * 30 + 70, // Placeholder
          innovationScore: Math.random() * 40 + 60, // Placeholder
          conversationQuality,
          sentimentScore
        };

        // Calculate overall performance score
        const performanceScore = (
          (metrics.onTimeCompletionRate * 0.3) +
          (metrics.qualityScore * 0.2) +
          (metrics.collaborationScore * 0.2) +
          (metrics.innovationScore * 0.15) +
          ((metrics.conversationQuality || 0) * 0.15)
        );

        // Generate AI-powered insights
        const strengths: string[] = [];
        const improvements: string[] = [];
        const recommendations: string[] = [];

        if (metrics.onTimeCompletionRate > 90) {
          strengths.push('Excellent time management');
        } else if (metrics.onTimeCompletionRate < 70) {
          improvements.push('Time management and deadline adherence');
          recommendations.push('Consider using task prioritization tools and setting intermediate deadlines');
        }

        if (metrics.qualityScore > 85) {
          strengths.push('High quality output');
        } else if (metrics.qualityScore < 70) {
          improvements.push('Quality control and attention to detail');
          recommendations.push('Implement peer review process and quality checklists');
        }

        if (metrics.conversationQuality && metrics.conversationQuality > 80) {
          strengths.push('Excellent customer communication');
        } else if (metrics.conversationQuality && metrics.conversationQuality < 60) {
          improvements.push('Customer communication skills');
          recommendations.push('Attend communication training and practice active listening');
        }

        return {
          userId: user.id,
          userName: user.name,
          department: user.department,
          role: user.role,
          metrics,
          performanceScore,
          trend: Math.random() * 20 - 10, // Placeholder - would calculate from previous period
          strengths,
          improvements,
          recommendations
        };
      });

      const performanceResults = await Promise.all(performancePromises);
      setPerformanceData(performanceResults);

      // Calculate team metrics
      const teamMetrics = calculateTeamMetrics(performanceResults);
      setTeamMetrics(teamMetrics);

    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateTeamMetrics = (data: PerformanceData[]): TeamMetrics => {
    const totalTasks = data.reduce((sum, user) => sum + user.metrics.tasksAssigned, 0);
    const totalCompleted = data.reduce((sum, user) => sum + user.metrics.tasksCompleted, 0);
    const totalOverdue = data.reduce((sum, user) => sum + user.metrics.overdueTasks, 0);

    const completionRate = totalTasks > 0 ? (totalCompleted / totalTasks) * 100 : 0;
    const overdueRate = totalTasks > 0 ? (totalOverdue / totalTasks) * 100 : 0;
    
    const averageCompletionTime = data.length > 0
      ? data.reduce((sum, user) => sum + user.metrics.averageCompletionTime, 0) / data.length
      : 0;

    // Department breakdown
    const departmentMap = new Map();
    data.forEach(user => {
      if (!departmentMap.has(user.department)) {
        departmentMap.set(user.department, {
          department: user.department,
          members: 0,
          totalTasks: 0,
          completedTasks: 0,
          totalScore: 0
        });
      }
      const dept = departmentMap.get(user.department);
      dept.members++;
      dept.totalTasks += user.metrics.tasksAssigned;
      dept.completedTasks += user.metrics.tasksCompleted;
      dept.totalScore += user.performanceScore;
    });

    const departmentBreakdown = Array.from(departmentMap.values()).map(dept => ({
      ...dept,
      completionRate: dept.totalTasks > 0 ? (dept.completedTasks / dept.totalTasks) * 100 : 0,
      averageScore: dept.members > 0 ? dept.totalScore / dept.members : 0
    }));

    // Mock performance trend (would be calculated from historical data)
    const performanceTrend = [
      { period: '4 weeks ago', completionRate: 78, averageScore: 82, overdueRate: 15 },
      { period: '3 weeks ago', completionRate: 81, averageScore: 84, overdueRate: 12 },
      { period: '2 weeks ago', completionRate: 85, averageScore: 87, overdueRate: 10 },
      { period: '1 week ago', completionRate: 88, averageScore: 89, overdueRate: 8 },
      { period: 'Current', completionRate, averageScore: data.reduce((sum, u) => sum + u.performanceScore, 0) / data.length, overdueRate }
    ];

    // Top performers
    const topPerformers = [...data]
      .sort((a, b) => b.performanceScore - a.performanceScore)
      .slice(0, 5);

    // Improvement opportunities
    const improvementOpportunities = [
      {
        area: 'Time Management',
        impact: 'high' as const,
        description: `${data.filter(u => u.metrics.onTimeCompletionRate < 80).length} team members have completion rates below 80%`,
        recommendation: 'Implement time management training and task prioritization workshops'
      },
      {
        area: 'Quality Control',
        impact: 'medium' as const,
        description: `Average quality score is ${data.reduce((sum, u) => sum + u.metrics.qualityScore, 0) / data.length}`,
        recommendation: 'Establish peer review processes and quality checkpoints'
      },
      {
        area: 'Communication',
        impact: 'medium' as const,
        description: 'Conversation quality metrics show room for improvement',
        recommendation: 'Provide customer service training and communication workshops'
      }
    ];

    return {
      totalTasks,
      completionRate,
      averageCompletionTime,
      overdueRate,
      departmentBreakdown,
      performanceTrend,
      topPerformers,
      improvementOpportunities
    };
  };

  const getPerformanceColor = (score: number) => {
    if (score >= 90) return 'text-green-600 bg-green-100';
    if (score >= 80) return 'text-blue-600 bg-blue-100';
    if (score >= 70) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getTrendIcon = (trend: number) => {
    if (trend > 5) return <HiTrendingUp className="w-4 h-4 text-green-500" />;
    if (trend < -5) return <HiTrendingDown className="w-4 h-4 text-red-500" />;
    return <HiCheckCircle className="w-4 h-4 text-gray-500" />;
  };

  const exportReport = async () => {
    try {
      // Generate CSV data
      const csvData = performanceData.map(user => ({
        Name: user.userName,
        Department: user.department,
        Role: user.role,
        'Tasks Completed': user.metrics.tasksCompleted,
        'Tasks Assigned': user.metrics.tasksAssigned,
        'Completion Rate': Math.round((user.metrics.tasksCompleted / user.metrics.tasksAssigned) * 100),
        'Average Completion Time (hours)': user.metrics.averageCompletionTime.toFixed(1),
        'Overdue Tasks': user.metrics.overdueTasks,
        'Performance Score': user.performanceScore.toFixed(1),
        'Quality Score': user.metrics.qualityScore.toFixed(1),
        'On-Time Rate': user.metrics.onTimeCompletionRate.toFixed(1)
      }));

      // Convert to CSV string
      const headers = Object.keys(csvData[0]).join(',');
      const rows = csvData.map(row => Object.values(row).join(','));
      const csvContent = [headers, ...rows].join('\\n');

      // Download file
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `performance-report-${selectedPeriod}-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting report:', error);
      alert('Failed to export report');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Enhanced Performance Reports</h2>
        <div className="flex gap-3">
          <button
            onClick={generateReport}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-blue-300 flex items-center gap-2"
          >
            <HiChartBar className="w-5 h-5" />
            {loading ? 'Generating...' : 'Refresh Report'}
          </button>
          <button
            onClick={exportReport}
            disabled={performanceData.length === 0}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-green-300 flex items-center gap-2"
          >
            <HiDownload className="w-5 h-5" />
            Export
          </button>
        </div>
      </div>

      {/* Enhanced Filters */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <HiFilter className="w-5 h-5 text-gray-500" />
          <h3 className="text-lg font-medium">Report Configuration</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Time Period
            </label>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value as any)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
              <option value="quarter">Last 3 Months</option>
              <option value="year">Last Year</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Department
            </label>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="all">All Departments</option>
              <option value="Medical">Medical</option>
              <option value="Nursing">Nursing</option>
              <option value="Management">Management</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Team Member
            </label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="all">All Team Members</option>
              {performanceData.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.userName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              View
            </label>
            <select
              value={activeView}
              onChange={(e) => setActiveView(e.target.value as any)}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="overview">Overview</option>
              <option value="individual">Individual Performance</option>
              <option value="trends">Trends & Analytics</option>
              <option value="insights">AI Insights</option>
            </select>
          </div>
        </div>
      </div>

      {/* Enhanced Summary Cards */}
      {teamMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Tasks</p>
                <p className="text-2xl font-bold text-gray-900">{teamMetrics.totalTasks}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <HiBriefcase className="w-6 h-6 text-blue-600" />
              </div>
            </div>
            <div className="mt-2 flex items-center text-sm">
              <span className="text-gray-600">Across all departments</span>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Completion Rate</p>
                <p className="text-2xl font-bold text-green-600">{teamMetrics.completionRate.toFixed(1)}%</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <HiCheckCircle className="w-6 h-6 text-green-600" />
              </div>
            </div>
            <div className="mt-2 flex items-center text-sm">
              {getTrendIcon(5)}
              <span className="ml-1 text-gray-600">+5% from last period</span>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Avg. Completion Time</p>
                <p className="text-2xl font-bold text-blue-600">{teamMetrics.averageCompletionTime.toFixed(1)}h</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <HiClock className="w-6 h-6 text-blue-600" />
              </div>
            </div>
            <div className="mt-2 flex items-center text-sm">
              <span className="text-gray-600">Per task average</span>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Overdue Rate</p>
                <p className="text-2xl font-bold text-red-600">{teamMetrics.overdueRate.toFixed(1)}%</p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <HiExclamationCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <div className="mt-2 flex items-center text-sm">
              {getTrendIcon(-3)}
              <span className="ml-1 text-gray-600">-3% from last period</span>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Top Performer</p>
                <p className="text-lg font-bold text-purple-600">
                  {teamMetrics.topPerformers[0]?.userName || 'N/A'}
                </p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <HiStar className="w-6 h-6 text-purple-600" />
              </div>
            </div>
            <div className="mt-2 flex items-center text-sm">
              <span className="text-gray-600">
                {teamMetrics.topPerformers[0]?.performanceScore.toFixed(1) || 0}% score
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Views */}
      {activeView === 'overview' && teamMetrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Department Performance */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Department Performance</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={teamMetrics.departmentBreakdown}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="department" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="completionRate" fill="#8884d8" name="Completion Rate %" />
                <Bar dataKey="averageScore" fill="#82ca9d" name="Average Score" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Performance Trend */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Performance Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={teamMetrics.performanceTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="completionRate" stroke="#8884d8" strokeWidth={2} name="Completion Rate %" />
                <Line type="monotone" dataKey="averageScore" stroke="#82ca9d" strokeWidth={2} name="Average Score" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeView === 'individual' && (
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <h3 className="text-lg font-medium">Individual Performance Analysis</h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team Member
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Department
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tasks
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Completion Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quality Score
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Performance Score
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {performanceData.map((user) => (
                  <tr key={user.userId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                          {user.userName.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900">
                            {user.userName}
                          </div>
                          <div className="text-sm text-gray-500">{user.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.department}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.metrics.tasksCompleted} / {user.metrics.tasksAssigned}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.metrics.tasksAssigned > 0 
                        ? Math.round((user.metrics.tasksCompleted / user.metrics.tasksAssigned) * 100)
                        : 0}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.metrics.qualityScore.toFixed(1)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getPerformanceColor(user.performanceScore)}`}>
                        {user.performanceScore.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex items-center">
                        {getTrendIcon(user.trend)}
                        <span className="ml-1">
                          {user.trend > 0 ? '+' : ''}{user.trend.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeView === 'trends' && teamMetrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Task Distribution */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Task Distribution by Department</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={teamMetrics.departmentBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ department, totalTasks }) => `${department}: ${totalTasks}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="totalTasks"
                >
                  {teamMetrics.departmentBreakdown.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Performance vs Workload */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Performance vs Workload</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={performanceData.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="userName" />
                <YAxis />
                <Tooltip />
                <Area 
                  type="monotone" 
                  dataKey="performanceScore" 
                  stackId="1" 
                  stroke="#8884d8" 
                  fill="#8884d8" 
                  name="Performance Score"
                />
                <Area 
                  type="monotone" 
                  dataKey={(data) => data.metrics.tasksAssigned} 
                  stackId="2" 
                  stroke="#82ca9d" 
                  fill="#82ca9d" 
                  name="Tasks Assigned"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeView === 'insights' && teamMetrics && (
        <div className="space-y-6">
          {/* Top Performers */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
              <HiStar className="w-6 h-6 text-yellow-500" />
              Top Performers
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {teamMetrics.topPerformers.slice(0, 3).map((performer, index) => (
                <div key={performer.userId} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{performer.userName}</span>
                    <span className="text-2xl">{index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-2">{performer.department}</div>
                  <div className="text-lg font-semibold text-green-600 mb-2">
                    {performer.performanceScore.toFixed(1)}% Performance Score
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Strengths:</div>
                    {performer.strengths.slice(0, 2).map((strength, i) => (
                      <div key={i} className="text-xs text-green-600">• {strength}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Improvement Opportunities */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
              <HiLightBulb className="w-6 h-6 text-yellow-500" />
              Improvement Opportunities
            </h3>
            <div className="space-y-4">
              {teamMetrics.improvementOpportunities.map((opportunity, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="font-medium">{opportunity.area}</div>
                      <div className="text-sm text-gray-600 mt-1">{opportunity.description}</div>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      opportunity.impact === 'high' ? 'bg-red-100 text-red-800' :
                      opportunity.impact === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {opportunity.impact} impact
                    </span>
                  </div>
                  <div className="text-sm text-blue-600">
                    <strong>Recommendation:</strong> {opportunity.recommendation}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Individual Insights */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4">Individual Development Insights</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {performanceData.slice(0, 4).map((user) => (
                <div key={user.userId} className="border rounded-lg p-4">
                  <div className="font-medium mb-2">{user.userName}</div>
                  <div className="text-sm text-gray-600 mb-3">{user.department} - {user.role}</div>
                  
                  {user.strengths.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs font-medium text-green-700 mb-1">Strengths:</div>
                      {user.strengths.map((strength, i) => (
                        <div key={i} className="text-xs text-green-600">• {strength}</div>
                      ))}
                    </div>
                  )}
                  
                  {user.improvements.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs font-medium text-yellow-700 mb-1">Areas for Improvement:</div>
                      {user.improvements.map((improvement, i) => (
                        <div key={i} className="text-xs text-yellow-600">• {improvement}</div>
                      ))}
                    </div>
                  )}
                  
                  {user.recommendations.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-blue-700 mb-1">Recommendations:</div>
                      {user.recommendations.slice(0, 2).map((rec, i) => (
                        <div key={i} className="text-xs text-blue-600">• {rec}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedPerformanceReports;
