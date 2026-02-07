-- SETUP CRON JOB TO PROCESS WHATSAPP NOTIFICATIONS
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

-- =============================================
-- STEP 1: Enable required extensions
-- =============================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =============================================
-- STEP 2: Fix get_pending_whatsapp_notifications function
-- (adds organization_id and fixes parameter name)
-- =============================================
DROP FUNCTION IF EXISTS get_pending_whatsapp_notifications(integer) CASCADE;

CREATE OR REPLACE FUNCTION get_pending_whatsapp_notifications(batch_size integer DEFAULT 50)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  task_id uuid,
  type text,
  title text,
  message text,
  whatsapp_number text,
  ai_generated_message text,
  organization_id uuid,
  org_whatsapp_enabled boolean,
  org_auto_alerts_enabled boolean,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.user_id,
    n.task_id,
    n.type,
    n.title,
    n.message,
    n.whatsapp_number,
    n.ai_generated_message,
    u.organization_id,
    n.org_whatsapp_enabled,
    n.org_auto_alerts_enabled,
    n.created_at
  FROM notifications n
  JOIN users u ON u.id = n.user_id
  WHERE n.org_whatsapp_enabled = true
    AND n.org_auto_alerts_enabled = true
    AND n.whatsapp_number IS NOT NULL
    AND n.ai_generated_message IS NOT NULL
    AND n.whatsapp_sent = false
    AND (n.processing_status IS NULL OR n.processing_status IN ('pending', 'failed'))
  ORDER BY n.created_at ASC
  LIMIT batch_size;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_pending_whatsapp_notifications(integer) TO service_role;

-- =============================================
-- STEP 3: Create/fix mark_whatsapp_notification_status function
-- =============================================
DROP FUNCTION IF EXISTS mark_whatsapp_notification_status(uuid, boolean, text) CASCADE;

CREATE OR REPLACE FUNCTION mark_whatsapp_notification_status(
  notification_id uuid,
  success boolean,
  error_message text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  IF success THEN
    UPDATE notifications
    SET 
      whatsapp_sent = true,
      whatsapp_sent_at = now(),
      processing_status = 'completed',
      updated_at = now()
    WHERE id = notification_id;
  ELSE
    UPDATE notifications
    SET 
      processing_status = 'failed',
      updated_at = now()
    WHERE id = notification_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION mark_whatsapp_notification_status(uuid, boolean, text) TO service_role;

-- =============================================
-- STEP 4: Create cron job function
-- =============================================
CREATE OR REPLACE FUNCTION call_process_whatsapp_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Call the edge function using pg_net
  PERFORM net.http_post(
    url := 'https://hnyqfasddflqzfibtjjz.supabase.co/functions/v1/process-whatsapp-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhueXFmYXNkZGZscXpmaWJ0amp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNzEwMTYyMywiZXhwIjoyMDUyNjc3NjIzfQ.nU6KqY3UP4inTZKCPOjul1BlWXAqFm53x8UG27ongj4'
    ),
    body := '{"batchSize": 25}'::jsonb
  );
END;
$$;

-- =============================================
-- STEP 5: Schedule cron job (every minute)
-- =============================================
-- Remove existing job if any (ignore error if not exists)
DO $$
BEGIN
  PERFORM cron.unschedule('process-whatsapp-queue');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist, ignore
  NULL;
END $$;

-- Schedule new job to run every 30 minutes
SELECT cron.schedule(
  'process-whatsapp-queue',
  '*/30 * * * *',
  $$SELECT call_process_whatsapp_queue()$$
);

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check scheduled jobs
SELECT * FROM cron.job;

-- Check pending notifications count
SELECT COUNT(*) as pending_count 
FROM notifications 
WHERE org_whatsapp_enabled = true
  AND org_auto_alerts_enabled = true
  AND whatsapp_number IS NOT NULL
  AND ai_generated_message IS NOT NULL
  AND whatsapp_sent = false;

-- After a few minutes, check job run history:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
