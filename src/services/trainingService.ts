import { supabase } from '../utils/supabaseClient';
import { requireVerifiedOrganization } from '../utils/verifiedOrganization';

export type AttendanceStatus = 'invited' | 'attended' | 'absent' | 'excused';
export type CompletionStatus = 'pending' | 'in_progress' | 'completed';
export interface TrainingSession {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  trainer: string;
  location: string;
  starts_at: string;
  ends_at: string;
  material_document_id: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  updated_at: string;
}
export interface TrainingAttendee {
  id: string;
  session_id: string;
  user_id: string;
  employee_name: string;
  department: string;
  attendance_status: AttendanceStatus;
  completion_status: CompletionStatus;
  completed_at: string | null;
  notes: string;
  updated_at: string;
}
export interface TrainingEmployee {
  id: string;
  name: string;
  department: string | null;
  is_active: boolean | null;
}
export interface TrainingMaterial { id: string; original_file_name: string }
export interface TrainingEvent {
  id: string;
  user_id: string | null;
  actor_name: string;
  event_type: string;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  created_at: string;
}
export interface TrainingData {
  userId: string;
  isAdmin: boolean;
  sessions: TrainingSession[];
  attendees: TrainingAttendee[];
  employees: TrainingEmployee[];
  materials: TrainingMaterial[];
}
export type TrainingSessionInput = Pick<TrainingSession, 'title' | 'description' | 'trainer' | 'location' | 'starts_at' | 'ends_at' | 'material_document_id'>;

// Explicit paging prevents Supabase's row cap from silently dropping employee history.
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await page(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

export const trainingService = {
  async load(): Promise<TrainingData> {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!auth.user) throw new Error('Sign in to view training.');
    const { data: profile, error } = await supabase.from('users')
      .select('id,auth_id,organization_id,is_active,role').eq('auth_id', auth.user.id).single();
    if (error) throw error;
    const org = requireVerifiedOrganization(profile, auth.user.id);
    const { data: access, error: accessError } = await supabase.rpc('fn_my_staff_access');
    if (accessError) throw accessError;
    const isAdmin = access.permissions.includes('training.manage');
    const [sessions, attendees, employees, materials] = await Promise.all([
      readAll<TrainingSession>((from, to) => supabase.from('training_sessions').select('*')
        .eq('organization_id', org).order('id').range(from, to)),
      readAll<TrainingAttendee>((from, to) => supabase.from('training_attendees')
        .select('*,training_sessions!inner(organization_id)').eq('training_sessions.organization_id', org)
        .order('id').range(from, to)),
      isAdmin ? readAll<TrainingEmployee>((from, to) => supabase.rpc('fn_training_employee_directory')
        .order('id').range(from, to)) : Promise.resolve([]),
      isAdmin ? readAll<TrainingMaterial>((from, to) => supabase.from('organization_documents')
        .select('id,original_file_name').eq('organization_id', org).eq('category', 'training')
        .is('deleted_at', null).order('id').range(from, to)) : Promise.resolve([]),
    ]);
    return { userId: profile.id, isAdmin, sessions, attendees, employees, materials };
  },

  async saveSession(input: TrainingSessionInput, attendeeIds: string[], existing?: TrainingSession): Promise<string> {
    const { data, error } = await supabase.rpc('fn_save_training_session', {
      p_session: input, p_attendee_ids: attendeeIds, p_id: existing?.id || null,
      p_expected_updated_at: existing?.updated_at || null,
    });
    if (error) throw error;
    return data as string;
  },

  async recordAttendee(attendee: TrainingAttendee, attendance: AttendanceStatus, completion: CompletionStatus, notes: string): Promise<void> {
    const { error } = await supabase.rpc('fn_record_training_attendee', {
      p_id: attendee.id, p_attendance: attendance, p_completion: completion,
      p_notes: notes, p_expected_updated_at: attendee.updated_at,
    });
    if (error) throw error;
  },

  async setStatus(session: TrainingSession, status: 'completed' | 'cancelled'): Promise<void> {
    const { error } = await supabase.rpc('fn_set_training_session_status', {
      p_id: session.id, p_status: status, p_expected_updated_at: session.updated_at,
    });
    if (error) throw error;
  },

  async history(sessionId: string): Promise<TrainingEvent[]> {
    return readAll<TrainingEvent>((from, to) => supabase.from('training_events').select('*')
      .eq('session_id', sessionId).order('created_at', { ascending: false }).order('id').range(from, to));
  },
};
