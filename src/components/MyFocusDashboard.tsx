import React, { useMemo } from 'react';
import { HiClock, HiExclamationCircle, HiClipboardList, HiArrowRight } from 'react-icons/hi';
import { Task, TaskType, TaskStatus } from '../models/task';
import clsx from 'clsx';
import { FaWhatsapp } from 'react-icons/fa';
import { generateWhatsAppMessage } from '../utils/aiUtils';

interface MyFocusDashboardProps {
  currentUserId?: string;
  tasks: Task[];
  personalTasks: Task[];
  onSwitchToCreation: () => void;
  onViewAllTasks: () => void;
  setSelectedTask: (task: Task | null) => void;
}

const SummaryCard = ({ icon: Icon, title, value, color, subtitle, onClick }: any) => (
  <div 
    className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-all duration-200 cursor-pointer hover:border-blue-300 transform hover:scale-105"
    onClick={onClick}
  >
    <div className="flex items-center justify-between">
      <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center text-white shadow-sm`}>
        <Icon className="w-6 h-6" />
      </div>
      <div className="text-right">
        <p className="text-3xl font-bold text-gray-900">{value}</p>
        <p className="text-sm font-medium text-gray-600">{title}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
    </div>
  </div>
);

// Helper function for WhatsApp
const generateWhatsAppLink = (phoneNumber: string, message: string) => {
  const encodedMessage = encodeURIComponent(message);
  const formattedNumber = phoneNumber.replace(/^\+91/, '');
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const baseURL = isMobile ? "https://api.whatsapp.com/send" : "https://web.whatsapp.com/send";
  return `${baseURL}?phone=91${formattedNumber}&text=${encodedMessage}`;
};

const MyFocusDashboard: React.FC<MyFocusDashboardProps> = ({
  currentUserId,
  tasks,
  personalTasks,
  onSwitchToCreation,
  onViewAllTasks,
  setSelectedTask
}) => {
  // Combine all tasks
  const allTasks = useMemo(() => [...tasks, ...personalTasks], [tasks, personalTasks]);

  // Filter tasks assigned to current user
  const myAssignedTasks = useMemo(() => {
    if (!currentUserId) return [];
    return allTasks.filter(task => 
      task.assignees?.some(assignee => assignee.id === currentUserId)
    );
  }, [allTasks, currentUserId]);

  // Calculate task categories
  const taskCategories = useMemo(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);

    const overdue = allTasks.filter(task => {
      if (task.status === TaskStatus.Completed) return false;
      if (!task.dueDate) return false;
      return new Date(task.dueDate) < now;
    });

    const dueToday = allTasks.filter(task => {
      if (task.status === TaskStatus.Completed) return false;
      if (!task.dueDate) return false;
      const dueDate = new Date(task.dueDate);
      return dueDate >= now && dueDate <= tomorrow;
    });

    return {
      overdue,
      dueToday,
      myAssigned: myAssignedTasks
    };
  }, [allTasks, myAssignedTasks]);

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

  const renderTaskCard = (task: Task) => (
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

      <div className="flex items-center justify-between">
        <span className={clsx('px-2 py-1 text-xs font-medium rounded-full', getTaskTypeColor(task.type))}>
          {getTaskTypeLabel(task.type)}
        </span>
        <div className="flex items-center gap-2">
          {task.assignees && task.assignees.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">Assigned to:</span>
              <span className="text-xs font-medium text-gray-700">{task.assignees[0]?.name}</span>
            </div>
          )}
        </div>
      </div>

      {task.dueDate && (
        <div className="text-xs text-orange-600 mt-2 flex items-center gap-1">
          <HiClock className="w-3 h-3" />
          Due: {new Date(task.dueDate).toLocaleDateString()} at {new Date(task.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );

  const renderTaskSection = (tasks: Task[], title: string, emoji: string, emptyMessage: string) => {
    if (tasks.length === 0) {
      return (
        <div className="bg-gray-50 rounded-lg p-6 text-center">
          <div className="text-gray-400 text-4xl mb-2">{emoji}</div>
          <p className="text-gray-500 text-sm">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="text-xl">{emoji}</span>
          {title} ({tasks.length})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map(renderTaskCard)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📊 My Focus</h1>
          <p className="text-gray-600">Your most important tasks at a glance</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onSwitchToCreation}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
          >
            Create Task
            <HiArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={onViewAllTasks}
            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 flex items-center gap-2 transition-colors"
          >
            View All Tasks
            <HiArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SummaryCard
          icon={HiExclamationCircle}
          title="Overdue Tasks"
          value={taskCategories.overdue.length}
          color="bg-red-500"
          subtitle="Need immediate attention"
        />
        <SummaryCard
          icon={HiClock}
          title="Due Today/Tomorrow"
          value={taskCategories.dueToday.length}
          color="bg-orange-500"
          subtitle="Upcoming deadlines"
        />
        <SummaryCard
          icon={HiClipboardList}
          title="My Assigned Tasks"
          value={taskCategories.myAssigned.length}
          color="bg-blue-500"
          subtitle="Tasks assigned to you"
        />
      </div>

      {/* Task Sections */}
      <div className="space-y-8">
        {/* Overdue Tasks */}
        {renderTaskSection(
          taskCategories.overdue,
          "Urgent Tasks",
          "🚨",
          "No overdue tasks - great job!"
        )}

        {/* Due Today/Tomorrow */}
        {renderTaskSection(
          taskCategories.dueToday,
          "Due Soon",
          "⏰",
          "No tasks due today or tomorrow"
        )}

        {/* My Assigned Tasks */}
        {renderTaskSection(
          taskCategories.myAssigned,
          "My Assigned Tasks",
          "📋",
          "No tasks assigned to you yet"
        )}
      </div>
    </div>
  );
};

export default MyFocusDashboard;
