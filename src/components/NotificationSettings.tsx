import React, { useState, useEffect } from 'react';
import { NotificationType, NotificationPreference } from '../models/notification';
import { getNotificationPreferences, updateNotificationPreference } from '../utils/notificationUtils';

const NotificationSettings: React.FC = () => {
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      const prefs = await getNotificationPreferences();
      setPreferences(prefs);
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (type: NotificationType, enabled: boolean) => {
    try {
      setSaving(type);
      const pref = preferences.find(p => p.type === type);
      await updateNotificationPreference(
        type,
        enabled,
        pref?.advanceNotice || '1 day'
      );
      await fetchPreferences();
    } catch (error) {
      console.error('Error updating preference:', error);
    } finally {
      setSaving(null);
    }
  };

  const handleAdvanceNoticeChange = async (type: NotificationType, value: string) => {
    try {
      setSaving(type);
      const pref = preferences.find(p => p.type === type);
      await updateNotificationPreference(
        type,
        pref?.enabled || true,
        value
      );
      await fetchPreferences();
    } catch (error) {
      console.error('Error updating preference:', error);
    } finally {
      setSaving(null);
    }
  };

  const getNotificationDescription = (type: NotificationType): string => {
    switch (type) {
      case NotificationType.TaskDue:
        return 'Get notified before tasks are due (multiple reminders: 1 day, 6 hours, 2 hours, 1 hour, 30 minutes before)';
      case NotificationType.TaskAssigned:
        return 'Get notified when tasks are assigned to you';
      case NotificationType.TaskUpdated:
        return 'Get notified when your tasks are updated';
      case NotificationType.TaskCompleted:
        return 'Get notified when tasks you created are completed';
      case NotificationType.TaskComment:
        return 'Get notified when someone comments on your tasks';
      default:
        return '';
    }
  };

  const getDisplayName = (type: NotificationType): string => {
    switch (type) {
      case NotificationType.TaskDue:
        return 'Task Due Reminders';
      case NotificationType.TaskAssigned:
        return 'Task Assignments';
      case NotificationType.TaskUpdated:
        return 'Task Updates';
      case NotificationType.TaskCompleted:
        return 'Task Completions';
      case NotificationType.TaskComment:
        return 'Task Comments';
      default:
        return (type as string).replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
    }
  };

  if (loading) {
    return <div className="p-4">Loading preferences...</div>;
  }

  // Ensure all notification types are represented
  const allNotificationTypes = Object.values(NotificationType);
  const prefsMap = new Map(preferences.map(p => [p.type, p]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Notification Settings</h2>
        <div className="text-sm text-gray-500">
          Configure your notification preferences
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Default Notification System</h3>
        <p className="text-sm text-blue-700">
          By default, all users receive notifications for task assignments, updates, completions, and comments. 
          Task due date reminders are sent at multiple intervals (1 day, 6 hours, 2 hours, 1 hour, and 30 minutes before due time).
          You can customize these settings below for your personal preferences.
        </p>
      </div>
      
      <div className="space-y-4">
        {allNotificationTypes.map(type => {
          const pref = prefsMap.get(type) || {
            type,
            enabled: true, // Default enabled
            advanceNotice: type === NotificationType.TaskDue ? '1 day' : '0 minutes'
          };

          const isSaving = saving === type;

          return (
            <div key={type} className="flex items-start justify-between p-4 bg-white rounded-lg shadow-sm border">
              <div className="flex-1">
                <h3 className="font-medium text-gray-900">{getDisplayName(type)}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {getNotificationDescription(type)}
                </p>
                {type === NotificationType.TaskDue && (
                  <div className="mt-2">
                    <span className="text-xs text-orange-600 font-medium">
                      Note: This controls all due date reminders (1d, 6h, 2h, 1h, 30min before)
                    </span>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-4 ml-4">
                {type === NotificationType.TaskDue && pref.enabled && (
                  <select
                    value={pref.advanceNotice}
                    onChange={(e) => handleAdvanceNoticeChange(type, e.target.value)}
                    disabled={isSaving}
                    className="text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
                  >
                    <option value="30 minutes">Start 30 minutes before</option>
                    <option value="1 hour">Start 1 hour before</option>
                    <option value="2 hours">Start 2 hours before</option>
                    <option value="6 hours">Start 6 hours before</option>
                    <option value="1 day">Start 1 day before</option>
                    <option value="2 days">Start 2 days before</option>
                  </select>
                )}
                
                <button
                  onClick={() => handleToggle(type, !pref.enabled)}
                  disabled={isSaving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
                    pref.enabled ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      pref.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>

                {isSaving && (
                  <div className="text-xs text-gray-500">Saving...</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="font-medium text-gray-900 mb-2">How Notifications Work</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• <strong>Task Assignments:</strong> Instant notification when assigned to a task</li>
          <li>• <strong>Task Updates:</strong> Notified when task details change (title, description, priority, due date)</li>
          <li>• <strong>Task Completions:</strong> Notified when tasks you created are marked as completed</li>
          <li>• <strong>Task Comments:</strong> Notified when someone adds a message to your tasks</li>
          <li>• <strong>Task Due Reminders:</strong> Multiple notifications before due time (1d, 6h, 2h, 1h, 30min)</li>
        </ul>
      </div>
    </div>
  );
};

export default NotificationSettings;