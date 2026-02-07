# Firebase Cloud Messaging (FCM) Push Notifications Guide

## Overview
This guide documents the complete setup of Firebase Cloud Messaging for a Capacitor-based Android app, including troubleshooting steps and solutions for common issues.

**Tech Stack:** React + Capacitor 7.x + Firebase

---

## Table of Contents
1. [Prerequisites & Installation](#1-prerequisites--installation)
2. [Firebase Console Setup](#2-firebase-console-setup)
3. [Android Configuration](#3-android-configuration)
4. [Capacitor Plugin Setup](#4-capacitor-plugin-setup)
5. [NotificationService Implementation](#5-notificationservice-implementation)
6. [Common Issues & Solutions](#6-common-issues--solutions)
7. [Sending Notifications with Images](#7-sending-notifications-with-images)
8. [Testing Checklist](#8-testing-checklist)

---

## 1. Prerequisites & Installation

### Required Packages
```bash
npm install @capacitor/push-notifications @capacitor/local-notifications @capacitor/dialog
npx cap sync android
```

### Package Versions Used
```json
{
  "@capacitor/push-notifications": "^7.0.2",
  "@capacitor/local-notifications": "^7.0.2",
  "@capacitor/dialog": "^7.0.2",
  "@capacitor/core": "^7.0.1",
  "@capacitor/android": "^7.0.1"
}
```

### For Sending Test Notifications (Dev Only)
```bash
npm install firebase-admin --save-dev
```

---

## 2. Firebase Console Setup

### Step 1: Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Enter project name and follow the wizard

### Step 2: Add Android App
1. In Firebase Console, click "Add app" → Android
2. Enter your package name (find it in `capacitor.config.ts` → `appId` field)
3. Download `google-services.json`
4. Place it in `android/app/google-services.json`

### Step 3: Enable Cloud Messaging API (V1)
1. Go to Project Settings → Cloud Messaging tab
2. Ensure "Firebase Cloud Messaging API (V1)" is **Enabled**
3. Note the Sender ID (you'll need it)

### Step 4: Get Service Account Key (for sending notifications via API)
1. Go to Project Settings → Service accounts tab
2. Click "Generate new private key"
3. Save the JSON file securely (DO NOT commit to git!)

---

## 3. Android Configuration

### android/app/build.gradle
```gradle
plugins {
    id 'com.android.application'
    id 'com.google.gms.google-services'  // Add this line
}

dependencies {
    // Firebase BoM (Bill of Materials) - manages all Firebase versions
    implementation platform('com.google.firebase:firebase-bom:34.6.0')
    
    // Firebase Cloud Messaging
    implementation 'com.google.firebase:firebase-messaging'
    
    // Required for Capacitor
    implementation "androidx.coordinatorlayout:coordinatorlayout:1.2.0"
}
```

### android/build.gradle (Project Level)
```gradle
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.7.2'
        classpath 'com.google.gms:google-services:4.4.2'  // Add this line
    }
}
```

### android/app/src/main/AndroidManifest.xml

**CRITICAL:** Do NOT manually add MessagingService declarations. Let Capacitor's plugin handle it automatically.

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application ...>
        
        <!-- Only add these meta-data tags for FCM configuration -->
        
        <!-- Default notification channel -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="default" />
        
        <!-- Default notification icon (optional) -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@mipmap/ic_launcher" />
        
        <!-- Default notification color (optional) -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_color"
            android:resource="@color/colorPrimary" />
            
        <!-- DO NOT ADD MessagingService manually! -->
        <!-- Capacitor's @capacitor/push-notifications plugin auto-registers it -->
        
    </application>
</manifest>
```

**⚠️ WRONG - Do NOT do this:**
```xml
<!-- This causes ClassNotFoundException crashes! -->
<service android:name="com.getcapacitor.plugin.pushnotifications.MessagingService">
    ...
</service>
```

The correct class is `com.capacitorjs.plugins.pushnotifications.MessagingService` and it's auto-registered by the plugin.

---

## 4. Capacitor Plugin Setup

### capacitor.config.ts
```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourcompany.yourapp',  // Your app's package name
  appName: 'Your App Name',
  webDir: 'dist',
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#488AFF',
      sound: 'beep.wav'
    }
  }
};

export default config;
```

---

## 5. NotificationService Implementation

### src/services/NotificationService.ts

```typescript
import { Capacitor } from '@capacitor/core';
import { 
  PushNotifications, 
  Token, 
  ActionPerformed, 
  PushNotificationSchema 
} from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Dialog } from '@capacitor/dialog';

class NotificationService {
  private pushToken: string | null = null;
  private lastNotification: { 
    title: string; 
    body: string; 
    image?: string; 
    data: any 
  } | null = null;

  /**
   * Initialize push notifications
   */
  async initializePushNotifications(): Promise<void> {
    // Only run on native platforms
    if (!Capacitor.isNativePlatform()) {
      console.log('Push notifications only available on native platforms');
      return;
    }

    try {
      // Request permission
      let permStatus = await PushNotifications.checkPermissions();
      
      if (permStatus.receive === 'prompt') {
        permStatus = await PushNotifications.requestPermissions();
      }

      if (permStatus.receive !== 'granted') {
        console.log('Push notification permission not granted');
        return;
      }

      // Setup listeners BEFORE registering
      this.setupPushNotificationListeners();
      
      // Register with FCM
      await PushNotifications.register();
      
      console.log('Push notifications initialized successfully');
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
    // Handle successful registration - get FCM token
    PushNotifications.addListener('registration', (token: Token) => {
      this.pushToken = token.value;
      console.log('Push registration token: ', token.value);
      // Send token to your backend for targeting this device
      this.sendTokenToBackend(token.value);
    });

    // Handle registration errors
    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('Registration error: ', error.error);
    });

    // Handle notification received while app is in FOREGROUND
    PushNotifications.addListener('pushNotificationReceived', 
      (notification: PushNotificationSchema) => {
        console.log('Push notification received in foreground: ', 
          JSON.stringify(notification));
        
        // Extract image from data payload
        const data = notification.data || {};
        const image = data.image || data.imageUrl || data.picture || '';
        
        // Show as local notification (since system won't show it in foreground)
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
      }
    );

    // Handle notification TAP (app was in background/killed)
    PushNotifications.addListener('pushNotificationActionPerformed', 
      (action: ActionPerformed) => {
        console.log('Push notification tapped: ', JSON.stringify(action));
        
        const notification = action.notification;
        const data = notification.data || {};
        
        // Extract content from multiple possible sources
        // FCM doesn't pass title/body when tapped from background!
        const title = notification.title || data.title || 
                      data.notificationTitle || data.originalTitle || '';
        const body = notification.body || data.body || 
                     data.notificationBody || data.originalBody || data.message || '';
        
        // Extract image URL from various possible locations
        const image = data.image || data.imageUrl || data.picture || 
                      data.fcm_options?.image || data.notification?.image || '';
        
        console.log('Extracted - Title:', title, 'Body:', body, 'Image:', image);
        
        // Store for later access
        this.lastNotification = {
          title: title || 'Notification',
          body: body,
          image: image,
          data: data
        };
        
        // Dispatch event for app to handle
        window.dispatchEvent(new CustomEvent('pushNotificationTapped', { 
          detail: this.lastNotification 
        }));
        
        // Handle the tap
        this.handleNotificationTap(data, title, body, image);
      }
    );
  }

  /**
   * Setup local notification listeners
   */
  private setupLocalNotificationListeners(): void {
    LocalNotifications.addListener('localNotificationReceived', (notification) => {
      console.log('Local notification received: ', notification);
    });

    LocalNotifications.addListener('localNotificationActionPerformed', 
      (notificationAction) => {
        console.log('Local notification action performed: ', notificationAction);
        const extra = notificationAction.notification.extra || {};
        this.handleNotificationTap(extra, extra.title, extra.body, extra.image);
      }
    );
  }

  /**
   * Show local notification (for foreground display)
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
   * Handle notification tap - navigate or show content
   */
  private handleNotificationTap(
    data: any, 
    title?: string, 
    body?: string, 
    image?: string
  ): void {
    console.log('Handling notification tap:', { title, body, image, data });
    
    // Check for specific notification types and navigate
    if (data?.type) {
      if (data.type === 'task_overdue') {
        window.location.href = `/tasks/${data.task_id}`;
        return;
      } else if (data.type === 'task_reminder') {
        window.location.href = '/tasks';
        return;
      }
      // Add more types as needed
    }
    
    // For generic notifications - show content
    setTimeout(async () => {
      const hasContent = (title && title.trim()) || (body && body.trim());
      const hasImage = image && image.trim();
      
      // If there's an image, dispatch event for custom modal display
      if (hasImage) {
        window.dispatchEvent(new CustomEvent('showNotificationModal', {
          detail: { title: title || 'Notification', body: body || '', image }
        }));
        return;
      }
      
      // Otherwise show simple dialog
      try {
        await Dialog.alert({
          title: hasContent ? (title || 'Notification') : 'Notification received!',
          message: hasContent ? (body || '') : 
            'Notification content not available. For full content, include data in the notification payload.',
          buttonTitle: 'OK'
        });
      } catch (e) {
        console.log('Dialog error, falling back to alert:', e);
        if (hasContent) {
          alert(`${title || 'Notification'}\n\n${body || ''}`);
        }
      }
    }, 300);
  }

  /**
   * Send token to backend for push targeting
   */
  private async sendTokenToBackend(token: string): Promise<void> {
    try {
      console.log('Sending token to backend:', token);
      // Example: Save to Supabase user_devices table
      // await supabase.from('user_devices').upsert({
      //   user_id: currentUserId,
      //   device_token: token,
      //   platform: Capacitor.getPlatform(),
      //   updated_at: new Date().toISOString()
      // });
    } catch (error) {
      console.error('Error sending token to backend:', error);
    }
  }

  /**
   * Get the push token
   */
  getPushToken(): string | null {
    return this.pushToken;
  }

  /**
   * Get last received notification
   */
  getLastNotification() {
    return this.lastNotification;
  }
}

export const notificationService = new NotificationService();
```

---

## 6. Common Issues & Solutions

### Issue 1: App Crashes with ClassNotFoundException
**Error:**
```
java.lang.ClassNotFoundException: Didn't find class 
"com.getcapacitor.plugin.pushnotifications.MessagingService"
```

**Cause:** Manual MessagingService declaration in AndroidManifest.xml with wrong package name.

**Solution:** Remove any manual `<service>` declarations for MessagingService. Let Capacitor auto-register it.

---

### Issue 2: "No listeners found for event pushNotificationReceived"
**Cause:** Notification listeners not initialized before the app receives notifications.

**Solution:** Call `notificationService.initializePushNotifications()` early in app startup.

```typescript
// In App.tsx or a hook
import { useMobileApp } from './hooks/useMobileApp';

function App() {
  useMobileApp(); // Initialize on mount
  // ...
}
```

```typescript
// src/hooks/useMobileApp.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { notificationService } from '../services/NotificationService';

export function useMobileApp() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      notificationService.initializePushNotifications();
      notificationService.initializeLocalNotifications();
    }
  }, []);
}
```

---

### Issue 3: Empty Title/Body When Tapping Background Notification
**Cause:** FCM limitation - when Android system shows the notification (app in background), clicking it only passes the `data` payload to the app, not the `notification` fields.

**Solution:** Always include title/body/image in BOTH `notification` AND `data` payloads:

```json
{
  "message": {
    "token": "FCM_TOKEN",
    "notification": {
      "title": "My Title",
      "body": "My Body",
      "image": "https://example.com/image.jpg"
    },
    "data": {
      "title": "My Title",
      "body": "My Body", 
      "image": "https://example.com/image.jpg"
    }
  }
}
```

---

### Issue 4: JavaScript alert() Not Showing
**Cause:** Native WebView may block JS alerts.

**Solution:** Use Capacitor's Dialog plugin instead:

```typescript
import { Dialog } from '@capacitor/dialog';

await Dialog.alert({
  title: 'Notification',
  message: 'Your message here',
  buttonTitle: 'OK'
});
```

---

### Issue 5: Notification ID Too Large
**Error:** `Capacitor/LocalNotifications: invalid notification id`

**Cause:** `Date.now()` returns a number larger than Java's int max value.

**Solution:** Use modulo to keep ID within int range:
```typescript
const notificationId = Math.abs(Date.now() % 2147483647);
```

---

### Issue 6: FCM Token Invalid
**Cause:** Token changes when app is reinstalled or cleared data.

**Solution:** Always get fresh token from logs after reinstall:
```powershell
adb logcat -d | Select-String "Push registration token"
```

---

## 7. Sending Notifications with Images

### Using Firebase Admin SDK (Node.js)

#### Step 1: Get Service Account Key
1. Go to [Firebase Console](https://console.firebase.google.com/) → Your Project
2. Click ⚙️ (Settings) → **Project Settings**
3. Go to **Service accounts** tab
4. Click **"Generate new private key"**
5. Save the downloaded JSON file securely

#### Step 2: Get FCM Token from Device
Run this command while your app is running on the device:
```powershell
adb logcat -d | Select-String "Push registration token"
```
Copy the token value from the output.

#### Step 3: Create Send Script

Create `send-fcm-notification.js`:

```javascript
import admin from 'firebase-admin';

// Load service account from downloaded JSON file
// Option 1: Import the JSON file directly
// import serviceAccount from './your-service-account-key.json' assert { type: 'json' };

// Option 2: Paste the contents (for quick testing only - don't commit this!)
const serviceAccount = {
  "type": "service_account",
  "project_id": "YOUR_PROJECT_ID",           // From Firebase Console
  "private_key_id": "...",                    // From downloaded JSON
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxx@YOUR_PROJECT_ID.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/...",
  "universe_domain": "googleapis.com"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// FCM Token - get this from device logs (see Step 2 above)
const fcmToken = 'PASTE_YOUR_FCM_TOKEN_HERE';

// Image URL (must be HTTPS, < 1MB recommended)
const imageUrl = 'https://example.com/your-image.jpg';

async function sendNotification() {
  const message = {
    token: fcmToken,
    notification: {
      title: '🖼️ Image Notification!',
      body: 'This notification has an image.',
      imageUrl: imageUrl
    },
    data: {
      // IMPORTANT: Duplicate title/body/image here!
      // FCM doesn't pass notification fields when tapped from background
      title: '🖼️ Image Notification!',
      body: 'This notification has an image.',
      image: imageUrl,
      imageUrl: imageUrl
    },
    android: {
      notification: {
        imageUrl: imageUrl,
        channelId: 'default'
      }
    }
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Sent:', response);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

sendNotification();
```

Run with:
```bash
node send-fcm-notification.js
```

### Where to Find Required Values

| Value | Where to Find |
|-------|---------------|
| `project_id` | Firebase Console → Project Settings → General tab |
| `client_email` | Downloaded service account JSON file |
| `private_key` | Downloaded service account JSON file |
| `FCM Token` | Device logs: `adb logcat -d \| Select-String "Push registration token"` |
| `Package Name` | `capacitor.config.ts` → `appId` field |
| `Sender ID` | Firebase Console → Project Settings → Cloud Messaging tab |

### Key Points for Images:
1. Image URL must be HTTPS
2. Image should be < 1MB for best results
3. Include `image` in BOTH `notification` and `data` payloads
4. For background notifications, only `data.image` reaches your app when tapped

---

## 8. Testing Checklist

### Before Testing
- [ ] `google-services.json` is in `android/app/`
- [ ] Firebase project has Cloud Messaging API (V1) enabled
- [ ] App is built and deployed: `npm run build && npx cap sync android && npx cap run android`

### Test Cases

#### ✅ Foreground Notification
1. Keep app open in foreground
2. Send notification via API or Firebase Console
3. **Expected:** Local notification appears, can be tapped

#### ✅ Background Notification  
1. Put app in background (press home)
2. Send notification
3. **Expected:** System notification appears with image (if included)
4. Tap notification
5. **Expected:** App opens, shows notification content/modal

#### ✅ Killed App Notification
1. Force close the app
2. Send notification
3. **Expected:** System notification appears
4. Tap notification
5. **Expected:** App launches and shows content

#### ✅ Notification with Image
1. Send notification with image URL in data payload
2. **Expected:** Image shows in notification banner
3. Tap notification
4. **Expected:** Modal opens with image displayed

### Debugging Commands
```powershell
# Get FCM token from device
adb logcat -d | Select-String "Push registration token"

# Watch for notification events
adb logcat | Select-String "Push notification|FCM|Capacitor"

# Clear app data (will generate new FCM token)
adb shell pm clear com.your.package.name
```

---

## Files Modified/Created

| File | Purpose |
|------|---------|
| `android/app/build.gradle` | Firebase dependencies |
| `android/build.gradle` | Google services plugin |
| `android/app/src/main/AndroidManifest.xml` | FCM metadata (no manual services!) |
| `android/app/google-services.json` | Firebase config |
| `src/services/NotificationService.ts` | Push notification handling |
| `src/hooks/useMobileApp.ts` | Initialize notifications on app start |
| `src/components/NotificationModal.tsx` | Display notifications with images |
| `src/App.tsx` | Import NotificationModal |
| `send-fcm-notification.js` | Test script for sending notifications (don't commit!) |

---

## Security Notes

⚠️ **Never commit these files to git:**
- Service account JSON files (`*-firebase-adminsdk-*.json`)
- `google-services.json` (add to `.gitignore` if open source)

Add to `.gitignore`:
```
# Firebase - NEVER commit these!
*-firebase-adminsdk-*.json
firebase-service-account*.json
google-services.json
send-fcm-notification.js
```

---

## Summary

The key learnings from this implementation:

1. **Don't manually register MessagingService** - Capacitor does it automatically
2. **Initialize listeners early** - Before any notifications can arrive
3. **Duplicate content in data payload** - FCM doesn't pass notification fields when tapped from background
4. **Use Dialog plugin** - Native alerts are more reliable than JS alerts
5. **Keep notification IDs in int range** - Use modulo with `Date.now()`
6. **Use FCM V1 API** - Legacy API is deprecated

This guide should help you set up push notifications in any Capacitor-based Android app!
