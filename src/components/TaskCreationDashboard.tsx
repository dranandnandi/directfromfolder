import React, { useState, useMemo } from 'react';
import { HiPlus, HiArrowLeft, HiSearch, HiClock, HiCalendar } from 'react-icons/hi';
import { Task, TaskType, TaskStatus } from '../models/task';
import clsx from 'clsx';
import { FaWhatsapp } from 'react-icons/fa';
import { generateWhatsAppMessage } from '../utils/aiUtils';

interface TaskCreationDashboardProps {
  tasks: Task[];
  personalTasks: Task[];
  onAddTask: (type: TaskType) => void;
  onBackToFocus: () => void;
  setSelectedTask: (task: Task | null) => void;
}

// Helper function for WhatsApp
const generateWhatsAppLink = (phoneNumber: string, message: string) => {
  const encodedMessage = encodeURIComponent(message);
  const formattedNumber = phoneNumber.replace(/^\+91/, '');
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const baseURL = isMobile ? "https://api.whatsapp.com/send" : "https://web.whatsapp.com/send";
  return `${baseURL}?phone=91${formattedNumber}&text=${encodedMessage}`;
};

const TaskCreationDashboard: React.FC<TaskCreationDashboardProps> = ({
  tasks,
  personalTasks,
  onAddTask,
  onBackToFocus,
  setSelectedTask
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<TaskType | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | 'all'>('all');

  // Combine all tasks
  const allTasks = useMemo(() => [...tasks, ...personalTasks], [tasks, personalTasks]);

  // Get recently created tasks (last 7 days)
  const recentlyCreated = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    return allTasks
      .filter(task => new Date(task.createdAt) >= sevenDaysAgo)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10); // Show last 10 recent tasks
  }, [allTasks]);

  // Filter tasks based on search, type, and status
  const filteredTasks = useMemo(() => {
    let filtered = allTasks;

    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(task =>
        task.title.toLowerCase().includes(searchLower) ||
        task.description.toLowerCase().includes(searchLower) ||
        task.patientId?.toLowerCase().includes(searchLower) ||
        task.assignees?.[0]?.name.toLowerCase().includes(searchLower)
      );
    }

    // Apply type filter
    if (selectedType !== 'all') {
      filtered = filtered.filter(task => task.type === selectedType);
    }

    // Apply status filter
    if (selectedStatus !== 'all') {
      filtered = filtered.filter(task => task.status === selectedStatus);
    }

    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allTasks, searchTerm, selectedType, selectedStatus]);

  const handleWhatsAppClick = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const whatsappNumber = task.manualWhatsappNumber || task.contactNumber || task.assignees?.[0]?.whatsappNumber;
    if (!whatsappNumber) {
      alert('No WhatsApp number available for this task.');
      return;
    }

    try {
      const message = await generateWhatsAppMessage(task);
      const whatsappUrl = generateWhatsAppLink(whatsappNumber, message || task.description);
      window.open(whatsappUrl, '_blank');
    } catch (error) {
      console.error('Error generating WhatsApp message:', error);
      const whatsappUrl = generateWhatsAppLink(whatsappNumber, task.description);
      window.open(whatsappUrl, '_blank');
    }
  };

  const getTaskTypeColor = (type: TaskType) => {
    switch (type) {
      case TaskType.RegularTask: return 'bg-purple-100 text-purple-800';
      case TaskType.PatientTracking: return 'bg-blue-100 text-blue-800';
      case TaskType.AuditTask: return 'bg-green-100 text-green-800';
      case TaskType.PersonalTask: return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTaskTypeLabel = (type: TaskType) => {
    switch (type) {
      case TaskType.RegularTask: return 'Regular Task';
      case TaskType.PatientTracking: return 'Patient Tracking';
      case TaskType.AuditTask: return 'Audit Task';
      case TaskType.PersonalTask: return 'Personal Task';
      default: return type;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'Critical': return 'border-l-red-500 bg-red-50';
      case 'High': return 'border-l-orange-500 bg-orange-50';
      case 'Moderate': return 'border-l-yellow-500 bg-yellow-50';
      case 'Low': return 'border-l-green-500 bg-green-50';
      default: return 'border-l-gray-500 bg-gray-50';
    }
  };

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.New: return 'bg-blue-100 text-blue-800';
      case TaskStatus.Pending: return 'bg-yellow-100 text-yellow-800';
      case TaskStatus.InProgress: return 'bg-orange-100 text-orange-800';
      case TaskStatus.Completed: return 'bg-green-100 text-green-800';
      case TaskStatus.Overdue: return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const renderTaskCard = (task: Task, showCreatedDate = false) => (
    <div
      key={task.id}
      className={clsx(
        'bg-white rounded-lg border-l-4 p-4 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer border border-gray-100',
        getPriorityColor(task.priority)
      )}
      onClick={() => setSelectedTask(task)}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <h4 className="font-semibold text-gray-900 mb-1">{task.title}</h4>
          <p className="text-sm text-gray-600 line-clamp-2">{task.description}</p>
        </div>
        <div className="flex items-center gap-2 ml-3">
          {(task.contactNumber || task.manualWhatsappNumber || task.assignees?.[0]?.whatsappNumber) && (
            <button
              onClick={(e) => handleWhatsAppClick(task, e)}
              className="p-1.5 text-green-600 hover:bg-green-50 rounded-full transition-colors"
              title="Send WhatsApp message"
            >
              <FaWhatsapp className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={clsx('px-2 py-1 text-xs font-medium rounded-full', getTaskTypeColor(task.type))}>
            {getTaskTypeLabel(task.type)}
          </span>
          <span className={clsx('px-2 py-1 text-xs font-medium rounded-full', getStatusColor(task.status))}>
            {task.status}
          </span>
        </div>
        {task.assignees && task.assignees.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">Assigned to:</span>
            <span className="text-xs font-medium text-gray-700">{task.assignees[0]?.name}</span>
          </div>
        )}
      </div>

      <div className="space-y-1">
        {showCreatedDate && (
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <HiCalendar className="w-3 h-3" />
            Created: {new Date(task.createdAt).toLocaleDateString()} at {new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
        {task.dueDate && (
          <div className="text-xs text-orange-600 flex items-center gap-1">
            <HiClock className="w-3 h-3" />
            Due: {new Date(task.dueDate).toLocaleDateString()} at {new Date(task.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );

  const taskCreationButtons = [
    {
      type: TaskType.RegularTask,
      label: 'Regular Task',
      icon: HiPlus,
      color: 'bg-purple-600 hover:bg-purple-700',
      description: 'Standard work tasks'
    },
    {
      type: TaskType.PatientTracking,
      label: 'Patient Tracking',
      icon: HiPlus,
      color: 'bg-blue-600 hover:bg-blue-700',
      description: 'Monitor patient progress'
    },
    {
      type: TaskType.AuditTask,
      label: 'Audit Task',
      icon: HiPlus,
      color: 'bg-green-600 hover:bg-green-700',
      description: 'Quality control checks'
    },
    {
      type: TaskType.PersonalTask,
      label: 'Personal Task',
      icon: HiPlus,
      color: 'bg-gray-600 hover:bg-gray-700',
      description: 'Personal reminders'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToFocus}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <HiArrowLeft className="w-5 h-5" />
            Back to My Focus
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">➕ Task Creation & Management</h1>
            <p className="text-gray-600">Create new tasks and manage existing ones</p>
          </div>
        </div>
      </div>

      {/* Task Creation Section */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Task</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {taskCreationButtons.map((button) => (
            <button
              key={button.type}
              onClick={() => onAddTask(button.type)}
              className={clsx(
                'p-4 rounded-lg text-white transition-all duration-200 hover:scale-105 shadow-sm',
                button.color
              )}
            >
              <div className="flex items-center justify-center mb-2">
                <button.icon className="w-8 h-8" />
              </div>
              <h3 className="font-semibold mb-1">{button.label}</h3>
              <p className="text-xs opacity-90">{button.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Recently Created Tasks */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          🆕 Recently Created (Last 7 days)
        </h2>
        {recentlyCreated.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentlyCreated.map(task => renderTaskCard(task, true))}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="text-gray-400 text-6xl mb-4">📝</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No recent tasks</h3>
            <p className="text-gray-500">Tasks created in the last 7 days will appear here.</p>
          </div>
        )}
      </div>

      {/* All Tasks with Simple Filtering */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6">
          <h2 className="text-lg font-semibold text-gray-900">📊 All Tasks</h2>
          
          {/* Simple Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative">
              <HiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            {/* Type Filter */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as TaskType | 'all')}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Types</option>
              <option value={TaskType.RegularTask}>Regular Tasks</option>
              <option value={TaskType.PatientTracking}>Patient Tracking</option>
              <option value={TaskType.AuditTask}>Audit Tasks</option>
              <option value={TaskType.PersonalTask}>Personal Tasks</option>
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as TaskStatus | 'all')}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Status</option>
              <option value={TaskStatus.New}>New</option>
              <option value={TaskStatus.InProgress}>In Progress</option>
              <option value={TaskStatus.Completed}>Completed</option>
              <option value={TaskStatus.Overdue}>Overdue</option>
            </select>
          </div>
        </div>

        {filteredTasks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTasks.map(task => renderTaskCard(task))}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="text-gray-400 text-6xl mb-4">🔍</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No tasks found</h3>
            <p className="text-gray-500">
              {searchTerm || selectedType !== 'all' 
                ? 'Try adjusting your search or filter criteria.'
                : 'No tasks have been created yet.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskCreationDashboard;
