package com.dcptaskmanagmentapp.taskmanager;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * NotificationHelper - Manages notification channels and display for Task Manager
 * Integrates with backend WhatsApp/SMS system by providing local notification support
 */
public class NotificationHelper {

    private static final String CHANNEL_ID_GENERAL = "task_manager_general";
    private static final String CHANNEL_ID_URGENT = "task_manager_urgent";
    private static final String CHANNEL_ID_REMINDERS = "task_manager_reminders";

    private Context context;
    private NotificationManagerCompat notificationManager;

    public NotificationHelper(Context context) {
        this.context = context;
        this.notificationManager = NotificationManagerCompat.from(context);
        createNotificationChannels();
    }

    /**
     * Create notification channels for different types of notifications
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // General notifications channel
            NotificationChannel generalChannel = new NotificationChannel(
                CHANNEL_ID_GENERAL,
                "General Notifications",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            generalChannel.setDescription("General task manager notifications");

            // Urgent notifications channel
            NotificationChannel urgentChannel = new NotificationChannel(
                CHANNEL_ID_URGENT,
                "Urgent Notifications",
                NotificationManager.IMPORTANCE_HIGH
            );
            urgentChannel.setDescription("Urgent task alerts and overdue notifications");
            urgentChannel.enableVibration(true);
            urgentChannel.setVibrationPattern(new long[]{100, 200, 300, 400, 500, 400, 300, 200, 400});

            // Reminder notifications channel
            NotificationChannel reminderChannel = new NotificationChannel(
                CHANNEL_ID_REMINDERS,
                "Task Reminders",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            reminderChannel.setDescription("Task deadline reminders and scheduled alerts");

            NotificationManager manager = context.getSystemService(NotificationManager.class);
            manager.createNotificationChannel(generalChannel);
            manager.createNotificationChannel(urgentChannel);
            manager.createNotificationChannel(reminderChannel);
        }
    }

    /**
     * Show general notification
     */
    public void showGeneralNotification(String title, String message, int notificationId) {
        showNotification(title, message, notificationId, CHANNEL_ID_GENERAL, false);
    }

    /**
     * Show urgent notification with high priority
     */
    public void showUrgentNotification(String title, String message, int notificationId) {
        showNotification(title, message, notificationId, CHANNEL_ID_URGENT, true);
    }

    /**
     * Show task reminder notification
     */
    public void showReminderNotification(String title, String message, int notificationId) {
        showNotification(title, message, notificationId, CHANNEL_ID_REMINDERS, false);
    }

    /**
     * Show notification with specified channel and priority
     */
    private void showNotification(String title, String message, int notificationId, String channelId, boolean isUrgent) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_icon_config_sample)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(isUrgent ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true);

        // Add vibration for urgent notifications
        if (isUrgent) {
            builder.setVibrate(new long[]{100, 200, 300, 400, 500, 400, 300, 200, 400});
        }

        notificationManager.notify(notificationId, builder.build());
    }

    /**
     * Cancel specific notification
     */
    public void cancelNotification(int notificationId) {
        notificationManager.cancel(notificationId);
    }

    /**
     * Cancel all notifications
     */
    public void cancelAllNotifications() {
        notificationManager.cancelAll();
    }

    /**
     * Check if notifications are enabled
     */
    public boolean areNotificationsEnabled() {
        return notificationManager.areNotificationsEnabled();
    }
}
