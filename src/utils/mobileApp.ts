// Mobile App Initialization for Task Manager
// This file initializes all mobile-specific services and capabilities

import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

/**
 * Initialize mobile app services
 * Call this in your main App component
 */
export const initializeMobileApp = async () => {
  if (!Capacitor.isNativePlatform()) {
    console.log('Running on web platform - mobile features disabled');
    return;
  }

  try {
    console.log('Initializing mobile app services...');

    // Configure status bar
    await initializeStatusBar();
    
    // Hide splash screen
    await hideSplashScreen();
    
    // Initialize notification services (when packages are installed)
    // await notificationService.initializePushNotifications();
    // await notificationService.initializeLocalNotifications();
    
    // Initialize background sync (when packages are installed)
    // backgroundSyncService is already initialized as singleton
    
    console.log('Mobile app services initialized successfully');
    
  } catch (error) {
    console.error('Error initializing mobile app services:', error);
  }
};

/**
 * Configure status bar appearance
 */
const initializeStatusBar = async () => {
  try {
    await StatusBar.setStyle({ style: Style.Default });
    await StatusBar.setBackgroundColor({ color: '#ffffff' });
    await StatusBar.show();
  } catch (error) {
    console.error('Error configuring status bar:', error);
  }
};

/**
 * Hide splash screen after app loads
 */
const hideSplashScreen = async () => {
  try {
    await SplashScreen.hide();
  } catch (error) {
    console.error('Error hiding splash screen:', error);
  }
};

/**
 * Get device information
 */
export const getDeviceInfo = async () => {
  if (!Capacitor.isNativePlatform()) {
    return {
      platform: 'web',
      model: 'Browser',
      version: navigator.userAgent
    };
  }

  try {
    const { Device } = await import('@capacitor/device');
    const info = await Device.getInfo();
    return {
      platform: info.platform,
      model: info.model,
      version: info.osVersion,
      manufacturer: info.manufacturer
    };
  } catch (error) {
    console.error('Error getting device info:', error);
    return {
      platform: 'unknown',
      model: 'unknown',
      version: 'unknown'
    };
  }
};

/**
 * Check network status
 */
export const checkNetworkStatus = async () => {
  try {
    if (!Capacitor.isNativePlatform()) {
      return { connected: navigator.onLine, connectionType: 'unknown' };
    }

    const { Network } = await import('@capacitor/network');
    const status = await Network.getStatus();
    return {
      connected: status.connected,
      connectionType: status.connectionType
    };
  } catch (error) {
    console.error('Error checking network status:', error);
    return { connected: true, connectionType: 'unknown' };
  }
};

/**
 * Show native toast message
 */
export const showToast = async (message: string) => {
  try {
    if (!Capacitor.isNativePlatform()) {
      // Fallback for web - you could use a web toast library
      console.log('Toast:', message);
      return;
    }

    const { Toast } = await import('@capacitor/toast');
    await Toast.show({
      text: message,
      duration: 'short'
    });
  } catch (error) {
    console.error('Error showing toast:', error);
    // Fallback
    alert(message);
  }
};

/**
 * Trigger haptic feedback
 */
export const triggerHaptic = async (type: 'light' | 'medium' | 'heavy' = 'light') => {
  try {
    if (!Capacitor.isNativePlatform()) {
      return; // No haptic feedback on web
    }

    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    
    const impactStyles = {
      light: ImpactStyle.Light,
      medium: ImpactStyle.Medium,
      heavy: ImpactStyle.Heavy
    };

    await Haptics.impact({ style: impactStyles[type] });
  } catch (error) {
    console.error('Error triggering haptic feedback:', error);
  }
};

/**
 * Save data to secure storage
 */
export const saveToSecureStorage = async (key: string, value: string) => {
  try {
    if (!Capacitor.isNativePlatform()) {
      localStorage.setItem(key, value);
      return;
    }

    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key, value });
  } catch (error) {
    console.error('Error saving to secure storage:', error);
    localStorage.setItem(key, value); // Fallback
  }
};

/**
 * Get data from secure storage
 */
export const getFromSecureStorage = async (key: string): Promise<string | null> => {
  try {
    if (!Capacitor.isNativePlatform()) {
      return localStorage.getItem(key);
    }

    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key });
    return value;
  } catch (error) {
    console.error('Error getting from secure storage:', error);
    return localStorage.getItem(key); // Fallback
  }
};

/**
 * Clear all app data (logout)
 */
export const clearAppData = async () => {
  try {
    if (!Capacitor.isNativePlatform()) {
      localStorage.clear();
      return;
    }

    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.clear();
  } catch (error) {
    console.error('Error clearing app data:', error);
    localStorage.clear(); // Fallback
  }
};

/**
 * Share content using native sharing
 */
export const shareContent = async (title: string, text: string, url?: string) => {
  try {
    if (!Capacitor.isNativePlatform()) {
      // Web Share API fallback
      if (navigator.share) {
        await navigator.share({ title, text, url });
      } else {
        // Copy to clipboard fallback
        await navigator.clipboard.writeText(`${title}\n${text}\n${url || ''}`);
        await showToast('Content copied to clipboard');
      }
      return;
    }

    const { Share } = await import('@capacitor/share');
    await Share.share({
      title,
      text,
      url,
      dialogTitle: 'Share Task'
    });
  } catch (error) {
    console.error('Error sharing content:', error);
    await showToast('Unable to share content');
  }
};

// App lifecycle utilities
export const appLifecycle = {
  /**
   * Register app state change listener
   */
  onAppStateChange: async (callback: (isActive: boolean) => void) => {
    if (!Capacitor.isNativePlatform()) {
      // Web visibility API
      document.addEventListener('visibilitychange', () => {
        callback(!document.hidden);
      });
      return;
    }

    try {
      const { App } = await import('@capacitor/app');
      App.addListener('appStateChange', ({ isActive }) => {
        callback(isActive);
      });
    } catch (error) {
      console.error('Error setting up app state listener:', error);
    }
  },

  /**
   * Handle app coming to foreground
   */
  onAppResume: async (callback: () => void) => {
    if (!Capacitor.isNativePlatform()) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) callback();
      });
      return;
    }

    try {
      const { App } = await import('@capacitor/app');
      App.addListener('resume', callback);
    } catch (error) {
      console.error('Error setting up app resume listener:', error);
    }
  },

  /**
   * Handle app going to background
   */
  onAppPause: async (callback: () => void) => {
    if (!Capacitor.isNativePlatform()) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) callback();
      });
      return;
    }

    try {
      const { App } = await import('@capacitor/app');
      App.addListener('pause', callback);
    } catch (error) {
      console.error('Error setting up app pause listener:', error);
    }
  }
};

export default {
  initializeMobileApp,
  getDeviceInfo,
  checkNetworkStatus,
  showToast,
  triggerHaptic,
  saveToSecureStorage,
  getFromSecureStorage,
  clearAppData,
  shareContent,
  appLifecycle
};
