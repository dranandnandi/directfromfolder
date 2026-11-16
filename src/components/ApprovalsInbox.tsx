import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HiRefresh, HiClock, HiCheckCircle } from 'react-icons/hi';
import { ApprovalPage, StaffApproval, staffWorkflowService, workflowError } from '../services/staffWorkflowService';
import { approvalLabels, isOverdueRequest, workflowDate } from '../utils/staffWorkflows';
import { useStaffAccess } from '../contexts/StaffAccessContext';

const statuses = ['pending', 'approved', 'rejected', 'cancelled', 'all'];
const statusStyle: Record<string, string> = { pending: 'bg-amber-50 text-amber-800', approved: 'bg-green-50 text-green-800', rejected: 'bg-red-50 text-red-800', cancelled: 'bg-gray-100 text-gray-700' };
const valueLabel = (value: unknown): string => value === true ? 'Yes' : value === false ? 'No' : value == null ? 'Not recorded'
  : typeof value === 'object' ? Object.entries(value).map(([key, item]) => `${key.replace(/_/g, ' ')}: ${valueLabel(item)}`).join('; ') : String(value);

function ApprovalContext({ item }: { item: StaffApproval }) {
  const details = item.details;
  if (item.kind === 'leave') return <div className="space-y-2 text-sm text-gray-700"><p>{details.category || 'Leave'} · {String(details.duration || '').replace(/_/g, ' ')} · {workflowDate(details.start_date)} to {workflowDate(details.end_date)}</p><details><summary className="cursor-pointer font-medium text-blue-700">View original request</summary><p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3">{details.description}</p></details></div>;
  if (item.kind === 'ai_review') return <div className="space-y-2 text-sm"><p className="text-gray-600">Confidence: {typeof details.confidence === 'number' ? `${Math.round(details.confidence * 100)}%` : 'Not available'}. This records the review; it does not apply unverified AI changes to attendance.</p><dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-gray-500">Recorded values</dt><dd className="mt-1 break-words">{valueLabel(details.previous)}</dd></div><div><dt className="text-gray-500">Suggested values</dt><dd className="mt-1 break-words">{valueLabel(details.next)}</dd></div></dl></div>;
  const before = details.session_id ? details.before?.sessions?.find((session: any) => session.id === details.session_id) : details.before?.attendance;
  return <dl className="grid gap-3 text-sm sm:grid-cols-2">
    {item.kind === 'correction' && <div><dt className="text-gray-500">Recorded times</dt><dd className="mt-1">{workflowDate(before?.punch_in_time)} → {workflowDate(before?.punch_out_time)}</dd></div>}
    <div><dt className="text-gray-500">{item.kind === 'correction' ? 'Requested times' : 'Attendance times'}</dt><dd className="mt-1 font-medium">{workflowDate(details.punch_in)} → {workflowDate(details.punch_out)}</dd></div>
  </dl>;
}

export default function ApprovalsInbox() {
  const { access, can } = useStaffAccess();
  const allowedKinds = Object.entries(approvalLabels).filter(([key]) => key === 'leave' ? can('leave.approve') : key === 'ai_review' ? access?.full_admin : can('attendance.approve'));
  const [params, setParams] = useSearchParams();
  const requestedKind = params.get('kind') || 'all';
  const kind = requestedKind === 'all' || allowedKinds.some(([key]) => key === requestedKind) ? requestedKind : 'all';
  const status = statuses.includes(params.get('status') || '') ? params.get('status')! : 'pending';
  const [page, setPage] = useState<ApprovalPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);
  const [decision, setDecision] = useState<{ item: StaffApproval; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void staffWorkflowService.approvals(status, kind, offset).then(result => { if (!cancelled) setPage(result); })
      .catch(error => { if (!cancelled) { setPage(null); setError(workflowError(error)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status, kind, offset, version, access]);
  const filter = (key: string, value: string) => { setParams(current => { current.set(key, value); return current; }); setOffset(0); setPage(null); setDecision(null); };
  const review = async (event: FormEvent) => {
    event.preventDefault(); if (!decision) return;
    setSaving(true); setError('');
    try {
      await staffWorkflowService.review(decision.item.kind, decision.item.id, decision.action, note);
      setNotice(`${approvalLabels[decision.item.kind]} request ${decision.action === 'approve' ? 'approved' : 'rejected'}.`);
      setDecision(null); setOffset(0); setVersion(value => value + 1);
      window.dispatchEvent(new Event('staff-workflow-updated'));
    } catch (error) { setError(workflowError(error)); }
    finally { setSaving(false); }
  };
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-gray-900">Approvals inbox</h1><p className="mt-1 text-sm text-gray-600">Leave, punch corrections, attendance exceptions and AI reviews in one place.</p></div><button onClick={() => setVersion(value => value + 1)} disabled={loading || saving} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-3 text-sm"><HiRefresh />Refresh</button></header>
    <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border bg-white p-4"><p className="flex items-center gap-2 text-sm text-gray-600"><HiCheckCircle />Awaiting a decision</p><p className="mt-2 text-2xl font-semibold">{page?.pending_count ?? '—'}</p></div><div className="rounded-xl border bg-white p-4"><p className="flex items-center gap-2 text-sm text-gray-600"><HiClock />Waiting over 24 hours</p><p className="mt-2 text-2xl font-semibold text-amber-700">{page?.overdue_count ?? '—'}</p></div></div>
    <div className="flex flex-wrap gap-3 rounded-xl border bg-white p-4"><label className="text-sm">Request type<select value={kind} disabled={saving} onChange={event => filter('kind', event.target.value)} className="ml-2 rounded-lg border p-2"><option value="all">All permitted types</option>{allowedKinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm">Status<select value={status} disabled={saving} onChange={event => filter('status', event.target.value)} className="ml-2 rounded-lg border p-2">{statuses.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label></div>
    {notice && <p role="status" className="rounded-lg bg-green-50 p-4 text-sm text-green-800">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {decision && <form onSubmit={review} className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4"><h2 className="font-semibold">{decision.action === 'approve' ? 'Approve' : 'Reject'} {decision.item.employee_name}'s {approvalLabels[decision.item.kind].toLowerCase()} request?</h2><ApprovalContext item={decision.item} /><label className="block text-sm font-medium">{decision.action === 'reject' ? 'Reason for rejection (required)' : 'Decision note (optional)'}<textarea required={decision.action === 'reject'} minLength={decision.action === 'reject' ? 3 : undefined} maxLength={2000} rows={3} value={note} disabled={saving} onChange={event => setNote(event.target.value)} className="mt-1 block w-full rounded-lg border p-3" /></label><div className="flex gap-2"><button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving...' : 'Confirm decision'}</button><button type="button" disabled={saving} onClick={() => setDecision(null)} className="rounded-lg border bg-white px-4 py-3 text-sm">Back</button></div></form>}
    {loading ? <p role="status" className="p-4 text-sm text-gray-600">Loading approvals...</p> : page && !page.items.length ? <div className="rounded-xl border bg-white p-8 text-center"><h2 className="font-semibold">No {status === 'all' ? '' : `${status} `}requests</h2><p className="mt-2 text-sm text-gray-600">Requests matching these filters will appear here.</p></div> : page?.items.map(item => <article key={`${item.kind}-${item.id}`} className="space-y-4 rounded-xl border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{approvalLabels[item.kind]}</p><h2 className="mt-1 font-semibold">{item.employee_name}</h2><p className="mt-1 text-xs text-gray-500">{item.department || 'Organization'} · Submitted {workflowDate(item.created_at)}</p></div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${statusStyle[item.status] || 'bg-gray-100'}`}>{item.status}</span>{item.status === 'pending' && isOverdueRequest(item.created_at) && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-900">Waiting over 24h</span>}</div></div>
      <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{item.reason}</p><ApprovalContext item={item} />
      {item.reviewed_at && <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">Reviewed by {item.reviewer_name || 'organization admin'} · {workflowDate(item.reviewed_at)}{item.decision_note ? `\n${item.decision_note}` : ''}</p>}
      {item.status === 'pending' && (item.can_review ? <div className="flex flex-wrap gap-2"><button disabled={saving} onClick={() => { setDecision({ item, action: 'approve' }); setNote(''); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white">{item.kind === 'ai_review' ? 'Accept review' : 'Approve'}</button><button disabled={saving} onClick={() => { setDecision({ item, action: 'reject' }); setNote(''); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="rounded-lg border border-red-200 px-4 py-3 text-sm text-red-700">Reject</button></div> : <p className="text-sm text-gray-500">Another admin must review your own request.</p>)}
    </article>)}
    {page && page.total > 20 && <div className="flex flex-wrap items-center justify-between gap-3"><button disabled={loading || saving || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))} className="rounded-lg border bg-white px-4 py-2 text-sm disabled:opacity-50">Previous</button><p className="text-sm text-gray-600">{offset + 1}–{Math.min(offset + 20, page.total)} of {page.total}</p><button disabled={loading || saving || offset + 20 >= page.total} onClick={() => setOffset(value => value + 20)} className="rounded-lg border bg-white px-4 py-2 text-sm disabled:opacity-50">Next</button></div>}
    <Link to="/attendance" className="inline-block text-sm font-medium text-blue-700">Open attendance operations →</Link>
  </div>;
}
