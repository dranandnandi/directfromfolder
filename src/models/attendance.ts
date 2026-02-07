// HR Attendance System Types
export interface Shift {
  id: string;
  organization_id: string;
  name: string;
  start_time: string; // HH:MM format
  end_time: string; // HH:MM format
  duration_hours: 8 | 9;
  break_duration_minutes: number;
  late_threshold_minutes: number;
  early_out_threshold_minutes: number;
  is_active: boolean;
  is_overnight?: boolean; // True if shift spans midnight (e.g., 8 PM to 8 AM) - optional, auto-detected
  created_at: string;
  updated_at: string;
}

export interface EmployeeShift {
  id: string;
  user_id: string;
  shift_id: string;
  effective_from: string; // YYYY-MM-DD format
  effective_to?: string; // YYYY-MM-DD format
  assigned_by: string;
  created_at: string;
  shift?: Shift; // Populated when joined
  user?: {
    id: string;
    name: string;
    department: string;
  };
}

export interface Attendance {
  id: string;
  user_id: string;
  organization_id: string;
  date: string; // YYYY-MM-DD format
  shift_id?: string;

  // Punch In Data
  punch_in_time?: string;
  punch_in_latitude?: number;
  punch_in_longitude?: number;
  punch_in_address?: string;
  punch_in_selfie_url?: string;
  punch_in_device_info?: any;

  // Punch Out Data
  punch_out_time?: string;
  punch_out_latitude?: number;
  punch_out_longitude?: number;
  punch_out_address?: string;
  punch_out_selfie_url?: string;
  punch_out_device_info?: any;

  // Geofencing Data
  punch_in_distance_meters?: number;
  punch_out_distance_meters?: number;
  is_outside_geofence?: boolean;
  geofence_override_by?: string;
  geofence_override_reason?: string;
  geofence_override_at?: string;

  // Calculated Fields
  total_hours?: number;
  break_hours: number;
  effective_hours?: number;

  // Status Flags
  is_late: boolean;
  is_early_out: boolean;
  is_absent: boolean;
  is_holiday: boolean;
  is_weekend: boolean;

  // Regularization
  is_regularized: boolean;
  regularized_by?: string;
  regularization_reason?: string;
  regularized_at?: string;

  created_at: string;
  updated_at: string;

  // Populated when joined
  shift?: Shift;
  user?: {
    id: string;
    name: string;
    department: string;
  };
}

export interface AttendanceRegularization {
  id: string;
  attendance_id: string;
  requested_by: string;
  approved_by?: string;
  reason: string;
  admin_remarks?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;

  // Populated when joined
  attendance?: Attendance;
  requester?: {
    id: string;
    name: string;
    department: string;
  };
  approver?: {
    id: string;
    name: string;
  };
}

export interface PunchData {
  latitude: number;
  longitude: number;
  address: string;
  selfie_file: File;
  device_info: {
    user_agent: string;
    platform: string;
    timestamp: string;
  };
}

export interface AttendanceSummary {
  total_days: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  early_out_days: number;
  total_hours: number;
  average_hours: number;
  lwp_days: number;
  regularized_days: number;
}

export interface DailyAttendanceStatus {
  date: string;
  status: 'not_punched' | 'punched_in' | 'punched_out' | 'absent';
  punch_in_time?: string;
  punch_out_time?: string;
  total_hours?: number;
  is_late: boolean;
  is_early_out: boolean;
  shift?: Shift;
}
