import React, { useState, useEffect } from 'react';
import { HiX, HiChevronDown, HiChevronUp } from 'react-icons/hi';
import { Task, TaskType, TaskPriority, TaskStatus, User, OrganizationSettings, RecurrenceFrequency } from '../models/task';
import VoiceCommandButton from './VoiceCommandButton';
import { generateTaskFromText } from '../utils/aiUtils';
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
  // State for form sections visibility
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  
  // Main task state
  const [mainTask, setMainTask] = useState({
    title: '',
    description: '',
    assignee: null as User | null,
    type: initialTaskType || TaskType.RegularTask,
    priority: TaskPriority.Moderate,
    taskDate: '',
    taskTime: '',
    status: TaskStatus.New,
    
    // Task-specific fields
    patientId: '',
    location: '',
    roundType: '',
    followUpType: '',
    advisoryType: '',
    manualWhatsappNumber: '',
    contactNumber: '',
    
    // Advanced options
    hoursToComplete: 4,
    isRecurring: false,
    recurrenceFrequency: RecurrenceFrequency.Daily,
    recurringStartDate: '',
    recurringEndDate: '',
    numberOfOccurrences: undefined as number | undefined,
    completionWithinHours: undefined as number | undefined,
    completionWithinDays: undefined as number | undefined
  });

  useEffect(() => {
    if (editingTask) {
      setMainTask({
        title: editingTask.title,
        description: editingTask.description,
        assignee: editingTask.assignees?.[0] || null,
        type: editingTask.type,
        priority: editingTask.priority,
        taskDate: extractDateFromISOString(editingTask.dueDate?.toISOString() || ''),
        taskTime: extractTimeFromISOString(editingTask.dueDate?.toISOString() || ''),
        status: editingTask.status,
        patientId: editingTask.patientId || '',
        location: editingTask.location || '',
        roundType: editingTask.roundType || '',
        followUpType: editingTask.followUpType || '',
        advisoryType: editingTask.advisoryType || '',
        manualWhatsappNumber: editingTask.manualWhatsappNumber || '',
        contactNumber: editingTask.contactNumber || '',
        hoursToComplete: editingTask.hoursToComplete || 4,
        isRecurring: editingTask.isRecurring || false,
        recurrenceFrequency: RecurrenceFrequency.Daily,
        recurringStartDate: '',
        recurringEndDate: '',
        numberOfOccurrences: undefined,
        completionWithinHours: undefined,
        completionWithinDays: undefined
      });
    } else {
      // Reset form for new task
      setMainTask({
        title: '',
        description: '',
        assignee: null,
        type: initialTaskType || TaskType.RegularTask,
        priority: TaskPriority.Moderate,
        taskDate: '',
        taskTime: '',
        status: TaskStatus.New,
        patientId: '',
        location: '',
        roundType: '',
        followUpType: '',
        advisoryType: '',
        manualWhatsappNumber: '',
        contactNumber: '',
        hoursToComplete: 4,
        isRecurring: false,
        recurrenceFrequency: RecurrenceFrequency.Daily,
        recurringStartDate: '',
        recurringEndDate: '',
        numberOfOccurrences: undefined,
        completionWithinHours: undefined,
        completionWithinDays: undefined
      });
    }
  }, [editingTask, initialTaskType]);

  const handleVoiceCommand = async (transcript: string) => {
    try {
      // Enhanced context with team member information for AI matching
      const enhancedContext = {
        availableTeamMembers: teamMembers.map(member => ({ 
          name: member.name, 
          role: member.role,
          department: member.department 
        })),
        organizationName: organizationSettings.name
      };

      const taskData = await generateTaskFromText(transcript, teamMembers, mainTask.type, organizationSettings, enhancedContext);
      
      if (taskData) {
        // Enhanced assignee matching - soft name matching
        let matchedAssignee = null;
        if (taskData.assigneeName) {
          const assigneeName = taskData.assigneeName.toLowerCase();
          
          // Try exact name match first
          matchedAssignee = teamMembers.find(member => 
            member.name.toLowerCase() === assigneeName
          );
          
          // If no exact match, try partial name match
          if (!matchedAssignee) {
            matchedAssignee = teamMembers.find(member => 
              member.name.toLowerCase().includes(assigneeName) ||
              assigneeName.includes(member.name.toLowerCase())
            );
          }
          
          // If still no match, try role-based matching
          if (!matchedAssignee) {
            matchedAssignee = teamMembers.find(member => 
              member.role.toLowerCase().includes(assigneeName) ||
              assigneeName.includes(member.role.toLowerCase())
            );
          }
        }

        setMainTask(prev => ({
          ...prev,
          title: taskData.title || prev.title,
          description: taskData.description || prev.description,
          type: taskData.type || prev.type,
          priority: taskData.priority || prev.priority,
          taskDate: taskData.taskDate || prev.taskDate,
          taskTime: taskData.taskTime || prev.taskTime,
          location: taskData.location || prev.location,
          patientId: taskData.patientId || prev.patientId,
          // Enhanced assignee assignment
          assignee: matchedAssignee || prev.assignee,
          // Task-specific fields
          roundType: taskData.roundType || prev.roundType,
          followUpType: taskData.followUpType || prev.followUpType,
          advisoryType: taskData.advisoryType || prev.advisoryType,
          contactNumber: taskData.contactNumber || prev.contactNumber,
          manualWhatsappNumber: taskData.whatsappNumber || prev.manualWhatsappNumber
        }));
      }
    } catch (error) {
      console.error('Error processing voice command:', error);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!mainTask.title.trim() || !mainTask.description.trim()) {
      alert('Please fill in required fields (Title and Description)');
      return;
    }

    const generateTasks = (): Task[] => {
      const baseTask: Task = {
        id: editingTask?.id || `task-${Date.now()}`,
        title: mainTask.title,
        description: mainTask.description,
        type: mainTask.type,
        priority: mainTask.priority,
        status: mainTask.status,
        assignees: mainTask.assignee ? [mainTask.assignee] : [],
        dueDate: combineDateAndTime(mainTask.taskDate, mainTask.taskTime) ? new Date(combineDateAndTime(mainTask.taskDate, mainTask.taskTime)!) : undefined,
        createdAt: editingTask?.createdAt || new Date(),
        hoursToComplete: mainTask.hoursToComplete,
        completedAt: editingTask?.completedAt,
        isRecurring: mainTask.isRecurring,
        
        // Task-specific fields - only include for relevant task types
        patientId: (mainTask.type === TaskType.PatientTracking) ? mainTask.patientId : undefined,
        location: mainTask.location || undefined,
        roundType: mainTask.type === TaskType.AuditTask ? mainTask.roundType : undefined,
        followUpType: mainTask.type === TaskType.PatientTracking ? mainTask.followUpType : undefined,
        advisoryType: mainTask.type === TaskType.RegularTask ? mainTask.advisoryType : undefined,
        manualWhatsappNumber: mainTask.manualWhatsappNumber || undefined,
        contactNumber: mainTask.contactNumber || undefined,
      };

      if (!mainTask.isRecurring) {
        return [baseTask];
      }

      // For recurring tasks, just return the base task
      // The recurring logic would need to be handled by the backend
      return [baseTask];
    };

    const tasks = generateTasks();
    onSubmit(tasks);
    onClose();
  };

  const renderTaskSpecificFields = () => {
    switch (mainTask.type) {
      case TaskType.PatientTracking:
        return (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Patient ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={mainTask.patientId}
                  onChange={(e) => setMainTask({ ...mainTask, patientId: e.target.value })}
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                  placeholder="Enter patient ID"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={mainTask.location}
                  onChange={(e) => setMainTask({ ...mainTask, location: e.target.value })}
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                  placeholder="Ward/Room number"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Round Type
              </label>
              <select
                value={mainTask.roundType}
                onChange={(e) => setMainTask({ ...mainTask, roundType: e.target.value })}
                className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
              >
                <option value="">Select round type</option>
                <option value="morning">Morning Round</option>
                <option value="evening">Evening Round</option>
                <option value="emergency">Emergency Round</option>
                <option value="consultation">Consultation</option>
              </select>
            </div>
          </>
        );

      case TaskType.AuditTask:
        return (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Audit Category <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={mainTask.patientId}
                  onChange={(e) => setMainTask({ ...mainTask, patientId: e.target.value })}
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                  placeholder="Enter audit category"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Follow-up Type
                </label>
                <select
                  value={mainTask.followUpType}
                  onChange={(e) => setMainTask({ ...mainTask, followUpType: e.target.value })}
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                >
                  <option value="">Select follow-up type</option>
                  <option value="post-surgery">Post Surgery</option>
                  <option value="medication-review">Medication Review</option>
                  <option value="progress-check">Progress Check</option>
                  <option value="test-results">Test Results</option>
                </select>
              </div>
            </div>
          </>
        );

      case TaskType.RegularTask:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Task Category
              </label>
              <select
                value={mainTask.advisoryType}
                onChange={(e) => setMainTask({ ...mainTask, advisoryType: e.target.value })}
                className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
              >
                <option value="">Select task category</option>
                <option value="medication">Medication Related</option>
                <option value="lifestyle">Lifestyle Related</option>
                <option value="diet">Diet Related</option>
                <option value="exercise">Exercise Related</option>
                <option value="general">General Task</option>
                <option value="administrative">Administrative</option>
                <option value="communication">Communication</option>
              </select>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Number
                </label>
                <input
                  type="tel"
                  value={mainTask.contactNumber}
                  onChange={(e) => setMainTask({ ...mainTask, contactNumber: e.target.value })}
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                  placeholder="Enter contact number"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  WhatsApp Number
                </label>
                <input
                  type="tel"
                  value={mainTask.manualWhatsappNumber}
                  onChange={(e) => setMainTask({ ...mainTask, manualWhatsappNumber: e.target.value })}
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                  placeholder="Enter WhatsApp number"
                />
              </div>
            </div>
          </>
        );

      case TaskType.PersonalTask:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location
              </label>
              <input
                type="text"
                value={mainTask.location}
                onChange={(e) => setMainTask({ ...mainTask, location: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Enter location (optional)"
              />
            </div>
          </>
        );

      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center p-4 sm:p-6 border-b border-gray-200">
          <div className="flex items-center justify-between sm:justify-start gap-3 mb-2 sm:mb-0">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
              {editingTask ? 'Edit Task' : 'Create New Task'}
            </h2>
            <div className="sm:ml-3">
              <VoiceCommandButton onVoiceCommand={handleVoiceCommand} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 sm:relative sm:top-0 sm:right-0 text-gray-400 hover:text-gray-600 p-2 sm:p-0"
          >
            <HiX className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Phase 1: Basic Information */}
          <div className="space-y-3 sm:space-y-4">
            <h3 className="text-base sm:text-lg font-medium text-gray-900 border-b pb-2">Basic Information</h3>
            
            {/* Task Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Task Type <span className="text-red-500">*</span>
              </label>
              <select
                value={mainTask.type}
                onChange={(e) => setMainTask({ ...mainTask, type: e.target.value as TaskType })}
                className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                required
              >
                <option value={TaskType.RegularTask}>Add Regular Task</option>
                <option value={TaskType.PatientTracking}>Patient Tracking</option>
                <option value={TaskType.AuditTask}>Audit Task</option>
                <option value={TaskType.PersonalTask}>Personal Task</option>
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Task Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={mainTask.title}
                onChange={(e) => setMainTask({ ...mainTask, title: e.target.value })}
                className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                placeholder="Enter task title"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={mainTask.description}
                onChange={(e) => setMainTask({ ...mainTask, description: e.target.value })}
                className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base resize-none"
                rows={4}
                placeholder="Enter task description"
                required
              />
            </div>

            {/* Assignee */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assign To
              </label>
              <select
                value={mainTask.assignee?.id || ''}
                onChange={(e) => {
                  const selectedUser = teamMembers.find(user => user.id === e.target.value);
                  setMainTask({ ...mainTask, assignee: selectedUser || null });
                }}
                className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
              >
                <option value="">Select team member</option>
                {teamMembers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.role})
                  </option>
                ))}
              </select>
            </div>

            {/* Priority and Date/Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority <span className="text-red-500">*</span>
                </label>
                <select
                  value={mainTask.priority}
                  onChange={(e) => setMainTask({ ...mainTask, priority: e.target.value as TaskPriority })}
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                  required
                >
                  <option value={TaskPriority.LessImportant}>Low</option>
                  <option value={TaskPriority.Moderate}>Moderate</option>
                  <option value={TaskPriority.Critical}>Critical</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Due Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={mainTask.taskDate}
                  onChange={(e) => setMainTask({ ...mainTask, taskDate: e.target.value })}
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Due Time
                </label>
                <input
                  type="time"
                  value={mainTask.taskTime}
                  onChange={(e) => setMainTask({ ...mainTask, taskTime: e.target.value })}
                  className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-base"
                />
              </div>
            </div>
          </div>

          {/* Phase 2: Task-specific Fields */}
          {renderTaskSpecificFields() && (
            <div className="space-y-3 sm:space-y-4">
              <h3 className="text-base sm:text-lg font-medium text-gray-900 border-b pb-2">Task Details</h3>
              {renderTaskSpecificFields()}
            </div>
          )}

          {/* Phase 3: Advanced Options (Collapsible) */}
          <div className="space-y-3 sm:space-y-4">
            <button
              type="button"
              onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
              className="flex items-center justify-between w-full text-base sm:text-lg font-medium text-gray-900 border-b pb-2 py-2 sm:py-0"
            >
              <span>Advanced Options</span>
              {showAdvancedOptions ? (
                <HiChevronUp className="w-5 h-5" />
              ) : (
                <HiChevronDown className="w-5 h-5" />
              )}
            </button>

            {showAdvancedOptions && (
              <div className="space-y-3 sm:space-y-4 bg-gray-50 p-3 sm:p-4 rounded-lg">
                {/* Hours to Complete */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hours to Complete
                  </label>
                  <input
                    type="number"
                    value={mainTask.hoursToComplete}
                    onChange={(e) => setMainTask({ ...mainTask, hoursToComplete: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                    min="1"
                    max="24"
                  />
                </div>

                {/* Recurring Task Options */}
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={mainTask.isRecurring}
                      onChange={(e) => setMainTask({ ...mainTask, isRecurring: e.target.checked })}
                      className="mr-2"
                    />
                    <span className="text-sm font-medium text-gray-700">Recurring Task</span>
                  </label>
                </div>

                {mainTask.isRecurring && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Frequency
                      </label>
                      <select
                        value={mainTask.recurrenceFrequency}
                        onChange={(e) => setMainTask({ ...mainTask, recurrenceFrequency: e.target.value as RecurrenceFrequency })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value={RecurrenceFrequency.Daily}>Daily</option>
                        <option value={RecurrenceFrequency.Weekly}>Weekly</option>
                        <option value={RecurrenceFrequency.Monthly}>Monthly</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Number of Occurrences
                      </label>
                      <input
                        type="number"
                        value={mainTask.numberOfOccurrences || ''}
                        onChange={(e) => setMainTask({ ...mainTask, numberOfOccurrences: e.target.value ? parseInt(e.target.value) : undefined })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                        min="1"
                        placeholder="Leave empty for indefinite"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={mainTask.recurringStartDate}
                        onChange={(e) => setMainTask({ ...mainTask, recurringStartDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        End Date
                      </label>
                      <input
                        type="date"
                        value={mainTask.recurringEndDate}
                        onChange={(e) => setMainTask({ ...mainTask, recurringEndDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}

                {/* Completion Time Constraints */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Complete Within Hours
                    </label>
                    <input
                      type="number"
                      value={mainTask.completionWithinHours || ''}
                      onChange={(e) => setMainTask({ ...mainTask, completionWithinHours: e.target.value ? parseInt(e.target.value) : undefined })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                      min="1"
                      placeholder="Optional"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Complete Within Days
                    </label>
                    <input
                      type="number"
                      value={mainTask.completionWithinDays || ''}
                      onChange={(e) => setMainTask({ ...mainTask, completionWithinDays: e.target.value ? parseInt(e.target.value) : undefined })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                      min="1"
                      placeholder="Optional"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Submit Buttons */}
          <div className="flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3 pt-4 sm:pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-6 py-3 sm:py-2 text-sm font-medium text-gray-700 bg-gray-200 border border-gray-300 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 order-2 sm:order-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-full sm:w-auto px-6 py-3 sm:py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 order-1 sm:order-2"
            >
              {editingTask ? 'Update Task' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TaskModal;
