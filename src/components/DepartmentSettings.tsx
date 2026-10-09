import { useCallback, useEffect, useState } from 'react';
import { HiOfficeBuilding, HiPencil, HiPlus, HiTrash, HiCheck, HiX } from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import { withDefaultDepartments, normalizeDepartments } from '../constants/departments';

interface DepartmentSettingsProps {
  organizationId: string;
  onDepartmentsChange?: (departments: string[]) => void;
}

const DepartmentSettings: React.FC<DepartmentSettingsProps> = ({
  organizationId,
  onDepartmentsChange,
}) => {
  const [departments, setDepartments] = useState<string[]>([]);
  const [userCounts, setUserCounts] = useState<Record<string, number>>({});
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newDepartment, setNewDepartment] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [deleting, setDeleting] = useState<{ name: string; reassignTo: string } | null>(null);

  const countKey = (name: string) => name.trim().toLowerCase();

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('User not authenticated. Please log in.');

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('auth_id', session.user.id)
        .single();

      if (userError) throw userError;
      setCanManage(['admin', 'superadmin'].includes(userData?.role));

      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('departments')
        .eq('id', organizationId)
        .single();

      if (orgError) throw orgError;
      setDepartments(withDefaultDepartments(orgData?.departments));

      const { data: orgUsers, error: usersError } = await supabase
        .from('users')
        .select('department')
        .eq('organization_id', organizationId);

      if (usersError) throw usersError;

      const counts: Record<string, number> = {};
      (orgUsers || []).forEach((user: { department: string | null }) => {
        if (!user.department) return;
        const key = countKey(user.department);
        counts[key] = (counts[key] || 0) + 1;
      });
      setUserCounts(counts);
    } catch (err) {
      console.error('Error loading departments:', err);
      setError(err instanceof Error ? err.message : 'Failed to load departments.');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  const persist = async (next: string[]) => {
    const cleaned = normalizeDepartments(next);
    if (cleaned.length === 0) {
      setError('Your organization needs at least one department.');
      return false;
    }

    const { error: updateError } = await supabase
      .from('organizations')
      .update({ departments: cleaned, updated_at: new Date().toISOString() })
      .eq('id', organizationId);

    if (updateError) throw updateError;

    setDepartments(cleaned);
    onDepartmentsChange?.(cleaned);
    return true;
  };

  const isDuplicate = (name: string, ignoreIndex?: number) =>
    departments.some(
      (dept, index) => index !== ignoreIndex && dept.trim().toLowerCase() === name.trim().toLowerCase()
    );

  const handleAdd = async () => {
    const name = newDepartment.trim();
    setError(null);
    setSuccess(null);

    if (!name) {
      setError('Enter a department name.');
      return;
    }
    if (isDuplicate(name)) {
      setError(`"${name}" already exists.`);
      return;
    }

    try {
      setSaving(true);
      if (await persist([...departments, name])) {
        setNewDepartment('');
        setSuccess(`Department "${name}" added.`);
      }
    } catch (err) {
      console.error('Error adding department:', err);
      setError(err instanceof Error ? err.message : 'Failed to add department.');
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async (index: number) => {
    const oldName = departments[index];
    const newName = editingValue.trim();
    setError(null);
    setSuccess(null);

    if (!newName) {
      setError('Department name cannot be empty.');
      return;
    }
    if (newName === oldName) {
      setEditingIndex(null);
      return;
    }
    if (isDuplicate(newName, index)) {
      setError(`"${newName}" already exists.`);
      return;
    }

    try {
      setSaving(true);
      const next = [...departments];
      next[index] = newName;
      if (!(await persist(next))) return;

      // Keep already-assigned users pointing at the renamed department.
      const { error: usersError } = await supabase
        .from('users')
        .update({ department: newName })
        .eq('organization_id', organizationId)
        .eq('department', oldName);

      if (usersError) throw usersError;

      setEditingIndex(null);
      setEditingValue('');
      setSuccess(`Renamed "${oldName}" to "${newName}".`);
      await load();
    } catch (err) {
      console.error('Error renaming department:', err);
      setError(err instanceof Error ? err.message : 'Failed to rename department.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const { name, reassignTo } = deleting;
    const assigned = userCounts[countKey(name)] || 0;
    setError(null);
    setSuccess(null);

    if (assigned > 0 && !reassignTo) {
      setError(`Choose a department to move the ${assigned} assigned user(s) to.`);
      return;
    }

    try {
      setSaving(true);

      if (assigned > 0) {
        const { error: usersError } = await supabase
          .from('users')
          .update({ department: reassignTo })
          .eq('organization_id', organizationId)
          .eq('department', name);

        if (usersError) throw usersError;
      }

      if (!(await persist(departments.filter((dept) => dept !== name)))) return;

      setDeleting(null);
      setSuccess(
        assigned > 0
          ? `Removed "${name}" and moved ${assigned} user(s) to "${reassignTo}".`
          : `Removed "${name}".`
      );
      await load();
    } catch (err) {
      console.error('Error deleting department:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete department.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-600 text-sm">Loading departments...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-1 flex items-center gap-2">
          <HiOfficeBuilding className="w-4 h-4" />
          Departments
        </h4>
        <p className="text-sm text-blue-700">
          Departments belong to this organization only — each organization keeps its own list.
          These are the options shown when adding or editing a user.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">{success}</div>
      )}

      {!canManage && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg p-3">
          Only administrators can change departments.
        </div>
      )}

      <div className="border border-gray-200 rounded-lg divide-y">
        {departments.map((dept, index) => {
          const assigned = userCounts[countKey(dept)] || 0;
          const isEditing = editingIndex === index;

          return (
            <div key={`${dept}-${index}`} className="flex items-center gap-3 px-4 py-3">
              {isEditing ? (
                <>
                  <input
                    type="text"
                    value={editingValue}
                    autoFocus
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(index);
                      if (e.key === 'Escape') setEditingIndex(null);
                    }}
                    className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => handleRename(index)}
                    disabled={saving}
                    title="Save"
                    className="p-1.5 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                  >
                    <HiCheck className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setEditingIndex(null)}
                    title="Cancel"
                    className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                  >
                    <HiX className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-gray-900">{dept}</span>
                  <span className="text-xs text-gray-500">
                    {assigned} {assigned === 1 ? 'user' : 'users'}
                  </span>
                  {canManage && (
                    <>
                      <button
                        onClick={() => {
                          setEditingIndex(index);
                          setEditingValue(dept);
                          setDeleting(null);
                          setError(null);
                        }}
                        title="Rename department"
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <HiPencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setDeleting({ name: dept, reassignTo: '' });
                          setEditingIndex(null);
                          setError(null);
                        }}
                        disabled={departments.length === 1}
                        title={
                          departments.length === 1
                            ? 'At least one department is required'
                            : 'Remove department'
                        }
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <HiTrash className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {deleting && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4 space-y-3">
          <p className="text-sm text-red-800">
            Remove <strong>{deleting.name}</strong>?
            {(userCounts[countKey(deleting.name)] || 0) > 0 && (
              <> {userCounts[countKey(deleting.name)]} user(s) are assigned to it and must be moved.</>
            )}
          </p>

          {(userCounts[countKey(deleting.name)] || 0) > 0 && (
            <select
              value={deleting.reassignTo}
              onChange={(e) => setDeleting({ ...deleting, reassignTo: e.target.value })}
              className="w-full rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">Move users to...</option>
              {departments
                .filter((dept) => dept !== deleting.name)
                .map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
            </select>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={saving}
              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? 'Removing...' : 'Remove'}
            </button>
            <button
              onClick={() => setDeleting(null)}
              className="border border-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canManage && (
        <div className="flex gap-2 pt-2">
          <input
            type="text"
            value={newDepartment}
            onChange={(e) => setNewDepartment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            placeholder="New department name"
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
          <button
            onClick={handleAdd}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
          >
            <HiPlus className="w-4 h-4" />
            Add
          </button>
        </div>
      )}
    </div>
  );
};

export default DepartmentSettings;
