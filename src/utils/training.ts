import type { TrainingAttendee, TrainingSession } from '../services/trainingService';

export function trainingSummary(attendees: TrainingAttendee[], sessions: TrainingSession[]) {
  const activeIds = new Set(sessions.filter(s => s.status !== 'cancelled').map(s => s.id));
  const eligible = attendees.filter(a => activeIds.has(a.session_id));
  const completed = eligible.filter(a => a.completion_status === 'completed').length;
  return { assigned: eligible.length, attended: eligible.filter(a => a.attendance_status === 'attended').length,
    completed, outstanding: eligible.length - completed };
}

export function localTrainingDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function trainingCsv(sessions: TrainingSession[], attendees: TrainingAttendee[]): string {
  // Prevent spreadsheet formulas in exported free-text fields.
  const cell = (value: string) => `"${(/^[\s]*[=+@-]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
  const rows = [['Employee', 'Department', 'Training', 'Trainer', 'Starts at (ISO)', 'Ends at (ISO)', 'Session status', 'Attendance', 'Completion', 'Completed at (ISO)', 'Notes']];
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  for (const a of attendees) {
    const s = sessionsById.get(a.session_id);
    if (s) rows.push([a.employee_name, a.department, s.title, s.trainer, s.starts_at, s.ends_at,
      s.status, a.attendance_status, a.completion_status, a.completed_at || '', a.notes]);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
