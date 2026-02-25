import React, { useState, useEffect } from 'react';
import {
  HiPlus,
  HiPencil,
  HiTrash,
  HiX,
  HiUser,
  HiMail,
  HiPhone,
  HiOfficeBuilding,
  HiLockClosed,
  HiShieldCheck
} from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import { authService, CreateUserData, UserProfile, UpdateProfileData } from '../services/authService';

interface UserManagementProps {
  adminUserId?: string;
}

const UserManagement: React.FC<UserManagementProps> = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<string[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('user');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    whatsappNumber: '',
    countryCode: '+91',
    phone: '',
    role: 'user' as 'user' | 'admin' | 'superadmin',
    department: ''
  });

  // Country codes
  const countryCodes = [
    { code: '+91', country: 'India', flag: '🇮🇳', length: 10 },
    { code: '+971', country: 'UAE', flag: '🇦🇪', length: 9 }
  ];
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    initializeUserManagement();
  }, []);

  const initializeUserManagement = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user session
      const { data: { session }, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      if (!session) throw new Error('No active session');

      // Get current user data
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('organization_id, role')
        .eq('auth_id', session.user.id)
        .single();

      if (userError) throw userError;
      if (!userData?.organization_id) throw new Error('No organization found');

      // Check if user has admin permissions
      if (!['admin', 'superadmin'].includes(userData.role)) {
        throw new Error('You do not have permission to access user management');
      }

      setOrganizationId(userData.organization_id);
      setCurrentUserRole(userData.role);

      // Fetch organization data (departments)
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('departments')
        .eq('id', userData.organization_id)
        .single();

      if (orgError) throw orgError;
      setDepartments(orgData?.departments || ['Management', 'Medical', 'Nursing']);

      // Fetch all users in the organization
      await fetchUsers(userData.organization_id);

    } catch (error: any) {
      console.error('Error initializing user management:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async (orgId: string) => {
    try {
      const usersList = await authService.getOrganizationUsers(orgId);
      setUsers(usersList);
    } catch (error: any) {
      console.error('Error fetching users:', error);
      throw error;
    }
  };

  const handleOpenModal = (user?: UserProfile) => {
    console.log('=== MODAL OPENING ==>');
    console.log('Current user role:', currentUserRole);
    console.log('Is admin?', ['admin', 'superadmin'].includes(currentUserRole));
    
    if (user) {
      // Edit mode
      setSelectedUser(user);
      console.log('Opening edit modal for user:', user.name, 'WhatsApp:', user.whatsapp_number);
      console.log('Can edit WhatsApp? Admin check:', ['admin', 'superadmin'].includes(currentUserRole));
      
      // Extract country code and clean WhatsApp number
      let detectedCountryCode = '+91';
      let cleanWhatsApp = '';
      
      if (user.whatsapp_number.startsWith('+971')) {
        detectedCountryCode = '+971';
        cleanWhatsApp = user.whatsapp_number.replace(/^\+971/, '').replace(/\D/g, '');
      } else if (user.whatsapp_number.startsWith('+91')) {
        detectedCountryCode = '+91';
        cleanWhatsApp = user.whatsapp_number.replace(/^\+91/, '').replace(/\D/g, '');
      } else {
        // Fallback: try to extract any country code and clean digits only
        const match = user.whatsapp_number.match(/^\+(\d{1,4})(.*)$/);
        if (match) {
          detectedCountryCode = '+' + match[1];
          cleanWhatsApp = match[2].replace(/\D/g, '');
        } else {
          // No country code found, just extract all digits
          cleanWhatsApp = user.whatsapp_number.replace(/\D/g, '');
        }
      }
      
      console.log('Parsed WhatsApp - Country:', detectedCountryCode, 'Number:', cleanWhatsApp);
      
      setFormData({
        name: user.name,
        email: user.email,
        password: '', // Don't pre-fill password
        whatsappNumber: cleanWhatsApp,
        countryCode: detectedCountryCode,
        phone: user.phone || '',
        role: user.role as any,
        department: user.department
      });
    } else {
      // Create mode
      setSelectedUser(null);
      setFormData({
        name: '',
        email: '',
        password: '',
        whatsappNumber: '',
        countryCode: '+91',
        phone: '',
        role: 'user',
        department: departments[0] || ''
      });
    }
    setFormError(null);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedUser(null);
    setFormError(null);
  };

  const validateForm = (): boolean => {
    // Name validation
    if (!formData.name.trim()) {
      setFormError('Name is required');
      return false;
    }

    // Email validation
    if (!formData.email.trim()) {
      setFormError('Email is required');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setFormError('Please enter a valid email address');
      return false;
    }

    // Password validation (only for new users)
    if (!selectedUser && !formData.password) {
      setFormError('Password is required for new users');
      return false;
    }
    if (!selectedUser && formData.password.length < 6) {
      setFormError('Password must be at least 6 characters');
      return false;
    }

    // WhatsApp number validation
    if (!formData.whatsappNumber.trim()) {
      setFormError('WhatsApp number is required');
      return false;
    }
    
    const selectedCountry = countryCodes.find(c => c.code === formData.countryCode);
    const expectedLength = selectedCountry?.length || 10;
    
    if (!new RegExp(`^\\d{${expectedLength}}$`).test(formData.whatsappNumber)) {
      setFormError(`Please enter a valid ${expectedLength}-digit WhatsApp number for ${selectedCountry?.country}`);
      return false;
    }

    // Department validation
    if (!formData.department) {
      setFormError('Please select a department');
      return false;
    }

    return true;
  };

  const handleSaveUser = async () => {
    if (!validateForm()) return;
    if (!organizationId) {
      setFormError('Organization ID not found');
      return;
    }

    setFormLoading(true);
    setFormError(null);

    try {
      if (selectedUser) {
        // Update existing user
        const updates: UpdateProfileData = {
          name: formData.name,
          whatsappNumber: formData.countryCode + formData.whatsappNumber,
          phone: formData.phone,
          department: formData.department,
          role: formData.role
        };

        await authService.updateProfile(selectedUser.id, updates);
        
        // Refresh users list
        await fetchUsers(organizationId);
        handleCloseModal();
        alert('User updated successfully!');

      } else {
        // Create new user
        const userData: CreateUserData = {
          name: formData.name,
          email: formData.email,
          password: formData.password,
          whatsappNumber: formData.countryCode + formData.whatsappNumber,
          phone: formData.phone,
          role: formData.role,
          department: formData.department,
          organizationId: organizationId
        };

        await authService.createUser(userData);
        
        // Refresh users list
        await fetchUsers(organizationId);
        handleCloseModal();
        alert('User created successfully!');
      }

    } catch (error: any) {
      console.error('Error saving user:', error);
      setFormError(error.message || 'Failed to save user');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteUser = async (user: UserProfile) => {
    if (!confirm(`Are you sure you want to deactivate ${user.name}? They will be hidden from all lists and unable to log in.`)) {
      return;
    }

    try {
      await authService.deleteUser(user.id);
      
      // Refresh users list
      if (organizationId) {
        await fetchUsers(organizationId);
      }
      alert('User deactivated successfully!');

    } catch (error: any) {
      console.error('Error deleting user:', error);
      alert(`Failed to deactivate user: ${error.message}`);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'superadmin':
        return 'bg-purple-100 text-purple-800';
      case 'admin':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="bg-red-100 text-red-700 p-4 rounded-lg">
          <p className="font-semibold">Error</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
            <p className="text-gray-600">
              Manage users and permissions for your organization
            </p>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <HiPlus className="w-5 h-5 mr-2" />
            Add User
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center">
              <HiUser className="w-8 h-8 text-blue-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Total Users</p>
                <p className="text-2xl font-semibold text-gray-900">{users.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center">
              <HiShieldCheck className="w-8 h-8 text-green-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Admins</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {users.filter(u => u.role === 'admin' || u.role === 'superadmin').length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center">
              <HiOfficeBuilding className="w-8 h-8 text-purple-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-500">Departments</p>
                <p className="text-2xl font-semibold text-gray-900">{departments.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Department
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <HiUser className="h-6 w-6 text-blue-600" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{user.name}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{user.whatsapp_number}</div>
                      {user.phone && (
                        <div className="text-sm text-gray-500">{user.phone}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{user.department}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}>
                        {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleOpenModal(user)}
                        className="text-blue-600 hover:text-blue-900 mr-4"
                        title="Edit"
                      >
                        <HiPencil className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete"
                      >
                        <HiTrash className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {users.length === 0 && (
            <div className="text-center py-12">
              <HiUser className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No users</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by adding a new user to your organization.
              </p>
              <div className="mt-6">
                <button
                  onClick={() => handleOpenModal()}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  <HiPlus className="-ml-1 mr-2 h-5 w-5" />
                  Add User
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit User Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-semibold">
                {selectedUser ? 'Edit User' : 'Add New User'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <HiX className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-100 text-red-700 p-3 rounded-md text-sm">
                  {formError}
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <HiUser className="inline w-4 h-4 mr-1" />
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  disabled={formLoading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  placeholder="Enter full name"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <HiMail className="inline w-4 h-4 mr-1" />
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={!!selectedUser}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  placeholder="user@example.com"
                />
                {selectedUser && (
                  <p className="mt-1 text-xs text-gray-500">Email cannot be changed</p>
                )}
              </div>

              {/* Password */}
              {!selectedUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <HiLockClosed className="inline w-4 h-4 mr-1" />
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Minimum 6 characters"
                  />
                </div>
              )}

              {/* WhatsApp Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <HiPhone className="inline w-4 h-4 mr-1" />
                  WhatsApp Number <span className="text-red-500">*</span>
                </label>
                <div className="flex">
                  <select
                    value={formData.countryCode}
                    onFocus={(e) => {
                      console.log('=== COUNTRY CODE DROPDOWN FOCUSED ==>');
                      console.log('Current user role:', currentUserRole);
                      console.log('Selected user:', selectedUser?.name);
                      console.log('Is disabled?', e.target.disabled);
                      console.log('Can edit? (admin check):', ['admin', 'superadmin'].includes(currentUserRole));
                    }}
                    onChange={(e) => {
                      console.log('Country code changed to:', e.target.value);
                      setFormData({ ...formData, countryCode: e.target.value, whatsappNumber: '' });
                    }}
                    className="inline-flex items-center px-2 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-700 text-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    {countryCodes.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.flag} {country.code}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formData.whatsappNumber}
                    autoComplete="off"
                    onFocus={(e) => {
                      console.log('=== WHATSAPP INPUT FOCUSED ==>');
                      console.log('Current user role:', currentUserRole);
                      console.log('Is admin?', ['admin', 'superadmin'].includes(currentUserRole));
                      console.log('Editing user:', selectedUser?.name);
                      console.log('Country code:', formData.countryCode, 'Current value:', formData.whatsappNumber);
                      console.log('Input element disabled?', e.target.disabled);
                      console.log('Input element readonly?', e.target.readOnly);
                      console.log('Input computed style:', window.getComputedStyle(e.target).pointerEvents);
                      console.log('Input tabIndex:', e.target.tabIndex);
                    }}
                    onChange={(e) => {
                      console.log('WhatsApp onChange triggered, raw value:', e.target.value);
                      const selectedCountry = countryCodes.find(c => c.code === formData.countryCode);
                      const maxLength = selectedCountry?.length || 10;
                      const cleaned = e.target.value.replace(/\D/g, '').slice(0, maxLength);
                      console.log('WhatsApp cleaned value:', cleaned, 'maxLength:', maxLength);
                      setFormData({ ...formData, whatsappNumber: cleaned });
                      console.log('WhatsApp formData updated to:', cleaned);
                    }}
                    onBlur={() => console.log('WhatsApp field blurred, final:', formData.countryCode + formData.whatsappNumber)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-r-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder={`${countryCodes.find(c => c.code === formData.countryCode)?.length || 10}-digit mobile number`}
                    maxLength={countryCodes.find(c => c.code === formData.countryCode)?.length || 10}
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Full number: {formData.countryCode}{formData.whatsappNumber}
                </p>
              </div>

              {/* Phone (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <HiPhone className="inline w-4 h-4 mr-1" />
                  Phone Number (Optional)
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={formLoading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  placeholder="Alternate phone number"
                />
              </div>

              {/* Department */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <HiOfficeBuilding className="inline w-4 h-4 mr-1" />
                  Department <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  disabled={formLoading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value="">Select Department</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <HiShieldCheck className="inline w-4 h-4 mr-1" />
                  Role <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  disabled={formLoading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  {currentUserRole === 'superadmin' && (
                    <option value="superadmin">Super Admin</option>
                  )}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {formData.role === 'admin' && 'Admins can manage users and settings'}
                  {formData.role === 'superadmin' && 'Super Admins have full system access'}
                  {formData.role === 'user' && 'Regular users with standard permissions'}
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex justify-end space-x-3 border-t border-gray-200">
              <button
                onClick={handleCloseModal}
                disabled={formLoading}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUser}
                disabled={formLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {formLoading ? 'Saving...' : (selectedUser ? 'Update User' : 'Create User')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
