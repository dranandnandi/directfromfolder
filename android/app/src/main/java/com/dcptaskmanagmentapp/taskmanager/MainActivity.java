package com.dcptaskmanagmentapp.taskmanager;

import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "FCM";
    private NotificationHelper notificationHelper;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Initialize notification helper for local notifications
        notificationHelper = new NotificationHelper(this);

        // Get and log FCM token for debugging
        FirebaseMessaging.getInstance().getToken()
            .addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    Log.w(TAG, "Fetching FCM registration token failed", task.getException());
                    return;
                }

                // Get new FCM registration token
                String token = task.getResult();
                Log.d(TAG, "========================================");
                Log.d(TAG, "FCM Token: " + token);
                Log.d(TAG, "========================================");
            });

        // Register additional plugins if needed
        // Any manual plugin registration can be done here
    }

    /**
     * Get notification helper instance for use in plugins
     */
    public NotificationHelper getNotificationHelper() {
        return notificationHelper;
    }
}
