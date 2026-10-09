export type ExternalWhatsAppStatus =
  | 'not_configured'
  | 'checking'
  | 'not_registered'
  | 'not_initialized'
  | 'initializing'
  | 'qr_pending'
  | 'connected'
  | 'error';

export interface ExternalWhatsAppQrPayload {
  status: ExternalWhatsAppStatus;
  sessionName?: string;
  qrCode?: string | null;
  qrCodeUrl?: string | null;
  qrDataUrl?: string | null;
  qrTimestamp?: number | null;
  phoneNumber?: string | null;
}

export interface ExternalWhatsAppSession {
  sessionId?: string;
  sessionName: string;
  status: string;
  phoneNumber?: string | null;
  isConnected: boolean;
  isAuthenticated: boolean;
  lastConnectedAt?: string | null;
}

export interface ExternalWhatsAppStatusPayload {
  sessions: ExternalWhatsAppSession[];
}

export interface ExternalWhatsAppAdminUser {
  id: string;
  email?: string | null;
  name?: string | null;
  role: string;
}

const configuredBaseUrl = (import.meta.env.VITE_EXTERNAL_WA_API_URL || '').replace(/\/+$/, '');
const configuredApiKey = import.meta.env.VITE_EXTERNAL_WA_API_KEY || '';

function assertConfigured() {
  if (!configuredBaseUrl || !configuredApiKey) {
    throw new Error('External WhatsApp API is not configured');
  }
}

async function requestExternal<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  assertConfigured();

  const response = await fetch(`${configuredBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': configuredApiKey,
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const message = payload?.error || `External WhatsApp API failed (${response.status})`;
    const error = new Error(message);
    (error as any).status = response.status;
    throw error;
  }

  return payload?.data as T;
}

export const externalWhatsAppService = {
  isConfigured: Boolean(configuredBaseUrl && configuredApiKey),

  async handshake(userId: string) {
    return requestExternal<{ userId: string; existed: boolean }>('/api/external/users/sync', {
      method: 'POST',
      body: JSON.stringify({ id: userId }),
    });
  },

  async syncAdmins(organizationId: string, admins: ExternalWhatsAppAdminUser[]) {
    return requestExternal<{
      organizationId: string;
      received: number;
      synced: number;
      users: Array<{ id: string; username: string; role: string }>;
    }>('/api/external/users/sync-admins', {
      method: 'POST',
      body: JSON.stringify({ organizationId, admins }),
    });
  },

  async connect(userId: string, sessionName = 'default') {
    return requestExternal<ExternalWhatsAppQrPayload>(`/api/users/${encodeURIComponent(userId)}/whatsapp/connect`, {
      method: 'POST',
      body: JSON.stringify({ sessionName }),
    });
  },

  async refreshQr(userId: string, sessionName = 'default') {
    return requestExternal<ExternalWhatsAppQrPayload>(`/api/users/${encodeURIComponent(userId)}/whatsapp/refresh-qr`, {
      method: 'POST',
      body: JSON.stringify({ sessionName }),
    });
  },

  async getQr(userId: string, sessionName = 'default') {
    const query = new URLSearchParams({ sessionName });
    return requestExternal<ExternalWhatsAppQrPayload>(`/api/users/${encodeURIComponent(userId)}/whatsapp/qr?${query.toString()}`);
  },

  async getStatus(userId: string) {
    return requestExternal<ExternalWhatsAppStatusPayload>(`/api/users/${encodeURIComponent(userId)}/whatsapp/status`);
  },

  async disconnect(userId: string, sessionName = 'default') {
    return requestExternal<{ status: string; sessionName: string }>('/api/external/sessions/disconnect', {
      method: 'POST',
      body: JSON.stringify({ userId, sessionName }),
    });
  },
};
