import React, { useState } from 'react';
import { Task, TaskType, User } from '../models/task';
import MyFocusDashboard from './MyFocusDashboard';
import TaskCreationDashboard from './TaskCreationDashboard';
import TaskDetailsModal from './TaskDetailsModal';
import PersonalDashboardOverview, { usePersonalDashboard } from './PersonalDashboardOverview';

interface DashboardContainerProps {
  currentUserId?: string;
  userRole?: string;
  initialView?: DashboardView;
  tasks: Task[];
  personalTasks: Task[];
  onAddTask: (type: TaskType) => void;
  onEditTask: (task: Task) => void;
  onTaskUpdate?: () => void;
  teamMembers: User[];
}

type DashboardView = 'focus' | 'creation' | 'all';

const DashboardContainer: React.FC<DashboardContainerProps> = ({
  currentUserId,
  userRole = 'user',
  initialView = 'focus',
  tasks,
  personalTasks,
  onAddTask,
  onEditTask,
  onTaskUpdate,
  teamMembers
}) => {
  const [currentView, setCurrentView] = useState<DashboardView>(initialView);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const personalOverview = usePersonalDashboard(currentUserId);

  const handleSwitchToCreation = () => {
    setCurrentView('creation');
  };

  const handleViewAllTasks = () => {
    setCurrentView('all');
  };

  const handleBackToFocus = () => {
    setCurrentView('focus');
  };

  return (
    <>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto py-2 sm:px-2">
          {currentView === 'focus' && <div className="space-y-8">
            <PersonalDashboardOverview {...personalOverview} />
            {personalOverview.data && (
              <MyFocusDashboard
                currentUserId={personalOverview.data.employeeId}
                tasks={tasks}
                personalTasks={personalTasks}
                onSwitchToCreation={handleSwitchToCreation}
                onViewAllTasks={handleViewAllTasks}
                setSelectedTask={setSelectedTask}
              />
            )}
          </div>}

          {(currentView === 'creation' || currentView === 'all') && (
            <TaskCreationDashboard
              tasks={currentView === 'all' && !['admin', 'superadmin'].includes(userRole) ? tasks.filter(task => task.assignees.some(user => user.id === personalOverview.data?.employeeId)) : tasks}
              personalTasks={currentView === 'all' && !['admin', 'superadmin'].includes(userRole) ? personalTasks.filter(task => task.assignees.some(user => user.id === personalOverview.data?.employeeId)) : personalTasks}
              onAddTask={onAddTask}
              onBackToFocus={handleBackToFocus}
              setSelectedTask={setSelectedTask}
            />
          )}
        </div>
      </div>

      {/* Task Details Modal */}
      {selectedTask && (
        <TaskDetailsModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onEditTask={() => {
            onEditTask(selectedTask);
            setSelectedTask(null);
          }}
          onTaskUpdate={onTaskUpdate}
          teamMembers={teamMembers}
        />
      )}

      {/* Mobile FAB for Add Task */}
      <button
        onClick={() => onAddTask(TaskType.RegularTask)}
        className="lg:hidden fixed bottom-20 right-4 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 active:bg-blue-800 transition-colors z-40"
        aria-label="Add Task"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </>
  );
};

export default DashboardContainer;
