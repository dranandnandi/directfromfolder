/*
  # Enhanced WhatsApp Integration and Overdue Task Alerts
  
  1. New Columns
    - `whatsapp_message_id` (text): Track message ID from WhatsApp API
    - `whatsapp_error` (text): Store error messages for failed WhatsApp sends
    - `overdue_alert_count` (integer): Track how many overdue alerts sent
    
  2. New Functions
    - `schedule_overdue_task_alerts()`: Create overdue alerts for tasks
    - `send_whatsapp_notification()`: Helper function to queue WhatsApp messages
    
  3. New Triggers
    - Overdue task alert scheduler (runs via cron or manual trigger)
    
  4. Leave Request Alerts
    - Add WhatsApp support for leave management notifications
*/

-- Add missing WhatsApp tracking columns
ALTER TABLE notifications 
  ADD COLUMN IF NOT EXISTS whatsapp_message_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_error text,
  ADD COLUMN IF NOT EXISTS overdue_alert_count integer DEFAULT 0;

-- Add overdue tracking to tasks table
ALTER TABLE tasks 
  ADD COLUMN IF NOT EXISTS overdue_alert_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_overdue_alert_at timestamptz;

-- Create index for overdue task queries
CREATE INDEX IF NOT EXISTS idx_tasks_overdue ON tasks(due_date, status, overdue_alert_count) 
  WHERE status != 'completed' AND due_date IS NOT NULL;

-- Function to schedule overdue task alerts
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
  -- Find overdue tasks that need alerts
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
        t.overdue_alert_count = 0 OR 
        (t.overdue_alert_count < 12 AND t.last_overdue_alert_at < NOW() - INTERVAL '2 hours') OR
        (t.overdue_alert_count >= 12 AND t.last_overdue_alert_at < NOW() - INTERVAL '1 day')
      )
  LOOP
    v_hours_overdue := FLOOR(v_task.hours_overdue);
    
    -- Get assignees for this task
    FOR v_assignee IN
      SELECT 
        ta.user_id,
        u.name,
        u.whatsapp_number
      FROM task_assignees ta
      JOIN users u ON ta.user_id = u.id
      WHERE ta.task_id = v_task.id
        AND u.whatsapp_number IS NOT NULL
    LOOP
      -- Generate overdue message
      v_overdue_message := format(
        '⚠️ OVERDUE TASK ALERT #%s
        
Task: %s
Overdue by: %s hours
Priority: %s
%s
%s

Please complete ASAP or contact your supervisor for assistance.',
        v_task.overdue_alert_count + 1,
        v_task.title,
        v_hours_overdue,
        v_task.priority,
        CASE WHEN v_task.due_date IS NOT NULL THEN 'Due: ' || to_char(v_task.due_date, 'DD Mon YYYY HH24:MI') ELSE '' END,
        v_task.description
      );

      -- Generate WhatsApp message
      v_whatsapp_message := format(
        'Hi %s,

⚠️ URGENT: OVERDUE TASK ALERT #%s

📝 Task: %s
🔴 Priority: %s
⏰ Overdue by: %s hours
🕒 Was due: %s

%s

This task is now OVERDUE. Please complete it immediately or contact your supervisor if you need assistance.

Thanks!',
        v_assignee.name,
        v_task.overdue_alert_count + 1,
        v_task.title,
        v_task.priority,
        v_hours_overdue,
        to_char(v_task.due_date, 'DD Mon YYYY HH24:MI'),
        v_task.description
      );

      -- Create notification
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
    END LOOP;

    -- Update task overdue tracking
    UPDATE tasks 
    SET 
      overdue_alert_count = overdue_alert_count + 1,
      last_overdue_alert_at = NOW()
    WHERE id = v_task.id;
  END LOOP;

  -- Log the batch result
  INSERT INTO notification_logs (batch_type, processed_count, created_at)
  VALUES ('overdue_alerts', v_alert_count, NOW());

  RETURN v_alert_count;
END;
$$;

-- Function to handle leave request notifications
CREATE OR REPLACE FUNCTION create_leave_request_notification(
  p_leave_request_id uuid,
  p_employee_id uuid,
  p_manager_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_reason text,
  p_status text DEFAULT 'pending'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_employee_name text;
  v_manager_name text;
  v_manager_whatsapp text;
  v_employee_whatsapp text;
  v_notification_title text;
  v_notification_message text;
  v_whatsapp_message text;
BEGIN
  -- Get employee and manager details
  SELECT name, whatsapp_number INTO v_employee_name, v_employee_whatsapp
  FROM users WHERE id = p_employee_id;
  
  SELECT name, whatsapp_number INTO v_manager_name, v_manager_whatsapp
  FROM users WHERE id = p_manager_id;

  IF p_status = 'pending' THEN
    -- New leave request - notify manager
    v_notification_title := 'New Leave Request';
    v_notification_message := format(
      '%s has submitted a leave request for %s from %s to %s. Reason: %s',
      v_employee_name,
      p_leave_type,
      p_start_date,
      p_end_date,
      p_reason
    );

    v_whatsapp_message := format(
      'Hi %s,

📋 NEW LEAVE REQUEST

👤 Employee: %s
📅 Type: %s
🗓️ From: %s
🗓️ To: %s
📝 Reason: %s

Please review and approve/reject this request.

Thanks!',
      v_manager_name,
      v_employee_name,
      p_leave_type,
      p_start_date,
      p_end_date,
      p_reason
    );

    -- Notify manager
    IF v_manager_whatsapp IS NOT NULL THEN
      PERFORM create_notification(
        p_manager_id,
        NULL, -- No task ID for leave requests
        'leave_request_new',
        v_notification_title,
        v_notification_message,
        NULL,
        v_manager_whatsapp,
        v_whatsapp_message
      );
    END IF;

  ELSIF p_status IN ('approved', 'rejected') THEN
    -- Leave request decision - notify employee
    v_notification_title := format('Leave Request %s', UPPER(p_status));
    v_notification_message := format(
      'Your leave request for %s from %s to %s has been %s',
      p_leave_type,
      p_start_date,
      p_end_date,
      p_status
    );

    v_whatsapp_message := format(
      'Hi %s,

📋 LEAVE REQUEST UPDATE

🗓️ Leave: %s (%s to %s)
✅ Status: %s

%s

Thanks!',
      v_employee_name,
      p_leave_type,
      p_start_date,
      p_end_date,
      UPPER(p_status),
      CASE 
        WHEN p_status = 'approved' THEN 'Your leave has been approved. Enjoy your time off!'
        ELSE 'Please contact your manager for more details.'
      END
    );

    -- Notify employee
    IF v_employee_whatsapp IS NOT NULL THEN
      PERFORM create_notification(
        p_employee_id,
        NULL,
        'leave_request_' || p_status,
        v_notification_title,
        v_notification_message,
        NULL,
        v_employee_whatsapp,
        v_whatsapp_message
      );
    END IF;
  END IF;
END;
$$;

-- Create notification logs table for tracking batch operations
CREATE TABLE IF NOT EXISTS notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_type text NOT NULL,
  processed_count integer DEFAULT 0,
  success_count integer DEFAULT 0,
  error_count integer DEFAULT 0,
  details jsonb,
  created_at timestamptz DEFAULT NOW()
);

-- Add RLS policy for notification logs
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_logs_policy" ON notification_logs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Update notification preferences to include new types
INSERT INTO notification_preferences (user_id, type, enabled, advance_notice)
SELECT 
  u.id,
  notification_type,
  true, -- Enable by default
  '0 minutes'
FROM users u
CROSS JOIN (
  VALUES 
    ('task_overdue'),
    ('leave_request_new'),
    ('leave_request_approved'),
    ('leave_request_rejected')
) AS nt(notification_type)
WHERE NOT EXISTS (
  SELECT 1 FROM notification_preferences np
  WHERE np.user_id = u.id AND np.type = nt.notification_type
);

-- Function to manually trigger overdue alerts (can be called via API)
CREATE OR REPLACE FUNCTION trigger_overdue_alerts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result integer;
BEGIN
  v_result := schedule_overdue_task_alerts();
  
  RETURN json_build_object(
    'success', true,
    'alerts_created', v_result,
    'timestamp', NOW()
  );
END;
$$;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_whatsapp_pending 
  ON notifications(whatsapp_sent, scheduled_for, created_at)
  WHERE whatsapp_sent = false AND whatsapp_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assignees_whatsapp 
  ON task_assignees(task_id, user_id);

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION schedule_overdue_task_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION create_leave_request_notification(uuid, uuid, uuid, text, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_overdue_alerts() TO authenticated;
