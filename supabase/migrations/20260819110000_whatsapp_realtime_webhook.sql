-- Real-time WhatsApp delivery via a Database Webhook (pg_net), replacing the
-- 2-minute polling cron as the primary path.
--
-- Run this BEFORE creating the webhook in the Dashboard.

-- ---------------------------------------------------------------------------
-- 1. Restore the delivery-diagnostics columns.
--    Migration 20250819000001 was never applied to this database, so both
--    Edge Functions were failing to mark rows as sent - which made every run
--    redeliver the same message.
-- ---------------------------------------------------------------------------
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS whatsapp_message_id text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS whatsapp_error text;

-- Ask PostgREST to pick the new columns up immediately rather than on its next
-- scheduled reload, so the Edge Functions can write them right away.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 2. Demote the queue cron to a retry safety net.
--    The webhook handles delivery in real time; this only catches rows the
--    webhook missed (function cold start, bridge down, transient failure).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  queue_job_id bigint;
BEGIN
  SELECT jobid INTO queue_job_id FROM cron.job WHERE jobname = 'call_process_whatsapp_queue';

  IF queue_job_id IS NULL THEN
    RAISE WARNING 'call_process_whatsapp_queue not found - no retry net for missed webhooks.';
  ELSE
    PERFORM cron.alter_job(queue_job_id, schedule => '*/10 * * * *');
    RAISE NOTICE 'call_process_whatsapp_queue demoted to every 10 minutes (retry only)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Index the webhook/queue predicate so the retry sweep stays cheap as the
--    notifications table grows.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_whatsapp_pending
  ON notifications (whatsapp_sent, org_whatsapp_enabled, org_auto_alerts_enabled)
  WHERE whatsapp_sent = false;

COMMENT ON COLUMN notifications.whatsapp_message_id IS 'Message id returned by the WhatsApp bridge on successful delivery.';
COMMENT ON COLUMN notifications.whatsapp_error IS 'Last delivery error text, null when delivery succeeded.';
