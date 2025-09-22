/*
  # Simple WhatsApp Alerts - Basic Setup
  
  This migration adds basic WhatsApp functionality:
  - Add WhatsApp tracking columns to notifications
  - Simple function to send WhatsApp for important notifications
*/

-- Add WhatsApp columns to notifications table if they don't exist
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS whatsapp_number text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS whatsapp_sent boolean DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamp with time zone;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ai_generated_message text;

-- Add overdue tracking columns to tasks table if they don't exist  
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_alert_count integer DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_overdue_alert_at timestamp with time zone;

-- Simple function to create WhatsApp notifications
CREATE OR REPLACE FUNCTION create_whatsapp_notification(
  p_user_id uuid,
  p_task_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_whatsapp_number text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_id uuid;
BEGIN
  INSERT INTO notifications (
    user_id,
    task_id,
    type,
    title,
    message,
    whatsapp_number,
    ai_generated_message,
    created_at
  )
  VALUES (
    p_user_id,
    p_task_id,
    p_type,
    p_title,
    p_message,
    p_whatsapp_number,
    p_message, -- Use same message for WhatsApp
    NOW()
  )
  RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$;

-- Simple function to check for overdue tasks and create WhatsApp alerts
CREATE OR REPLACE FUNCTION check_overdue_tasks_simple()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task record;
  v_user record;
  v_message text;
  v_count integer := 0;
BEGIN
  -- Find overdue tasks that haven't been alerted recently
  FOR v_task IN
    SELECT 
      t.id,
      t.title,
      t.assigned_to,
      t.due_date,
      t.priority,
      EXTRACT(EPOCH FROM (NOW() - t.due_date))/3600 as hours_overdue
    FROM tasks t
    WHERE t.status != 'completed'
      AND t.assigned_to IS NOT NULL
      AND t.due_date IS NOT NULL
      AND t.due_date < NOW()
      AND (t.last_overdue_alert_at IS NULL OR t.last_overdue_alert_at < NOW() - INTERVAL '1 day')
  LOOP
    -- Get user details
    SELECT id, name, whatsapp_number INTO v_user
    FROM users 
    WHERE id = v_task.assigned_to 
      AND whatsapp_number IS NOT NULL;
    
    -- Create alert if user has WhatsApp number
    IF v_user.id IS NOT NULL THEN
      v_message := format('OVERDUE TASK: %s - Due: %s - Please complete ASAP', 
                         v_task.title, 
                         to_char(v_task.due_date, 'DD Mon HH24:MI'));
      
      PERFORM create_whatsapp_notification(
        v_user.id,
        v_task.id,
        'task_overdue',
        'Overdue Task Alert',
        v_message,
        v_user.whatsapp_number
      );
      
      -- Update task tracking
      UPDATE tasks 
      SET 
        overdue_alert_count = COALESCE(overdue_alert_count, 0) + 1,
        last_overdue_alert_at = NOW()
      WHERE id = v_task.id;
      
      v_count := v_count + 1;
    END IF;
  END LOOP;
  
  RETURN v_count;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION create_whatsapp_notification(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION check_overdue_tasks_simple() TO authenticated;
