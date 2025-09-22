import { App, AppState } from '@capacitor/app';
import { Network, ConnectionStatus } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { createClient } from '@supabase/supabase-js';

export class BackgroundSyncService {
  private static instance: BackgroundSyncService;
  private isAppInBackground = false;
  private supabase: any;

  private constructor() {
    // Initialize Supabase client
    this.supabase = createClient(
      'YOUR_SUPABASE_URL', // Replace with your Supabase URL
      'YOUR_SUPABASE_ANON_KEY' // Replace with your Supabase anon key
    );
    
    this.setupAppStateListeners();
    this.setupNetworkListeners();
  }

  public static getInstance(): BackgroundSyncService {
    if (!BackgroundSyncService.instance) {
      BackgroundSyncService.instance = new BackgroundSyncService();
    }
    return BackgroundSyncService.instance;
  }

  /**
   * Setup app state change listeners
   */
  private setupAppStateListeners(): void {
    App.addListener('appStateChange', (state: AppState) => {
      if (state.isActive) {
        this.onAppForeground();
      } else {
        this.onAppBackground();
      }
    });
  }

  /**
   * Setup network status listeners
   */
  private setupNetworkListeners(): void {
    Network.addListener('networkStatusChange', (status: ConnectionStatus) => {
      if (status.connected && this.isAppInBackground) {
        // Network restored while in background - sync data
        this.performBackgroundSync();
      }
    });
  }

  /**
   * Handle app going to background
   */
  private async onAppBackground(): Promise<void> {
    this.isAppInBackground = true;
    
    try {
      console.log('App went to background - performing quick sync');
      
      // Perform critical background tasks without background task API
      await this.syncCriticalNotifications();
      await this.checkOverdueTasks();
      await this.syncPendingChanges();
      
    } catch (error) {
      console.error('Error during background sync:', error);
    }
  }

  /**
   * Handle app coming to foreground
   */
  private async onAppForeground(): Promise<void> {
    this.isAppInBackground = false;
    
    // Perform foreground sync
    await this.performForegroundSync();
  }

  /**
   * Perform background data synchronization
   */
  private async performBackgroundSync(): Promise<void> {
    try {
      console.log('Performing background sync...');
      
      // Check network status
      const networkStatus = await Network.getStatus();
      if (!networkStatus.connected) {
        console.log('No network connection, skipping sync');
        return;
      }

      // Sync critical data only in background to save battery
      await this.syncCriticalNotifications();
      await this.updateTaskStatus();
      
    } catch (error) {
      console.error('Background sync failed:', error);
    }
  }

  /**
   * Perform foreground data synchronization
   */
  private async performForegroundSync(): Promise<void> {
    try {
      console.log('Performing foreground sync...');
      
      // Full sync when app comes to foreground
      await this.syncAllData();
      await this.checkOverdueTasks();
      
    } catch (error) {
      console.error('Foreground sync failed:', error);
    }
  }

  /**
   * Sync critical notifications only
   */
  private async syncCriticalNotifications(): Promise<void> {
    try {
      const lastSync = await this.getLastSyncTime();
      
      // Fetch only high priority notifications since last sync
      const { data: notifications } = await this.supabase
        .from('notifications')
        .select('*')
        .eq('priority', 'high')
        .gt('created_at', lastSync)
        .order('created_at', { ascending: false })
        .limit(10);

      if (notifications?.length) {
        await this.storeOfflineData('critical_notifications', notifications);
      }
      
    } catch (error) {
      console.error('Error syncing critical notifications:', error);
    }
  }

  /**
   * Check for overdue tasks and create notifications
   */
  private async checkOverdueTasks(): Promise<void> {
    try {
      const now = new Date().toISOString();
      
      // Get overdue tasks
      const { data: overdueTasks } = await this.supabase
        .from('tasks')
        .select('*')
        .lt('due_date', now)
        .eq('status', 'pending')
        .limit(20);

      if (overdueTasks?.length) {
        // Store for offline notification creation
        await this.storeOfflineData('overdue_tasks', overdueTasks);
        
        // Create local notifications for overdue tasks
        for (const task of overdueTasks) {
          // This would integrate with NotificationService
          console.log(`Task "${task.title}" is overdue`);
        }
      }
      
    } catch (error) {
      console.error('Error checking overdue tasks:', error);
    }
  }

  /**
   * Update task completion status
   */
  private async updateTaskStatus(): Promise<void> {
    try {
      // Get pending task updates from local storage
      const pendingUpdates = await this.getOfflineData('pending_task_updates') || [];
      
      for (const update of pendingUpdates) {
        try {
          await this.supabase
            .from('tasks')
            .update({
              status: update.status,
              completed_at: update.completed_at,
              updated_at: new Date().toISOString()
            })
            .eq('id', update.task_id);
            
          console.log(`Task ${update.task_id} status updated to ${update.status}`);
        } catch (error) {
          console.error(`Failed to update task ${update.task_id}:`, error);
        }
      }
      
      // Clear processed updates
      await this.clearOfflineData('pending_task_updates');
      
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  }

  /**
   * Sync all data when app comes to foreground
   */
  private async syncAllData(): Promise<void> {
    try {
      const lastSync = await this.getLastSyncTime();
      
      // Sync tasks
      const { data: tasks } = await this.supabase
        .from('tasks')
        .select('*')
        .gt('updated_at', lastSync)
        .order('updated_at', { ascending: false });

      if (tasks?.length) {
        await this.storeOfflineData('tasks', tasks);
      }

      // Sync notifications
      const { data: notifications } = await this.supabase
        .from('notifications')
        .select('*')
        .gt('updated_at', lastSync)
        .order('updated_at', { ascending: false });

      if (notifications?.length) {
        await this.storeOfflineData('notifications', notifications);
      }

      // Update last sync time
      await this.setLastSyncTime(new Date().toISOString());
      
    } catch (error) {
      console.error('Error syncing all data:', error);
    }
  }

  /**
   * Sync pending changes made while offline
   */
  private async syncPendingChanges(): Promise<void> {
    try {
      // This would sync any changes made while offline
      const pendingChanges = await this.getOfflineData('pending_changes') || [];
      
      for (const change of pendingChanges) {
        // Process each pending change
        console.log('Processing pending change:', change);
      }
      
    } catch (error) {
      console.error('Error syncing pending changes:', error);
    }
  }

  /**
   * Store data for offline access
   */
  private async storeOfflineData(key: string, data: any): Promise<void> {
    try {
      await Preferences.set({
        key: `offline_${key}`,
        value: JSON.stringify(data)
      });
    } catch (error) {
      console.error(`Error storing offline data for ${key}:`, error);
    }
  }

  /**
   * Get offline data
   */
  private async getOfflineData(key: string): Promise<any> {
    try {
      const result = await Preferences.get({ key: `offline_${key}` });
      return result.value ? JSON.parse(result.value) : null;
    } catch (error) {
      console.error(`Error getting offline data for ${key}:`, error);
      return null;
    }
  }

  /**
   * Clear offline data
   */
  private async clearOfflineData(key: string): Promise<void> {
    try {
      await Preferences.remove({ key: `offline_${key}` });
    } catch (error) {
      console.error(`Error clearing offline data for ${key}:`, error);
    }
  }

  /**
   * Get last sync timestamp
   */
  private async getLastSyncTime(): Promise<string> {
    try {
      const result = await Preferences.get({ key: 'last_sync_time' });
      return result.value || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Default to 24 hours ago
    } catch (error) {
      console.error('Error getting last sync time:', error);
      return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    }
  }

  /**
   * Set last sync timestamp
   */
  private async setLastSyncTime(timestamp: string): Promise<void> {
    try {
      await Preferences.set({
        key: 'last_sync_time',
        value: timestamp
      });
    } catch (error) {
      console.error('Error setting last sync time:', error);
    }
  }

  /**
   * Queue task update for later sync
   */
  async queueTaskUpdate(taskId: string, status: string, completedAt?: string): Promise<void> {
    try {
      const pendingUpdates = await this.getOfflineData('pending_task_updates') || [];
      
      pendingUpdates.push({
        task_id: taskId,
        status: status,
        completed_at: completedAt,
        queued_at: new Date().toISOString()
      });
      
      await this.storeOfflineData('pending_task_updates', pendingUpdates);
      
    } catch (error) {
      console.error('Error queueing task update:', error);
    }
  }
}

// Export singleton instance
export const backgroundSyncService = BackgroundSyncService.getInstance();
