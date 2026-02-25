import React, { useState, useEffect } from 'react';
import { HiPlus, HiPencil, HiTrash, HiClock, HiUsers, HiChevronRight, HiUserAdd, HiSearch } from 'react-icons/hi';
import { AttendanceService } from '../../services/attendanceService';
import { Shift, EmployeeShift, WeekDay } from '../../models/attendance';
import { supabase } from '../../utils/supabaseClient';

interface User {
  id: string;
  name: string;
  department: string;
  email: string;
}

interface CreateShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShiftCreated: (shift: Shift) => void;
  organizationId: string;
  editingShift?: Shift;
}

const CreateShiftModal: React.FC<CreateShiftModalProps> = ({
  isOpen,
  onClose,
  onShiftCreated,
  organizationId,
  editingShift
}) => {
  const ALL_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const [formData, setFormData] = useState({
    name: '',
    start_time: '09:00',
    end_time: '17:00',
    duration_hours: 8,
    break_duration_minutes: 60,
    late_threshold_minutes: 15,
    early_out_threshold_minutes: 15,
    buffer_minutes: 0,
    weekly_off_days: ['sunday'] as WeekDay[],
  });
  const [loading, setLoading] = useState(false);

  const toggleWeekday = (day: WeekDay) => {
    setFormData(prev => ({
      ...prev,
      weekly_off_days: prev.weekly_off_days.includes(day)
        ? prev.weekly_off_days.filter(d => d !== day)
        : [...prev.weekly_off_days, day],
    }));
  };

  useEffect(() => {
    if (editingShift) {
      setFormData({
        name: editingShift.name,
        start_time: editingShift.start_time,
        end_time: editingShift.end_time,
        duration_hours: editingShift.duration_hours,
        break_duration_minutes: editingShift.break_duration_minutes,
        late_threshold_minutes: editingShift.late_threshold_minutes,
        early_out_threshold_minutes: editingShift.early_out_threshold_minutes,
        buffer_minutes: editingShift.buffer_minutes ?? 0,
        weekly_off_days: (editingShift.weekly_off_days || ['sunday']) as WeekDay[],
      });
    } else {
      setFormData({
        name: '',
        start_time: '09:00',
        end_time: '17:00',
        duration_hours: 8,
        break_duration_minutes: 60,
        late_threshold_minutes: 15,
        early_out_threshold_minutes: 15,
        buffer_minutes: 0,
        weekly_off_days: ['sunday'],
      });
    }
  }, [editingShift, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      console.log('Submitting shift data:', formData, 'Organization ID:', organizationId);
      
      if (editingShift) {
        const updatedShift = await AttendanceService.updateShift(editingShift.id, {
          ...formData,
          organization_id: organizationId,
          is_active: true
        });
        onShiftCreated(updatedShift);
      } else {
        const newShift = await AttendanceService.createShift({
          ...formData,
          organization_id: organizationId,
          is_active: true
        });
        console.log('New shift created:', newShift);
        onShiftCreated(newShift);
      }
      onClose();
    } catch (error: any) {
      console.error('Error saving shift:', error);
      alert(`Failed to save shift: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">
          {editingShift ? 'Edit Shift' : 'Create New Shift'}
        </h3>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Shift Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Morning Shift"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={formData.start_time}
                onChange={(e) => setFormData(prev => ({ ...prev, start_time: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <input
                type="time"
                value={formData.end_time}
                onChange={(e) => setFormData(prev => ({ ...prev, end_time: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration Hours
            </label>
            <select
              value={formData.duration_hours}
              onChange={(e) => setFormData(prev => ({ ...prev, duration_hours: parseInt(e.target.value) }))}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              {[4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => (
                <option key={h} value={h}>{h} Hours</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Weekly Off Days
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_DAYS.map((day, i) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleWeekday(day)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition ${
                    formData.weekly_off_days.includes(day)
                      ? 'bg-violet-100 border-violet-300 text-violet-800 font-medium'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}
                >
                  {DAY_LABELS[i]}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Selected: {formData.weekly_off_days.length === 0 ? 'None (all working days)' : formData.weekly_off_days.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Break Duration (minutes)
              </label>
              <input
                type="number"
                value={formData.break_duration_minutes}
                onChange={(e) => setFormData(prev => ({ ...prev, break_duration_minutes: parseInt(e.target.value) }))}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                min="0"
                max="120"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Late Threshold (minutes)
              </label>
              <input
                type="number"
                value={formData.late_threshold_minutes}
                onChange={(e) => setFormData(prev => ({ ...prev, late_threshold_minutes: parseInt(e.target.value) }))}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                min="0"
                max="60"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Early Out Threshold (minutes)
            </label>
            <input
              type="number"
              value={formData.early_out_threshold_minutes}
              onChange={(e) => setFormData(prev => ({ ...prev, early_out_threshold_minutes: parseInt(e.target.value) }))}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              min="0"
              max="60"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Buffer / Grace Minutes
            </label>
            <input
              type="number"
              value={formData.buffer_minutes}
              onChange={(e) => setFormData(prev => ({ ...prev, buffer_minutes: parseInt(e.target.value) || 0 }))}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              min="0"
              max="30"
              placeholder="0"
            />
            <p className="text-xs text-gray-400 mt-1">Extra grace time before late is flagged</p>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : editingShift ? 'Update Shift' : 'Create Shift'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Employee Assignment Modal Component
interface AssignShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  shift: Shift;
  organizationId: string;
  onAssignmentCreated: () => void;
}

const AssignShiftModal: React.FC<AssignShiftModalProps> = ({
  isOpen,
  onClose,
  shift,
  organizationId,
  onAssignmentCreated
}) => {
  const [employees, setEmployees] = useState<User[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchEmployees();
    }
  }, [isOpen, organizationId]);

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, department, email')
        .eq('organization_id', organizationId)
        .eq('role', 'user')
        .order('name');

      if (error) throw error;
      setEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const handleAssignShift = async () => {
    if (selectedEmployees.length === 0) {
      alert('Please select at least one employee');
      return;
    }

    setLoading(true);
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

      // Create assignments for all selected employees
      const assignments = selectedEmployees.map(employeeId => ({
        user_id: employeeId,
        shift_id: shift.id,
        effective_from: effectiveDate,
        assigned_by: userData.id
      }));

      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const assignment of assignments) {
        try {
          await AttendanceService.assignShiftToEmployee(assignment);
          successCount++;
        } catch (assignmentError: any) {
          errorCount++;
          console.error('Error assigning shift to user:', assignment.user_id, assignmentError);
          
          // Get employee name for better error reporting
          const employee = employees.find(emp => emp.id === assignment.user_id);
          const employeeName = employee?.name || 'Unknown Employee';
          
          if (assignmentError.message?.includes('duplicate key')) {
            errors.push(`${employeeName}: Already assigned a shift for this date`);
          } else {
            errors.push(`${employeeName}: ${assignmentError.message || 'Assignment failed'}`);
          }
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
        onAssignmentCreated();
        onClose();
        setSelectedEmployees([]);
        setSearchTerm('');
      }
    } catch (error: any) {
      console.error('Error assigning shift:', error);
      alert(`Failed to assign shift: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredEmployees = employees.filter(emp =>
    emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold">
            Assign "{shift.name}" Shift to Employees
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Effective Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Effective From
            </label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          {/* Search Employees */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search Employees
            </label>
            <div className="relative">
              <HiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name or department..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Employee List */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Employees ({selectedEmployees.length} selected)
            </label>
            <div className="border border-gray-300 rounded-lg max-h-80 overflow-y-auto bg-gray-50">
              {filteredEmployees.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  No employees found
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {filteredEmployees.map((employee) => (
                    <label
                      key={employee.id}
                      className="flex items-center p-4 hover:bg-blue-50 cursor-pointer transition-colors duration-150"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEmployees.includes(employee.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedEmployees(prev => [...prev, employee.id]);
                          } else {
                            setSelectedEmployees(prev => prev.filter(id => id !== employee.id));
                          }
                        }}
                        className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{employee.name}</div>
                        <div className="text-xs text-gray-500">{employee.department}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAssignShift}
            disabled={loading || selectedEmployees.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Assigning...' : `Assign to ${selectedEmployees.length} Employee${selectedEmployees.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};

const ShiftManagement: React.FC = () => {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [assignments, setAssignments] = useState<EmployeeShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedShiftForAssignment, setSelectedShiftForAssignment] = useState<Shift | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | undefined>();
  const [organizationId, setOrganizationId] = useState<string>('');

  useEffect(() => {
    fetchData();
  }, []);

  // Debug effect to monitor state changes
  useEffect(() => {
    console.log('Shifts state changed:', shifts);
    console.log('Shifts state length:', shifts.length);
  }, [shifts]);

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

      console.log('Organization ID:', userData.organization_id);
      setOrganizationId(userData.organization_id);

      // Fetch shifts and assignments
      console.log('Fetching shifts for organization:', userData.organization_id);
      
      try {
        const shiftsData = await AttendanceService.getShiftsByOrganization(userData.organization_id);
        console.log('Fetched shifts data:', shiftsData);
        console.log('Shifts data type:', typeof shiftsData);
        console.log('Shifts is array:', Array.isArray(shiftsData));
        console.log('Shifts length:', shiftsData?.length);
        
        const assignmentsData = await AttendanceService.getShiftAssignments(userData.organization_id);
        console.log('Fetched assignments:', assignmentsData);

        console.log('Setting shifts state with:', shiftsData);
        setShifts(shiftsData || []);
        setAssignments(assignmentsData || []);
        
        console.log('State should be updated now');
      } catch (error) {
        console.error('Error in Promise.all:', error);
        setShifts([]);
        setAssignments([]);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };  const handleShiftCreated = (shift: Shift) => {
    if (editingShift) {
      setShifts(prev => prev.map(s => s.id === shift.id ? shift : s));
    } else {
      setShifts(prev => [...prev, shift]);
    }
    setEditingShift(undefined);
  };

  const handleDeleteShift = async (shiftId: string) => {
    if (!confirm('Are you sure you want to delete this shift?')) return;

    try {
      await AttendanceService.deleteShift(shiftId);
      setShifts(prev => prev.filter(s => s.id !== shiftId));
    } catch (error) {
      console.error('Error deleting shift:', error);
      alert('Failed to delete shift. Please try again.');
    }
  };

  const getLatestActiveAssignments = (): EmployeeShift[] => {
    const active = assignments.filter(a => !a.effective_to);
    const byUser = new Map<string, EmployeeShift>();
    for (const item of active) {
      const prev = byUser.get(item.user_id);
      if (!prev) {
        byUser.set(item.user_id, item);
        continue;
      }
      const prevTs = new Date(prev.effective_from).getTime();
      const currentTs = new Date(item.effective_from).getTime();
      if (currentTs >= prevTs) {
        byUser.set(item.user_id, item);
      }
    }
    return Array.from(byUser.values()).sort(
      (a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime()
    );
  };

  const getShiftAssignmentCount = (shiftId: string) => {
    return getLatestActiveAssignments().filter(a => a.shift_id === shiftId).length;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading shifts...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold">Shift Management</h2>
          <p className="text-gray-600">Manage work shifts and employee assignments</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <HiPlus className="w-4 h-4" />
          Create Shift
        </button>
      </div>

      {/* Shifts List */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-medium">Available Shifts</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {(() => {
            console.log('DEBUG - Shifts state:', shifts, 'Length:', shifts.length, 'Organization ID:', organizationId);
            return null;
          })()}
          {shifts.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No shifts created yet. Create your first shift to get started.
              <br />
              <small>Debug: Organization ID: {organizationId}, Shifts count: {shifts.length}</small>
            </div>
          ) : (
            shifts.map((shift) => (
              <div key={shift.id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-4">
                      <div>
                        <h4 className="text-lg font-medium text-gray-900">{shift.name}</h4>
                        <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
                          <div className="flex items-center gap-1">
                            <HiClock className="w-4 h-4" />
                            {shift.start_time} - {shift.end_time}
                          </div>
                          <div className="flex items-center gap-1">
                            <HiUsers className="w-4 h-4" />
                            {getShiftAssignmentCount(shift.id)} employees
                          </div>
                          <span className="text-blue-600">{shift.duration_hours} hours</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                      <span>Break: {shift.break_duration_minutes}min</span>
                      <span>Late threshold: {shift.late_threshold_minutes}min</span>
                      <span>Early out threshold: {shift.early_out_threshold_minutes}min</span>
                      {(shift.buffer_minutes ?? 0) > 0 && (
                        <span>Buffer: {shift.buffer_minutes}min</span>
                      )}
                      {shift.weekly_off_days && shift.weekly_off_days.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-gray-400">Weekly off:</span>
                          {shift.weekly_off_days.map(d => d.charAt(0).toUpperCase() + d.slice(0, 3)).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedShiftForAssignment(shift);
                        setShowAssignModal(true);
                      }}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="Assign to Employees"
                    >
                      <HiUserAdd className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setEditingShift(shift);
                        setShowCreateModal(true);
                      }}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                    >
                      <HiPencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteShift(shift.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <HiTrash className="w-4 h-4" />
                    </button>
                    <HiChevronRight className="w-5 h-5 text-gray-400" />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recent Assignments */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-medium">Recent Shift Assignments</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {getLatestActiveAssignments().slice(0, 5).map((assignment) => (
            <div key={assignment.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{assignment.user?.name}</div>
                <div className="text-sm text-gray-600">{assignment.user?.department}</div>
              </div>
              <div className="text-right">
                <div className="font-medium">{assignment.shift?.name}</div>
                <div className="text-sm text-gray-600">
                  From {new Date(assignment.effective_from).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
          {getLatestActiveAssignments().length === 0 && (
            <div className="p-6 text-center text-gray-500">
              No shift assignments yet.
            </div>
          )}
        </div>
      </div>

      <CreateShiftModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setEditingShift(undefined);
        }}
        onShiftCreated={handleShiftCreated}
        organizationId={organizationId}
        editingShift={editingShift}
      />

      {selectedShiftForAssignment && (
        <AssignShiftModal
          isOpen={showAssignModal}
          onClose={() => {
            setShowAssignModal(false);
            setSelectedShiftForAssignment(null);
          }}
          shift={selectedShiftForAssignment}
          organizationId={organizationId}
          onAssignmentCreated={() => {
            fetchData(); // Refresh assignments
            setShowAssignModal(false);
            setSelectedShiftForAssignment(null);
          }}
        />
      )}
    </div>
  );
};

export default ShiftManagement;
