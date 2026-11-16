import { describe, expect, it } from 'vitest';
import { attendanceDateTime, validateCorrection } from './attendanceCorrection';
import { canManagePayroll, canViewPayslip } from './permissions';

const now = Date.parse('2026-11-12T18:00:00+05:30');
describe('attendance correction times', () => {
  it('uses the Indian work date even before UTC midnight', () => {
    expect(attendanceDateTime('2026-11-11T20:00:00Z')).toBe('2026-11-12T01:30:00');
  });
  it('accepts overnight sessions without changing their attendance date', () => {
    expect(validateCorrection('2026-11-11', '2026-11-11T22:00', '2026-11-12T06:00', 'Missed punch-out', now)).toBeNull();
  });
  it.each([
    ['2026-11-11T22:00', '2026-11-11T06:00', 'Missed punch'],
    ['2026-11-11T22:00', '2026-11-12T23:00', 'Missed punch'],
    ['2026-11-11T22:00', '2026-11-12T19:00', 'Missed punch'],
    ['2026-11-12T09:00', '2026-11-12T17:00', 'Missed punch'],
    ['2026-11-11T09:00', '2026-11-11T17:00', '  x  ']
  ])('rejects invalid chronology, future times, mismatched dates and empty reasons', (start, end, reason) => {
    expect(validateCorrection('2026-11-11', start, end, reason, now)).toBeTruthy();
  });
});
describe('payroll permissions', () => {
  it.each(['admin', 'superadmin', 'payroll_admin'])('allows %s payroll access and personal payslips', role => {
    expect(canManagePayroll(role)).toBe(true);
    expect(canViewPayslip(role)).toBe(true);
  });
  it('keeps ordinary users on their personal payslip route', () => {
    expect(canManagePayroll('user')).toBe(false);
    expect(canViewPayslip('user')).toBe(true);
    expect(canViewPayslip('')).toBe(false);
  });
});
