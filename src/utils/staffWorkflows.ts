export const approvalLabels = {
  leave: 'Leave', correction: 'Punch correction', regularization: 'Attendance exception', ai_review: 'AI review'
};
export const isOverdueRequest = (createdAt: string, now = Date.now()) => now - new Date(createdAt).getTime() > 86400000;

export function leaveStatus(status: string, cancelledAt?: string | null) {
  return cancelledAt ? 'cancelled' : status.toLowerCase() === 'completed' ? 'approved'
    : ['cancelled', 'rejected'].includes(status.toLowerCase()) ? 'rejected' : 'pending';
}
export function overlappingLeave<T extends { id: string; start_date: string; end_date?: string; status: string }>(
  requests: T[], start: string, end?: string
): T | undefined {
  if (!start) return undefined;
  return requests.find(request => ['pending', 'approved'].includes(request.status)
    && request.start_date <= (end || start) && (request.end_date || request.start_date) >= start);
}
export const workflowDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
  ...(value.includes('T') ? { hour: '2-digit', minute: '2-digit' } as const : {})
}).format(new Date(value.includes('T') ? value : `${value}T12:00:00+05:30`)) : 'Not recorded';
