import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface NotificationModalProps {
  // Optional: pass as props if needed, otherwise uses event listener
  notification?: {
    title: string;
    body: string;
    image?: string;
  } | null;
  onClose?: () => void;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({ 
  notification: propNotification, 
  onClose 
}) => {
  const [notification, setNotification] = useState<{
    title: string;
    body: string;
    image?: string;
  } | null>(propNotification || null);

  useEffect(() => {
    const handleShowModal = (event: CustomEvent<{ title: string; body: string; image?: string }>) => {
      console.log('NotificationModal: Received showNotificationModal event', event.detail);
      setNotification(event.detail);
    };

    window.addEventListener('showNotificationModal', handleShowModal as EventListener);
    
    return () => {
      window.removeEventListener('showNotificationModal', handleShowModal as EventListener);
    };
  }, []);

  // Update if prop changes
  useEffect(() => {
    if (propNotification) {
      setNotification(propNotification);
    }
  }, [propNotification]);

  const handleClose = () => {
    setNotification(null);
    onClose?.();
  };

  if (!notification) {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black bg-opacity-50"
      onClick={handleClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 truncate pr-2">
            {notification.title || 'Notification'}
          </h3>
          <button
            onClick={handleClose}
            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Image */}
          {notification.image && (
            <div className="w-full bg-gray-100">
              <img
                src={notification.image}
                alt="Notification image"
                className="w-full h-auto max-h-64 object-contain"
                onError={(e) => {
                  console.log('Failed to load notification image:', notification.image);
                  // Hide the image container on error
                  (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                }}
              />
            </div>
          )}

          {/* Body */}
          {notification.body && (
            <div className="px-4 py-3">
              <p className="text-gray-700 whitespace-pre-wrap">{notification.body}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
          <button
            onClick={handleClose}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationModal;
