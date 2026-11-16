import React, { useState } from 'react';
import { AttendanceService } from '../../services/attendanceService';
import { attendanceDateTime } from '../../utils/attendanceCorrection';

interface Props {
  employee: { id: string; name: string };
  date: string;
  action: 'in' | 'out';
  punchInTime?: string;
  onClose: () => void;
  onSaved: () => void;
}

const AdminMarkAttendance: React.FC<Props> = ({ employee, date, action, punchInTime, onClose, onSaved }) => {
  const now = attendanceDateTime(new Date().toISOString());
  const [time, setTime] = useState(`${date}T${now.slice(11)}`);
  const [reason, setReason] = useState('Attendance marked by admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = action === 'in' ? 'Punch in' : 'Punch out';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    const timestamp = Date.parse(`${time}+05:30`);
    if (!Number.isFinite(timestamp) || timestamp > Date.now()) {
      setError('Choose a valid punch time that is not in the future.');
      return;
    }
    if (action === 'in' && time.slice(0, 10) !== date) {
      setError('Punch-in must start on the selected attendance date.');
      return;
    }
    if (action === 'out' && punchInTime && timestamp <= Date.parse(punchInTime)) {
      setError('Punch-out must be after punch-in. Choose the next date for overnight work.');
      return;
    }
    if (reason.trim().length < 5 || reason.trim().length > 2000) {
      setError('Enter a reason of 5 to 2000 characters.');
      return;
    }
    setBusy(true);
    try {
      await AttendanceService.adminMarkPunch(employee.id, date, action, new Date(timestamp).toISOString(), reason);
      onSaved();
    } catch (failure: any) {
      setError(failure?.message || 'Unable to mark attendance. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="admin-punch-title"
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h3 id="admin-punch-title" className="text-xl font-semibold">{label} for {employee.name}</h3>
        <p className="mt-2 text-sm text-gray-600">Attendance date: {date}. Admin entry requires no location or selfie.</p>
        {punchInTime && <p className="mt-2 text-sm text-gray-600">Punched in: {attendanceDateTime(punchInTime).replace('T', ' ')} IST</p>}
        <label className="mt-4 block text-sm font-medium">
          {label} time (IST)
          <input type="datetime-local" step="1" required value={time} max={now} disabled={busy}
            onChange={event => setTime(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 p-2" />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Reason
          <textarea required minLength={5} maxLength={2000} value={reason} disabled={busy}
            onChange={event => setReason(event.target.value)} rows={3}
            className="mt-1 block w-full rounded-lg border border-gray-300 p-2" />
        </label>
        <p className="mt-2 text-xs text-gray-500">Your name, reason and punch time are saved in the attendance audit log.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose}
            className="rounded-lg border px-4 py-2 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Saving…' : label}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminMarkAttendance;
