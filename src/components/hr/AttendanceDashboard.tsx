import React, { useState, useEffect } from 'react';
import { HiUsers, HiClock, HiExclamationCircle, HiCheck, HiX, HiEye } from 'react-icons/hi';
import { AttendanceService } from '../../services/attendanceService';
import { Attendance, AttendanceRegularization } from '../../models/attendance';
import { supabase } from '../../utils/supabaseClient';
import PunchInOut from './PunchInOut';

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
      
      // First, get all employees from the organization
      const { data: employees } = await supabase
        .from('users')
        .select('id, name, department, role')
        .eq('organization_id', organizationId)
        .in('role', ['admin', 'user']) // Both admin and regular users are employees
        .order('name');

      if (!employees) {
        setAttendance([]);
        setRegularizations([]);
        setLoading(false);
        return;
      }

      // Get attendance data for the selected date
      const { data: attendanceData } = await supabase
        .from('attendance')
        .select(`
          *,
          user:users!attendance_user_id_fkey(id, name, department, role)
        `)
        .eq('organization_id', organizationId)
        .eq('date', selectedDate);

      // Create attendance records for all employees (even if they haven't punched in)
      const attendanceMap = new Map();
      
      // Add existing attendance records
      if (attendanceData) {
        attendanceData.forEach(record => {
          attendanceMap.set(record.user_id, record);
        });
      }

      // Create placeholder records for employees without attendance
      const allAttendanceRecords = employees.map(employee => {
        const existingRecord = attendanceMap.get(employee.id);
        
        if (existingRecord) {
          return existingRecord;
        } else {
          // Create a placeholder record for employees who haven't punched in
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
            user: employee
          };
        }
      });

      const [regularizationData] = await Promise.all([
        AttendanceService.getPendingRegularizations(organizationId)
      ]);

      setAttendance(allAttendanceRecords);
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
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {record.punch_in_time 
                      ? new Date(record.punch_in_time).toLocaleTimeString() 
                      : '-'
                    }
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {record.punch_out_time 
                      ? new Date(record.punch_out_time).toLocaleTimeString() 
                      : '-'
                    }
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {record.total_hours ? `${record.total_hours.toFixed(2)}h` : '-'}
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
                          On Time
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
                      <button className="text-gray-600 hover:text-gray-900">
                        <HiEye className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {attendance.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
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
    </div>
  );
};

export default AttendanceDashboard;
