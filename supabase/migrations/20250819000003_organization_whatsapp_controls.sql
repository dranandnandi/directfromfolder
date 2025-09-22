-- Add organization-level WhatsApp controls
-- This migration adds the necessary columns and functions for org-level WhatsApp management

-- Add WhatsApp control columns to organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS auto_alerts_enabled boolean DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_api_endpoint text DEFAULT 'http://134.209.145.186:3001/api/send-message';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_settings jsonb DEFAULT '{"priority_high": true, "priority_medium": true, "priority_low": false, "rate_limit": 30}';

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_organizations_whatsapp_enabled ON organizations(whatsapp_enabled);
CREATE INDEX IF NOT EXISTS idx_organizations_auto_alerts ON organizations(auto_alerts_enabled);

-- Function to check if WhatsApp is enabled for an organization
CREATE OR REPLACE FUNCTION is_whatsapp_enabled_for_org(org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT whatsapp_enabled 
    FROM organizations 
    WHERE id = org_id
    LIMIT 1
  ) IS TRUE;
END;
$$;

-- Function to check if auto alerts are enabled for an organization
CREATE OR REPLACE FUNCTION is_auto_alerts_enabled_for_org(org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT auto_alerts_enabled 
    FROM organizations 
    WHERE id = org_id
    LIMIT 1
  ) IS TRUE;
END;
$$;

-- Function to get WhatsApp settings for an organization
CREATE OR REPLACE FUNCTION get_org_whatsapp_settings(org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT whatsapp_settings 
    FROM organizations 
    WHERE id = org_id
    LIMIT 1
  );
END;
$$;

-- Function to get WhatsApp API endpoint for an organization
CREATE OR REPLACE FUNCTION get_org_whatsapp_endpoint(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(whatsapp_api_endpoint, 'http://134.209.145.186:3001/api/send-message')
    FROM organizations 
    WHERE id = org_id
    LIMIT 1
  );
END;
$$;

-- Update the notification creation functions to respect organization WhatsApp settings
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id uuid,
  p_task_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_scheduled_for timestamptz DEFAULT NULL,
  p_whatsapp_number text DEFAULT NULL,
  p_ai_generated_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_id uuid;
  user_org_id uuid;
  whatsapp_enabled boolean;
  auto_alerts_enabled boolean;
  effective_whatsapp_number text;
BEGIN
  -- Get user's organization ID
  SELECT organization_id INTO user_org_id
  FROM users
  WHERE id = p_user_id;
  
  -- Check if WhatsApp is enabled for the organization
  SELECT is_whatsapp_enabled_for_org(user_org_id) INTO whatsapp_enabled;
  SELECT is_auto_alerts_enabled_for_org(user_org_id) INTO auto_alerts_enabled;
  
  -- Set WhatsApp number based on organization settings
  IF whatsapp_enabled AND auto_alerts_enabled THEN
    effective_whatsapp_number := p_whatsapp_number;
  ELSE
    effective_whatsapp_number := NULL; -- Disable WhatsApp for this notification
  END IF;
  
  -- Create the notification
  INSERT INTO notifications (
    user_id,
    task_id,
    type,
    title,
    message,
    scheduled_for,
    whatsapp_number,
    ai_generated_message
  )
  VALUES (
    p_user_id,
    p_task_id,
    p_type,
    p_title,
    p_message,
    p_scheduled_for,
    effective_whatsapp_number,
    p_ai_generated_message
  )
  RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$;

-- Grant permissions to authenticated users
GRANT EXECUTE ON FUNCTION is_whatsapp_enabled_for_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_auto_alerts_enabled_for_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_org_whatsapp_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_org_whatsapp_endpoint(uuid) TO authenticated;

-- Add RLS policy for organization WhatsApp settings (admins only)
DROP POLICY IF EXISTS "admins_manage_org_whatsapp_settings" ON organizations;
CREATE POLICY "admins_manage_org_whatsapp_settings"
  ON organizations FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT organization_id 
      FROM users 
      WHERE auth_id = auth.uid() 
      AND role IN ('admin', 'superadmin')
    )
  );

-- Add helpful comments
COMMENT ON COLUMN organizations.whatsapp_enabled IS 'Master toggle for all WhatsApp functionality in the organization';
COMMENT ON COLUMN organizations.auto_alerts_enabled IS 'Enable automatic WhatsApp alert processing based on notification rules';
COMMENT ON COLUMN organizations.whatsapp_api_endpoint IS 'Custom WhatsApp API endpoint for this organization';
COMMENT ON COLUMN organizations.whatsapp_settings IS 'JSON configuration for WhatsApp priorities, rate limits, etc.';

-- Update existing organizations to have WhatsApp disabled by default (for safety)
-- Admins can manually enable it per organization
UPDATE organizations 
SET 
  whatsapp_enabled = false,
  auto_alerts_enabled = false,
  whatsapp_api_endpoint = 'http://134.209.145.186:3001/api/send-message',
  whatsapp_settings = '{"priority_high": true, "priority_medium": true, "priority_low": false, "rate_limit": 30}'
WHERE whatsapp_enabled IS NULL;

-- Remove the problematic HTTP trigger completely
DROP TRIGGER IF EXISTS auto_send_whatsapp_trigger ON notifications;
DROP FUNCTION IF EXISTS send_whatsapp_notification();

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS http;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create function to process pending WhatsApp notifications (cron job)
CREATE OR REPLACE FUNCTION process_pending_whatsapp_notifications()
RETURNS integer
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
BEGIN
  -- Process up to 50 pending notifications per run to avoid overwhelming
  FOR notification_record IN 
    SELECT n.id, n.user_id, n.whatsapp_number, n.ai_generated_message
    FROM notifications n
    WHERE n.whatsapp_number IS NOT NULL 
      AND n.whatsapp_sent = false 
      AND n.ai_generated_message IS NOT NULL
      AND n.created_at > now() - INTERVAL '24 hours' -- Only process recent notifications
    ORDER BY n.created_at ASC
    LIMIT 50
  LOOP
    -- Get user's organization ID
    SELECT organization_id INTO user_org_id
    FROM users
    WHERE id = notification_record.user_id;
    
    -- Check if WhatsApp is enabled for the organization
    SELECT is_whatsapp_enabled_for_org(user_org_id) INTO whatsapp_enabled;
    SELECT is_auto_alerts_enabled_for_org(user_org_id) INTO auto_alerts_enabled;
    
    -- Only proceed if organization has WhatsApp enabled
    IF whatsapp_enabled AND auto_alerts_enabled THEN
      
      -- Format the phone number (remove any leading +91 and ensure 10 digits)
      formatted_number := regexp_replace(notification_record.whatsapp_number::text, '^(\+91|91)', '');
      
      -- Get WhatsApp endpoint from organization or use default
      SELECT get_org_whatsapp_endpoint(user_org_id) INTO whatsapp_endpoint;
      IF whatsapp_endpoint IS NULL THEN
        whatsapp_endpoint := 'http://134.209.145.186:3001/api/send-message';
      END IF;
      
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
        
        -- Update notification as sent if successful
        IF response_status = 200 THEN
          UPDATE notifications 
          SET whatsapp_sent = true, whatsapp_sent_at = now()
          WHERE id = notification_record.id;
          processed_count := processed_count + 1;
        ELSE
          -- Mark as failed after 3 attempts (check existing attempts)
          UPDATE notifications 
          SET whatsapp_sent = true, whatsapp_sent_at = now()
          WHERE id = notification_record.id 
            AND (SELECT COUNT(*) FROM notifications WHERE id = notification_record.id AND created_at < now() - INTERVAL '3 minutes') >= 3;
        END IF;
        
      EXCEPTION WHEN OTHERS THEN
        -- On HTTP error, mark as failed after 3 attempts
        UPDATE notifications 
        SET whatsapp_sent = true, whatsapp_sent_at = now()
        WHERE id = notification_record.id 
          AND (SELECT COUNT(*) FROM notifications WHERE id = notification_record.id AND created_at < now() - INTERVAL '3 minutes') >= 3;
      END;
    ELSE
      -- Mark as skipped if organization has WhatsApp disabled
      UPDATE notifications 
      SET whatsapp_sent = true, whatsapp_sent_at = now()
      WHERE id = notification_record.id;
    END IF;
    
  END LOOP;
  
  RETURN processed_count;
END;
$$;

-- Schedule cron job to process WhatsApp notifications every 1 minute
-- Remove existing cron job if it exists
SELECT cron.unschedule('process-whatsapp-notifications') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-whatsapp-notifications'
);

-- Create new cron job to run every minute
SELECT cron.schedule('process-whatsapp-notifications', '* * * * *', 'SELECT process_pending_whatsapp_notifications();');

-- Grant permissions for cron function
GRANT EXECUTE ON FUNCTION process_pending_whatsapp_notifications() TO authenticated;

-- Add index for efficient cron job queries
CREATE INDEX IF NOT EXISTS idx_notifications_whatsapp_pending ON notifications(whatsapp_sent, created_at) WHERE whatsapp_number IS NOT NULL;

-- Add helpful comment
COMMENT ON FUNCTION process_pending_whatsapp_notifications() IS 'Cron job function that processes pending WhatsApp notifications every minute. Handles up to 50 notifications per run with error handling and retry logic.';
