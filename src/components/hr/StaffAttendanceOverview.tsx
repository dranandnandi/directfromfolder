import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../utils/supabaseClient';
import { attendanceToday } from '../../utils/attendanceCorrection';
import { workflowError } from '../../services/staffWorkflowService';

interface Row { user_id: string; name: string; department: string; punch_in: string | null; punch_out: string | null; total_hours: number | null; is_absent: boolean | null; is_late: boolean | null; is_regularized: boolean | null }
const time = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) : '—';
export default function StaffAttendanceOverview() {
  const [date, setDate] = useState(attendanceToday());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setRows([]);
    void supabase.rpc('fn_staff_attendance_day', { p_date: date }).then(({ data, error }) => {
      if (active) { if (error) setError(workflowError(error)); else setRows(data || []); setLoading(false); }
    }, err => { if (active) { setError(workflowError(err)); setLoading(false); } });
    return () => { active = false; };
  }, [date, version]);
  return <div className="space-y-4 p-4 sm:p-6"><h1 className="text-2xl font-bold">Team attendance</h1><p className="text-sm text-gray-600">Read-only attendance by employee. Dates and punches use Asia/Kolkata time.</p>
    <div className="flex flex-wrap gap-3"><label className="text-sm">Date<input required type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} className="ml-2 rounded-lg border p-2" /></label><input aria-label="Find employee" placeholder="Find employee or department..." value={search} onChange={e => setSearch(e.target.value)} className="rounded-lg border p-2 text-sm" /><button onClick={() => setVersion(v => v + 1)} disabled={loading} className="rounded-lg border bg-white px-4 py-2 text-sm">Refresh</button></div>
    <div className="flex flex-wrap gap-4 text-sm text-blue-700"><Link to="/approvals?kind=correction">Review punch corrections →</Link><Link to="/approvals?kind=regularization">Review attendance exceptions →</Link><Link to="/attendance">My attendance →</Link></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {loading ? <p role="status">Loading attendance...</p> : <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50"><tr>{['Employee', 'Department', 'Punch in', 'Punch out', 'Hours', 'Status'].map(h => <th key={h} className="whitespace-nowrap p-3 font-medium">{h}</th>)}</tr></thead><tbody>{rows.filter(r => `${r.name} ${r.department || ''}`.toLowerCase().includes(search.toLowerCase())).map(row => <tr key={row.user_id} className="border-t"><td className="p-3">{row.name}</td><td className="p-3">{row.department}</td><td className="whitespace-nowrap p-3">{time(row.punch_in)}</td><td className="whitespace-nowrap p-3">{time(row.punch_out)}</td><td className="p-3">{row.total_hours == null ? '—' : Number(row.total_hours).toFixed(2)}</td><td className="p-3">{row.is_absent ? 'Absent' : !row.punch_in ? 'No punches' : row.is_regularized ? 'Regularized' : row.is_late ? 'Late' : 'Present'}</td></tr>)}</tbody></table>{!rows.length && <p className="p-4 text-sm text-gray-500">No employees found.</p>}</div>}
  </div>;
}
