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

export class NotificationService {
  private static instance: NotificationService;
  private pushToken: string | null = null;

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
      console.log('Push notification received: ', notification);
      
      // Create local notification to show when app is in foreground
      this.showLocalNotification({
        title: notification.title || 'Task Manager',
        body: notification.body || 'You have a new notification',
        id: Date.now(),
        extra: notification.data
      });
    });

    // Handle notification tap when app is in background
    PushNotifications.addListener('pushNotificationActionPerformed', (notification: ActionPerformed) => {
      console.log('Push notification action performed: ', notification);
      
      // Handle notification tap - navigate to relevant screen
      this.handleNotificationTap(notification.notification.data);
    });
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
      this.handleNotificationTap(notificationAction.notification.extra);
    });
  }

  /**
   * Send push token to backend
   */
  private async sendTokenToBackend(token: string): Promise<void> {
    try {
      // This would integrate with your Supabase backend
      // You can store the token in the users table for push notifications
      console.log('Sending token to backend:', token);
      
      // Example API call to save token
      // await supabase
      //   .from('user_devices')
      //   .upsert({
      //     user_id: currentUserId,
      //     device_token: token,
      //     platform: Capacitor.getPlatform(),
      //     updated_at: new Date().toISOString()
      //   });
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
  private handleNotificationTap(data: any): void {
    if (data) {
      console.log('Handling notification tap with data:', data);
      
      // Navigate based on notification type
      if (data.type === 'task_overdue') {
        // Navigate to task details
        window.location.href = `/tasks/${data.task_id}`;
      } else if (data.type === 'task_reminder') {
        // Navigate to task list
        window.location.href = '/tasks';
      } else if (data.type === 'conversation_alert') {
        // Navigate to conversations
        window.location.href = '/conversations';
      }
    }
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
