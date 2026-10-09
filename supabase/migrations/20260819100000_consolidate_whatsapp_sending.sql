-- Consolidate WhatsApp sending onto a single path.
--
-- History: five overlapping mechanisms accumulated across migrations
-- (a real-time http() trigger, a batch processor, a failed-retry job, a stuck-row
-- cleanup job, and a debug processor). Several were never applied to the live
-- database, one referenced a function that had already been dropped, and all of
-- them depended on the `http` extension which is not enabled on this project.
--
-- The only path that actually delivers is the queue:
--   notifications row
--     -> get_pending_whatsapp_notifications()
--     -> process-whatsapp-queue Edge Function  (per-org endpoint, E.164 phone)
--     -> WhatsApp bridge
--     -> mark_whatsapp_notification_status()
--
-- This migration removes everything else so there is one mechanism to reason
-- about, and tightens the queue cadence from 30 minutes to 2.

-- ---------------------------------------------------------------------------
-- 1. Remove the legacy cron jobs. Guarded because most were never created here.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  legacy_job text;
BEGIN
  FOREACH legacy_job IN ARRAY ARRAY[
    'whatsapp-batch-processor',
    'retry-failed-whatsapp',
    'cleanup-stuck-whatsapp',
    'process-whatsapp-notifications',
    'debug-whatsapp-notifications'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = legacy_job) THEN
      PERFORM cron.unschedule(legacy_job);
      RAISE NOTICE 'Unscheduled legacy job %', legacy_job;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Remove the legacy real-time trigger and its function.
--    It called http() inside the INSERT transaction, so it blocked writes on a
--    network round trip and swallowed every failure in an EXCEPTION handler.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS whatsapp_notification_trigger ON notifications;

DROP FUNCTION IF EXISTS send_whatsapp_via_edge_function();
DROP FUNCTION IF EXISTS trigger_whatsapp_edge_function();
DROP FUNCTION IF EXISTS process_whatsapp_batch(integer);
DROP FUNCTION IF EXISTS process_failed_whatsapp_notifications();
DROP FUNCTION IF EXISTS process_pending_whatsapp_notifications();
DROP FUNCTION IF EXISTS process_pending_whatsapp_notifications_debug();
DROP FUNCTION IF EXISTS cleanup_processed_whatsapp_notifications();

-- ---------------------------------------------------------------------------
-- 3. Ensure the queue reader exists and returns organization_id.
--    process-whatsapp-queue skips any row without it ("Missing organization_id"),
--    and notifications has no organization_id column - it comes from the user.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_pending_whatsapp_notifications(integer);

CREATE OR REPLACE FUNCTION get_pending_whatsapp_notifications(limit_count integer DEFAULT 50)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  organization_id uuid,
  task_id uuid,
  type text,
  title text,
  message text,
  whatsapp_number text,
  ai_generated_message text,
  org_whatsapp_enabled boolean,
  org_auto_alerts_enabled boolean,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    n.id,
    n.user_id,
    u.organization_id,
    n.task_id,
    n.type,
    n.title,
    n.message,
    n.whatsapp_number,
    n.ai_generated_message,
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
  ORDER BY n.created_at ASC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_pending_whatsapp_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_whatsapp_notifications(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Ensure the status writer the Edge Function calls back into exists.
--    Dropped first: an older definition returns a different type, and CREATE OR
--    REPLACE cannot change a function's return type.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS mark_whatsapp_notification_status(uuid, boolean, text);
DROP FUNCTION IF EXISTS mark_whatsapp_notification_status(uuid, boolean);
DROP FUNCTION IF EXISTS mark_whatsapp_notification_status(uuid);

CREATE OR REPLACE FUNCTION mark_whatsapp_notification_status(
  notification_id uuid,
  sent_status boolean,
  error_message text DEFAULT NULL
)
RETURNS boolean AS $$
BEGIN
  UPDATE notifications
  SET whatsapp_sent      = sent_status,
      whatsapp_sent_at   = CASE WHEN sent_status THEN now() ELSE whatsapp_sent_at END,
      whatsapp_error     = error_message,
      processing_status  = CASE WHEN sent_status THEN 'completed' ELSE 'failed' END,
      updated_at         = now()
  WHERE id = notification_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION mark_whatsapp_notification_status(uuid, boolean, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Run the queue every 2 minutes instead of every 30.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  queue_job_id bigint;
BEGIN
  SELECT jobid INTO queue_job_id FROM cron.job WHERE jobname = 'call_process_whatsapp_queue';

  IF queue_job_id IS NULL THEN
    RAISE WARNING 'call_process_whatsapp_queue not found - the queue has no scheduler. Create it before relying on automatic delivery.';
  ELSE
    PERFORM cron.alter_job(queue_job_id, schedule => '*/2 * * * *');
    RAISE NOTICE 'call_process_whatsapp_queue now runs every 2 minutes';
  END IF;
END $$;

COMMENT ON FUNCTION get_pending_whatsapp_notifications(integer) IS
  'Sole queue reader for WhatsApp delivery. Consumed by the process-whatsapp-queue Edge Function.';
