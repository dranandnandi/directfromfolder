import React, { useEffect, useState } from 'react';
import { HiCalendar, HiCheckCircle, HiXCircle, HiPlus, HiTrash } from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import {
  LeavePolicy,
  LeaveTypeConfig,
  MONTH_NAMES,
  getLeaveYear,
  normaliseLeaveCode,
  parseLeavePolicy
} from '../utils/leavePolicy';

interface LeavePolicySettingsProps {
  organizationId: string;
}

const LeavePolicySettings: React.FC<LeavePolicySettingsProps> = ({ organizationId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [yearStartMonth, setYearStartMonth] = useState(4);
  const [types, setTypes] = useState<LeaveTypeConfig[]>([]);

  useEffect(() => {
    fetchPolicy();
  }, [organizationId]);

  const fetchPolicy = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('organizations')
        .select('leave_policy')
        .eq('id', organizationId)
        .single();

      if (fetchError) throw fetchError;

      const policy = parseLeavePolicy(data?.leave_policy);
      setYearStartMonth(policy.year_start_month);
      setTypes(policy.types);
    } catch (err) {
      console.error('Error fetching leave policy:', err);
      setError(err instanceof Error ? err.message : 'Failed to load leave policy');
    } finally {
      setLoading(false);
    }
  };

  const updateType = (index: number, patch: Partial<LeaveTypeConfig>) => {
    setTypes(current => current.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const addType = () => {
    setTypes(current => [...current, { code: '', name: '', annual_quota: 0 }]);
  };

  const removeType = (index: number) => {
    setTypes(current => current.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Validate before normalising so the admin sees exactly what is wrong.
      const seen = new Set<string>();
      for (const t of types) {
        const code = normaliseLeaveCode(t.code);
        if (!code) throw new Error('Every leave type needs a short code (e.g. SL, CL).');
        if (seen.has(code)) throw new Error(`Duplicate leave code "${code}".`);
        seen.add(code);
        if (!t.name.trim()) throw new Error(`Leave type "${code}" needs a name.`);
        if (!Number.isFinite(t.annual_quota) || t.annual_quota < 0) {
          throw new Error(`Yearly quota for "${code}" must be 0 or more.`);
        }
      }
      if (types.length === 0) throw new Error('Add at least one leave type.');

      const policy: LeavePolicy = parseLeavePolicy({ year_start_month: yearStartMonth, types });

      const { error: updateError } = await supabase
        .from('organizations')
        .update({ leave_policy: policy, updated_at: new Date().toISOString() })
        .eq('id', organizationId);

      if (updateError) throw updateError;

      setTypes(policy.types);
      setSuccessMessage('Leave policy saved successfully!');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error('Error saving leave policy:', err);
      setError(err instanceof Error ? err.message : 'Failed to save leave policy');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const currentYear = getLeaveYear({ year_start_month: yearStartMonth, types });

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
          <HiCalendar className="w-5 h-5" />
          Yearly Leave Quotas
        </h3>
        <p className="text-sm text-blue-700">
          Define the leave categories employees can request and how many days of each they get
          per leave year. Balances are calculated from approved requests. A quota of 0 means no
          yearly limit is enforced for that category. Requests that exceed the balance are
          flagged, but an admin can still approve them.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
          <HiXCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-2">
          <HiCheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700">{successMessage}</p>
        </div>
      )}

      {/* Leave year */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Leave year starts in
        </label>
        <select
          value={yearStartMonth}
          onChange={(e) => setYearStartMonth(Number(e.target.value))}
          className="w-full md:w-64 border border-gray-300 rounded-md px-3 py-2"
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>{name}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Current leave year: {currentYear.label} ({currentYear.start} to the day before {currentYear.end}).
          April gives an April-to-March year; January gives a calendar year.
        </p>
      </div>

      {/* Leave types */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            Leave types and yearly quota (days)
          </label>
          <button
            type="button"
            onClick={addType}
            className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
          >
            <HiPlus className="w-4 h-4 mr-1" />
            Add type
          </button>
        </div>

        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 uppercase px-1">
            <div className="col-span-2">Code</div>
            <div className="col-span-6">Name</div>
            <div className="col-span-3">Days / year</div>
            <div className="col-span-1"></div>
          </div>

          {types.map((type, index) => (
            <div key={index} className="grid grid-cols-12 gap-2 items-center">
              <input
                type="text"
                value={type.code}
                onChange={(e) => updateType(index, { code: e.target.value.toUpperCase() })}
                placeholder="SL"
                maxLength={6}
                className="col-span-3 md:col-span-2 border border-gray-300 rounded-md px-3 py-2 uppercase"
              />
              <input
                type="text"
                value={type.name}
                onChange={(e) => updateType(index, { name: e.target.value })}
                placeholder="Sick Leave"
                className="col-span-5 md:col-span-6 border border-gray-300 rounded-md px-3 py-2"
              />
              <input
                type="number"
                min={0}
                step={0.5}
                value={type.annual_quota}
                onChange={(e) => updateType(index, { annual_quota: Number(e.target.value) })}
                className="col-span-3 border border-gray-300 rounded-md px-3 py-2"
              />
              <button
                type="button"
                onClick={() => removeType(index)}
                className="col-span-1 text-gray-400 hover:text-red-600 flex justify-center"
                title="Remove leave type"
              >
                <HiTrash className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>

        <p className="mt-2 text-xs text-gray-500">
          Privilege / earned leave is not enabled yet. When you need it, add a row such as PL with its quota.
        </p>
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Leave Policy'}
        </button>
      </div>
    </div>
  );
};

export default LeavePolicySettings;
