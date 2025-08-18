import React, { useState, useEffect } from 'react';
import { User } from '../models/user';

interface AddUserFormProps {
  departments: string[];
  onSuccess: (user: User) => void;
  onCancel: () => void;
  editingUser?: User;
}

const AddUserForm: React.FC<AddUserFormProps> = ({
  departments,
  onSuccess,
  onCancel,
  editingUser
}) => {
  const [formData, setFormData] = useState({
    name: '',
    whatsappNumber: '',
    password: '',
    department: '',
    role: 'user'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingUser) {
      setFormData({
        name: editingUser.name,
        whatsappNumber: editingUser.whatsapp_number.replace(/^\+91/, ''),
        password: '',
        department: editingUser.department,
        role: editingUser.role
      });
    }
  }, [editingUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Validate form data
      if (!formData.name || !formData.whatsappNumber || !formData.department) {
        throw new Error('Please fill in all required fields');
      }

      if (!editingUser && !formData.password) {
        throw new Error('Password is required for new users');
      }

      if (formData.whatsappNumber.length !== 10 || !/^\d+$/.test(formData.whatsappNumber)) {
        throw new Error('Please enter a valid 10-digit WhatsApp number');
      }

      const userData: Partial<User> = {
        name: formData.name,
        whatsapp_number: `+91${formData.whatsappNumber}`,
        department: formData.department,
        role: formData.role
      };

      if (editingUser) {
        userData.id = editingUser.id;
      }

      onSuccess(userData as User);
    } catch (err: any) {
      console.error('Error creating/updating user:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-100 text-red-600 p-3 rounded-md">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Full Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          WhatsApp Number <span className="text-red-500">*</span>
        </label>
        <div className="flex">
          <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 sm:text-sm">
            +91
          </span>
          <input
            type="tel"
            required
            pattern="[0-9]{10}"
            className="w-full rounded-none rounded-r-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            value={formData.whatsappNumber}
            onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
            placeholder="10-digit number"
            disabled={!!editingUser}
          />
        </div>
      </div>

      {!editingUser && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Password <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            required
            minLength={6}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Department <span className="text-red-500">*</span>
        </label>
        <select
          required
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          value={formData.department}
          onChange={(e) => setFormData({ ...formData, department: e.target.value })}
        >
          <option value="">Select Department</option>
          {departments.map(dept => (
            <option key={dept} value={dept}>{dept}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Role <span className="text-red-500">*</span>
        </label>
        <select
          required
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          value={formData.role}
          onChange={(e) => setFormData({ ...formData, role: e.target.value })}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-gray-600 hover:text-gray-800"
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
          disabled={loading}
        >
          {loading ? (editingUser ? 'Updating...' : 'Creating...') : (editingUser ? 'Update User' : 'Create User')}
        </button>
      </div>
    </form>
  );
};

export default AddUserForm;