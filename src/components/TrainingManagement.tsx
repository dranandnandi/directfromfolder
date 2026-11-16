import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useStaffAccess } from '../contexts/StaffAccessContext';
import { HiAcademicCap, HiCalendar, HiDownload, HiPlus, HiRefresh } from 'react-icons/hi';
import { documentService } from '../services/documentService';
import { trainingService } from '../services/trainingService';
import type { AttendanceStatus, CompletionStatus, TrainingAttendee, TrainingData, TrainingEvent, TrainingSession, TrainingSessionInput } from '../services/trainingService';
import { localTrainingDateTime, trainingCsv, trainingSummary } from '../utils/training';

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm disabled:bg-gray-100';
const button = 'rounded-lg border bg-white px-4 py-2.5 text-sm font-medium disabled:opacity-50';
const primary = 'rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50';
const label = (value: string) => value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const errorText = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unable to complete this action. Please try again.';

function Badge({ value }: { value: string }) {
  const style = value === 'completed' || value === 'attended' ? 'bg-green-100 text-green-800'
    : value === 'cancelled' || value === 'absent' ? 'bg-red-100 text-red-800' : 'bg-blue-50 text-blue-800';
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{label(value)}</span>;
}

function SessionEditor({ data, existing, saving, onCancel, onSave }: {
  data: TrainingData; existing?: TrainingSession; saving: boolean; onCancel: () => void;
  onSave: (input: TrainingSessionInput, attendees: string[]) => Promise<void>;
}) {
  const [title, setTitle] = useState(existing?.title || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [trainer, setTrainer] = useState(existing?.trainer || '');
  const [location, setLocation] = useState(existing?.location || '');
  const [start, setStart] = useState(existing ? localTrainingDateTime(existing.starts_at) : '');
  const [end, setEnd] = useState(existing ? localTrainingDateTime(existing.ends_at) : '');
  const [material, setMaterial] = useState(existing?.material_document_id || '');
  const current = data.attendees.filter(a => a.session_id === existing?.id);
  const [selected, setSelected] = useState<string[]>(current.map(a => a.user_id));
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [validation, setValidation] = useState('');
  const locked = current.filter(a => a.attendance_status !== 'invited' || a.completion_status !== 'pending' || a.notes);
  const datesLocked = current.some(a => a.attendance_status !== 'invited' || a.completion_status !== 'pending');
  const employees = data.employees.filter(u => u.is_active === true || selected.includes(u.id));
  const visible = employees.filter(u => (!department || u.department === department)
    && `${u.name} ${u.department || ''}`.toLowerCase().includes(search.toLowerCase()));
  const toggle = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return <form className="space-y-5 rounded-xl border border-blue-200 bg-white p-4 sm:p-6" onSubmit={async event => {
    event.preventDefault();
    setValidation('');
    if (!selected.length) { setValidation('Select at least one attendee.'); return; }
    if (!start || !end || new Date(end) <= new Date(start)) { setValidation('End time must be after start time.'); return; }
    await onSave({ title: title.trim(), description, trainer, location,
      starts_at: datesLocked && existing ? existing.starts_at : new Date(start).toISOString(),
      ends_at: datesLocked && existing ? existing.ends_at : new Date(end).toISOString(),
      material_document_id: material || null }, selected);
  }}>
    <h2 className="text-lg font-semibold">{existing ? 'Edit training session' : 'Schedule training'}</h2>
    <fieldset disabled={saving} className="space-y-4">
      <label className="block space-y-1 text-sm font-medium">Training title<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} className={field} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm font-medium">Trainer<input value={trainer} onChange={e => setTrainer(e.target.value)} className={field} /></label>
        <label className="block space-y-1 text-sm font-medium">Location or meeting link<input value={location} onChange={e => setLocation(e.target.value)} className={field} /></label>
        <label className="block space-y-1 text-sm font-medium">Starts<input required type="datetime-local" disabled={datesLocked} value={start} onChange={e => setStart(e.target.value)} className={field} /></label>
        <label className="block space-y-1 text-sm font-medium">Ends<input required type="datetime-local" disabled={datesLocked} value={end} onChange={e => setEnd(e.target.value)} className={field} /></label>
      </div>
      <p className="text-xs text-gray-500">Times use {timezone}.{datesLocked ? ' Dates are locked because attendance has been recorded.' : ''}</p>
      <label className="block space-y-1 text-sm font-medium">Description<textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} className={field} /></label>
      <label className="block space-y-1 text-sm font-medium">Training material (optional)
        <select value={material} onChange={e => setMaterial(e.target.value)} className={field}>
          <option value="">No linked document</option>
          {material && !data.materials.some(m => m.id === material) && <option value={material}>Previously linked document</option>}
          {data.materials.map(m => <option key={m.id} value={m.id}>{m.original_file_name}</option>)}
        </select>
      </label>
      <p className="text-xs text-gray-500">Upload files through Training → Training materials, or ask a training materials manager to add them.</p>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Attendees · {selected.length} selected</h3>
          <button type="button" className="text-sm font-medium text-blue-700" onClick={() => setSelected(ids => [...new Set([...ids, ...visible.filter(u => u.is_active === true).map(u => u.id)])])}>Select filtered employees</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input aria-label="Find attendees" placeholder="Find employees..." value={search} onChange={e => setSearch(e.target.value)} className={field} />
          <select aria-label="Attendee department" value={department} onChange={e => setDepartment(e.target.value)} className={field}>
            <option value="">All departments</option>{[...new Set(employees.map(u => u.department).filter(Boolean))].sort().map(d => <option key={d!} value={d!}>{d}</option>)}
          </select>
        </div>
        <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-2">
          {!visible.length && <p className="p-3 text-sm text-gray-500">No employees match.</p>}
          {visible.map(u => <label key={u.id} className="flex cursor-pointer items-center gap-3 rounded p-2 text-sm hover:bg-gray-50">
            <input type="checkbox" checked={selected.includes(u.id)} disabled={locked.some(a => a.user_id === u.id)} onChange={() => toggle(u.id)} className="h-4 w-4" />
            <span>{u.name}<span className="ml-2 text-xs text-gray-500">{u.department}{u.is_active !== true ? ' · Inactive' : ''}{locked.some(a => a.user_id === u.id) ? ' · Record retained' : ''}</span></span>
          </label>)}
        </div>
      </div>
    </fieldset>
    {validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}
    <div className="flex flex-wrap gap-2"><button disabled={saving} type="submit" className={primary}>{saving ? 'Saving...' : existing ? 'Save session' : 'Schedule training'}</button><button disabled={saving} type="button" onClick={onCancel} className={button}>Cancel</button></div>
  </form>;
}

function RecordEditor({ attendee, saving, onCancel, onSave }: {
  attendee: TrainingAttendee; saving: boolean; onCancel: () => void;
  onSave: (attendance: AttendanceStatus, completion: CompletionStatus, notes: string) => Promise<void>;
}) {
  const [attendance, setAttendance] = useState(attendee.attendance_status);
  const [completion, setCompletion] = useState(attendee.completion_status);
  const [notes, setNotes] = useState(attendee.notes);
  return <form className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4" onSubmit={async e => { e.preventDefault(); await onSave(attendance, completion, notes); }}>
    <h4 className="font-semibold">Record training · {attendee.employee_name}</h4>
    <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Attendance<select className={field} value={attendance} onChange={e => { const value = e.target.value as AttendanceStatus; setAttendance(value); if (value !== 'attended') setCompletion('pending'); }}>
        {['invited', 'attended', 'absent', 'excused'].map(s => <option key={s} value={s}>{label(s)}</option>)}
      </select></label>
      <label className="space-y-1 text-sm">Completion<select className={field} value={completion} disabled={attendance !== 'attended'} onChange={e => setCompletion(e.target.value as CompletionStatus)}>
        {['pending', 'in_progress', 'completed'].map(s => <option key={s} value={s}>{label(s)}</option>)}
      </select></label>
      <label className="space-y-1 text-sm sm:col-span-2">Notes (visible to the employee)<textarea rows={2} className={field} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    </fieldset>
    <p className="text-xs text-gray-600">Completion is available after attendance is marked. Changes and the recording admin are saved in history.</p>
    <div className="flex gap-2"><button disabled={saving} className={primary}>Save record</button><button disabled={saving} type="button" className={button} onClick={onCancel}>Cancel</button></div>
  </form>;
}

function History({ sessionId, revision }: { sessionId: string; revision: number }) {
  const [events, setEvents] = useState<TrainingEvent[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setEvents(null); setError('');
    trainingService.history(sessionId).then(value => { if (active) setEvents(value); }).catch(err => { if (active) setError(errorText(err)); });
    return () => { active = false; };
  }, [sessionId, revision]);
  return <div className="max-h-96 space-y-3 overflow-y-auto pt-3">
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!events && !error && <p role="status" className="text-sm text-gray-500">Loading history...</p>}
    {events?.map(event => <div key={event.id} className="rounded-lg border bg-gray-50 p-3 text-sm">
      <p className="font-medium">{label(event.event_type)} · {event.actor_name}</p><p className="mt-1 text-xs text-gray-500">{dateTime(event.created_at)}</p>
      {event.event_type === 'attendee_updated' ? <div className="mt-2 space-y-1">
        <p>{String(event.after_value?.employee_name || '')}</p>
        <p>Attendance: {label(String(event.before_value?.attendance_status || ''))} → {label(String(event.after_value?.attendance_status || ''))}</p>
        <p>Completion: {label(String(event.before_value?.completion_status || ''))} → {label(String(event.after_value?.completion_status || ''))}</p>
        {event.before_value?.notes !== event.after_value?.notes && <p className="whitespace-pre-wrap break-words">Notes: {String(event.before_value?.notes || '(none)')} → {String(event.after_value?.notes || '(none)')}</p>}
      </div> : event.event_type === 'session_status_changed' ? <p className="mt-2">{label(String(event.before_value?.status))} → {label(String(event.after_value?.status))}</p>
        : event.event_type.startsWith('attendee_') ? <p className="mt-2">{String(event.after_value?.employee_name || event.before_value?.employee_name || '')}</p>
          : <div className="mt-2 space-y-1"><p>{String(event.after_value?.title || '')}</p>
            {event.before_value && <p>Previously: {String(event.before_value.title)} · {dateTime(String(event.before_value.starts_at))} – {dateTime(String(event.before_value.ends_at))}</p>}
            <p>{dateTime(String(event.after_value?.starts_at))} – {dateTime(String(event.after_value?.ends_at))}</p>
            <p>Trainer: {String(event.after_value?.trainer || 'Not specified')} · Location: {String(event.after_value?.location || 'Not specified')}</p>
          </div>}
    </div>)}
    {events?.length === 0 && <p className="text-sm text-gray-500">No changes recorded.</p>}
  </div>;
}

export default function TrainingManagement() {
  const { access, can } = useStaffAccess();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('session') || '';
  const [data, setData] = useState<TrainingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<'schedule' | 'records'>('schedule');
  const [editor, setEditor] = useState<{ existing?: TrainingSession } | null>(null);
  const [record, setRecord] = useState<TrainingAttendee | null>(null);
  const [confirm, setConfirm] = useState<'completed' | 'cancelled' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('all');
  const [employee, setEmployee] = useState('');
  const [completion, setCompletion] = useState('');
  const detailsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    setData(null); setEditor(null); setRecord(null);
    if (!access) return;
    setLoading(true);
    trainingService.load().then(value => { if (active) setData(value); }).catch(err => { if (active) setError(errorText(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [access?.user_id, access?.permissions.join('|')]);

  const refresh = async () => {
    setLoading(true); setError('');
    try { setData(await trainingService.load()); setRevision(value => value + 1); }
    catch (err) { setError(errorText(err)); }
    finally { setLoading(false); }
  };
  const run = async (action: () => Promise<unknown>, message: string) => {
    setSaving(true); setError(''); setNotice('');
    try {
      await action();
      setNotice(message);
      try { setData(await trainingService.load()); setRevision(value => value + 1); }
      catch (err) { setError(`Saved successfully, but records could not refresh: ${errorText(err)} Use Refresh to reload.`); }
      return true;
    } catch (err) { setError(errorText(err)); return false; }
    finally { setSaving(false); }
  };
  const selected = data?.sessions.find(s => s.id === selectedId);
  const summary = useMemo(() => data ? trainingSummary(data.attendees, data.sessions) : null, [data]);
  const visibleSessions = useMemo(() => (data?.sessions || []).filter(s => `${s.title} ${s.trainer} ${s.location}`.toLowerCase().includes(search.toLowerCase())
    && (period === 'all' || (period === 'upcoming' ? s.status === 'scheduled' && new Date(s.ends_at).getTime() >= Date.now()
      : period === 'cancelled' ? s.status === 'cancelled' : s.status !== 'cancelled' && new Date(s.ends_at).getTime() < Date.now())))
    .sort((a, b) => {
      const futureA = new Date(a.ends_at).getTime() >= Date.now() && a.status === 'scheduled';
      const futureB = new Date(b.ends_at).getTime() >= Date.now() && b.status === 'scheduled';
      if (futureA !== futureB) return futureA ? -1 : 1;
      return futureA ? Date.parse(a.starts_at) - Date.parse(b.starts_at) : Date.parse(b.starts_at) - Date.parse(a.starts_at);
    }), [data, search, period]);
  const recordEmployees = useMemo(() => {
    const map = new Map<string, string>();
    data?.employees.forEach(u => map.set(u.id, u.name));
    data?.attendees.forEach(a => { if (!map.has(a.user_id)) map.set(a.user_id, a.employee_name); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);
  const rows = useMemo(() => (data?.attendees || []).filter(a => {
    const session = data?.sessions.find(s => s.id === a.session_id);
    return (!employee || a.user_id === employee) && (!completion || a.completion_status === completion)
      && `${a.employee_name} ${a.department} ${session?.title || ''}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => a.employee_name.localeCompare(b.employee_name) || (data?.sessions.find(s => s.id === b.session_id)?.starts_at || '').localeCompare(data?.sessions.find(s => s.id === a.session_id)?.starts_at || '')), [data, employee, completion, search]);
  const selectSession = (id: string) => {
    setParams({ session: id }); setRecord(null); setConfirm(null); setShowHistory(false);
  };
  const openRecordSession = (id: string) => { selectSession(id); setTab('schedule'); setSearch(''); setPeriod('all'); };
  useEffect(() => { if (selectedId && tab === 'schedule') detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [selectedId, tab]);

  return <div className="mx-auto max-w-7xl space-y-5 p-4 pb-8 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><HiAcademicCap className="text-blue-600" />Training</h1>
        <p className="mt-1 text-sm text-gray-600">{data?.isAdmin ? 'Schedule sessions, manage attendees, and keep individual training records.' : 'Your assigned sessions, attendance, and training completion history.'}</p></div>
      <div className="flex flex-wrap gap-2">{can('training_materials.manage') && <Link to="/training/materials" className={button}>Training materials</Link>}<button disabled={loading || saving} onClick={() => void refresh()} className={`${button} flex items-center gap-2`}><HiRefresh />Refresh</button>
        {data?.isAdmin && <button disabled={saving || loading} onClick={() => { setEditor({}); setTab('schedule'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className={`${primary} flex items-center gap-2`}><HiPlus />Schedule training</button>}
      </div>
    </div>
    {error && <div role="alert" className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-4 text-sm text-green-800">{notice}</p>}
    {loading && <p role="status" className="text-sm text-gray-500">Loading training...</p>}
    {data && <>
      {summary && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Assignments', summary.assigned], ['Attended', summary.attended], ['Completed', summary.completed], ['Outstanding', summary.outstanding]].map(([name, count]) => <div key={name} className="rounded-xl border bg-white p-4"><p className="text-xs text-gray-500">{name}</p><p className="mt-1 text-2xl font-semibold">{count}</p></div>)}</div>}
      <p className="text-xs text-gray-500">Counts exclude cancelled sessions. Closing a session keeps each attendee’s completion status unchanged.</p>
      {editor && <SessionEditor key={editor.existing?.id || 'new'} data={data} existing={editor.existing} saving={saving} onCancel={() => setEditor(null)} onSave={async (input, attendees) => {
        let savedId = '';
        if (await run(async () => { savedId = await trainingService.saveSession(input, attendees, editor.existing); }, editor.existing ? 'Training session updated.' : 'Training scheduled.')) {
          setEditor(null); selectSession(savedId);
        }
      }} />}
      <div className="flex gap-2 border-b pb-3" aria-label="Training views">
        <button disabled={saving} aria-pressed={tab === 'schedule'} onClick={() => { setTab('schedule'); setSearch(''); }} className={tab === 'schedule' ? primary : button}>Schedule</button>
        <button disabled={saving} aria-pressed={tab === 'records'} onClick={() => { setTab('records'); setSearch(''); setRecord(null); setConfirm(null); }} className={tab === 'records' ? primary : button}>{data.isAdmin ? 'Employee records' : 'My records'}</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <input aria-label="Search training" placeholder={tab === 'records' ? 'Search employee or training...' : 'Search training or trainer...'} value={search} onChange={e => setSearch(e.target.value)} className={field} />
        {tab === 'schedule' ? <select aria-label="Schedule filter" value={period} onChange={e => setPeriod(e.target.value)} className={field}><option value="all">All sessions</option><option value="upcoming">Upcoming / in progress</option><option value="past">Past sessions</option><option value="cancelled">Cancelled sessions</option></select>
          : <>{data.isAdmin && <select aria-label="Employee record filter" value={employee} onChange={e => setEmployee(e.target.value)} className={field}><option value="">All employees</option>{recordEmployees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}
            <select aria-label="Completion filter" value={completion} onChange={e => setCompletion(e.target.value)} className={field}><option value="">All completion statuses</option>{['pending', 'in_progress', 'completed'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></>}
      </div>
      {tab === 'schedule' ? <div className="grid items-start gap-5 xl:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {!visibleSessions.length && <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">{data.sessions.length ? 'No sessions match these filters.' : data.isAdmin ? 'Schedule your first training session to get started.' : 'You have no assigned training sessions yet.'}</div>}
          {visibleSessions.map(s => <button disabled={saving} key={s.id} onClick={() => selectSession(s.id)} className={`w-full space-y-2 rounded-xl border bg-white p-4 text-left ${selectedId === s.id ? 'border-blue-500 ring-1 ring-blue-500' : 'hover:border-blue-300'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="break-words font-semibold">{s.title}</h2><Badge value={s.status} /></div>
            <p className="flex items-center gap-2 text-xs text-gray-600"><HiCalendar className="shrink-0" />{dateTime(s.starts_at)}</p>
            <p className="text-xs text-gray-500">{s.trainer || 'Trainer not specified'} · {data.attendees.filter(a => a.session_id === s.id).length} {data.isAdmin ? 'attendee(s)' : 'personal assignment'}</p>
          </button>)}
        </div>
        <section ref={detailsRef} className="scroll-mt-4 space-y-4 rounded-xl border bg-white p-4 sm:p-5">
          {!selected ? <p className="text-sm text-gray-500">Select a training session to view details and records.</p> : <>
            <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 break-words text-xl font-semibold">{selected.title}</h2><Badge value={selected.status} /></div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-gray-500">Starts</dt><dd>{dateTime(selected.starts_at)}</dd></div><div><dt className="text-gray-500">Ends</dt><dd>{dateTime(selected.ends_at)}</dd></div>
              <div><dt className="text-gray-500">Trainer</dt><dd>{selected.trainer || 'Not specified'}</dd></div><div><dt className="text-gray-500">Location / meeting</dt><dd className="break-words">{/^https?:\/\//i.test(selected.location) ? <a href={selected.location} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{selected.location}</a> : selected.location || 'Not specified'}</dd></div>
            </dl>
            {selected.description && <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{selected.description}</p>}
            {selected.material_document_id && <button disabled={saving} className={`${button} flex items-center gap-2`} onClick={async () => {
              const popup = window.open('', '_blank');
              if (popup) popup.opener = null;
              try { const url = await documentService.getDownloadUrl(selected.material_document_id!); if (popup) popup.location.href = url; else window.location.assign(url); }
              catch (err) { popup?.close(); setError(errorText(err)); }
            }}><HiDownload />Open training material</button>}
            {data.isAdmin && selected.status === 'scheduled' && <div className="flex flex-wrap gap-2">
              <button disabled={saving || loading} className={button} onClick={() => { setEditor({ existing: selected }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit schedule / attendees</button>
              <button disabled={saving || loading} className={button} onClick={() => setConfirm('completed')}>Close session</button>
              <button disabled={saving || loading} className={`${button} text-red-700`} onClick={() => setConfirm('cancelled')}>Cancel session</button>
            </div>}
            {confirm && <div className="space-y-3 rounded-lg bg-amber-50 p-4 text-sm"><p>{confirm === 'cancelled' ? 'Cancel this training? It will stay in the schedule and employee history as cancelled.' : 'Close this session? All attendees must have attendance recorded. Individual completion can still be updated after closing.'}</p>
              <div className="flex gap-2"><button disabled={saving} className={primary} onClick={async () => { if (await run(() => trainingService.setStatus(selected, confirm), confirm === 'cancelled' ? 'Training cancelled.' : 'Training session closed.')) setConfirm(null); }}>Confirm {confirm === 'cancelled' ? 'cancellation' : 'close'}</button><button disabled={saving} className={button} onClick={() => setConfirm(null)}>Back</button></div>
            </div>}
            <h3 className="border-t pt-4 font-semibold">{data.isAdmin ? 'Attendees and completion' : 'Your training record'}</h3>
            {data.attendees.filter(a => a.session_id === selected.id).map(a => <div key={a.id} className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{a.employee_name}</p><p className="text-xs text-gray-500">{a.department}</p></div><div className="flex flex-wrap gap-2"><Badge value={a.attendance_status} /><Badge value={a.completion_status} /></div></div>
              {a.completed_at && <p className="text-xs text-green-700">Completed {dateTime(a.completed_at)}</p>}
              {a.notes && <p className="whitespace-pre-wrap break-words text-sm text-gray-600">{a.notes}</p>}
              {data.isAdmin && selected.status !== 'cancelled' && <button disabled={saving || loading || new Date(selected.starts_at).getTime() > Date.now() || (a.user_id === data.userId && !access?.full_admin)} className={button} onClick={() => setRecord(a)}>Record / update</button>}
              {data.isAdmin && a.user_id === data.userId && !access?.full_admin && <p className="text-xs text-gray-500">Another training manager must record your training.</p>}
              {record?.id === a.id && <RecordEditor key={`${a.id}-${record.updated_at}`} attendee={record} saving={saving} onCancel={() => setRecord(null)} onSave={async (attendance, progress, notes) => { if (await run(() => trainingService.recordAttendee(record, attendance, progress, notes), 'Training record saved.')) setRecord(null); }} />}
            </div>)}
            {data.isAdmin && new Date(selected.starts_at).getTime() > Date.now() && <p className="text-xs text-gray-500">Attendance and completion recording opens when training starts.</p>}
            <div className="border-t pt-3"><button aria-expanded={showHistory} className="text-sm font-medium text-blue-700" onClick={() => setShowHistory(value => !value)}>{showHistory ? 'Hide change history' : 'View change history'}</button>{showHistory && <History sessionId={selected.id} revision={revision} />}</div>
          </>}
        </section>
      </div> : <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-gray-600">{rows.length} training record(s){employee && rows.length === 0 ? ' · No training assigned to this employee.' : ''}</p>
          <button disabled={!rows.length || saving || loading} className={`${button} flex items-center gap-2`} onClick={() => {
            const url = URL.createObjectURL(new Blob([trainingCsv(data.sessions, rows)], { type: 'text/csv;charset=utf-8;' }));
            const link = document.createElement('a'); link.href = url; link.download = 'training-records.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}><HiDownload />Export records</button>
        </div>
        {employee && <div className="rounded-lg bg-blue-50 p-4 text-sm">{(() => { const counts = trainingSummary(data.attendees.filter(a => a.user_id === employee), data.sessions); return `${counts.assigned} assigned · ${counts.attended} attended · ${counts.completed} completed · ${counts.outstanding} outstanding`; })()}</div>}
        {!rows.length && <p className="rounded-xl border bg-white p-6 text-sm text-gray-500">No training records match these filters.</p>}
        {rows.map(a => { const session = data.sessions.find(s => s.id === a.session_id)!; return <article key={a.id} className="space-y-3 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{a.employee_name} · {session.title}</h2><p className="mt-1 text-xs text-gray-500">{a.department} · {dateTime(session.starts_at)} · {session.trainer || 'Trainer not specified'}</p></div><Badge value={session.status} /></div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-gray-500">Attendance</span><Badge value={a.attendance_status} /><span className="text-xs text-gray-500">Completion</span><Badge value={a.completion_status} /></div>
          {a.completed_at && <p className="text-xs text-green-700">Completed {dateTime(a.completed_at)}</p>}
          {a.notes && <p className="whitespace-pre-wrap break-words text-sm text-gray-600">{a.notes}</p>}
          <button disabled={saving} onClick={() => openRecordSession(session.id)} className="text-sm font-medium text-blue-700">Open session and history →</button>
        </article>; })}
      </div>}
    </>}
  </div>;
}
