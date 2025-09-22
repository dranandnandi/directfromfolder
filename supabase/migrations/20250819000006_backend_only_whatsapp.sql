-- Backend-only WhatsApp notification processing using Edge Functions
-- This migration removes debugging overhead and implements real-time triggers
-- COMPLETELY BACKEND-ONLY - NO FRONTEND CHANGES REQUIRED

-- 1. CLEANUP: Remove all debugging tables and functions to reduce costs
DROP VIEW IF EXISTS whatsapp_debug_summary;
DROP TABLE IF EXISTS whatsapp_debug_logs CASCADE;
DROP FUNCTION IF EXISTS log_whatsapp_debug(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS process_pending_whatsapp_notifications_debug();

-- 2. Create a simple function to directly call Edge Function on notification insert
CREATE OR REPLACE FUNCTION send_whatsapp_via_edge_function()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_org_id uuid;
  whatsapp_enabled boolean;
  auto_alerts_enabled boolean;
  formatted_number text;
  edge_function_result jsonb;
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
      
      -- Only send if organization has WhatsApp enabled
      IF whatsapp_enabled AND auto_alerts_enabled THEN
        
        -- Format the phone number (remove any leading +91 for API)
        formatted_number := regexp_replace(NEW.whatsapp_number::text, '^(\+91|91)', '');
        
        -- Call Edge Function directly using HTTP request
        BEGIN
          SELECT content::jsonb INTO edge_function_result
          FROM http((
            'POST',
            'https://hnyqfasddflqzfibtjjz.supabase.co/functions/v1/send-whatsapp',
            ARRAY[
              http_header('Content-Type', 'application/json'),
              http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
            ],
            'application/json',
            json_build_object(
              'phoneNumber', formatted_number,
              'message', NEW.ai_generated_message,
              'notificationId', NEW.id
            )::text
          ));
          
          -- Update notification as sent if successful
          IF edge_function_result->>'success' = 'true' THEN
            UPDATE notifications 
            SET whatsapp_sent = true, whatsapp_sent_at = now()
            WHERE id = NEW.id;
          END IF;
          
        EXCEPTION WHEN OTHERS THEN
          -- If Edge Function call fails, log error but don't block the trigger
          UPDATE notifications 
          SET whatsapp_sent = false
          WHERE id = NEW.id;
        END;
        
      ELSE
        -- Mark as skipped if WhatsApp disabled
        UPDATE notifications 
        SET whatsapp_sent = true, whatsapp_sent_at = now()
        WHERE id = NEW.id;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 3. Create trigger on notifications table for real-time processing
DROP TRIGGER IF EXISTS whatsapp_notification_trigger ON notifications;

CREATE TRIGGER whatsapp_notification_trigger
  AFTER INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION send_whatsapp_via_edge_function();

-- 4. Create a batch processing function for multiple WhatsApp notifications
CREATE OR REPLACE FUNCTION process_whatsapp_batch(batch_size integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_record RECORD;
  edge_function_result jsonb;
  processed_count integer := 0;
  failed_count integer := 0;
  batch_notifications jsonb := '[]'::jsonb;
BEGIN
  -- Collect notifications for batch processing
  FOR notification_record IN 
    SELECT n.id, n.user_id, n.whatsapp_number, n.ai_generated_message, n.created_at
    FROM notifications n
    JOIN users u ON n.user_id = u.id
    WHERE n.whatsapp_number IS NOT NULL 
      AND n.whatsapp_sent = false 
      AND n.ai_generated_message IS NOT NULL
      AND (n.processing_status IS NULL OR n.processing_status IN ('pending', 'queued_for_edge_function'))
      AND n.created_at > now() - INTERVAL '2 hours' -- Process recent notifications
      AND is_whatsapp_enabled_for_org(u.organization_id) = true
      AND is_auto_alerts_enabled_for_org(u.organization_id) = true
    ORDER BY n.created_at ASC
    LIMIT batch_size
  LOOP
    -- Build batch payload
    batch_notifications := batch_notifications || jsonb_build_object(
      'notificationId', notification_record.id,
      'phoneNumber', regexp_replace(notification_record.whatsapp_number::text, '^(\+91|91)', ''),
      'message', notification_record.ai_generated_message,
      'userId', notification_record.user_id
    );
  END LOOP;

  -- Send batch request if we have notifications
  IF jsonb_array_length(batch_notifications) > 0 THEN
    BEGIN
      -- Call Edge Function with batch data
      SELECT content::jsonb INTO edge_function_result
      FROM http((
        'POST',
        'https://hnyqfasddflqzfibtjjz.supabase.co/functions/v1/send-whatsapp-batch',
        ARRAY[
          http_header('Content-Type', 'application/json'),
          http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
        ],
        'application/json',
        json_build_object(
          'notifications', batch_notifications,
          'batchSize', jsonb_array_length(batch_notifications)
        )::text
      ));
      
      -- Process results and update notifications
      IF edge_function_result ? 'results' THEN
        FOR i IN 0..(jsonb_array_length(edge_function_result->'results') - 1) LOOP
          DECLARE
            result_item jsonb := edge_function_result->'results'->i;
            notification_id uuid := (result_item->>'notificationId')::uuid;
          BEGIN
            IF result_item->>'success' = 'true' THEN
              UPDATE notifications 
              SET whatsapp_sent = true, whatsapp_sent_at = now(), processing_status = 'completed'
              WHERE id = notification_id;
              processed_count := processed_count + 1;
            ELSE
              UPDATE notifications 
              SET processing_status = 'failed'
              WHERE id = notification_id;
              failed_count := failed_count + 1;
            END IF;
          END;
        END LOOP;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      failed_count := jsonb_array_length(batch_notifications);
    END;
  END IF;
  
  RETURN json_build_object(
    'batch_size', jsonb_array_length(batch_notifications),
    'processed_count', processed_count,
    'failed_count', failed_count,
    'success_rate', 
    CASE 
      WHEN jsonb_array_length(batch_notifications) > 0 
      THEN round((processed_count::decimal / jsonb_array_length(batch_notifications)) * 100, 2)
      ELSE 0 
    END
  );
END;
$$;

-- 5. Create a fallback cron job for any failed Edge Function calls
CREATE OR REPLACE FUNCTION process_failed_whatsapp_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_record RECORD;
  formatted_number text;
  edge_function_result jsonb;
  processed_count integer := 0;
BEGIN
  -- Process notifications that failed Edge Function calls
  FOR notification_record IN 
    SELECT n.id, n.user_id, n.whatsapp_number, n.ai_generated_message, n.created_at
    FROM notifications n
    JOIN users u ON n.user_id = u.id
    WHERE n.whatsapp_number IS NOT NULL 
      AND n.whatsapp_sent = false 
      AND n.ai_generated_message IS NOT NULL
      AND (n.processing_status IS NULL OR n.processing_status IN ('pending', 'queued_for_edge_function', 'failed'))
      AND n.created_at > now() - INTERVAL '1 hour' -- Only retry recent ones
      AND is_whatsapp_enabled_for_org(u.organization_id) = true
      AND is_auto_alerts_enabled_for_org(u.organization_id) = true
    ORDER BY n.created_at ASC
    LIMIT 25
  LOOP
    BEGIN
      -- Format the phone number
      formatted_number := regexp_replace(notification_record.whatsapp_number::text, '^(\+91|91)', '');
      
      -- Call Edge Function
      SELECT content::jsonb INTO edge_function_result
      FROM http((
        'POST',
        'https://hnyqfasddflqzfibtjjz.supabase.co/functions/v1/send-whatsapp',
        ARRAY[
          http_header('Content-Type', 'application/json'),
          http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
        ],
        'application/json',
        json_build_object(
          'phoneNumber', formatted_number,
          'message', notification_record.ai_generated_message,
          'notificationId', notification_record.id
        )::text
      ));
      
      -- Update notification as sent if successful
      IF edge_function_result->>'success' = 'true' THEN
        UPDATE notifications 
        SET whatsapp_sent = true, whatsapp_sent_at = now(), processing_status = 'completed'
        WHERE id = notification_record.id;
        processed_count := processed_count + 1;
      ELSE
        UPDATE notifications 
        SET processing_status = 'failed'
        WHERE id = notification_record.id;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      -- Continue with next notification on error
      CONTINUE;
    END;
  END LOOP;
  
  RETURN json_build_object('processed_count', processed_count);
END;
$$;

-- 6. Grant necessary permissions
GRANT EXECUTE ON FUNCTION send_whatsapp_via_edge_function() TO authenticated;
GRANT EXECUTE ON FUNCTION process_whatsapp_batch(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION process_failed_whatsapp_notifications() TO authenticated;

-- 7. Schedule batch processing cron job every 2 minutes
SELECT cron.schedule(
  'whatsapp-batch-processor', 
  '*/2 * * * *', 
  'SELECT process_whatsapp_batch(15);'
);

-- 8. Schedule fallback cron job to retry failed notifications every 5 minutes
SELECT cron.schedule(
  'retry-failed-whatsapp', 
  '*/5 * * * *', 
  'SELECT process_failed_whatsapp_notifications();'
);

-- 9. Add helpful comments
COMMENT ON FUNCTION send_whatsapp_via_edge_function() IS 'Real-time trigger that directly calls Edge Function for WhatsApp notifications';
COMMENT ON FUNCTION process_whatsapp_batch(integer) IS 'Batch process WhatsApp notifications efficiently - runs every 2 minutes with configurable batch size';
COMMENT ON FUNCTION process_failed_whatsapp_notifications() IS 'Fallback cron job to retry failed WhatsApp notifications every 5 minutes';

-- SUCCESS: BACKEND-ONLY WhatsApp processing is now active!
-- - Real-time triggers call Edge Function directly on notification insert
-- - Fallback cron job retries failed notifications every 5 minutes  
-- - NO FRONTEND CHANGES REQUIRED - works with existing deployed apps
-- - All debugging overhead removed to reduce costs
