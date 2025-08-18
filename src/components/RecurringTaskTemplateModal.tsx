import React, { useState } from 'react';
import { HiX } from 'react-icons/hi';
import { TaskType, TaskPriority, User, RecurrenceFrequency } from '../models/task';
import { supabase } from '../utils/supabaseClient';

interface RecurringTaskTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  teamMembers: User[];
}

const RecurringTaskTemplateModal: React.FC<RecurringTaskTemplateModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  teamMembers
}) => {
  const [template, setTemplate] = useState({
    title: '',
    description: '',
    patientId: '',
    type: TaskType.QuickAdvisory,
    priority: TaskPriority.Moderate,
    assignee: null as User | null,
    location: '',
    roundType: '',
    followUpType: '',
    advisoryType: '',
    contactNumber: '',
    manualWhatsappNumber: '',
    hoursToComplete: 4,
    recurrenceFrequency: RecurrenceFrequency.Daily,
    startDate: '',
    endDate: '',
    numberOfOccurrences: undefined as number | undefined,
    completionWithinHours: undefined as number | undefined,
    completionWithinDays: undefined as number | undefined
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!template.title || !template.description) {
      alert('Title and Description are mandatory for all recurring task templates.');
      return;
    }

    if (!template.startDate) {
      alert('Start Date is required for recurring task templates.');
      return;
    }

    if (template.endDate && new Date(template.endDate) <= new Date(template.startDate)) {
      alert('End Date must be after Start Date.');
      return;
    }

    if (template.type === TaskType.ClinicalRound && !template.location) {
      alert('Location/Room is mandatory for Clinical Round recurring templates.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Get the current user
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not found');

      // Get the user's record from the users table
      const { data: userRecord, error: userError } = await supabase
        .from('users')
        .select('id, organization_id')
        .eq('auth_id', userData.user.id)
        .single();

      if (userError) throw userError;
      if (!userRecord) throw new Error('User record not found');

      // Insert the recurring task template
      const { error: insertError } = await supabase
        .from('recurring_task_templates')
        .insert([
          {
            organization_id: userRecord.organization_id,
            created_by: userRecord.id,
            assigned_to: template.assignee?.id,
            title: template.title,
            description: template.description,
            type: template.type,
            priority: template.priority,
            recurrence_frequency: template.recurrenceFrequency,
            start_date: new Date(template.startDate).toISOString(),
            end_date: template.endDate ? new Date(template.endDate).toISOString() : null,
            number_of_occurrences: template.numberOfOccurrences,
            completion_within_hours: template.completionWithinHours,
            completion_within_days: template.completionWithinDays,
            patient_id: template.patientId || null,
            location: template.location || null,
            round_type: template.roundType || null,
            follow_up_type: template.followUpType || null,
            advisory_type: template.advisoryType || null,
            contact_number: template.contactNumber || null,
            manual_whatsapp_number: template.manualWhatsappNumber || null,
            is_active: true
          }
        ]);

      if (insertError) throw insertError;

      // Reset form
      setTemplate({
        title: '',
        description: '',
        patientId: '',
        type: TaskType.QuickAdvisory,
        priority: TaskPriority.Moderate,
        assignee: null,
        location: '',
        roundType: '',
        followUpType: '',
        advisoryType: '',
        contactNumber: '',
        manualWhatsappNumber: '',
        hoursToComplete: 4,
        recurrenceFrequency: RecurrenceFrequency.Daily,
        startDate: '',
        endDate: '',
        numberOfOccurrences: undefined,
        completionWithinHours: undefined,
        completionWithinDays: undefined
      });

      onSuccess();
      onClose();

    } catch (error: any) {
      console.error('Error creating recurring task template:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setTemplate({
      title: '',
      description: '',
      patientId: '',
      type: TaskType.QuickAdvisory,
      priority: TaskPriority.Moderate,
      assignee: null,
      location: '',
      roundType: '',
      followUpType: '',
      advisoryType: '',
      contactNumber: '',
      manualWhatsappNumber: '',
      hoursToComplete: 4,
      recurrenceFrequency: RecurrenceFrequency.Daily,
      startDate: '',
      endDate: '',
      numberOfOccurrences: undefined,
      completionWithinHours: undefined,
      completionWithinDays: undefined
    });
    setError(null);
    onClose();
  };

  const renderTypeSpecificFields = () => {
    switch (template.type) {
      case TaskType.ClinicalRound:
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location/Room <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={template.location}
              onChange={(e) => setTemplate({ ...template, location: e.target.value })}
              required
            />
          </div>
        );

      case TaskType.PersonalTask:
        return null;

      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="text-lg font-semibold">Create Recurring Task Template</h3>
          <button onClick={handleClose}>
            <HiX className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-100 text-red-600 p-3 rounded-md">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Task Type
            </label>
            <select
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={template.type}
              onChange={(e) => setTemplate({ ...template, type: e.target.value as TaskType })}
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
              value={template.title}
              onChange={(e) => setTemplate({ ...template, title: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={template.description}
              onChange={(e) => setTemplate({ ...template, description: e.target.value })}
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
              value={template.patientId}
              onChange={(e) => setTemplate({ ...template, patientId: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Priority
            </label>
            <select
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={template.priority}
              onChange={(e) => setTemplate({ ...template, priority: e.target.value as TaskPriority })}
              required
            >
              <option value={TaskPriority.Critical}>Critical</option>
              <option value={TaskPriority.Moderate}>Moderate</option>
              <option value={TaskPriority.LessImportant}>Less Important</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Assignee
            </label>
            <select
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={template.assignee?.id || ''}
              onChange={(e) => {
                const assignee = teamMembers.find(m => m.id === e.target.value) || null;
                setTemplate({ ...template, assignee });
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
              value={template.manualWhatsappNumber}
              onChange={(e) => setTemplate({ ...template, manualWhatsappNumber: e.target.value })}
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
              value={template.contactNumber}
              onChange={(e) => setTemplate({ ...template, contactNumber: e.target.value })}
              placeholder="Enter contact number"
            />
          </div>

          {renderTypeSpecificFields()}

          {/* Recurrence Settings */}
          <div className="border-t pt-4 space-y-4">
            <h4 className="font-medium text-gray-900">Recurrence Settings</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Frequency <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={template.recurrenceFrequency}
                  onChange={(e) => setTemplate({ ...template, recurrenceFrequency: e.target.value as RecurrenceFrequency })}
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
                  value={template.startDate}
                  onChange={(e) => setTemplate({ ...template, startDate: e.target.value })}
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
                  value={template.endDate}
                  onChange={(e) => setTemplate({ ...template, endDate: e.target.value })}
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
                  value={template.numberOfOccurrences || ''}
                  onChange={(e) => setTemplate({ ...template, numberOfOccurrences: e.target.value ? parseInt(e.target.value) : undefined })}
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
                  value={template.completionWithinHours || ''}
                  onChange={(e) => setTemplate({ ...template, completionWithinHours: e.target.value ? parseInt(e.target.value) : undefined })}
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
                  value={template.completionWithinDays || ''}
                  onChange={(e) => setTemplate({ ...template, completionWithinDays: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="e.g., 7"
                />
              </div>
            </div>

            <div className="bg-blue-50 p-3 rounded-md">
              <p className="text-sm text-blue-700">
                <strong>Note:</strong> This template will automatically generate tasks based on your frequency settings. 
                If both hours and days are specified, hours will take precedence for due date calculation.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
            >
              {loading ? 'Creating...' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RecurringTaskTemplateModal;