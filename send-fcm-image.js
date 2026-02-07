import admin from 'firebase-admin';

// Service account credentials loaded from environment
// Set FIREBASE_SERVICE_ACCOUNT_JSON to the full JSON string of the service account.
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT_JSON environment variable.');
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountJson);

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// FCM Token from your app
const fcmToken = process.env.FCM_TEST_TOKEN;

if (!fcmToken) {
  console.error('Missing FCM_TEST_TOKEN environment variable.');
  process.exit(1);
}

// Image URL
const imageUrl = 'https://images.unsplash.com/photo-1560807707-8cc77767d783?w=400';

async function sendNotificationWithImage() {
  const message = {
    token: fcmToken,
    notification: {
      title: '🖼️ Image Test Notification!',
      body: 'This notification has an image. Tap to view it in the app!',
      imageUrl: imageUrl
    },
    data: {
      title: '🖼️ Image Test Notification!',
      body: 'This notification has an image. Tap to view it in the app!',
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
    console.log('✅ Successfully sent notification:', response);
    console.log('Image URL:', imageUrl);
  } catch (error) {
    console.error('❌ Error sending notification:', error);
  }
}

sendNotificationWithImage();
