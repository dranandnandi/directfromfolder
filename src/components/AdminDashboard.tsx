import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  HiUsers,
  HiMicrophone,
  HiCalendar,
  HiChartBar,
  HiExclamationCircle,
  HiCheckCircle,
  HiXCircle,
  HiDownload,
  HiFilter,
  HiSearch,
  HiChatAlt2,
  HiPhone,
  HiEye,
  HiX,
  HiFolder
} from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import WhatsAppAdminPanel from './WhatsAppAdminPanel';
import { sendWhatsAppMessage } from '../utils/whatsappUtils';
import AttendanceDashboard from './hr/AttendanceDashboard';
import ShiftManagement from './hr/ShiftManagement';
import EmployeeShiftManagement from './hr/EmployeeShiftManagement';
import DocumentManagement from './hr/DocumentManagement';

// Helper function to generate smart WhatsApp links (mobile vs desktop)
const generateWhatsAppLink = (phoneNumber: string, message: string) => {
  const encodedMessage = encodeURIComponent(message);
  const formattedNumber = phoneNumber.replace(/^\+91/, '').replace(/\D/g, '');

  // Detect if user is on mobile device
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const baseURL = isMobile
    ? "https://api.whatsapp.com/send"
    : "https://web.whatsapp.com/send";

  return `${baseURL}?phone=91${formattedNumber}&text=${encodedMessage}`;
};

interface EmployeeMetrics {
  id: string;
  name: string;
  department: string;
  role: string;
  email: string;
  organization_id: string;
  organization_name: string;
  total_tasks: number;
  completed_tasks: number;
  completion_rate: number;
  overdue_tasks: number;
  overdue_rate: number;
  total_conversations: number;
  avg_conversation_length: number;
  avg_sentiment: number;
  avg_communication: number;
  avg_compliance: number;
  overall_score: number;
  leave_requests: number;
  approved_leaves: number;
  pending_leaves: number;
  post_facto_requests: number;
  last_active_at: string;
}

interface LeaveRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  department: string;
  organization_name: string;
  leave_type: 'full_day' | 'half_day' | 'early_departure';
  start_date: string;
  end_date?: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  is_post_facto: boolean;
  requested_at: string;
  approved_by?: string;
  approved_at?: string;
  comments?: string;
}

interface Organization {
  id: string;
  name: string;
  address: string;
}

interface AdminDashboardProps {
  // No longer optional - admin must be tied to an organization
  adminUserId: string;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminUserId
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'shifts' | 'employees' | 'conversations' | 'leaves' | 'whatsapp' | 'documents' | 'ai'>('dashboard');
  const [adminUserDbId, setAdminUserDbId] = useState<string | null>(null);
  const [adminUserName, setAdminUserName] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeMetrics[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [adminOrganizationId, setAdminOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'7d' | '30d' | '90d'>('30d');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [leaveFilter, setLeaveFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [viewingReasonId, setViewingReasonId] = useState<string | null>(null);

  useEffect(() => {
    initializeAdminDashboard();
  }, [adminUserId]);

  useEffect(() => {
    if (adminOrganizationId) {
      fetchDashboardData();
    }
  }, [selectedTimeframe, selectedDepartment, adminOrganizationId]);

  const initializeAdminDashboard = async () => {
    try {
      // Get current authenticated user - same approach as Reports component
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) {
        throw new Error('User not authenticated');
      }

      // First, get the admin's organization ID
      const { data: adminData, error: adminError } = await supabase
        .from('users')
        .select('organization_id, role')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (adminError) {
        console.error('Admin user lookup error:', adminError);
        throw adminError;
      }

      console.log('Admin data found:', adminData);

      // Verify user is actually an admin
      if (!adminData.role || !['admin', 'superadmin'].includes(adminData.role)) {
        throw new Error('User is not authorized to access admin dashboard');
      }

      if (!adminData.organization_id) {
        throw new Error('Admin user is not assigned to an organization');
      }

      console.log('Setting admin organization ID:', adminData.organization_id);
      setAdminOrganizationId(adminData.organization_id);

      // Get user's database ID for document uploads
      const { data: userData } = await supabase
        .from('users')
        .select('id, name')
        .eq('auth_id', currentUser.user.id)
        .single();
      
      if (userData) {
        setAdminUserDbId(userData.id);
        setAdminUserName(userData.name);
      }

      // Get organization information
      const { data: organizationData, error: organizationError } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('id', adminData.organization_id)
        .single();

      if (organizationError) throw organizationError;
      setOrganization({
        id: organizationData.id,
        name: organizationData.name,
        address: 'Organization Address'
      });

    } catch (error) {
      console.error('Error initializing admin dashboard:', error);
      // Handle unauthorized access
    }
  };

  const fetchDashboardData = async () => {
    if (!adminOrganizationId) return;

    setLoading(true);
    try {
      await Promise.all([
        fetchEmployeeMetrics(),
        fetchLeaveRequests()
      ]);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployeeMetrics = async () => {
    if (!adminOrganizationId) return;

    try {
      // Get date range
      const endDate = new Date();
      const startDate = new Date();
      const days = selectedTimeframe === '7d' ? 7 : selectedTimeframe === '30d' ? 30 : 90;
      startDate.setDate(endDate.getDate() - days);

      // Fetch employees ONLY from admin's organization
      let query = supabase
        .from('users')
        .select(`
          id,
          name,
          email,
          department,
          role,
          organization_id,
          last_active_at
        `)
        .eq('organization_id', adminOrganizationId) // ENFORCED ORGANIZATION FILTERING
        .eq('role', 'user'); // Changed from 'employee' to 'user'

      if (selectedDepartment !== 'all') {
        query = query.eq('department', selectedDepartment);
      }

      const { data: employeeData, error: employeeError } = await query;
      if (employeeError) throw employeeError;

      // Fetch task metrics for each employee
      const employeeMetrics = await Promise.all(
        (employeeData || []).map(async (employee) => {
          // Task metrics - only for this organization's employees
          const { data: taskData } = await supabase
            .from('tasks')
            .select('id, status, due_date, completed_at, created_at')
            .eq('assigned_to', employee.id)
            .gte('created_at', startDate.toISOString());

          const totalTasks = taskData?.length || 0;
          const completedTasks = taskData?.filter(t => t.status === 'completed').length || 0;
          const overdueTasks = taskData?.filter(t =>
            t.due_date < new Date().toISOString() && t.status !== 'completed'
          ).length || 0;

          // Conversation metrics - only for this organization's employees
          const { data: conversationData } = await supabase
            .from('conversation_logs')
            .select(`
              id, 
              duration, 
              created_at,
              conversation_analysis(
                sentiment_score,
                communication_effectiveness,
                compliance_score
              )
            `)
            .eq('employee_id', employee.id)
            .gte('created_at', startDate.toISOString());

          const totalConversations = conversationData?.length || 0;
          const avgLength = conversationData && conversationData.length > 0
            ? conversationData.reduce((sum, c) => sum + (c.duration || 0), 0) / conversationData.length
            : 0;

          const conversationsWithAnalysis = conversationData?.filter(c =>
            c.conversation_analysis && c.conversation_analysis.length > 0
          ) || [];

          const avgSentiment = conversationsWithAnalysis.length > 0
            ? conversationsWithAnalysis.reduce((sum, c) =>
              sum + (c.conversation_analysis[0]?.sentiment_score || 0), 0
            ) / conversationsWithAnalysis.length
            : 0;

          const avgCommunication = conversationsWithAnalysis.length > 0
            ? conversationsWithAnalysis.reduce((sum, c) =>
              sum + (c.conversation_analysis[0]?.communication_effectiveness || 0), 0
            ) / conversationsWithAnalysis.length
            : 0;

          const avgCompliance = conversationsWithAnalysis.length > 0
            ? conversationsWithAnalysis.reduce((sum, c) =>
              sum + (c.conversation_analysis[0]?.compliance_score || 0), 0
            ) / conversationsWithAnalysis.length
            : 0;

          // Leave metrics - only for this organization's employees
          const { data: leaveData } = await supabase
            .from('tasks')
            .select('id, status, type, created_at')
            .eq('assigned_to', employee.id)
            .eq('type', 'personalTask')
            .ilike('title', '%Leave Request%') // Filter by title to identify leave requests
            .gte('created_at', startDate.toISOString());

          const leaveRequests = leaveData?.length || 0;
          const approvedLeaves = leaveData?.filter(l => l.status === 'completed').length || 0;
          const pendingLeaves = leaveData?.filter(l => l.status === 'pending').length || 0;

          // Post facto requests (created after the requested date)
          const { data: postFactoData } = await supabase
            .from('tasks')
            .select('id, created_at, due_date')
            .eq('assigned_to', employee.id)
            .eq('type', 'personalTask')
            .ilike('title', '%Leave Request%') // Filter by title to identify leave requests
            .gte('created_at', startDate.toISOString());

          const postFactoRequests = postFactoData?.filter(t =>
            new Date(t.created_at) > new Date(t.due_date)
          ).length || 0;

          // Calculate overall score
          const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
          const overdueRate = totalTasks > 0 ? (overdueTasks / totalTasks) * 100 : 0;
          const overallScore = (
            (completionRate * 0.3) +
            (avgSentiment * 100 * 0.25) +
            (avgCommunication * 100 * 0.25) +
            (avgCompliance * 100 * 0.2)
          );

          return {
            id: employee.id,
            name: employee.name,
            department: employee.department,
            role: employee.role,
            email: employee.email,
            organization_id: employee.organization_id,
            organization_name: organization?.name || 'Unknown',
            total_tasks: totalTasks,
            completed_tasks: completedTasks,
            completion_rate: completionRate,
            overdue_tasks: overdueTasks,
            overdue_rate: overdueRate,
            total_conversations: totalConversations,
            avg_conversation_length: avgLength,
            avg_sentiment: avgSentiment,
            avg_communication: avgCommunication,
            avg_compliance: avgCompliance,
            overall_score: overallScore,
            leave_requests: leaveRequests,
            approved_leaves: approvedLeaves,
            pending_leaves: pendingLeaves,
            post_facto_requests: postFactoRequests,
            last_active_at: employee.last_active_at
          } as EmployeeMetrics;
        })
      );

      setEmployees(employeeMetrics);
    } catch (error) {
      console.error('Error fetching employee metrics:', error);
    }
  };

  const fetchLeaveRequests = async () => {
    if (!adminOrganizationId) return;

    try {
      // Fetch leave requests only for employees in admin's organization
      const { data: leaveData, error } = await supabase
        .from('tasks')
        .select(`
          id,
          assigned_to,
          title,
          description,
          status,
          type,
          due_date,
          created_at,
          completed_at,
          users!assigned_to(name, department, organization_id)
        `)
        .eq('type', 'personalTask')
        .ilike('title', '%Leave Request%') // Filter by title to identify leave requests
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Filter to only include employees from admin's organization
      const filteredLeaveData = (leaveData || []).filter(leave => {
        const user = Array.isArray(leave.users) ? leave.users[0] : leave.users;
        return user && user.organization_id === adminOrganizationId;
      });

      const formattedLeaves: LeaveRequest[] = filteredLeaveData.map(leave => {
        const isPostFacto = new Date(leave.created_at) > new Date(leave.due_date);
        const user = Array.isArray(leave.users) ? leave.users[0] : leave.users;

        return {
          id: leave.id,
          employee_id: leave.assigned_to,
          employee_name: user?.name || 'Unknown',
          department: user?.department || 'Unknown',
          organization_name: organization?.name || 'Unknown',
          leave_type: leave.title?.includes('HALF DAY') ? 'half_day' :
            leave.title?.includes('EARLY DEPARTURE') ? 'early_departure' : 'full_day',
          start_date: leave.due_date,
          reason: leave.description || '',
          status: leave.status === 'completed' ? 'approved' :
            leave.status === 'cancelled' ? 'rejected' : 'pending',
          is_post_facto: isPostFacto,
          requested_at: leave.created_at,
          approved_at: leave.completed_at,
          comments: leave.title
        };
      });

      setLeaveRequests(formattedLeaves);
    } catch (error) {
      console.error('Error fetching leave requests:', error);
    }
  };

  const handleLeaveApproval = async (leaveId: string, action: 'approve' | 'reject', comments?: string) => {
    try {
      const status = action === 'approve' ? 'completed' : 'cancelled';
      const { error } = await supabase
        .from('tasks')
        .update({
          status,
          completed_at: action === 'approve' ? new Date().toISOString() : null,
          title: comments || (action === 'approve' ? 'Approved' : 'Rejected')
        })
        .eq('id', leaveId);

      if (error) throw error;

      // Refresh leave requests
      await fetchLeaveRequests();
    } catch (error) {
      console.error('Error updating leave request:', error);
    }
  };

  const handleOpenWhatsAppLinkForLeave = async (leave: LeaveRequest) => {
    try {
      // Get employee phone number
      const { data: employeeData, error: employeeError } = await supabase
        .from('users')
        .select('whatsapp_number, name')
        .eq('id', leave.employee_id)
        .single();

      if (employeeError || !employeeData) {
        alert('Could not find employee information');
        return;
      }

      if (!employeeData.whatsapp_number) {
        alert('Employee does not have a WhatsApp number on file');
        return;
      }

      // Get approver name (current user)
      const { data: { user } } = await supabase.auth.getUser();
      const { data: approverData } = await supabase
        .from('users')
        .select('name')
        .eq('auth_id', user?.id)
        .single();

      const approverName = approverData?.name || 'Admin';

      // Calculate leave duration
      const startDate = new Date(leave.start_date).toLocaleDateString();
      const endDate = leave.end_date ? new Date(leave.end_date).toLocaleDateString() : null;
      const duration = endDate ? `${startDate} to ${endDate}` : startDate;

      // Create approval message
      const message = `✅ Leave Request ${leave.status === 'approved' ? 'Approved' : 'Update'}

Dear ${employeeData.name},

Your leave request has been ${leave.status === 'approved' ? 'approved' : 'reviewed'} by ${approverName}.

Details:
📅 Period: ${duration}
📝 Type: ${leave.leave_type.replace('_', ' ').toUpperCase()}
💬 Reason: ${leave.reason}
✅ Status: ${leave.status.toUpperCase()}

Thank you for keeping us informed.`;

      // Generate and open WhatsApp link
      const whatsappUrl = generateWhatsAppLink(employeeData.whatsapp_number, message);
      window.open(whatsappUrl, '_blank');
    } catch (error) {
      console.error('Error opening WhatsApp:', error);
      alert('Failed to open WhatsApp');
    }
  };

  const [sendingWhatsAppForLeave, setSendingWhatsAppForLeave] = useState<string | null>(null);

  const handleSendWhatsAppToEmployeeForLeave = async (leave: LeaveRequest) => {
    try {
      setSendingWhatsAppForLeave(leave.id);

      // Get employee phone number
      const { data: employeeData, error: employeeError } = await supabase
        .from('users')
        .select('whatsapp_number, name')
        .eq('id', leave.employee_id)
        .single();

      if (employeeError || !employeeData) {
        alert('Could not find employee information');
        return;
      }

      if (!employeeData.whatsapp_number) {
        alert('Employee does not have a WhatsApp number on file');
        return;
      }

      // Get approver name (current user)
      const { data: { user } } = await supabase.auth.getUser();
      const { data: approverData } = await supabase
        .from('users')
        .select('name')
        .eq('auth_id', user?.id)
        .single();

      const approverName = approverData?.name || 'Admin';

      // Calculate leave duration
      const startDate = new Date(leave.start_date).toLocaleDateString();
      const endDate = leave.end_date ? new Date(leave.end_date).toLocaleDateString() : null;
      const duration = endDate ? `${startDate} to ${endDate}` : startDate;

      // Create approval message
      const message = `✅ Leave Request Approved\n\nDear ${employeeData.name},\n\nYour leave request has been approved by ${approverName}.\n\nDetails:\n📅 Period: ${duration}\n📝 Type: ${leave.leave_type.replace('_', ' ').toUpperCase()}\n💬 Reason: ${leave.reason}\n\nStatus: APPROVED\n\nThank you for keeping us informed.`;

      // Send WhatsApp via backend
      const result = await sendWhatsAppMessage({
        phoneNumber: employeeData.whatsapp_number,
        message,
        taskId: leave.id
      });

      if (result.success) {
        alert('WhatsApp notification sent to employee successfully!');
      } else {
        alert(`Failed to send WhatsApp: ${result.error}`);
      }
    } catch (error) {
      console.error('Error sending WhatsApp:', error);
      alert('Failed to send WhatsApp notification');
    } finally {
      setSendingWhatsAppForLeave(null);
    }
  };

  const exportReport = (type: 'employee' | 'leave') => {
    let data;
    let filename;

    if (type === 'employee') {
      data = employees.map(emp => ({
        Name: emp.name,
        Department: emp.department,
        Organization: emp.organization_name,
        'Total Tasks': emp.total_tasks,
        'Completion Rate': `${emp.completion_rate.toFixed(1)}%`,
        'Conversations': emp.total_conversations,
        'Avg Sentiment': emp.avg_sentiment.toFixed(2),
        'Overall Score': emp.overall_score.toFixed(1),
        'Leave Requests': emp.leave_requests,
        'Post Facto': emp.post_facto_requests
      }));
      filename = `employee_performance_${organization?.name || 'organization'}_${selectedTimeframe}.csv`;
    } else {
      data = leaveRequests.map(leave => ({
        Employee: leave.employee_name,
        Department: leave.department,
        Organization: leave.organization_name,
        'Leave Type': leave.leave_type,
        'Start Date': leave.start_date,
        Reason: leave.reason,
        Status: leave.status,
        'Post Facto': leave.is_post_facto ? 'Yes' : 'No',
        'Requested At': new Date(leave.requested_at).toLocaleDateString()
      }));
      filename = `leave_requests_${organization?.name || 'organization'}_${new Date().toISOString().split('T')[0]}.csv`;
    }

    const csv = [
      Object.keys(data[0]).join(','),
      ...data.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const filteredLeaves = leaveRequests.filter(leave => {
    if (leaveFilter !== 'all' && leave.status !== leaveFilter) return false;
    return leave.employee_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      leave.department.toLowerCase().includes(searchTerm.toLowerCase());
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!adminOrganizationId || !organization) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <HiExclamationCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Access Denied</h3>
          <p className="text-gray-600">You are not authorized to access this admin dashboard or organization information is missing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Admin Dashboard - {organization.name}
        </h1>
        <p className="text-gray-600">Comprehensive organization management and analytics for your organization</p>
      </div>

      {/* Navigation Tabs */}
      <div className="mb-6">
        <nav className="flex space-x-8">
          {[
            { id: 'dashboard', label: 'HR Attendance System', icon: HiChartBar },
            { id: 'shifts', label: 'Shift Management', icon: HiCalendar },
            { id: 'employees', label: 'Employee Assignment', icon: HiUsers },
            { id: 'conversations', label: 'Conversations', icon: HiMicrophone },
            { id: 'leaves', label: 'Leave Management', icon: HiCalendar },
            { id: 'documents', label: 'Documents', icon: HiFolder },
            { id: 'ai', label: 'AI Attendance', icon: HiExclamationCircle },
            { id: 'whatsapp', label: 'WhatsApp Alerts', icon: HiExclamationCircle }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${activeTab === tab.id
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <tab.icon className="w-4 h-4 mr-2" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Filters */}
      <div className="mb-6 bg-white p-4 rounded-lg shadow-sm">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <HiFilter className="w-4 h-4 text-gray-400" />
            <select
              value={selectedTimeframe}
              onChange={(e) => setSelectedTimeframe(e.target.value as any)}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </div>

          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1 text-sm"
          >
            <option value="all">All Departments</option>
            <option value="Reception">Reception</option>
            <option value="Laboratory">Laboratory</option>
            <option value="Radiology">Radiology</option>
            <option value="Pathology">Pathology</option>
            <option value="Administration">Administration</option>
          </select>

          <div className="flex items-center gap-2">
            <HiSearch className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search employees, departments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm w-64"
            />
          </div>

          {activeTab === 'leaves' && (
            <select
              value={leaveFilter}
              onChange={(e) => setLeaveFilter(e.target.value as any)}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm"
            >
              <option value="all">All Leave Requests</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          )}
        </div>
      </div>

      {/* Content based on active tab */}
      {activeTab === 'dashboard' && (
        <AttendanceDashboard />
      )}

      {activeTab === 'shifts' && (
        <ShiftManagement />
      )}

      {activeTab === 'employees' && (
        <EmployeeShiftManagement />
      )}

      {activeTab === 'leaves' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900">Leave Management - {organization.name}</h2>
            <button
              onClick={() => exportReport('leave')}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              <HiDownload className="w-4 h-4 mr-2" />
              Export Report
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Employee
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Leave Details
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Reason
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredLeaves.map((leave) => (
                    <tr key={leave.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{leave.employee_name}</div>
                          <div className="text-sm text-gray-500">{leave.department}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {leave.leave_type.replace('_', ' ').toUpperCase()}
                        </div>
                        <div className="text-sm text-gray-500">
                          {new Date(leave.start_date).toLocaleDateString()}
                          {leave.end_date && ` - ${new Date(leave.end_date).toLocaleDateString()}`}
                        </div>
                        {leave.is_post_facto && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Post Facto
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-gray-900 max-w-xs truncate">
                            {leave.reason}
                          </div>
                          {leave.reason && leave.reason.length > 50 && (
                            <button
                              onClick={() => setViewingReasonId(leave.id)}
                              className="text-blue-600 hover:text-blue-900 flex-shrink-0"
                              title="View full reason"
                            >
                              <HiEye className="w-5 h-5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${leave.status === 'approved' ? 'bg-green-100 text-green-800' :
                            leave.status === 'rejected' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                          }`}>
                          {leave.status.charAt(0).toUpperCase() + leave.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {leave.status === 'pending' ? (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleLeaveApproval(leave.id, 'approve')}
                              className="text-green-600 hover:text-green-900"
                              title="Approve"
                            >
                              <HiCheckCircle className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleLeaveApproval(leave.id, 'reject')}
                              className="text-red-600 hover:text-red-900"
                              title="Reject"
                            >
                              <HiXCircle className="w-5 h-5" />
                            </button>
                          </div>
                        ) : leave.status === 'approved' ? (
                          <div className="flex space-x-2">
                            {/* Direct WhatsApp Link - Opens WhatsApp app/web */}
                            <button
                              onClick={() => handleOpenWhatsAppLinkForLeave(leave)}
                              className="text-green-600 hover:text-green-900"
                              title="Open WhatsApp (Direct Link)"
                            >
                              <HiPhone className="w-5 h-5" />
                            </button>
                            {/* Backend WhatsApp Send - Uses API */}
                            <button
                              onClick={() => handleSendWhatsAppToEmployeeForLeave(leave)}
                              disabled={sendingWhatsAppForLeave === leave.id}
                              className="text-blue-600 hover:text-blue-900 disabled:opacity-50"
                              title="Send WhatsApp via API"
                            >
                              <HiChatAlt2 className="w-5 h-5" />
                              {sendingWhatsAppForLeave === leave.id && <span className="ml-1 text-xs">...</span>}
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'whatsapp' && (
        <WhatsAppAdminPanel />
      )}

      {activeTab === 'documents' && adminOrganizationId && adminUserDbId && (
        <DocumentManagement
          organizationId={adminOrganizationId}
          userId={adminUserDbId}
          userName={adminUserName || undefined}
        />
      )}

      {activeTab === 'ai' && (
        <div className="space-y-4">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">AI Attendance Routes</h2>
            <p className="text-sm text-gray-600 mb-4">
              Access all AI attendance workflows from these links.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Link to="/attendance/ai-center" className="rounded-md border p-3 hover:bg-gray-50">
                <div className="font-medium text-gray-900">AI Attendance Center</div>
                <div className="text-xs text-gray-600">/attendance/ai-center</div>
              </Link>
              <Link to="/attendance/ai-configurator" className="rounded-md border p-3 hover:bg-gray-50">
                <div className="font-medium text-gray-900">AI Shift Configurator</div>
                <div className="text-xs text-gray-600">/attendance/ai-configurator</div>
              </Link>
              <Link to="/attendance/ai-review" className="rounded-md border p-3 hover:bg-gray-50">
                <div className="font-medium text-gray-900">AI Review Queue</div>
                <div className="text-xs text-gray-600">/attendance/ai-review</div>
              </Link>
              <Link to="/payroll/attendance-intelligence" className="rounded-md border p-3 hover:bg-gray-50">
                <div className="font-medium text-gray-900">Payroll Attendance AI</div>
                <div className="text-xs text-gray-600">/payroll/attendance-intelligence</div>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Add other tab content for conversations as needed */}

      {/* Full Reason Modal */}
      {viewingReasonId && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Full Reason</h3>
              <button
                onClick={() => setViewingReasonId(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <HiX className="w-6 h-6" />
              </button>
            </div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">
              {leaveRequests.find(r => r.id === viewingReasonId)?.reason}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
