import { supabase } from './supabaseClient';
import { Notification, NotificationPreference } from '../models/notification';

// Cache the current user's ID to avoid repeated queries
let cachedUserId: string | null = null;

async function getCurrentUserId(): Promise<string> {
  if (cachedUserId) {
    return cachedUserId!;
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    throw new Error('User not authenticated');
  }

  const { data: userRecord, error } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', userData.user.id)
    .single();

  if (error) throw error;
  if (!userRecord) throw new Error('User record not found');

  cachedUserId = userRecord.id;
  return cachedUserId!;
}

// Clear cached user ID on auth changes
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    cachedUserId = null;
  }
});

export async function registerDeviceToken(token: string, deviceType: 'android' | 'ios' | 'web') {
  try {
    const userId = await getCurrentUserId();

    const { error } = await supabase
      .from('device_tokens')
      .upsert({
        user_id: userId,
        token,
        device_type: deviceType
      }, {
        onConflict: 'token'
      });

    if (error) throw error;
  } catch (error) {
    console.error('Error registering device token:', error);
    throw error;
  }
}

export async function getNotifications(limit = 20, offset = 0): Promise<Notification[]> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return []; // Return empty array if not authenticated

    const userId = await getCurrentUserId();

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .or(
        `scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching notifications:', error);
      // If it's a network error, return empty array instead of throwing
      if (error.message?.includes('Failed to fetch') || error.message?.includes('fetch')) {
        console.warn('Network error fetching notifications, returning empty array');
        return [];
      }
      return [];
    }

    return (data || []).map(notification => ({
      ...notification,
      createdAt: new Date(notification.created_at),
      updatedAt: new Date(notification.updated_at),
      scheduledFor: notification.scheduled_for ? new Date(notification.scheduled_for) : undefined
    }));
  } catch (error) {
    console.error('Error fetching notifications:', error);
    // For any other errors (including network errors), return empty array
    return [];
  }
}

export async function markNotificationsAsRead(notificationIds: string[]) {
  try {
    const { error } = await supabase
      .rpc('mark_notifications_read', {
        p_notification_ids: notificationIds
      });

    if (error) throw error;
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    throw error;
  }
}

export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  try {
    const userId = await getCurrentUserId();

    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    return (data || []).map(pref => ({
      ...pref,
      createdAt: new Date(pref.created_at),
      updatedAt: new Date(pref.updated_at)
    }));
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    throw error;
  }
}

export async function updateNotificationPreference(
  type: string,
  enabled: boolean,
  advanceNotice: string
) {
  try {
    const userId = await getCurrentUserId();

    const { error } = await supabase
      .from('notification_preferences')
      .upsert({
        user_id: userId,
        type,
        enabled,
        advance_notice: advanceNotice
      }, {
        onConflict: 'user_id,type'
      });

    if (error) throw error;
  } catch (error) {
    console.error('Error updating notification preference:', error);
    throw error;
  }
}

// New function to subscribe to real-time notifications
export function subscribeToNotifications(
  onNotificationChange: (payload: any) => void
): () => void {
  const channel = supabase
    .channel('notifications-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications'
      },
      onNotificationChange
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    supabase.removeChannel(channel);
  };
}