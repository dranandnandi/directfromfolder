/*
  # Fix WhatsApp Number Population in Notifications

  1. Changes
    - Update the create_notification function to correctly fetch recipient's WhatsApp number
    - Ensure WhatsApp number is always populated for the notification recipient
    - Fix issue where assignee's WhatsApp number wasn't being sent in notifications table

  2. Security
    - Maintain existing security model
    - No changes to RLS policies
*/

-- Drop the existing create_notification function
DROP FUNCTION IF EXISTS create_notification(uuid, uuid, text, text, text, timestamptz, text, text);

-- Recreate the create_notification function with updated logic
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
  v_recipient_whatsapp text; -- Renamed to clearly indicate it's the recipient's WhatsApp
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
    -- Get the WhatsApp number for the recipient (p_user_id) if not explicitly provided
    IF p_whatsapp_number IS NULL THEN
      SELECT whatsapp_number INTO v_recipient_whatsapp
      FROM users
      WHERE id = p_user_id;
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
        COALESCE(p_whatsapp_number, v_recipient_whatsapp), -- Use recipient's whatsapp_number
        p_ai_generated_message,
        false
      )
      RETURNING id INTO v_notification_id;
    END IF;
  END IF;

  RETURN v_notification_id;
END;
$$;

-- Create a function to update existing notifications with missing WhatsApp numbers
CREATE OR REPLACE FUNCTION update_missing_whatsapp_numbers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Update notifications that have a user_id but no whatsapp_number
  UPDATE notifications n
  SET whatsapp_number = u.whatsapp_number
  FROM users u
  WHERE n.user_id = u.id
    AND n.whatsapp_number IS NULL
    AND u.whatsapp_number IS NOT NULL;
    
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  RETURN v_count;
END;
$$;

-- Execute the function to update existing notifications
SELECT update_missing_whatsapp_numbers();