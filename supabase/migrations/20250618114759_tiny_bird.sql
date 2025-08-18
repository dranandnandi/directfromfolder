/*
  # Enhanced Notification System with Default Preferences

  1. Functions
    - Enhanced `schedule_task_notifications` with multiple due date reminders
    - New `schedule_task_message_notifications` for comment notifications
    - `initialize_default_notification_preferences` for setting up defaults
    - Improved `cleanup_notifications` for maintenance
    - Enhanced `create_notification` with duplicate prevention

  2. Triggers
    - Updated task notifications trigger
    - New task message notifications trigger

  3. Default Notification Schedule
    - Task assignments: Immediate
    - Task updates: Immediate
    - Task completions: Immediate
    - Task comments: Immediate
    - Task due reminders: 1 day, 6 hours, 2 hours, 1 hour, 30 minutes before due time
*/

-- Update the schedule_task_notifications function with enhanced logic
CREATE OR REPLACE FUNCTION schedule_task_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_assignee_id uuid;
  v_assignee_name text;
  v_task_title text;
  v_creator_id uuid;
  v_advance_notices interval[] := ARRAY['1 day', '6 hours', '2 hours', '1 hour', '30 minutes']::interval[];
  v_notice interval;
  v_old_assignee_id uuid;
BEGIN
  -- Get task title
  v_task_title := NEW.title;

  -- Get creator ID from users table
  IF NEW.created_by IS NOT NULL THEN
    SELECT id INTO v_creator_id
    FROM users
    WHERE auth_id = NEW.created_by;
  END IF;

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
          format('You have been assigned to: %s', v_task_title)
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
            NEW.due_date - v_notice
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
            format('You have been assigned to: %s', v_task_title)
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
              NEW.due_date - v_notice
            );
          END IF;
        END LOOP;
      END IF;
    END IF;

    -- Task completion notification
    IF OLD.status != 'completed' AND NEW.status = 'completed' THEN
      -- Notify the creator if different from assignee
      IF v_creator_id IS NOT NULL AND v_creator_id != NEW.assigned_to THEN
        PERFORM create_notification(
          v_creator_id,
          NEW.id,
          'task_completed',
          'Task Completed',
          format('Task "%s" has been completed', v_task_title)
        );
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
          format('Task "%s" has been updated', v_task_title)
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
              NEW.due_date - v_notice
            );
          END IF;
        END LOOP;
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for task message notifications
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
BEGIN
  -- Get task details
  SELECT title, assigned_to INTO v_task_title, v_task_assignee_id
  FROM tasks
  WHERE id = NEW.task_id;

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
      format('%s commented on task "%s"', v_author_name, v_task_title)
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
      format('%s commented on task "%s"', v_author_name, v_task_title)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for task message notifications
DROP TRIGGER IF EXISTS task_message_notifications_trigger ON task_messages;
CREATE TRIGGER task_message_notifications_trigger
  AFTER INSERT ON task_messages
  FOR EACH ROW
  EXECUTE FUNCTION schedule_task_message_notifications();

-- Update the existing task notifications trigger to use the enhanced function
DROP TRIGGER IF EXISTS task_notifications_trigger ON tasks;
CREATE TRIGGER task_notifications_trigger
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION schedule_task_notifications();

-- Function to initialize default notification preferences for a user
CREATE OR REPLACE FUNCTION initialize_default_notification_preferences(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_default_prefs record;
BEGIN
  -- Define default preferences
  FOR v_default_prefs IN 
    SELECT * FROM (VALUES
      ('task_assigned', true, '0 minutes'::interval),
      ('task_updated', true, '0 minutes'::interval),
      ('task_completed', true, '0 minutes'::interval),
      ('task_comment', true, '0 minutes'::interval),
      ('task_due', true, '1 day'::interval)
    ) AS defaults(pref_type, enabled, advance_notice)
  LOOP
    INSERT INTO notification_preferences (user_id, type, enabled, advance_notice)
    VALUES (p_user_id, v_default_prefs.pref_type, v_default_prefs.enabled, v_default_prefs.advance_notice)
    ON CONFLICT (user_id, type) DO NOTHING;
  END LOOP;
END;
$$;

-- Function to clean up old/invalid notifications (FIXED)
CREATE OR REPLACE FUNCTION cleanup_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count integer := 0;
  v_temp_count integer;
BEGIN
  -- Delete notifications for completed tasks that are older than 7 days
  DELETE FROM notifications
  WHERE task_id IN (
    SELECT id FROM tasks 
    WHERE status = 'completed' 
    AND completed_at < now() - interval '7 days'
  )
  AND type = 'task_due';

  GET DIAGNOSTICS v_temp_count = ROW_COUNT;
  v_deleted_count := v_deleted_count + v_temp_count;

  -- Delete old read notifications (older than 30 days)
  DELETE FROM notifications
  WHERE read = true 
  AND created_at < now() - interval '30 days';

  GET DIAGNOSTICS v_temp_count = ROW_COUNT;
  v_deleted_count := v_deleted_count + v_temp_count;

  RETURN v_deleted_count;
END;
$$;

-- Update the create_notification function to be more robust
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id uuid,
  p_task_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_scheduled_for timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notification_id uuid;
  v_preference_enabled boolean;
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
        scheduled_for
      )
      VALUES (
        p_user_id,
        p_task_id,
        p_type,
        p_title,
        p_message,
        p_scheduled_for
      )
      RETURNING id INTO v_notification_id;
    END IF;
  END IF;

  RETURN v_notification_id;
END;
$$;