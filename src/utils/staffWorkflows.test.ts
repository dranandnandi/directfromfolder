import { describe, expect, it } from 'vitest';
import { isOverdueRequest, leaveStatus, overlappingLeave } from './staffWorkflows';

describe('leave request lifecycle', () => {
  it('distinguishes employee cancellation from historical rejections', () => {
    expect(leaveStatus('cancelled')).toBe('rejected');
    expect(leaveStatus('cancelled', '2026-11-12T00:00:00Z')).toBe('cancelled');
    expect(leaveStatus('completed')).toBe('approved');
    expect(leaveStatus('Pending')).toBe('pending');
  });
  it.each(['pending', 'approved'])('detects inclusive overlap with %s leave', status => {
    const request = { id: 'leave', start_date: '2026-11-13', end_date: '2026-11-15', status };
    expect(overlappingLeave([request], '2026-11-15', '2026-11-16')).toBe(request);
    expect(overlappingLeave([request], '2026-11-12', '2026-11-16')).toBe(request);
    expect(overlappingLeave([request], '2026-11-16')).toBeUndefined();
  });
  it('allows resubmission after rejection or cancellation and handles single-day leave', () => {
    const closed = [{ id: 'one', start_date: '2026-11-13', status: 'rejected' }, { id: 'two', start_date: '2026-11-13', status: 'cancelled' }];
    expect(overlappingLeave(closed, '2026-11-13')).toBeUndefined();
    expect(overlappingLeave([{ id: 'three', start_date: '2026-11-13', status: 'pending' }], '2026-11-13')?.id).toBe('three');
  });
  it('flags requests older than 24 hours without flagging new or future records', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    expect(isOverdueRequest('2026-11-11T09:59:00Z', now)).toBe(true);
    expect(isOverdueRequest('2026-11-11T10:01:00Z', now)).toBe(false);
    expect(isOverdueRequest('2026-11-13T10:00:00Z', now)).toBe(false);
  });
});
