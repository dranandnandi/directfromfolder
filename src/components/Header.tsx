import { HiMenu, HiRefresh, HiDownload } from 'react-icons/hi';
import { useState, useEffect } from 'react';
import NotificationBell from './NotificationBell';
import dcpLogo from '/notification-icon.svg';
import { OrganizationSettings } from '../models/task';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { supabase } from '../utils/supabaseClient';

interface HeaderProps {
  onMenuClick: () => void;
  onRefresh: () => void;
  organizationSettings: OrganizationSettings;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick, onRefresh, organizationSettings }) => {
  const { isInstallable, promptInstall } = useInstallPrompt();
  const [userInitials, setUserInitials] = useState('U');

  // Fetch current user data for avatar
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // First try to get user data from the users table
          const { data: userData } = await supabase
            .from('users')
            .select('name')
            .eq('auth_id', user.id)
            .single();
          
          if (userData?.name) {
            // Generate initials from full name
            const initials = userData.name
              .split(' ')
              .map((n: string) => n[0])
              .join('')
              .toUpperCase()
              .substring(0, 2); // Take first 2 characters
            setUserInitials(initials);
          } else {
            // Fallback to email-based initials
            const emailName = user.email?.split('@')[0] || 'User';
            const initials = emailName.substring(0, 2).toUpperCase();
            setUserInitials(initials);
          }
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
        setUserInitials('U');
      }
    };

    fetchCurrentUser();
  }, []);

  // Debug logging
  console.log('PWA Install status:', { isInstallable });

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
          {/* Always show install button for testing */}
          <button
            onClick={promptInstall}
            className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1"
            title={isInstallable ? "Install app" : "Install not available"}
            disabled={!isInstallable}
          >
            <HiDownload className="w-4 h-4" />
            <span className="hidden sm:inline text-sm">
              {isInstallable ? 'Install' : 'PWA'}
            </span>
          </button>
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
          <div className="bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium">
            {userInitials}
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;