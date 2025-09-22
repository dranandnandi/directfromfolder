import React, { useState, useEffect } from 'react';
import { 
  getWhatsAppStats, 
  getPendingWhatsAppNotifications, 
  processBatchWhatsApp, 
  processHighPriorityWhatsApp,
  processMediumPriorityWhatsApp,
  triggerOverdueAlerts,
  testWhatsAppConnectivity,
  WhatsAppStats,
  BatchWhatsAppResponse
} from '../utils/whatsappUtils';
import { HiRefresh, HiPlay, HiChartBar, HiExclamationCircle, HiCheckCircle, HiXCircle, HiLightningBolt, HiClock } from 'react-icons/hi';

interface WhatsAppAdminPanelProps {
  onClose?: () => void;
}

const WhatsAppAdminPanel: React.FC<WhatsAppAdminPanelProps> = ({ onClose }) => {
  const [stats, setStats] = useState<WhatsAppStats>({
    total_notifications: 0,
    pending_notifications: 0,
    sent_notifications: 0,
    failed_notifications: 0,
    success_rate: 0
  });
  const [pendingNotifications, setPendingNotifications] = useState<any[]>([]);
  const [orgSettings, setOrgSettings] = useState<{
    whatsapp_enabled: boolean;
    auto_alerts_enabled: boolean;
    organization_name: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<BatchWhatsAppResponse | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    fetchData();
    fetchOrgSettings();
  }, []);

  const fetchOrgSettings = async () => {
    try {
      // Get organization settings to show status
      const { supabase } = await import('../utils/supabaseClient');
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data: user } = await supabase
        .from('users')
        .select('organization_id')
        .eq('auth_id', userData.user.id)
        .single();

      if (user?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('name, whatsapp_enabled, auto_alerts_enabled')
          .eq('id', user.organization_id)
          .single();

        if (org) {
          setOrgSettings({
            whatsapp_enabled: org.whatsapp_enabled || false,
            auto_alerts_enabled: org.auto_alerts_enabled || false,
            organization_name: org.name || 'Unknown Organization'
          });
        }
      }
    } catch (error) {
      console.error('Error fetching organization settings:', error);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsData, pendingData] = await Promise.all([
        getWhatsAppStats(),
        getPendingWhatsAppNotifications(20)
      ]);
      
      setStats(statsData);
      setPendingNotifications(pendingData);
    } catch (error) {
      console.error('Error fetching WhatsApp data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessHighPriority = async () => {
    setProcessing(true);
    try {
      const result = await processHighPriorityWhatsApp(25);
      setLastResult(result);
      await fetchData();
    } catch (error) {
      console.error('Error processing high priority batch:', error);
    } finally {
      setProcessing(false);
    }
  };

  const handleProcessMediumPriority = async () => {
    setProcessing(true);
    try {
      const result = await processMediumPriorityWhatsApp(25);
      setLastResult(result);
      await fetchData();
    } catch (error) {
      console.error('Error processing medium priority batch:', error);
    } finally {
      setProcessing(false);
    }
  };

  const handleProcessBatch = async (notificationTypes?: string[]) => {
    setProcessing(true);
    try {
      const result = await processBatchWhatsApp(50, notificationTypes);
      setLastResult(result);
      
      // Refresh data after processing
      await fetchData();
    } catch (error) {
      console.error('Error processing batch:', error);
    } finally {
      setProcessing(false);
    }
  };

  const handleTriggerOverdue = async () => {
    setProcessing(true);
    try {
      const result = await triggerOverdueAlerts();
      if (result.success) {
        alert(`Successfully created ${result.alerts_created} overdue alerts`);
        await fetchData();
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error triggering overdue alerts:', error);
      alert('Failed to trigger overdue alerts');
    } finally {
      setProcessing(false);
    }
  };

  const handleTestConnectivity = async () => {
    setLoading(true);
    try {
      const result = await testWhatsAppConnectivity();
      setTestResult(result);
    } catch (error) {
      console.error('Error testing connectivity:', error);
      setTestResult({
        success: false,
        error: 'Failed to test connectivity'
      });
    } finally {
      setLoading(false);
    }
  };

  const getNotificationTypeDisplayName = (type: string): string => {
    const typeMap: { [key: string]: string } = {
      // High Priority (🔴 Immediate WhatsApp)
      'task_assigned': '🔴 Task Assigned',
      'task_urgent': '🔴 Urgent/Critical Task',
      'task_overdue': '🔴 Task Overdue',
      
      // Medium Priority (🟠 Consolidated WhatsApp)
      'task_due': '🟠 Task Due Soon',
      'task_completed': '🟠 Task Completed',
      'task_updated': '🟠 Task Updated',
      'leave_request_new': '🟠 Leave Request',
      'leave_request_approved': '🟠 Leave Approved',
      'leave_request_rejected': '🟠 Leave Rejected',
      
      // Low Priority (🟢 Digest Only)
      'task_comment': '🟢 Task Comment (Digest)'
    };
    return typeMap[type] || type;
  };

  const getNotificationPriorityColor = (type: string): string => {
    if (['task_assigned', 'task_urgent', 'task_overdue'].includes(type)) {
      return 'bg-red-100 text-red-800'; // High priority
    } else if (['task_due', 'task_completed', 'task_updated', 'leave_request_new', 'leave_request_approved', 'leave_request_rejected'].includes(type)) {
      return 'bg-orange-100 text-orange-800'; // Medium priority
    } else {
      return 'bg-green-100 text-green-800'; // Low priority
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">WhatsApp Admin Panel</h2>
        <div className="flex gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            <HiRefresh className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Organization Status */}
      {orgSettings && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Organization: {orgSettings.organization_name}</h3>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center">
                  <span className="text-sm text-gray-600 mr-2">WhatsApp Enabled:</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    orgSettings.whatsapp_enabled 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {orgSettings.whatsapp_enabled ? '✅ YES' : '❌ NO'}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="text-sm text-gray-600 mr-2">Auto Alerts:</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    orgSettings.auto_alerts_enabled 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {orgSettings.auto_alerts_enabled ? '✅ YES' : '⏸️ MANUAL ONLY'}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">
                {!orgSettings.whatsapp_enabled 
                  ? 'WhatsApp messaging is disabled for this organization'
                  : !orgSettings.auto_alerts_enabled
                    ? 'Only manual sending available'
                    : 'Fully operational'
                }
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="flex items-center">
            <HiChartBar className="w-8 h-8 text-blue-600 mr-3" />
            <div>
              <p className="text-sm font-medium text-blue-600">Total Notifications</p>
              <p className="text-2xl font-bold text-blue-900">{stats.total_notifications}</p>
            </div>
          </div>
        </div>

        <div className="bg-yellow-50 p-4 rounded-lg">
          <div className="flex items-center">
            <HiExclamationCircle className="w-8 h-8 text-yellow-600 mr-3" />
            <div>
              <p className="text-sm font-medium text-yellow-600">Pending</p>
              <p className="text-2xl font-bold text-yellow-900">{stats.pending_notifications}</p>
            </div>
          </div>
        </div>

        <div className="bg-green-50 p-4 rounded-lg">
          <div className="flex items-center">
            <HiCheckCircle className="w-8 h-8 text-green-600 mr-3" />
            <div>
              <p className="text-sm font-medium text-green-600">Sent</p>
              <p className="text-2xl font-bold text-green-900">{stats.sent_notifications}</p>
            </div>
          </div>
        </div>

        <div className="bg-red-50 p-4 rounded-lg">
          <div className="flex items-center">
            <HiXCircle className="w-8 h-8 text-red-600 mr-3" />
            <div>
              <p className="text-sm font-medium text-red-600">Success Rate</p>
              <p className="text-2xl font-bold text-red-900">{stats.success_rate}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Optimized Action Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <button
          onClick={handleProcessHighPriority}
          disabled={processing || loading}
          className="px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <HiLightningBolt className="w-5 h-5" />
          High Priority ({stats.pending_notifications > 0 ? Math.ceil(stats.pending_notifications / 2) : 0})
        </button>

        <button
          onClick={handleProcessMediumPriority}
          disabled={processing || loading}
          className="px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <HiClock className="w-5 h-5" />
          Medium Priority
        </button>

        <button
          onClick={() => handleProcessBatch()}
          disabled={processing || loading}
          className="px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <HiPlay className="w-5 h-5" />
          Process All ({stats.pending_notifications})
        </button>

        <button
          onClick={handleTriggerOverdue}
          disabled={processing || loading}
          className="px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <HiExclamationCircle className="w-5 h-5" />
          Check Overdue
        </button>
      </div>

      {/* Optimization Info */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">📱 Optimized WhatsApp Alerts</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <h4 className="font-semibold text-red-700 mb-1">🔴 High Priority (Immediate)</h4>
            <ul className="text-red-600 space-y-1">
              <li>• Task Assignments</li>
              <li>• Urgent/Critical Tasks</li>
              <li>• Task Overdue (once + daily)</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-orange-700 mb-1">🟠 Medium Priority (Consolidated)</h4>
            <ul className="text-orange-600 space-y-1">
              <li>• Due Reminders (1 day + 1 hour)</li>
              <li>• Task Completions</li>
              <li>• Leave Requests</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-green-700 mb-1">🟢 Low Priority (Digest Only)</h4>
            <ul className="text-green-600 space-y-1">
              <li>• Task Comments</li>
              <li>• Daily summaries</li>
              <li>• Non-critical updates</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Test Connectivity */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-semibold">Test WhatsApp Connectivity</h3>
          <button
            onClick={handleTestConnectivity}
            disabled={loading}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            Test Connection
          </button>
        </div>
        {testResult && (
          <div className={`mt-2 p-3 rounded-lg ${testResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            <div className="flex items-center gap-2">
              {testResult.success ? (
                <HiCheckCircle className="w-5 h-5" />
              ) : (
                <HiXCircle className="w-5 h-5" />
              )}
              <span className="font-medium">
                {testResult.success ? 'Connection successful!' : `Connection failed: ${testResult.error}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Last Processing Result */}
      {lastResult && (
        <div className="mb-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-lg font-semibold mb-2">Last Processing Result</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="font-medium text-blue-600">Processed:</span> {lastResult.processed}
            </div>
            <div>
              <span className="font-medium text-green-600">Sent:</span> {lastResult.sent}
            </div>
            <div>
              <span className="font-medium text-red-600">Failed:</span> {lastResult.failed}
            </div>
          </div>
          {lastResult.errors.length > 0 && (
            <div className="mt-2">
              <span className="font-medium text-red-600">Errors:</span>
              <ul className="mt-1 text-sm text-red-700">
                {lastResult.errors.slice(0, 5).map((error, index) => (
                  <li key={index} className="truncate">• {error}</li>
                ))}
                {lastResult.errors.length > 5 && (
                  <li className="text-gray-600">... and {lastResult.errors.length - 5} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Pending Notifications */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Pending Notifications ({pendingNotifications.length})</h3>
        {pendingNotifications.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No pending WhatsApp notifications
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {pendingNotifications.map((notification) => (
              <div key={notification.id} className="border rounded-lg p-3 bg-gray-50">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${getNotificationPriorityColor(notification.type)}`}>
                        {getNotificationTypeDisplayName(notification.type)}
                      </span>
                      <span className="text-sm text-gray-500">
                        {new Date(notification.created_at).toLocaleString()}
                      </span>
                    </div>
                    <h4 className="font-medium text-gray-900">{notification.title}</h4>
                    <p className="text-sm text-gray-600 mt-1 truncate">{notification.message}</p>
                    {notification.tasks && (
                      <div className="mt-2 text-sm">
                        <span className="font-medium">Task:</span> {notification.tasks.title}
                        {notification.tasks.priority && (
                          <span className={`ml-2 px-2 py-1 text-xs rounded ${
                            notification.tasks.priority === 'high' ? 'bg-red-100 text-red-800' :
                            notification.tasks.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {notification.tasks.priority}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-gray-900">
                      {notification.whatsapp_number}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default WhatsAppAdminPanel;
