import React, { useState, useEffect, useRef, useMemo } from 'react';
import { HiClipboardList, HiUserGroup, HiCalendar, HiClock, HiPencil, HiPhone, HiPlus, HiFilter, HiChevronDown, HiSearch } from 'react-icons/hi';
import { Task, TaskType, User, TaskStatus } from '../models/task';
import clsx from 'clsx';
import { FaWhatsapp } from 'react-icons/fa';
import { generateWhatsAppMessage } from '../utils/aiUtils'; 
import TaskDetailsModal from './TaskDetailsModal';

interface DashboardProps {
  currentUserId?: string;
  tasks: Task[];
  personalTasks: Task[];
  onAddTask: (type: TaskType) => void;
  onEditTask: (task: Task) => void;
  teamMembers: User[];
  selectedTask: Task | null;
  setSelectedTask: (task: Task | null) => void;
}

type FilterType = 'all' | 'overdue' | 'due-tomorrow' | 'upcoming' | 'completed' | 'regular' | 'sample-tracking' | 'quality-control' | 'personal';

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

// Helper function to generate smart WhatsApp links
const generateWhatsAppLink = (phoneNumber: string, message: string) => {
  const encodedMessage = encodeURIComponent(message);
  const formattedNumber = phoneNumber.replace(/^\+91/, '');
  
  // Detect if user is on mobile device
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const baseURL = isMobile 
    ? "https://api.whatsapp.com/send" 
    : "https://web.whatsapp.com/send";
  
  return `${baseURL}?phone=91${formattedNumber}&text=${encodedMessage}`;
};

const Dashboard: React.FC<DashboardProps> = ({ currentUserId, tasks, personalTasks, onAddTask, onEditTask, teamMembers, selectedTask, setSelectedTask }) => {
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const previousTasksRef = useRef<Task[]>([]);
  const previousPersonalTasksRef = useRef<Task[]>([]);
  
  // Filter tasks assigned to current user
  const myAssignedTasks = React.useMemo(() => {
    if (!currentUserId) return [];
    
    const allTasks = [...tasks, ...personalTasks];
    return allTasks.filter(task => 
      task.assignees?.some(assignee => assignee.id === currentUserId)
    );
  }, [tasks, personalTasks, currentUserId]); 

  // Log only when tasks or personalTasks actually change
  useEffect(() => {
    // Check if tasks array has actually changed
    const tasksChanged = tasks !== previousTasksRef.current;
    const personalTasksChanged = personalTasks !== previousPersonalTasksRef.current;
    
    if (tasksChanged || personalTasksChanged) {
      console.log('Dashboard - All tasks before filtering:', [...tasks, ...personalTasks]);
      console.log('Dashboard - Tasks with assignees:', [...tasks, ...personalTasks].filter(t => t.assignees && t.assignees.length > 0).length);
      console.log('Dashboard - Tasks without assignees:', [...tasks, ...personalTasks].filter(t => !t.assignees || t.assignees.length === 0).length);
      
      // Update refs
      previousTasksRef.current = tasks;
      previousPersonalTasksRef.current = personalTasks;
    }
  }, [tasks, personalTasks]);

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
      alert('Failed to generate WhatsApp message. Please try again.');
    }
  };

  const handlePhoneCall = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const phoneNumber = task.contactNumber || task.manualWhatsappNumber || task.assignees?.[0]?.whatsappNumber;
    if (!phoneNumber) {
      alert('No phone number available for this task.');
      return;
    }

    try {
      window.open(`tel:${phoneNumber}`, '_blank');
    } catch (error) {
      console.error('Error initiating phone call:', error);
      alert('Failed to initiate phone call. Please try again.');
    }
  };

  const handleEditClick = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    onEditTask(task);
  };

  const handleSummaryCardClick = (filterType: FilterType) => {
    setFilterType(filterType);
    setShowFilterDropdown(false);
    
    // Smooth scroll to task section
    setTimeout(() => {
      const taskSection = document.getElementById('task-section');
      if (taskSection) {
        taskSection.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  };

  const groupTasks = (tasks: Task[]) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const groups: Record<string, Task[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      upcoming: [],
      completed: []
    };

    tasks.forEach(task => {
      if (task.status === TaskStatus.Completed) {
        groups.completed.push(task);
        return;
      }

      let dueDate = 'upcoming';
      
      if (task.type === TaskType.ClinicalRound) {
        const createdDate = new Date(task.createdAt);
        const hoursToAdd = task.hoursToComplete || 4;
        const dueTime = new Date(createdDate.getTime() + hoursToAdd * 60 * 60 * 1000);
        
        if (dueTime < today) {
          dueDate = 'overdue';
        } else if (dueTime.getTime() <= today.getTime()) {
          dueDate = 'today';
        } else if (dueTime.getTime() <= tomorrow.getTime()) {
          dueDate = 'tomorrow';
        }
      } else if (task.dueDate) {
        const taskDate = new Date(task.dueDate);
        taskDate.setHours(0, 0, 0, 0);
        
        if (taskDate < today) {
          dueDate = 'overdue';
        } else if (taskDate.getTime() === today.getTime()) {
          dueDate = 'today';
        } else if (taskDate.getTime() === tomorrow.getTime()) {
          dueDate = 'tomorrow';
        }
      }
      
      if (task.status === TaskStatus.Overdue || 
          (task.dueDate && new Date(task.dueDate) < new Date())) {
        dueDate = 'overdue';
      }
      
      groups[dueDate].push(task);
    });

    groups.upcoming.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return groups;
  };

  const getFilteredTasks = () => {
    let allTasks = [...tasks, ...personalTasks];
    
    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      allTasks = allTasks.filter(task =>
        task.title.toLowerCase().includes(searchLower) ||
        task.description.toLowerCase().includes(searchLower) ||
        task.patientId?.toLowerCase().includes(searchLower) ||
        task.assignees?.[0]?.name.toLowerCase().includes(searchLower)
      );
    }
    
    const grouped = groupTasks(allTasks);
    
    // Only log when debugging is needed
    // console.log('Dashboard - Grouped tasks:', grouped);

    switch (filterType) {
      case 'overdue':
        return { overdue: grouped.overdue };
      case 'due-tomorrow':
        return { tomorrow: grouped.tomorrow };
      case 'upcoming':
        return { upcoming: grouped.upcoming };
      case 'completed':
        return { completed: grouped.completed };
      case 'regular':
        return groupTasks(allTasks.filter(t => t.type === TaskType.QuickAdvisory));
      case 'sample-tracking':
        return groupTasks(allTasks.filter(t => t.type === TaskType.ClinicalRound));
      case 'quality-control':
        return groupTasks(allTasks.filter(t => t.type === TaskType.FollowUp));
      case 'personal':
        return groupTasks(allTasks.filter(t => t.type === TaskType.PersonalTask));
      default:
        return grouped;
    }
  }; 

  // Memoize the filtered tasks to prevent unnecessary recalculations
  const filteredTaskGroups = useMemo(() => getFilteredTasks(), [tasks, personalTasks, filterType, searchTerm]);

  const getTaskCounts = () => {
    const allTasks = [...tasks, ...personalTasks];
    const grouped = groupTasks(allTasks);
    
    return {
      total: allTasks.length,
      completed: grouped.completed.length,
      overdue: grouped.overdue.length,
      dueTomorrow: grouped.tomorrow.length,
      upcoming: grouped.upcoming.length + grouped.today.length
    };
  };

  const counts = getTaskCounts();
  
  // Only log when debugging is needed
  // console.log('Dashboard - Final filtered task groups:', filteredTaskGroups);

  const renderTaskCard = (task: Task) => (
    <div 
      key={task.id} 
      className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-all duration-200 cursor-pointer hover:border-blue-300 group" 
      onClick={() => setSelectedTask(task)}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-start justify-between mb-2">
            <h4 className="font-semibold text-gray-900 text-base leading-tight group-hover:text-blue-600 transition-colors">
              {task.title}
            </h4>
            <div className="flex items-center gap-1 ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => handleWhatsAppClick(task, e)}
                className="text-green-600 hover:text-green-700 p-1.5 hover:bg-green-50 rounded-lg transition-colors"
                title="WhatsApp"
              >
                <FaWhatsapp className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => handlePhoneCall(task, e)}
                className="text-blue-600 hover:text-blue-700 p-1.5 hover:bg-blue-50 rounded-lg transition-colors"
                title="Call"
              >
                <HiPhone className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => handleEditClick(task, e)}
                className="text-gray-600 hover:text-gray-700 p-1.5 hover:bg-gray-50 rounded-lg transition-colors"
                title="Edit"
              >
                <HiPencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">{task.description}</p>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={clsx(
                'px-2 py-1 rounded-full text-xs font-medium',
                {
                  'bg-red-100 text-red-700': task.priority === 'critical',
                  'bg-yellow-100 text-yellow-700': task.priority === 'moderate',
                  'bg-gray-100 text-gray-700': task.priority === 'lessImportant'
                }
              )}>
                {task.priority}
              </span>
              <span className={clsx(
                'px-2 py-1 rounded-full text-xs font-medium',
                {
                  'bg-gray-100 text-gray-700': task.status === 'new',
                  'bg-blue-100 text-blue-700': task.status === 'inProgress',
                  'bg-green-100 text-green-700': task.status === 'completed',
                  'bg-red-100 text-red-700': task.status === 'overdue'
                }
              )}>
                {task.status}
              </span>
              <span className={clsx(
                'px-2 py-1 rounded-full text-xs font-medium',
                {
                  'bg-purple-100 text-purple-700': task.type === TaskType.QuickAdvisory,
                  'bg-blue-100 text-blue-700': task.type === TaskType.ClinicalRound,
                  'bg-green-100 text-green-700': task.type === TaskType.FollowUp,
                  'bg-gray-100 text-gray-700': task.type === TaskType.PersonalTask
                }
              )}>
                {task.type === TaskType.QuickAdvisory && 'Regular Task'}
                {task.type === TaskType.ClinicalRound && 'Patient Tracking'}
                {task.type === TaskType.FollowUp && 'Audit Task'}
                {task.type === TaskType.PersonalTask && 'Personal'}
              </span>
            </div>
            
            {task.assignees?.[0] && (
              <div className="text-xs text-gray-500 font-medium">
                👤 {task.assignees[0].name}
              </div>
            )}
            {!task.assignees?.[0] && (
              <div className="text-xs text-gray-500 font-medium">
                👤 Unassigned
              </div>
            )}
          </div>

          {(task.type === TaskType.ClinicalRound && task.hoursToComplete) && (
            <div className="text-xs text-orange-600 mt-2 flex items-center gap-1">
              <HiClock className="w-3 h-3" />
              Complete within: {task.hoursToComplete} hours
            </div>
          )}
          {(task.type === TaskType.QuickAdvisory || task.type === TaskType.FollowUp) && task.dueDate && (
            <div className="text-xs text-orange-600 mt-2 flex items-center gap-1">
              <HiCalendar className="w-3 h-3" />
              Due: {new Date(task.dueDate).toLocaleDateString()} at {new Date(task.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderTaskGroup = (tasks: Task[], title: string, emoji: string, color: string) => {
    if (tasks.length === 0) return null;

    return (
      <div className="mb-8">
        <div className={`flex items-center gap-3 mb-4 pb-2 border-b-2 ${color}`}>
          <span className="text-2xl">{emoji}</span>
          <h3 className="text-lg font-semibold text-gray-900">
            {title} ({tasks.length})
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map(renderTaskCard)}
        </div>
      </div>
    );
  };

  const filterOptions = [
    { value: 'all', label: 'All Tasks', count: counts.total },
    { value: 'overdue', label: 'Overdue', count: counts.overdue },
    { value: 'due-tomorrow', label: 'Due Tomorrow', count: counts.dueTomorrow },
    { value: 'upcoming', label: 'Upcoming', count: counts.upcoming },
    { value: 'completed', label: 'Completed', count: counts.completed },
    { value: 'regular', label: 'Regular Tasks', count: tasks.filter(t => t.type === TaskType.QuickAdvisory).length },
    { value: 'sample-tracking', label: 'Patient Tracking', count: tasks.filter(t => t.type === TaskType.ClinicalRound).length },
    { value: 'quality-control', label: 'Audit Task', count: tasks.filter(t => t.type === TaskType.FollowUp).length },
    { value: 'personal', label: 'Personal Tasks', count: personalTasks.length }
  ];

  const currentFilter = filterOptions.find(f => f.value === filterType);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard 
          icon={HiClipboardList}
          title="Total Tasks"
          value={counts.total}
          color="bg-gradient-to-br from-blue-500 to-blue-600"
          onClick={() => handleSummaryCardClick('all')}
        />
        <SummaryCard 
          icon={HiUserGroup}
          title="Completed"
          value={counts.completed}
          color="bg-gradient-to-br from-green-500 to-green-600"
          subtitle={`${counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0}% done`}
          onClick={() => handleSummaryCardClick('completed')}
        />
        <SummaryCard 
          icon={HiCalendar}
          title="Overdue"
          value={counts.overdue}
          color="bg-gradient-to-br from-red-500 to-red-600"
          onClick={() => handleSummaryCardClick('overdue')}
        />
        <SummaryCard 
          icon={HiClock}
          title="Due Tomorrow"
          value={counts.dueTomorrow}
          color="bg-gradient-to-br from-orange-500 to-orange-600"
          onClick={() => handleSummaryCardClick('due-tomorrow')}
        />
        <SummaryCard 
          icon={HiClipboardList}
          title="Upcoming"
          value={counts.upcoming}
          color="bg-gradient-to-br from-purple-500 to-purple-600"
          onClick={() => handleSummaryCardClick('upcoming')}
        />
      </div>

      {/* My Assigned Tasks Section */}
      {currentUserId && (
        <div className="bg-white shadow-sm rounded-xl border border-gray-200 mb-6">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">My Assigned Tasks</h2>
          </div>
          
          <div className="p-6">
            {myAssignedTasks.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {myAssignedTasks.map(task => renderTaskCard(task))}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="text-gray-400 text-6xl mb-4">📋</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No tasks assigned to you</h3>
                <p className="text-gray-500">
                  When tasks are assigned to you, they will appear here for quick access.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Task Management Section */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200" id="task-section">
        {/* Sticky Header with Add Task Buttons and Filter */}
        <div className="sticky top-0 z-10 bg-white p-6 border-b border-gray-200 rounded-t-xl">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              <button 
                onClick={() => onAddTask(TaskType.QuickAdvisory)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors shadow-sm"
              >
                <HiPlus className="w-4 h-4" />
                Add Regular Task
              </button>
              <button 
                onClick={() => onAddTask(TaskType.ClinicalRound)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2 transition-colors shadow-sm"
              >
                <HiPlus className="w-4 h-4" />
                Patient Tracking
              </button>
              <button 
                onClick={() => onAddTask(TaskType.FollowUp)}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 transition-colors shadow-sm"
              >
                <HiPlus className="w-4 h-4" />
                Audit Task
              </button>
              <button
                onClick={() => onAddTask(TaskType.PersonalTask)}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 flex items-center gap-2 transition-colors shadow-sm"
              >
                <HiPlus className="w-4 h-4" />
                Personal Task
              </button>
            </div>

            <div className="flex items-center gap-3">
              {/* Search Bar */}
              <div className="relative">
                <HiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-blue-500 text-sm w-64"
                />
              </div>

              {/* Filter Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <HiFilter className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {currentFilter?.label} ({currentFilter?.count})
                  </span>
                  <HiChevronDown className="w-4 h-4" />
                </button>

                {showFilterDropdown && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
                    <div className="py-2">
                      {filterOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setFilterType(option.value as FilterType);
                            setShowFilterDropdown(false);
                          }}
                          className={clsx(
                            'w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center justify-between transition-colors',
                            filterType === option.value && 'bg-blue-50 text-blue-700'
                          )}
                        >
                          <span>{option.label}</span>
                          <span className="text-gray-500">({option.count})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Task Groups */}
        <div className="p-6">
            {Object.entries(filteredTaskGroups).map(([groupKey, groupTasks]) => {
            const groupConfig = {
              overdue: { title: 'Overdue Tasks', emoji: '🔴', color: 'border-red-500' },
              today: { title: 'Due Today', emoji: '🟠', color: 'border-orange-500' },
              tomorrow: { title: 'Due Tomorrow', emoji: '🟡', color: 'border-yellow-500' },
              upcoming: { title: 'Upcoming Tasks', emoji: '🔵', color: 'border-blue-500' },
              completed: { title: 'Completed Tasks', emoji: '🟢', color: 'border-green-500' }
            };

            const config = groupConfig[groupKey as keyof typeof groupConfig];
            if (!config || groupTasks.length === 0) return null;

            return renderTaskGroup(groupTasks, config.title, config.emoji, config.color);
          })}

          {Object.values(filteredTaskGroups).every(group => group.length === 0) && (
            <div className="text-center py-12">
              <div className="text-gray-400 text-6xl mb-4">📋</div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No tasks found</h3>
              <p className="text-gray-500">
                {searchTerm 
                  ? `No tasks match your search: "${searchTerm}"`
                  : filterType === 'all' 
                    ? 'Create your first task using the buttons above'
                    : `No tasks match the current filter: ${currentFilter?.label}`
                }
              </p>
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="mt-3 text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  Clear search
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Task Details Modal */}
      {selectedTask && (
        <TaskDetailsModal
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          task={selectedTask}
          onEditTask={onEditTask}
          teamMembers={teamMembers}
        />
      )}
    </div>
  );
};

export default Dashboard;