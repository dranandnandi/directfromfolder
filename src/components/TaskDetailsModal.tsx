import React, { useState, useEffect } from 'react';
import { HiX, HiPencil, HiPhone, HiPlus, HiChevronDown, HiChevronRight } from 'react-icons/hi';
import { FaWhatsapp } from 'react-icons/fa';
import { Task, User, QualityControlEntry, TaskType, TaskStatus } from '../models/task';
import { supabase } from '../utils/supabaseClient';
import clsx from 'clsx';
import { generateWhatsAppMessage } from '../utils/aiUtils';
import AddQualityEntryModal from './AddQualityEntryModal';
// import ConversationRecorder from './SimplifiedConversationRecorder';

interface TaskMessage {
  id: string;
  user_id: string;
  message: string;
  created_at: string;
  user: User;
}

interface ActivityLog {
  id: string;
  user_id: string;
  action_type: string;
  action_details: any;
  created_at: string;
  user: User;
}

interface TaskDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
  onEditTask: (task: Task) => void;
  teamMembers: User[];
  onTaskUpdate?: () => void;
}

interface GroupedActivityLog {
  date: string;
  logs: ActivityLog[];
}

interface CollapsedGroup {
  id: string;
  count: number;
  action: string;
  logs: ActivityLog[];
  isExpanded: boolean;
}

const formatActivityLog = (log: ActivityLog) => {
  // Helper function to format log values with better readability
  const formatLogValue = (value: any): string => {
    if (value === null || value === undefined) {
      return 'N/A';
    }
    
    const stringValue = String(value);
    
    // Check if it's a UUID (36 characters with hyphens)
    if (stringValue.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return stringValue.substring(0, 8) + '...';
    }
    
    // Check if it's an ISO date string
    if (stringValue.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      return new Date(stringValue).toLocaleString();
    }
    
    return stringValue;
  };

  switch (log.action_type) {
    case 'create':
      return {
        action: 'Created Task',
        details: `Created a new ${log.action_details.task.type} task: "${log.action_details.task.title}"`,
        icon: '➕',
        color: 'text-green-600'
      };
    case 'update':
      const changes = log.action_details.changes;
      const changesList = Object.entries(changes)
        .map(([field, value]: [string, any]) => {
          const fromValue = formatLogValue(value.from);
          const toValue = formatLogValue(value.to);
          
          // Skip changes where both values are the same or both are N/A
          if (fromValue === toValue || (fromValue === 'N/A' && toValue === 'N/A')) {
            return null;
          }
          
          // Format field names nicely
          const fieldName = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          
          // Only show meaningful changes
          if (fromValue === 'N/A') {
            return `${fieldName}: ${toValue}`;
          } else if (toValue === 'N/A') {
            return `${fieldName}: cleared`;
          } else {
            return `${fieldName}: ${fromValue} → ${toValue}`;
          }
        })
        .filter(change => change !== null);
      
      return {
        action: 'Updated Task',
        details: changesList.length > 0 ? changesList : ['No significant changes'],
        icon: '✏️',
        color: 'text-blue-600'
      };
    default:
      return {
        action: log.action_type,
        details: [JSON.stringify(log.action_details)],
        icon: '📝',
        color: 'text-gray-600'
      };
  }
};

const TaskDetailsModal: React.FC<TaskDetailsModalProps> = ({
  isOpen,
  onClose,
  task,
  onEditTask,
  onTaskUpdate
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'messages' | 'activity' | 'quality' | 'conversations'>('overview');
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [qualityEntries, setQualityEntries] = useState<QualityControlEntry[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddQualityEntryModal, setShowAddQualityEntryModal] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activityFilter, setActivityFilter] = useState('');
  // const [currentUserId, setCurrentUserId] = useState<string | null>(null); // Hidden with conversation recording

  useEffect(() => {
    if (isOpen) {
      console.log('TaskDetailsModal - Task object:', task);
      console.log('TaskDetailsModal - Due date:', task.dueDate);
      console.log('TaskDetailsModal - Due date type:', typeof task.dueDate);
      fetchMessages();
      fetchActivityLogs();
      fetchQualityEntries();
      fetchCurrentUser();
    }
  }, [isOpen, task.id]);

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
          // setCurrentUserId(userData.id); // Hidden with conversation recording
        }
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('task_messages')
        .select(`
          *,
          user:users(*)
        `)
        .eq('task_id', task.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const fetchActivityLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('task_activity_logs')
        .select(`
          *,
          user:users(*)
        `)
        .eq('task_id', task.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setActivityLogs(data || []);
    } catch (error) {
      console.error('Error fetching activity logs:', error);
    }
  };

  const fetchQualityEntries = async () => {
    console.log('Fetching quality entries for task ID:', task.id);
    try {
      const { data, error } = await supabase
        .from('quality_control_entries')
        .select(`
          *,
          user:users(*)
        `)
        .eq('task_id', task.id)
        .order('entry_date', { ascending: false });

      console.log('Supabase response for quality entries:', { data, error });

      if (error) throw error;
      setQualityEntries(data || []);
    } catch (error) {
      console.error('Error fetching quality entries:', error);
    }
  };

  const handleTaskStatusUpdate = async (newStatus: TaskStatus) => {
    try {
      setLoading(true);
      
      // Update task in the database
      const { error } = await supabase
        .from('tasks')
        .update({ 
          status: newStatus,
          completed_at: newStatus === TaskStatus.Completed ? new Date().toISOString() : null
        })
        .eq('id', task.id);

      if (error) throw error;

      // Call the optional onTaskUpdate callback if provided to refresh tasks
      if (onTaskUpdate) {
        await onTaskUpdate();
      }

      // Close the modal after successful update
      onClose();
    } catch (error) {
      console.error('Error updating task status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      setLoading(true);
      
      // First get the current user's auth ID
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not found');

      // Then get the user's record from the users table
      const { data: userRecord, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', userData.user.id)
        .single();

      if (userError) throw userError;
      if (!userRecord) throw new Error('User record not found');

      // Now use the user's ID from the users table
      const { error: messageError } = await supabase
        .from('task_messages')
        .insert([
          {
            task_id: task.id,
            user_id: userRecord.id, // Use the ID from users table
            message: newMessage.trim()
          }
        ]);

      if (messageError) throw messageError;

      setNewMessage('');
      await fetchMessages();
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleWhatsAppClick = async () => {
    try {
      const whatsappNumber = task.manualWhatsappNumber || task.contactNumber || task.assignees?.[0]?.whatsappNumber;
      if (!whatsappNumber) {
        alert('No WhatsApp number available for this task.');
        return;
      }

      const message = await generateWhatsAppMessage(task);
      
      // Use the same smart WhatsApp link logic as Dashboard
      const formattedNumber = whatsappNumber.replace(/^\+91/, '');
      const encodedMessage = encodeURIComponent(message);
      
      // Detect if user is on mobile device
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const baseURL = isMobile 
        ? "https://api.whatsapp.com/send" 
        : "https://web.whatsapp.com/send";
      
      const whatsappUrl = `${baseURL}?phone=91${formattedNumber}&text=${encodedMessage}`;
      window.open(whatsappUrl, '_blank');
    } catch (error) {
      console.error('Error generating WhatsApp message:', error);
      alert('Failed to generate WhatsApp message. Please try again.');
    }
  };

  const handlePhoneCall = () => {
    const phoneNumber = task.contactNumber || task.manualWhatsappNumber || task.assignees?.[0]?.whatsappNumber;
    if (!phoneNumber) {
      alert('No phone number available for this task.');
      return;
    }

    window.open(`tel:${phoneNumber}`, '_blank');
  };

  // Group activity logs by date
  const groupActivityLogsByDate = (logs: ActivityLog[]): GroupedActivityLog[] => {
    const groups: Record<string, ActivityLog[]> = {};
    
    logs.forEach(log => {
      const date = new Date(log.created_at).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(log);
    });

    return Object.entries(groups).map(([date, logs]) => ({ date, logs }));
  };

  // Collapse similar consecutive actions
  const collapseConsecutiveActions = (logs: ActivityLog[]): (ActivityLog | CollapsedGroup)[] => {
    const result: (ActivityLog | CollapsedGroup)[] = [];
    let currentGroup: ActivityLog[] = [];
    let lastAction = '';

    logs.forEach((log, index) => {
      const formatted = formatActivityLog(log);
      const currentAction = `${formatted.action}_${JSON.stringify(log.action_details)}`;

      if (currentAction === lastAction && currentGroup.length > 0) {
        currentGroup.push(log);
      } else {
        // Process previous group
        if (currentGroup.length > 1) {
          const groupId = `group_${result.length}`;
          result.push({
            id: groupId,
            count: currentGroup.length,
            action: formatActivityLog(currentGroup[0]).action,
            logs: currentGroup,
            isExpanded: collapsedGroups[groupId] || false
          });
        } else if (currentGroup.length === 1) {
          result.push(currentGroup[0]);
        }

        // Start new group
        currentGroup = [log];
        lastAction = currentAction;
      }

      // Handle last group
      if (index === logs.length - 1) {
        if (currentGroup.length > 1) {
          const groupId = `group_${result.length}`;
          result.push({
            id: groupId,
            count: currentGroup.length,
            action: formatActivityLog(currentGroup[0]).action,
            logs: currentGroup,
            isExpanded: collapsedGroups[groupId] || false
          });
        } else if (currentGroup.length === 1) {
          result.push(currentGroup[0]);
        }
      }
    });

    return result;
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // Filter activity logs
  const filteredActivityLogs = activityLogs.filter(log => {
    if (!activityFilter) return true;
    const formatted = formatActivityLog(log);
    return formatted.action.toLowerCase().includes(activityFilter.toLowerCase()) ||
           log.user.name.toLowerCase().includes(activityFilter.toLowerCase());
  });

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
        <div className="bg-white rounded-t-lg sm:rounded-lg w-full sm:max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="p-4 sm:p-6 border-b flex justify-between items-start">
            <div className="flex-1 pr-4">
              <h3 className="text-lg sm:text-xl font-semibold text-gray-900 leading-tight">{task.title}</h3>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Add Quality Entry Button */}
              {task.type === TaskType.AuditTask && (
                <button
                  onClick={() => setShowAddQualityEntryModal(true)}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-1"
                  title="Add Quality Control Entry"
                >
                  <HiPlus className="w-4 h-4" />
                  Add Quality Entry
                </button>
              )}
              {/* Add Conversation Recording Button - Hidden temporarily */}
              {/* <button
                onClick={() => setActiveTab('conversations')}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-1"
                title="Record Conversation"
              >
                <HiMicrophone className="w-4 h-4" />
                Record Conversation
              </button> */}
              <button onClick={onClose}>
                <HiX className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b">
            <div className="flex overflow-x-auto">
              <button
                className={clsx(
                  'px-3 sm:px-4 py-2 text-sm font-medium border-b-2 flex-shrink-0',
                  activeTab === 'overview'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
                onClick={() => setActiveTab('overview')}
              >
                Overview
              </button>
              <button
                className={clsx(
                  'px-3 sm:px-4 py-2 text-sm font-medium border-b-2 flex-shrink-0',
                  activeTab === 'messages'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
                onClick={() => setActiveTab('messages')}
              >
                Messages
              </button>
              <button
                className={clsx(
                  'px-3 sm:px-4 py-2 text-sm font-medium border-b-2 flex-shrink-0',
                  activeTab === 'activity'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
                onClick={() => setActiveTab('activity')}
              >
                Activity
              </button>
              {task.type === TaskType.AuditTask && (
                <button
                  className={clsx(
                    'px-3 sm:px-4 py-2 text-sm font-medium border-b-2 flex-shrink-0',
                    activeTab === 'quality'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  )}
                  onClick={() => setActiveTab('quality')}
                >
                  Quality
                </button>
              )}
              <button
                className={clsx(
                  'px-3 sm:px-4 py-2 text-sm font-medium border-b-2 flex-shrink-0',
                  activeTab === 'conversations'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
                onClick={() => setActiveTab('conversations')}
              >
                Conversations
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 sm:p-6 overflow-y-auto flex-1">
            {activeTab === 'overview' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                  <div className="flex-1">
                    <p className="text-sm sm:text-base text-gray-600 mb-3">{task.description}</p>
                    {task.assignees?.[0] && (
                      <div className="mb-3">
                        <span className="text-sm font-medium">Assigned to: </span>
                        <span className="text-sm text-purple-600">{task.assignees[0].name}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 sm:gap-2 justify-start sm:justify-end">
                    <button
                      onClick={() => onEditTask(task)}
                      className="p-2 hover:bg-gray-100 rounded-full flex-shrink-0"
                      title="Edit task"
                    >
                      <HiPencil className="w-5 h-5 text-gray-500" />
                    </button>
                    {(task.manualWhatsappNumber || task.contactNumber || task.assignees?.[0]?.whatsappNumber) && (
                      <button
                        onClick={handleWhatsAppClick}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-full"
                        title="Send WhatsApp message"
                      >
                        <FaWhatsapp className="w-5 h-5" />
                      </button>
                    )}
                    {(task.manualWhatsappNumber || task.contactNumber || task.assignees?.[0]?.whatsappNumber) && (
                      <button
                        onClick={handlePhoneCall}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-full"
                        title="Call contact"
                      >
                        <HiPhone className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <h4 className="font-medium mb-3 text-base">Details</h4>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-600">Status:</span>
                        <span className={clsx(
                          'px-2 py-1 rounded-full text-xs font-medium',
                          {
                            'bg-gray-100 text-gray-800': task.status === 'new',
                            'bg-blue-100 text-blue-800': task.status === 'inProgress',
                            'bg-green-100 text-green-800': task.status === 'completed',
                            'bg-red-100 text-red-800': task.status === 'overdue'
                          }
                        )}>
                          {task.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-600">Priority:</span>
                        <span className={clsx(
                          'px-2 py-1 rounded-full text-xs font-medium',
                          {
                            'bg-red-100 text-red-800': task.priority === 'critical',
                            'bg-yellow-100 text-yellow-800': task.priority === 'moderate',
                            'bg-gray-100 text-gray-800': task.priority === 'lessImportant'
                          }
                        )}>
                          {task.priority}
                        </span>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-gray-600">Due Date:</span>
                        <div className="text-sm mt-1">
                          {task.dueDate ? (
                            <span className="text-gray-900">{new Date(task.dueDate).toLocaleString()}</span>
                          ) : (
                            <span className="text-gray-400 italic">Not set</span>
                          )}
                        </div>
                        {/* Debug info - remove in production */}
                        <div className="text-xs text-gray-400 mt-1">
                          Debug: {task.dueDate ? `${task.dueDate} (${typeof task.dueDate})` : 'undefined/null'}
                        </div>
                      </div>
                      {task.patientId && (
                        <div>
                          <span className="text-sm text-gray-500">Patient ID: </span>
                          <span className="text-sm">{task.patientId}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Type-specific details - Only show location for PatientTracking */}
                  <div>
                    <h4 className="font-medium mb-2">Additional Information</h4>
                    <div className="space-y-2">
                      {task.type === TaskType.PatientTracking && task.location && (
                        <div>
                          <span className="text-sm text-gray-500">Location: </span>
                          <span className="text-sm">{task.location}</span>
                        </div>
                      )}
                      {task.type === TaskType.PatientTracking && task.hoursToComplete && (
                        <div>
                          <span className="text-sm text-gray-500">Complete within: </span>
                          <span className="text-sm">{task.hoursToComplete} hours</span>
                        </div>
                      )}
                      {task.contactNumber && (
                        <div>
                          <span className="text-sm text-gray-500">Contact: </span>
                          <span className="text-sm">{task.contactNumber}</span>
                        </div>
                      )}
                      {task.manualWhatsappNumber && (
                        <div>
                          <span className="text-sm text-gray-500">WhatsApp: </span>
                          <span className="text-sm">{task.manualWhatsappNumber}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'messages' && (
              <div className="flex flex-col h-[calc(90vh-200px)]">
                <div className="flex-1 overflow-y-auto mb-4 space-y-4">
                  {messages.map((message) => (
                    <div key={message.id} className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm">
                        {message.user.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium">{message.user.name}</span>
                          <span className="text-xs text-gray-500">
                            {new Date(message.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700">{message.message}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Type your message..."
                      className="flex-1 rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={loading || !newMessage.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="space-y-4 h-[calc(90vh-200px)] overflow-y-auto">
                {/* Search/Filter Bar */}
                <div className="sticky top-0 bg-white pb-4 border-b">
                  <input
                    type="text"
                    placeholder="Search activity logs..."
                    value={activityFilter}
                    onChange={(e) => setActivityFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>

                {/* Activity Logs */}
                {groupActivityLogsByDate(filteredActivityLogs).map((group) => (
                  <div key={group.date} className="space-y-3">
                    {/* Date Divider */}
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-gray-300"></div>
                      <span className="text-sm font-medium text-gray-500 bg-white px-3">
                        {group.date}
                      </span>
                      <div className="flex-1 h-px bg-gray-300"></div>
                    </div>

                    {/* Collapsed Activity Logs */}
                    {collapseConsecutiveActions(group.logs).map((item) => {
                      if ('count' in item) {
                        // Collapsed group
                        const group = item as CollapsedGroup;
                        return (
                          <div key={group.id} className="space-y-2">
                            <div 
                              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100"
                              onClick={() => toggleGroup(group.id)}
                            >
                              {group.isExpanded ? (
                                <HiChevronDown className="w-4 h-4 text-gray-500" />
                              ) : (
                                <HiChevronRight className="w-4 h-4 text-gray-500" />
                              )}
                              <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center text-white text-sm">
                                {group.logs[0].user.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-baseline gap-2">
                                  <span className="font-medium">{group.logs[0].user.name}</span>
                                  <span className="text-xs text-gray-500">
                                    {new Date(group.logs[0].created_at).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-700">
                                  <span className="font-medium">{group.count} similar {group.action.toLowerCase()} actions</span>
                                  <span className="text-gray-500 ml-2">(click to expand)</span>
                                </p>
                              </div>
                            </div>

                            {/* Expanded logs */}
                            {group.isExpanded && (
                              <div className="ml-8 space-y-2 border-l-2 border-gray-200 pl-4">
                                {group.logs.map((log) => {
                                  const formatted = formatActivityLog(log);
                                  return (
                                    <div key={log.id} className="flex items-start gap-3 p-2">
                                      <div className="text-lg">{formatted.icon}</div>
                                      <div className="flex-1">
                                        <div className="flex items-baseline gap-2">
                                          <span className={`font-medium ${formatted.color}`}>
                                            {formatted.action}
                                          </span>
                                          <span className="text-xs text-gray-500">
                                            {new Date(log.created_at).toLocaleTimeString()}
                                          </span>
                                        </div>
                                        {Array.isArray(formatted.details) ? (
                                          <ul className="text-sm text-gray-700 mt-1 space-y-1">
                                            {formatted.details.map((detail, idx) => (
                                              <li key={idx} className="flex items-center gap-2">
                                                <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                                                {detail}
                                              </li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <p className="text-sm text-gray-700 mt-1">{formatted.details}</p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      } else {
                        // Single log entry
                        const log = item as ActivityLog;
                        const formatted = formatActivityLog(log);
                        return (
                          <div key={log.id} className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg">
                            <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center text-white text-sm">
                              {log.user.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-baseline gap-2">
                                <span className="font-medium">{log.user.name}</span>
                                <span className="text-xs text-gray-500">
                                  {new Date(log.created_at).toLocaleTimeString()}
                                </span>
                              </div>
                              <div className="flex items-start gap-2 mt-1">
                                <div className="text-lg">{formatted.icon}</div>
                                <div className="flex-1">
                                  <span className={`font-medium ${formatted.color}`}>
                                    {formatted.action}
                                  </span>
                                  {Array.isArray(formatted.details) ? (
                                    <ul className="text-sm text-gray-700 mt-1 space-y-1">
                                      {formatted.details.map((detail, idx) => (
                                        <li key={idx} className="flex items-center gap-2">
                                          <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                                          {detail}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-sm text-gray-700 mt-1">{formatted.details}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    })}
                  </div>
                ))}

                {filteredActivityLogs.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No activity logs found
                  </div>
                )}
              </div>
            )}

            {activeTab === 'quality' && task.type === TaskType.AuditTask && (
              <div className="space-y-6">
                {/* Quality Control Entries List */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-medium">Quality Control History</h4>
                    {task.type === TaskType.AuditTask && (
                      <button
                        onClick={() => setShowAddQualityEntryModal(true)}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-1"
                      >
                        <HiPlus className="w-4 h-4" />
                        Add Entry
                      </button>
                    )}
                  </div>
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {qualityEntries.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                        <p className="text-lg mb-2">No past entries</p>
                        <p className="text-sm">Click "Add Entry" to create the first quality control entry for this task.</p>
                      </div>
                    ) : (
                      qualityEntries.map((entry) => (
                        <div key={entry.id} className="border rounded-lg p-4 bg-white">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-sm">
                                {entry.user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                              </div>
                              <div>
                                <span className="font-medium">{entry.user?.name || 'Unknown User'}</span>
                                <div className="text-xs text-gray-500">
                                  Entry Date: {new Date(entry.entryDate).toLocaleString()}
                                </div>
                              </div>
                            </div>
                            <span className="text-xs text-gray-500">
                              Added: {new Date(entry.createdAt).toLocaleString()}
                            </span>
                          </div>
                          
                          <div className="space-y-2">
                            <div>
                              <span className="text-sm font-medium text-gray-700">Description:</span>
                              <p className="text-sm text-gray-600 mt-1">{entry.entryDescription}</p>
                            </div>
                            
                            {entry.remark && (
                              <div>
                                <span className="text-sm font-medium text-gray-700">Remarks:</span>
                                <p className="text-sm text-gray-600 mt-1">{entry.remark}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Conversations Tab - Hidden temporarily */}
          {/* {activeTab === 'conversations' && currentUserId && (
            <div className="space-y-4">
              <ConversationRecorder 
                customerIdentifier={task.patientId}
              />
            </div>
          )} */}
        </div>

        {/* Action Buttons Footer */}
        {task.status !== TaskStatus.Completed && (
          <div className="border-t bg-gray-50 px-4 sm:px-6 py-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div className="text-sm text-gray-600">
                Status: <span className="capitalize font-medium">{task.status}</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                {task.status === TaskStatus.New && (
                  <button
                    onClick={() => handleTaskStatusUpdate(TaskStatus.InProgress)}
                    disabled={loading}
                    className="px-4 py-3 sm:py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium w-full sm:w-auto"
                  >
                    {loading ? 'Updating...' : 'Start Task'}
                  </button>
                )}
                <button
                  onClick={() => handleTaskStatusUpdate(TaskStatus.Completed)}
                  disabled={loading}
                  className="px-4 py-3 sm:py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium w-full sm:w-auto"
                >
                  {loading ? 'Updating...' : 'Mark Complete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Quality Entry Modal */}
      {task.type === TaskType.AuditTask && (
        <AddQualityEntryModal
          isOpen={showAddQualityEntryModal}
          onClose={() => setShowAddQualityEntryModal(false)}
          task={task}
          onAddSuccess={fetchQualityEntries}
        />
      )}
    </>
  );
};

export default TaskDetailsModal;