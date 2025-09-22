import React, { useState } from 'react';
import { Task, TaskType, User } from '../models/task';
import MyFocusDashboard from './MyFocusDashboard';
import TaskCreationDashboard from './TaskCreationDashboard';
import TaskDetailsModal from './TaskDetailsModal';

interface DashboardContainerProps {
  currentUserId?: string;
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
  tasks,
  personalTasks,
  onAddTask,
  onEditTask,
  onTaskUpdate,
  teamMembers
}) => {
  const [currentView, setCurrentView] = useState<DashboardView>('focus');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {currentView === 'focus' && (
            <MyFocusDashboard
              currentUserId={currentUserId}
              tasks={tasks}
              personalTasks={personalTasks}
              onSwitchToCreation={handleSwitchToCreation}
              onViewAllTasks={handleViewAllTasks}
              setSelectedTask={setSelectedTask}
            />
          )}

          {(currentView === 'creation' || currentView === 'all') && (
            <TaskCreationDashboard
              tasks={tasks}
              personalTasks={personalTasks}
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
    </>
  );
};

export default DashboardContainer;
