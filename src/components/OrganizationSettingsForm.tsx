import React from 'react';
import { OrganizationSettings } from '../models/task';

interface OrganizationSettingsFormProps {
  organizationSettings: OrganizationSettings;
  onUpdate: (settings: OrganizationSettings) => void;
}

const OrganizationSettingsForm: React.FC<OrganizationSettingsFormProps> = ({
  organizationSettings,
  onUpdate,
}) => {
  // Function to validate UUID
  const isValidUUID = (uuid: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  };

  // Save the updated settings
  const handleSave = () => {
    // Validate the organization ID
    if (!organizationSettings.id || !isValidUUID(organizationSettings.id)) {
      alert('Invalid organization ID. Please refresh the page and try again.');
      return;
    }

    // Call the onUpdate function to save the updated settings
    onUpdate(organizationSettings);
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Organization Configuration</h3>
        <p className="text-sm text-blue-700">
          Your organization settings are managed automatically. The system maintains default configurations 
          for task types, advisory categories, round types, and follow-up classifications. 
          These settings ensure consistent task management across your organization.
        </p>
      </div>

      <div className="pt-4 border-t">
        <button
          onClick={handleSave}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Refresh Settings
        </button>
      </div>
    </div>
  );
};

export default OrganizationSettingsForm;