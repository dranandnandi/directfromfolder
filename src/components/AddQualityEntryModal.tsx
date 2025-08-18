import React, { useState } from 'react';
import { HiX } from 'react-icons/hi';
import { Task } from '../models/task';
import { supabase } from '../utils/supabaseClient';

interface AddQualityEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
  onAddSuccess: () => void;
}

const AddQualityEntryModal: React.FC<AddQualityEntryModalProps> = ({
  isOpen,
  onClose,
  task,
  onAddSuccess
}) => {
  const [newQualityEntry, setNewQualityEntry] = useState({
    entryDate: new Date().toISOString().slice(0, 16),
    entryDescription: '',
    remark: ''
  });
  const [loading, setLoading] = useState(false);

  const handleAddQualityEntry = async () => {
    if (!newQualityEntry.entryDescription.trim()) {
      alert('Please enter a description for the quality control entry.');
      return;
    }

    try {
      setLoading(true);
      
      // Get the current user's auth ID
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not found');

      // Get the user's record from the users table
      const { data: userRecord, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', userData.user.id)
        .single();

      if (userError) throw userError;
      if (!userRecord) throw new Error('User record not found');

      // Insert the quality control entry
      const { error: entryError } = await supabase
        .from('quality_control_entries')
        .insert([
          {
            task_id: task.id,
            user_id: userRecord.id,
            entry_date: new Date(newQualityEntry.entryDate).toISOString(),
            entry_description: newQualityEntry.entryDescription.trim(),
            remark: newQualityEntry.remark.trim()
          }
        ]);

      if (entryError) throw entryError;

      // Reset form
      setNewQualityEntry({
        entryDate: new Date().toISOString().slice(0, 16),
        entryDescription: '',
        remark: ''
      });
      
      // Notify parent component of success
      onAddSuccess();
      onClose();
    } catch (error) {
      console.error('Error adding quality entry:', error);
      alert('Failed to add quality control entry. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    // Reset form when closing
    setNewQualityEntry({
      entryDate: new Date().toISOString().slice(0, 16),
      entryDescription: '',
      remark: ''
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="text-lg font-semibold">Add Quality Control Entry</h3>
          <button onClick={handleClose}>
            <HiX className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Entry Date & Time
              </label>
              <input
                type="datetime-local"
                value={newQualityEntry.entryDate}
                onChange={(e) => setNewQualityEntry({
                  ...newQualityEntry,
                  entryDate: e.target.value
                })}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Entry Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={newQualityEntry.entryDescription}
                onChange={(e) => setNewQualityEntry({
                  ...newQualityEntry,
                  entryDescription: e.target.value
                })}
                placeholder="Enter quality control values, maintenance checks, or other relevant data..."
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                rows={4}
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Remarks
              </label>
              <textarea
                value={newQualityEntry.remark}
                onChange={(e) => setNewQualityEntry({
                  ...newQualityEntry,
                  remark: e.target.value
                })}
                placeholder="Additional notes or observations..."
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                rows={3}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleAddQualityEntry}
            disabled={loading || !newQualityEntry.entryDescription.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
          >
            {loading ? 'Adding...' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddQualityEntryModal;