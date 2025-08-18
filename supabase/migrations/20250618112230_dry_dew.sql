/*
  # Fix Notification RLS Policies

  1. Issues Fixed
    - RLS policies were comparing user_id (from public.users) with auth.uid() (from auth.users)
    - These are different UUIDs and the comparison always fails
    - Users cannot access their own notifications, preferences, or device tokens

  2. Changes
    - Create get_current_user_id() function to map auth.uid() to public.users.id
    - Update all RLS policies to use the correct user ID mapping
    - Fix mark_notifications_read function to use correct user ID

  3. Security
    - Maintain proper RLS while fixing the ID mapping issue
    - Ensure users can only access their own notification data
*/

-- Create function to get current user's ID from public.users table
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id
  FROM users
  WHERE auth_id = auth.uid()
  LIMIT 1;
$$;

-- Drop existing notification policies
DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;

-- Create corrected notification policies
CREATE POLICY "notifications_select_policy_v4"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = get_current_user_id());

-- Create INSERT policy for notifications (for system-generated notifications)
CREATE POLICY "notifications_insert_policy_v4"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (user_id = get_current_user_id());

-- Create UPDATE policy for notifications (for marking as read)
CREATE POLICY "notifications_update_policy_v4"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = get_current_user_id())
  WITH CHECK (user_id = get_current_user_id());

-- Drop existing notification preferences policies
DROP POLICY IF EXISTS "Users can manage their notification preferences" ON notification_preferences;

-- Create corrected notification preferences policies
CREATE POLICY "notification_preferences_policy_v4"
  ON notification_preferences
  FOR ALL
  TO authenticated
  USING (user_id = get_current_user_id())
  WITH CHECK (user_id = get_current_user_id());

-- Drop existing device tokens policies
DROP POLICY IF EXISTS "Users can manage their device tokens" ON device_tokens;

-- Create corrected device tokens policies
CREATE POLICY "device_tokens_policy_v4"
  ON device_tokens
  FOR ALL
  TO authenticated
  USING (user_id = get_current_user_id())
  WITH CHECK (user_id = get_current_user_id());

-- Fix the mark_notifications_read function
CREATE OR REPLACE FUNCTION mark_notifications_read(p_notification_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Get the current user's ID from public.users table
  SELECT get_current_user_id() INTO v_user_id;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found in users table';
  END IF;

  UPDATE notifications
  SET 
    read = true,
    updated_at = now()
  WHERE 
    id = ANY(p_notification_ids)
    AND user_id = v_user_id;
END;
$$;

-- Fix the create_notification function to handle user_id correctly
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

  -- If no preference exists, create default (enabled)
  IF v_preference_enabled IS NULL THEN
    INSERT INTO notification_preferences (user_id, type)
    VALUES (p_user_id, p_type)
    ON CONFLICT (user_id, type) DO NOTHING
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

  RETURN v_notification_id;
END;
$$;

-- Fix the schedule_task_notifications function to use correct user IDs
CREATE OR REPLACE FUNCTION schedule_task_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_assignee_id uuid;
  v_assignee_name text;
  v_task_title text;
  v_advance_notice interval;
BEGIN
  -- Only proceed if there's an assignee
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get assignee details (using the public.users.id directly)
  SELECT u.id, u.name INTO v_assignee_id, v_assignee_name
  FROM users u
  WHERE u.id = NEW.assigned_to;

  -- If assignee not found, skip notifications
  IF v_assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get task title
  v_task_title := NEW.title;

  -- Handle task assignment notification
  IF TG_OP = 'INSERT' OR (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to AND NEW.assigned_to IS NOT NULL) THEN
    PERFORM create_notification(
      v_assignee_id,
      NEW.id,
      'task_assigned',
      'New Task Assigned',
      format('You have been assigned to: %s', v_task_title)
    );
  END IF;

  -- Handle due date notification
  IF NEW.due_date IS NOT NULL THEN
    -- Get user's preferred advance notice
    SELECT advance_notice INTO v_advance_notice
    FROM notification_preferences
    WHERE user_id = v_assignee_id AND type = 'task_due'
    LIMIT 1;

    -- Use default if not set
    IF v_advance_notice IS NULL THEN
      v_advance_notice := interval '1 day';
    END IF;

    -- Schedule due date notification
    PERFORM create_notification(
      v_assignee_id,
      NEW.id,
      'task_due',
      'Task Due Soon',
      format('Task "%s" is due soon', v_task_title),
      NEW.due_date - v_advance_notice
    );
  END IF;

  RETURN NEW;
END;
$$;