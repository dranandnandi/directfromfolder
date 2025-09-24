-- Disable all WhatsApp Edge Functions by dropping triggers and functions

-- 1. Drop ALL WhatsApp triggers first (including variations)
DROP TRIGGER IF EXISTS send_whatsapp_notification_trigger ON notifications;
DROP TRIGGER IF EXISTS whatsapp_notification_trigger ON notifications;
DROP TRIGGER IF EXISTS process_whatsapp_batch_trigger ON notifications;

-- 2. Drop only Edge Function triggers and processing functions (keep utility functions)
DROP FUNCTION IF EXISTS send_whatsapp_via_edge_function() CASCADE;
DROP FUNCTION IF EXISTS trigger_whatsapp_edge_function() CASCADE;
DROP FUNCTION IF EXISTS process_whatsapp_batch() CASCADE;
DROP FUNCTION IF EXISTS process_pending_whatsapp_notifications() CASCADE;
DROP FUNCTION IF EXISTS process_failed_whatsapp_notifications() CASCADE;
DROP FUNCTION IF EXISTS cleanup_processed_whatsapp_notifications() CASCADE;

-- Keep these utility functions as they might be useful for message creation:
-- generate_whatsapp_message_for_task() - for generating message content
-- create_whatsapp_notification() - for creating notifications
-- is_whatsapp_enabled_for_org() - for checking org settings
-- get_org_whatsapp_settings() - for getting org configuration  
-- get_org_whatsapp_endpoint() - for API endpoints
-- mark_whatsapp_message_sent() - for marking messages as sent
-- get_unsent_whatsapp_messages() - for getting unsent messages
-- mark_whatsapp_notification_status() - for status updates
-- get_pending_whatsapp_notifications() - for getting pending messages

-- 5. Optional: Set all organizations' WhatsApp to disabled temporarily
-- Uncomment the line below if you want to disable all WhatsApp at org level
-- UPDATE organizations SET whatsapp_enabled = false;

-- 6. Optional: Mark all unsent notifications as sent to stop processing
-- Uncomment the line below if you want to mark all as sent
-- UPDATE notifications SET whatsapp_sent = true WHERE whatsapp_sent = false;

-- Verify what triggers remain
SELECT 
    trigger_name, 
    event_object_table, 
    action_statement 
FROM information_schema.triggers 
WHERE trigger_name LIKE '%whatsapp%' OR action_statement LIKE '%whatsapp%';

-- Verify what functions remain
SELECT 
    routine_name, 
    routine_type 
FROM information_schema.routines 
WHERE routine_name LIKE '%whatsapp%' 
AND routine_schema = 'public';
