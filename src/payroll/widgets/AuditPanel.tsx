import React, { useState, useEffect } from 'react';
import { FaHistory, FaUser, FaClock, FaCheck, FaTimes } from 'react-icons/fa';

interface AuditEntry {
  id: string;
  action: string;
  user: string;
  timestamp: string;
  details?: string;
  status: 'success' | 'error' | 'warning';
}

interface AuditPanelProps {
  entityType: 'payroll' | 'attendance' | 'compensation';
  entityId: string;
  className?: string;
}

const AuditPanel: React.FC<AuditPanelProps> = ({ entityType, entityId, className = '' }) => {
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAuditEntries();
  }, [entityType, entityId]);

  const loadAuditEntries = async () => {
    try {
      // This would call an edge function to get audit entries
      // For now, using mock data
      const mockEntries: AuditEntry[] = [
        {
          id: '1',
          action: 'Payroll calculation initiated',
          user: 'Admin User',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          details: 'Monthly payroll calculation for 25 employees',
          status: 'success'
        },
        {
          id: '2',
          action: 'Attendance data imported',
          user: 'HR Manager',
          timestamp: new Date(Date.now() - 7200000).toISOString(),
          details: 'CSV import with 450 attendance records',
          status: 'success'
        },
        {
          id: '3',
          action: 'Compensation structure updated',
          user: 'Finance Admin',
          timestamp: new Date(Date.now() - 86400000).toISOString(),
          details: 'HRA component updated for employee EMP001',
          status: 'warning'
        }
      ];
      setAuditEntries(mockEntries);
    } catch (error) {
      console.error('Failed to load audit entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <FaCheck className="w-4 h-4 text-green-600" />;
      case 'error': return <FaTimes className="w-4 h-4 text-red-600" />;
      case 'warning': return <FaCheck className="w-4 h-4 text-yellow-600" />;
      default: return <FaHistory className="w-4 h-4 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'border-green-200 bg-green-50';
      case 'error': return 'border-red-200 bg-red-50';
      case 'warning': return 'border-yellow-200 bg-yellow-50';
      default: return 'border-gray-200 bg-gray-50';
    }
  };

  if (loading) {
    return (
      <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            <div className="h-3 bg-gray-200 rounded"></div>
            <div className="h-3 bg-gray-200 rounded w-5/6"></div>
            <div className="h-3 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
      <div className="flex items-center mb-4">
        <FaHistory className="w-5 h-5 text-gray-600 mr-2" />
        <h3 className="text-lg font-medium text-gray-900">Audit Trail</h3>
      </div>

      <div className="space-y-4">
        {auditEntries.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <FaHistory className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p>No audit entries found</p>
          </div>
        ) : (
          auditEntries.map((entry) => (
            <div key={entry.id} className={`border rounded-lg p-4 ${getStatusColor(entry.status)}`}>
              <div className="flex items-start">
                <div className="flex-shrink-0 mt-0.5">
                  {getStatusIcon(entry.status)}
                </div>
                <div className="ml-3 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">{entry.action}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(entry.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center mt-1">
                    <FaUser className="w-3 h-3 text-gray-400 mr-1" />
                    <p className="text-xs text-gray-600">{entry.user}</p>
                  </div>
                  {entry.details && (
                    <p className="text-sm text-gray-700 mt-2">{entry.details}</p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex items-center text-xs text-gray-500">
          <FaClock className="w-3 h-3 mr-1" />
          <span>Last updated: {new Date().toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};

export default AuditPanel;