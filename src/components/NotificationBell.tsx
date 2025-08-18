import React, { useState, useEffect, useRef } from 'react'; 
import { supabase } from '../utils/supabaseClient';
import { getNotifications, markNotificationsAsRead, subscribeToNotifications } from '../utils/notificationUtils';
import { Notification } from '../models/notification';
import dcpLogo from '/notification-icon.svg';

const NotificationBell: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchNotifications();

    // Set up real-time subscription
    const unsubscribe = subscribeToNotifications((payload) => {
      console.log('Real-time notification update:', payload);
      
      if (payload.eventType === 'INSERT') {
        // New notification received
        const newNotification: Notification = {
          ...payload.new,
          createdAt: new Date(payload.new.created_at),
          updatedAt: new Date(payload.new.updated_at),
          scheduledFor: payload.new.scheduled_for ? new Date(payload.new.scheduled_for) : undefined
        };
        
        setNotifications(prev => [newNotification, ...prev]);
        setUnreadCount(prev => prev + 1);
      } else if (payload.eventType === 'UPDATE') {
        // Notification updated (e.g., marked as read)
        setNotifications(prev => 
          prev.map(notif => 
            notif.id === payload.new.id 
              ? {
                  ...notif,
                  read: payload.new.read,
                  updatedAt: new Date(payload.new.updated_at)
                }
              : notif
          )
        );
        
        // Recalculate unread count
        setNotifications(current => {
          const newUnreadCount = current.filter(n => 
            n.id === payload.new.id ? payload.new.read === false : !n.read
          ).length;
          setUnreadCount(newUnreadCount);
          return current;
        });
      } else if (payload.eventType === 'DELETE') {
        // Notification deleted
        setNotifications(prev => prev.filter(notif => notif.id !== payload.old.id));
        setUnreadCount(prev => prev - (payload.old.read ? 0 : 1));
      }
    });

    unsubscribeRef.current = unsubscribe;

    // Cleanup subscription on unmount
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const fetchNotifications = async () => {
    try {
      // First check if user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // User not logged in, don't try to fetch
        return;
      }

      const notifs = await getNotifications(10);
      setNotifications(notifs);
      setUnreadCount(notifs.filter(n => !n.read).length);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      // Set empty notifications rather than failing
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      try {
        const notificationIds = [notification.id];
        await markNotificationsAsRead(notificationIds);
        
        // Update local state immediately for better UX
        // Real-time subscription will also update this, but local update is faster
        setNotifications(prevNotifications => 
          prevNotifications.map(n => 
            notificationIds.includes(n.id) ? { ...n, read: true } : n
          )
        );
        setUnreadCount(prev => Math.max(0, prev - notificationIds.length));
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }
    // Handle navigation based on notification type
    if (notification.taskId) {
      // Navigate to task details
      // TODO: Implement navigation
    }
  };

  const handleMarkAllAsRead = async () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length === 0) return;
    
    try {
      await markNotificationsAsRead(unreadIds);
      
      // Update local state immediately
      setNotifications(prevNotifications => 
        prevNotifications.map(n => ({ ...n, read: true }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => {
          setShowDropdown(!showDropdown);
        }}
        className="relative p-1 focus:outline-none"
      >
        <img src={dcpLogo} alt="DCP Logo" className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg z-50 border border-gray-200">
          <div className="p-4 border-b">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-sm text-gray-500">
                  {unreadCount} unread
                </span>
              )}
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                No notifications
              </div> 
            ) : (
              notifications.map(notification => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`p-4 border-b cursor-pointer hover:bg-gray-50 ${
                    !notification.read ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  }`}
                >
                  <h4 className={`font-medium ${!notification.read ? 'text-blue-900' : 'text-gray-900'}`}>
                    {notification.title}
                  </h4>
                  <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                  <span className="text-xs text-gray-500 mt-2 block">
                    {new Date(notification.createdAt).toLocaleDateString()} {new Date(notification.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
          {notifications.length > 0 && unreadCount > 0 && (
            <div className="p-3 border-t text-center">
              <button
                onClick={handleMarkAllAsRead}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Mark all as read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;