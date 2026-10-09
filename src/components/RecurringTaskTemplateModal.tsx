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

// Local datetime string (yyyy-MM-ddTHH:mm) for <input type="datetime-local" />
const toLocalInputValue = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const createEmptyTemplate = () => ({
  title: '',
  description: '',
  type: TaskType.RegularTask,
  priority: TaskPriority.Moderate,
  assignee: null as User | null,
  contactNumber: '',
  manualWhatsappNumber: '',
  recurrenceFrequency: RecurrenceFrequency.Daily,
  startDate: toLocalInputValue(new Date()),
  endDate: '',
  numberOfOccurrences: undefined as number | undefined,
  completionWithinHours: undefined as number | undefined,
  completionWithinDays: undefined as number | undefined
});

const RecurringTaskTemplateModal: React.FC<RecurringTaskTemplateModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  teamMembers
}) => {
  const [template, setTemplate] = useState(createEmptyTemplate);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!template.title.trim()) {
      setError('Title is required.');
      return;
    }

    // Start date is optional in the form — default to "start now"
    const startDate = template.startDate ? new Date(template.startDate) : new Date();

    if (template.endDate && new Date(template.endDate) <= startDate) {
      setError('End Date must be after Start Date.');
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
            assigned_to: template.assignee?.id ?? null,
            title: template.title.trim(),
            // description is NOT NULL in the DB — fall back to the title
            description: template.description.trim() || template.title.trim(),
            type: template.type,
            priority: template.priority,
            recurrence_frequency: template.recurrenceFrequency,
            start_date: startDate.toISOString(),
            end_date: template.endDate ? new Date(template.endDate).toISOString() : null,
            number_of_occurrences: template.numberOfOccurrences ?? null,
            completion_within_hours: template.completionWithinHours ?? null,
            completion_within_days: template.completionWithinDays ?? null,
            contact_number: template.contactNumber || null,
            manual_whatsapp_number: template.manualWhatsappNumber || null,
            is_active: true
          }
        ]);

      if (insertError) throw insertError;

      setTemplate(createEmptyTemplate());

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
    setTemplate(createEmptyTemplate());
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="text-lg font-semibold">Create Recurring Task</h3>
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
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={template.title}
              onChange={(e) => setTemplate({ ...template, title: e.target.value })}
              placeholder="e.g., Daily stock check"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={template.description}
              onChange={(e) => setTemplate({ ...template, description: e.target.value })}
              rows={2}
              placeholder="Leave empty to reuse the title"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Task Type
              </label>
              <select
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                value={template.type}
                onChange={(e) => setTemplate({ ...template, type: e.target.value as TaskType })}
              >
                <option value={TaskType.RegularTask}>Regular Task</option>
                <option value={TaskType.AuditTask}>Audit Task</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Priority
              </label>
              <select
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                value={template.priority}
                onChange={(e) => setTemplate({ ...template, priority: e.target.value as TaskPriority })}
              >
                <option value={TaskPriority.Critical}>Critical</option>
                <option value={TaskPriority.Moderate}>Moderate</option>
                <option value={TaskPriority.LessImportant}>Less Important</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Assignee <span className="text-gray-400">(optional)</span>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                WhatsApp Number <span className="text-gray-400">(optional)</span>
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
                Contact Number <span className="text-gray-400">(optional)</span>
              </label>
              <input
                type="tel"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                value={template.contactNumber}
                onChange={(e) => setTemplate({ ...template, contactNumber: e.target.value })}
                placeholder="Enter contact number"
              />
            </div>
          </div>

          {/* Recurrence Settings */}
          <div className="border-t pt-4 space-y-4">
            <h4 className="font-medium text-gray-900">Repeat</h4>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                How often?
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { value: RecurrenceFrequency.Daily, label: 'Every Day' },
                  { value: RecurrenceFrequency.Weekly, label: 'Every Week' },
                  { value: RecurrenceFrequency.Monthly, label: 'Every Month' },
                  { value: RecurrenceFrequency.Quarterly, label: 'Every 3 Months' },
                  { value: RecurrenceFrequency.SixMonthly, label: 'Every 6 Months' },
                  { value: RecurrenceFrequency.Yearly, label: 'Every Year' }
                ].map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTemplate({ ...template, recurrenceFrequency: option.value })}
                    className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                      template.recurrenceFrequency === option.value
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="datetime-local"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={template.startDate}
                  onChange={(e) => setTemplate({ ...template, startDate: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">Defaults to now</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Date <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="datetime-local"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={template.endDate}
                  onChange={(e) => setTemplate({ ...template, endDate: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">Leave empty to repeat forever</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Occurrences <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={template.numberOfOccurrences ?? ''}
                  onChange={(e) => setTemplate({ ...template, numberOfOccurrences: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="Unlimited"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Complete in Hours <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="168"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={template.completionWithinHours ?? ''}
                  onChange={(e) => setTemplate({ ...template, completionWithinHours: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="e.g., 24"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Complete in Days <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={template.completionWithinDays ?? ''}
                  onChange={(e) => setTemplate({ ...template, completionWithinDays: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="e.g., 7"
                />
              </div>
            </div>

            <div className="bg-blue-50 p-3 rounded-md">
              <p className="text-sm text-blue-700">
                <strong>Note:</strong> Only the title and how often it repeats are required — everything else is optional.
                If both hours and days are given, hours take precedence for the due date.
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
              {loading ? 'Creating...' : 'Create Recurring Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RecurringTaskTemplateModal;
