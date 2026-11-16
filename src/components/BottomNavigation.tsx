import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { HiHome, HiClock, HiCalendar, HiClipboardList, HiCheckCircle, HiMenu } from 'react-icons/hi';
import { useStaffAccess } from '../contexts/StaffAccessContext';

interface BottomNavigationProps {
    onMenuClick: () => void;
    userRole?: string;
}

const BottomNavigation: React.FC<BottomNavigationProps> = ({ onMenuClick }) => {
    const { can } = useStaffAccess();
    const navigate = useNavigate();
    const location = useLocation();

    const isActive = (path: string) => {
        if (path === '/' && location.pathname === '/') return true;
        if (path !== '/' && location.pathname.startsWith(path)) return true;
        return false;
    };

    const navItems = [
        { id: 'home', label: 'Home', icon: HiHome, path: '/' },
        { id: 'tasks', label: 'Tasks', icon: HiClipboardList, path: '/tasks' },
        { id: 'attendance', label: 'Attendance', icon: HiClock, path: '/attendance' },
        (can('leave.approve') || can('attendance.approve'))
          ? { id: 'approvals', label: 'Approvals', icon: HiCheckCircle, path: '/approvals' }
          : { id: 'leaves', label: 'Leaves', icon: HiCalendar, path: '/leaveManagement' },
    ];

    return (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-safe z-50">
            <div className="flex justify-around items-center h-16">
                {navItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${isActive(item.path) ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
                            }`}
                    >
                        <item.icon className="w-6 h-6" />
                        <span className="text-xs font-medium">{item.label}</span>
                    </button>
                ))}
                <button
                    onClick={onMenuClick}
                    className="flex flex-col items-center justify-center w-full h-full space-y-1 text-gray-500 hover:text-gray-900"
                >
                    <HiMenu className="w-6 h-6" />
                    <span className="text-xs font-medium">More</span>
                </button>
            </div>
        </div>
    );
};

export default BottomNavigation;
