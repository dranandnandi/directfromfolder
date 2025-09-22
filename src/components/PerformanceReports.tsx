import React, { useState, useEffect } from 'react';
import { HiUser, HiCalendar, HiChartBar, HiDownload, HiFilter } from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PerformanceData {
  userId: string;
  userName: string;
  department: string;
  // Task metrics
  tasksCompleted: number;
  tasksAssigned: number;
  averageCompletionTime: number;
  overdueTasks: number;
  performanceScore: number;
  // Attendance metrics
  totalWorkingDays: number;
  daysPresent: number;
  attendanceRate: number;
  lateArrivals: number;
  earlyDepartures: number;
  // Leave metrics
  totalLeaveRequests: number;
  approvedLeaves: number;
  pendingLeaves: number;
  postFactoRequests: number;
  // Conversation metrics (if available)
  totalConversations: number;
  avgConversationQuality: number;
  avgSentimentScore: number;
  // Overall metrics
  overallHRScore: number;
  strengths: string[];
  improvements: string[];
}

const PerformanceReports: React.FC = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('month');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedUser, setSelectedUser] = useState('all');
  const [loading, setLoading] = useState(false);
  const [performanceData, setPerformanceData] = useState<PerformanceData[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [users, setUsers] = useState<{id: string, name: string}[]>([]);

  // Fetch departments and users for filters
  useEffect(() => {
    const fetchFiltersData = async () => {
      try {
        // Get current user's organization
        const { data: currentUser } = await supabase.auth.getUser();
        if (!currentUser.user?.id) return;

        const { data: currentUserData } = await supabase
          .from('users')
          .select('organization_id')
          .eq('auth_id', currentUser.user.id)
          .single();

        if (!currentUserData?.organization_id) return;

        // Get departments from organization
        const { data: orgsData } = await supabase
          .from('organizations')
          .select('departments')
          .eq('id', currentUserData.organization_id)
          .single();
        
        if (orgsData?.departments) {
          setDepartments(orgsData.departments);
        }

        // Get users from the same organization
        const { data: usersData } = await supabase
          .from('users')
          .select('id, name, department')
          .eq('organization_id', currentUserData.organization_id)
          .order('name');
        
        if (usersData) {
          setUsers(usersData);
        }
      } catch (error) {
        console.error('Error fetching filter data:', error);
      }
    };

    fetchFiltersData();
  }, []);

  // Fetch performance data using optimized database function
  const fetchPerformanceData = async () => {
    setLoading(true);
    try {
      // Get current user's organization
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) {
        throw new Error('User not authenticated');
      }

      const { data: currentUserData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (!currentUserData?.organization_id) {
        throw new Error('Organization not found');
      }

      console.log('PerformanceReports - Organization ID:', currentUserData.organization_id);

      // Calculate date range based on selected period
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
        default:
          startDate.setMonth(endDate.getMonth() - 1);
      }

      console.log('PerformanceReports - Date range:', { startDate, endDate });

      // Use the optimized database function to get all performance metrics in one call
      const { data: performanceMetrics, error } = await supabase.rpc('get_performance_metrics', {
        p_organization_id: currentUserData.organization_id,
        p_start_date: startDate.toISOString().split('T')[0], // YYYY-MM-DD format
        p_end_date: endDate.toISOString().split('T')[0],
        p_department: selectedDepartment !== 'all' ? selectedDepartment : null,
        p_user_id: selectedUser !== 'all' ? selectedUser : null
      });

      if (error) throw error;

      console.log('PerformanceReports - Raw metrics from DB:', performanceMetrics);

      // Transform the database results to match our interface
      const processedData: PerformanceData[] = (performanceMetrics || []).map((metric: any) => {
        // Calculate strengths and improvements based on the scores
        const strengths: string[] = [];
        const improvements: string[] = [];

        // Task Management - only if they have tasks assigned
        if (metric.task_performance_score >= 80 && metric.total_tasks_assigned > 0) {
          strengths.push('Task Management');
        } else if (metric.total_tasks_assigned > 0 && metric.task_performance_score < 70) {
          improvements.push('Task Completion');
        }

        // Attendance - only if they have working days
        if (metric.attendance_score >= 90 && metric.total_working_days > 0) {
          strengths.push('Attendance');
        } else if (metric.total_working_days > 0 && metric.attendance_score < 80) {
          improvements.push('Attendance');
        }

        // Punctuality - only if they actually attended some days
        if (metric.punctuality_score >= 80 && metric.days_present > 0) {
          strengths.push('Punctuality');
        } else if (metric.days_present > 0 && metric.punctuality_score < 70) {
          improvements.push('Punctuality');
        }

        // Communication - only if they have conversations
        if (metric.communication_score >= 70 && metric.total_conversations > 0) {
          strengths.push('Communication');
        } else if (metric.total_conversations > 0 && metric.communication_score < 60) {
          improvements.push('Communication Quality');
        }

        // Leave Planning - only if they have leave requests
        if (metric.post_facto_requests === 0 && metric.total_leave_requests > 0) {
          strengths.push('Leave Planning');
        } else if (metric.post_facto_requests > 0) {
          improvements.push('Leave Planning');
        }

        // If no specific strengths found but overall score is good, add general strength
        if (strengths.length === 0 && metric.overall_hr_score >= 70) {
          strengths.push('Overall Performance');
        }

        // If no specific improvements found but overall score is low, add general improvement
        if (improvements.length === 0 && metric.overall_hr_score < 60) {
          improvements.push('Overall Performance');
        }

        // Default message for employees with insufficient data
        if (strengths.length === 0 && improvements.length === 0) {
          if (metric.total_tasks_assigned === 0 && metric.days_present === 0) {
            strengths.push('Insufficient Data');
          }
        }

        return {
          userId: metric.user_id,
          userName: metric.user_name,
          department: metric.department,
          // Task metrics
          tasksCompleted: metric.total_tasks_completed,
          tasksAssigned: metric.total_tasks_assigned,
          averageCompletionTime: Math.round((metric.avg_completion_time_hours || 0) * 100) / 100,
          overdueTasks: metric.total_overdue_tasks,
          performanceScore: Math.round((metric.task_performance_score || 0) * 100) / 100,
          // Attendance metrics
          totalWorkingDays: metric.total_working_days,
          daysPresent: metric.days_present,
          attendanceRate: Math.round((metric.attendance_score || 0) * 100) / 100,
          lateArrivals: metric.late_arrivals,
          earlyDepartures: metric.early_departures,
          // Leave metrics
          totalLeaveRequests: metric.total_leave_requests,
          approvedLeaves: metric.approved_leaves,
          pendingLeaves: metric.pending_leaves,
          postFactoRequests: metric.post_facto_requests,
          // Conversation metrics
          totalConversations: metric.total_conversations,
          avgConversationQuality: Math.round((metric.avg_conversation_quality || 0) * 100) / 100,
          avgSentimentScore: Math.round((metric.avg_sentiment_score || 0) * 100) / 100,
          // Overall metrics
          overallHRScore: Math.round((metric.overall_hr_score || 0) * 100) / 100,
          strengths,
          improvements
        };
      });

      setPerformanceData(processedData);
      console.log('PerformanceReports - Performance data processed:', processedData.length, 'users with data');
      
    } catch (error) {
      console.error('Error fetching performance data:', error);
      setPerformanceData([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch data when filters change
  useEffect(() => {
    fetchPerformanceData();
  }, [selectedPeriod, selectedDepartment, selectedUser]);

  const handleGenerateReport = async () => {
    await fetchPerformanceData();
  };

  const handleExportReport = () => {
    if (performanceData.length === 0) {
      alert('No performance data available to export');
      return;
    }

    try {
      // Create new PDF document
      const doc = new jsPDF();
      
      // Add title
      doc.setFontSize(20);
      doc.setTextColor(40, 40, 40);
      doc.text('Performance Report', 14, 22);
      
      // Add report metadata
      doc.setFontSize(12);
      doc.setTextColor(80, 80, 80);
      const currentDate = new Date().toLocaleDateString();
      doc.text(`Generated on: ${currentDate}`, 14, 32);
      doc.text(`Period: ${selectedPeriod}`, 14, 42);
      doc.text(`Department: ${selectedDepartment === 'all' ? 'All Departments' : selectedDepartment}`, 14, 52);
      
      // Prepare table data
      const tableHeaders = [
        'Employee',
        'Department',
        'Tasks Completed',
        'Attendance Rate',
        'Punctuality',
        'Overall Score',
        'Key Strengths'
      ];
      
      const tableData = performanceData.map(employee => [
        employee.userName,
        employee.department || 'N/A',
        `${employee.tasksCompleted}/${employee.tasksAssigned}`,
        `${employee.attendanceRate}%`,
        `${employee.lateArrivals} late, ${employee.earlyDepartures} early`,
        `${employee.overallHRScore}%`,
        employee.strengths.slice(0, 2).join(', ') || 'None identified'
      ]);
      
      // Add table using autoTable
      autoTable(doc, {
        head: [tableHeaders],
        body: tableData,
        startY: 62,
        styles: {
          fontSize: 10,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [66, 139, 202],
          textColor: 255,
          fontStyle: 'bold',
        },
        alternateRowStyles: {
          fillColor: [248, 249, 250],
        },
        columnStyles: {
          0: { cellWidth: 30 }, // Employee name
          1: { cellWidth: 25 }, // Department
          2: { cellWidth: 25 }, // Tasks
          3: { cellWidth: 20 }, // Attendance
          4: { cellWidth: 30 }, // Punctuality
          5: { cellWidth: 20 }, // Overall Score
          6: { cellWidth: 40 }, // Strengths
        },
      });
      
      // Add summary statistics on new page if there's enough data
      if (performanceData.length > 0) {
        const finalY = (doc as any).lastAutoTable.finalY || 100;
        
        if (finalY > 220) {
          doc.addPage();
          doc.setFontSize(16);
          doc.setTextColor(40, 40, 40);
          doc.text('Performance Summary', 14, 22);
        } else {
          doc.setFontSize(16);
          doc.setTextColor(40, 40, 40);
          doc.text('Performance Summary', 14, finalY + 20);
        }
        
        // Calculate summary statistics
        const totalEmployees = performanceData.length;
        const avgOverallScore = Math.round(
          performanceData.reduce((sum, emp) => sum + emp.overallHRScore, 0) / totalEmployees
        );
        const avgAttendanceRate = Math.round(
          performanceData.reduce((sum, emp) => sum + emp.attendanceRate, 0) / totalEmployees
        );
        const totalTasksCompleted = performanceData.reduce((sum, emp) => sum + emp.tasksCompleted, 0);
        const totalTasksAssigned = performanceData.reduce((sum, emp) => sum + emp.tasksAssigned, 0);
        const completionRate = totalTasksAssigned > 0 ? Math.round((totalTasksCompleted / totalTasksAssigned) * 100) : 0;
        
        const summaryY = finalY > 220 ? 32 : finalY + 30;
        
        doc.setFontSize(12);
        doc.setTextColor(60, 60, 60);
        doc.text(`Total Employees: ${totalEmployees}`, 14, summaryY);
        doc.text(`Average Overall Score: ${avgOverallScore}%`, 14, summaryY + 10);
        doc.text(`Average Attendance Rate: ${avgAttendanceRate}%`, 14, summaryY + 20);
        doc.text(`Task Completion Rate: ${completionRate}% (${totalTasksCompleted}/${totalTasksAssigned})`, 14, summaryY + 30);
        
        // Top performers
        const topPerformers = [...performanceData]
          .sort((a, b) => b.overallHRScore - a.overallHRScore)
          .slice(0, 3);
        
        doc.setFontSize(14);
        doc.setTextColor(40, 40, 40);
        doc.text('Top Performers:', 14, summaryY + 50);
        
        doc.setFontSize(12);
        doc.setTextColor(60, 60, 60);
        topPerformers.forEach((performer, index) => {
          doc.text(
            `${index + 1}. ${performer.userName} - ${performer.overallHRScore}% (${performer.department})`,
            14,
            summaryY + 62 + (index * 10)
          );
        });
      }
      
      // Save the PDF
      const fileName = `performance-report-${selectedPeriod}-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      
      console.log('Performance report exported successfully');
      
    } catch (error) {
      console.error('Error generating PDF report:', error);
      alert('Error generating PDF report. Please try again.');
    }
  };

  const handleExportCSV = () => {
    if (performanceData.length === 0) {
      alert('No performance data available to export');
      return;
    }

    try {
      // Prepare CSV headers
      const headers = [
        'Employee Name',
        'Department',
        'Tasks Completed',
        'Tasks Assigned',
        'Completion Rate %',
        'Average Completion Time (hrs)',
        'Overdue Tasks',
        'Attendance Rate %',
        'Days Present',
        'Total Working Days',
        'Late Arrivals',
        'Early Departures',
        'Leave Requests',
        'Approved Leaves',
        'Pending Leaves',
        'Post-facto Requests',
        'Total Conversations',
        'Avg Conversation Quality',
        'Avg Sentiment Score',
        'Overall HR Score %',
        'Key Strengths',
        'Areas for Improvement'
      ];

      // Prepare CSV data
      const csvData = performanceData.map(employee => [
        employee.userName,
        employee.department || 'N/A',
        employee.tasksCompleted,
        employee.tasksAssigned,
        Math.round((employee.tasksCompleted / Math.max(employee.tasksAssigned, 1)) * 100),
        employee.averageCompletionTime,
        employee.overdueTasks,
        employee.attendanceRate,
        employee.daysPresent,
        employee.totalWorkingDays,
        employee.lateArrivals,
        employee.earlyDepartures,
        employee.totalLeaveRequests,
        employee.approvedLeaves,
        employee.pendingLeaves,
        employee.postFactoRequests,
        employee.totalConversations,
        employee.avgConversationQuality,
        employee.avgSentimentScore,
        employee.overallHRScore,
        employee.strengths.join('; '),
        employee.improvements.join('; ')
      ]);

      // Convert to CSV format
      const csvContent = [
        headers.join(','),
        ...csvData.map(row => 
          row.map(cell => 
            typeof cell === 'string' && cell.includes(',') 
              ? `"${cell}"` 
              : cell
          ).join(',')
        )
      ].join('\n');

      // Create and download CSV file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `performance-report-${selectedPeriod}-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      console.log('CSV report exported successfully');

    } catch (error) {
      console.error('Error generating CSV report:', error);
      alert('Error generating CSV report. Please try again.');
    }
  };

  const getPerformanceColor = (score: number) => {
    if (score >= 90) return 'text-green-600 bg-green-100';
    if (score >= 80) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Performance Reports</h2>
        <div className="flex gap-3">
          <button
            onClick={handleGenerateReport}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <HiChartBar className="w-4 h-4" />
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
          
          {/* Export Dropdown */}
          <div className="relative group">
            <button className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
              <HiDownload className="w-4 h-4" />
              Export
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {/* Dropdown Menu */}
            <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
              <div className="py-1">
                <button
                  onClick={handleExportReport}
                  className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  disabled={performanceData.length === 0}
                >
                  <HiDownload className="w-4 h-4 mr-3 text-red-500" />
                  Export as PDF
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  disabled={performanceData.length === 0}
                >
                  <HiDownload className="w-4 h-4 mr-3 text-green-500" />
                  Export as CSV
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex items-center gap-2 mb-4">
          <HiFilter className="w-5 h-5 text-gray-600" />
          <h3 className="text-lg font-medium">Filters</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <HiCalendar className="w-4 h-4 inline mr-1" />
              Time Period
            </label>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="week">Last Week</option>
              <option value="month">Last Month</option>
              <option value="quarter">Last Quarter</option>
              <option value="year">Last Year</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Department
            </label>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Departments</option>
              {departments.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <HiUser className="w-4 h-4 inline mr-1" />
              User
            </label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Users</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Performance Data Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium">Comprehensive Performance Metrics</h3>
          <p className="text-sm text-gray-600">
            Showing performance data for {performanceData.length} users including tasks, attendance, leaves, and overall HR metrics
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Employee
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Task Performance
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Attendance
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Leave Behavior
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Communication
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Overall HR Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Strengths & Areas for Improvement
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    Loading performance data...
                  </td>
                </tr>
              ) : performanceData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    No performance data found for the selected criteria
                  </td>
                </tr>
              ) : (
                performanceData.map((user) => (
                  <tr key={user.userId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-blue-600">
                            {user.userName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900">
                            {user.userName}
                          </div>
                          <div className="text-sm text-gray-500">
                            {user.department}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-gray-900">
                          {user.tasksCompleted}/{user.tasksAssigned} tasks
                        </div>
                        <div className="text-xs text-gray-500">
                          {user.overdueTasks} overdue
                        </div>
                        <div className="text-xs text-gray-500">
                          Score: {user.performanceScore}%
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-gray-900">
                          {user.daysPresent}/{user.totalWorkingDays} days
                        </div>
                        <div className="text-xs text-gray-500">
                          Rate: {user.attendanceRate}%
                        </div>
                        <div className="text-xs text-gray-500">
                          {user.lateArrivals} late, {user.earlyDepartures} early
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-gray-900">
                          {user.totalLeaveRequests} requests
                        </div>
                        <div className="text-xs text-gray-500">
                          {user.approvedLeaves} approved, {user.pendingLeaves} pending
                        </div>
                        {user.postFactoRequests > 0 && (
                          <div className="text-xs text-red-600">
                            {user.postFactoRequests} post facto
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-gray-900">
                          {user.totalConversations} conversations
                        </div>
                        {user.totalConversations > 0 ? (
                          <>
                            <div className="text-xs text-gray-500">
                              Quality: {user.avgConversationQuality}/5
                            </div>
                            <div className="text-xs text-gray-500">
                              Sentiment: {user.avgSentimentScore}%
                            </div>
                          </>
                        ) : (
                          <div className="text-xs text-gray-500">No data</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPerformanceColor(user.overallHRScore)}`}>
                        {user.overallHRScore}%
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        {user.strengths.length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-green-600">Strengths:</div>
                            <div className="text-xs text-green-600">
                              {user.strengths.join(', ')}
                            </div>
                          </div>
                        )}
                        {user.improvements.length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-yellow-600">Improve:</div>
                            <div className="text-xs text-yellow-600">
                              {user.improvements.join(', ')}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Cards */}
      {performanceData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <HiUser className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Total Employees</p>
                <p className="text-2xl font-semibold text-gray-900">{performanceData.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <HiChartBar className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Avg Overall Score</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {Math.round(performanceData.reduce((sum, user) => sum + user.overallHRScore, 0) / performanceData.length)}%
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <HiCalendar className="h-8 w-8 text-yellow-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Avg Attendance</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {Math.round(performanceData.reduce((sum, user) => sum + user.attendanceRate, 0) / performanceData.length)}%
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <HiChartBar className="h-8 w-8 text-purple-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Tasks Completed</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {performanceData.reduce((sum, user) => sum + user.tasksCompleted, 0)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <HiCalendar className="h-8 w-8 text-indigo-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Leave Requests</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {performanceData.reduce((sum, user) => sum + user.totalLeaveRequests, 0)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <HiChartBar className="h-8 w-8 text-red-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Total Overdue</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {performanceData.reduce((sum, user) => sum + user.overdueTasks, 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PerformanceReports;