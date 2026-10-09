-- Ensure queued WhatsApp notifications include the Task Management organization.
-- Edge Functions use organization_id to route messages through the linked WhatsApp tenant/session.

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
  ORDER BY n.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_pending_whatsapp_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_whatsapp_notifications(integer) TO service_role;
