-- Recreate useful WhatsApp utility functions that were dropped

-- First drop existing functions to avoid conflicts
DROP FUNCTION IF EXISTS is_whatsapp_enabled_for_org(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_org_whatsapp_settings(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_org_whatsapp_endpoint(uuid) CASCADE;
DROP FUNCTION IF EXISTS generate_whatsapp_message_for_task(uuid) CASCADE;
DROP FUNCTION IF EXISTS create_whatsapp_notification(uuid, uuid, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS mark_whatsapp_message_sent(uuid) CASCADE;
DROP FUNCTION IF EXISTS get_unsent_whatsapp_messages(integer) CASCADE;
DROP FUNCTION IF EXISTS mark_whatsapp_notification_status(uuid, boolean, text) CASCADE;
DROP FUNCTION IF EXISTS get_pending_whatsapp_notifications(integer) CASCADE;

-- Function to check if WhatsApp is enabled for an organization
CREATE OR REPLACE FUNCTION is_whatsapp_enabled_for_org(org_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN (
    SELECT whatsapp_enabled AND auto_alerts_enabled
    FROM organizations 
    WHERE id = org_id
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get organization WhatsApp settings
CREATE OR REPLACE FUNCTION get_org_whatsapp_settings(org_id uuid)
RETURNS TABLE(
  whatsapp_enabled boolean,
  auto_alerts_enabled boolean,
  whatsapp_endpoint text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.whatsapp_enabled,
    o.auto_alerts_enabled,
    o.whatsapp_endpoint
  FROM organizations o
  WHERE o.id = org_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get WhatsApp endpoint for organization
CREATE OR REPLACE FUNCTION get_org_whatsapp_endpoint(org_id uuid)
RETURNS text AS $$
BEGIN
  RETURN (
    SELECT whatsapp_endpoint
    FROM organizations 
    WHERE id = org_id
  );
END;
$$ LANGUAGE plpgsql;

-- Function to generate WhatsApp message for a task
CREATE OR REPLACE FUNCTION generate_whatsapp_message_for_task(task_id uuid)
RETURNS text AS $$
DECLARE
  task_record RECORD;
  message_text text;
BEGIN
  SELECT t.title, t.description, t.due_date, t.priority, u.name as user_name
  INTO task_record
  FROM tasks t
  JOIN users u ON t.user_id = u.id
  WHERE t.id = task_id;
  
  IF NOT FOUND THEN
    RETURN 'Task not found';
  END IF;
  
  message_text := 'Task Reminder: ' || task_record.title;
  
  IF task_record.description IS NOT NULL THEN
    message_text := message_text || E'\n\nDetails: ' || task_record.description;
  END IF;
  
  IF task_record.due_date IS NOT NULL THEN
    message_text := message_text || E'\n\nDue: ' || to_char(task_record.due_date, 'DD/MM/YYYY HH24:MI');
  END IF;
  
  IF task_record.priority IS NOT NULL THEN
    message_text := message_text || E'\n\nPriority: ' || task_record.priority;
  END IF;
  
  message_text := message_text || E'\n\nAssigned to: ' || task_record.user_name;
  
  RETURN message_text;
END;
$$ LANGUAGE plpgsql;

-- Function to create WhatsApp notification
CREATE OR REPLACE FUNCTION create_whatsapp_notification(
  p_user_id uuid,
  p_task_id uuid,
  p_title text,
  p_message text,
  p_whatsapp_number text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  notification_id uuid;
  user_phone text;
BEGIN
  -- Get user's WhatsApp number if not provided
  IF p_whatsapp_number IS NULL THEN
    SELECT whatsapp_number INTO user_phone
    FROM users 
    WHERE id = p_user_id;
  ELSE
    user_phone := p_whatsapp_number;
  END IF;
  
  -- Generate AI message if not provided
  IF p_message IS NULL THEN
    p_message := generate_whatsapp_message_for_task(p_task_id);
  END IF;
  
  -- Insert notification
  INSERT INTO notifications (
    user_id,
    task_id,
    type,
    title,
    message,
    whatsapp_number,
    ai_generated_message,
    whatsapp_sent,
    created_at
  ) VALUES (
    p_user_id,
    p_task_id,
    'task_reminder',
    p_title,
    p_message,
    user_phone,
    p_message,
    false,
    now()
  ) RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$ LANGUAGE plpgsql;

-- Function to mark WhatsApp message as sent
CREATE OR REPLACE FUNCTION mark_whatsapp_message_sent(notification_id uuid)
RETURNS boolean AS $$
BEGIN
  UPDATE notifications 
  SET 
    whatsapp_sent = true,
    whatsapp_sent_at = now(),
    updated_at = now()
  WHERE id = notification_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to get unsent WhatsApp messages
CREATE OR REPLACE FUNCTION get_unsent_whatsapp_messages(limit_count integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  task_id uuid,
  title text,
  message text,
  whatsapp_number text,
  ai_generated_message text,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.user_id,
    n.task_id,
    n.title,
    n.message,
    n.whatsapp_number,
    n.ai_generated_message,
    n.created_at
  FROM notifications n
  WHERE n.org_whatsapp_enabled = true
    AND n.org_auto_alerts_enabled = true
    AND n.whatsapp_number IS NOT NULL
    AND n.ai_generated_message IS NOT NULL
    AND n.whatsapp_sent = false
  ORDER BY n.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to mark WhatsApp notification status
CREATE OR REPLACE FUNCTION mark_whatsapp_notification_status(
  notification_id uuid,
  sent_status boolean,
  error_message text DEFAULT NULL
)
RETURNS boolean AS $$
BEGIN
  UPDATE notifications 
  SET 
    whatsapp_sent = sent_status,
    whatsapp_sent_at = CASE WHEN sent_status THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = notification_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to get pending WhatsApp notifications
CREATE OR REPLACE FUNCTION get_pending_whatsapp_notifications(limit_count integer DEFAULT 50)
RETURNS TABLE(
  id uuid,
  user_id uuid,
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
  WHERE n.org_whatsapp_enabled = true
    AND n.org_auto_alerts_enabled = true
    AND n.whatsapp_number IS NOT NULL
    AND n.ai_generated_message IS NOT NULL
    AND n.whatsapp_sent = false
  ORDER BY n.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;
