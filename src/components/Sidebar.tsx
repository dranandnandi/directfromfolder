import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HiX, HiOfficeBuilding, HiChartBar, HiCog, HiQuestionMarkCircle, HiUserGroup, HiTrash, HiRefresh, HiUsers, HiCalendar, HiClock, HiCurrencyDollar, HiDocument } from 'react-icons/hi';
import { supabase } from '../utils/supabaseClient';
import { OrganizationSettings } from '../models/task';
import dcpLogo from '/notification-icon.svg';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: string) => void;
  userRole: string;
  organizationSettings: OrganizationSettings;
}

const MenuItem = ({ icon: Icon, children, to, onClick, active = false }: { 
  icon: any; 
  children: React.ReactNode; 
  to?: string;
  onClick?: () => void; 
  active?: boolean 
}) => {
  if (to) {
    return (
      <Link 
        to={to}
        className={`w-full flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-colors ${active ? 'bg-blue-50 text-blue-600' : ''}`}
        onClick={onClick}
      >
        <Icon className="w-5 h-5" />
        <span className="text-sm font-medium">{children}</span>
      </Link>
    );
  }

  return (
    <button 
      className={`w-full flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-colors ${active ? 'bg-blue-50 text-blue-600' : ''}`}
      onClick={onClick}
    >
      <Icon className="w-5 h-5" />
      <span className="text-sm font-medium">{children}</span>
    </button>
  );
};

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onNavigate, userRole, organizationSettings }) => {
  const location = useLocation();

  const getActiveView = () => {
    const path = location.pathname;
    if (path === '/') return 'dashboard';
    return path.substring(1); // Remove leading slash
  };

  const activeView = getActiveView();

  const handleNavigation = (view: string) => {
    onNavigate(view);
  };

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <>
      <div className={`fixed inset-y-0 left-0 w-64 bg-white shadow-lg transition-transform duration-200 ease-in-out z-20 overflow-y-auto ${
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <div className="p-4 h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <img src={dcpLogo} alt="DCP Logo" className="w-10 h-10" />
              <div className="flex flex-col">
                <span className="font-medium text-sm">{organizationSettings.name}</span>
                <span className="text-xs text-gray-500">Task Manager</span>
              </div>
            </div>
            <button onClick={onClose} className="lg:hidden text-gray-500 hover:text-gray-700">
              <HiX className="w-6 h-6" />
            </button>
          </div>

          {/* Main Navigation */}
          <nav className="space-y-1 mb-6">
            <MenuItem 
              icon={HiOfficeBuilding} 
              to="/"
              active={activeView === 'dashboard'}
            >
              Dashboard
            </MenuItem>
            <MenuItem 
              icon={HiClock}
              to="/attendance"
              active={activeView === 'attendance'}
            >
              Attendance
            </MenuItem>
            <MenuItem 
              icon={HiUserGroup} 
              to="/team"
              active={activeView === 'team'}
            >
              Team Management
            </MenuItem>
            <MenuItem 
              icon={HiChartBar}
              to="/reports"
              active={activeView === 'reports'}
            >
              Reports
            </MenuItem>
            {(userRole === 'admin' || userRole === 'superadmin') && (
              <MenuItem 
                icon={HiTrash}
                to="/deleteTasks"
                active={activeView === 'deleteTasks'}
              >
                Delete Tasks
              </MenuItem>
            )}
            <MenuItem 
              icon={HiRefresh}
              to="/recurringTasks"
              active={activeView === 'recurringTasks'}
            >
              Recurring Tasks
            </MenuItem>
            <MenuItem 
              icon={HiChartBar}
              to="/performanceReports"
              active={activeView === 'performanceReports'}
            >
              Performance Reports
            </MenuItem>
            {/* Temporarily hidden conversation monitoring
            <MenuItem 
              icon={HiMicrophone}
              to="/conversations"
              active={activeView === 'conversations'} 
            >
              Conversation Monitoring
            </MenuItem>
            */}
            {(userRole === 'admin' || userRole === 'superadmin') && (
              <MenuItem 
                icon={HiUsers}
                to="/adminDashboard"
                active={activeView === 'adminDashboard'}
              >
                Admin Dashboard
              </MenuItem>
            )}
            <MenuItem 
              icon={HiCalendar}
              to="/leaveManagement"
              active={activeView === 'leaveManagement'}
            >
              Leave Management
            </MenuItem>
            <MenuItem 
              icon={HiCurrencyDollar}
              to="/payroll-preview"
              active={activeView === 'payroll-preview'}
            >
              Payroll Preview
            </MenuItem>
            {(userRole === 'admin' || userRole === 'superadmin') && (
              <MenuItem 
                icon={HiCurrencyDollar}
                to="/payroll"
                active={activeView === 'payroll'}
              >
                Payroll System
              </MenuItem>
            )}
            {(userRole !== 'admin' && userRole !== 'superadmin') && (
              <MenuItem 
                icon={HiDocument}
                to="/my-payslip"
                active={activeView === 'my-payslip'}
              >
                My Payslip
              </MenuItem>
            )}
          </nav>

          {/* Settings Section */}
          <div className="border-t pt-4"></div>

          {/* Bottom Links */}
          <div className="mt-auto space-y-1">
            <MenuItem 
              icon={HiCog} 
              to="/settings"
              active={activeView === 'settings'}
            >
              Settings
            </MenuItem>
            <MenuItem 
              icon={HiQuestionMarkCircle}
              onClick={() => handleNavigation('help')}
              active={activeView === 'help'}
            >
              Help
            </MenuItem>
          </div>

          {/* Footer */}
          <div className="mt-4 pt-4 border-t">
            <div className="space-y-2">
              <button className="w-full text-left text-sm text-gray-600 hover:text-gray-800 px-4 py-2">
                Terms And Use
              </button>
              <button className="w-full text-left text-sm text-gray-600 hover:text-gray-800 px-4 py-2">
                Privacy Policy
              </button>
              <button 
                onClick={handleLogout}
                className="w-full text-left text-sm text-red-600 hover:text-red-700 px-4 py-2"
              >
                Logout
              </button>
            </div>
            <div className="text-xs text-gray-500 px-4 mt-4">
              <div>Version: 3.6.53</div>
              <div>My IPv4 Address: 122.161.5.77</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;