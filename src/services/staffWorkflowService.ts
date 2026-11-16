import { supabase } from '../utils/supabaseClient';

export type ApprovalKind = 'leave' | 'correction' | 'regularization' | 'ai_review';
export interface StaffApproval {
  id: string; kind: ApprovalKind; user_id: string | null; employee_name: string; department: string | null;
  work_date: string | null; created_at: string; status: string; reason: string; details: Record<string, any>;
  reviewed_at: string | null; reviewer_name: string | null; decision_note: string | null; can_review: boolean;
}
export interface ApprovalPage { items: StaffApproval[]; total: number; pending_count: number; overdue_count: number }
export interface PayrollReadiness {
  ready: boolean; employee_count: number; period_start: string; period_end: string; checked_at: string;
  groups: Array<{ code: string; label: string; path: string; count: number; blocking: boolean;
    examples: Array<{ user_id: string | null; name: string; detail: string }> }>;
}
export const staffWorkflowService = {
  async approvals(status = 'pending', kind = 'all', offset = 0): Promise<ApprovalPage> {
    const { data, error } = await supabase.rpc('fn_staff_approvals', { p_status: status, p_kind: kind, p_offset: offset });
    if (error) throw error;
    return data;
  },
  async review(kind: ApprovalKind, id: string, action: 'approve' | 'reject', note: string) {
    const { error } = await supabase.rpc('fn_review_staff_request', { p_kind: kind, p_id: id, p_action: action, p_note: note.trim() });
    if (error) throw error;
  },
  async decideLeave(id: string, action: 'approve' | 'reject' | 'cancel', note: string) {
    const { error } = await supabase.rpc('fn_decide_staff_leave', { p_id: id, p_action: action, p_note: note.trim() });
    if (error) throw error;
  },
  async readiness(orgId: string, month: number, year: number, posting = false): Promise<PayrollReadiness> {
    const { data, error } = await supabase.rpc('fn_get_payroll_readiness', {
      p_organization_id: orgId, p_month: month, p_year: year, p_posting: posting
    });
    if (error) throw error;
    return data;
  }
};

export const workflowError = (error: unknown) => (error as { message?: string })?.message || 'Unable to complete the request. Please retry.';
