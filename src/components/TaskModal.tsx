import React, { useState, useEffect } from 'react';
import { HiX } from 'react-icons/hi';
import { Task, TaskType, TaskPriority, TaskStatus, User, OrganizationSettings, RecurrenceFrequency } from '../models/task';
import VoiceCommandButton from './VoiceCommandButton';
import { generateTaskFromText } from '../utils/aiUtils';
import TimeSlotPicker from './TimeSlotPicker';
import { combineDateAndTime, extractDateFromISOString, extractTimeFromISOString } from '../utils/timeUtils';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (tasks: Task[]) => void;
  initialTaskType: TaskType | null;
  editingTask: Task | null;
  teamMembers: User[];
  organizationSettings: OrganizationSettings;
}

const TaskModal: React.FC<TaskModalProps> = ({ 
  isOpen, 
  onClose, 
  onSubmit, 
  initialTaskType,
  editingTask,
  teamMembers,
  organizationSettings
}) => {
  const [mainTask, setMainTask] = useState({
    title: '',
    description: '',
    patientId: '',
    type: initialTaskType || TaskType.QuickAdvisory,
    priority: TaskPriority.Moderate,
    taskDate: '',
    taskTime: '',
    location: '',
    roundType: '',
    followUpType: '',
    status: TaskStatus.New,
    advisoryType: '',
    assignee: null as User | null,
    manualWhatsappNumber: '',
    contactNumber: '',
    hoursToComplete: 4,
    isRecurring: false,
    recurrenceFrequency: RecurrenceFrequency.Daily,
    startDate: '',
    endDate: '',
    numberOfOccurrences: undefined as number | undefined,
    completionWithinHours: undefined as number | undefined,
    completionWithinDays: undefined as number | undefined
  });

  const [subTasks, setSubTasks] = useState<{
    id: string;
    title: string;
    description: string;
    assignee: User | null;
  }[]>([
    {
      id: '1',
      title: '',
      description: '',
      assignee: null,
    }
  ]);

  useEffect(() => {
    if (isOpen) {
      if (editingTask) {
        // Extract date and time from existing dueDate
        const taskDate = editingTask.dueDate ? extractDateFromISOString(editingTask.dueDate.toISOString()) : '';
        const taskTime = editingTask.dueDate ? extractTimeFromISOString(editingTask.dueDate.toISOString()) : '';
        
        setMainTask({
          title: editingTask.title,
          description: editingTask.description,
          patientId: editingTask.patientId || '',
          status: editingTask.status,
          type: editingTask.type,
          priority: editingTask.priority,
          taskDate: taskDate,
          taskTime: taskTime,
          location: editingTask.location || '',
          roundType: editingTask.roundType || '',
          followUpType: editingTask.followUpType || '',
          advisoryType: editingTask.advisoryType || '',
          assignee: editingTask.assignees?.[0] || null,
          manualWhatsappNumber: editingTask.manualWhatsappNumber || '',
          contactNumber: editingTask.contactNumber || '',
          hoursToComplete: editingTask.hoursToComplete || 4,
          isRecurring: false,
          recurrenceFrequency: RecurrenceFrequency.Daily,
          startDate: '',
          endDate: '',
          numberOfOccurrences: undefined,
          completionWithinHours: undefined,
          completionWithinDays: undefined
        });
      } else {
        setMainTask({
          title: '',
          description: '',
          patientId: '',
          type: initialTaskType || TaskType.QuickAdvisory,
          priority: TaskPriority.Moderate,
          taskDate: '',
          taskTime: '',
          location: '',
          roundType: '',
          followUpType: '',
          advisoryType: '',
          assignee: null,
          manualWhatsappNumber: '',
          contactNumber: '',
          status: TaskStatus.New,
          hoursToComplete: 4,
          isRecurring: false,
          recurrenceFrequency: RecurrenceFrequency.Daily,
          startDate: '',
          endDate: '',
          numberOfOccurrences: undefined,
          completionWithinHours: undefined,
          completionWithinDays: undefined
        });
        setSubTasks([
          {
            id: '1',
            title: '',
            description: '',
            assignee: null,
          },
        ]);
      }
    }
  }, [isOpen, initialTaskType, editingTask]);

  const handleVoiceCommand = async (text: string) => {
    try {
      const taskData = await generateTaskFromText(text, teamMembers, mainTask.type, organizationSettings);
      
      if ('error' in taskData) {
        console.error('Error processing voice command:', taskData.error);
        return;
      }

      setMainTask(prev => ({
        ...prev,
        title: taskData.title || prev.title,
        description: taskData.description || prev.description,
        type: taskData.type as TaskType || prev.type,
        priority: taskData.priority as TaskPriority || prev.priority,
        patientId: taskData.patientId || prev.patientId,
        location: taskData.location || prev.location,
        roundType: taskData.roundType || prev.roundType,
        followUpType: taskData.followUpType || prev.followUpType,
        advisoryType: taskData.advisoryType || prev.advisoryType,
        assignee: taskData.assignee || prev.assignee,
        hoursToComplete: taskData.hoursToComplete || prev.hoursToComplete
      }));
    } catch (error) {
      console.error('Error processing voice command:', error);
    }
  };

  const handleAddSubTask = () => {
    setSubTasks([...subTasks, {
      id: Date.now().toString(),
      title: '',
      description: '',
      assignee: null,
    }]);
  };

  const handleRemoveSubTask = (id: string) => {
    if (subTasks.length > 1) {
      setSubTasks(subTasks.filter(task => task.id !== id));
    }
  };

  const handleSubTaskChange = (id: string, field: string, value: any) => {
    setSubTasks(subTasks.map(task => 
      task.id === id ? { ...task, [field]: value } : task
    ));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!mainTask.title || !mainTask.description) {
      alert("Title and Description are mandatory for all tasks.");
      return;
    }

    if (mainTask.isRecurring) {
      if (!mainTask.startDate) {
        alert("Start Date is required for recurring tasks.");
        return;
      }

      if (mainTask.endDate && new Date(mainTask.endDate) <= new Date(mainTask.startDate)) {
        alert("End Date must be after Start Date.");
        return;
      }
    }

    if (mainTask.type === TaskType.ClinicalRound && !mainTask.location) {
      alert("Location/Room is mandatory for Clinical Round tasks.");
      return;
    }

    if (mainTask.type === TaskType.FollowUp && !mainTask.taskDate) {
      alert("Due Date is mandatory for Follow-up tasks.");
      return;
    }

    // Combine date and time into a single dueDate
    const dueDate = mainTask.taskDate && mainTask.taskTime 
      ? new Date(combineDateAndTime(mainTask.taskDate, mainTask.taskTime))
      : mainTask.taskDate 
        ? new Date(mainTask.taskDate)
        : undefined;
    const tasks: Task[] = [];
    
    const mainTaskObj: Task = {
      id: editingTask ? editingTask.id : `${Date.now()}`,
      type: mainTask.type,
      title: mainTask.title,
      description: mainTask.description,
      patientId: mainTask.patientId,
      assignees: mainTask.assignee ? [mainTask.assignee] : [],
      priority: mainTask.priority,
      status: mainTask.status,
      createdAt: new Date(),
      dueDate: dueDate,
      location: mainTask.location || undefined,
      roundType: mainTask.roundType || undefined,
      followUpType: mainTask.followUpType || undefined,
      advisoryType: mainTask.advisoryType || undefined,
      manualWhatsappNumber: mainTask.manualWhatsappNumber || undefined,
      contactNumber: mainTask.contactNumber || undefined,
      hoursToComplete: mainTask.type === TaskType.ClinicalRound ? mainTask.hoursToComplete : undefined
    };
    
    tasks.push(mainTaskObj);

    if (mainTask.type === TaskType.ClinicalRound) {
      subTasks.forEach((subTask, index) => {
        if (index > 0) {
          tasks.push({
            ...mainTaskObj,
            id: `${mainTaskObj.id}-${subTask.id}`,
            title: subTask.title,
            description: subTask.description,
            assignees: subTask.assignee ? [subTask.assignee] : []
          });
        }
      });
    }
    
    onSubmit(tasks);
  };

  const renderAssigneeFields = () => (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Assignee
        </label>
        <select
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          value={mainTask.assignee?.id || ''}
          onChange={(e) => {
            const assignee = teamMembers.find(m => m.id === e.target.value) || null;
            setMainTask({ ...mainTask, assignee });
          }}
        >
          <option value="">Select Assignee</option>
          {teamMembers.map(member => (
            <option key={member.id} value={member.id}>
              {member.name} - {member.department} ({member.whatsappNumber})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Manual WhatsApp Number
        </label>
        <input
          type="tel"
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          value={mainTask.manualWhatsappNumber}
          onChange={(e) => setMainTask({ ...mainTask, manualWhatsappNumber: e.target.value })}
          placeholder="Enter WhatsApp number"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Contact Number
        </label>
        <input
          type="tel"
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          value={mainTask.contactNumber}
          onChange={(e) => setMainTask({ ...mainTask, contactNumber: e.target.value })}
          placeholder="Enter contact number"
        />
      </div>
    </>
  );

  const renderTypeSpecificFields = () => {
    switch (mainTask.type) {
      case TaskType.ClinicalRound:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location/Room <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                value={mainTask.location}
                onChange={(e) => setMainTask({ ...mainTask, location: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Complete Within (Hours) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                max="24"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                value={mainTask.hoursToComplete}
                onChange={(e) => setMainTask({ ...mainTask, hoursToComplete: parseInt(e.target.value) || 4 })}
                required
              />
            </div>
          </>
        );

      case TaskType.QuickAdvisory:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Date
              </label>
              <input
                type="date"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                value={mainTask.taskDate}
                onChange={(e) => setMainTask({ ...mainTask, taskDate: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Time
              </label>
              <TimeSlotPicker
                value={mainTask.taskTime}
                onChange={(time) => setMainTask({ ...mainTask, taskTime: time })}
                placeholder="Select time (optional)"
              />
            </div>
          </>
        );

      case TaskType.FollowUp:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                value={mainTask.taskDate}
                onChange={(e) => setMainTask({ ...mainTask, taskDate: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Time <span className="text-red-500">*</span>
              </label>
              <TimeSlotPicker
                value={mainTask.taskTime}
                onChange={(time) => setMainTask({ ...mainTask, taskTime: time })}
                placeholder="Select time"
                required
              />
            </div>
          </>
        );

      case TaskType.PersonalTask:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Date
              </label>
              <input
                type="date"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                value={mainTask.taskDate}
                onChange={(e) => setMainTask({ ...mainTask, taskDate: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Time
              </label>
              <TimeSlotPicker
                value={mainTask.taskTime}
                onChange={(time) => setMainTask({ ...mainTask, taskTime: time })}
                placeholder="Select time (optional)"
              />
            </div>
          </>
        );

      default:
        return null;
    }
  };

  const renderRecurrenceSettings = () => {
    if (!mainTask.isRecurring) return null;

    return (
      <div className="border-t pt-4 space-y-4">
        <h4 className="font-medium text-gray-900">Recurrence Settings</h4>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Frequency <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.recurrenceFrequency}
              onChange={(e) => setMainTask({ ...mainTask, recurrenceFrequency: e.target.value as RecurrenceFrequency })}
              required
            >
              <option value={RecurrenceFrequency.Daily}>Daily</option>
              <option value={RecurrenceFrequency.Weekly}>Weekly</option>
              <option value={RecurrenceFrequency.Monthly}>Monthly</option>
              <option value={RecurrenceFrequency.Quarterly}>Quarterly</option>
              <option value={RecurrenceFrequency.SixMonthly}>6 Monthly</option>
              <option value={RecurrenceFrequency.Yearly}>Yearly</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.startDate}
              onChange={(e) => setMainTask({ ...mainTask, startDate: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Date (Optional)
            </label>
            <input
              type="datetime-local"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.endDate}
              onChange={(e) => setMainTask({ ...mainTask, endDate: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Number of Occurrences (Optional)
            </label>
            <input
              type="number"
              min="1"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.numberOfOccurrences || ''}
              onChange={(e) => setMainTask({ ...mainTask, numberOfOccurrences: e.target.value ? parseInt(e.target.value) : undefined })}
              placeholder="Leave empty for indefinite"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Complete Within Hours (Optional)
            </label>
            <input
              type="number"
              min="1"
              max="168"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.completionWithinHours || ''}
              onChange={(e) => setMainTask({ ...mainTask, completionWithinHours: e.target.value ? parseInt(e.target.value) : undefined })}
              placeholder="e.g., 24"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Complete Within Days (Optional)
            </label>
            <input
              type="number"
              min="1"
              max="365"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.completionWithinDays || ''}
              onChange={(e) => setMainTask({ ...mainTask, completionWithinDays: e.target.value ? parseInt(e.target.value) : undefined })}
              placeholder="e.g., 7"
            />
          </div>
        </div>

        <div className="bg-blue-50 p-3 rounded-md">
          <p className="text-sm text-blue-700">
            <strong>Note:</strong> Recurring tasks will be automatically created based on your frequency settings. 
            If both hours and days are specified, hours will take precedence for due date calculation.
          </p>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">
            {editingTask ? 'Edit Task' : 'Create New Task'}
          </h3>
          <div className="flex items-center gap-2">
            <VoiceCommandButton onVoiceCommand={handleVoiceCommand} />
            <button onClick={onClose}>
              <HiX className="w-6 h-6" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Task Type
            </label>
            <select
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.type}
              onChange={(e) => setMainTask({ ...mainTask, type: e.target.value as TaskType })}
              required
            >
              <option value={TaskType.QuickAdvisory}>Regular Tasks</option>
              <option value={TaskType.ClinicalRound}>Patient Tracking</option>
              <option value={TaskType.FollowUp}>Audit Task</option>
              <option value={TaskType.PersonalTask}>Personal Task</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.title}
              onChange={(e) => setMainTask({ ...mainTask, title: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.description}
              onChange={(e) => setMainTask({ ...mainTask, description: e.target.value })}
              rows={3}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Patient ID
            </label>
            <input
              type="text"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.patientId}
              onChange={(e) => setMainTask({ ...mainTask, patientId: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Priority
            </label>
            <select
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.priority}
              onChange={(e) => setMainTask({ ...mainTask, priority: e.target.value as TaskPriority })}
              required
            >
              <option value={TaskPriority.Critical}>Critical</option>
              <option value={TaskPriority.Moderate}>Moderate</option>
              <option value={TaskPriority.LessImportant}>Less Important</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={mainTask.status}
              onChange={(e) => setMainTask({ ...mainTask, status: e.target.value as TaskStatus })}
            >
              <option value={TaskStatus.New}>New</option>
              <option value={TaskStatus.InProgress}>In Progress</option>
              <option value={TaskStatus.Completed}>Completed</option>
              <option value={TaskStatus.Overdue}>Overdue</option>
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mainTask.isRecurring}
                onChange={(e) => setMainTask({ ...mainTask, isRecurring: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Make this a recurring task</span>
            </label>
          </div>

          {renderAssigneeFields()}
          {renderTypeSpecificFields()}
          {renderRecurrenceSettings()}

          {mainTask.type === TaskType.ClinicalRound && (
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-medium">Sub Tasks</h4>
                <button
                  type="button"
                  onClick={handleAddSubTask}
                  className="text-blue-600 hover:text-blue-700"
                >
                  + Add Sub Task
                </button>
              </div>

              <div className="space-y-4">
                {subTasks.map((subTask, index) => {
                  return (
                    <div key={subTask.id} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <h5 className="font-medium">Sub Task {index + 1}</h5>
                        {index > 0 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSubTask(subTask.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Title
                          </label>
                          <input
                            type="text"
                            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            value={subTask.title}
                            onChange={(e) => handleSubTaskChange(subTask.id, 'title', e.target.value)}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Description
                          </label>
                          <textarea
                            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            value={subTask.description}
                            onChange={(e) => handleSubTaskChange(subTask.id, 'description', e.target.value)}
                            rows={2}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Assignee
                          </label>
                          <select
                            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                            value={subTask.assignee?.id || ''}
                            onChange={(e) => {
                              const assignee = teamMembers.find(m => m.id === e.target.value) || null;
                              handleSubTaskChange(subTask.id, 'assignee', assignee);
                            }}
                          >
                            <option value="">Select Assignee</option>
                            {teamMembers.map(member => (
                              <option key={member.id} value={member.id}>
                                {member.name} - {member.department} ({member.whatsappNumber})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {editingTask ? 'Update Task' : (mainTask.isRecurring ? 'Create Recurring Task' : 'Create Task')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TaskModal;