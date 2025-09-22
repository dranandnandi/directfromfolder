/*
  # Fix WhatsApp Number Bug in Task Notifications

  1. Problem
    - Variable name conflict: v_whatsapp_message used for both WhatsApp number and message text
    - WhatsApp number gets overwritten by message text
    - Results in NULL whatsapp_number in notifications table

  2. Solution
    - Use separate variables: v_whatsapp_number for phone number, v_whatsapp_message for message text
    - Fix all create_notification calls to pass correct WhatsApp number parameter
*/

-- Fix the schedule_task_notifications function with proper variable names
CREATE OR REPLACE FUNCTION schedule_task_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_assignee_id uuid;
  v_assignee_name text;
  v_whatsapp_number text;  -- Phone number
  v_whatsapp_message text; -- Message content
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
  
  -- Skip if no WhatsApp number or assignee not found
  IF v_whatsapp_number IS NULL THEN
    RETURN NEW;
  END IF;
  
  IF TG_OP = 'INSERT' THEN
    -- Task Assignment notification
    v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_assigned', NULL);
    
    PERFORM create_notification(
      v_assignee_id,
      NEW.id,
      'task_assigned',
      'New Task Assigned',
      format('You have been assigned to: %s', v_task_title),
      NULL,
      v_whatsapp_number,      -- Correct: Pass WhatsApp number
      v_whatsapp_message      -- Correct: Pass message content
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
        v_whatsapp_number,      -- Correct: Pass WhatsApp number
        v_whatsapp_message      -- Correct: Pass message content
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Update existing notifications that have NULL whatsapp_number
UPDATE notifications 
SET whatsapp_number = (
  SELECT u.whatsapp_number 
  FROM users u 
  WHERE u.id = notifications.user_id
)
WHERE whatsapp_number IS NULL 
  AND user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = notifications.user_id 
    AND u.whatsapp_number IS NOT NULL
  );
