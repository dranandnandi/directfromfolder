import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const isStandaloneDisplay = (): boolean => {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    nav.standalone === true
  );
};

const detectIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(ua) || iPadOS;
};

/**
 * Tracks whether the browser is offering to install the app.
 *
 * - `isInstallable`: Chrome/Edge fired `beforeinstallprompt`, so `promptInstall()` will open the native dialog.
 * - `isInstalled`: the page is already running as an installed app (standalone display mode).
 * - `isIOS`: Safari never fires `beforeinstallprompt`; the user has to use Share -> Add to Home Screen.
 */
export const useInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => isStandaloneDisplay());
  const [isIOS] = useState<boolean>(() => detectIOS());

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    const mql = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayModeChange = (ev: MediaQueryListEvent) => setIsInstalled(ev.matches);
    mql?.addEventListener?.('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mql?.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) return 'unavailable';
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
      return outcome;
    } catch (err) {
      console.warn('PWA install prompt failed', err);
      setDeferredPrompt(null);
      return 'unavailable';
    }
  }, [deferredPrompt]);

  return {
    isInstallable: deferredPrompt !== null,
    isInstalled,
    isIOS,
    promptInstall,
  };
};
