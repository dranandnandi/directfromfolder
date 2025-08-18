import React, { useState } from 'react';
import { HiPencil, HiCheck, HiPhone } from 'react-icons/hi';
import { FaWhatsapp } from 'react-icons/fa';
import { Task, TaskType, TaskStatus } from '../models/task';
import clsx from 'clsx';
import { generateWhatsAppMessage } from '../utils/aiUtils';

interface TaskListProps {
  tasks: Task[];
}

const TaskList: React.FC<TaskListProps> = ({ tasks }) => {
  const [activeTab, setActiveTab] = useState<'all' | TaskType>('all');

  const filteredTasks = tasks.filter(task => {
    // First check if task is overdue
    const now = new Date();
    const isOverdue = task.status === TaskStatus.Overdue || 
                     (task.dueDate && new Date(task.dueDate) < now);
    
    if (isOverdue) {
      task.status = TaskStatus.Overdue;
    }
    
    if (activeTab === 'all') {
      return true;
    }
    return task.type === activeTab;
  });

  const getTaskCount = (type: 'all' | TaskType) => {
    if (type === 'all') return tasks.length;
    return tasks.filter(task => task.type === type).length;
  };

  const handleWhatsAppClick = async (task: Task) => {
    if (task.assignees?.[0]) {
      const message = await generateWhatsAppMessage(task);
      const encodedMessage = encodeURIComponent(message || task.description);
      window.open(`https://wa.me/${task.assignees[0].whatsappNumber}?text=${encodedMessage}`, '_blank');
    }
  };

  const handlePhoneCall = (phoneNumber: string) => {
    window.open(`tel:${phoneNumber}`, '_blank');
  };

  const TabButton = ({ type, label }: { type: 'all' | TaskType; label: string }) => (
    <button
      onClick={() => setActiveTab(type)}
      className={clsx(
        'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
        activeTab === type
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100'
      )}
    >
      {label} ({getTaskCount(type)})
    </button>
  );

  return (
    <div className="mt-6 bg-white rounded-lg shadow-sm">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Tasks</h2>
          <div className="flex items-center gap-4">
            <button>
              <HiPencil className="w-5 h-5 text-gray-500" />
            </button>
            <button>
              <HiCheck className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Task Type Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          <TabButton type="all" label="All Tasks" />
          <TabButton type={TaskType.QuickAdvisory} label="Regular Task" />
          <TabButton type={TaskType.ClinicalRound} label="Patient Tracking" />
          <TabButton type={TaskType.FollowUp} label="Audit Task" />
        </div>
      </div>

      <div className="p-4">
        <div className="mb-6">
          <table className="w-full">
            <thead className="text-sm text-gray-500">
              <tr>
                <th className="text-left font-medium py-2">Task Name</th>
                <th className="text-left font-medium py-2">Due Date</th>
                <th className="text-left font-medium py-2">Type</th>
                <th className="text-left font-medium py-2">Priority</th>
                <th className="text-left font-medium py-2">Status</th>
                <th className="text-left font-medium py-2">Contact</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map(task => (
                <tr key={task.id} className="border-t">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" className="rounded" />
                      <div>
                        <div>{task.title}</div>
                        <div className="text-sm text-gray-500">{task.description}</div>
                        {task.assignees?.[0] && (
                          <div className="text-sm text-purple-600">
                            {task.type === TaskType.ClinicalRound ? 'Supervisor: ' : 'Assigned to: '}
                            {task.assignees[0].name}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3">
                    <span className={clsx(
                      'text-sm',
                      task.status === 'overdue' ? 'text-red-500' : 'text-gray-500'
                    )}>
                      {task.dueDate?.toLocaleDateString()}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={clsx(
                      'px-2 py-1 rounded text-sm',
                      {
                        'bg-purple-100 text-purple-800': task.type === TaskType.QuickAdvisory,
                        'bg-blue-100 text-blue-800': task.type === TaskType.ClinicalRound,
                        'bg-green-100 text-green-800': task.type === TaskType.FollowUp
                      }
                    )}>
                      {task.type === TaskType.QuickAdvisory && 'Regular Task'}
                      {task.type === TaskType.ClinicalRound && 'Patient Tracking'}
                      {task.type === TaskType.FollowUp && 'Audit Task'}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={clsx(
                      'px-2 py-1 rounded text-sm',
                      {
                        'bg-red-100 text-red-800': task.priority === 'critical',
                        'bg-yellow-100 text-yellow-800': task.priority === 'moderate',
                        'bg-gray-100 text-gray-800': task.priority === 'lessImportant'
                      }
                    )}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={clsx(
                      'px-2 py-1 rounded text-sm',
                      {
                        'bg-gray-100 text-gray-800': task.status === 'new',
                        'bg-blue-100 text-blue-800': task.status === 'inProgress',
                        'bg-green-100 text-green-800': task.status === 'completed',
                        'bg-red-100 text-red-800': task.status === 'overdue'
                      }
                    )}>
                      {task.status}
                    </span>
                  </td>
                  <td className="py-3">
                    {task.assignees?.[0] && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleWhatsAppClick(task)}
                          className="text-green-600 hover:text-green-700 p-1 hover:bg-green-50 rounded"
                          title="Send WhatsApp message"
                        >
                          <FaWhatsapp className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handlePhoneCall(task.assignees[0].whatsappNumber)}
                          className="text-blue-600 hover:text-blue-700 p-1 hover:bg-blue-50 rounded"
                          title="Call assignee"
                        >
                          <HiPhone className="w-5 h-5" />
                        </button>
                        <span className="text-sm text-gray-500">
                          {task.assignees[0].whatsappNumber}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TaskList;