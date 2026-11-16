import { supabase } from '../utils/supabaseClient';

export const STAFF_PERMISSIONS = {
  'training.manage': 'Manage training schedules, attendees and completion',
  'training_materials.manage': 'Upload and manage training materials',
  'attendance.approve': 'View team attendance and approve corrections / regularization',
  'leave.approve': 'View and approve leave requests',
} as const;
export type StaffPermission = keyof typeof STAFF_PERMISSIONS;
export interface StaffAccess {
  user_id: string; organization_id: string; full_admin: boolean; permissions: StaffPermission[]; groups: string[];
}
export interface AccessEmployee { id: string; name: string; department: string | null; is_active: boolean | null }
export interface AccessGroup {
  id: string; name: string; code: string | null; permissions: StaffPermission[]; enabled: boolean;
  member_ids: string[]; updated_at: string;
}
export interface AccessGroupPage { groups: AccessGroup[]; employees: AccessEmployee[] }
export interface AccessEvent {
  id: string; actor_name: string; created_at: string;
  before_value: (AccessGroup & { members: { id: string; name: string }[] }) | null;
  after_value: AccessGroup & { members: { id: string; name: string }[] };
}
export const staffAccessService = {
  async mine(): Promise<StaffAccess> {
    const { data, error } = await supabase.rpc('fn_my_staff_access');
    if (error) throw error;
    return data;
  },
  async groups(): Promise<AccessGroupPage> {
    const { data, error } = await supabase.rpc('fn_staff_access_groups');
    if (error) throw error;
    return data;
  },
  async save(name: string, permissions: StaffPermission[], members: string[], enabled: boolean, existing?: AccessGroup): Promise<string> {
    const { data, error } = await supabase.rpc('fn_save_staff_access_group', {
      p_name: name.trim(), p_permissions: permissions, p_members: members, p_enabled: enabled,
      p_id: existing?.id || null, p_expected_updated_at: existing?.updated_at || null,
    });
    if (error) throw error;
    return data;
  },
  async history(groupId: string, offset = 0): Promise<AccessEvent[]> {
    const { data, error } = await supabase.from('staff_access_events').select('*').eq('group_id', groupId)
      .order('created_at', { ascending: false }).order('id').range(offset, offset + 19);
    if (error) throw error;
    return data || [];
  },
  async approvers(): Promise<{ id: string; name: string; department: string }[]> {
    const { data, error } = await supabase.rpc('fn_staff_approvers', { p_permission: 'leave.approve' });
    if (error) throw error;
    return data || [];
  },
};
