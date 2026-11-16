import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceService } from './attendanceService';
import { PunchData } from '../models/attendance';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../utils/supabaseClient', () => ({ supabase: { from } }));

const punchData = { latitude: 0, longitude: 0, selfie_file: {} } as PunchData;
const org = {
  location_latitude: 24.26583768,
  location_longitude: 72.18399928,
  geofence_settings: { enabled: true, enforcement_mode: 'strict', distance_threshold_meters: 50 },
};

describe('punch service geofence enforcement before writes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    from.mockReset();
    vi.spyOn(AttendanceService as any, 'getActiveOpenAttendanceRecord').mockResolvedValue(null);
  });

  function mockReads(organizationResult: { data: typeof org | null; error: unknown }) {
    from.mockImplementation((table: string) => {
      const result = table === 'users'
        ? { data: { organization_id: 'org' }, error: null }
        : organizationResult;
      const query: any = { select: () => query, eq: () => query, single: async () => result };
      return query;
    });
  }

  it.each(['punchIn', 'punchOut'] as const)('%s rejects zero coordinates outside the geofence', async method => {
    mockReads({ data: org, error: null });
    await expect(AttendanceService[method]('employee', punchData)).rejects.toThrow('50m');
    expect(from.mock.calls.map(call => call[0])).toEqual(['users', 'organizations']);
  });

  it.each(['punchIn', 'punchOut'] as const)('%s rejects missing GPS instead of skipping validation', async method => {
    mockReads({ data: org, error: null });
    await expect(AttendanceService[method]('employee', { ...punchData, latitude: undefined } as unknown as PunchData))
      .rejects.toThrow('GPS');
  });

  it.each(['punchIn', 'punchOut'] as const)('%s stops when settings cannot be loaded', async method => {
    mockReads({ data: null, error: { message: 'Network error' } });
    await expect(AttendanceService[method]('employee', punchData)).rejects.toThrow('Unable to verify');
  });
});
