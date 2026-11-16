import { describe, expect, it } from 'vitest';
import { computeLeaveBalances, getLeaveYear, leaveDaysForRequest, parseLeavePolicy } from './leavePolicy';
import { computeLeaveBalances as edgeBalances, parseLeavePolicy as edgePolicy } from '../../supabase/functions/_shared/leavePolicy';

const rawPolicy = { year_start_month: 4, types: [{ code: 'CL', name: 'Casual', annual_quota: 12 }] };
const request = { leave_type: 'full_day', leave_category: 'CL', start_date: '2026-03-30', end_date: '2026-04-02', status: 'approved' };

describe('leave balances across calendars', () => {
  it('starts the new leave year at Indian midnight in both runtimes', () => {
    expect(getLeaveYear(parseLeavePolicy(rawPolicy), new Date('2026-03-31T18:30:00Z')).start).toBe('2026-04-01');
  });
  it('splits a request between leave years without losing or double-counting days', () => {
    const policy = parseLeavePolicy(rawPolicy);
    expect(computeLeaveBalances(policy, [request], getLeaveYear(policy, new Date('2026-03-31T12:00:00Z')))[0].used).toBe(2);
    expect(computeLeaveBalances(policy, [request], getLeaveYear(policy, new Date('2026-04-01T12:00:00Z')))[0].used).toBe(2);
  });
  it('preserves calendar-day counting for existing organizations', () => {
    expect(leaveDaysForRequest({ ...request, start_date: '2026-11-06', end_date: '2026-11-09' }, parseLeavePolicy(rawPolicy))).toBe(4);
  });
  it('excludes configured weekly offs and holidays once, including pending half days', () => {
    const policy = parseLeavePolicy({ ...rawPolicy, excluded_weekdays: [0, 6], excluded_dates: ['2026-11-09', '2026-11-08'] });
    const requests = [
      { ...request, start_date: '2026-11-06', end_date: '2026-11-10' },
      { ...request, leave_type: 'half_day', start_date: '2026-11-11', end_date: undefined, status: 'pending' },
      { ...request, start_date: '2026-11-12', end_date: undefined, status: 'rejected' }
    ];
    expect(computeLeaveBalances(policy, requests, getLeaveYear(policy, new Date('2026-11-12')))[0]).toMatchObject({ used: 2, pending: 0.5, remaining: 10 });
    expect(edgeBalances(edgePolicy(policy), requests, getLeaveYear(policy, new Date('2026-11-12')))).toEqual(computeLeaveBalances(policy, requests, getLeaveYear(policy, new Date('2026-11-12'))));
  });
  it('does not consume leave for invalid ranges or early departures', () => {
    expect(leaveDaysForRequest({ ...request, start_date: '2026-02-30' })).toBe(0);
    expect(leaveDaysForRequest({ ...request, end_date: '2026-03-29' })).toBe(0);
    expect(leaveDaysForRequest({ ...request, leave_type: 'early_departure' })).toBe(0);
  });
  it('does not assign a half day to the wrong year', () => {
    const policy = parseLeavePolicy(rawPolicy);
    expect(computeLeaveBalances(policy, [{ ...request, leave_type: 'half_day' }], { start: '2026-04-01', end: '2027-04-01', label: '2026-27' })[0].used).toBe(0);
  });
});
