/*
  # Add WhatsApp Notification Support

  1. New Columns
    - `whatsapp_number` (text): The WhatsApp number to send the notification to
    - `ai_generated_message` (text): AI-generated message content for WhatsApp
    - `whatsapp_sent` (boolean): Flag to track if the message was sent
    - `whatsapp_sent_at` (timestamptz): When the WhatsApp message was sent

  2. Security
    - Maintain existing RLS policies
    - No changes to access control
*/

-- Add new columns to notifications table
ALTER TABLE notifications 
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS ai_generated_message text,
  ADD COLUMN IF NOT EXISTS whatsapp_sent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz;

-- Create index for whatsapp_sent to efficiently query unsent messages
CREATE INDEX IF NOT EXISTS idx_notifications_whatsapp_sent ON notifications(whatsapp_sent) 
  WHERE whatsapp_sent = false;

-- Update the create_notification function to support WhatsApp
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
  v_notification_id uuid;
  v_preference_enabled boolean;
  v_task_info record;
  v_assignee_whatsapp text;
BEGIN
  -- Check if user has enabled this notification type
  SELECT enabled INTO v_preference_enabled
  FROM notification_preferences
  WHERE user_id = p_user_id AND type = p_type;

  -- If no preference exists, create default (enabled) and use it
  IF v_preference_enabled IS NULL THEN
    INSERT INTO notification_preferences (user_id, type, enabled)
    VALUES (p_user_id, p_type, true)
    ON CONFLICT (user_id, type) DO UPDATE SET enabled = EXCLUDED.enabled
    RETURNING enabled INTO v_preference_enabled;
    
    -- If still null due to conflict, get the existing value
    IF v_preference_enabled IS NULL THEN
      SELECT enabled INTO v_preference_enabled
      FROM notification_preferences
      WHERE user_id = p_user_id AND type = p_type;
    END IF;
  END IF;

  -- Only create notification if enabled (default to true if still null)
  IF COALESCE(v_preference_enabled, true) THEN
    -- Get the WhatsApp number if not provided
    IF p_whatsapp_number IS NULL THEN
      -- Try to get assignee's WhatsApp number from task
      IF p_task_id IS NOT NULL THEN
        -- First try to get from tasks table
        SELECT 
          t.manual_whatsapp_number,
          t.contact_number,
          u.whatsapp_number AS assignee_whatsapp
        INTO v_task_info
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.id = p_task_id;
        
        IF v_task_info IS NOT NULL THEN
          v_assignee_whatsapp := COALESCE(
            v_task_info.manual_whatsapp_number,
            v_task_info.contact_number,
            v_task_info.assignee_whatsapp
          );
        ELSE
          -- Try to get from personal_tasks table
          SELECT 
            u.whatsapp_number AS assignee_whatsapp
          INTO v_task_info
          FROM personal_tasks pt
          LEFT JOIN users u ON u.id = pt.assignee_id
          WHERE pt.id = p_task_id;
          
          IF v_task_info IS NOT NULL THEN
            v_assignee_whatsapp := v_task_info.assignee_whatsapp;
          END IF;
        END IF;
      END IF;
    END IF;

    -- Avoid duplicate notifications for the same task/type/user within a short time
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE user_id = p_user_id 
        AND task_id = p_task_id
        AND type = p_type
        AND created_at > now() - interval '1 minute'
        AND (p_scheduled_for IS NULL OR scheduled_for = p_scheduled_for)
    ) THEN
      INSERT INTO notifications (
        user_id,
        task_id,
        type,
        title,
        message,
        scheduled_for,
        whatsapp_number,
        ai_generated_message,
        whatsapp_sent
      )
      VALUES (
        p_user_id,
        p_task_id,
        p_type,
        p_title,
        p_message,
        p_scheduled_for,
        COALESCE(p_whatsapp_number, v_assignee_whatsapp),
        p_ai_generated_message,
        false
      )
      RETURNING id INTO v_notification_id;
    END IF;
  END IF;

  RETURN v_notification_id;
END;
$$;

-- Create a function to generate AI message for a task
-- This is a placeholder - the actual AI message generation will be handled by the application
CREATE OR REPLACE FUNCTION generate_whatsapp_message_for_task(p_task_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task_info record;
  v_message text;
BEGIN
  -- Get task information
  SELECT 
    t.title,
    t.description,
    t.type,
    t.priority,
    t.status,
    t.due_date,
    t.patient_id,
    t.location,
    u.name AS assignee_name
  INTO v_task_info
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assigned_to
  WHERE t.id = p_task_id;
  
  IF v_task_info IS NULL THEN
    -- Try personal tasks
    SELECT 
      pt.title,
      pt.description,
      'personalTask' AS type,
      pt.priority,
      pt.status,
      pt.due_date,
      NULL AS patient_id,
      NULL AS location,
      u.name AS assignee_name
    INTO v_task_info
    FROM personal_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_id
    WHERE pt.id = p_task_id;
  END IF;
  
  IF v_task_info IS NULL THEN
    RETURN 'Task not found';
  END IF;
  
  -- Generate a simple message template
  -- In a real implementation, this would be replaced with an AI call
  v_message := format(
    'Hi %s,

📝 Task: %s
🔴 Priority: %s
%s
%s

%s

Please confirm receipt and update status accordingly.

Thanks!',
    COALESCE(v_task_info.assignee_name, 'Team Member'),
    v_task_info.title,
    v_task_info.priority,
    CASE WHEN v_task_info.due_date IS NOT NULL THEN '🕒 Due: ' || to_char(v_task_info.due_date, 'DD Mon YYYY HH24:MI') ELSE '' END,
    CASE WHEN v_task_info.location IS NOT NULL THEN '📍 Location: ' || v_task_info.location ELSE '' END,
    v_task_info.description
  );
  
  RETURN v_message;
END;
$$;

-- Create a function to mark WhatsApp messages as sent
CREATE OR REPLACE FUNCTION mark_whatsapp_message_sent(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE notifications
  SET 
    whatsapp_sent = true,
    whatsapp_sent_at = now(),
    updated_at = now()
  WHERE 
    id = p_notification_id;
END;
$$;

-- Create a function to get unsent WhatsApp messages
CREATE OR REPLACE FUNCTION get_unsent_whatsapp_messages(p_limit int DEFAULT 100)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  task_id uuid,
  type text,
  title text,
  message text,
  whatsapp_number text,
  ai_generated_message text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    id,
    user_id,
    task_id,
    type,
    title,
    message,
    whatsapp_number,
    ai_generated_message
  FROM notifications
  WHERE 
    whatsapp_sent = false 
    AND whatsapp_number IS NOT NULL
    AND (scheduled_for IS NULL OR scheduled_for <= now())
  ORDER BY created_at ASC
  LIMIT p_limit;
$$;

-- Update the schedule_task_notifications function to generate WhatsApp messages
CREATE OR REPLACE FUNCTION schedule_task_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_assignee_id uuid;
  v_assignee_name text;
  v_task_title text;
  v_advance_notices interval[] := ARRAY['1 day', '6 hours', '2 hours', '1 hour', '30 minutes']::interval[];
  v_notice interval;
  v_old_assignee_id uuid;
  v_whatsapp_message text;
BEGIN
  -- Get task title
  v_task_title := NEW.title;

  -- Generate WhatsApp message for the task
  v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id);

  -- Handle INSERT (new task creation)
  IF TG_OP = 'INSERT' THEN
    -- Task assignment notification
    IF NEW.assigned_to IS NOT NULL THEN
      SELECT u.id, u.name INTO v_assignee_id, v_assignee_name
      FROM users u
      WHERE u.id = NEW.assigned_to;

      IF v_assignee_id IS NOT NULL THEN
        PERFORM create_notification(
          v_assignee_id,
          NEW.id,
          'task_assigned',
          'New Task Assigned',
          format('You have been assigned to: %s', v_task_title),
          NULL,
          NULL,
          v_whatsapp_message
        );
      END IF;
    END IF;

    -- Schedule multiple due date notifications
    IF NEW.due_date IS NOT NULL AND NEW.assigned_to IS NOT NULL THEN
      -- Loop through each advance notice interval
      FOREACH v_notice IN ARRAY v_advance_notices
      LOOP
        -- Only schedule if the notification time is in the future
        IF NEW.due_date - v_notice > now() THEN
          PERFORM create_notification(
            NEW.assigned_to,
            NEW.id,
            'task_due',
            format('Task Due in %s', v_notice::text),
            format('Task "%s" is due in %s', v_task_title, v_notice::text),
            NEW.due_date - v_notice,
            NULL,
            v_whatsapp_message
          );
        END IF;
      END LOOP;
    END IF;

  -- Handle UPDATE (task modifications)
  ELSIF TG_OP = 'UPDATE' THEN
    
    -- Task assignment change notification
    IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
      -- Notify new assignee
      IF NEW.assigned_to IS NOT NULL THEN
        SELECT u.id, u.name INTO v_assignee_id, v_assignee_name
        FROM users u
        WHERE u.id = NEW.assigned_to;

        IF v_assignee_id IS NOT NULL THEN
          PERFORM create_notification(
            v_assignee_id,
            NEW.id,
            'task_assigned',
            'Task Assigned to You',
            format('You have been assigned to: %s', v_task_title),
            NULL,
            NULL,
            v_whatsapp_message
          );
        END IF;
      END IF;

      -- Remove old due date notifications if assignee changed
      DELETE FROM notifications 
      WHERE task_id = NEW.id 
        AND type = 'task_due' 
        AND scheduled_for > now()
        AND user_id = OLD.assigned_to;

      -- Schedule new due date notifications for new assignee
      IF NEW.due_date IS NOT NULL AND NEW.assigned_to IS NOT NULL THEN
        FOREACH v_notice IN ARRAY v_advance_notices
        LOOP
          IF NEW.due_date - v_notice > now() THEN
            PERFORM create_notification(
              NEW.assigned_to,
              NEW.id,
              'task_due',
              format('Task Due in %s', v_notice::text),
              format('Task "%s" is due in %s', v_task_title, v_notice::text),
              NEW.due_date - v_notice,
              NULL,
              v_whatsapp_message
            );
          END IF;
        END LOOP;
      END IF;
    END IF;

    -- Task completion notification
    IF OLD.status != 'completed' AND NEW.status = 'completed' THEN
      -- Get creator ID from users table
      IF NEW.created_by IS NOT NULL THEN
        SELECT id INTO v_assignee_id
        FROM users
        WHERE auth_id = NEW.created_by;

        -- Notify the creator if different from assignee
        IF v_assignee_id IS NOT NULL AND v_assignee_id != NEW.assigned_to THEN
          PERFORM create_notification(
            v_assignee_id,
            NEW.id,
            'task_completed',
            'Task Completed',
            format('Task "%s" has been completed', v_task_title),
            NULL,
            NULL,
            v_whatsapp_message
          );
        END IF;
      END IF;

      -- Remove any pending due date notifications
      DELETE FROM notifications 
      WHERE task_id = NEW.id 
        AND type = 'task_due' 
        AND scheduled_for > now();
    END IF;

    -- Task update notification (for significant changes, excluding status to completed)
    IF (OLD.title IS DISTINCT FROM NEW.title OR
        OLD.description IS DISTINCT FROM NEW.description OR
        OLD.priority IS DISTINCT FROM NEW.priority OR
        OLD.due_date IS DISTINCT FROM NEW.due_date OR
        OLD.location IS DISTINCT FROM NEW.location) AND
       NEW.status != 'completed' THEN
      
      -- Notify assignee if they exist and are not the one making the change
      IF NEW.assigned_to IS NOT NULL THEN
        PERFORM create_notification(
          NEW.assigned_to,
          NEW.id,
          'task_updated',
          'Task Updated',
          format('Task "%s" has been updated', v_task_title),
          NULL,
          NULL,
          v_whatsapp_message
        );
      END IF;
    END IF;

    -- Due date change - reschedule notifications
    IF OLD.due_date IS DISTINCT FROM NEW.due_date AND NEW.assigned_to IS NOT NULL THEN
      -- Remove old due date notifications
      DELETE FROM notifications 
      WHERE task_id = NEW.id 
        AND type = 'task_due' 
        AND scheduled_for > now();

      -- Schedule new due date notifications if new due date exists
      IF NEW.due_date IS NOT NULL THEN
        FOREACH v_notice IN ARRAY v_advance_notices
        LOOP
          IF NEW.due_date - v_notice > now() THEN
            PERFORM create_notification(
              NEW.assigned_to,
              NEW.id,
              'task_due',
              format('Task Due in %s', v_notice::text),
              format('Task "%s" is due in %s', v_task_title, v_notice::text),
              NEW.due_date - v_notice,
              NULL,
              v_whatsapp_message
            );
          END IF;
        END LOOP;
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Update the schedule_task_message_notifications function to include WhatsApp messages
CREATE OR REPLACE FUNCTION schedule_task_message_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task_title text;
  v_task_assignee_id uuid;
  v_task_creator_id uuid;
  v_message_author_id uuid;
  v_author_name text;
  v_whatsapp_message text;
BEGIN
  -- Get task details
  SELECT title, assigned_to INTO v_task_title, v_task_assignee_id
  FROM tasks
  WHERE id = NEW.task_id;

  -- Generate WhatsApp message
  v_whatsapp_message := format(
    'New comment on task "%s": %s',
    v_task_title,
    NEW.message
  );

  -- Get task creator
  SELECT u.id INTO v_task_creator_id
  FROM tasks t
  JOIN users u ON u.auth_id = t.created_by
  WHERE t.id = NEW.task_id;

  -- Get message author details
  SELECT name INTO v_author_name
  FROM users
  WHERE id = NEW.user_id;

  v_message_author_id := NEW.user_id;

  -- Notify task assignee (if they didn't write the message)
  IF v_task_assignee_id IS NOT NULL AND v_task_assignee_id != v_message_author_id THEN
    PERFORM create_notification(
      v_task_assignee_id,
      NEW.task_id,
      'task_comment',
      'New Comment on Task',
      format('%s commented on task "%s"', v_author_name, v_task_title),
      NULL,
      NULL,
      v_whatsapp_message
    );
  END IF;

  -- Notify task creator (if they didn't write the message and are different from assignee)
  IF v_task_creator_id IS NOT NULL AND 
     v_task_creator_id != v_message_author_id AND 
     v_task_creator_id != v_task_assignee_id THEN
    PERFORM create_notification(
      v_task_creator_id,
      NEW.task_id,
      'task_comment',
      'New Comment on Task',
      format('%s commented on task "%s"', v_author_name, v_task_title),
      NULL,
      NULL,
      v_whatsapp_message
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create a function to manually generate WhatsApp messages for existing notifications
CREATE OR REPLACE FUNCTION generate_whatsapp_messages_for_existing_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notification record;
  v_whatsapp_message text;
  v_count integer := 0;
BEGIN
  -- Loop through notifications without AI messages but with WhatsApp numbers
  FOR v_notification IN 
    SELECT id, task_id
    FROM notifications
    WHERE ai_generated_message IS NULL
    AND whatsapp_number IS NOT NULL
    AND whatsapp_sent = false
  LOOP
    -- Generate WhatsApp message
    v_whatsapp_message := generate_whatsapp_message_for_task(v_notification.task_id);
    
    -- Update the notification
    UPDATE notifications
    SET ai_generated_message = v_whatsapp_message
    WHERE id = v_notification.id;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;