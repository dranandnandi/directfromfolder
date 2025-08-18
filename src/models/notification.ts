export enum NotificationType {
  TaskDue = 'task_due',
  TaskAssigned = 'task_assigned',
  TaskUpdated = 'task_updated',
  TaskCompleted = 'task_completed',
  TaskComment = 'task_comment'
}

export interface Notification {
  id: string;
  userId: string;
  taskId: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  scheduledFor?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  type: NotificationType;
  enabled: boolean;
  advanceNotice: string; // PostgreSQL interval as string
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceToken {
  id: string;
  userId: string;
  token: string;
  deviceType: 'android' | 'ios' | 'web';
  createdAt: Date;
  updatedAt: Date;
}