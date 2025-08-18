import React, { useState, useEffect } from 'react';
import { HiTrash, HiPlay, HiPause, HiPlus } from 'react-icons/hi';
import { RecurringTaskTemplate, RecurrenceFrequency, TaskType, TaskPriority, User } from '../models/task';
import { supabase } from '../utils/supabaseClient';
import clsx from 'clsx';
import RecurringTaskTemplateModal from './RecurringTaskTemplateModal';
import { OrganizationSettings } from '../models/task';

interface RecurringTasksManagerProps {
  teamMembers?: User[];
  organizationSettings: OrganizationSettings;
}

const RecurringTasksManager: React.FC<RecurringTasksManagerProps> = ({ 
  teamMembers = []
}) => {
  const [templates, setTemplates] = useState<RecurringTaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchRecurringTemplates();
  }, []);

  const fetchRecurringTemplates = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: userData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('auth_id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!userData?.organization_id) {
        throw new Error('Organization not found');
      }

      const { data, error } = await supabase
        .from('recurring_task_templates')
        .select(`
          *,
          created_by_user:users!recurring_task_templates_created_by_fkey (
            id,
            name
          ),
          assigned_to_user:users!recurring_task_templates_assigned_to_fkey (
            id,
            name
          )
        `)
        .eq('organization_id', userData.organization_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedTemplates: RecurringTaskTemplate[] = (data || []).map(template => ({
        id: template.id,
        organizationId: template.organization_id,
        createdBy: template.created_by,
        assignedTo: template.assigned_to,
        title: template.title,
        description: template.description,
        type: template.type,
        priority: template.priority,
        recurrenceFrequency: template.recurrence_frequency,
        startDate: new Date(template.start_date),
        endDate: template.end_date ? new Date(template.end_date) : undefined,
        numberOfOccurrences: template.number_of_occurrences,
        completionWithinHours: template.completion_within_hours,
        completionWithinDays: template.completion_within_days,
        lastGeneratedDate: template.last_generated_date ? new Date(template.last_generated_date) : undefined,
        isActive: template.is_active,
        patientId: template.patient_id,
        location: template.location,
        roundType: template.round_type,
        followUpType: template.follow_up_type,
        advisoryType: template.advisory_type,
        contactNumber: template.contact_number,
        manualWhatsappNumber: template.manual_whatsapp_number,
        createdAt: new Date(template.created_at),
        updatedAt: new Date(template.updated_at)
      }));

      setTemplates(formattedTemplates);
    } catch (error: any) {
      console.error('Error fetching recurring templates:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (templateId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('recurring_task_templates')
        .update({ is_active: !isActive, updated_at: new Date().toISOString() })
        .eq('id', templateId);

      if (error) throw error;

      await fetchRecurringTemplates();
    } catch (error: any) {
      console.error('Error toggling template status:', error);
      alert('Failed to update template status. Please try again.');
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this recurring task template? This action cannot be undone.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('recurring_task_templates')
        .delete()
        .eq('id', templateId);

      if (error) throw error;

      await fetchRecurringTemplates();
    } catch (error: any) {
      console.error('Error deleting template:', error);
      alert('Failed to delete template. Please try again.');
    }
  };

  const getFrequencyLabel = (frequency: RecurrenceFrequency) => {
    switch (frequency) {
      case RecurrenceFrequency.Daily: return 'Daily';
      case RecurrenceFrequency.Weekly: return 'Weekly';
      case RecurrenceFrequency.Monthly: return 'Monthly';
      case RecurrenceFrequency.Quarterly: return 'Quarterly';
      case RecurrenceFrequency.SixMonthly: return '6 Monthly';
      case RecurrenceFrequency.Yearly: return 'Yearly';
      default: return frequency;
    }
  };

  const getTaskTypeLabel = (type: TaskType) => {
    switch (type) {
      case TaskType.QuickAdvisory: return 'Regular Tasks';
      case TaskType.ClinicalRound: return 'Patient Tracking';
      case TaskType.FollowUp: return 'Audit Tasks';
      case TaskType.PersonalTask: return 'Personal Task';
      default: return type;
    }
  };

  const getPriorityColor = (priority: TaskPriority) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'moderate': return 'bg-yellow-100 text-yellow-800';
      case 'lessImportant': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading recurring tasks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold">Recurring Tasks</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
        >
          <HiPlus className="w-5 h-5" />
          Create New Template
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Task
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Frequency
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Priority
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Next Due
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {templates.map((template) => {
                const nextDue = template.lastGeneratedDate 
                  ? new Date(template.lastGeneratedDate.getTime() + (
                      template.recurrenceFrequency === RecurrenceFrequency.Daily ? 24 * 60 * 60 * 1000 :
                      template.recurrenceFrequency === RecurrenceFrequency.Weekly ? 7 * 24 * 60 * 60 * 1000 :
                      template.recurrenceFrequency === RecurrenceFrequency.Monthly ? 30 * 24 * 60 * 60 * 1000 :
                      template.recurrenceFrequency === RecurrenceFrequency.Quarterly ? 90 * 24 * 60 * 60 * 1000 :
                      template.recurrenceFrequency === RecurrenceFrequency.SixMonthly ? 180 * 24 * 60 * 60 * 1000 :
                      365 * 24 * 60 * 60 * 1000
                    ))
                  : template.startDate;

                return (
                  <tr key={template.id}>
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium text-gray-900">{template.title}</div>
                        <div className="text-sm text-gray-500 truncate max-w-xs">
                          {template.description}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                        {getTaskTypeLabel(template.type)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {getFrequencyLabel(template.recurrenceFrequency)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={clsx(
                        'px-2 py-1 text-xs font-medium rounded-full',
                        getPriorityColor(template.priority)
                      )}>
                        {template.priority}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={clsx(
                        'px-2 py-1 text-xs font-medium rounded-full',
                        template.isActive 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      )}>
                        {template.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {template.isActive ? nextDue.toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggleActive(template.id, template.isActive)}
                          className={clsx(
                            'p-1 rounded hover:bg-gray-100',
                            template.isActive ? 'text-orange-600' : 'text-green-600'
                          )}
                          title={template.isActive ? 'Pause' : 'Resume'}
                        >
                          {template.isActive ? <HiPause className="w-4 h-4" /> : <HiPlay className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(template.id)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                          title="Delete"
                        >
                          <HiTrash className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {templates.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-4">No recurring task templates found.</div>
            <p className="text-sm text-gray-400 mb-4">
              Create a new recurring task template to automatically generate tasks on a schedule.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 inline-flex items-center gap-2"
            >
              <HiPlus className="w-4 h-4" />
              Create Your First Template
            </button>
          </div>
        )}
      </div>

      {/* Create Template Modal */}
      <RecurringTaskTemplateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchRecurringTemplates}
        teamMembers={teamMembers}
      />
    </div>
  );
};

export default RecurringTasksManager;