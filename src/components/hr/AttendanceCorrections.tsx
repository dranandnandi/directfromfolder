import { FormEvent, useEffect, useRef, useState } from 'react';
import { HiPlus, HiRefresh, HiX } from 'react-icons/hi';
import { Attendance, AttendanceCorrectionRequest } from '../../models/attendance';
import { attendanceCorrectionService as service } from '../../services/attendanceCorrectionService';
import { attendanceDateTime, attendanceToday, validateCorrection } from '../../utils/attendanceCorrection';

const errorMessage = (error: unknown) => {
  const message = (error as { message?: string })?.message || 'Something went wrong. Please retry.';
  return /does not exist|schema cache|could not find.*function/i.test(message)
    ? 'Attendance correction requests are not available yet. Ask your administrator to install the attendance correction database update.' : message;
};
const displayTime = (value?: string | null) => value ? new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(value)) : 'Not recorded';

function CorrectionForm({ userId, initialDate, onClose, onSubmitted }: {
  userId: string; initialDate: string; onClose: () => void; onSubmitted: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [day, setDay] = useState<Attendance | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [punchIn, setPunchIn] = useState('');
  const [punchOut, setPunchOut] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  const populate = (record: { punch_in_time?: string | null; punch_out_time?: string | null } | null, selectedDate: string) => {
    setPunchIn(record?.punch_in_time ? attendanceDateTime(record.punch_in_time) : `${selectedDate}T09:00:00`);
    setPunchOut(record?.punch_out_time ? attendanceDateTime(record.punch_out_time) : '');
  };
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError(''); setError(''); setDay(null); setSessionId('');
    void service.getDay(userId, date).then(record => {
      if (cancelled) return;
      setDay(record);
      const sessions = [...(record?.sessions || [])].sort((a, b) => a.punch_in_time.localeCompare(b.punch_in_time));
      setSessionId(sessions[0]?.id || '');
      populate(sessions[0] || record, date);
    }).catch(error => { if (!cancelled) setLoadError(errorMessage(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, date]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateCorrection(date, punchIn, punchOut, reason);
    if (problem) { setError(problem); return; }
    setSaving(true); setError('');
    try { await service.submit(date, punchIn, punchOut, reason, sessionId || null); onSubmitted(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setSaving(false); }
  };
  return <form onSubmit={submit} className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5" aria-label="Request attendance correction">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="font-semibold text-gray-900">Request a correction</h3><p className="mt-1 text-sm text-gray-600">Choose the actual times you worked. Your attendance changes only after another admin approves.</p></div>
      <button type="button" onClick={onClose} disabled={saving} aria-label="Close correction form" className="rounded p-2 hover:bg-blue-100"><HiX className="h-5 w-5" /></button>
    </div>
    <label className="block text-sm font-medium">Attendance date
      <input type="date" required value={date} max={attendanceToday()} onChange={event => setDate(event.target.value)} disabled={saving} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-3 sm:w-64" />
    </label>
    {loading ? <p role="status" className="text-sm text-gray-600">Loading recorded punches...</p> : loadError ? <p role="alert" className="text-sm text-red-700">{loadError}</p> : <>
      {!!day?.sessions?.length && <label className="block text-sm font-medium">Session to correct
        <select value={sessionId} disabled={saving} onChange={event => { setSessionId(event.target.value); populate(day.sessions?.find(session => session.id === event.target.value) || null, date); }} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-3">
          {[...day.sessions].sort((a, b) => a.punch_in_time.localeCompare(b.punch_in_time)).map(session => <option key={session.id} value={session.id}>{displayTime(session.punch_in_time)} → {displayTime(session.punch_out_time)}</option>)}
        </select>
      </label>}
      {!day?.punch_in_time && !day?.sessions?.length && <p className="rounded-lg bg-white p-3 text-sm text-gray-600">No punches are recorded for this date. Approval will create an attendance record using your proposed times.</p>}
      <p className="text-xs text-gray-600">All times are Indian Standard Time (IST). For an overnight shift, set punch-out to the following date.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">Actual punch-in<input type="datetime-local" step="1" required value={punchIn} disabled={saving} onChange={event => setPunchIn(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-gray-300 bg-white p-3" /></label>
        <label className="min-w-0 text-sm font-medium">Actual punch-out<input type="datetime-local" step="1" required value={punchOut} disabled={saving} onChange={event => setPunchOut(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-gray-300 bg-white p-3" /></label>
      </div>
      <label className="block text-sm font-medium">Reason<textarea required minLength={5} maxLength={2000} rows={3} value={reason} disabled={saving} onChange={event => setReason(event.target.value)} placeholder="For example, I missed punching out after completing my shift." className="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-3" /></label>
    </>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <button type="submit" disabled={saving || loading || !!loadError} className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{saving ? 'Submitting...' : 'Submit for approval'}</button>
  </form>;
}

export default function AttendanceCorrections({ organizationId, userId, isAdmin, selectedDate, onChanged }: {
  organizationId: string; userId: string; isAdmin: boolean; selectedDate: string; onChanged: () => void;
}) {
  const [scope, setScope] = useState<'mine' | 'team'>(isAdmin ? 'team' : 'mine');
  const [status, setStatus] = useState(isAdmin ? 'pending' : 'all');
  const [requests, setRequests] = useState<AttendanceCorrectionRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [version, setVersion] = useState(0);
  const [decision, setDecision] = useState<{ request: AttendanceCorrectionRequest; action: 'approve' | 'reject' | 'cancel' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const teamView = isAdmin && scope === 'team';
  const refresh = () => { setPage(0); setVersion(value => value + 1); };
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true); setError('');
    void service.list(organizationId, teamView ? null : userId, status, page).then(result => {
      if (current !== generation.current) return;
      setRequests(previous => page === 0 ? result.requests : [...previous, ...result.requests]);
      setTotal(result.total);
    }).catch(error => { if (current === generation.current) setError(errorMessage(error)); })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [organizationId, userId, teamView, status, page, version]);

  const decide = async (event: FormEvent) => {
    event.preventDefault();
    if (!decision) return;
    setBusy(true); setError('');
    try {
      await service.decide(decision.request.id, decision.action, note);
      setNotice(decision.action === 'approve' ? 'Correction approved. Attendance has been updated.' : decision.action === 'reject' ? 'Correction rejected. Attendance is unchanged.' : 'Request cancelled. Attendance is unchanged.');
      setDecision(null); refresh(); onChanged();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  return <section id="correction-requests" className="scroll-mt-24 space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-label="Attendance correction requests">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-gray-900">Attendance corrections</h2><p className="mt-1 text-sm text-gray-600">Request missed punches or corrected times, and track each decision.</p></div>
      <div className="flex gap-2"><button type="button" onClick={refresh} disabled={loading || busy} aria-label="Refresh correction requests" className="rounded-lg border p-3 disabled:opacity-50"><HiRefresh className={loading ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} /></button><button type="button" onClick={() => { setShowForm(true); setNotice(''); }} disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white"><HiPlus />Request correction</button></div>
    </div>
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {showForm && <CorrectionForm userId={userId} initialDate={selectedDate} onClose={() => setShowForm(false)} onSubmitted={() => { setShowForm(false); setNotice('Request submitted. Your recorded attendance stays unchanged until approval.'); setScope('mine'); setStatus('all'); refresh(); }} />}
    <div className="flex flex-wrap items-center gap-3">
      {isAdmin && <div className="flex rounded-lg bg-gray-100 p-1" role="group" aria-label="Request scope">{(['mine', 'team'] as const).map(value => <button key={value} type="button" disabled={busy} aria-pressed={scope === value} onClick={() => { setScope(value); setPage(0); setRequests([]); setDecision(null); }} className={`rounded-md px-3 py-2 text-sm ${scope === value ? 'bg-white font-medium shadow-sm' : 'text-gray-600'}`}>{value === 'mine' ? 'My requests' : 'Team requests'}</button>)}</div>}
      <label className="flex items-center gap-2 text-sm">Status<select value={status} disabled={busy} onChange={event => { setStatus(event.target.value); setPage(0); setRequests([]); setDecision(null); }} className="rounded-lg border border-gray-300 bg-white p-2">{['all', 'pending', 'approved', 'rejected', 'cancelled'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
      <span className="text-xs text-gray-500">Times shown in IST</span>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {decision && <form onSubmit={decide} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="Review correction request">
      <p className="font-medium">{decision.action === 'approve' ? 'Approve and apply these times?' : decision.action === 'reject' ? 'Reject this correction?' : 'Cancel your pending request?'}</p>
      <p className="text-sm">{decision.request.employee?.name} · {decision.request.attendance_date}<br />{displayTime(decision.request.proposed_punch_in)} → {displayTime(decision.request.proposed_punch_out)}</p>
      <label className="block text-sm">{decision.action === 'reject' ? 'Reason for rejection (required)' : 'Note (optional)'}<textarea value={note} disabled={busy} required={decision.action === 'reject'} minLength={decision.action === 'reject' ? 3 : undefined} maxLength={2000} rows={2} onChange={event => setNote(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 p-3" /></label>
      <div className="flex gap-2"><button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving...' : 'Confirm'}</button><button type="button" disabled={busy} onClick={() => setDecision(null)} className="rounded-lg border px-4 py-3 text-sm">Back</button></div>
    </form>}
    {loading && <p role="status" className="text-sm text-gray-500">Loading requests...</p>}
    {!loading && !error && requests.length === 0 && <p className="rounded-lg bg-gray-50 p-5 text-sm text-gray-600">No {status === 'all' ? '' : `${status} `}correction requests. {teamView ? 'Employee requests will appear here for review.' : 'Submit a request above if your attendance needs a correction.'}</p>}
    <div className="space-y-3">{requests.map(request => {
      const original = request.session_id ? request.before_snapshot.sessions.find(session => session.id === request.session_id) : request.before_snapshot.attendance;
      const colours = { pending: 'bg-amber-50 text-amber-800', approved: 'bg-green-50 text-green-800', rejected: 'bg-red-50 text-red-800', cancelled: 'bg-gray-100 text-gray-700' };
      return <article key={request.id} className="space-y-3 rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-medium">{teamView ? `${request.employee?.name || 'Employee'} · ` : ''}{request.attendance_date}</h3><p className="text-xs text-gray-500">{teamView && request.employee?.department ? `${request.employee.department} · ` : ''}Submitted {displayTime(request.created_at)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${colours[request.status]}`}>{request.status}</span></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-gray-500">Recorded times</dt><dd className="mt-1">{displayTime(original?.punch_in_time)} → {displayTime(original?.punch_out_time)}</dd></div><div><dt className="text-gray-500">Requested times</dt><dd className="mt-1 font-medium">{displayTime(request.proposed_punch_in)} → {displayTime(request.proposed_punch_out)}</dd></div></dl>
        <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{request.reason}</p>
        {request.reviewed_at && <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{request.status === 'cancelled' ? 'Cancelled' : 'Reviewed'} by {request.reviewer_name || 'administrator'} · {displayTime(request.reviewed_at)}{request.decision_note ? `\n${request.decision_note}` : ''}</p>}
        {request.status === 'pending' && <div className="flex flex-wrap gap-2">
          {request.user_id === userId ? <button type="button" disabled={busy} onClick={() => { setDecision({ request, action: 'cancel' }); setNote(''); }} className="rounded-lg border px-3 py-2 text-sm">Cancel request</button> : teamView && <><button type="button" disabled={busy} onClick={() => { setDecision({ request, action: 'approve' }); setNote(''); }} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white">Approve</button><button type="button" disabled={busy} onClick={() => { setDecision({ request, action: 'reject' }); setNote(''); }} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">Reject</button></>}
          {request.user_id === userId && isAdmin && <p className="self-center text-xs text-gray-500">Another admin must review your request.</p>}
        </div>}
      </article>;
    })}</div>
    {requests.length < total && !error && <button type="button" disabled={loading || busy} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Load more ({requests.length} of {total})</button>}
  </section>;
}
