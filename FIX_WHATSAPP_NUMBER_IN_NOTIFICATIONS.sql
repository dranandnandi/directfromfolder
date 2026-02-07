-- FIX: WhatsApp number not being populated in notifications
-- Run this in Supabase SQL Editor

-- 1. Fix existing notifications with NULL whatsapp_number
UPDATE notifications 
SET whatsapp_number = u.whatsapp_number
FROM users u
WHERE notifications.user_id = u.id
  AND notifications.whatsapp_number IS NULL 
  AND u.whatsapp_number IS NOT NULL;

-- 2. Recreate the trigger function to properly populate whatsapp_number
CREATE OR REPLACE FUNCTION schedule_task_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_assignee_id uuid;
  v_assignee_name text;
  v_whatsapp_number text;
  v_whatsapp_message text;
  v_task_title text;
BEGIN
  -- Skip if task is not assigned to anyone
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;
    
  v_task_title := NEW.title;
  v_assignee_id := NEW.assigned_to;
  
  -- Get assignee details including WhatsApp number
  SELECT u.name, u.whatsapp_number
  INTO v_assignee_name, v_whatsapp_number
  FROM users u
  WHERE u.id = v_assignee_id;
  
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
    -- Generate WhatsApp message
    v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_assigned', NULL);
    
    -- Create notification with WhatsApp number
    PERFORM create_notification(
      v_assignee_id,
      NEW.id,
      'task_assigned',
      'New Task Assigned',
      format('You have been assigned to: %s', v_task_title),
      NULL,
      v_whatsapp_number,
      v_whatsapp_message
    );
    
    -- High priority tasks get urgent notification
    IF NEW.priority IN ('high', 'critical') THEN
      v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_urgent', NULL);
      
      PERFORM create_notification(
        v_assignee_id,
        NEW.id,
        'task_urgent',
        'URGENT Task Assigned',
        format('🚨 URGENT: %s', v_task_title),
        NULL,
        v_whatsapp_number,
        v_whatsapp_message
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Verify the create_notification function has correct signature
-- It should accept 8 parameters: user_id, task_id, type, title, message, scheduled_for, whatsapp_number, ai_generated_message
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
  v_user_whatsapp text;
  v_user_org_id uuid;
  v_org_whatsapp_enabled boolean;
  v_org_auto_alerts_enabled boolean;
BEGIN
  -- Check if user has enabled this notification type
  SELECT enabled INTO v_preference_enabled
  FROM notification_preferences
  WHERE user_id = p_user_id AND type = p_type;

  -- If no preference exists, default to enabled
  IF v_preference_enabled IS NULL THEN
    INSERT INTO notification_preferences (user_id, type, enabled)
    VALUES (p_user_id, p_type, true)
    ON CONFLICT (user_id, type) DO NOTHING;
    v_preference_enabled := true;
  END IF;

  -- Only create notification if enabled
  IF COALESCE(v_preference_enabled, true) THEN
    -- Get user's WhatsApp number if not provided
    IF p_whatsapp_number IS NULL THEN
      SELECT whatsapp_number, organization_id 
      INTO v_user_whatsapp, v_user_org_id
      FROM users 
      WHERE id = p_user_id;
    ELSE
      v_user_whatsapp := p_whatsapp_number;
      SELECT organization_id INTO v_user_org_id FROM users WHERE id = p_user_id;
    END IF;
    
    -- Get organization WhatsApp settings
    SELECT 
      COALESCE(whatsapp_enabled, false),
      COALESCE(auto_alerts_enabled, false)
    INTO v_org_whatsapp_enabled, v_org_auto_alerts_enabled
    FROM organizations
    WHERE id = v_user_org_id;

    -- Insert notification with all fields
    INSERT INTO notifications (
      user_id,
      task_id,
      type,
      title,
      message,
      scheduled_for,
      whatsapp_number,
      ai_generated_message,
      whatsapp_sent,
      org_whatsapp_enabled,
      org_auto_alerts_enabled
    )
    VALUES (
      p_user_id,
      p_task_id,
      p_type,
      p_title,
      p_message,
      p_scheduled_for,
      v_user_whatsapp,
      p_ai_generated_message,
      false,
      v_org_whatsapp_enabled,
      v_org_auto_alerts_enabled
    )
    RETURNING id INTO v_notification_id;
  END IF;

  RETURN v_notification_id;
END;
$$;

-- 4. Show count of fixed notifications
SELECT COUNT(*) as fixed_notifications 
FROM notifications 
WHERE whatsapp_number IS NOT NULL;
