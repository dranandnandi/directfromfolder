// Give the service worker access to Firebase Messaging.
// Note that you can only use Firebase Messaging here. Other Firebase libraries
// are not available in the service worker.
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker by passing in
// your app's Firebase config object.
firebase.initializeApp({
  apiKey: "AIzaSyBtSuprkQOWyeUkZ58xkIgIRu4vhGqU7Oo",
  authDomain: "dcp-task-management-app.firebaseapp.com",
  projectId: "dcp-task-management-app",
  storageBucket: "dcp-task-management-app.firebasestorage.app",
  messagingSenderId: "546725050222",
  appId: "1:546725050222:web:14ebb5d82f128c17d7f37f",
  measurementId: "G-92L1W4ZLWR"
});

// Retrieve an instance of Firebase Messaging so that it can handle background messages.
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);

  const notificationTitle = payload.notification?.title || 'New Notification';
  const notificationOptions = {
    body: payload.notification?.body,
    icon: '/notification-icon.svg',
    badge: '/notification-icon.svg',
    tag: payload.data?.tag || 'default',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});