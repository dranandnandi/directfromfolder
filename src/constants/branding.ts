import { Capacitor } from '@capacitor/core';

/**
 * Domain-based white-label branding.
 *
 * The same build is served on multiple domains. The brand shown in the UI
 * (logo, name, tagline, tab title, favicon, PWA manifest) is picked from the
 * hostname at runtime. Anything not matched falls back to the default brand.
 */

export interface Branding {
  /** Stable key, useful for conditionals */
  key: 'default' | 'meditrust';
  /** Display name shown in the sidebar header and login page */
  name: string;
  /** Small line under the name in the sidebar */
  tagline: string;
  /** Browser tab / PWA title */
  title: string;
  /** Square mark for sidebar header + favicon */
  icon: string;
  /** Larger logo for login / reset password pages */
  logo: string;
  /** True when the large logo already contains the brand name (avoid printing it twice) */
  logoIncludesName: boolean;
  /** PWA manifest to link */
  manifest: string;
  /** Theme colour for the browser chrome */
  themeColor: string;
  /** When true, the sidebar shows the brand name instead of the organisation name from the DB */
  overrideOrganizationName: boolean;
}

const DEFAULT_BRANDING: Branding = {
  key: 'default',
  name: 'Staff Management Solution',
  tagline: 'Task Manager',
  title: 'Staff Management Solution',
  icon: '/notification-icon.svg',
  logo: '/notification-icon.svg',
  logoIncludesName: false,
  manifest: '/manifest.json',
  themeColor: '#3b82f6',
  overrideOrganizationName: false,
};

const MEDITRUST_BRANDING: Branding = {
  key: 'meditrust',
  name: 'MediTrust Clinics',
  tagline: 'Staff Portal',
  title: 'MediTrust Clinics - Staff Portal',
  icon: '/meditrust-icon.png',
  logo: '/meditrust-logo.png',
  logoIncludesName: true,
  manifest: '/manifest-meditrust.json',
  themeColor: '#1b4a66',
  overrideOrganizationName: true,
};

/** hostname suffix -> branding. First match wins. */
const DOMAIN_BRANDING: Array<{ match: (host: string) => boolean; branding: Branding }> = [
  {
    match: (host) => host === 'anprohealthtech.com' || host.endsWith('.anprohealthtech.com'),
    branding: MEDITRUST_BRANDING,
  },
];

export function getBrandingForHost(host: string | undefined | null): Branding {
  const h = (host || '').toLowerCase();
  // The native Android/iOS app is MediTrust-branded regardless of host.
  if (Capacitor.isNativePlatform()) return MEDITRUST_BRANDING;
  // Local override for testing: ?brand=meditrust
  if (typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('brand');
    if (forced === 'meditrust') return MEDITRUST_BRANDING;
    if (forced === 'default') return DEFAULT_BRANDING;
  }
  for (const entry of DOMAIN_BRANDING) {
    if (entry.match(h)) return entry.branding;
  }
  return DEFAULT_BRANDING;
}

let cached: Branding | null = null;

/** Branding for the current page. Resolved once per page load. */
export function getBranding(): Branding {
  if (cached) return cached;
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  cached = getBrandingForHost(host);
  return cached;
}

/** Apply title, favicon, manifest and theme colour to the document. Call once at startup. */
export function applyBrandingToDocument(): Branding {
  const b = getBranding();
  if (typeof document === 'undefined') return b;

  document.title = b.title;

  const setLink = (rel: string, href: string, type?: string) => {
    let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!el) {
      el = document.createElement('link');
      el.rel = rel;
      document.head.appendChild(el);
    }
    el.href = href;
    if (type) el.type = type;
    else el.removeAttribute('type');
  };
  const setMeta = (name: string, content: string) => {
    let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.name = name;
      document.head.appendChild(el);
    }
    el.content = content;
  };

  setLink('icon', b.icon, b.icon.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
  setLink('apple-touch-icon', `/icons/${b.key}-192.png`);
  setLink('manifest', b.manifest);
  setMeta('theme-color', b.themeColor);
  setMeta('application-name', b.name);
  setMeta('apple-mobile-web-app-title', b.name);

  return b;
}
