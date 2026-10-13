import React, { useEffect, useState } from 'react';
import { HiPlus, HiX, HiRefresh } from 'react-icons/hi';
import { OrganizationSettings } from '../models/task';
import {
  DEFAULT_ADVISORY_TYPES,
  DEFAULT_FOLLOW_UP_TYPES,
  DEFAULT_ROUND_TYPES,
  TASK_OPTION_LABELS,
  normalizeTaskOptions,
} from '../constants/taskOptions';

interface OrganizationSettingsFormProps {
  organizationSettings: OrganizationSettings;
  onUpdate: (settings: OrganizationSettings) => void;
}

type ListKey = 'roundTypes' | 'followUpTypes' | 'advisoryTypes';

interface ListConfig {
  key: ListKey;
  title: string;
  usedBy: string;
  defaults: string[];
}

const LISTS: ListConfig[] = [
  {
    key: 'roundTypes',
    title: TASK_OPTION_LABELS.roundTypes,
    usedBy: 'Client Tracking tasks (e.g. Scheduled Visit, Site Inspection)',
    defaults: DEFAULT_ROUND_TYPES,
  },
  {
    key: 'followUpTypes',
    title: TASK_OPTION_LABELS.followUpTypes,
    usedBy: 'Client Tracking and Audit tasks (e.g. Progress Update, Report Review)',
    defaults: DEFAULT_FOLLOW_UP_TYPES,
  },
  {
    key: 'advisoryTypes',
    title: TASK_OPTION_LABELS.advisoryTypes,
    usedBy: 'Regular tasks (e.g. Administrative, Safety)',
    defaults: DEFAULT_ADVISORY_TYPES,
  },
];

const isValidUUID = (uuid: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);

const OrganizationSettingsForm: React.FC<OrganizationSettingsFormProps> = ({
  organizationSettings,
  onUpdate,
}) => {
  const [lists, setLists] = useState<Record<ListKey, string[]>>({
    roundTypes: [],
    followUpTypes: [],
    advisoryTypes: [],
  });
  const [drafts, setDrafts] = useState<Record<ListKey, string>>({
    roundTypes: '',
    followUpTypes: '',
    advisoryTypes: '',
  });
  const [error, setError] = useState<string | null>(null);

  // Sync local editing state whenever fresh settings arrive from the server.
  useEffect(() => {
    setLists({
      roundTypes: normalizeTaskOptions(organizationSettings.roundTypes),
      followUpTypes: normalizeTaskOptions(organizationSettings.followUpTypes),
      advisoryTypes: normalizeTaskOptions(organizationSettings.advisoryTypes),
    });
  }, [
    organizationSettings.id,
    organizationSettings.roundTypes,
    organizationSettings.followUpTypes,
    organizationSettings.advisoryTypes,
  ]);

  const isDirty = LISTS.some(
    ({ key }) =>
      JSON.stringify(lists[key]) !==
      JSON.stringify(normalizeTaskOptions(organizationSettings[key]))
  );

  const addItem = (key: ListKey) => {
    const value = drafts[key].trim();
    setError(null);
    if (!value) return;
    if (lists[key].some((item) => item.toLowerCase() === value.toLowerCase())) {
      setError(`"${value}" is already in the ${LISTS.find((l) => l.key === key)?.title} list.`);
      return;
    }
    setLists((prev) => ({ ...prev, [key]: [...prev[key], value] }));
    setDrafts((prev) => ({ ...prev, [key]: '' }));
  };

  const removeItem = (key: ListKey, index: number) => {
    setError(null);
    setLists((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  };

  const resetList = (key: ListKey, defaults: string[]) => {
    setError(null);
    setLists((prev) => ({ ...prev, [key]: [...defaults] }));
  };

  const handleSave = () => {
    if (!organizationSettings.id || !isValidUUID(organizationSettings.id)) {
      alert('Invalid organization ID. Please refresh the page and try again.');
      return;
    }
    setError(null);
    onUpdate({
      ...organizationSettings,
      roundTypes: normalizeTaskOptions(lists.roundTypes),
      followUpTypes: normalizeTaskOptions(lists.followUpTypes),
      advisoryTypes: normalizeTaskOptions(lists.advisoryTypes),
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Task Classification Options</h3>
        <p className="text-sm text-blue-700">
          These lists belong to this organization only and drive the dropdowns in the task form.
          Use terms that fit your business (clinic, retail, field service, office). Leaving a list
          empty shows the built-in neutral defaults.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {LISTS.map(({ key, title, usedBy, defaults }) => (
        <div key={key} className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-medium text-gray-900">{title}</h4>
              <p className="text-xs text-gray-500 mt-0.5">Used by: {usedBy}</p>
            </div>
            <button
              type="button"
              onClick={() => resetList(key, defaults)}
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 whitespace-nowrap"
              title="Replace this list with the built-in neutral defaults"
            >
              <HiRefresh className="w-4 h-4" />
              Reset to defaults
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {lists[key].length === 0 && (
              <span className="text-sm text-gray-400 italic">
                No custom options — the task form will show the defaults ({defaults.join(', ')}).
              </span>
            )}
            {lists[key].map((item, index) => (
              <span
                key={`${item}-${index}`}
                className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 text-sm rounded-full pl-3 pr-1 py-1"
              >
                {item}
                <button
                  type="button"
                  onClick={() => removeItem(key, index)}
                  className="p-0.5 rounded-full text-gray-500 hover:text-red-600 hover:bg-red-50"
                  title={`Remove ${item}`}
                >
                  <HiX className="w-4 h-4" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={drafts[key]}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addItem(key);
                }
              }}
              placeholder={`Add ${title.toLowerCase()}`}
              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => addItem(key)}
              className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm px-3 py-2 rounded-md"
            >
              <HiPlus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      ))}

      <div className="pt-4 border-t">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDirty ? 'Save Task Options' : 'No changes to save'}
        </button>
      </div>
    </div>
  );
};

export default OrganizationSettingsForm;
