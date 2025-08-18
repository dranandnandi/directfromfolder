/*
  # Add notifications system

  1. New Tables
    - `notifications`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `task_id` (uuid, references tasks)
      - `type` (text) - Type of notification (task_due, task_assigned, etc.)
      - `title` (text) - Notification title
      - `message` (text) - Notification message
      - `read` (boolean) - Whether notification has been read
      - `scheduled_for` (timestamptz) - When to send the notification
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    - `notification_preferences`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `type` (text) - Type of notification
      - `enabled` (boolean) - Whether this type is enabled
      - `advance_notice` (interval) - How far in advance to notify
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    - `device_tokens`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `token` (text) - FCM token
      - `device_type` (text) - Device type (android, ios, web)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Functions
    - Function to create notifications
    - Function to mark notifications as read
    - Function to schedule notifications for tasks

  3. Triggers
    - Trigger to create notifications on task creation
    - Trigger to create notifications on task assignment
    - Trigger to create notifications on task updates
*/

-- Create notifications table
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('task_due', 'task_assigned', 'task_updated', 'task_completed', 'task_comment')),
  title text NOT NULL,
  message text NOT NULL,
  read boolean DEFAULT false,
  scheduled_for timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create notification_preferences table
CREATE TABLE notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('task_due', 'task_assigned', 'task_updated', 'task_completed', 'task_comment')),
  enabled boolean DEFAULT true,
  advance_notice interval DEFAULT '1 day',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, type)
);

-- Create device_tokens table
CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL,
  device_type text NOT NULL CHECK (device_type IN ('android', 'ios', 'web')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (token)
);

-- Create indexes
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_task_id ON notifications(task_id);
CREATE INDEX idx_notifications_scheduled_for ON notifications(scheduled_for);
CREATE INDEX idx_notification_preferences_user_id ON notification_preferences(user_id);
CREATE INDEX idx_device_tokens_user_id ON device_tokens(user_id);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage their notification preferences"
  ON notification_preferences
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can manage their device tokens"
  ON device_tokens
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Create function to create notifications
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
    RETURNING enabled INTO v_preference_enabled;
  END IF;

  -- Only create notification if enabled
  IF v_preference_enabled THEN
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

-- Create function to mark notifications as read
CREATE OR REPLACE FUNCTION mark_notifications_read(p_notification_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE notifications
  SET 
    read = true,
    updated_at = now()
  WHERE 
    id = ANY(p_notification_ids)
    AND user_id = auth.uid();
END;
$$;

-- Create function to schedule task notifications
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
  -- Get assignee details
  SELECT u.id, u.name INTO v_assignee_id, v_assignee_name
  FROM users u
  WHERE u.id = NEW.assigned_to;

  -- Get task title
  v_task_title := NEW.title;

  -- Handle task assignment notification
  IF TG_OP = 'INSERT' OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
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

-- Create trigger for task notifications
CREATE TRIGGER task_notifications_trigger
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION schedule_task_notifications();