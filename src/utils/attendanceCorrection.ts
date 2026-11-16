export const ATTENDANCE_TIME_ZONE = 'Asia/Kolkata';

/** A datetime-local field representing the attendance calendar, independent of device timezone. */
export function attendanceDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ATTENDANCE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

export const attendanceToday = () => attendanceDateTime(new Date().toISOString()).slice(0, 10);

export function validateCorrection(date: string, punchIn: string, punchOut: string, reason: string, now = Date.now()): string | null {
  if (!date || !punchIn || !punchOut) return 'Choose the attendance date and both punch times.';
  const start = Date.parse(`${punchIn}+05:30`);
  const end = Date.parse(`${punchOut}+05:30`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Enter valid punch times.';
  if (punchIn.slice(0, 10) !== date) return 'Punch-in must start on the attendance date.';
  if (end <= start) return 'Punch-out must be after punch-in. For overnight work, choose the next date for punch-out.';
  if (end - start > 24 * 60 * 60 * 1000) return 'A corrected session cannot exceed 24 hours.';
  if (end > now) return 'Use completed work times. Punch-out cannot be in the future.';
  if (reason.trim().length < 5 || reason.trim().length > 2000) return 'Give a reason of 5 to 2000 characters.';
  return null;
}
