import React, { useState, useEffect } from 'react';
import { HiUsers, HiClock, HiExclamationCircle, HiCheck, HiX, HiEye, HiLocationMarker, HiCamera } from 'react-icons/hi';
import { AttendanceService } from '../../services/attendanceService';
import { Attendance, AttendanceRegularization } from '../../models/attendance';
import { supabase } from '../../utils/supabaseClient';
import { formatDistance } from '../../utils/geolocation';
import PunchInOut from './PunchInOut';
import { useNavigate } from 'react-router-dom';

interface MonthlyCumulativeRow {
  user_id: string;
  user_name: string;
  user_department: string;
  present_days: number;
  absent_days: number;
  half_day_count: number;
  late_days: number;
  early_out_days: number;
  regularized_days: number;
  total_effective_hours: number;
  source: 'system' | 'override';
}

interface AttendanceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  attendance: any;
}

const AttendanceDetailModal: React.FC<AttendanceDetailModalProps> = ({
  isOpen,
  onClose,
  attendance
}) => {
  if (!isOpen || !attendance) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-96 overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold">Attendance Details - {attendance.user?.name}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <HiX className="w-6 h-6" />
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900">Basic Information</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Date:</span>
                <span className="text-sm font-medium">{new Date(attendance.date).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Department:</span>
                <span className="text-sm font-medium">{attendance.user?.department || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Total Hours:</span>
                <span className="text-sm font-medium">{attendance.total_hours ? `${Number(attendance.total_hours).toFixed(2)}h` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Effective Hours:</span>
                <span className="text-sm font-medium">{attendance.effective_hours ? `${Number(attendance.effective_hours).toFixed(2)}h` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Status:</span>
                <div className="flex flex-wrap gap-1">
                  <span className={`text-sm px-2 py-1 rounded-full ${
                    attendance.attendance_status === 'present' ? 'bg-green-100 text-green-800' :
                    attendance.attendance_status === 'late' ? 'bg-yellow-100 text-yellow-800' :
                    attendance.attendance_status === 'absent' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {attendance.attendance_status || (attendance.punch_in_time ? 'Present' : 'Absent')}
                  </span>
                  {attendance.is_late && (
                    <span className="text-sm px-2 py-1 rounded-full bg-red-100 text-red-800">Late</span>
                  )}
                  {attendance.is_early_out && (
                    <span className="text-sm px-2 py-1 rounded-full bg-orange-100 text-orange-800">Early Out</span>
                  )}
                  {attendance.is_half_day && (
                    <span className="text-sm px-2 py-1 rounded-full bg-purple-100 text-purple-800">Half Day</span>
                  )}
                  {attendance.is_weekend && (
                    <span className="text-sm px-2 py-1 rounded-full bg-gray-100 text-gray-600">Weekly Off</span>
                  )}
                  {attendance.is_holiday && (
                    <span className="text-sm px-2 py-1 rounded-full bg-indigo-100 text-indigo-800">Holiday</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Shift Information */}
          {attendance.shift_name && (
            <div className="space-y-4">
              <h4 className="font-medium text-gray-900">Shift Information</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Shift:</span>
                  <span className="text-sm font-medium">{attendance.shift_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Expected Time:</span>
                  <span className="text-sm font-medium">
                    {attendance.shift_start_time} - {attendance.shift_end_time}
                  </span>
                </div>
                {/* Fix late/early calculation display */}
                {attendance.punch_in_time && attendance.shift_start_time && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Late/Early:</span>
                    <span className="text-sm font-medium">
                      {attendance.is_late ? (
                        <span className="text-red-600">Late</span>
                      ) : attendance.is_early_out ? (
                        <span className="text-orange-600">Early Out</span>
                      ) : (
                        <span className="text-green-600">On time</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Punch In Details */}
          {attendance.punch_in_time && (
            <div className="space-y-4">
              <h4 className="font-medium text-gray-900 flex items-center gap-2">
                <HiCamera className="w-4 h-4" />
                Punch In Details
              </h4>
              <div className="space-y-3">
                <div>
                  <span className="text-sm text-gray-600">Time:</span>
                  <div className="text-sm font-medium">{new Date(attendance.punch_in_time).toLocaleString()}</div>
                </div>
                {attendance.punch_in_address && (
                  <div>
                    <span className="text-sm text-gray-600 flex items-center gap-1">
                      <HiLocationMarker className="w-3 h-3" />
                      Location:
                    </span>
                    <div className="text-sm">{attendance.punch_in_address}</div>
                  </div>
                )}
                {attendance.punch_in_selfie_url && !attendance.punch_in_selfie_url.startsWith('placeholder-') && (
                  <div>
                    <span className="text-sm text-gray-600">Photo:</span>
                    <div className="mt-1">
                      <img
                        src={attendance.punch_in_selfie_url}
                        alt="Punch In Photo"
                        className="w-24 h-24 object-cover rounded-lg border"
                        onError={(e) => {
                          const img = e.currentTarget as HTMLImageElement;
                          const fallback = img.nextElementSibling as HTMLElement;
                          if (img && fallback) {
                            img.style.display = 'none';
                            fallback.style.display = 'block';
                          }
                        }}
                      />
                      <div className="hidden text-xs text-gray-500 mt-1">
                        Image not available
                      </div>
                    </div>
                  </div>
                )}
                {attendance.punch_in_selfie_url && attendance.punch_in_selfie_url.startsWith('placeholder-') && (
                  <div>
                    <span className="text-sm text-gray-600">Photo:</span>
                    <div className="mt-1 text-xs text-gray-500">
                      Photo not captured
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Punch Out Details */}
          {attendance.punch_out_time && (
            <div className="space-y-4">
              <h4 className="font-medium text-gray-900 flex items-center gap-2">
                <HiCamera className="w-4 h-4" />
                Punch Out Details
              </h4>
              <div className="space-y-3">
                <div>
                  <span className="text-sm text-gray-600">Time:</span>
                  <div className="text-sm font-medium">{new Date(attendance.punch_out_time).toLocaleString()}</div>
                </div>
                {attendance.punch_out_address && (
                  <div>
                    <span className="text-sm text-gray-600 flex items-center gap-1">
                      <HiLocationMarker className="w-3 h-3" />
                      Location:
                    </span>
                    <div className="text-sm">{attendance.punch_out_address}</div>
                  </div>
                )}
                {attendance.punch_out_selfie_url && !attendance.punch_out_selfie_url.startsWith('placeholder-') && (
                  <div>
                    <span className="text-sm text-gray-600">Photo:</span>
                    <div className="mt-1">
                      <img
                        src={attendance.punch_out_selfie_url}
                        alt="Punch Out Photo"
                        className="w-24 h-24 object-cover rounded-lg border"
                        onError={(e) => {
                          const img = e.currentTarget as HTMLImageElement;
                          const fallback = img.nextElementSibling as HTMLElement;
                          if (img && fallback) {
                            img.style.display = 'none';
                            fallback.style.display = 'block';
                          }
                        }}
                      />
                      <div className="hidden text-xs text-gray-500 mt-1">
                        Image not available
                      </div>
                    </div>
                  </div>
                )}
                {attendance.punch_out_selfie_url && attendance.punch_out_selfie_url.startsWith('placeholder-') && (
                  <div>
                    <span className="text-sm text-gray-600">Photo:</span>
                    <div className="mt-1 text-xs text-gray-500">
                      Photo not captured
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        
        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

interface RegularizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  regularizations: AttendanceRegularization[];
  onApprove: (id: string, remarks?: string) => void;
  onReject: (id: string, remarks?: string) => void;
}

const RegularizationModal: React.FC<RegularizationModalProps> = ({
  isOpen,
  onClose,
  regularizations,
  onApprove,
  onReject
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-96 overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Pending Regularizations</h3>
        
        <div className="space-y-4">
          {regularizations.map((reg) => (
            <div key={reg.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-medium">{reg.requester?.name}</div>
                  <div className="text-sm text-gray-600">{reg.requester?.department}</div>
                </div>
                <div className="text-sm text-gray-500">
                  {new Date(reg.created_at).toLocaleDateString()}
                </div>
              </div>
              
              <div className="text-sm mb-3">
                <strong>Reason:</strong> {reg.reason}
              </div>
              
              {reg.attendance && (
                <div className="text-xs text-gray-600 mb-3">
                  Date: {reg.attendance.date} | 
                  Punch In: {reg.attendance.punch_in_time ? new Date(reg.attendance.punch_in_time).toLocaleTimeString() : 'N/A'} | 
                  Punch Out: {reg.attendance.punch_out_time ? new Date(reg.attendance.punch_out_time).toLocaleTimeString() : 'N/A'}
                </div>
              )}
              
              <div className="flex gap-2">
                <button
                  onClick={() => onApprove(reg.id, 'Approved')}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  onClick={() => onReject(reg.id, 'Rejected')}
                  className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          
          {regularizations.length === 0 && (
            <div className="text-center text-gray-500 py-8">
              No pending regularizations
            </div>
          )}
        </div>
        
        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const AttendanceDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [regularizations, setRegularizations] = useState<AttendanceRegularization[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [showRegularizations, setShowRegularizations] = useState(false);
  const [showAttendanceDetail, setShowAttendanceDetail] = useState(false);
  const [selectedAttendance, setSelectedAttendance] = useState<any>(null);
  const [organizationId, setOrganizationId] = useState<string>('');
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [monthlyRows, setMonthlyRows] = useState<MonthlyCumulativeRow[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [duplicateRowsCollapsed, setDuplicateRowsCollapsed] = useState(0);
  const [aiHealth, setAiHealth] = useState<{ lastRunAt: string | null; pendingReview: number }>({
    lastRunAt: null,
    pendingReview: 0
  });

  useEffect(() => {
    initializeData();
  }, []);

  useEffect(() => {
    if (organizationId) {
      fetchAttendanceData();
      fetchAIHealth();
    }
  }, [selectedDate, organizationId]);

  useEffect(() => {
    if (organizationId) {
      fetchMonthlyCumulative();
    }
  }, [organizationId, selectedMonth]);

  const initializeData = async () => {
    try {
      // Get current user's organization and role
      const { data: currentUser } = await supabase.auth.getUser();
      console.log('Current user:', currentUser.user?.id);
      if (!currentUser.user?.id) return;

      const { data: userData } = await supabase
        .from('users')
        .select('organization_id, role, id')
        .eq('auth_id', currentUser.user.id)
        .single();

      console.log('User data:', userData);
      
      if (!userData?.organization_id) {
        console.log('No organization ID found for user');
        return;
      }

      console.log('Setting organization ID:', userData.organization_id);
      console.log('User role:', userData.role);
      setOrganizationId(userData.organization_id);
      setCurrentUserRole(userData.role);
    } catch (error) {
      console.error('Error initializing:', error);
    }
  };

  const fetchAttendanceData = async () => {
    if (!organizationId) {
      console.log('No organization ID available');
      return;
    }
    
    console.log('Fetching attendance with:', { organizationId, selectedDate });
    
    try {
      setLoading(true);
      
      // Use our enhanced function to get comprehensive attendance data
      const { data: attendanceData, error: attendanceError } = await supabase
        .rpc('get_attendance_with_details', {
          p_organization_id: organizationId,
          p_date: selectedDate
        });

      if (attendanceError) {
        console.error('Error fetching attendance data:', attendanceError);
        setAttendance([]);
        setRegularizations([]);
        setLoading(false);
        return;
      }

      // Transform the function result to match our component expectations
      const transformedData = (attendanceData || []).map((record: any) => ({
        ...record,
        user: {
          id: record.user_id,
          name: record.user_name,
          department: record.user_department,
          role: record.user_role
        }
      }));

      // De-duplicate by user_id to avoid duplicate rows when overlapping shift records exist.
      const dedupedByUser = new Map<string, any>();
      for (const row of transformedData) {
        const existing = dedupedByUser.get(row.user_id);
        if (!existing) {
          dedupedByUser.set(row.user_id, row);
          continue;
        }

        const rowHasPunch = !!row.punch_in_time;
        const existingHasPunch = !!existing.punch_in_time;
        const rowHasShift = !!row.shift_name;
        const existingHasShift = !!existing.shift_name;
        const shouldReplace =
          (rowHasPunch && !existingHasPunch) ||
          (rowHasShift && !existingHasShift);

        if (shouldReplace) {
          dedupedByUser.set(row.user_id, row);
        }
      }

      const deduped = Array.from(dedupedByUser.values());
      setDuplicateRowsCollapsed(Math.max(0, transformedData.length - deduped.length));
      setAttendance(deduped);

      // Get regularizations
      const regularizationData = await AttendanceService.getPendingRegularizations(organizationId);
      setRegularizations(regularizationData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMonthlyCumulative = async () => {
    if (!organizationId || !selectedMonth) return;
    setMonthlyLoading(true);
    try {
      const [year, month] = selectedMonth.split('-').map(Number);
      const monthStart = `${selectedMonth}-01`;
      const monthEnd = new Date(year, month, 0).toISOString().split('T')[0];

      const [{ data: usersData, error: usersError }, { data: attendanceData, error: attendanceError }, { data: overridesData, error: overridesError }] = await Promise.all([
        supabase
          .from('users')
          .select('id, name, department')
          .eq('organization_id', organizationId)
          .in('role', ['admin', 'superadmin', 'user'])
          .order('name'),
        supabase
          .from('attendance')
          .select('user_id, is_absent, is_late, is_early_out, is_half_day, is_regularized, effective_hours, punch_in_time')
          .eq('organization_id', organizationId)
          .gte('date', monthStart)
          .lte('date', monthEnd),
        supabase
          .from('attendance_monthly_overrides')
          .select('user_id, payload, source, approved_at, created_at')
          .eq('organization_id', organizationId)
          .eq('year', year)
          .eq('month', month)
      ]);

      if (usersError) throw usersError;
      if (attendanceError) throw attendanceError;
      if (overridesError) throw overridesError;

      const users = usersData || [];
      const records = attendanceData || [];
      const overrides = overridesData || [];

      const agg = new Map<string, Omit<MonthlyCumulativeRow, 'user_name' | 'user_department' | 'source'>>();
      for (const row of records) {
        const existing = agg.get(row.user_id) || {
          user_id: row.user_id,
          present_days: 0,
          absent_days: 0,
          half_day_count: 0,
          late_days: 0,
          early_out_days: 0,
          regularized_days: 0,
          total_effective_hours: 0
        };
        existing.present_days += row.punch_in_time ? 1 : 0;
        existing.absent_days += row.is_absent ? 1 : 0;
        existing.half_day_count += (row as any).is_half_day ? 1 : 0;
        existing.late_days += row.is_late ? 1 : 0;
        existing.early_out_days += row.is_early_out ? 1 : 0;
        existing.regularized_days += row.is_regularized ? 1 : 0;
        existing.total_effective_hours += Number(row.effective_hours || 0);
        agg.set(row.user_id, existing);
      }

      const latestOverrideByUser = new Map<string, any>();
      for (const ov of overrides) {
        const prev = latestOverrideByUser.get(ov.user_id);
        if (!prev) {
          latestOverrideByUser.set(ov.user_id, ov);
          continue;
        }
        const prevTime = new Date(prev.approved_at || prev.created_at || 0).getTime();
        const currentTime = new Date(ov.approved_at || ov.created_at || 0).getTime();
        if (currentTime > prevTime) {
          latestOverrideByUser.set(ov.user_id, ov);
        }
      }

      const rows: MonthlyCumulativeRow[] = users.map((u: any) => {
        const base = agg.get(u.id) || {
          user_id: u.id,
          present_days: 0,
          absent_days: 0,
          half_day_count: 0,
          late_days: 0,
          early_out_days: 0,
          regularized_days: 0,
          total_effective_hours: 0
        };

        const ov = latestOverrideByUser.get(u.id);
        const p = ov?.payload || {};
        const hasOverrideNumbers =
          p.present_days !== undefined ||
          p.lop_days !== undefined ||
          p.late_occurrences !== undefined ||
          p.early_outs !== undefined ||
          p.overtime_hours !== undefined;

        return {
          user_id: u.id,
          user_name: u.name || 'Unknown',
          user_department: u.department || 'N/A',
          present_days: hasOverrideNumbers ? Number(p.present_days || 0) : base.present_days,
          absent_days: hasOverrideNumbers ? Number(p.lop_days || 0) : base.absent_days,
          half_day_count: hasOverrideNumbers ? Number(p.half_days || 0) : base.half_day_count,
          late_days: hasOverrideNumbers ? Number(p.late_occurrences || 0) : base.late_days,
          early_out_days: hasOverrideNumbers ? Number(p.early_outs || 0) : base.early_out_days,
          regularized_days: base.regularized_days,
          total_effective_hours: hasOverrideNumbers
            ? Number(p.overtime_hours || 0) + Number(base.total_effective_hours || 0)
            : Number(base.total_effective_hours || 0),
          source: hasOverrideNumbers ? 'override' : 'system'
        };
      });

      setMonthlyRows(rows);
    } catch (error) {
      console.error('Error fetching monthly cumulative attendance:', error);
      setMonthlyRows([]);
    } finally {
      setMonthlyLoading(false);
    }
  };

  const fetchAIHealth = async () => {
    if (!organizationId) return;
    try {
      const [{ data: runs }, { count }] = await Promise.all([
        supabase
          .from('attendance_ai_runs')
          .select('completed_at')
          .eq('organization_id', organizationId)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(1),
        supabase
          .from('attendance_ai_review_queue_view')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
      ]);

      setAiHealth({
        lastRunAt: runs?.[0]?.completed_at || null,
        pendingReview: count || 0
      });
    } catch (error) {
      console.error('Error fetching AI health:', error);
    }
  };

  const handleRegularizeAttendance = async (attendanceId: string, reason: string) => {
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) return;

      const { data: adminData } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (!adminData) return;

      // Direct admin regularization
      await supabase
        .from('attendance')
        .update({
          is_regularized: true,
          regularized_by: adminData.id,
          regularization_reason: reason,
          regularized_at: new Date().toISOString(),
          is_late: false,
          is_early_out: false
        })
        .eq('id', attendanceId);

      // Refresh data
      fetchAttendanceData();
      alert('Attendance regularized successfully');
    } catch (error) {
      console.error('Error regularizing attendance:', error);
      alert('Failed to regularize attendance');
    }
  };

  const handleApproveRegularization = async (id: string, remarks?: string) => {
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) return;

      const { data: adminData } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (!adminData) return;

      await AttendanceService.approveRegularization(id, adminData.id, remarks);
      fetchAttendanceData();
    } catch (error) {
      console.error('Error approving regularization:', error);
    }
  };

  const handleRejectRegularization = async (id: string, remarks?: string) => {
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) return;

      const { data: adminData } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (!adminData) return;

      await AttendanceService.rejectRegularization(id, adminData.id, remarks);
      fetchAttendanceData();
    } catch (error) {
      console.error('Error rejecting regularization:', error);
    }
  };

  const handleCloseStaleOpenSessions = async () => {
    if (currentUserRole !== 'admin' && currentUserRole !== 'superadmin') {
      alert('Only admins can run stale-session cleanup.');
      return;
    }
    if (!organizationId) return;

    const thresholdInput = window.prompt('Close open sessions older than how many hours?', '18');
    if (thresholdInput === null) return;

    const thresholdHours = Number(thresholdInput);
    if (!Number.isFinite(thresholdHours) || thresholdHours <= 0) {
      alert('Please enter a valid positive number of hours.');
      return;
    }

    const confirmed = window.confirm(
      `Close all open attendance sessions older than ${thresholdHours} hour(s)? This will auto-punch-out and mark them regularized.`
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) {
        alert('Unable to identify current admin user.');
        return;
      }

      const { data: adminData } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (!adminData?.id) {
        alert('Admin profile not found.');
        return;
      }

      const result = await AttendanceService.closeStaleOpenSessions(
        organizationId,
        adminData.id,
        thresholdHours
      );

      await fetchAttendanceData();
      alert(
        `Cleanup complete. Closed ${result.closedCount} stale open session(s) out of ${result.scannedCount} open session(s) scanned.`
      );
    } catch (error: any) {
      console.error('Error closing stale open sessions:', error);
      alert(`Failed to close stale sessions: ${error?.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  const getAttendanceStats = () => {
    const total = attendance.length;
    const present = attendance.filter(a => a.punch_in_time && !a.is_absent).length;
    const absent = attendance.filter(a => a.is_absent || !a.punch_in_time).length;
    const halfDay = attendance.filter(a => (a as any).is_half_day).length;
    const late = attendance.filter(a => a.is_late && !a.is_regularized).length;
    const earlyOut = attendance.filter(a => a.is_early_out && !a.is_regularized).length;
    
    return { total, present, absent, halfDay, late, earlyOut };
  };

  const stats = getAttendanceStats();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading attendance data...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Attendance Dashboard</h2>
          <p className="text-gray-600">
            Monitor daily attendance and manage regularizations
            {currentUserRole && currentUserRole !== 'admin' && currentUserRole !== 'superadmin' && (
              <span className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                Personal View
              </span>
            )}
            {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
              <span className="ml-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                Organization View
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 flex-shrink-0"
          />
          <button
            onClick={() => setShowRegularizations(true)}
            className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm sm:text-base"
          >
            <HiExclamationCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Regularizations</span>
            <span className="sm:hidden">Reg.</span> ({regularizations.length})
          </button>
          {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
            <button
              onClick={handleCloseStaleOpenSessions}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm sm:text-base"
            >
              <HiClock className="w-4 h-4" />
              <span className="hidden sm:inline">Close Stale Opens</span>
              <span className="sm:hidden">Close Stale</span>
            </button>
          )}
        </div>
      </div>

      {/* Punch In/Out Section */}
      <PunchInOut />

      {/* AI-native attendance controls */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">AI Attendance Intelligence</h3>
            <p className="text-sm text-gray-600">
              Last hydration: {aiHealth.lastRunAt ? new Date(aiHealth.lastRunAt).toLocaleString() : 'Never'} | Pending review: {aiHealth.pendingReview}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/attendance/ai-configurator')}
              className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
            >
              AI Shift Configurator
            </button>
            <button
              onClick={() => navigate('/attendance/ai-review')}
              className="px-3 py-2 rounded-md border text-sm hover:bg-gray-50"
            >
              Review Queue ({aiHealth.pendingReview})
            </button>
          </div>
        </div>
      </div>

      {duplicateRowsCollapsed > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          Collapsed {duplicateRowsCollapsed} duplicate attendance row(s) for this date due to overlapping shift assignments.
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <HiUsers className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Total Employees</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.total}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <HiCheck className="h-8 w-8 text-green-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Present</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.present}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <HiX className="h-8 w-8 text-red-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Absent</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.absent}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <HiClock className="h-8 w-8 text-yellow-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Late</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.late}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <HiExclamationCircle className="h-8 w-8 text-orange-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Early Out</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.earlyOut}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <HiClock className="h-8 w-8 text-purple-600" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Half Day</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.halfDay}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly cumulative attendance */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium">Monthly Cumulative Attendance</h3>
            <p className="text-xs text-gray-500">System totals merged with approved monthly overrides where present.</p>
          </div>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Present</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Half Days</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Absent/LOP</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Late</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Early Out</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Regularized</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Effective Hours</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {monthlyLoading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                    Loading monthly cumulative data...
                  </td>
                </tr>
              ) : monthlyRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                    No monthly cumulative data found.
                  </td>
                </tr>
              ) : (
                monthlyRows.map((row) => (
                  <tr key={row.user_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{row.user_name}</div>
                      <div className="text-xs text-gray-500">{row.user_department}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.present_days}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.half_day_count > 0 ? (
                        <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">{row.half_day_count}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.absent_days}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.late_days}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.early_out_days}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.regularized_days}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.total_effective_hours.toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${row.source === 'override' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>
                        {row.source}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Attendance Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium">Attendance for {new Date(selectedDate).toLocaleDateString()}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Employee
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Shift
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Punch In
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Punch Out
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Hours
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {attendance.map((record) => (
                <tr key={record.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{record.user?.name}</div>
                      <div className="text-sm text-gray-500">{record.user?.department}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {(record as any).shift_name ? (
                        <div>
                          <div className="font-medium">{(record as any).shift_name}</div>
                          <div className="text-xs text-gray-500">
                            {(record as any).shift_start_time} - {(record as any).shift_end_time}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400">No shift assigned</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {record.punch_in_time ? (
                        <div>
                          <div>{new Date(record.punch_in_time).toLocaleTimeString()}</div>
                          {(record as any).punch_in_address && (
                            <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                              <HiLocationMarker className="w-3 h-3" />
                              {(record as any).punch_in_address.substring(0, 30)}...
                            </div>
                          )}
                          {(record as any).punch_in_distance_meters !== null && (record as any).punch_in_distance_meters !== undefined && (
                            <div className="text-xs text-gray-600 mt-1">
                              📍 {formatDistance((record as any).punch_in_distance_meters)}
                            </div>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {record.punch_out_time ? (
                        <div>
                          <div>{new Date(record.punch_out_time).toLocaleTimeString()}</div>
                          {(record as any).punch_out_address && (
                            <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                              <HiLocationMarker className="w-3 h-3" />
                              {(record as any).punch_out_address.substring(0, 30)}...
                            </div>
                          )}
                          {(record as any).punch_out_distance_meters !== null && (record as any).punch_out_distance_meters !== undefined && (
                            <div className="text-xs text-gray-600 mt-1">
                              📍 {formatDistance((record as any).punch_out_distance_meters)}
                            </div>
                          )}
                        </div>
                      ) : (
                        record.punch_in_time ? 'Still checked in' : '-'
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {record.punch_in_time && record.punch_out_time ? (
                        <div>
                          <div className="font-medium">
                            {record.total_hours != null
                              ? `${Number(record.total_hours).toFixed(2)}h`
                              : (() => {
                                  const punchIn = new Date(record.punch_in_time);
                                  const punchOut = new Date(record.punch_out_time);
                                  const hours = (punchOut.getTime() - punchIn.getTime()) / (1000 * 60 * 60);
                                  return `${hours.toFixed(2)}h`;
                                })()
                            }
                          </div>
                          {(record.effective_hours != null ? Number(record.effective_hours) > 0 : true) && (
                            <div className="text-xs text-gray-500">
                              Effective: {record.effective_hours != null
                                ? `${Number(record.effective_hours).toFixed(2)}h`
                                : (() => {
                                    const punchIn = new Date(record.punch_in_time);
                                    const punchOut = new Date(record.punch_out_time);
                                    const e = (punchOut.getTime() - punchIn.getTime()) / (1000 * 60 * 60) - 1.0;
                                    return e > 0 ? `${e.toFixed(2)}h` : '0.00h';
                                  })()
                              }
                            </div>
                          )}
                        </div>
                      ) : record.punch_in_time ? (
                        <span className="text-blue-600">Still checked in</span>
                      ) : (
                        '-'
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                      {/* Use DB flags for status — computed by trigger + hydrator */}
                      {(() => {
                        if (!record.punch_in_time) {
                          return (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                              Absent
                            </span>
                          );
                        }

                        if (record.is_regularized) {
                          return (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                              Regularized
                            </span>
                          );
                        }

                        const badges = [];
                        badges.push(
                          <span key="present" className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                            Present
                          </span>
                        );

                        if (record.is_late) {
                          badges.push(
                            <span key="late" className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                              Late
                            </span>
                          );
                        }

                        if (record.is_early_out) {
                          badges.push(
                            <span key="early" className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800">
                              Early Out
                            </span>
                          );
                        }

                        if ((record as any).is_half_day) {
                          badges.push(
                            <span key="half" className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                              Half Day
                            </span>
                          );
                        }

                        if ((record as any).is_weekend) {
                          badges.push(
                            <span key="weekend" className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600">
                              Weekly Off
                            </span>
                          );
                        }

                        if ((record as any).is_holiday) {
                          badges.push(
                            <span key="holiday" className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800">
                              Holiday
                            </span>
                          );
                        }

                        return badges;
                      })()}
                      {/* Geofence indicator */}
                      {(record as any).is_outside_geofence && (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800" title="Attendance outside geofence">
                          🚧 Geofence
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex gap-2">
                      {(record.is_late || record.is_early_out) && !record.is_regularized && record.punch_in_time && (
                        <button
                          onClick={() => {
                            const reason = prompt('Enter regularization reason:');
                            if (reason) {
                              handleRegularizeAttendance(record.id, reason);
                            }
                          }}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Regularize
                        </button>
                      )}
                      <button 
                        className="text-gray-600 hover:text-gray-900 flex items-center gap-1"
                        onClick={() => {
                          setSelectedAttendance(record);
                          setShowAttendanceDetail(true);
                        }}
                      >
                        <HiEye className="w-4 h-4" />
                        Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {attendance.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    No employees found for this organization
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RegularizationModal
        isOpen={showRegularizations}
        onClose={() => setShowRegularizations(false)}
        regularizations={regularizations}
        onApprove={handleApproveRegularization}
        onReject={handleRejectRegularization}
      />

      <AttendanceDetailModal
        isOpen={showAttendanceDetail}
        onClose={() => setShowAttendanceDetail(false)}
        attendance={selectedAttendance}
      />
    </div>
  );
};

export default AttendanceDashboard;
