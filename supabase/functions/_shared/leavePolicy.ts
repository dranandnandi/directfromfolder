// Organisation-level leave policy: which leave categories exist (SL, CL, ...)
// and how many days of each an employee gets per leave year.
//
// Stored as `organizations.leave_policy` (jsonb). Balances are not stored
// anywhere - they are derived on the fly from the approved leave-request tasks
// that fall inside the current leave year, so there is nothing to keep in sync.
//
// A copy of this logic lives in supabase/functions/_shared/leavePolicy.ts for
// the Deno edge functions. Keep the two in step.

export interface LeaveTypeConfig {
  /** Short code written into the request, e.g. "SL". Upper-case, unique. */
  code: string;
  /** Human label, e.g. "Sick Leave". */
  name: string;
  /** Days allowed per leave year. 0 means "no yearly limit configured". */
  annual_quota: number;
}

export interface LeavePolicy {
  /** 1-12. 4 = April-to-March (Indian financial year), 1 = calendar year. */
  year_start_month: number;
  types: LeaveTypeConfig[];
  /** Leave calendar: 0 = Sunday, 6 = Saturday. Empty preserves calendar-day counting. */
  excluded_weekdays?: number[];
  /** Holidays excluded from leave consumption, in YYYY-MM-DD format. */
  excluded_dates?: string[];
}

export const DEFAULT_LEAVE_POLICY: LeavePolicy = {
  year_start_month: 4,
  types: [
    { code: 'SL', name: 'Sick Leave', annual_quota: 0 },
    { code: 'CL', name: 'Casual Leave', annual_quota: 0 }
  ]
};

export const normaliseLeaveCode = (code: string) =>
  code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

/** Accepts whatever is in the jsonb column and returns a well-formed policy. */
export const parseLeavePolicy = (raw: unknown): LeavePolicy => {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<LeavePolicy>;

  const month = Number(source.year_start_month);
  const year_start_month = Number.isInteger(month) && month >= 1 && month <= 12
    ? month
    : DEFAULT_LEAVE_POLICY.year_start_month;

  const seen = new Set<string>();
  const types: LeaveTypeConfig[] = [];
  for (const t of Array.isArray(source.types) ? source.types : []) {
    if (!t || typeof t !== 'object') continue;
    const code = normaliseLeaveCode(String((t as LeaveTypeConfig).code ?? ''));
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const quota = Number((t as LeaveTypeConfig).annual_quota);
    types.push({
      code,
      name: String((t as LeaveTypeConfig).name ?? '').trim() || code,
      annual_quota: Number.isFinite(quota) && quota >= 0 ? Math.round(quota * 2) / 2 : 0
    });
  }

  return {
    year_start_month,
    excluded_weekdays: Array.isArray(source.excluded_weekdays)
      ? [...new Set(source.excluded_weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))] : [],
    excluded_dates: Array.isArray(source.excluded_dates)
      ? [...new Set(source.excluded_dates.filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)))] : [],
    types: types.length > 0 ? types : DEFAULT_LEAVE_POLICY.types.map(t => ({ ...t }))
  };
};

/** Finds a configured type by code or name, case-insensitively. */
export const findLeaveType = (policy: LeavePolicy, value?: string | null) => {
  if (!value) return undefined;
  const needle = value.trim().toLowerCase();
  return policy.types.find(
    t => t.code.toLowerCase() === needle || t.name.toLowerCase() === needle
  );
};

// ---------------------------------------------------------------------------
// Leave year

const toUtcDate = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toISOString().slice(0, 10) === m[0] ? date : null;
};

const formatYmd = (d: Date) => d.toISOString().slice(0, 10);

export interface LeaveYear {
  /** Inclusive, YYYY-MM-DD. */
  start: string;
  /** Exclusive, YYYY-MM-DD. */
  end: string;
  /** e.g. "2026-27" or "2026". */
  label: string;
}

/** The leave year that contains `on` (defaults to today). */
export const getLeaveYear = (policy: LeavePolicy, on: Date = new Date()): LeaveYear => {
  const startMonth = policy.year_start_month;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' }).formatToParts(on);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const startYear = month >= startMonth ? year : year - 1;

  const start = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(startYear + 1, startMonth - 1, 1));

  return {
    start: formatYmd(start),
    end: formatYmd(end),
    label: startMonth === 1 ? String(startYear) : `${startYear}-${String(startYear + 1).slice(-2)}`
  };
};

// ---------------------------------------------------------------------------
// Balances

export interface LeaveRequestLike {
  leave_type: string;          // full_day | half_day | early_departure
  leave_category?: string;     // SL | CL | ...
  start_date: string;          // YYYY-MM-DD
  end_date?: string;           // YYYY-MM-DD
  status: string;              // approved | pending | rejected
}

/** Count the configured working days, optionally clipped to a leave year. */
export const leaveDaysForRequest = (
  request: Pick<LeaveRequestLike, 'leave_type' | 'start_date' | 'end_date'>,
  policy?: LeavePolicy,
  leaveYear?: LeaveYear
) => {
  if (request.leave_type === 'early_departure') return 0;

  const start = toUtcDate(request.start_date);
  const end = request.end_date ? toUtcDate(request.end_date) : start;
  if (!start || !end || end < start) return 0;
  const excludedDates = new Set(policy?.excluded_dates || []);
  let days = 0;
  // A half-day belongs only to its start date, even for malformed historical ranges.
  const last = request.leave_type === 'half_day' ? start : end;
  for (const date = new Date(start); date <= last; date.setUTCDate(date.getUTCDate() + 1)) {
    const ymd = formatYmd(date);
    if (leaveYear && (ymd < leaveYear.start || ymd >= leaveYear.end)) continue;
    if (policy?.excluded_weekdays?.includes(date.getUTCDay()) || excludedDates.has(ymd)) continue;
    days += request.leave_type === 'half_day' ? 0.5 : 1;
  }

  return days;
};

export interface LeaveBalance extends LeaveTypeConfig {
  /** Approved days in the leave year. */
  used: number;
  /** Days still awaiting a decision in the leave year. */
  pending: number;
  /** annual_quota - used. Negative when over quota. */
  remaining: number;
}

/**
 * Allocate only the portion of each request inside the given leave year.
 * Requests without a category (created before categories existed) are ignored.
 */
export const computeLeaveBalances = (
  policy: LeavePolicy,
  requests: LeaveRequestLike[],
  leaveYear: LeaveYear = getLeaveYear(policy)
): LeaveBalance[] => {
  const totals = new Map<string, { used: number; pending: number }>();

  for (const request of requests) {
    const code = request.leave_category ? normaliseLeaveCode(request.leave_category) : '';
    if (!code) continue;
    const days = leaveDaysForRequest(request, policy, leaveYear);
    const entry = totals.get(code) ?? { used: 0, pending: 0 };
    if (request.status === 'approved') entry.used += days;
    else if (request.status === 'pending') entry.pending += days;
    totals.set(code, entry);
  }

  return policy.types.map(type => {
    const entry = totals.get(type.code) ?? { used: 0, pending: 0 };
    return {
      ...type,
      used: entry.used,
      pending: entry.pending,
      remaining: type.annual_quota - entry.used
    };
  });
};

/** "4 of 8 left" / "2 used, no yearly limit set". */
export const formatBalance = (balance: LeaveBalance) =>
  balance.annual_quota > 0
    ? `${balance.remaining} of ${balance.annual_quota} left`
    : `${balance.used} used, no yearly limit set`;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Reads the structured fields back out of a leave-request task description
 * (the layout written by the app and by whatsapp-request-leave).
 */
export const parseLeaveTaskDescription = (description: string, status: string): LeaveRequestLike => {
  const field = (label: string) =>
    description.match(new RegExp(`^${label}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim();

  const rawType = field('Leave Type');
  return {
    leave_type: rawType ? rawType.toLowerCase().replace(/\s+/g, '_') : 'full_day',
    leave_category: field('Leave Category'),
    start_date: field('Start Date') ?? '',
    end_date: field('End Date'),
    status: status === 'completed' ? 'approved'
      : status === 'cancelled' || status === 'rejected' ? 'rejected'
      : 'pending'
  };
};
