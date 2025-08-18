/*
  # Dynamic WhatsApp Messages for Different Notification Types

  1. Changes
    - Update generate_whatsapp_message_for_task function to accept notification type and due interval
    - Modify the function to generate different messages based on notification context
    - Update schedule_task_notifications and schedule_task_message_notifications functions
    - Add support for different message templates based on notification type

  2. Benefits
    - More relevant and specific WhatsApp messages for each notification type
    - Better user experience with context-aware notifications
    - Support for different message formats based on notification urgency
*/

-- Drop the existing function to update it with new parameters
DROP FUNCTION IF EXISTS generate_whatsapp_message_for_task(uuid);

-- Create an enhanced function that accepts notification type and due interval
CREATE OR REPLACE FUNCTION generate_whatsapp_message_for_task(
  p_task_id uuid,
  p_notification_type text DEFAULT NULL,
  p_due_interval text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task_info record;
  v_message text;
  v_assignee_name text;
  v_task_title text;
  v_task_description text;
  v_task_priority text;
  v_task_due_date timestamptz;
  v_task_patient_id text;
  v_task_location text;
  v_task_type text;
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
  
  -- Set variables for easier access
  v_assignee_name := COALESCE(v_task_info.assignee_name, 'Team Member');
  v_task_title := v_task_info.title;
  v_task_description := v_task_info.description;
  v_task_priority := v_task_info.priority;
  v_task_due_date := v_task_info.due_date;
  v_task_patient_id := v_task_info.patient_id;
  v_task_location := v_task_info.location;
  v_task_type := v_task_info.type;
  
  -- Generate message based on notification type
  IF p_notification_type = 'task_due' THEN
    -- Task due notification with specific time interval
    v_message := format(
      'Hi %s,

⏰ REMINDER: Task due in %s
📝 Task: %s
🔴 Priority: %s
%s

%s

%s%s

Please confirm if you can complete this task on time or if you need assistance.

Thanks!',
      v_assignee_name,
      COALESCE(p_due_interval, ''),
      v_task_title,
      v_task_priority,
      CASE WHEN v_task_due_date IS NOT NULL THEN '🕒 Due: ' || to_char(v_task_due_date, 'DD Mon YYYY HH24:MI') ELSE '' END,
      v_task_description,
      CASE WHEN v_task_location IS NOT NULL AND v_task_location != '' THEN '📍 Location: ' || v_task_location || E'\n' ELSE '' END,
      CASE WHEN v_task_patient_id IS NOT NULL AND v_task_patient_id != '' THEN '👤 Patient ID: ' || v_task_patient_id || E'\n' ELSE '' END
    );
  ELSIF p_notification_type = 'task_assigned' THEN
    -- Task assignment notification
    v_message := format(
      'Hi %s,

✅ NEW TASK ASSIGNED
📝 Task: %s
🔴 Priority: %s
%s

%s

%s%s

Please acknowledge receipt of this task.

Thanks!',
      v_assignee_name,
      v_task_title,
      v_task_priority,
      CASE WHEN v_task_due_date IS NOT NULL THEN '🕒 Due: ' || to_char(v_task_due_date, 'DD Mon YYYY HH24:MI') ELSE '' END,
      v_task_description,
      CASE WHEN v_task_location IS NOT NULL AND v_task_location != '' THEN '📍 Location: ' || v_task_location || E'\n' ELSE '' END,
      CASE WHEN v_task_patient_id IS NOT NULL AND v_task_patient_id != '' THEN '👤 Patient ID: ' || v_task_patient_id || E'\n' ELSE '' END
    );
  ELSIF p_notification_type = 'task_updated' THEN
    -- Task update notification
    v_message := format(
      'Hi %s,

🔄 TASK UPDATED
📝 Task: %s
🔴 Priority: %s
%s

%s

%s%s

Please review the updated task details.

Thanks!',
      v_assignee_name,
      v_task_title,
      v_task_priority,
      CASE WHEN v_task_due_date IS NOT NULL THEN '🕒 Due: ' || to_char(v_task_due_date, 'DD Mon YYYY HH24:MI') ELSE '' END,
      v_task_description,
      CASE WHEN v_task_location IS NOT NULL AND v_task_location != '' THEN '📍 Location: ' || v_task_location || E'\n' ELSE '' END,
      CASE WHEN v_task_patient_id IS NOT NULL AND v_task_patient_id != '' THEN '👤 Patient ID: ' || v_task_patient_id || E'\n' ELSE '' END
    );
  ELSIF p_notification_type = 'task_completed' THEN
    -- Task completion notification
    v_message := format(
      'Hi %s,

✅ TASK COMPLETED
📝 Task: %s

The task has been marked as completed.

Thanks!',
      v_assignee_name,
      v_task_title
    );
  ELSIF p_notification_type = 'task_comment' THEN
    -- Task comment notification
    v_message := format(
      'Hi %s,

💬 NEW COMMENT
📝 Task: %s

A new comment has been added to this task. Please check the task details.

Thanks!',
      v_assignee_name,
      v_task_title
    );
  ELSE
    -- Default message (fallback)
    v_message := format(
      'Hi %s,

📝 Task: %s
🔴 Priority: %s
%s

%s

%s%s

Please confirm receipt and update status accordingly.

Thanks!',
      v_assignee_name,
      v_task_title,
      v_task_priority,
      CASE WHEN v_task_due_date IS NOT NULL THEN '🕒 Due: ' || to_char(v_task_due_date, 'DD Mon YYYY HH24:MI') ELSE '' END,
      v_task_description,
      CASE WHEN v_task_location IS NOT NULL AND v_task_location != '' THEN '📍 Location: ' || v_task_location || E'\n' ELSE '' END,
      CASE WHEN v_task_patient_id IS NOT NULL AND v_task_patient_id != '' THEN '👤 Patient ID: ' || v_task_patient_id || E'\n' ELSE '' END
    );
  END IF;
  
  RETURN v_message;
END;
$$;

-- Update the schedule_task_notifications function to use the new parameters
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

  -- Handle INSERT (new task creation)
  IF TG_OP = 'INSERT' THEN
    -- Task assignment notification
    IF NEW.assigned_to IS NOT NULL THEN
      SELECT u.id, u.name INTO v_assignee_id, v_assignee_name
      FROM users u
      WHERE u.id = NEW.assigned_to;

      IF v_assignee_id IS NOT NULL THEN
        -- Generate WhatsApp message for task assignment
        v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_assigned', NULL);
        
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
          -- Generate WhatsApp message for this specific due interval
          v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_due', v_notice::text);
          
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
          -- Generate WhatsApp message for task assignment
          v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_assigned', NULL);
          
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
            -- Generate WhatsApp message for this specific due interval
            v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_due', v_notice::text);
            
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
          -- Generate WhatsApp message for task completion
          v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_completed', NULL);
          
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
        -- Generate WhatsApp message for task update
        v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_updated', NULL);
        
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
            -- Generate WhatsApp message for this specific due interval
            v_whatsapp_message := generate_whatsapp_message_for_task(NEW.id, 'task_due', v_notice::text);
            
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

-- Update the schedule_task_message_notifications function to include notification type
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

  -- Generate WhatsApp message with specific notification type
  v_whatsapp_message := generate_whatsapp_message_for_task(NEW.task_id, 'task_comment', NULL);

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

-- Function to update existing notifications with the appropriate AI-generated messages
CREATE OR REPLACE FUNCTION update_existing_notification_messages()
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
    SELECT id, task_id, type, scheduled_for
    FROM notifications
    WHERE ai_generated_message IS NULL
    AND whatsapp_number IS NOT NULL
    AND whatsapp_sent = false
  LOOP
    -- Determine the due interval for task_due notifications
    DECLARE
      v_due_interval text := NULL;
    BEGIN
      IF v_notification.type = 'task_due' AND v_notification.scheduled_for IS NOT NULL THEN
        -- Get the task due date
        DECLARE
          v_task_due_date timestamptz;
          v_interval interval;
        BEGIN
          SELECT due_date INTO v_task_due_date
          FROM tasks
          WHERE id = v_notification.task_id;
          
          IF v_task_due_date IS NOT NULL THEN
            v_interval := v_task_due_date - v_notification.scheduled_for;
            
            -- Convert interval to text representation
            IF v_interval = interval '1 day' THEN
              v_due_interval := '1 day';
            ELSIF v_interval = interval '6 hours' THEN
              v_due_interval := '6 hours';
            ELSIF v_interval = interval '2 hours' THEN
              v_due_interval := '2 hours';
            ELSIF v_interval = interval '1 hour' THEN
              v_due_interval := '1 hour';
            ELSIF v_interval = interval '30 minutes' THEN
              v_due_interval := '30 minutes';
            END IF;
          END IF;
        END;
      END IF;
      
      -- Generate WhatsApp message with appropriate type and interval
      v_whatsapp_message := generate_whatsapp_message_for_task(
        v_notification.task_id, 
        v_notification.type,
        v_due_interval
      );
      
      -- Update the notification
      UPDATE notifications
      SET ai_generated_message = v_whatsapp_message
      WHERE id = v_notification.id;
      
      v_count := v_count + 1;
    END;
  END LOOP;
  
  RETURN v_count;
END;
$$;

-- Execute the function to update existing notifications
SELECT update_existing_notification_messages();