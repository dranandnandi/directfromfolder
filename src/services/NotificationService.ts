import { 
  PushNotifications, 
  PushNotificationSchema, 
  ActionPerformed,
  Token
} from '@capacitor/push-notifications';
import { 
  LocalNotifications
} from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { Dialog } from '@capacitor/dialog';
import { Device } from '@capacitor/device';
import { supabase } from '../utils/supabaseClient';

export class NotificationService {
  private static instance: NotificationService;
  private pushToken: string | null = null;
  private lastNotification: { title: string; body: string; image?: string; data: any } | null = null;

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Initialize push notifications
   */
  async initializePushNotifications(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      console.log('Push notifications not available on web platform');
      return;
    }

    try {
      // Request permission to use push notifications
      const result = await PushNotifications.requestPermissions();
      
      if (result.receive === 'granted') {
        // Register with Apple / Google to receive push via APNS/FCM
        await PushNotifications.register();
        
        // Setup listeners
        this.setupPushNotificationListeners();
      } else {
        console.log('Push notification permission denied');
      }
    } catch (error) {
      console.error('Error initializing push notifications:', error);
    }
  }

  /**
   * Initialize local notifications
   */
  async initializeLocalNotifications(): Promise<void> {
    try {
      const result = await LocalNotifications.requestPermissions();
      
      if (result.display === 'granted') {
        // Setup listeners for local notifications
        this.setupLocalNotificationListeners();
      }
    } catch (error) {
      console.error('Error initializing local notifications:', error);
    }
  }

  /**
   * Setup push notification event listeners
   */
  private setupPushNotificationListeners(): void {
    // On registration, save the token to send to backend
    PushNotifications.addListener('registration', (token: Token) => {
      this.pushToken = token.value;
      console.log('Push registration token: ', token.value);
      // Send token to your backend to enable push notifications for this device
      this.sendTokenToBackend(token.value);
    });

    // Handle registration errors
    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('Registration error: ', error.error);
    });

    // Show notification when app is in foreground
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('Push notification received in foreground: ', JSON.stringify(notification));
      
      // Extract image from various possible sources
      const data = notification.data || {};
      const image = data.image || data.imageUrl || data.picture || data.fcm_options?.image || '';
      
      // Create local notification to show when app is in foreground
      // Use modulo to ensure ID fits in Java int range
      const notificationId = Math.abs(Date.now() % 2147483647);
      
      this.showLocalNotification({
        title: notification.title || 'Task Manager',
        body: notification.body || 'You have a new notification',
        id: notificationId,
        extra: { 
          ...notification.data, 
          originalTitle: notification.title, 
          originalBody: notification.body,
          image: image,
          title: notification.title,
          body: notification.body
        }
      });
    });

    // Handle notification tap when app is in background/killed
    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('Push notification tapped: ', JSON.stringify(action));
      
      const notification = action.notification;
      const data = notification.data || {};
      
      // Firebase Console sends title/body separately, not in data when tapped from background
      // Try to get title/body/image from multiple possible sources
      const title = notification.title || data.title || data.notificationTitle || data.originalTitle || '';
      const body = notification.body || data.body || data.notificationBody || data.originalBody || data.message || '';
      
      // Extract image URL from various possible locations
      const image = data.image || data.imageUrl || data.picture || data.fcm_options?.image || 
                    data.notification?.image || data.android?.imageUrl || '';
      
      console.log('Extracted - Title:', title, 'Body:', body, 'Image:', image);
      
      // Store notification data for display
      this.lastNotification = {
        title: title || 'Notification',
        body: body,
        image: image,
        data: data
      };
      
      // Dispatch custom event so the app can react to it
      window.dispatchEvent(new CustomEvent('pushNotificationTapped', { 
        detail: this.lastNotification 
      }));
      
      // Handle navigation based on notification type
      this.handleNotificationTap(data, title, body, image);
    });
    
    console.log('Push notification listeners registered successfully');
  }

  /**
   * Setup local notification listeners
   */
  private setupLocalNotificationListeners(): void {
    LocalNotifications.addListener('localNotificationReceived', (notification) => {
      console.log('Local notification received: ', notification);
    });

    LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
      console.log('Local notification action performed: ', notificationAction);
      const extra = notificationAction.notification.extra || {};
      this.handleNotificationTap(extra, extra.title, extra.body, extra.image);
    });
  }

  /**
   * Send push token to backend
   */
  private async sendTokenToBackend(token: string): Promise<void> {
    try {
      console.log('Sending token to backend:', token);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('No authenticated user, skipping token save');
        return;
      }

      // Get device info
      const deviceInfo = await Device.getInfo();
      const deviceId = await Device.getId();

      // Save token to database using upsert function
      const { data, error } = await supabase.rpc('upsert_device_token', {
        p_user_id: user.id,
        p_fcm_token: token,
        p_device_info: {
          model: deviceInfo.model,
          platform: deviceInfo.platform,
          operatingSystem: deviceInfo.operatingSystem,
          osVersion: deviceInfo.osVersion,
          manufacturer: deviceInfo.manufacturer,
          deviceId: deviceId.identifier
        },
        p_platform: Capacitor.getPlatform()
      });

      if (error) {
        console.error('Error saving token to database:', error);
        // Fallback: try direct upsert using the token column (unique constraint is on token/fcm_token)
        const { error: insertError } = await supabase
          .from('device_tokens')
          .upsert({
            user_id: user.id,
            fcm_token: token,
            device_info: {
              model: deviceInfo.model,
              platform: deviceInfo.platform,
              osVersion: deviceInfo.osVersion,
              deviceId: deviceId.identifier
            },
            platform: Capacitor.getPlatform(),
            is_active: true,
            last_used_at: new Date().toISOString()
          }, {
            onConflict: 'fcm_token'  // Existing table has UNIQUE on token column (renamed to fcm_token)
          });
        
        if (insertError) {
          console.error('Fallback insert also failed:', insertError);
        } else {
          console.log('Token saved via fallback insert');
        }
      } else {
        console.log('Token saved successfully:', data);
      }
    } catch (error) {
      console.error('Error sending token to backend:', error);
    }
  }

  /**
   * Show local notification
   */
  async showLocalNotification(notification: {
    title: string;
    body: string;
    id: number;
    extra?: any;
  }): Promise<void> {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          title: notification.title,
          body: notification.body,
          id: notification.id,
          extra: notification.extra,
          iconColor: '#488AFF'
        }]
      });
    } catch (error) {
      console.error('Error showing local notification:', error);
    }
  }

  /**
   * Schedule local notification for specific time
   */
  async scheduleLocalNotification(notification: {
    title: string;
    body: string;
    id: number;
    scheduledAt: Date;
    extra?: any;
  }): Promise<void> {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          title: notification.title,
          body: notification.body,
          id: notification.id,
          schedule: { at: notification.scheduledAt },
          extra: notification.extra,
          iconColor: '#488AFF'
        }]
      });
    } catch (error) {
      console.error('Error scheduling local notification:', error);
    }
  }

  /**
   * Handle notification tap - navigate to relevant screen
   */
  private handleNotificationTap(data: any, title?: string, body?: string, image?: string): void {
    console.log('Handling notification tap with data:', JSON.stringify(data));
    console.log('Title:', title, 'Body:', body, 'Image:', image);
    
    // Check for known notification types first
    if (data?.type) {
      // Navigate based on notification type
      if (data.type === 'task_overdue') {
        window.location.href = `/tasks/${data.task_id}`;
        return;
      } else if (data.type === 'task_reminder') {
        window.location.href = '/tasks';
        return;
      } else if (data.type === 'conversation_alert') {
        window.location.href = '/conversations';
        return;
      } else if (data.type === 'attendance') {
        window.location.href = '/hr/attendance';
        return;
      }
    }
    
    // For generic notifications - dispatch event for rich display
    setTimeout(async () => {
      const hasContent = (title && title.trim()) || (body && body.trim());
      const hasImage = image && image.trim();
      
      // If there's an image, dispatch event for custom modal display
      if (hasImage) {
        window.dispatchEvent(new CustomEvent('showNotificationModal', {
          detail: {
            title: title || 'Notification',
            body: body || '',
            image: image
          }
        }));
        return;
      }
      
      // Otherwise show simple dialog
      try {
        await Dialog.alert({
          title: hasContent ? (title || 'Notification') : 'Notification received!',
          message: hasContent ? (body || '') : 'The notification was displayed by the system. For in-app content, notifications need to include custom data fields.',
          buttonTitle: 'OK'
        });
      } catch (e) {
        console.log('Dialog error, falling back to alert:', e);
        // Fallback to regular alert
        if (hasContent) {
          alert(`${title || 'Notification'}\n\n${body || ''}`);
        } else {
          alert('Notification received!');
        }
      }
    }, 300);
  }

  /**
   * Get last received notification
   */
  getLastNotification(): { title: string; body: string; data: any } | null {
    return this.lastNotification;
  }

  /**
   * Clear last notification
   */
  clearLastNotification(): void {
    this.lastNotification = null;
  }

  /**
   * Get current push token
   */
  getPushToken(): string | null {
    return this.pushToken;
  }

  /**
   * Clear all local notifications
   */
  async clearAllNotifications(): Promise<void> {
    try {
      await LocalNotifications.cancel({
        notifications: (await LocalNotifications.getPending()).notifications
      });
    } catch (error) {
      console.error('Error clearing notifications:', error);
    }
  }

  /**
   * Create notification for task reminders (called by background sync)
   */
  async createTaskReminder(task: {
    id: string;
    title: string;
    due_date: string;
    priority: 'high' | 'medium' | 'low';
  }): Promise<void> {
    const dueDate = new Date(task.due_date);
    const now = new Date();
    
    // Don't schedule if already overdue
    if (dueDate <= now) {
      return;
    }

    const priorityEmoji = {
      high: '🔴',
      medium: '🟠', 
      low: '🟢'
    };

    await this.scheduleLocalNotification({
      title: `${priorityEmoji[task.priority]} Task Reminder`,
      body: `"${task.title}" is due soon`,
      id: parseInt(task.id.replace(/-/g, '').substring(0, 8), 16),
      scheduledAt: new Date(dueDate.getTime() - 30 * 60 * 1000), // 30 min before
      extra: {
        type: 'task_reminder',
        task_id: task.id,
        priority: task.priority
      }
    });
  }
}

// Export singleton instance
export const notificationService = NotificationService.getInstance();
