import { useState, useEffect } from 'react';
import { HiPlus, HiPencil, HiTrash, HiX } from 'react-icons/hi';
import { User } from '../models/user';
import AddUserForm from './AddUserForm';
import { supabase } from '../utils/supabaseClient';

const TeamManagement = () => {
  const [members, setMembers] = useState<User[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<string[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    fetchOrganizationData();
  }, []);

  const fetchOrganizationData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user's session
      const { data: { session }, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      if (!session) throw new Error('No active session');

      // Get user's organization ID
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('organization_id')
        .eq('auth_id', session.user.id)
        .single();

      if (userError) throw userError;
      if (!userData?.organization_id) throw new Error('No organization found');

      setOrganizationId(userData.organization_id);

      // Fetch organization data
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('departments')
        .eq('id', userData.organization_id)
        .single();

      if (orgError) throw orgError;
      if (!orgData) throw new Error('Organization not found');

      setDepartments(orgData.departments || ['Management', 'Medical', 'Nursing']);

      // Fetch team members
      const { data: membersData, error: membersError } = await supabase
        .from('users')
        .select('*')
        .eq('organization_id', userData.organization_id);

      if (membersError) throw membersError;
      setMembers(membersData || []);

    } catch (error: any) {
      console.error('Error fetching organization data:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async (newUser: User) => {
    try {
      if (!organizationId) throw new Error('No organization ID');

      const { data, error } = await supabase
        .from('users')
        .insert([{ ...newUser, organization_id: organizationId }])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setMembers([...members, data]);
        setShowAddModal(false);
      }
    } catch (error: any) {
      console.error('Error adding user:', error);
      alert(error.message);
    }
  };

  const handleEditUser = async (updatedUser: User) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .update(updatedUser)
        .eq('id', updatedUser.id)
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setMembers(members.map(member => member.id === updatedUser.id ? data : member));
        setShowEditModal(false);
        setSelectedUser(null);
      }
    } catch (error: any) {
      console.error('Error updating user:', error);
      alert(error.message);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);

      if (error) throw error;
      setMembers(members.filter(member => member.id !== userId));
    } catch (error: any) {
      console.error('Error deleting user:', error);
      alert(error.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold">Team Management</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
        >
          <HiPlus className="w-5 h-5" />
          Add Team Member
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  WhatsApp
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Department
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                        {member.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">{member.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {member.whatsapp_number}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {member.role}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {member.department}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex gap-3">
                      <button
                        className="text-blue-600 hover:text-blue-700"
                        onClick={() => {
                          setSelectedUser(member);
                          setShowEditModal(true);
                        }}
                      >
                        <HiPencil className="w-5 h-5" />
                      </button>
                      <button
                        className="text-red-600 hover:text-red-700"
                        onClick={() => handleDeleteUser(member.id)}
                      >
                        <HiTrash className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Add Team Member</h3>
              <button onClick={() => setShowAddModal(false)}>
                <HiX className="w-6 h-6" />
              </button>
            </div>
            <AddUserForm
              departments={departments}
              onSuccess={handleAddUser}
              onCancel={() => setShowAddModal(false)}
            />
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Edit Team Member</h3>
              <button onClick={() => {
                setShowEditModal(false);
                setSelectedUser(null);
              }}>
                <HiX className="w-6 h-6" />
              </button>
            </div>
            <AddUserForm
              departments={departments}
              onSuccess={handleEditUser}
              onCancel={() => {
                setShowEditModal(false);
                setSelectedUser(null);
              }}
              editingUser={selectedUser}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamManagement;