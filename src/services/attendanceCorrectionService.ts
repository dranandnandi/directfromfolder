import { Attendance, AttendanceCorrectionRequest } from '../models/attendance';
import { supabase } from '../utils/supabaseClient';

export const attendanceCorrectionService = {
  async getDay(userId: string, date: string): Promise<Attendance | null> {
    const { data, error } = await supabase.from('attendance')
      .select('*, sessions:attendance_sessions(*)').eq('user_id', userId).eq('date', date).maybeSingle();
    if (error) throw error;
    return data;
  },
  async list(organizationId: string, userId: string | null, status: string, page = 0) {
    let query = supabase.from('attendance_correction_requests')
      .select('*, employee:users!attendance_correction_requests_user_id_fkey(name, department)', { count: 'exact' })
      .eq('organization_id', organizationId);
    if (userId) query = query.eq('user_id', userId);
    if (status !== 'all') query = query.eq('status', status);
    const { data, count, error } = await query.order('created_at', { ascending: false }).range(page * 20, page * 20 + 19);
    if (error) throw error;
    return { requests: (data || []) as AttendanceCorrectionRequest[], total: count || 0 };
  },
  async submit(date: string, punchIn: string, punchOut: string, reason: string, sessionId: string | null) {
    const { data, error } = await supabase.rpc('fn_request_attendance_correction', {
      p_date: date, p_punch_in: `${punchIn}+05:30`, p_punch_out: `${punchOut}+05:30`,
      p_reason: reason.trim(), p_session_id: sessionId
    });
    if (error) throw error;
    return data as string;
  },
  async decide(requestId: string, action: 'approve' | 'reject' | 'cancel', note: string) {
    const { error } = await supabase.rpc('fn_decide_attendance_correction', {
      p_request_id: requestId, p_action: action, p_note: note.trim()
    });
    if (error) throw error;
  }
};
