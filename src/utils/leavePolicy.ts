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
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
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
  const year = on.getUTCFullYear();
  const month = on.getUTCMonth() + 1;
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

/**
 * Days a request consumes. Full-day requests count every calendar day from
 * start to end inclusive; half day is 0.5; early departure does not consume
 * leave. Weekends and holidays are not excluded - that is a phase-2 refinement.
 */
export const leaveDaysForRequest = (request: Pick<LeaveRequestLike, 'leave_type' | 'start_date' | 'end_date'>) => {
  if (request.leave_type === 'half_day') return 0.5;
  if (request.leave_type === 'early_departure') return 0;

  const start = toUtcDate(request.start_date);
  const end = request.end_date ? toUtcDate(request.end_date) : start;
  if (!start || !end || end < start) return 1;

  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
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
 * Balance per configured leave type, counting only requests whose start date
 * falls inside the given leave year. Requests without a category (created
 * before categories existed) are ignored.
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
    const start = request.start_date?.slice(0, 10);
    if (!start || start < leaveYear.start || start >= leaveYear.end) continue;

    const days = leaveDaysForRequest(request);
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
