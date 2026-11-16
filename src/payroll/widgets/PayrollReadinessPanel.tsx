import { Link } from 'react-router-dom';
import { PayrollReadiness } from '../../services/staffWorkflowService';

export default function PayrollReadinessPanel({ data, loading, error, onRefresh }: {
  data: PayrollReadiness | null; loading: boolean; error: string; onRefresh: () => void;
}) {
  const blockers = data?.groups.filter(group => group.blocking) || [];
  return <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-label="Payroll readiness">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Payroll readiness</h2><p className="mt-1 text-sm text-gray-600">Resolve blocking items before locking or processing salary. Posting also requires every active employee to have a payroll result.</p></div><button type="button" disabled={loading} onClick={onRefresh} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{loading ? 'Checking...' : 'Recheck'}</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Could not verify readiness: {error}. Payroll actions stay disabled until this check succeeds.</p>}
    {!error && data && <p role="status" className={`rounded-lg p-3 text-sm font-medium ${data.ready ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>{data.ready ? `Ready for the next step · ${data.employee_count} active staff checked` : `${blockers.reduce((count, group) => count + group.count, 0)} blocking item(s) need attention`}</p>}
    {!data && loading && <p role="status" className="text-sm text-gray-600">Checking attendance, approvals and salary setup...</p>}
    {data?.groups.map(group => <details key={group.code} className={`rounded-lg border p-3 ${group.blocking ? 'border-amber-200' : 'border-gray-200'}`}><summary className="cursor-pointer text-sm font-medium">{group.blocking ? 'Action required' : 'Review recommended'}: {group.label} ({group.count})</summary><ul className="mt-3 space-y-2">{group.examples?.map((example, index) => <li key={`${example.user_id}-${index}`} className="text-sm"><span className="font-medium">{example.name}</span><span className="text-gray-600"> · {example.detail}</span></li>)}</ul>{group.count > 10 && <p className="mt-2 text-xs text-gray-500">Showing 10 examples. Open the related screen to review all items.</p>}<Link to={group.path} className="mt-3 inline-block text-sm font-medium text-blue-700">{group.code === 'pending_leave' || group.code.startsWith('pending_') || group.code === 'ai_review' ? 'Review items' : 'Open related screen'} →</Link></details>)}
    {data && <p className="text-xs text-gray-500">Checked {new Date(data.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. The server checks again when you process payroll.</p>}
  </section>;
}
