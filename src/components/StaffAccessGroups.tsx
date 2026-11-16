import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccessEvent, AccessGroup, AccessGroupPage, STAFF_PERMISSIONS, StaffPermission, staffAccessService } from '../services/staffAccessService';
import { useStaffAccess } from '../contexts/StaffAccessContext';
import { workflowError } from '../services/staffWorkflowService';

const button = 'rounded-lg border bg-white px-4 py-2.5 text-sm disabled:opacity-50';
const primary = 'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50';
const field = 'w-full rounded-lg border bg-white px-3 py-2.5 text-sm';

function GroupForm({ page, existing, saving, onSave, onCancel }: {
  page: AccessGroupPage; existing?: AccessGroup; saving: boolean; onCancel: () => void;
  onSave: (name: string, permissions: StaffPermission[], members: string[], enabled: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [permissions, setPermissions] = useState<StaffPermission[]>(existing?.permissions || []);
  const [members, setMembers] = useState((existing?.member_ids || []).filter(id => page.employees.some(u => u.id === id && u.is_active === true)));
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [search, setSearch] = useState('');
  const [confirming, setConfirming] = useState(false);
  const employees = page.employees.filter(u => u.is_active === true && `${u.name} ${u.department || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <form className="space-y-4 rounded-xl border border-blue-200 bg-white p-4 sm:p-6" onSubmit={async e => { e.preventDefault(); if (!confirming) { setConfirming(true); return; } await onSave(name, permissions, members, enabled); }}>
    <h2 className="text-lg font-semibold">{existing ? 'Edit access group' : 'Create access group'}</h2>
    <fieldset disabled={saving || confirming} className="space-y-4">
      <label className="block space-y-1 text-sm font-medium">Group name<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} className={field} /></label>
      <div className="space-y-2"><h3 className="text-sm font-semibold">Permissions</h3>{Object.entries(STAFF_PERMISSIONS).map(([permission, text]) => <label key={permission} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={permissions.includes(permission as StaffPermission)} onChange={() => setPermissions(current => current.includes(permission as StaffPermission) ? current.filter(p => p !== permission) : [...current, permission as StaffPermission])} /><span>{text}</span>
      </label>)}</div>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Group enabled</label>
      <p className="text-xs text-gray-500">Disabling a group revokes its permissions. Membership in other enabled groups still applies.</p>
      <div className="space-y-2"><h3 className="text-sm font-semibold">Members · {members.length} selected</h3>
        <input aria-label="Find group members" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees or departments..." className={field} />
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">{employees.map(u => <label key={u.id} className="flex cursor-pointer items-center gap-3 rounded p-2 text-sm hover:bg-gray-50">
          <input type="checkbox" className="h-4 w-4" checked={members.includes(u.id)} onChange={() => setMembers(current => current.includes(u.id) ? current.filter(id => id !== u.id) : [...current, u.id])} /><span>{u.name}<span className="ml-2 text-xs text-gray-500">{u.department}</span></span>
        </label>)}{!employees.length && <p className="p-3 text-sm text-gray-500">No active employees match.</p>}</div>
        {existing?.member_ids.some(id => !page.employees.some(u => u.id === id && u.is_active === true)) && <p className="text-xs text-amber-800">Inactive members are removed when saving. Their previous membership remains in history.</p>}
      </div>
    </fieldset>
    {confirming && <div className="space-y-2 rounded-lg bg-amber-50 p-4 text-sm"><p className="font-semibold">Review access changes</p><p>{enabled ? `${members.length} selected member(s) will receive these permissions through ${name}.` : `This group will be disabled for all ${members.length} selected member(s).`}</p><ul className="list-inside list-disc">{permissions.map(p => <li key={p}>{STAFF_PERMISSIONS[p]}</li>)}</ul>{!permissions.length && <p>No permissions selected.</p>}<p>Users retain their base roles and permissions from other groups.</p></div>}
    <div className="flex flex-wrap gap-2"><button disabled={saving} className={primary}>{saving ? 'Saving...' : confirming ? 'Confirm access changes' : 'Review changes'}</button>{confirming && <button type="button" disabled={saving} onClick={() => setConfirming(false)} className={button}>Back to editing</button>}<button type="button" disabled={saving} onClick={onCancel} className={button}>Cancel</button></div>
  </form>;
}

export default function StaffAccessGroups() {
  const { refresh: refreshAccess } = useStaffAccess();
  const [page, setPage] = useState<AccessGroupPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<{ existing?: AccessGroup } | null>(null);
  const [historyGroup, setHistoryGroup] = useState<AccessGroup | null>(null);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    staffAccessService.groups().then(value => { if (active) setPage(value); }).catch(err => { if (active) setError(workflowError(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);
  useEffect(() => {
    if (!historyGroup) return;
    let active = true; setHistoryLoading(true); setEvents([]);
    staffAccessService.history(historyGroup.id, offset).then(value => { if (active) { setEvents(value); setMore(value.length === 20); } }).catch(err => { if (active) setError(workflowError(err)); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [historyGroup, offset]);
  return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link to="/team" className="text-sm text-blue-700">← Team management</Link><h1 className="mt-2 text-2xl font-bold">Access groups</h1><p className="mt-1 text-sm text-gray-600">Delegate staff workflows while retaining each employee's existing role.</p></div>
      <div className="flex gap-2"><button disabled={loading || saving} onClick={() => setVersion(v => v + 1)} className={button}>Refresh</button><button disabled={saving || loading} onClick={() => { setEditor({}); setHistoryGroup(null); }} className={primary}>Create group</button></div></div>
    <p className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">Only full admins can change groups or membership. These groups do not grant payroll, salary, settings, user deletion, punch editing, or access-management permissions. Members cannot approve their own leave or attendance requests, or certify their own training.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-4 text-sm text-green-800">{notice}</p>}
    {loading && <p role="status">Loading access groups...</p>}
    {page && editor && <GroupForm key={editor.existing?.id || 'new'} page={page} existing={editor.existing} saving={saving} onCancel={() => setEditor(null)} onSave={async (name, permissions, members, enabled) => {
      setSaving(true); setError(''); setNotice('');
      try {
        await staffAccessService.save(name, permissions, members, enabled, editor.existing);
        setEditor(null); setHistoryGroup(null); setNotice('Access group saved. Backend permissions take effect immediately.');
        setVersion(v => v + 1); await refreshAccess(); window.dispatchEvent(new Event('staff-access-updated'));
      } catch (err) { setError(workflowError(err)); } finally { setSaving(false); }
    }} />}
    {page?.groups.map(group => <article key={group.id} className="space-y-3 rounded-xl border bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{group.name}</h2><span className={`rounded-full px-3 py-1 text-xs ${group.enabled ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{group.enabled ? 'Enabled' : 'Disabled'}</span></div>
      <ul className="list-inside list-disc text-sm text-gray-600">{group.permissions.map(p => <li key={p}>{STAFF_PERMISSIONS[p]}</li>)}</ul>
      <p className="text-sm text-gray-600">Members: {group.member_ids.map(id => { const u = page.employees.find(user => user.id === id); return `${u?.name || 'Former employee'}${u?.is_active !== true ? ' (inactive)' : ''}`; }).join(', ') || 'None assigned'}</p>
      <div className="flex gap-2"><button disabled={saving || loading} className={button} onClick={() => { setEditor({ existing: group }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit permissions / members</button><button disabled={saving} className={button} onClick={() => { setHistoryGroup(group); setOffset(0); }}>Change history</button></div>
    </article>)}
    {historyGroup && <section className="space-y-3 rounded-xl border bg-white p-4"><h2 className="font-semibold">Access history · {historyGroup.name}</h2>
      {historyLoading ? <p role="status">Loading changes...</p> : !events.length ? <p className="text-sm text-gray-500">No changes recorded.</p> : events.map(event => <div key={event.id} className="space-y-2 rounded-lg border p-3 text-sm"><p className="font-medium">{event.actor_name} · {new Date(event.created_at).toLocaleString()}</p>
        {event.before_value && <p>Before: {event.before_value.name} · {event.before_value.enabled ? 'Enabled' : 'Disabled'} · {event.before_value.permissions.map(p => STAFF_PERMISSIONS[p]).join('; ') || 'No permissions'} · Members: {event.before_value.members.map(u => u.name).join(', ') || 'None'}</p>}
        <p>After: {event.after_value.name} · {event.after_value.enabled ? 'Enabled' : 'Disabled'} · {event.after_value.permissions.map(p => STAFF_PERMISSIONS[p]).join('; ') || 'No permissions'} · Members: {event.after_value.members.map(u => u.name).join(', ') || 'None'}</p>
      </div>)}<div className="flex gap-2"><button disabled={offset === 0 || historyLoading} className={button} onClick={() => setOffset(v => Math.max(0, v - 20))}>Newer</button><button disabled={!more || historyLoading} className={button} onClick={() => setOffset(v => v + 20)}>Older</button><button className={button} onClick={() => setHistoryGroup(null)}>Close history</button></div>
    </section>}
  </div>;
}
