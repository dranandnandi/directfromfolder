import { useEffect, useState } from 'react';
import { initializeMobileApp, getDeviceInfo, checkNetworkStatus, appLifecycle } from '../utils/mobileApp';

interface DeviceInfo {
  platform: string;
  model: string;
  version: string;
  manufacturer?: string;
}

interface NetworkStatus {
  connected: boolean;
  connectionType: string;
}

export const useMobileApp = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({ connected: true, connectionType: 'unknown' });
  const [isAppActive, setIsAppActive] = useState(true);

  useEffect(() => {
    const initApp = async () => {
      try {
        // Initialize mobile app services
        await initializeMobileApp();
        
        // Get device information
        const deviceData = await getDeviceInfo();
        setDeviceInfo(deviceData);
        
        // Check initial network status
        const networkData = await checkNetworkStatus();
        setNetworkStatus(networkData);
        
        // Setup app lifecycle listeners
        await appLifecycle.onAppStateChange((isActive) => {
          setIsAppActive(isActive);
        });
        
        setIsInitialized(true);
        console.log('Mobile app initialized successfully');
        
      } catch (error) {
        console.error('Error initializing mobile app:', error);
        setIsInitialized(true); // Set to true anyway to prevent blocking
      }
    };

    initApp();
  }, []);

  return {
    isInitialized,
    deviceInfo,
    networkStatus,
    isAppActive,
    isMobile: deviceInfo?.platform !== 'web'
  };
};

export default useMobileApp;
