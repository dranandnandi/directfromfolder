-- Add debugging and logging to WhatsApp cron function
-- This migration adds detailed logging to track why notifications are not being processed

-- Create a debug table to log WhatsApp processing attempts
CREATE TABLE IF NOT EXISTS whatsapp_debug_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_id uuid,
  step text NOT NULL,
  message text NOT NULL,
  data jsonb,
  created_at timestamptz DEFAULT now()
);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_debug_logs_created_at ON whatsapp_debug_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_debug_logs_notification_id ON whatsapp_debug_logs(notification_id);

-- Helper function to log debug messages
CREATE OR REPLACE FUNCTION log_whatsapp_debug(
  p_notification_id uuid,
  p_step text,
  p_message text,
  p_data jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO whatsapp_debug_logs (notification_id, step, message, data)
  VALUES (p_notification_id, p_step, p_message, p_data);
END;
$$;

-- Enhanced function to process pending WhatsApp notifications with detailed logging
CREATE OR REPLACE FUNCTION process_pending_whatsapp_notifications_debug()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_record RECORD;
  response_status integer;
  response_body text;
  whatsapp_endpoint text;
  formatted_number text;
  user_org_id uuid;
  whatsapp_enabled boolean;
  auto_alerts_enabled boolean;
  processed_count integer := 0;
  found_count integer := 0;
  debug_info jsonb := '{}';
  temp_debug jsonb;
BEGIN
  -- Log function start
  PERFORM log_whatsapp_debug(NULL, 'function_start', 'Starting WhatsApp processing function', 
    json_build_object('timestamp', now())::jsonb);
  
  -- Count total notifications that might qualify
  SELECT COUNT(*) INTO found_count
  FROM notifications n
  WHERE n.whatsapp_number IS NOT NULL 
    AND n.whatsapp_sent = false 
    AND n.ai_generated_message IS NOT NULL
    AND n.created_at > now() - INTERVAL '5 minutes';
  
  PERFORM log_whatsapp_debug(NULL, 'initial_query', 
    FORMAT('Found %s notifications matching basic criteria', found_count),
    json_build_object('count', found_count)::jsonb);
  
  -- Process up to 50 pending notifications per run to avoid overwhelming
  FOR notification_record IN 
    SELECT n.id, n.user_id, n.whatsapp_number, n.ai_generated_message, n.created_at
    FROM notifications n
    WHERE n.whatsapp_number IS NOT NULL 
      AND n.whatsapp_sent = false 
      AND n.ai_generated_message IS NOT NULL
      AND n.created_at > now() - INTERVAL '5 minutes' -- Only process recent notifications
    ORDER BY n.created_at ASC
    LIMIT 50
  LOOP
    -- Log notification being processed
    PERFORM log_whatsapp_debug(notification_record.id, 'notification_found', 
      'Processing notification', 
      json_build_object(
        'user_id', notification_record.user_id,
        'whatsapp_number', notification_record.whatsapp_number,
        'has_ai_message', notification_record.ai_generated_message IS NOT NULL,
        'created_at', notification_record.created_at
      )::jsonb);
    
    -- Get user's organization ID
    SELECT organization_id INTO user_org_id
    FROM users
    WHERE id = notification_record.user_id;
    
    PERFORM log_whatsapp_debug(notification_record.id, 'user_lookup', 
      'Found user organization', 
      json_build_object('organization_id', user_org_id)::jsonb);
    
    -- Check if WhatsApp is enabled for the organization
    SELECT is_whatsapp_enabled_for_org(user_org_id) INTO whatsapp_enabled;
    SELECT is_auto_alerts_enabled_for_org(user_org_id) INTO auto_alerts_enabled;
    
    PERFORM log_whatsapp_debug(notification_record.id, 'org_settings_check', 
      'Checked organization WhatsApp settings', 
      json_build_object(
        'whatsapp_enabled', whatsapp_enabled,
        'auto_alerts_enabled', auto_alerts_enabled
      )::jsonb);
    
    -- Only proceed if organization has WhatsApp enabled
    IF whatsapp_enabled AND auto_alerts_enabled THEN
      
      PERFORM log_whatsapp_debug(notification_record.id, 'org_approved', 
        'Organization has WhatsApp enabled, proceeding with send');
      
      -- Format the phone number (remove any leading +91 and ensure 10 digits)
      formatted_number := regexp_replace(notification_record.whatsapp_number::text, '^(\+91|91)', '');
      
      -- Get WhatsApp endpoint from organization or use default
      SELECT get_org_whatsapp_endpoint(user_org_id) INTO whatsapp_endpoint;
      IF whatsapp_endpoint IS NULL THEN
        whatsapp_endpoint := 'http://134.209.145.186:3001/api/send-message';
      END IF;
      
      PERFORM log_whatsapp_debug(notification_record.id, 'send_preparation', 
        'Prepared for WhatsApp API call', 
        json_build_object(
          'formatted_number', formatted_number,
          'endpoint', whatsapp_endpoint,
          'original_number', notification_record.whatsapp_number
        )::jsonb);
      
      -- Make HTTP POST request to WhatsApp API (with error handling)
      BEGIN
        SELECT status, content INTO response_status, response_body
        FROM http((
          'POST',
          whatsapp_endpoint,
          ARRAY[http_header('Content-Type', 'application/json')],
          'application/json',
          json_build_object(
            'phoneNumber', formatted_number,
            'message', notification_record.ai_generated_message
          )::text
        ));
        
        PERFORM log_whatsapp_debug(notification_record.id, 'api_response', 
          'Received API response', 
          json_build_object(
            'status', response_status,
            'body', response_body
          )::jsonb);
        
        -- Update notification as sent if successful
        IF response_status = 200 THEN
          UPDATE notifications 
          SET whatsapp_sent = true, whatsapp_sent_at = now()
          WHERE id = notification_record.id;
          processed_count := processed_count + 1;
          
          PERFORM log_whatsapp_debug(notification_record.id, 'success', 
            'WhatsApp message sent successfully');
        ELSE
          PERFORM log_whatsapp_debug(notification_record.id, 'api_error', 
            'API returned non-200 status', 
            json_build_object('status', response_status, 'body', response_body)::jsonb);
        END IF;
        
      EXCEPTION WHEN OTHERS THEN
        PERFORM log_whatsapp_debug(notification_record.id, 'exception', 
          'HTTP request failed with exception', 
          json_build_object('error', SQLERRM)::jsonb);
      END;
    ELSE
      -- Log why notification was skipped
      PERFORM log_whatsapp_debug(notification_record.id, 'org_disabled', 
        'Skipping notification - organization WhatsApp disabled', 
        json_build_object(
          'whatsapp_enabled', whatsapp_enabled,
          'auto_alerts_enabled', auto_alerts_enabled
        )::jsonb);
      
      -- Mark as skipped if organization has WhatsApp disabled
      UPDATE notifications 
      SET whatsapp_sent = true, whatsapp_sent_at = now()
      WHERE id = notification_record.id;
    END IF;
    
  END LOOP;
  
  -- Log function completion
  debug_info := json_build_object(
    'total_found', found_count,
    'processed_count', processed_count,
    'completed_at', now()
  );
  
  PERFORM log_whatsapp_debug(NULL, 'function_complete', 
    'WhatsApp processing function completed', debug_info);
  
  RETURN debug_info;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION process_pending_whatsapp_notifications_debug() TO authenticated;
GRANT EXECUTE ON FUNCTION log_whatsapp_debug(uuid, text, text, jsonb) TO authenticated;

-- Add RLS policies for debug table
ALTER TABLE whatsapp_debug_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists, then recreate
DROP POLICY IF EXISTS "Allow read access to whatsapp debug logs" ON whatsapp_debug_logs;

CREATE POLICY "Allow read access to whatsapp debug logs"
  ON whatsapp_debug_logs FOR SELECT
  TO authenticated
  USING (true);

-- Schedule new debug cron job (runs alongside the original)
SELECT cron.schedule('debug-whatsapp-notifications', '*/2 * * * *', 'SELECT process_pending_whatsapp_notifications_debug();');

-- Add helpful comments
COMMENT ON TABLE whatsapp_debug_logs IS 'Debug logging table to track WhatsApp notification processing steps';
COMMENT ON FUNCTION process_pending_whatsapp_notifications_debug() IS 'Debug version of WhatsApp cron function with detailed logging. Runs every 2 minutes to track processing steps.';
COMMENT ON FUNCTION log_whatsapp_debug(uuid, text, text, jsonb) IS 'Helper function to log debug messages during WhatsApp processing';

-- Create a view to easily see recent debug logs
CREATE OR REPLACE VIEW whatsapp_debug_summary AS
SELECT 
  wdl.created_at,
  wdl.notification_id,
  wdl.step,
  wdl.message,
  wdl.data,
  n.whatsapp_number,
  n.whatsapp_sent,
  n.created_at as notification_created_at
FROM whatsapp_debug_logs wdl
LEFT JOIN notifications n ON wdl.notification_id = n.id
ORDER BY wdl.created_at DESC;

COMMENT ON VIEW whatsapp_debug_summary IS 'Easy view to see WhatsApp debug logs with notification details';
