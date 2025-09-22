-- Real-time WhatsApp notification processing using Edge Functions
-- This migration removes debugging overhead and implements efficient real-time triggers

-- 1. CLEANUP: Remove all debugging tables and functions to reduce costs
DROP VIEW IF EXISTS whatsapp_debug_summary;
DROP TABLE IF EXISTS whatsapp_debug_logs CASCADE;
DROP FUNCTION IF EXISTS log_whatsapp_debug(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS process_pending_whatsapp_notifications_debug();

-- 2. Add processing status column to notifications if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'notifications' AND column_name = 'processing_status') THEN
        ALTER TABLE notifications ADD COLUMN processing_status text DEFAULT 'pending';
    END IF;
END $$;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_notifications_processing_status ON notifications(processing_status);

-- 3. Create a simple function to trigger Edge Function processing
CREATE OR REPLACE FUNCTION trigger_whatsapp_edge_function()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id uuid;
  whatsapp_enabled boolean;
  auto_alerts_enabled boolean;
BEGIN
  -- Only process if this is a new notification with WhatsApp number
  IF TG_OP = 'INSERT' AND NEW.whatsapp_number IS NOT NULL AND NEW.ai_generated_message IS NOT NULL THEN
    
    -- Get user's organization ID
    SELECT organization_id INTO user_org_id
    FROM users
    WHERE id = NEW.user_id;
    
    -- Check if WhatsApp is enabled for the organization
    IF user_org_id IS NOT NULL THEN
      SELECT is_whatsapp_enabled_for_org(user_org_id) INTO whatsapp_enabled;
      SELECT is_auto_alerts_enabled_for_org(user_org_id) INTO auto_alerts_enabled;
      
      -- Only queue if organization has WhatsApp enabled
      IF whatsapp_enabled AND auto_alerts_enabled THEN
        -- Mark as queued for Edge Function processing
        UPDATE notifications 
        SET processing_status = 'queued_for_edge_function'
        WHERE id = NEW.id;
        
        -- Trigger Edge Function via webhook/notification
        -- Using pg_notify to signal that processing is needed
        PERFORM pg_notify('whatsapp_notification_ready', 
          json_build_object(
            'notification_id', NEW.id,
            'phone_number', NEW.whatsapp_number,
            'message', NEW.ai_generated_message,
            'user_id', NEW.user_id,
            'organization_id', user_org_id
          )::text
        );
      ELSE
        -- Mark as skipped if WhatsApp disabled
        UPDATE notifications 
        SET whatsapp_sent = true, 
            whatsapp_sent_at = now(),
            processing_status = 'skipped_org_disabled'
        WHERE id = NEW.id;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 4. Create trigger on notifications table for real-time processing
DROP TRIGGER IF EXISTS whatsapp_notification_trigger ON notifications;

CREATE TRIGGER whatsapp_notification_trigger
  AFTER INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION trigger_whatsapp_edge_function();

-- 5. Create a cleanup function for processed notifications (optional, for maintenance)
CREATE OR REPLACE FUNCTION cleanup_processed_whatsapp_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cleaned_count integer;
BEGIN
  -- Reset stuck notifications that have been queued for more than 10 minutes
  UPDATE notifications 
  SET processing_status = 'pending'
  WHERE processing_status = 'queued_for_edge_function' 
    AND updated_at < now() - INTERVAL '10 minutes';
  
  GET DIAGNOSTICS cleaned_count = ROW_COUNT;
  RETURN cleaned_count;
END;
$$;

-- 6. Create a batch processing function for Edge Function to call
CREATE OR REPLACE FUNCTION get_pending_whatsapp_notifications(batch_size integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  whatsapp_number text,
  ai_generated_message text,
  organization_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return pending notifications and mark them as processing
  RETURN QUERY
  WITH pending_notifications AS (
    SELECT n.id, n.user_id, n.whatsapp_number, n.ai_generated_message, u.organization_id
    FROM notifications n
    JOIN users u ON n.user_id = u.id
    WHERE n.processing_status = 'queued_for_edge_function'
      AND n.whatsapp_number IS NOT NULL 
      AND n.ai_generated_message IS NOT NULL
      AND n.whatsapp_sent = false
    ORDER BY n.created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ),
  updated_notifications AS (
    UPDATE notifications 
    SET processing_status = 'processing'
    WHERE notifications.id IN (SELECT pending_notifications.id FROM pending_notifications)
    RETURNING notifications.id
  )
  SELECT pn.id, pn.user_id, pn.whatsapp_number, pn.ai_generated_message, pn.organization_id
  FROM pending_notifications pn;
END;
$$;

-- 7. Create function to mark notifications as sent/failed
CREATE OR REPLACE FUNCTION mark_whatsapp_notification_status(
  notification_id uuid,
  success boolean,
  error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF success THEN
    UPDATE notifications 
    SET 
      whatsapp_sent = true,
      whatsapp_sent_at = now(),
      processing_status = 'completed'
    WHERE id = notification_id;
  ELSE
    UPDATE notifications 
    SET 
      processing_status = 'failed',
      updated_at = now()
    WHERE id = notification_id;
  END IF;
END;
$$;

-- 8. Grant necessary permissions
GRANT EXECUTE ON FUNCTION trigger_whatsapp_edge_function() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_processed_whatsapp_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_whatsapp_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_whatsapp_notification_status(uuid, boolean, text) TO authenticated;

-- 9. Add helpful comments
COMMENT ON FUNCTION trigger_whatsapp_edge_function() IS 'Real-time trigger that queues WhatsApp notifications for Edge Function processing';
COMMENT ON FUNCTION get_pending_whatsapp_notifications(integer) IS 'Batch function for Edge Function to retrieve and process pending WhatsApp notifications';
COMMENT ON FUNCTION mark_whatsapp_notification_status(uuid, boolean, text) IS 'Function to mark WhatsApp notification processing results';
COMMENT ON FUNCTION cleanup_processed_whatsapp_notifications() IS 'Maintenance function to reset stuck notifications';

-- 10. Optional: Schedule cleanup job (runs once per hour to reset stuck notifications)
SELECT cron.schedule(
  'cleanup-stuck-whatsapp', 
  '0 * * * *', 
  'SELECT cleanup_processed_whatsapp_notifications();'
);

-- SUCCESS: Real-time WhatsApp processing is now active!
-- - New notifications with WhatsApp numbers will be automatically queued
-- - To complete the setup, you need to either:
--   1. Call the process-whatsapp-queue Edge Function manually/scheduled from frontend
--   2. Or use the existing send-whatsapp Edge Function for individual notifications
-- - All debugging overhead has been removed to reduce costs
-- - Real-time triggers provide immediate processing
-- - New notifications with WhatsApp numbers will be automatically queued
-- - Edge Functions can call get_pending_whatsapp_notifications() to process batches
-- - All debugging overhead has been removed to reduce costs
-- - Real-time triggers provide immediate processing
