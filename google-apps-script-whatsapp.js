const SUPABASE_URL = 'https://hnyqfasddflqzfibtjjz.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhueXFmYXNkZGZscXpmaWJ0amp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzcxMDE2MjMsImV4cCI6MjA1MjY3NzYyM30.-_s-UcAgjJqS6mGMBUXsJ8Iiw8fYYGIe2kwx387RRu0';
const SHEET_NAME = 'Sheet1';
const WHATSAPP_API_ENDPOINT = 'http://134.209.145.186:3001/api/send-message'; // Correct endpoint

function fetchLatestNotification() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();

  // Add basic headers if sheet is empty
  if (lastRow === 0) {
    sheet.appendRow([
      'id', 'user_id', 'task_id', 'type', 'title', 'message', 'read', 'scheduled_for', 
      'created_at', 'updated_at', 'whatsapp_number', 'ai_generated_message', 
      'whatsapp_sent', 'whatsapp_sent_at'
    ]);
    Logger.log('Added headers to empty sheet');
  }

  // Get last ID from sheet (assumes first column is ID)
  const lastId = lastRow > 1 ? sheet.getRange(lastRow, 1).getValue() : null;

  // Simple query using the new org status columns
  const query = `notifications?select=*&org_whatsapp_enabled=eq.true&org_auto_alerts_enabled=eq.true&whatsapp_number=not.is.null&ai_generated_message=not.is.null&whatsapp_sent=eq.false&order=created_at.desc&limit=50`;

  const response = UrlFetchApp.fetch(`${SUPABASE_URL}${query}`, {
    method: 'get',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  const data = JSON.parse(response.getContentText());
  Logger.log(`Found ${data.length} notifications for WhatsApp-enabled organizations`);
  
  if (data.length === 0) {
    Logger.log('No new notifications for WhatsApp-enabled organizations.');
    return;
  }

  // Process new notifications
  let newCount = 0;
  for (const n of data) {
    // Skip if this notification is already in the sheet
    if (n.id === lastId) break;
    
    // Check if we already have this notification
    const existingData = sheet.getDataRange().getValues();
    const exists = existingData.some(row => row[0] === n.id);
    if (exists) continue;

    // Append new notification - keep it simple with original columns
    sheet.appendRow([
      n.id,
      n.user_id,
      n.task_id,
      n.type,
      n.title,
      n.message,
      n.read,
      n.scheduled_for,
      n.created_at,
      n.updated_at,
      n.whatsapp_number,
      n.ai_generated_message,
      n.whatsapp_sent,
      n.whatsapp_sent_at
    ]);
    newCount++;
  }

  Logger.log(`Added ${newCount} new notifications for WhatsApp processing.`);
}

// Function to send WhatsApp messages for pending notifications
function sendPendingWhatsAppMessages() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) {
    Logger.log('No data rows in sheet. Run fetchLatestNotification() first.');
    return; // No data rows
  }
  
  const headers = data[0];
  const rows = data.slice(1);
  
  // Find column indexes for existing columns only
  const idCol = Math.max(0, headers.indexOf('id'));
  const phoneCol = Math.max(10, headers.indexOf('whatsapp_number'));
  const messageCol = Math.max(11, headers.indexOf('ai_generated_message'));
  const whatsappSentCol = Math.max(12, headers.indexOf('whatsapp_sent'));
  
  Logger.log(`Column indexes - ID: ${idCol}, Phone: ${phoneCol}, Message: ${messageCol}, WhatsApp Sent: ${whatsappSentCol}`);
  Logger.log(`Total rows to process: ${rows.length}`);
  
  let processed = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const whatsappSent = row[whatsappSentCol];
    
    Logger.log(`Row ${i + 1}: WhatsApp Sent = '${whatsappSent}', Phone = '${row[phoneCol]}', Message length = ${row[messageCol] ? row[messageCol].length : 0}`);
    
    // Skip if already sent
    if (whatsappSent === true || whatsappSent === 'TRUE' || whatsappSent === 'true') {
      Logger.log(`Skipping row ${i + 1}: Already sent`);
      continue;
    }
    
    const notificationId = row[idCol];
    const phoneNumber = row[phoneCol];
    const message = row[messageCol];
    
    if (!phoneNumber || !message) {
      Logger.log(`Skipping row ${i + 1}: Missing phone (${!!phoneNumber}) or message (${!!message})`);
      continue;
    }
    
    try {
      // Format phone number: 91 + last 10 digits only
      let formattedPhone = phoneNumber.toString().replace(/[\s\-\(\)]/g, ''); // Remove spaces, dashes, parentheses
      
      // Get only the last 10 digits
      if (formattedPhone.length >= 10) {
        const last10Digits = formattedPhone.slice(-10); // Get last 10 digits
        formattedPhone = '91' + last10Digits; // Always format as 91 + 10 digits
      } else {
        Logger.log(`❌ Invalid phone number - less than 10 digits: ${phoneNumber}`);
        continue;
      }
      
      Logger.log(`📱 Formatted phone: ${phoneNumber} -> ${formattedPhone}`);
      
      // Send WhatsApp message using correct endpoint and payload
      const response = UrlFetchApp.fetch(WHATSAPP_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify({
          phoneNumber: formattedPhone,
          message: message,
          patientName: "Task Manager User",
          testName: "Task Notification"
        }),
        muteHttpExceptions: true
      });
      
      Logger.log(`Response code: ${response.getResponseCode()}`);
      Logger.log(`Response text: ${response.getContentText()}`);
      
      if (response.getResponseCode() === 200) {
        // Update whatsapp_sent to true in sheet
        sheet.getRange(i + 2, whatsappSentCol + 1).setValue(true);
        
        // Update Supabase notification
        updateSupabaseNotification(notificationId, true);
        
        Logger.log(`✅ WhatsApp sent to ${formattedPhone} for notification ${notificationId}`);
        processed++;
      } else {
        Logger.log(`❌ Failed to send WhatsApp to ${formattedPhone}: ${response.getContentText()}`);
      }
      
    } catch (error) {
      Logger.log(`❌ Error sending WhatsApp for notification ${notificationId}: ${error.toString()}`);
    }
    
    // Add small delay to avoid rate limiting
    if (processed > 0 && processed % 5 === 0) {
      Utilities.sleep(1000); // 1 second pause every 5 messages
    }
  }
  
  Logger.log(`Processed ${processed} WhatsApp messages.`);
}

// Function to update Supabase notification status
function updateSupabaseNotification(notificationId, sent) {
  try {
    const response = UrlFetchApp.fetch(`${SUPABASE_URL}notifications?id=eq.${notificationId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      payload: JSON.stringify({
        whatsapp_sent: sent,
        whatsapp_sent_at: sent ? new Date().toISOString() : null
      })
    });
    
    if (response.getResponseCode() !== 204) {
      Logger.log(`Failed to update notification ${notificationId} in Supabase`);
    }
  } catch (error) {
    Logger.log(`Error updating Supabase for notification ${notificationId}: ${error.toString()}`);
  }
}

// Combined function to fetch and process WhatsApp notifications
function processWhatsAppNotifications() {
  Logger.log('Starting WhatsApp notification processing...');
  
  // First fetch latest notifications
  fetchLatestNotification();
  
  // Then send pending messages
  sendPendingWhatsAppMessages();
  
  Logger.log('WhatsApp notification processing complete.');
}

// Function to setup time-based triggers
function setupTriggers() {
  // Delete existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  
  // Combined function to fetch and send every 2 minutes
  ScriptApp.newTrigger('processWhatsAppNotifications')
    .timeBased()
    .everyMinutes(2)
    .create();
  
  Logger.log('Trigger setup complete: processWhatsAppNotifications (every 2 minutes)');
}

// Function to reset WhatsApp sent status for testing
function resetWhatsAppStatus() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) {
    Logger.log('No data rows in sheet.');
    return;
  }
  
  const headers = data[0];
  const whatsappSentCol = Math.max(12, headers.indexOf('whatsapp_sent'));
  
  // Reset all whatsapp_sent to false
  for (let i = 2; i <= data.length; i++) {
    sheet.getRange(i, whatsappSentCol + 1).setValue(false);
  }
  
  Logger.log(`Reset whatsapp_sent status for ${data.length - 1} notifications`);
}

// Manual function to test the setup
function testSetup() {
  Logger.log('Testing notification fetch...');
  fetchLatestNotification();
  
  Logger.log('Testing WhatsApp sending...');
  sendPendingWhatsAppMessages();
  
  Logger.log('Test complete. Check the logs and your sheet.');
}
