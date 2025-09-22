import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { HiCog, HiCheck, HiX, HiExclamationCircle, HiInformationCircle } from 'react-icons/hi';

interface OrganizationWhatsAppSettings {
  id: string;
  whatsapp_enabled: boolean;
  auto_alerts_enabled: boolean;
  whatsapp_api_endpoint: string;
  whatsapp_settings: {
    priority_high: boolean;
    priority_medium: boolean;
    priority_low: boolean;
    rate_limit: number;
  };
}

interface WhatsAppSettingsFormProps {
  onClose?: () => void;
}

const WhatsAppSettingsForm: React.FC<WhatsAppSettingsFormProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<OrganizationWhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  useEffect(() => {
    fetchOrganizationSettings();
  }, []);

  const fetchOrganizationSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user to find organization
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const { data: user, error: profileError } = await supabase
        .from('users')
        .select('organization_id, role')
        .eq('auth_id', userData.user.id)
        .single();

      if (profileError) throw profileError;
      if (!user?.organization_id) throw new Error('No organization found');

      // Check if user is admin
      if (!['admin', 'superadmin'].includes(user.role)) {
        throw new Error('Only administrators can manage WhatsApp settings');
      }

      // Fetch organization WhatsApp settings
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('id, whatsapp_enabled, auto_alerts_enabled, whatsapp_api_endpoint, whatsapp_settings')
        .eq('id', user.organization_id)
        .single();

      if (orgError) throw orgError;

      setSettings({
        id: orgData.id,
        whatsapp_enabled: orgData.whatsapp_enabled || false,
        auto_alerts_enabled: orgData.auto_alerts_enabled || false,
        whatsapp_api_endpoint: orgData.whatsapp_api_endpoint || 'http://134.209.145.186:3001/api/send-message',
        whatsapp_settings: {
          priority_high: true,
          priority_medium: true,
          priority_low: false,
          rate_limit: 30,
          ...orgData.whatsapp_settings
        }
      });
    } catch (err) {
      console.error('Error fetching organization settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const { error: updateError } = await supabase
        .from('organizations')
        .update({
          whatsapp_enabled: settings.whatsapp_enabled,
          auto_alerts_enabled: settings.auto_alerts_enabled,
          whatsapp_api_endpoint: settings.whatsapp_api_endpoint,
          whatsapp_settings: settings.whatsapp_settings,
          updated_at: new Date().toISOString()
        })
        .eq('id', settings.id);

      if (updateError) throw updateError;

      setSuccessMessage('WhatsApp settings saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error saving settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const testWhatsAppConnection = async () => {
    if (!settings) return;

    try {
      setTestStatus('testing');
      
      const testMessage = 'WhatsApp Integration Test - Organization Settings Verification ✅';
      
      const { data, error } = await supabase.functions.invoke('send-whatsapp', {
        body: {
          phoneNumber: '+919909249725', // Use a test number
          message: testMessage,
          testMessage: true
        }
      });

      if (error) throw error;

      if (data.success) {
        setTestStatus('success');
        setTimeout(() => setTestStatus('idle'), 3000);
      } else {
        throw new Error(data.error || 'Test failed');
      }
    } catch (err) {
      console.error('WhatsApp test failed:', err);
      setTestStatus('error');
      setError(err instanceof Error ? err.message : 'Connection test failed');
      setTimeout(() => setTestStatus('idle'), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2">Loading WhatsApp settings...</span>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-center">
          <HiExclamationCircle className="h-6 w-6 text-red-500 mr-2" />
          <span className="text-red-700">Failed to load WhatsApp settings</span>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <HiCog className="h-6 w-6 text-blue-600 mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">WhatsApp Integration Settings</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <HiX className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Status Messages */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center">
            <HiExclamationCircle className="h-5 w-5 text-red-500 mr-2" />
            <span className="text-red-700">{error}</span>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center">
            <HiCheck className="h-5 w-5 text-green-500 mr-2" />
            <span className="text-green-700">{successMessage}</span>
          </div>
        </div>
      )}

      {/* Main Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-6">
        
        {/* Master WhatsApp Toggle */}
        <div className="space-y-2">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={settings.whatsapp_enabled}
              onChange={(e) => setSettings({
                ...settings,
                whatsapp_enabled: e.target.checked
              })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="text-lg font-medium text-gray-900">Enable WhatsApp Alerts</span>
          </label>
          <p className="text-sm text-gray-600 ml-7">
            Master toggle for all WhatsApp functionality in your organization
          </p>
        </div>

        {/* Auto Alerts Toggle */}
        <div className="space-y-2">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={settings.auto_alerts_enabled}
              disabled={!settings.whatsapp_enabled}
              onChange={(e) => setSettings({
                ...settings,
                auto_alerts_enabled: e.target.checked
              })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
            />
            <span className="text-lg font-medium text-gray-900">Enable Automatic Alerts</span>
          </label>
          <p className="text-sm text-gray-600 ml-7">
            Auto-process alerts based on priority rules. When disabled, only manual sending from admin panel works.
          </p>
        </div>

        {/* API Endpoint */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            WhatsApp API Endpoint
          </label>
          <input
            type="url"
            value={settings.whatsapp_api_endpoint}
            onChange={(e) => setSettings({
              ...settings,
              whatsapp_api_endpoint: e.target.value
            })}
            disabled={!settings.whatsapp_enabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
            placeholder="http://134.209.145.186:3001/api/send-message"
          />
          <p className="text-sm text-gray-600">
            Custom WhatsApp API endpoint for your organization
          </p>
        </div>

        {/* Priority Configuration */}
        <div className="space-y-4">
          <h4 className="text-md font-medium text-gray-900">Alert Priority Configuration</h4>
          
          <div className="space-y-3">
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={settings.whatsapp_settings.priority_high}
                disabled={!settings.whatsapp_enabled}
                onChange={(e) => setSettings({
                  ...settings,
                  whatsapp_settings: {
                    ...settings.whatsapp_settings,
                    priority_high: e.target.checked
                  }
                })}
                className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded disabled:opacity-50"
              />
              <span className="text-sm font-medium text-gray-900">🔴 High Priority Alerts (Immediate)</span>
            </label>
            <p className="text-xs text-gray-600 ml-7">
              Task assignments, urgent tasks, overdue alerts
            </p>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={settings.whatsapp_settings.priority_medium}
                disabled={!settings.whatsapp_enabled}
                onChange={(e) => setSettings({
                  ...settings,
                  whatsapp_settings: {
                    ...settings.whatsapp_settings,
                    priority_medium: e.target.checked
                  }
                })}
                className="h-4 w-4 text-yellow-600 focus:ring-yellow-500 border-gray-300 rounded disabled:opacity-50"
              />
              <span className="text-sm font-medium text-gray-900">🟠 Medium Priority Alerts (Consolidated)</span>
            </label>
            <p className="text-xs text-gray-600 ml-7">
              Due reminders, completions, leave requests
            </p>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={settings.whatsapp_settings.priority_low}
                disabled={!settings.whatsapp_enabled}
                onChange={(e) => setSettings({
                  ...settings,
                  whatsapp_settings: {
                    ...settings.whatsapp_settings,
                    priority_low: e.target.checked
                  }
                })}
                className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded disabled:opacity-50"
              />
              <span className="text-sm font-medium text-gray-900">🟢 Low Priority Alerts (Digest Only)</span>
            </label>
            <p className="text-xs text-gray-600 ml-7">
              Task comments (recommended: digest only)
            </p>
          </div>
        </div>

        {/* Rate Limit */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Rate Limit (messages per minute)
          </label>
          <input
            type="number"
            min="1"
            max="100"
            value={settings.whatsapp_settings.rate_limit}
            disabled={!settings.whatsapp_enabled}
            onChange={(e) => setSettings({
              ...settings,
              whatsapp_settings: {
                ...settings.whatsapp_settings,
                rate_limit: parseInt(e.target.value) || 30
              }
            })}
            className="w-24 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          />
          <p className="text-sm text-gray-600">
            Maximum messages to send per minute to prevent spam
          </p>
        </div>
      </div>

      {/* Info Panel */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <HiInformationCircle className="h-5 w-5 text-blue-500 mr-2 mt-0.5" />
          <div className="text-sm text-blue-700 space-y-2">
            <p><strong>How it works:</strong></p>
            <ul className="list-disc list-inside space-y-1">
              <li>When WhatsApp is disabled, no messages are sent regardless of other settings</li>
              <li>When auto alerts are disabled, only manual sending from admin panel works</li>
              <li>Priority levels control which notification types can send WhatsApp messages</li>
              <li>Rate limiting prevents API overload and spam</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-200">
        <button
          onClick={testWhatsAppConnection}
          disabled={!settings.whatsapp_enabled || testStatus === 'testing'}
          className={`px-4 py-2 rounded-md text-sm font-medium border focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${
            testStatus === 'success' 
              ? 'bg-green-100 text-green-800 border-green-300 focus:ring-green-500'
              : testStatus === 'error'
                ? 'bg-red-100 text-red-800 border-red-300 focus:ring-red-500'
                : 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200 focus:ring-gray-500'
          }`}
        >
          {testStatus === 'testing' ? 'Testing...' : 
           testStatus === 'success' ? '✅ Test Successful' :
           testStatus === 'error' ? '❌ Test Failed' : 
           'Test Connection'}
        </button>

        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

export default WhatsAppSettingsForm;
