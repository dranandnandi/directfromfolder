/**
 * Send Push Notifications to All Users
 * 
 * This script sends push notifications to all registered devices.
 * 
 * Usage:
 *   node send-notification-to-all.js "Title" "Body" "https://optional-image-url.jpg"
 * 
 * Prerequisites:
 *   1. Run the SQL migration to create device_tokens table
 *   2. Set up Firebase service account secrets in Supabase Edge Functions
 *   3. Deploy the send-push-notification edge function
 * 
 * For direct FCM sending (without edge function):
 *   Uses the FIREBASE_SERVICE_ACCOUNT_JSON environment variable
 */

import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

// ============ CONFIGURATION ============
// Update these with your actual values

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hnyqfasddflqzfibtjjz.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Firebase service account loaded from environment
// Set FIREBASE_SERVICE_ACCOUNT_JSON to the full JSON string of the service account.
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
  process.exit(1);
}

if (!serviceAccountJson) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT_JSON environment variable.');
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountJson);

// ============ INITIALIZATION ============

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============ FUNCTIONS ============

/**
 * Get all active FCM tokens from database
 * Note: Column is 'fcm_token' after running migration (renamed from 'token')
 */
async function getAllTokens() {
  // Try 'fcm_token' first (after migration), fallback to 'token' (original)
  let { data, error } = await supabase
    .from('device_tokens')
    .select('fcm_token, user_id')
    .eq('is_active', true);
  
  // If fcm_token column doesn't exist, try original 'token' column
  if (error && error.message.includes('fcm_token')) {
    const result = await supabase
      .from('device_tokens')
      .select('token, user_id');
    data = result.data?.map(d => ({ fcm_token: d.token, user_id: d.user_id }));
    error = result.error;
  }
  
  if (error) {
    console.error('Error fetching tokens:', error);
    return [];
  }
  
  return data || [];
}

/**
 * Send notification to a single token
 */
async function sendToToken(token, title, body, imageUrl) {
  const message = {
    token,
    notification: {
      title,
      body,
      ...(imageUrl && { imageUrl })
    },
    data: {
      title,
      body,
      ...(imageUrl && { image: imageUrl, imageUrl })
    },
    android: {
      notification: {
        ...(imageUrl && { imageUrl }),
        channelId: 'default'
      }
    }
  };

  try {
    const response = await admin.messaging().send(message);
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message, code: error.code };
  }
}

/**
 * Send notification to all registered devices
 */
async function sendToAll(title, body, imageUrl) {
  console.log('\n📱 Fetching all registered device tokens...');
  
  const tokens = await getAllTokens();
  
  if (tokens.length === 0) {
    console.log('❌ No device tokens found in database');
    console.log('\nMake sure:');
    console.log('1. The device_tokens table exists (run the SQL migration)');
    console.log('2. Users have logged in and registered their tokens');
    return;
  }
  
  console.log(`Found ${tokens.length} device(s) registered\n`);
  console.log('📤 Sending notifications...\n');

  let successCount = 0;
  let failCount = 0;
  const failedTokens = [];

  for (const { fcm_token, user_id } of tokens) {
    const result = await sendToToken(fcm_token, title, body, imageUrl);
    
    if (result.success) {
      successCount++;
      console.log(`✅ Sent to user ${user_id?.substring(0, 8)}...`);
    } else {
      failCount++;
      failedTokens.push(fcm_token);
      console.log(`❌ Failed for user ${user_id?.substring(0, 8)}...: ${result.error}`);
      
      // Mark invalid tokens as inactive
      if (result.code === 'messaging/registration-token-not-registered' ||
          result.code === 'messaging/invalid-registration-token') {
        await supabase
          .from('device_tokens')
          .update({ is_active: false })
          .eq('fcm_token', fcm_token);
        console.log(`   ↳ Token marked as inactive`);
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${successCount} sent, ${failCount} failed`);
  console.log('='.repeat(50));
}

// ============ MAIN ============

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
📱 Send Push Notification to All Users
======================================

Usage:
  node send-notification-to-all.js "Title" "Body" ["Image URL"]

Examples:
  node send-notification-to-all.js "Hello!" "This is a test notification"
  node send-notification-to-all.js "New Feature!" "Check out our latest update" "https://example.com/image.jpg"

Prerequisites:
  1. Run the SQL migration: supabase/migrations/create_device_tokens_table.sql
  2. Users must have logged in and allowed notifications
  `);
  process.exit(1);
}

const [title, body, imageUrl] = args;

console.log('\n📱 Push Notification Sender');
console.log('='.repeat(50));
console.log(`Title: ${title}`);
console.log(`Body: ${body}`);
if (imageUrl) console.log(`Image: ${imageUrl}`);
console.log('='.repeat(50));

sendToAll(title, body, imageUrl).then(() => {
  console.log('\n✨ Done!\n');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
