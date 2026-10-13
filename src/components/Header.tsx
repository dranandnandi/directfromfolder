import { HiMenu, HiRefresh, HiDownload, HiX } from 'react-icons/hi';
import { useState, useEffect, useRef } from 'react';
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
  const { isInstallable, isInstalled, isIOS, promptInstall } = useInstallPrompt();
  const [userInitials, setUserInitials] = useState('U');
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const installHelpRef = useRef<HTMLDivElement>(null);

  // Close the install-help popover when clicking outside of it
  useEffect(() => {
    if (!showInstallHelp) return;
    const onDocClick = (e: MouseEvent) => {
      if (installHelpRef.current && !installHelpRef.current.contains(e.target as Node)) {
        setShowInstallHelp(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showInstallHelp]);

  const handleInstallClick = async () => {
    if (isInstallable) {
      const outcome = await promptInstall();
      if (outcome !== 'unavailable') return;
    }
    // Browser did not offer a native prompt (Safari, Firefox, or the criteria
    // were not met yet) - show manual instructions instead of doing nothing.
    setShowInstallHelp((v) => !v);
  };

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

  return (
    <header className="bg-white shadow-sm">
      {/* Safe area spacer for Android status bar/notch - more space on mobile */}
      <div className="h-12 sm:h-10 lg:h-0 bg-white"></div>
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between relative">
        <div className="flex items-center gap-3">
          <button onClick={onMenuClick} className="lg:hidden p-1">
            <HiMenu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <img src={dcpLogo} alt="DCP Logo" className="w-8 h-8 sm:w-10 sm:h-10" />
            {/* Hide organization name on small phones, show on tablets and desktop */}
            <h1 className="hidden sm:block text-lg font-semibold">{organizationSettings?.name || 'Staff Management Solution'}</h1>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Install (PWA) button - hidden once the app is running installed */}
          {!isInstalled && (
            <div className="relative" ref={installHelpRef}>
              <button
                onClick={handleInstallClick}
                className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1"
                title="Install this app on your device"
                aria-haspopup="dialog"
                aria-expanded={showInstallHelp}
              >
                <HiDownload className="w-4 h-4" />
                <span className="hidden sm:inline text-sm">Install app</span>
              </button>
              {showInstallHelp && (
                <div
                  role="dialog"
                  className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-sm text-gray-700 z-50"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-semibold text-gray-900">Install this app</p>
                    <button
                      onClick={() => setShowInstallHelp(false)}
                      className="text-gray-400 hover:text-gray-600"
                      aria-label="Close"
                    >
                      <HiX className="w-4 h-4" />
                    </button>
                  </div>
                  {isIOS ? (
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Open this page in <strong>Safari</strong>.</li>
                      <li>Tap the <strong>Share</strong> button (square with an arrow).</li>
                      <li>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li>
                    </ol>
                  ) : (
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Use <strong>Chrome</strong> or <strong>Edge</strong>.</li>
                      <li>Open the browser menu (<strong>&#8942;</strong>) or click the install icon in the address bar.</li>
                      <li>Choose <strong>Install app</strong> / <strong>Add to Home screen</strong>.</li>
                    </ol>
                  )}
                  <p className="mt-2 text-xs text-gray-500">
                    If the option is missing, the app may already be installed or the browser does not support installing web apps.
                  </p>
                </div>
              )}
            </div>
          )}
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