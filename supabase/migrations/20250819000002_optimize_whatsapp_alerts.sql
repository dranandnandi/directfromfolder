/*
  # Optimized WhatsApp Alerts Configuration
  
  This migration optimizes the WhatsApp notification system to reduce noise
  and focus on high-priority alerts based on the specified plan:
  
  🔴 High Priority (Immediate WhatsApp):
  - Task Assignments (immediate)
  - Urgent/Critical Tasks (immediate) 
  - Task Overdue (once + daily, not every 2h)
  
  🟠 Medium Priority (Consolidated WhatsApp):
  - Task Due Reminders (1 day before + 1 hour before only)
  - Task Status Updates (completion, significant changes)
  - Leave Requests (new/approved/rejected)
  
  🟢 Low Priority (Digest Only):
  - Task Comments (daily digest, no immediate WhatsApp)
*/

-- Add missing columns to tasks table if they don't exist
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_alert_count integer DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_overdue_alert_at timestamp with time zone;

-- Drop existing functions if they exist to avoid parameter conflicts
DROP FUNCTION IF EXISTS generate_whatsapp_message_for_task(uuid, text);
DROP FUNCTION IF EXISTS generate_whatsapp_message_for_task(uuid, text, text);
DROP FUNCTION IF EXISTS create_notification(uuid, uuid, text, text, text, timestamp with time zone, text, text);

-- Create a simple function to generate WhatsApp messages
CREATE OR REPLACE FUNCTION generate_whatsapp_message_for_task(
  p_task_id uuid,
  p_notification_type text,
  p_advance_notice text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task record;
  v_assignee_name text;
  v_message text;
BEGIN
  -- Get task details
  SELECT t.title, t.description, t.priority, t.due_date
  INTO v_task
  FROM tasks t
  WHERE t.id = p_task_id;
  
  -- Get assignee name (simplified - get first assignee)
  SELECT u.name INTO v_assignee_name
  FROM users u
  JOIN tasks t ON t.assigned_to = u.id
  WHERE t.id = p_task_id
  LIMIT 1;
  
  -- Generate message based on type
  CASE p_notification_type
    WHEN 'task_assigned' THEN
      v_message := format('Hi %s, you have been assigned a new task: %s', 
                         COALESCE(v_assignee_name, 'User'), v_task.title);
    WHEN 'task_urgent' THEN
      v_message := format('URGENT: %s - Priority: %s', v_task.title, v_task.priority);
    WHEN 'task_due' THEN
      v_message := format('Reminder: %s is due in %s', v_task.title, COALESCE(p_advance_notice, 'soon'));
    WHEN 'task_overdue' THEN
      v_message := format('OVERDUE: %s - Please complete ASAP', v_task.title);
    WHEN 'task_completed' THEN
      v_message := format('Task completed: %s', v_task.title);
    WHEN 'task_updated' THEN
      v_message := format('Task updated: %s', v_task.title);
    ELSE
      v_message := format('Notification about task: %s', v_task.title);
  END CASE;
  
  RETURN v_message;
END;
$$;

-- Create a simplified notification creation function
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id uuid,
  p_task_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_scheduled_for timestamp with time zone DEFAULT NULL,
  p_whatsapp_number text DEFAULT NULL,
  p_ai_generated_message text DEFAULT NULL
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
    scheduled_for,
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
    p_scheduled_for,
    p_whatsapp_number,
    p_ai_generated_message,
    NOW()
  )
  RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$;

-- Update the schedule_task_notifications function with optimized timing
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
  v_whatsapp_message text;
  -- OPTIMIZED: Only 1 day and 1 hour reminders (removed 6h, 2h, 30min)
  v_advance_notices interval[] := ARRAY['1 day', '1 hour']::interval[];
  v_notice interval;
BEGIN
  -- Only process INSERT (new tasks) and significant UPDATEs
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (
    OLD.assigned_to IS DISTINCT FROM NEW.assigned_to OR
    OLD.due_date IS DISTINCT FROM NEW.due_date OR
    OLD.priority IS DISTINCT FROM NEW.priority OR
    OLD.status IS DISTINCT FROM NEW.status
  )) THEN
    
    v_task_title := NEW.title;
    
    -- Get assignees for the task
    IF NEW.assigned_to IS NOT NULL THEN
      v_assignee_id := NEW.assigned_to;
      
      -- Get assignee details including WhatsApp number
      SELECT u.name, u.whatsapp_number
      INTO v_assignee_name, v_whatsapp_message
      FROM users u
      WHERE u.id = v_assignee_id;
      
      -- Skip if no WhatsApp number or assignee not found
      IF v_whatsapp_message IS NULL THEN
        RETURN NEW;
      END IF;
      
      IF TG_OP = 'INSERT' THEN
        -- 🔴 HIGH PRIORITY: Task Assignment (immediate WhatsApp)
        v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_assigned', NULL);
        
        PERFORM create_notification(
          v_assignee_id,
          NEW.id,
          'task_assigned',
          'New Task Assigned',
          format('You have been assigned: %s', v_task_title),
          NULL,
          v_whatsapp_message,
          v_whatsapp_message
        );
        
        -- 🔴 HIGH PRIORITY: Urgent/Critical Tasks (immediate WhatsApp)
        IF NEW.priority IN ('high', 'critical') THEN
          v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_urgent', NULL);
          
          PERFORM create_notification(
            v_assignee_id,
            NEW.id,
            'task_urgent',
            'URGENT Task Assigned',
            format('URGENT: %s - Priority: %s', v_task_title, NEW.priority),
            NULL,
            v_whatsapp_message,
            v_whatsapp_message
          );
        END IF;
        
        -- 🟠 MEDIUM PRIORITY: Task Due Reminders (only 1 day and 1 hour)
        IF NEW.due_date IS NOT NULL THEN
          FOREACH v_notice IN ARRAY v_advance_notices
          LOOP
            v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_due', v_notice::text);
            
            PERFORM create_notification(
              v_assignee_id,
              NEW.id,
              'task_due',
              format('Task Due in %s', v_notice),
              format('Reminder: %s is due in %s', v_task_title, v_notice),
              NEW.due_date - v_notice,
              v_whatsapp_message,
              v_whatsapp_message
            );
          END LOOP;
        END IF;
        
      ELSIF TG_OP = 'UPDATE' THEN
        -- 🟠 MEDIUM PRIORITY: Significant Task Updates
        IF OLD.status != NEW.status AND NEW.status = 'completed' THEN
          -- Task completion notification
          v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_completed', NULL);
          
          PERFORM create_notification(
            v_assignee_id,
            NEW.id,
            'task_completed',
            'Task Completed',
            format('Task completed: %s', v_task_title),
            NULL,
            v_whatsapp_message,
            v_whatsapp_message
          );
        END IF;
        
        -- Significant changes (reassignment, due date change, priority change)
        IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to OR
           OLD.due_date IS DISTINCT FROM NEW.due_date OR
           OLD.priority IS DISTINCT FROM NEW.priority THEN
          
          v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_updated', NULL);
          
          PERFORM create_notification(
            v_assignee_id,
            NEW.id,
            'task_updated',
            'Task Updated',
            format('Task updated: %s', v_task_title),
            NULL,
            v_whatsapp_message,
            v_whatsapp_message
          );
        END IF;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Update the overdue alerts function with optimized frequency
CREATE OR REPLACE FUNCTION schedule_overdue_task_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task record;
  v_assignee record;
  v_overdue_message text;
  v_whatsapp_message text;
  v_hours_overdue integer;
  v_notification_id uuid;
  v_alert_count integer := 0;
BEGIN
  -- 🔴 OPTIMIZED: Overdue alerts - once when overdue + daily reminders (not every 2h)
  FOR v_task IN
    SELECT 
      t.id,
      t.title,
      t.description,
      t.due_date,
      t.priority,
      t.patient_id,
      t.location,
      t.overdue_alert_count,
      t.last_overdue_alert_at,
      EXTRACT(EPOCH FROM (NOW() - t.due_date))/3600 as hours_overdue
    FROM tasks t
    WHERE t.status != 'completed'
      AND t.due_date IS NOT NULL
      AND t.due_date < NOW()
      AND (
        -- First overdue alert (immediate)
        t.overdue_alert_count = 0 OR 
        -- Daily reminders only (not every 2h)
        (t.overdue_alert_count > 0 AND t.last_overdue_alert_at < NOW() - INTERVAL '1 day')
      )
  LOOP
    v_hours_overdue := FLOOR(v_task.hours_overdue);
    
    -- Get assignee for this task (simplified - use assigned_to field)
    IF v_task.id IS NOT NULL THEN
      SELECT 
        t.assigned_to as user_id,
        u.name,
        u.whatsapp_number
      INTO v_assignee
      FROM tasks t
      JOIN users u ON t.assigned_to = u.id
      WHERE t.id = v_task.id
        AND u.whatsapp_number IS NOT NULL;
      
      -- Skip if no assignee or WhatsApp number
      IF v_assignee.user_id IS NULL OR v_assignee.whatsapp_number IS NULL THEN
        CONTINUE;
      END IF;
      -- Generate overdue message
      v_overdue_message := format(
        '⚠️ OVERDUE TASK ALERT
        
Task: %s
Overdue by: %s hours
Priority: %s
Due: %s

%s

Please complete ASAP or contact your supervisor.',
        v_task.title,
        v_hours_overdue,
        v_task.priority,
        to_char(v_task.due_date, 'DD Mon YYYY HH24:MI'),
        v_task.description
      );

      -- Generate WhatsApp message
      v_whatsapp_message := format(
        'Hi %s,

⚠️ URGENT: OVERDUE TASK

📝 Task: %s
🔴 Priority: %s
⏰ Overdue by: %s hours
🕒 Was due: %s

%s

This task is now OVERDUE. Please complete it immediately or contact your supervisor.

Thanks!',
        v_assignee.name,
        v_task.title,
        v_task.priority,
        v_hours_overdue,
        to_char(v_task.due_date, 'DD Mon YYYY HH24:MI'),
        v_task.description
      );

      -- Create notification with immediate WhatsApp
      v_notification_id := create_notification(
        v_assignee.user_id,
        v_task.id,
        'task_overdue',
        'Overdue Task Alert',
        v_overdue_message,
        NULL,
        v_assignee.whatsapp_number,
        v_whatsapp_message
      );

      IF v_notification_id IS NOT NULL THEN
        v_alert_count := v_alert_count + 1;
      END IF;
    END IF;

    -- Update task overdue tracking
    UPDATE tasks 
    SET 
      overdue_alert_count = overdue_alert_count + 1,
      last_overdue_alert_at = NOW()
    WHERE id = v_task.id;
  END LOOP;

  RETURN v_alert_count;
END;
$$;

-- Update task comment notifications to be digest-only (no immediate WhatsApp)
CREATE OR REPLACE FUNCTION schedule_task_message_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task_assignee_id uuid;
  v_task_creator_id uuid;
  v_message_author_id uuid;
  v_author_name text;
  v_task_title text;
  v_assignee_whatsapp text;
  v_creator_whatsapp text;
BEGIN
  -- Get task and message details
  SELECT t.assigned_to, t.created_by, t.title
  INTO v_task_assignee_id, v_task_creator_id, v_task_title
  FROM tasks t
  WHERE t.id = NEW.task_id;
  
  -- Get message author details
  SELECT u.id, u.name
  INTO v_message_author_id, v_author_name
  FROM users u
  WHERE u.id = NEW.user_id;
  
  -- 🟢 LOW PRIORITY: Task Comments - NO IMMEDIATE WHATSAPP (digest only)
  -- Create in-app notifications only, no WhatsApp alerts
  
  -- Notify task assignee (if they didn't write the message)
  IF v_task_assignee_id IS NOT NULL AND v_task_assignee_id != v_message_author_id THEN
    PERFORM create_notification(
      v_task_assignee_id,
      NEW.task_id,
      'task_comment',
      'New Comment on Task',
      format('%s commented on task "%s"', v_author_name, v_task_title),
      NULL,
      NULL, -- No WhatsApp number = no immediate WhatsApp
      NULL  -- No AI message = digest only
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
      NULL, -- No WhatsApp number = no immediate WhatsApp
      NULL  -- No AI message = digest only
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Update notification preferences to reflect the optimized plan
-- Only update if the table exists
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'notification_preferences') THEN
    -- Disable immediate WhatsApp for low-priority notifications
    UPDATE notification_preferences 
    SET enabled = false
    WHERE type = 'task_comment'; -- Comments become digest-only
    
    -- Add new notification types for the optimized system
    INSERT INTO notification_preferences (user_id, type, enabled, advance_notice)
    SELECT 
      u.id,
      notification_type,
      CASE 
        WHEN notification_type IN ('task_assigned', 'task_urgent', 'task_overdue') THEN true -- High priority
        WHEN notification_type IN ('task_due', 'task_completed', 'task_updated', 'leave_request_new', 'leave_request_approved', 'leave_request_rejected') THEN true -- Medium priority
        ELSE false -- Low priority (digest only)
      END,
      '0 minutes'
    FROM users u
    CROSS JOIN (
      VALUES 
        ('task_urgent'), -- New type for high/critical priority tasks
        ('task_assigned'),
        ('task_overdue'),
        ('task_due'),
        ('task_completed'),
        ('task_updated'),
        ('leave_request_new'),
        ('leave_request_approved'),
        ('leave_request_rejected'),
        ('task_comment') -- Will be disabled for immediate WhatsApp
    ) AS nt(notification_type)
    WHERE NOT EXISTS (
      SELECT 1 FROM notification_preferences np
      WHERE np.user_id = u.id AND np.type = nt.notification_type
    )
    ON CONFLICT (user_id, type) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      updated_at = NOW();
  END IF;
END $$;

-- Create a function to get optimized notification summary
CREATE OR REPLACE FUNCTION get_whatsapp_optimization_summary()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'high_priority_immediate', json_build_object(
      'task_assigned', 'Immediate WhatsApp when tasks assigned',
      'task_urgent', 'Immediate WhatsApp for high/critical priority tasks',
      'task_overdue', 'Once when overdue + daily reminders (not every 2h)'
    ),
    'medium_priority_consolidated', json_build_object(
      'task_due', 'Only 1 day before + 1 hour before (removed 6h, 2h, 30min)',
      'task_completed', 'WhatsApp when tasks completed',
      'task_updated', 'WhatsApp for significant changes (reassignment, due date, priority)',
      'leave_requests', 'WhatsApp for new requests and approvals/rejections'
    ),
    'low_priority_digest_only', json_build_object(
      'task_comment', 'Daily digest only, no immediate WhatsApp'
    ),
    'optimizations_applied', json_build_array(
      'Reduced due reminders from 5 to 2 (1 day + 1 hour)',
      'Changed overdue from every 2h to once + daily',
      'Made comments digest-only (no immediate WhatsApp)',
      'Added urgent task immediate alerts for high/critical priority',
      'Consolidated status updates to significant changes only'
    ),
    'timestamp', NOW()
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_whatsapp_optimization_summary() TO authenticated;
