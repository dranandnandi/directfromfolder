import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceService } from './attendanceService';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../utils/supabaseClient', () => ({ supabase: { rpc, from } }));

describe('admin attendance entry', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each(['in', 'out'] as const)('marks punch %s without requesting location, geofencing or a selfie', async action => {
    rpc.mockResolvedValue({ error: null });
    const location = vi.spyOn(AttendanceService, 'getCurrentLocation');
    const upload = vi.spyOn(AttendanceService, 'uploadSelfie');
    await AttendanceService.adminMarkPunch('employee', '2026-11-14', action, '2026-11-14T03:30:00Z', '  Verified by admin  ');
    expect(rpc).toHaveBeenCalledWith('fn_admin_mark_attendance_punch', {
      p_user_id: 'employee', p_date: '2026-11-14', p_action: action,
      p_punch_time: '2026-11-14T03:30:00Z', p_reason: 'Verified by admin',
    });
    expect(from).not.toHaveBeenCalled();
    expect(location).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('surfaces database authorization failures', async () => {
    const error = { message: 'Only an active organization admin can mark attendance.' };
    rpc.mockResolvedValue({ error });
    await expect(AttendanceService.adminMarkPunch('employee', '2026-11-14', 'in', '2026-11-14T03:30:00Z', 'Verified'))
      .rejects.toEqual(error);
  });
});
