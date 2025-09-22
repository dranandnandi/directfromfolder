import React, { useState, useEffect } from 'react';
import { HiUsers, HiClock, HiExclamationCircle, HiCheck, HiX, HiEye, HiLocationMarker, HiCamera } from 'react-icons/hi';
import { AttendanceService } from '../../services/attendanceService';
import { Attendance, AttendanceRegularization } from '../../models/attendance';
import { supabase } from '../../utils/supabaseClient';
import PunchInOut from './PunchInOut';

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
                <span className="text-sm font-medium">{attendance.total_hours ? `${attendance.total_hours}h` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Status:</span>
                <span className={`text-sm px-2 py-1 rounded-full ${
                  attendance.attendance_status === 'present' ? 'bg-green-100 text-green-800' :
                  attendance.attendance_status === 'late' ? 'bg-yellow-100 text-yellow-800' :
                  attendance.attendance_status === 'absent' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {attendance.attendance_status || 'Unknown'}
                </span>
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
                {attendance.minutes_late_or_early && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Late/Early:</span>
                    <span className={`text-sm font-medium ${attendance.minutes_late_or_early > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {Math.abs(attendance.minutes_late_or_early)} minutes {attendance.minutes_late_or_early > 0 ? 'late' : 'early'}
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
                {attendance.punch_in_selfie_url && (
                  <div>
                    <span className="text-sm text-gray-600">Photo:</span>
                    <div className="mt-1">
                      <img 
                        src={attendance.punch_in_selfie_url} 
                        alt="Punch In Photo" 
                        className="w-24 h-24 object-cover rounded-lg"
                      />
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
                {attendance.punch_out_selfie_url && (
                  <div>
                    <span className="text-sm text-gray-600">Photo:</span>
                    <div className="mt-1">
                      <img 
                        src={attendance.punch_out_selfie_url} 
                        alt="Punch Out Photo" 
                        className="w-24 h-24 object-cover rounded-lg"
                      />
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
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [regularizations, setRegularizations] = useState<AttendanceRegularization[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [showRegularizations, setShowRegularizations] = useState(false);
  const [showAttendanceDetail, setShowAttendanceDetail] = useState(false);
  const [selectedAttendance, setSelectedAttendance] = useState<any>(null);
  const [organizationId, setOrganizationId] = useState<string>('');

  useEffect(() => {
    initializeData();
  }, []);

  useEffect(() => {
    if (organizationId) {
      fetchAttendanceData();
    }
  }, [selectedDate, organizationId]);

  const initializeData = async () => {
    try {
      // Get current user's organization
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) return;

      const { data: userData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (!userData?.organization_id) return;

      setOrganizationId(userData.organization_id);
    } catch (error) {
      console.error('Error initializing:', error);
    }
  };

  const fetchAttendanceData = async () => {
    if (!organizationId) return;
    
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
        // Fallback to original query if the new function fails
        const { data: employees } = await supabase
          .from('users')
          .select('id, name, department, role')
          .eq('organization_id', organizationId)
          .in('role', ['admin', 'user'])
          .order('name');

        if (!employees) {
          setAttendance([]);
          setRegularizations([]);
          setLoading(false);
          return;
        }

        const { data: fallbackData } = await supabase
          .from('attendance_dashboard_view')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('date', selectedDate);

        const attendanceMap = new Map();
        if (fallbackData) {
          fallbackData.forEach(record => {
            attendanceMap.set(record.user_id, {
              ...record,
              user: {
                id: record.user_id,
                name: record.user_name,
                department: record.user_department,
                role: record.user_role
              }
            });
          });
        }

        const allAttendanceRecords = employees.map(employee => {
          const existingRecord = attendanceMap.get(employee.id);
          
          if (existingRecord) {
            return existingRecord;
          } else {
            return {
              id: `placeholder-${employee.id}`,
              user_id: employee.id,
              organization_id: organizationId,
              date: selectedDate,
              punch_in_time: null,
              punch_out_time: null,
              total_hours: null,
              is_late: false,
              is_early_out: false,
              is_absent: true,
              is_regularized: false,
              attendance_status: 'absent',
              user: employee
            };
          }
        });

        setAttendance(allAttendanceRecords);
      } else {
        // Transform the function result to match our component expectations
        const transformedData = attendanceData.map((record: any) => ({
          ...record,
          user: {
            id: record.user_id,
            name: record.user_name,
            department: record.user_department,
            role: record.user_role
          }
        }));

        // Get all employees to ensure we show everyone
        const { data: allEmployees } = await supabase
          .from('users')
          .select('id, name, department, role')
          .eq('organization_id', organizationId)
          .in('role', ['admin', 'user'])
          .order('name');

        if (allEmployees) {
          const attendanceMap = new Map();
          transformedData.forEach((record: any) => {
            attendanceMap.set(record.user_id, record);
          });

          const completeAttendanceRecords = allEmployees.map(employee => {
            const existingRecord = attendanceMap.get(employee.id);
            
            if (existingRecord) {
              return existingRecord;
            } else {
              return {
                id: `placeholder-${employee.id}`,
                user_id: employee.id,
                organization_id: organizationId,
                date: selectedDate,
                punch_in_time: null,
                punch_out_time: null,
                total_hours: null,
                is_late: false,
                is_early_out: false,
                is_absent: true,
                is_regularized: false,
                attendance_status: 'absent',
                user: employee
              };
            }
          });

          setAttendance(completeAttendanceRecords);
        } else {
          setAttendance(transformedData);
        }
      }

      const [regularizationData] = await Promise.all([
        AttendanceService.getPendingRegularizations(organizationId)
      ]);

      setRegularizations(regularizationData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
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

  const getAttendanceStats = () => {
    const total = attendance.length;
    const present = attendance.filter(a => a.punch_in_time && !a.is_absent).length;
    const absent = attendance.filter(a => a.is_absent || !a.punch_in_time).length;
    const late = attendance.filter(a => a.is_late && !a.is_regularized).length;
    const earlyOut = attendance.filter(a => a.is_early_out && !a.is_regularized).length;
    
    return { total, present, absent, late, earlyOut };
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
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold">Attendance Dashboard</h2>
          <p className="text-gray-600">Monitor daily attendance and manage regularizations</p>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => setShowRegularizations(true)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            <HiExclamationCircle className="w-4 h-4" />
            Regularizations ({regularizations.length})
          </button>
        </div>
      </div>

      {/* Punch In/Out Section */}
      <PunchInOut />

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
                        </div>
                      ) : (
                        record.punch_in_time ? 'Still checked in' : '-'
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {record.total_hours !== null && record.total_hours !== undefined ? (
                        <div>
                          <div className="font-medium">{record.total_hours}h</div>
                          {(record as any).effective_hours && (
                            <div className="text-xs text-gray-500">
                              Effective: {(record as any).effective_hours}h
                            </div>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      {(record.is_absent || !record.punch_in_time) && (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                          Absent
                        </span>
                      )}
                      {record.is_late && !record.is_regularized && (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                          Late
                        </span>
                      )}
                      {record.is_early_out && !record.is_regularized && (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800">
                          Early Out
                        </span>
                      )}
                      {record.is_regularized && (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                          Regularized
                        </span>
                      )}
                      {record.punch_in_time && !record.is_late && !record.is_early_out && !record.is_absent && (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                          {(record as any).attendance_status === 'checked_in' ? 'Checked In' : 'On Time'}
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
