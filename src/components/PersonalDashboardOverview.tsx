import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiArrowRight, HiCalendar, HiClock, HiRefresh } from 'react-icons/hi';
import { Attendance, EmployeeShift } from '../models/attendance';
import { LeaveBalance, computeLeaveBalances, parseLeavePolicy } from '../utils/leavePolicy';
import { attendanceToday } from '../utils/attendanceCorrection';
import { leaveStatus as normalizedLeaveStatus } from '../utils/staffWorkflows';
import { staffWorkflowService } from '../services/staffWorkflowService';
import { AttendanceService } from '../services/attendanceService';
import { supabase } from '../utils/supabaseClient';
import { requireVerifiedOrganization } from '../utils/verifiedOrganization';
import { useStaffAccess } from '../contexts/StaffAccessContext';

type MonthAttendance = Pick<Attendance, 'id' | 'date' | 'punch_in_time' | 'is_absent' | 'is_half_day' | 'is_late'>;
type LeaveApplication = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  created_at: string;
  leave_cancelled_at?: string | null;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
};

interface PersonalOverview {
  authId: string;
  employeeId: string;
  name: string;
  today: Attendance | null;
  month: MonthAttendance[];
  leaves: LeaveApplication[];
  leaveCount: number;
  attendanceError: boolean;
  leaveError: boolean;
  shift: EmployeeShift | null;
  balances: LeaveBalance[];
  pendingRequests: number | null;
  pendingLeaveCount: number | null;
  pendingPunchCount: number | null;
  approvalsCount: number | null;
  isAdmin: boolean;
}

const localDate = attendanceToday;

const displayDate = (value?: string | null) => {
  if (!value) return 'Date unavailable';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const displayTime = (value?: string | null) => value
  ? new Date(value).toLocaleTimeString(undefined, { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
  : '—';

const leaveField = (description: string | null, label: string) =>
  description?.match(new RegExp(`^${label}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim();

const leaveStatus = (status: string, cancelledAt?: string | null) => {
  const state = normalizedLeaveStatus(status, cancelledAt);
  return state[0].toUpperCase() + state.slice(1);
};

export function usePersonalDashboard(authId?: string) {
  const { can } = useStaffAccess();
  const mayApprove = can('attendance.approve') || can('leave.approve');
  const [data, setData] = useState<PersonalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = () => setRefreshVersion(version => version + 1);

  useEffect(() => {
    const onFocus = () => setRefreshVersion(version => version + 1);
    const timer = window.setInterval(() => {
      if (!document.hidden) onFocus();
    }, 60000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('staff-workflow-updated', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('staff-workflow-updated', onFocus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(current => current?.authId === authId ? current : null);
    setLoading(true);
    setError('');

    const load = async () => {
      if (!authId) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        // Resolve the authenticated account to its employee ID before any data query.
        // No admin branch: this home overview always belongs to the signed-in user.
        const { data: profile, error: profileError } = await supabase.from('users')
          .select('id, auth_id, organization_id, is_active, name, role')
          .eq('auth_id', authId).maybeSingle();
        if (profileError) throw profileError;
        const organizationId = requireVerifiedOrganization(profile, authId);
        if (!profile) throw new Error('Your employee profile is unavailable.');
        const today = localDate();
        const monthStart = `${today.slice(0, 7)}-01`;

        const isAdmin = mayApprove;
        const [active, monthly, applications, assignedShift, policyResponse, corrections, approvals] = await Promise.allSettled([
          AttendanceService.getTodayOrActiveAttendance(profile.id),
          supabase.from('attendance')
            .select('id, date, punch_in_time, is_absent, is_half_day, is_late')
            .eq('user_id', profile.id).eq('organization_id', organizationId)
            .gte('date', monthStart).lte('date', today).order('date', { ascending: false }),
          supabase.from('tasks')
            .select('id, title, description, status, due_date, created_at, leave_start_date, leave_end_date, leave_cancelled_at', { count: 'exact' })
            .eq('organization_id', organizationId).eq('created_by', profile.id)
            .eq('type', 'personalTask')
            .or('title.ilike."%Leave Request%",description.ilike."%LEAVE REQUEST DETAILS%"')
            .order('created_at', { ascending: false }),
          AttendanceService.getEmployeeCurrentShift(profile.id),
          supabase.from('organizations').select('leave_policy').eq('id', organizationId).single(),
          supabase.from('attendance_correction_requests').select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId).eq('user_id', profile.id).eq('status', 'pending'),
          isAdmin ? staffWorkflowService.approvals('pending') : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const monthResult = monthly.status === 'fulfilled' ? monthly.value : null;
        const leaveResult = applications.status === 'fulfilled' ? applications.value : null;
        const policyResult = policyResponse.status === 'fulfilled' ? policyResponse.value : null;
        const correctionResult = corrections.status === 'fulfilled' ? corrections.value : null;
        const allLeaves = (leaveResult?.data || []) as LeaveApplication[];
        const policy = parseLeavePolicy(policyResult?.data?.leave_policy);
        const leaveRows = allLeaves.map(leave => ({
          leave_type: (leaveField(leave.description, 'Leave Type') || 'full day').toLowerCase().replace(/\s+/g, '_'),
          leave_category: leaveField(leave.description, 'Leave Category'),
          start_date: leave.leave_start_date || leaveField(leave.description, 'Start Date') || '',
          end_date: leave.leave_end_date || leaveField(leave.description, 'End Date'),
          status: normalizedLeaveStatus(leave.status, leave.leave_cancelled_at)
        }));
        setData({
          authId, employeeId: profile.id, name: profile.name || 'you',
          today: active.status === 'fulfilled' ? active.value : null,
          month: monthResult?.data || [],
          leaves: allLeaves.slice(0, 5), leaveCount: leaveResult?.count || 0,
          isAdmin,
          shift: assignedShift.status === 'fulfilled' ? assignedShift.value : null,
          balances: computeLeaveBalances(policy, leaveRows),
          pendingRequests: leaveResult && !leaveResult.error && correctionResult && !correctionResult.error
            ? leaveRows.filter(leave => leave.status === 'pending').length + (correctionResult.count || 0) : null,
          pendingLeaveCount: leaveResult && !leaveResult.error ? leaveRows.filter(leave => leave.status === 'pending').length : null,
          pendingPunchCount: correctionResult && !correctionResult.error ? correctionResult.count || 0 : null,
          approvalsCount: approvals.status === 'fulfilled' ? approvals.value?.pending_count ?? null : null,
          attendanceError: active.status === 'rejected' || !monthResult || !!monthResult.error,
          leaveError: !leaveResult || !!leaveResult.error || !policyResult || !!policyResult.error,
        });
      } catch {
        if (!cancelled) {
          setData(null);
          setError('Unable to load your dashboard. Check your connection and active organization membership, then retry.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [authId, refreshVersion, mayApprove]);

  // Immediately hide previous-account data, even before the new effect runs.
  return { data: data?.authId === authId ? data : null, loading, error, refresh };
}

type OverviewProps = ReturnType<typeof usePersonalDashboard>;

export default function PersonalDashboardOverview({ data, loading, error, refresh }: OverviewProps) {
  const today = data?.today;
  const openSession = today?.sessions?.find(session => !session.punch_out_time);
  const isPunchedIn = !!openSession || !!(today?.punch_in_time && !today.punch_out_time);
  const status = isPunchedIn ? 'Punched in' : today?.punch_out_time ? 'Punched out'
    : today?.is_holiday ? 'Holiday' : today?.is_weekend ? 'Weekly off'
    : today?.is_absent ? 'Marked absent' : 'Not punched in';
  const presentDays = data?.month.filter(day => day.punch_in_time && !day.is_absent).length || 0;
  const halfDays = data?.month.filter(day => day.is_half_day && !day.is_absent).length || 0;
  const lateDays = data?.month.filter(day => day.is_late).length || 0;

  return (
    <section className="space-y-5" aria-label="My attendance and leave">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-blue-700">{displayDate(localDate())}</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">My dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">{data ? `${data.name}, here is your workday at a glance.` : 'Your attendance, leave applications and tasks in one place.'}</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50" aria-label="Refresh my dashboard">
          <HiRefresh className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /><span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {loading && !data && <p role="status" className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">Loading your attendance and leave…</p>}
      {data && <div className="space-y-4">
        <article className="rounded-2xl bg-blue-700 p-5 text-white sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm text-blue-100">Your next action</p><h2 className="mt-1 text-xl font-semibold">{data.attendanceError ? 'Check your attendance' : isPunchedIn ? 'Your shift is in progress' : today?.punch_out_time ? 'Attendance recorded for today' : 'Ready to start your workday?'}</h2><p className="mt-2 text-sm text-blue-100">{data.shift?.shift ? `${data.shift.shift.name} · ${data.shift.shift.start_time.slice(0, 5)}–${data.shift.shift.end_time.slice(0, 5)}${data.shift.shift.is_overnight ? ' (overnight)' : ''}` : 'No shift assignment is available. Open attendance to check your schedule.'}</p></div><Link to="/attendance#punch" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-blue-800">{data.attendanceError ? 'Open attendance' : isPunchedIn ? 'Punch out' : today?.punch_out_time ? 'View attendance' : 'Punch in'} →</Link></div>
          <div className="mt-5 flex flex-wrap gap-3 border-t border-blue-500 pt-4 text-sm"><Link to="/tasks" className="rounded-lg bg-blue-600 px-3 py-2 font-medium">Open my tasks →</Link><Link to="/leaveManagement" className="rounded-lg bg-blue-600 px-3 py-2 font-medium">Pending leave: {data.pendingLeaveCount ?? 'unavailable'}</Link>{!!data.pendingPunchCount && <Link to="/attendance#correction-requests" className="rounded-lg bg-blue-600 px-3 py-2 font-medium">Punch requests: {data.pendingPunchCount}</Link>}{data.isAdmin && <Link to="/approvals" className="rounded-lg bg-white px-3 py-2 font-medium text-blue-800">Team approvals{data.approvalsCount !== null ? ` (${data.approvalsCount})` : ''} →</Link>}</div>
        </article>
        {!data.leaveError && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.balances.map(balance => <Link key={balance.code} to="/leaveManagement" className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-sm text-gray-600">{balance.code} · {balance.name}</p><p className={`mt-2 text-xl font-semibold ${balance.annual_quota > 0 && balance.remaining <= 1 ? 'text-amber-700' : 'text-gray-900'}`}>{balance.annual_quota > 0 ? `${balance.remaining} days left` : `${balance.used} days used`}</p><p className="mt-1 text-xs text-gray-500">{balance.annual_quota > 0 ? `Of ${balance.annual_quota} this leave year` : 'No annual quota configured'}{balance.pending ? ` · ${balance.pending} pending` : ''}</p></Link>)}</div>}
      </div>}
      {data && <div className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-gray-900"><HiClock className="h-5 w-5 text-blue-600" />My attendance</h2>
            <Link to="/attendance" className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">Attendance<HiArrowRight /></Link>
          </div>
          {data.attendanceError ? <p role="alert" className="mt-5 text-sm text-red-700">Could not load your attendance. Refresh to try again.</p> : <>
            <div className="mt-5 rounded-xl bg-blue-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-blue-700">{today && today.date !== localDate() ? `Shift started ${displayDate(today.date)}` : 'Today'}</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{status}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-gray-600">Punch in</dt><dd className="mt-1 font-medium">{displayTime(openSession?.punch_in_time || today?.punch_in_time)}</dd></div>
                <div><dt className="text-gray-600">Punch out</dt><dd className="mt-1 font-medium">{isPunchedIn ? 'Shift in progress' : displayTime(today?.punch_out_time)}</dd></div>
              </dl>
            </div>
            <p className="mb-3 mt-5 text-sm font-medium text-gray-700">{new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · recorded attendance</p>
            <dl className="grid grid-cols-3 gap-2">
              {[['Present days', presentDays], ['Half days', halfDays], ['Late days', lateDays]].map(([label, value]) => <div key={label} className="flex flex-col rounded-lg bg-gray-50 p-3"><dt className="order-2 mt-1 text-xs text-gray-600">{label}</dt><dd className="order-1 text-xl font-semibold text-gray-900">{value}</dd></div>)}
            </dl>
          </>}
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-gray-900"><HiCalendar className="h-5 w-5 text-violet-600" />My leave</h2>
            <Link to="/leaveManagement" className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">Apply / view leave<HiArrowRight /></Link>
          </div>
          {data.leaveError ? <p role="alert" className="mt-5 text-sm text-red-700">Could not load your leave applications. Refresh to try again.</p> : data.leaves.length === 0 ? <div className="mt-5 rounded-xl bg-violet-50 p-5"><p className="font-medium text-gray-900">No leave applications yet</p><p className="mt-2 text-sm text-gray-600">Your applications and their approval status will appear here.</p></div> : <>
            <p className="mt-4 text-xs text-gray-500">{data.leaveCount > 5 ? `Latest 5 of ${data.leaveCount} applications` : `${data.leaveCount} application${data.leaveCount === 1 ? '' : 's'}`}</p>
            <ul className="mt-1 divide-y divide-gray-100">
              {data.leaves.map(leave => {
                const state = leaveStatus(leave.status, leave.leave_cancelled_at);
                const start = leaveField(leave.description, 'Start Date') || leave.due_date;
                const end = leaveField(leave.description, 'End Date');
                const category = leaveField(leave.description, 'Leave Category');
                const type = leaveField(leave.description, 'Leave Type') || 'Leave';
                return <li key={leave.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-900">{category ? `${category} · ` : ''}{type.replace(/_/g, ' ')}</p><p className="mt-1 text-sm text-gray-600">{displayDate(start)}{end && end !== start ? ` – ${displayDate(end)}` : ''}</p><p className="mt-1 text-xs text-gray-500">Applied {displayDate(leave.created_at)}</p></div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${state === 'Approved' ? 'bg-green-50 text-green-800' : state === 'Rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{state}</span>
                </li>;
              })}
            </ul>
          </>}
        </article>
      </div>}
    </section>
  );
}
