package com.dcptaskmanagmentapp.taskmanager;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private NotificationHelper notificationHelper;
    
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Initialize notification helper for local notifications
        notificationHelper = new NotificationHelper(this);
        
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
