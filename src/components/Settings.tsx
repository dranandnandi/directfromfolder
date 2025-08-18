import { useState, useEffect } from 'react';
import { HiUser, HiOfficeBuilding, HiBell } from 'react-icons/hi';
import OrganizationSettingsForm from './OrganizationSettingsForm';
import NotificationSettings from './NotificationSettings';
import { OrganizationSettings } from '../models/task';
import { supabase } from '../utils/supabaseClient';

// Define the isValidUUID function
const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

const Settings = () => {
  const [activeTab, setActiveTab] = useState<'organization' | 'profile' | 'notifications'>('organization');
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings>({
    id: '', // Will be updated with the actual organization ID
    organizationId: '', // Will be updated with the actual organization ID
    name: 'Clinic Task Manager', // Default name
    advisoryTypes: [], // Placeholder
    roundTypes: [], // Placeholder
    followUpTypes: [], // Placeholder
    createdAt: new Date(), // Current date
    updatedAt: new Date(), // Current date
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOrganizationSettings();
  }, []);

  const fetchOrganizationSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if the user is logged in
      const { data: { session }, error: authError } = await supabase.auth.getSession();
      if (authError || !session) {
        throw new Error('User not authenticated. Please log in.');
      }

      // Get the user's organization ID
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('organization_id')
        .eq('auth_id', session.user.id)
        .single();

      if (userError) throw userError;
      if (!userData?.organization_id) throw new Error('No organization found for user');

      // Fetch organization settings
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', userData.organization_id)
        .single();

      if (orgError) throw orgError;
      if (!orgData) throw new Error('Organization data not found');

      // Update the organization settings state
      setOrganizationSettings({
        id: orgData.id,
        organizationId: orgData.id,
        name: orgData.name || 'Clinic Task Manager',
        advisoryTypes: orgData.advisory_types || [],
        roundTypes: orgData.round_types || [],
        followUpTypes: orgData.follow_up_types || [],
        createdAt: new Date(orgData.created_at),
        updatedAt: new Date(orgData.updated_at),
      });
    } catch (error) {
      console.error('Error fetching organization settings:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch organization settings. Please try again or contact support.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = async (newSettings: OrganizationSettings) => {
    try {
      setLoading(true);
      setError(null);

      // Check if the user is logged in
      const { data: { session }, error: authError } = await supabase.auth.getSession();
      if (authError || !session) {
        throw new Error('User not authenticated. Please log in.');
      }

      // Validate the organization ID
      if (!newSettings.id || !isValidUUID(newSettings.id)) {
        throw new Error('Invalid organization ID');
      }

      // Update the database
      const { error: updateError } = await supabase
        .from('organizations')
        .update({
          advisory_types: newSettings.advisoryTypes,
          round_types: newSettings.roundTypes,
          follow_up_types: newSettings.followUpTypes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', newSettings.id);

      if (updateError) throw updateError;

      // Fetch the updated settings to ensure we have the latest data
      await fetchOrganizationSettings();
      
      alert('Settings updated successfully!');
    } catch (error) {
      console.error('Error updating settings:', error);
      setError(error instanceof Error ? error.message : 'Failed to update settings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-semibold mb-6">Settings</h2>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('organization')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'organization'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <HiOfficeBuilding className="w-5 h-5 inline mr-2" />
            Organization
          </button>
          <button
            onClick={() => setActiveTab('notifications')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'notifications'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <HiBell className="w-5 h-5 inline mr-2" />
            Notifications
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'profile'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <HiUser className="w-5 h-5 inline mr-2" />
            Profile
          </button>
        </nav>
      </div>

      <div className="space-y-6">
        {/* Organization Settings */}
        {activeTab === 'organization' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
              <HiOfficeBuilding className="w-5 h-5 text-gray-500" />
              Organization Settings
            </h3>
            <OrganizationSettingsForm
              organizationSettings={organizationSettings}
              onUpdate={handleUpdateSettings}
            />
          </div>
        )}

        {/* Notification Settings */}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
              <HiBell className="w-5 h-5 text-gray-500" />
              Notification Preferences
            </h3>
            <NotificationSettings />
          </div>
        )}

        {/* Profile Settings */}
        {activeTab === 'profile' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
              <HiUser className="w-5 h-5 text-gray-500" />
              Profile Settings
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="Enter your full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="Enter your email"
                />
              </div>
              <div className="pt-4">
                <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                  Save Profile
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;