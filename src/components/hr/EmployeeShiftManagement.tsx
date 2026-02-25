import React, { useState, useEffect } from 'react';
import { HiSearch, HiClock, HiUser, HiCheck, HiX } from 'react-icons/hi';
import { AttendanceService } from '../../services/attendanceService';
import { Shift } from '../../models/attendance';
import { supabase } from '../../utils/supabaseClient';

interface User {
  id: string;
  name: string;
  department: string;
  email: string;
}

interface EmployeeWithShift extends User {
  currentShift?: {
    shift: Shift;
    effective_from: string;
    effective_to?: string;
  };
}

const EmployeeShiftManagement: React.FC = () => {
  const [employees, setEmployees] = useState<EmployeeWithShift[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [showAssignModal, setShowAssignModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Get current user's organization
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) {
        console.error('No authenticated user found');
        return;
      }

      const { data: userData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (!userData?.organization_id) {
        console.error('No organization found for user');
        return;
      }

      // Fetch employees and shifts
      const [employeesData, shiftsData, assignmentsData] = await Promise.all([
        supabase
          .from('users')
          .select('id, name, department, email')
          .eq('organization_id', userData.organization_id)
          .eq('role', 'user')
          .order('name'),
        AttendanceService.getShiftsByOrganization(userData.organization_id),
        AttendanceService.getShiftAssignments(userData.organization_id)
      ]);

      if (employeesData.error) throw employeesData.error;

      const latestActiveAssignmentByUser = new Map<string, any>();
      for (const assignment of assignmentsData || []) {
        if (assignment.effective_to) continue;
        const prev = latestActiveAssignmentByUser.get(assignment.user_id);
        if (!prev) {
          latestActiveAssignmentByUser.set(assignment.user_id, assignment);
          continue;
        }
        const prevTs = new Date(prev.effective_from).getTime();
        const currentTs = new Date(assignment.effective_from).getTime();
        if (currentTs >= prevTs) {
          latestActiveAssignmentByUser.set(assignment.user_id, assignment);
        }
      }

      // Combine employees with their current shift assignments
      const employeesWithShifts: EmployeeWithShift[] = (employeesData.data || []).map(employee => {
        const currentAssignment = latestActiveAssignmentByUser.get(employee.id);

        return {
          ...employee,
          currentShift: currentAssignment ? {
            shift: currentAssignment.shift!,
            effective_from: currentAssignment.effective_from,
            effective_to: currentAssignment.effective_to
          } : undefined
        };
      });

      setEmployees(employeesWithShifts);
      setShifts(shiftsData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignShift = async (shiftId: string, effectiveDate: string) => {
    if (selectedEmployees.length === 0) {
      alert('Please select at least one employee');
      return;
    }

    try {
      // Get current user for assigned_by
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user?.id) throw new Error('Not authenticated');

      const { data: userData } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', currentUser.user.id)
        .single();

      if (!userData) throw new Error('User not found');

      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const employeeId of selectedEmployees) {
        try {
          await AttendanceService.assignShiftToEmployee({
            user_id: employeeId,
            shift_id: shiftId,
            effective_from: effectiveDate,
            assigned_by: userData.id
          });
          successCount++;
        } catch (error: any) {
          errorCount++;
          const employee = employees.find(emp => emp.id === employeeId);
          const employeeName = employee?.name || 'Unknown Employee';
          errors.push(`${employeeName}: ${error.message || 'Assignment failed'}`);
        }
      }

      // Show results
      if (successCount > 0 && errorCount === 0) {
        alert(`Successfully assigned shift to ${successCount} employee${successCount !== 1 ? 's' : ''}!`);
      } else if (successCount > 0 && errorCount > 0) {
        alert(`Partially successful: ${successCount} assigned, ${errorCount} failed.\n\nErrors:\n${errors.join('\n')}`);
      } else {
        alert(`Assignment failed for all employees:\n\n${errors.join('\n')}`);
      }

      if (successCount > 0) {
        setSelectedEmployees([]);
        setShowAssignModal(false);
        fetchData(); // Refresh data
      }
    } catch (error: any) {
      console.error('Error assigning shift:', error);
      alert(`Failed to assign shift: ${error.message || error}`);
    }
  };

  const filteredEmployees = employees.filter(emp =>
    emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading employees...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold">Employee Shift Management</h2>
          <p className="text-gray-600">Assign shifts to employees</p>
        </div>
        <button
          onClick={() => setShowAssignModal(true)}
          disabled={selectedEmployees.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <HiClock className="w-4 h-4" />
          Assign Shift ({selectedEmployees.length})
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="relative">
          <HiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search employees by name or department..."
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Employee List */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">Employees</h3>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  if (selectedEmployees.length === filteredEmployees.length) {
                    setSelectedEmployees([]);
                  } else {
                    setSelectedEmployees(filteredEmployees.map(emp => emp.id));
                  }
                }}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {selectedEmployees.length === filteredEmployees.length ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-sm text-gray-500">
                {selectedEmployees.length} of {filteredEmployees.length} selected
              </span>
            </div>
          </div>
        </div>

        <div className="divide-y divide-gray-200">
          {filteredEmployees.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No employees found
            </div>
          ) : (
            filteredEmployees.map((employee) => (
              <div
                key={employee.id}
                className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                  selectedEmployees.includes(employee.id) ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                }`}
                onClick={() => {
                  if (selectedEmployees.includes(employee.id)) {
                    setSelectedEmployees(prev => prev.filter(id => id !== employee.id));
                  } else {
                    setSelectedEmployees(prev => [...prev, employee.id]);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0">
                      <div className={`w-6 h-6 rounded border-2 flex items-center justify-center ${
                        selectedEmployees.includes(employee.id)
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-gray-300'
                      }`}>
                        {selectedEmployees.includes(employee.id) && <HiCheck className="w-4 h-4" />}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                        <HiUser className="w-6 h-6 text-gray-500" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{employee.name}</div>
                        <div className="text-sm text-gray-500">{employee.department}</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    {employee.currentShift ? (
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {employee.currentShift.shift.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {employee.currentShift.shift.start_time} - {employee.currentShift.shift.end_time}
                        </div>
                        <div className="text-xs text-green-600">
                          Since {new Date(employee.currentShift.effective_from).toLocaleDateString()}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">
                        No shift assigned
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Assign Shift Modal */}
      {showAssignModal && (
        <AssignShiftModal
          isOpen={showAssignModal}
          onClose={() => setShowAssignModal(false)}
          shifts={shifts}
          selectedEmployeeCount={selectedEmployees.length}
          onAssign={handleAssignShift}
        />
      )}
    </div>
  );
};

// Shift Assignment Modal
interface AssignShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  shifts: Shift[];
  selectedEmployeeCount: number;
  onAssign: (shiftId: string, effectiveDate: string) => void;
}

const AssignShiftModal: React.FC<AssignShiftModalProps> = ({
  isOpen,
  onClose,
  shifts,
  selectedEmployeeCount,
  onAssign
}) => {
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);

  const handleSubmit = () => {
    if (!selectedShift) {
      alert('Please select a shift');
      return;
    }
    onAssign(selectedShift, effectiveDate);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold">
            Assign Shift to {selectedEmployeeCount} Employee{selectedEmployeeCount !== 1 ? 's' : ''}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <HiX className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Effective Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Effective From
            </label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          {/* Shift Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Shift
            </label>
            <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg">
              {shifts.map((shift) => (
                <label
                  key={shift.id}
                  className={`flex items-center p-3 cursor-pointer hover:bg-gray-50 ${
                    selectedShift === shift.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="shift"
                    value={shift.id}
                    checked={selectedShift === shift.id}
                    onChange={(e) => setSelectedShift(e.target.value)}
                    className="mr-3 h-4 w-4 text-blue-600"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{shift.name}</div>
                    <div className="text-xs text-gray-500">
                      {shift.start_time} - {shift.end_time} ({shift.duration_hours} hours)
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedShift}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Assign Shift
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmployeeShiftManagement;
