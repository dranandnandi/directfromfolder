import React, { useState, useEffect } from 'react';
import { HiTrash, HiFilter, HiRefresh } from 'react-icons/hi';
import { Task, TaskType, User, TaskStatus, TaskPriority } from '../models/task';
import { supabase } from '../utils/supabaseClient';
import clsx from 'clsx';

// Define interfaces for raw Supabase response data
interface RawSupabaseUser {
  id: string;
  name: string;
  whatsapp_number: string;
  role: string;
  department: string;
}

interface RawSupabaseTask {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  patient_id?: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  due_date?: string;
  completed_at?: string;
  location?: string;
  round_type?: string;
  follow_up_type?: string;
  advisory_type?: string;
  contact_number?: string;
  manual_whatsapp_number?: string;
  hours_to_complete?: number;
  organization_id: string;
  created_by?: string;
  assigned_to?: RawSupabaseUser[] | RawSupabaseUser | null;
}

interface RawSupabasePersonalTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  assignee_id?: string;
  assignee?: RawSupabaseUser[] | RawSupabaseUser | null;
  creator?: {
    id: string;
    name: string;
    whatsapp_number: string;
    role: string;
    department: string;
    organization_id: string;
  };
}

interface DeleteTasksProps {
  teamMembers: User[];
  onTasksRefreshed: () => void;
}

interface FilterState {
  assignedUser: string;
  taskType: string;
  status: string;
  dateFilter: 'all' | 'overdue' | 'future' | 'today';
  searchTerm: string;
}

const DeleteTasks: React.FC<DeleteTasksProps> = ({ teamMembers, onTasksRefreshed }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    assignedUser: '',
    taskType: '',
    status: '',
    dateFilter: 'all',
    searchTerm: ''
  });

  useEffect(() => {
    fetchTasks();
  }, [filters]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('Current filters:', filters);

      // Get user's organization
      const { data: userData } = await supabase
        .from('users')
        .select('organization_id, role')
        .eq('auth_id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!userData?.organization_id) {
        throw new Error('Organization not found');
      }

      // Check if user is admin
      if (!['admin', 'superadmin'].includes(userData.role)) {
        throw new Error('Access denied. Admin privileges required.');
      }

      // Fetch organization tasks
      let orgTasksQuery = supabase
        .from('tasks')
        .select(`
          id,
          type,
          title,
          description,
          patient_id,
          priority,
          status,
          created_at,
          updated_at,
          due_date,
          completed_at,
          location,
          round_type,
          follow_up_type,
          advisory_type,
          contact_number,
          manual_whatsapp_number,
          hours_to_complete,
          organization_id,
          created_by,
          assigned_to:users!tasks_assigned_to_fkey (
            id,
            name,
            whatsapp_number,
            role,
            department
          )
        `)
        .eq('organization_id', userData.organization_id);

      // Apply filters
      if (filters.assignedUser) {
        orgTasksQuery = orgTasksQuery.eq('assigned_to', filters.assignedUser);
      }

      if (filters.taskType && filters.taskType !== 'personalTask') {
        orgTasksQuery = orgTasksQuery.eq('type', filters.taskType);
      }

      if (filters.status) {
        orgTasksQuery = orgTasksQuery.eq('status', filters.status);
      }

      // Apply date filters
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      switch (filters.dateFilter) {
        case 'overdue':
          orgTasksQuery = orgTasksQuery.lt('due_date', now.toISOString());
          break;
        case 'future':
          orgTasksQuery = orgTasksQuery.gt('due_date', now.toISOString());
          break;
        case 'today':
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          orgTasksQuery = orgTasksQuery
            .gte('due_date', today.toISOString())
            .lt('due_date', tomorrow.toISOString());
          break;
      }

      // Fetch personal tasks
      let personalTasksQuery = supabase
        .from('personal_tasks')
        .select(`
          id,
          title,
          description,
          priority,
          status,
          due_date,
          created_at,
          updated_at,
          user_id,
          assignee_id,
          assignee:users!personal_tasks_assignee_id_fkey (
            id,
            name,
            whatsapp_number,
            role,
            department
          ),
          creator:users!personal_tasks_user_id_fkey (
            id,
            name,
            whatsapp_number,
            role,
            department,
            organization_id
          )
        `);

      // Filter personal tasks by organization
      personalTasksQuery = personalTasksQuery.eq('creator.organization_id', userData.organization_id);

      // Apply filters to personal tasks
      if (filters.assignedUser) {
        personalTasksQuery = personalTasksQuery.eq('assignee_id', filters.assignedUser);
      }

      if (filters.status) {
        personalTasksQuery = personalTasksQuery.eq('status', filters.status);
      }

      // Apply date filters to personal tasks
      switch (filters.dateFilter) {
        case 'overdue':
          personalTasksQuery = personalTasksQuery.lt('due_date', now.toISOString());
          break;
        case 'future':
          personalTasksQuery = personalTasksQuery.gt('due_date', now.toISOString());
          break;
        case 'today':
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          personalTasksQuery = personalTasksQuery
            .gte('due_date', today.toISOString())
            .lt('due_date', tomorrow.toISOString());
          break;
      }

      // Execute queries
      const [orgTasksResult, personalTasksResult] = await Promise.all([
        filters.taskType === 'personalTask' 
          ? { data: [], error: null } 
          : orgTasksQuery.order('created_at', { ascending: false }),
        filters.taskType && filters.taskType !== 'personalTask' 
          ? { data: [], error: null }
          : personalTasksQuery.order('created_at', { ascending: false })
      ]);

      console.log('Raw Org Tasks Data:', orgTasksResult.data);
      console.log('Raw Personal Tasks Data:', personalTasksResult.data);

      const typedOrgTasksData = orgTasksResult.data as RawSupabaseTask[] || [];
      const typedPersonalTasksData = personalTasksResult.data as RawSupabasePersonalTask[] || [];

      if (orgTasksResult.error) throw orgTasksResult.error;
      if (personalTasksResult.error) throw personalTasksResult.error;

      // Transform organization tasks to match Task interface
      const formattedOrgTasks: Task[] = typedOrgTasksData.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description,
        type: task.type,
        status: task.status as TaskStatus,
        priority: task.priority as TaskPriority,
        assignees: task.assigned_to && Array.isArray(task.assigned_to) && task.assigned_to.length > 0 ? [{
          id: task.assigned_to[0].id,
          name: task.assigned_to[0].name,
          whatsappNumber: task.assigned_to[0].whatsapp_number,
          role: task.assigned_to[0].role,
          department: task.assigned_to[0].department
        }] : task.assigned_to && !Array.isArray(task.assigned_to) ? [{
          id: task.assigned_to.id,
          name: task.assigned_to.name,
          whatsappNumber: task.assigned_to.whatsapp_number,
          role: task.assigned_to.role,
          department: task.assigned_to.department
        }] : [],
        patientId: task.patient_id,
        dueDate: task.due_date ? new Date(task.due_date) : undefined,
        location: task.location,
        roundType: task.round_type,
        followUpType: task.follow_up_type,
        advisoryType: task.advisory_type,
        manualWhatsappNumber: task.manual_whatsapp_number,
        contactNumber: task.contact_number,
        hoursToComplete: task.hours_to_complete,
        createdAt: new Date(task.created_at)
      }));

      console.log('Formatted Org Tasks:', formattedOrgTasks);

      // Transform personal tasks to match Task interface
      const formattedPersonalTasks: Task[] = typedPersonalTasksData.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description,
        type: TaskType.PersonalTask,
        status: task.status as TaskStatus,
        priority: task.priority as TaskPriority,
        assignees: task.assignee && Array.isArray(task.assignee) && task.assignee.length > 0 ? [{
          id: task.assignee[0].id,
          name: task.assignee[0].name,
          whatsappNumber: task.assignee[0].whatsapp_number,
          role: task.assignee[0].role,
          department: task.assignee[0].department
        }] : task.assignee && !Array.isArray(task.assignee) ? [{
          id: task.assignee.id,
          name: task.assignee.name,
          whatsappNumber: task.assignee.whatsapp_number,
          role: task.assignee.role,
          department: task.assignee.department
        }] : [],
        patientId: undefined,
        dueDate: task.due_date ? new Date(task.due_date) : undefined,
        location: undefined,
        roundType: undefined,
        followUpType: undefined,
        advisoryType: undefined,
        manualWhatsappNumber: undefined,
        contactNumber: undefined,
        hoursToComplete: undefined,
        createdAt: new Date(task.created_at)
      }));

      console.log('Formatted Personal Tasks:', formattedPersonalTasks);

      // Combine both task types
      const allTasks = [...formattedOrgTasks, ...formattedPersonalTasks];
      console.log('Combined All Tasks (before search filter):', allTasks);

      // Apply search filter
      let filteredTasks = allTasks;
      if (filters.searchTerm) {
        const searchLower = filters.searchTerm.toLowerCase();
        filteredTasks = allTasks.filter(task =>
          task.title.toLowerCase().includes(searchLower) ||
          task.description.toLowerCase().includes(searchLower) ||
          task.patientId?.toLowerCase().includes(searchLower) ||
          task.assignees?.[0]?.name.toLowerCase().includes(searchLower)
        );
      }

      console.log('Final Filtered Tasks (before setting state):', filteredTasks);
      setTasks(filteredTasks);
    } catch (error: any) {
      console.error('Error fetching tasks:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedTaskIds.size === tasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(tasks.map(task => task.id)));
    }
  };

  const handleSelectTask = (taskId: string) => {
    const newSelected = new Set(selectedTaskIds);
    if (newSelected.has(taskId)) {
      newSelected.delete(taskId);
    } else {
      newSelected.add(taskId);
    }
    setSelectedTaskIds(newSelected);
  };

  const handleDeleteSelected = async () => {
    if (selectedTaskIds.size === 0) {
      alert('Please select tasks to delete.');
      return;
    }

    const confirmMessage = `Are you sure you want to delete ${selectedTaskIds.size} task(s)? This action cannot be undone.`;
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      setDeleting(true);
      
      console.log('Attempting to delete tasks:', Array.from(selectedTaskIds));
      
      console.log('Attempting to delete tasks:', Array.from(selectedTaskIds));
      
      // Separate tasks by type for deletion
      const selectedTasks = tasks.filter(task => selectedTaskIds.has(task.id));
      console.log('Selected tasks for deletion:', selectedTasks);
      
      const orgTasks = selectedTasks.filter(task => task.type !== TaskType.PersonalTask);
      const personalTasks = selectedTasks.filter(task => task.type === TaskType.PersonalTask);
      
      console.log('Organization tasks to delete:', orgTasks);
      console.log('Personal tasks to delete:', personalTasks);

      // Delete organization tasks
      if (orgTasks.length > 0) {
        const { error: orgError } = await supabase
          .from('tasks')
          .delete()
          .in('id', orgTasks.map(t => t.id));

        if (orgError) {
          console.error('Error deleting organization tasks:', orgError);
          throw orgError;
        } else {
          console.log('Successfully deleted organization tasks');
        }
      }

      // Delete personal tasks
      if (personalTasks.length > 0) {
        const { error: personalError } = await supabase
          .from('personal_tasks')
          .delete()
          .in('id', personalTasks.map(t => t.id));

        if (personalError) {
          console.error('Error deleting personal tasks:', personalError);
          throw personalError;
        } else {
          console.log('Successfully deleted personal tasks');
        }
      }

      console.log('Tasks deleted successfully');
      console.log('Tasks deleted successfully');
      // Refresh the task list
      onTasksRefreshed();
      setSelectedTaskIds(new Set());
      alert(`Successfully deleted ${selectedTaskIds.size} task(s).`);
    } catch (error: any) {
      console.error('Error deleting tasks:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        stack: error.stack,
        fullError: error
      });
      
      // Provide more specific error messages
      let errorMessage = 'Failed to delete tasks';
      if (error.message?.includes('permission') || error.message?.includes('policy')) {
        errorMessage = 'Permission denied. You may not have the required admin privileges to delete these tasks.';
      } else if (error.message?.includes('foreign key') || error.message?.includes('constraint')) {
        errorMessage = 'Cannot delete tasks that have related data (messages, activity logs, etc.). Please contact support.';
      } else if (error.message) {
        errorMessage = `Failed to delete tasks: ${error.message}`;
      }
      
      alert(errorMessage);
    } finally {
      setDeleting(false);
    }
  };

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    console.log('Filter changed:', key, 'to', value);
    setSelectedTaskIds(new Set()); // Clear selections when filters change
  };

  const clearFilters = () => {
    console.log('Clearing all filters');
    setFilters({
      assignedUser: '',
      taskType: '',
      status: '',
      dateFilter: 'all',
      searchTerm: ''
    });
    setSelectedTaskIds(new Set());
  };

  const getTaskTypeLabel = (type: string) => {
    switch (type) {
      case TaskType.QuickAdvisory: return 'Regular Tasks';
      case TaskType.ClinicalRound: return 'Patient Tracking';
      case TaskType.FollowUp: return 'Audit Tasks';
      case TaskType.PersonalTask: return 'Personal Task';
      default: return type;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return 'bg-gray-100 text-gray-800';
      case 'inProgress': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'moderate': return 'bg-yellow-100 text-yellow-800';
      case 'lessImportant': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading tasks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-red-600">Delete Tasks (Admin Only)</h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={fetchTasks}
            className="flex items-center gap-1 px-3 py-2 text-gray-600 hover:text-gray-800 border rounded-lg hover:bg-gray-50 text-sm"
            title="Refresh task list"
          >
            <HiRefresh className="w-5 h-5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={selectedTaskIds.size === 0 || deleting}
            className="flex items-center gap-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-red-300 text-sm"
          >
            <HiTrash className="w-5 h-5" />
            <span className="hidden sm:inline">
              {deleting ? 'Deleting...' : `Delete (${selectedTaskIds.size})`}
            </span>
            <span className="sm:hidden">
              {selectedTaskIds.size}
            </span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <HiFilter className="w-5 h-5 text-gray-500" />
          <h3 className="text-lg font-medium">Filters</h3>
          <button
            onClick={clearFilters}
            className="ml-auto text-sm text-blue-600 hover:text-blue-700"
          >
            Clear All
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <input
              type="text"
              value={filters.searchTerm}
              onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
              placeholder="Search tasks..."
              className="w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Assigned User
            </label>
            <select
              value={filters.assignedUser}
              onChange={(e) => handleFilterChange('assignedUser', e.target.value)}
              className="w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">All Users</option>
              {teamMembers.map(member => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Task Type
            </label>
            <select
              value={filters.taskType}
              onChange={(e) => handleFilterChange('taskType', e.target.value)}
              className="w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">All Types</option>
              <option value={TaskType.QuickAdvisory}>Regular Tasks</option>
              <option value={TaskType.ClinicalRound}>Patient Tracking</option>
              <option value={TaskType.FollowUp}>Audit Task</option>
              <option value={TaskType.PersonalTask}>Personal Task</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="new">New</option>
              <option value="inProgress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date Filter
            </label>
            <select
              value={filters.dateFilter}
              onChange={(e) => handleFilterChange('dateFilter', e.target.value as 'all' | 'overdue' | 'future' | 'today')}
              className="w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="all">All Tasks</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due Today</option>
              <option value="future">Future Tasks</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tasks Table */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={tasks.length > 0 && selectedTaskIds.size === tasks.length}
                  onChange={handleSelectAll}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium">
                  <span className="hidden sm:inline">Select All </span>({tasks.length})
                </span>
              </label>
            </div>
            <div className="text-sm text-gray-500">
              {selectedTaskIds.size} of {tasks.length} selected
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-w-full">
          <table className="w-full min-w-[800px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                  Select
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[200px]">
                  Task
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                  Type
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Priority
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                  Assigned To
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                  Due Date
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  className={clsx(
                    'hover:bg-gray-50',
                    selectedTaskIds.has(task.id) && 'bg-blue-50'
                  )}
                >
                  <td className="px-3 py-3 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.has(task.id)}
                      onChange={() => handleSelectTask(task.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 text-sm truncate">
                        {task.title}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {task.description}
                      </div>
                      {task.patientId && (
                        <div className="text-xs text-gray-400">
                          Patient: {task.patientId}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800 block truncate">
                      {getTaskTypeLabel(task.type)}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={clsx(
                      'px-2 py-1 text-xs font-medium rounded-full',
                      getStatusColor(task.status)
                    )}>
                      {task.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={clsx(
                      'px-2 py-1 text-xs font-medium rounded-full',
                      getPriorityColor(task.priority)
                    )}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="text-sm text-gray-900 truncate">
                      {task.assignees?.[0]?.name || 'Unassigned'}
                    </div>
                    {task.assignees?.[0] && (
                      <div className="text-xs text-gray-500 truncate">
                        {task.assignees[0].department}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-500">
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'None'}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-500">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tasks.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-500">No tasks found matching the current filters.</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeleteTasks;