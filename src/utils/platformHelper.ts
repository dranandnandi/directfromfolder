import { Capacitor } from '@capacitor/core';

/**
 * Platform detection utilities for conditional rendering and behavior
 */

/**
 * Check if the app is running on Android platform
 * @returns true if running on Android, false otherwise
 */
export const isAndroid = (): boolean => {
  return Capacitor.getPlatform() === 'android';
};

/**
 * Check if the app is running on iOS platform
 * @returns true if running on iOS, false otherwise
 */
export const isIOS = (): boolean => {
  return Capacitor.getPlatform() === 'ios';
};

/**
 * Check if the app is running in a native context (iOS or Android)
 * @returns true if running natively, false if running in web browser
 */
export const isNative = (): boolean => {
  return Capacitor.isNativePlatform();
};

/**
 * Check if the app is running in web browser
 * @returns true if running in browser, false if native
 */
export const isWeb = (): boolean => {
  return Capacitor.getPlatform() === 'web';
};

/**
 * Get the current platform name
 * @returns 'ios', 'android', or 'web'
 */
export const getPlatform = (): string => {
  return Capacitor.getPlatform();
};

/**
 * Check if the device is a mobile device (native iOS or Android)
 * @returns true if mobile native, false otherwise
 */
export const isMobile = (): boolean => {
  return isAndroid() || isIOS();
};
