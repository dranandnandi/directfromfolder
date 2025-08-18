import { HiMenu, HiRefresh } from 'react-icons/hi';
import NotificationBell from './NotificationBell';
import dcpLogo from '/notification-icon.svg';
import { OrganizationSettings } from '../models/task';

interface HeaderProps {
  onMenuClick: () => void;
  onRefresh: () => void;
  organizationSettings: OrganizationSettings;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick, onRefresh, organizationSettings }) => {
  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between relative">
        <div className="flex items-center gap-4">
          <button onClick={onMenuClick} className="lg:hidden">
            <HiMenu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <img src={dcpLogo} alt="DCP Logo" className="w-10 h-10" />
            <h1 className="text-lg font-semibold">{organizationSettings?.name || 'Clinic Task Manager'}</h1>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={onRefresh}
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh all data"
          >
            <HiRefresh className="w-5 h-5" />
          </button>
          <div className="relative z-50">
            <NotificationBell />
          </div>
          <div className="bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center">
            AS
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;