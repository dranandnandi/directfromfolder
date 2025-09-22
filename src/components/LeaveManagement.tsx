import React, { useState, useEffect } from 'react';
import {
  HiCalendar,
  HiClock,
  HiPlus,
  HiX,
  HiCheck,
  HiExclamationCircle
} from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';

interface LeaveRequestFormProps {
  userId: string;
  onClose: () => void;
  onSubmit: () => void;
}

interface ExistingLeaveRequest {
  id: string;
  leave_type: string;
  start_date: string;
  end_date?: string;
  reason: string;
  status: string;
  is_post_facto: boolean;
  requested_at: string;
  comments?: string;
  employee_name?: string;
  employee_department?: string;
}

interface LeaveRequestMetadata {
  leave_type?: string;
  start_date?: string;
  end_date?: string;
  reason?: string;
  is_post_facto?: boolean;
  is_emergency?: boolean;
  employee_id?: string;
  employee_name?: string;
  employee_department?: string;
}

const LeaveRequestForm: React.FC<LeaveRequestFormProps> = ({
  userId,
  onClose,
  onSubmit
}) => {
  const [formData, setFormData] = useState({
    leave_type: 'full_day',
    start_date: '',
    end_date: '',
    reason: '',
    is_emergency: false
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      // Get the user's organization and find the admin
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, organization_id, name, department')
        .eq('auth_id', userId)
        .maybeSingle();

      if (userError) {
        console.error('User lookup error:', userError);
        throw new Error(`Failed to find user information: ${userError.message}`);
      }

      if (!userData) {
        throw new Error('User not found. Please check your login status.');
      }

      if (!userData.organization_id) {
        throw new Error('You are not assigned to an organization. Please contact your administrator.');
      }

      // Find the admin for this organization
      const { data: adminData, error: adminError } = await supabase
        .from('users')
        .select('id, name')
        .eq('organization_id', userData.organization_id)
        .in('role', ['admin', 'superadmin'])
        .limit(1);

      if (adminError) {
        console.error('Admin lookup error:', adminError);
        throw new Error(`Failed to find organization admin: ${adminError.message}`);
      }
      
      if (!adminData || adminData.length === 0) {
        throw new Error('No admin found for your organization. Please contact your system administrator.');
      }

      const adminId = adminData[0].id;

      // Check if it's a post facto request
      const requestDate = new Date(formData.start_date);
      const today = new Date();
      const isPostFacto = requestDate < today;

      // Create task assigned to admin for approval
      const { error: taskError } = await supabase
        .from('tasks')
        .insert([
          {
            title: `Leave Request: ${userData.name} - ${formData.leave_type.replace('_', ' ').toUpperCase()}${isPostFacto ? ' (Post Facto)' : ''}`,
            description: `LEAVE REQUEST DETAILS:
Employee: ${userData.name}
Department: ${userData.department}
Leave Type: ${formData.leave_type.replace('_', ' ').toUpperCase()}
Start Date: ${formData.start_date}${formData.end_date ? `\nEnd Date: ${formData.end_date}` : ''}
Reason: ${formData.reason}
Emergency: ${formData.is_emergency ? 'YES' : 'NO'}
${isPostFacto ? 'POST FACTO REQUEST: This leave has already been taken' : ''}

Please review and approve/reject this leave request.`,
            assigned_to: adminId, // Assign to admin for approval
            created_by: userData.id, // Track who created the request - use database user ID
            type: 'personalTask', // Use valid task type for leave requests
            priority: formData.is_emergency ? 'critical' : isPostFacto ? 'moderate' : 'lessImportant',
            status: 'pending',
            due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Admin has 24 hours to respond
            hours_to_complete: 1 // Time for admin to review
          }
        ]);

      if (taskError) throw taskError;

      onSubmit();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit leave request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPostFacto = formData.start_date && new Date(formData.start_date) < new Date();

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Request Leave</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <HiX className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Leave Type
            </label>
            <select
              value={formData.leave_type}
              onChange={(e) => setFormData({ ...formData, leave_type: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              required
            >
              <option value="full_day">Full Day</option>
              <option value="half_day">Half Day</option>
              <option value="early_departure">Early Departure</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              required
            />
            {isPostFacto && (
              <div className="flex items-center mt-1 text-orange-600 text-sm">
                <HiExclamationCircle className="w-4 h-4 mr-1" />
                This is a post facto request
              </div>
            )}
          </div>

          {formData.leave_type === 'full_day' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date (Optional)
              </label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                min={formData.start_date}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason
            </label>
            <textarea
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="Please provide a reason for your leave request..."
              required
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_emergency"
              checked={formData.is_emergency}
              onChange={(e) => setFormData({ ...formData, is_emergency: e.target.checked })}
              className="mr-2"
            />
            <label htmlFor="is_emergency" className="text-sm text-gray-700">
              Emergency/Urgent Request
            </label>
          </div>

          {error && (
            <div className="text-red-600 text-sm">{error}</div>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const LeaveManagement: React.FC<{ userId: string; isAdmin?: boolean }> = ({
  userId,
  isAdmin = false
}) => {
  const [showForm, setShowForm] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState<ExistingLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  useEffect(() => {
    fetchLeaveRequests();
  }, [userId]);

  const fetchLeaveRequests = async () => {
    try {
      setLoading(true);
      
      // First get the current user's database ID
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', userId)
        .maybeSingle();

      if (userError || !userData) {
        console.error('Error fetching user data:', userError);
        return;
      }

      const dbUserId = userData.id;
      
      let query = supabase
        .from('tasks')
        .select('*')
        .eq('type', 'personalTask')
        .ilike('title', '%Leave Request%') // Filter by title to identify leave requests
        .order('created_at', { ascending: false });

      if (isAdmin) {
        // Admin sees leave requests assigned to them (for approval) AND requests they created
        query = query.or(`assigned_to.eq.${dbUserId},created_by.eq.${dbUserId}`);
      } else {
        // Regular users see leave requests they created
        query = query.eq('created_by', dbUserId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const formattedRequests: ExistingLeaveRequest[] = (data || []).map(request => {
        // Parse metadata if available
        let metadata: LeaveRequestMetadata = {};
        try {
          metadata = request.metadata ? JSON.parse(request.metadata) : {};
        } catch (e) {
          // If parsing fails, use legacy format
        }

        const isPostFacto = metadata.is_post_facto || 
                           (new Date(request.created_at) > new Date(metadata.start_date || request.due_date));
        
        return {
          id: request.id,
          leave_type: metadata.leave_type || 'full_day', // Default to full_day if metadata missing
          start_date: metadata.start_date || request.due_date,
          end_date: metadata.end_date,
          reason: metadata.reason || request.description || '',
          status: request.status === 'completed' ? 'approved' : 
                  request.status === 'cancelled' ? 'rejected' : 'pending',
          is_post_facto: isPostFacto,
          requested_at: request.created_at,
          comments: request.title,
          employee_name: metadata.employee_name,
          employee_department: metadata.employee_department
        };
      });

      setLeaveRequests(formattedRequests);
    } catch (error) {
      console.error('Error fetching leave requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleLeaveApproval = async (requestId: string, action: 'approve' | 'reject', comments?: string) => {
    try {
      const status = action === 'approve' ? 'completed' : 'cancelled';
      const { error } = await supabase
        .from('tasks')
        .update({ 
          status,
          completed_at: action === 'approve' ? new Date().toISOString() : null,
          title: `${action === 'approve' ? 'APPROVED' : 'REJECTED'}: ${comments || (action === 'approve' ? 'Leave request approved' : 'Leave request denied')}`
        })
        .eq('id', requestId);

      if (error) throw error;
      
      // Refresh the list
      await fetchLeaveRequests();
    } catch (error) {
      console.error('Error updating leave request:', error);
    }
  };

  const filteredRequests = leaveRequests.filter(request => 
    filter === 'all' || request.status === filter
  );

  const pendingCount = leaveRequests.filter(r => r.status === 'pending').length;
  const approvedCount = leaveRequests.filter(r => r.status === 'approved').length;
  const postFactoCount = leaveRequests.filter(r => r.is_post_facto).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
            <p className="text-gray-600">
              {isAdmin 
                ? 'Review and approve leave requests from employees, and manage your own leave requests' 
                : 'Manage your leave requests and view history'}
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <HiPlus className="w-4 h-4 mr-2" />
            Request Leave
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <div className="flex items-center">
              <HiCalendar className="w-8 h-8 text-blue-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Total Requests</p>
                <p className="text-2xl font-semibold text-gray-900">{leaveRequests.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm">
            <div className="flex items-center">
              <HiClock className="w-8 h-8 text-yellow-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Pending</p>
                <p className="text-2xl font-semibold text-gray-900">{pendingCount}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm">
            <div className="flex items-center">
              <HiCheck className="w-8 h-8 text-green-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Approved</p>
                <p className="text-2xl font-semibold text-gray-900">{approvedCount}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm">
            <div className="flex items-center">
              <HiExclamationCircle className="w-8 h-8 text-red-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Post Facto</p>
                <p className="text-2xl font-semibold text-gray-900">{postFactoCount}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="mb-6">
          <nav className="flex space-x-8">
            {[
              { id: 'all', label: 'All Requests' },
              { id: 'pending', label: 'Pending' },
              { id: 'approved', label: 'Approved' },
              { id: 'rejected', label: 'Rejected' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id as any)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  filter === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Leave Requests List */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {isAdmin && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Employee
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Leave Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date(s)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Requested
                  </th>
                  {isAdmin && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredRequests.map((request) => (
                  <tr key={request.id} className="hover:bg-gray-50">
                    {isAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {request.employee_name || 'Unknown'}
                          </div>
                          <div className="text-sm text-gray-500">
                            {request.employee_department || 'Unknown Dept'}
                          </div>
                        </div>
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {request.leave_type.replace('_', ' ').toUpperCase()}
                          </div>
                          {request.is_post_facto && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                              Post Facto
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {new Date(request.start_date).toLocaleDateString()}
                        {request.end_date && request.end_date !== request.start_date && (
                          <span> - {new Date(request.end_date).toLocaleDateString()}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 max-w-xs truncate">
                        {request.reason}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(request.status)}`}>
                        {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(request.requested_at).toLocaleDateString()}
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {request.status === 'pending' ? (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleLeaveApproval(request.id, 'approve')}
                              className="text-green-600 hover:text-green-900 flex items-center"
                              title="Approve"
                            >
                              <HiCheck className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleLeaveApproval(request.id, 'reject')}
                              className="text-red-600 hover:text-red-900 flex items-center"
                              title="Reject"
                            >
                              <HiX className="w-5 h-5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {filteredRequests.length === 0 && (
          <div className="text-center py-12">
            <HiCalendar className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No leave requests</h3>
            <p className="mt-1 text-sm text-gray-500">
              {filter === 'all' ? 'Get started by creating a new leave request.' : `No ${filter} requests found.`}
            </p>
          </div>
        )}
      </div>

      {/* Leave Request Form Modal */}
      {showForm && (
        <LeaveRequestForm
          userId={userId}
          onClose={() => setShowForm(false)}
          onSubmit={fetchLeaveRequests}
        />
      )}
    </div>
  );
};

export default LeaveManagement;
