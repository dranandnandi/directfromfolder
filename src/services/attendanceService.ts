import { supabase } from '../utils/supabaseClient';
import { Shift, EmployeeShift, Attendance, AttendanceRegularization, PunchData, AttendanceSummary } from '../models/attendance';

export class AttendanceService {
  
  // ========== SHIFT MANAGEMENT ==========
  
  static async createShift(shift: Omit<Shift, 'id' | 'created_at' | 'updated_at'>): Promise<Shift> {
    console.log('Creating shift:', shift);
    
    const { data, error } = await supabase
      .from('shifts')
      .insert(shift)
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
    const today = new Date().toISOString().split('T')[0];
    
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
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toISOString();
    
    // Get user's organization and current shift
    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();
    
    if (!userData) throw new Error('User not found');
    
    const currentShift = await this.getEmployeeCurrentShift(userId);
    
    // Upload selfie
    const selfieUrl = await this.uploadSelfie(punchData.selfie_file, userId, 'punch_in', userData.organization_id);
    
    // Create or update attendance record
    const attendanceData = {
      user_id: userId,
      organization_id: userData.organization_id,
      date: today,
      shift_id: currentShift?.shift_id,
      punch_in_time: currentTime,
      punch_in_latitude: punchData.latitude,
      punch_in_longitude: punchData.longitude,
      punch_in_address: punchData.address,
      punch_in_selfie_url: selfieUrl,
      punch_in_device_info: punchData.device_info,
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
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toISOString();
    
    // Get user's organization
    const { data: userData } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();
    
    if (!userData) throw new Error('User not found');
    
    // Upload selfie
    const selfieUrl = await this.uploadSelfie(punchData.selfie_file, userId, 'punch_out', userData.organization_id);
    
    const { data, error } = await supabase
      .from('attendance')
      .update({
        punch_out_time: currentTime,
        punch_out_latitude: punchData.latitude,
        punch_out_longitude: punchData.longitude,
        punch_out_address: punchData.address,
        punch_out_selfie_url: selfieUrl,
        punch_out_device_info: punchData.device_info,
      })
      .eq('user_id', userId)
      .eq('date', today)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
  
  static async getTodayAttendance(userId: string): Promise<Attendance | null> {
    const today = new Date().toISOString().split('T')[0];
    
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
    const lateDays = attendanceRecords.filter(a => a.is_late).length;
    const earlyOutDays = attendanceRecords.filter(a => a.is_early_out).length;
    const totalHours = attendanceRecords.reduce((sum, a) => sum + (a.effective_hours || 0), 0);
    const lwpDays = attendanceRecords.filter(a => a.is_absent && !a.is_holiday && !a.is_weekend).length;
    const regularizedDays = attendanceRecords.filter(a => a.is_regularized).length;
    
    return {
      total_days: totalDays,
      present_days: presentDays,
      absent_days: absentDays,
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
