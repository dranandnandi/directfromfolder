import { supabase } from '../utils/supabaseClient';
import { Shift, EmployeeShift, Attendance, AttendanceRegularization, PunchData, AttendanceSummary } from '../models/attendance';
import { calculateDistance, parseGeofenceSettings } from '../utils/geolocation';

export class AttendanceService {
  private static toLocalDateString(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private static toPreviousLocalDateString(date: Date = new Date()): string {
    const previous = new Date(date);
    previous.setDate(previous.getDate() - 1);
    return this.toLocalDateString(previous);
  }

  private static parseTimeToMinutes(timeValue?: string | null): number | null {
    if (!timeValue) return null;
    const [hours, minutes] = timeValue.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
  }

  private static resolveAttendanceDateForPunchIn(shift?: Shift): string {
    const now = new Date();
    const today = this.toLocalDateString(now);

    if (!shift) return today;

    const isOvernight = shift.is_overnight ?? (shift.end_time < shift.start_time);
    if (!isOvernight) return today;

    const shiftEndMinutes = this.parseTimeToMinutes(shift.end_time);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (shiftEndMinutes !== null && nowMinutes < shiftEndMinutes) {
      return this.toPreviousLocalDateString(now);
    }

    return today;
  }

  private static async getActiveOpenAttendanceRecord(userId: string, lookbackDays: number = 2): Promise<Attendance | null> {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - lookbackDays);
    const searchFromDate = fromDate.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('attendance')
      .select(`
        *,
        shift:shifts(*)
      `)
      .eq('user_id', userId)
      .gte('date', searchFromDate)
      .not('punch_in_time', 'is', null)
      .is('punch_out_time', null)
      .order('punch_in_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  // ========== SHIFT MANAGEMENT ==========

  static async createShift(shift: Omit<Shift, 'id' | 'created_at' | 'updated_at'>): Promise<Shift> {
    console.log('Creating shift:', shift);

    // Auto-detect overnight shift if not explicitly set
    const shiftData = {
      ...shift,
      is_overnight: shift.is_overnight ?? (shift.end_time < shift.start_time)
    };

    const { data, error } = await supabase
      .from('shifts')
      .insert(shiftData)
      .select()
      .single();

    if (error) {
      console.error('Error creating shift:', error);
      throw error;
    }

    console.log('Shift created successfully:', data);
    return data;
  }

  static async getShiftsByOrganization(organizationId: string): Promise<Shift[]> {
    console.log('Fetching shifts for organization:', organizationId);

    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Error fetching shifts:', error);
      throw error;
    }

    console.log('Fetched shifts data:', data);
    return data || [];
  }

  static async updateShift(id: string, updates: Partial<Shift>): Promise<Shift> {
    const { data, error } = await supabase
      .from('shifts')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async deleteShift(id: string): Promise<void> {
    const { error } = await supabase
      .from('shifts')
      .update({ is_active: false })
      .eq('id', id);

    if (error) throw error;
  }

  // ========== EMPLOYEE SHIFT ASSIGNMENT ==========

  /**
   * Validate geofence for punch in/out
   * @returns Object with isValid flag, distance, and isOutsideGeofence flag
   * @throws Error if geofence is enabled in strict mode and location is outside geofence
   */
  private static async validateGeofence(
    organizationId: string,
    latitude: number,
    longitude: number
  ): Promise<{ isValid: boolean; distance: number | null; isOutsideGeofence: boolean }> {
    // Fetch organization geofence settings
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('location_latitude, location_longitude, geofence_settings')
      .eq('id', organizationId)
      .single();

    if (orgError) {
      console.error('Error fetching organization geofence settings:', orgError);
      return { isValid: true, distance: null, isOutsideGeofence: false };
    }

    // If no organization location configured, allow punch
    if (!orgData.location_latitude || !orgData.location_longitude) {
      console.log('No organization location configured, allowing punch');
      return { isValid: true, distance: null, isOutsideGeofence: false };
    }

    // Parse geofence settings
    const settings = parseGeofenceSettings(orgData.geofence_settings);

    // If geofencing is disabled, allow punch
    if (!settings.enabled) {
      console.log('Geofencing is disabled, allowing punch');
      return { isValid: true, distance: null, isOutsideGeofence: false };
    }

    // Calculate distance
    const distance = calculateDistance(
      latitude,
      longitude,
      orgData.location_latitude,
      orgData.location_longitude
    );

    console.log(`Distance from organization: ${distance.toFixed(2)}m (threshold: ${settings.distance_threshold_meters}m)`);

    const isOutsideGeofence = distance > settings.distance_threshold_meters;

    // Strict mode: block punch if outside geofence
    if (isOutsideGeofence && settings.enforcement_mode === 'strict') {
      throw new Error(
        `You are ${distance.toFixed(0)}m away from the organization location. ` +
        `Punch is not allowed beyond ${settings.distance_threshold_meters}m. ` +
        `Please move closer or contact your administrator.`
      );
    }

    // Warning mode: allow but flag
    return {
      isValid: true,
      distance: Math.round(distance * 100) / 100, // Round to 2 decimals
      isOutsideGeofence,
    };
  }

  // ========== EMPLOYEE SHIFT ASSIGNMENT ==========

  static async assignShiftToEmployee(assignment: Omit<EmployeeShift, 'id' | 'created_at'>): Promise<EmployeeShift> {
    // First, end any existing active assignments for this user on or after the effective date
    const { error: updateError } = await supabase
      .from('employee_shifts')
      .update({
        effective_to: new Date(new Date(assignment.effective_from).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0] // Day before new assignment
      })
      .eq('user_id', assignment.user_id)
      .gte('effective_from', assignment.effective_from)
      .is('effective_to', null); // Only update active assignments

    if (updateError) {
      console.error('Error updating existing assignments:', updateError);
      // Don't throw here, try to continue with the insert
    }

    // Also end any existing assignments that overlap with the new effective date
    const { error: overlapError } = await supabase
      .from('employee_shifts')
      .update({
        effective_to: new Date(new Date(assignment.effective_from).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      })
      .eq('user_id', assignment.user_id)
      .lte('effective_from', assignment.effective_from)
      .is('effective_to', null); // Only active assignments without end date

    if (overlapError) {
      console.error('Error ending overlapping assignments:', overlapError);
    }

    // Now insert the new assignment
    const { data, error } = await supabase
      .from('employee_shifts')
      .insert(assignment)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async reassignEmployeeShift(userId: string, newShiftId: string, effectiveFrom: string, assignedBy: string): Promise<EmployeeShift> {
    // This method specifically handles reassigning an employee to a new shift
    // It ends the current assignment and creates a new one

    const today = new Date().toISOString().split('T')[0];
    const effectiveDate = effectiveFrom || today;

    // End current active assignment
    const { error: endCurrentError } = await supabase
      .from('employee_shifts')
      .update({
        effective_to: new Date(new Date(effectiveDate).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      })
      .eq('user_id', userId)
      .is('effective_to', null); // Only active assignments

    if (endCurrentError) {
      console.error('Error ending current assignment:', endCurrentError);
    }

    // Create new assignment
    const newAssignment = {
      user_id: userId,
      shift_id: newShiftId,
      effective_from: effectiveDate,
      assigned_by: assignedBy
    };

    return this.assignShiftToEmployee(newAssignment);
  }

  static async getEmployeeCurrentShift(userId: string): Promise<EmployeeShift | null> {
    const today = this.toLocalDateString();

    const { data, error } = await supabase
      .from('employee_shifts')
      .select(`
        *,
        shift:shifts(*)
      `)
      .eq('user_id', userId)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  static async getShiftAssignments(organizationId: string): Promise<EmployeeShift[]> {
    const { data, error } = await supabase
      .from('employee_shifts')
      .select(`
        *,
        shift:shifts(*),
        user:users!employee_shifts_user_id_fkey(id, name, department)
      `)
      .eq('shift.organization_id', organizationId)
      .order('effective_from', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // ========== ATTENDANCE TRACKING ==========

  static async punchIn(userId: string, punchData: PunchData): Promise<Attendance> {
    const currentTime = new Date().toISOString();

    // Industry-standard guard: never allow a second punch-in while an open punch exists.
    const existingOpenRecord = await this.getActiveOpenAttendanceRecord(userId, 2);
    if (existingOpenRecord) {
      throw new Error('You already have an active punch-in. Please punch out first.');
    }

    // Get user's organization and current shift
    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (!userData) throw new Error('User not found');

    // Validate geofence if coordinates are provided
    let geofenceResult = { isValid: true, distance: null as number | null, isOutsideGeofence: false };
    if (punchData.latitude && punchData.longitude) {
      geofenceResult = await this.validateGeofence(
        userData.organization_id,
        punchData.latitude,
        punchData.longitude
      );
    }

    const currentShift = await this.getEmployeeCurrentShift(userId);
    const attendanceDate = this.resolveAttendanceDateForPunchIn(currentShift?.shift);

    // Upload selfie
    const selfieUrl = await this.uploadSelfie(punchData.selfie_file, userId, 'punch_in', userData.organization_id);

    // Compute is_late from shift
    let isLate = false;
    if (currentShift?.shift) {
      const shift = currentShift.shift;
      const now = new Date();
      const punchMinutes = now.getHours() * 60 + now.getMinutes();
      const [startH, startM] = (shift.start_time || '09:00').split(':').map(Number);
      const shiftStartMinutes = startH * 60 + startM;
      const threshold = shift.late_threshold_minutes ?? 15;
      isLate = punchMinutes > shiftStartMinutes + threshold;
    }

    // Check if today is a weekly off or org holiday
    let isWeekend = false;
    let isHoliday = false;
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dutyDate = new Date(`${attendanceDate}T00:00:00`);
    const todayDayName = dayNames[dutyDate.getDay()];
    
    if (currentShift?.shift) {
      const weeklyOffs: string[] = (currentShift.shift as any).weekly_off_days || ['sunday'];
      isWeekend = weeklyOffs.includes(todayDayName);
    } else {
      isWeekend = todayDayName === 'sunday';
    }

    // Check org_holidays
    const { data: holidayData } = await supabase
      .from('org_holidays')
      .select('id')
      .eq('organization_id', userData.organization_id)
      .eq('date', attendanceDate)
      .limit(1);
    if (holidayData && holidayData.length > 0) {
      isHoliday = true;
    }

    // Create or update attendance record
    const attendanceData: any = {
      user_id: userId,
      organization_id: userData.organization_id,
      date: attendanceDate,
      shift_id: currentShift?.shift_id,
      punch_in_time: currentTime,
      punch_in_latitude: punchData.latitude,
      punch_in_longitude: punchData.longitude,
      punch_in_address: punchData.address,
      punch_in_selfie_url: selfieUrl,
      punch_in_device_info: punchData.device_info,
      punch_in_distance_meters: geofenceResult.distance,
      is_outside_geofence: geofenceResult.isOutsideGeofence,
      is_late: isLate,
      is_weekend: isWeekend,
      is_holiday: isHoliday,
      is_absent: false,
    };

    const { data, error } = await supabase
      .from('attendance')
      .upsert(attendanceData, { onConflict: 'user_id,date' })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async punchOut(userId: string, punchData: PunchData): Promise<Attendance> {
    const currentTime = new Date().toISOString();

    // Get user's organization
    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (!userData) throw new Error('User not found');

    // Validate geofence if coordinates are provided
    let geofenceResult = { isValid: true, distance: null as number | null, isOutsideGeofence: false };
    if (punchData.latitude && punchData.longitude) {
      geofenceResult = await this.validateGeofence(
        userData.organization_id,
        punchData.latitude,
        punchData.longitude
      );
    }

    // Find active punch-in record across day boundary for overnight shifts.
    const activeRecord = await this.getActiveOpenAttendanceRecord(userId, 2);
    if (!activeRecord) {
      throw new Error('No active punch-in found. Please punch in first.');
    }
    const punchInTime = activeRecord.punch_in_time;
    if (!punchInTime) {
      throw new Error('Active attendance record is missing punch-in time.');
    }

    // Validate duration for overnight shifts
    if (activeRecord.shift?.is_overnight) {
      const punchInDate = new Date(punchInTime);
      const punchOutDate = new Date(currentTime);
      const hoursDiff = (punchOutDate.getTime() - punchInDate.getTime()) / (1000 * 60 * 60);

      if (hoursDiff < 6) {
        throw new Error('Too early to punch out. Minimum 6 hours required for overnight shifts.');
      }
      if (hoursDiff > 18) {
        throw new Error('Exceeds maximum shift duration of 18 hours.');
      }
    }

    // Upload selfie
    const selfieUrl = await this.uploadSelfie(punchData.selfie_file, userId, 'punch_out', userData.organization_id);

    // Compute hours and flags
    const punchInDate = new Date(punchInTime);
    const punchOutDate = new Date(currentTime);
    const totalHours = (punchOutDate.getTime() - punchInDate.getTime()) / (1000 * 60 * 60);

    // Get shift details for flag computation
    let isEarlyOut = false;
    let isHalfDay = false;
    let breakMinutes = 60; // default
    
    if (activeRecord.shift_id) {
      const { data: shiftData } = await supabase
        .from('shifts')
        .select('*')
        .eq('id', activeRecord.shift_id)
        .single();
      
      if (shiftData) {
        breakMinutes = shiftData.break_duration_minutes ?? 60;
        const [endH, endM] = (shiftData.end_time || '17:00').split(':').map(Number);
        const shiftEndMinutes = endH * 60 + endM;
        const now = punchOutDate;
        const punchOutMinutes = now.getHours() * 60 + now.getMinutes();
        const earlyThreshold = shiftData.early_out_threshold_minutes ?? 15;
        
        if (!shiftData.is_overnight) {
          isEarlyOut = punchOutMinutes < (shiftEndMinutes - earlyThreshold);
        }
        
        const effectiveHours = totalHours - (breakMinutes / 60);
        isHalfDay = effectiveHours < (shiftData.duration_hours / 2);
      }
    } else {
      // No shift: default 8hr, half day if < 4hr effective
      const effectiveHours = totalHours - 1.0;
      isHalfDay = effectiveHours < 4.0;
    }

    const effectiveHours = Math.max(totalHours - (breakMinutes / 60), 0);

    // Update by ID (not date) to handle overnight shifts correctly
    const updateData: any = {
      punch_out_time: currentTime,
      punch_out_latitude: punchData.latitude,
      punch_out_longitude: punchData.longitude,
      punch_out_address: punchData.address,
      punch_out_selfie_url: selfieUrl,
      punch_out_device_info: punchData.device_info,
      punch_out_distance_meters: geofenceResult.distance,
      total_hours: Math.round(totalHours * 100) / 100,
      effective_hours: Math.round(effectiveHours * 100) / 100,
      is_early_out: isEarlyOut,
      is_half_day: isHalfDay,
    };

    // Update is_outside_geofence only if punch-out is also outside
    // (Keep the flag true if punch-in was outside, even if punch-out is inside)
    if (geofenceResult.isOutsideGeofence) {
      updateData.is_outside_geofence = true;
    }

    const { data, error } = await supabase
      .from('attendance')
      .update(updateData)
      .eq('id', activeRecord.id)  // Update by ID, not by date
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async getTodayAttendance(userId: string): Promise<Attendance | null> {
    const today = this.toLocalDateString();

    const { data, error } = await supabase
      .from('attendance')
      .select(`
        *,
        shift:shifts(*)
      `)
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  static async getTodayOrActiveAttendance(userId: string): Promise<Attendance | null> {
    const active = await this.getActiveOpenAttendanceRecord(userId, 2);
    if (active) return active;
    return this.getTodayAttendance(userId);
  }

  static async getAttendanceHistory(userId: string, fromDate: string, toDate: string): Promise<Attendance[]> {
    const { data, error } = await supabase
      .from('attendance')
      .select(`
        *,
        shift:shifts(*)
      `)
      .eq('user_id', userId)
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('date', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  static async getOrganizationAttendance(organizationId: string, date: string): Promise<Attendance[]> {
    const { data, error } = await supabase
      .from('attendance')
      .select(`
        *,
        shift:shifts(*),
        user:users!attendance_user_id_fkey(id, name, department)
      `)
      .eq('organization_id', organizationId)
      .eq('date', date)
      .order('punch_in_time', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  // ========== REGULARIZATION ==========

  static async createRegularizationRequest(request: Omit<AttendanceRegularization, 'id' | 'status' | 'created_at' | 'updated_at'>): Promise<AttendanceRegularization> {
    const { data, error } = await supabase
      .from('attendance_regularizations')
      .insert({ ...request, status: 'pending' })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async approveRegularization(id: string, adminId: string, remarks?: string): Promise<void> {
    const { error } = await supabase
      .from('attendance_regularizations')
      .update({
        status: 'approved',
        approved_by: adminId,
        admin_remarks: remarks,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;

    // Update attendance record
    const { data: regularization } = await supabase
      .from('attendance_regularizations')
      .select('attendance_id')
      .eq('id', id)
      .single();

    if (regularization) {
      await supabase
        .from('attendance')
        .update({
          is_regularized: true,
          regularized_by: adminId,
          regularization_reason: remarks || '',
          regularized_at: new Date().toISOString()
        })
        .eq('id', regularization.attendance_id);
    }
  }

  static async rejectRegularization(id: string, adminId: string, remarks?: string): Promise<void> {
    const { error } = await supabase
      .from('attendance_regularizations')
      .update({
        status: 'rejected',
        approved_by: adminId,
        admin_remarks: remarks,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;
  }

  static async getPendingRegularizations(organizationId: string): Promise<AttendanceRegularization[]> {
    const { data, error } = await supabase
      .from('attendance_regularizations')
      .select(`
        *,
        attendance:attendance(*),
        requester:users!requested_by(id, name, department)
      `)
      .eq('attendance.organization_id', organizationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  static async closeStaleOpenSessions(
    organizationId: string,
    adminId: string,
    maxOpenHours: number = 18
  ): Promise<{ closedCount: number; scannedCount: number; closedIds: string[] }> {
    const now = new Date();
    const safeMaxOpenHours = Number.isFinite(maxOpenHours) && maxOpenHours > 0 ? maxOpenHours : 18;

    const { data: openRows, error } = await supabase
      .from('attendance')
      .select('id, punch_in_time, punch_out_time')
      .eq('organization_id', organizationId)
      .not('punch_in_time', 'is', null)
      .is('punch_out_time', null);

    if (error) throw error;

    const candidates = (openRows || []).filter((row: any) => {
      const inTime = row?.punch_in_time ? new Date(row.punch_in_time) : null;
      if (!inTime || Number.isNaN(inTime.getTime())) return false;
      const ageHours = (now.getTime() - inTime.getTime()) / (1000 * 60 * 60);
      return ageHours >= safeMaxOpenHours;
    });

    const closedIds: string[] = [];
    for (const row of candidates) {
      const inTime = new Date(row.punch_in_time);
      const autoOut = new Date(Math.min(now.getTime(), inTime.getTime() + safeMaxOpenHours * 60 * 60 * 1000));

      const { error: updateError } = await supabase
        .from('attendance')
        .update({
          punch_out_time: autoOut.toISOString(),
          punch_out_address: `Auto-closed by admin cleanup after ${safeMaxOpenHours}h`,
          punch_out_device_info: {
            source: 'admin_stale_session_cleanup',
            closed_by: adminId,
            closed_at: now.toISOString(),
            max_open_hours: safeMaxOpenHours
          },
          is_regularized: true,
          regularized_by: adminId,
          regularization_reason: `Auto-closed stale open attendance session (>${safeMaxOpenHours}h).`,
          regularized_at: now.toISOString(),
        })
        .eq('id', row.id);

      if (!updateError) {
        closedIds.push(row.id);
      } else {
        console.error('Failed to auto-close stale attendance row:', row.id, updateError);
      }
    }

    return {
      closedCount: closedIds.length,
      scannedCount: (openRows || []).length,
      closedIds
    };
  }

  // ========== UTILITY FUNCTIONS ==========

  static async uploadSelfie(file: File, userId: string, type: 'punch_in' | 'punch_out', organizationId: string): Promise<string> {
    try {
      // Create organized folder structure: attendance/orgId/year/month/day/userId/type_timestamp.jpg
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0'); // 01-12
      const day = String(now.getDate()).padStart(2, '0'); // 01-31
      const timestamp = now.getTime();
      const fileName = `attendance/${organizationId}/${year}/${month}/${day}/${userId}/${type}_${timestamp}.jpg`;

      const { error } = await supabase.storage
        .from('attendance-selfies')
        .upload(fileName, file);

      if (error) {
        console.error('Storage upload error:', error);
        // Return a placeholder URL if upload fails
        return `placeholder-${type}-${timestamp}`;
      }

      const { data: urlData } = supabase.storage
        .from('attendance-selfies')
        .getPublicUrl(fileName);

      return urlData.publicUrl;
    } catch (error) {
      console.error('Error uploading selfie:', error);
      // Return a placeholder URL if there's any error
      const timestamp = new Date().getTime();
      return `placeholder-${type}-${timestamp}`;
    }
  }

  static async getAttendanceSummary(userId: string, month: string): Promise<AttendanceSummary> {
    const startDate = `${month}-01`;
    const endDate = new Date(new Date(month + '-01').getFullYear(), new Date(month + '-01').getMonth() + 1, 0)
      .toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) throw error;

    const attendanceRecords = data || [];
    const totalDays = attendanceRecords.length;
    const presentDays = attendanceRecords.filter(a => a.punch_in_time).length;
    const absentDays = attendanceRecords.filter(a => a.is_absent).length;
    const halfDayCount = attendanceRecords.filter(a => (a as any).is_half_day).length;
    const lateDays = attendanceRecords.filter(a => a.is_late).length;
    const earlyOutDays = attendanceRecords.filter(a => a.is_early_out).length;
    const totalHours = attendanceRecords.reduce((sum, a) => sum + (a.effective_hours || 0), 0);
    const lwpDays = attendanceRecords.filter(a => a.is_absent && !a.is_holiday && !a.is_weekend).length;
    const regularizedDays = attendanceRecords.filter(a => a.is_regularized).length;

    return {
      total_days: totalDays,
      present_days: presentDays,
      absent_days: absentDays,
      half_day_count: halfDayCount,
      late_days: lateDays,
      early_out_days: earlyOutDays,
      total_hours: totalHours,
      average_hours: presentDays > 0 ? totalHours / presentDays : 0,
      lwp_days: lwpDays,
      regularized_days: regularizedDays
    };
  }

  static getCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => reject(error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  static async getAddressFromCoordinates(latitude: number, longitude: number): Promise<string> {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
      );
      const data = await response.json();
      return data.display_name || `${latitude}, ${longitude}`;
    } catch (error) {
      return `${latitude}, ${longitude}`;
    }
  }
}
