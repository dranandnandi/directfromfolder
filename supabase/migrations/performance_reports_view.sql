/*
  # Performance Reports Optimization View

  This view consolidates all performance metrics into a single query
  to replace multiple API calls per user with one efficient query.

  Metrics included:
  - Task performance (tasks, personal_tasks)
  - Attendance metrics (attendance table)
  - Leave behavior (tasks with leave requests)
  - Conversation quality (conversation_logs, conversation_analysis)
  - Overall HR scoring

  Usage: SELECT * FROM performance_metrics_view WHERE organization_id = ? AND period_start >= ? AND period_end <= ?
*/

-- Create comprehensive performance metrics view
CREATE OR REPLACE VIEW performance_metrics_view AS
SELECT 
  u.id as user_id,
  u.name as user_name,
  u.department,
  u.organization_id,
  
  -- Task Performance Metrics
  COALESCE(task_metrics.total_tasks, 0) as total_tasks_assigned,
  COALESCE(task_metrics.completed_tasks, 0) as total_tasks_completed,
  COALESCE(task_metrics.overdue_tasks, 0) as total_overdue_tasks,
  COALESCE(task_metrics.avg_completion_hours, 0) as avg_completion_time_hours,
  COALESCE(task_metrics.task_completion_rate, 0) as task_completion_rate,
  
  -- Personal Task Metrics
  COALESCE(personal_metrics.total_personal_tasks, 0) as total_personal_tasks,
  COALESCE(personal_metrics.completed_personal_tasks, 0) as completed_personal_tasks,
  COALESCE(personal_metrics.personal_completion_rate, 0) as personal_completion_rate,
  
  -- Attendance Metrics
  COALESCE(attendance_metrics.total_working_days, 0) as total_working_days,
  COALESCE(attendance_metrics.days_present, 0) as days_present,
  COALESCE(attendance_metrics.attendance_rate, 0) as attendance_rate,
  COALESCE(attendance_metrics.late_arrivals, 0) as late_arrivals,
  COALESCE(attendance_metrics.early_departures, 0) as early_departures,
  COALESCE(attendance_metrics.avg_work_hours, 0) as avg_daily_work_hours,
  
  -- Leave Metrics
  COALESCE(leave_metrics.total_leave_requests, 0) as total_leave_requests,
  COALESCE(leave_metrics.approved_leaves, 0) as approved_leaves,
  COALESCE(leave_metrics.pending_leaves, 0) as pending_leaves,
  COALESCE(leave_metrics.rejected_leaves, 0) as rejected_leaves,
  COALESCE(leave_metrics.post_facto_requests, 0) as post_facto_requests,
  
  -- Conversation Metrics
  COALESCE(conversation_metrics.total_conversations, 0) as total_conversations,
  COALESCE(conversation_metrics.avg_conversation_quality, 0) as avg_conversation_quality,
  COALESCE(conversation_metrics.avg_sentiment_score, 0) as avg_sentiment_score,
  COALESCE(conversation_metrics.avg_communication_score, 0) as avg_communication_score,
  
  -- Calculated Overall Scores
  CASE 
    WHEN COALESCE(task_metrics.total_tasks, 0) > 0 
    THEN COALESCE(task_metrics.task_completion_rate, 0)
    ELSE 0
  END as task_performance_score,
  
  CASE 
    WHEN COALESCE(attendance_metrics.total_working_days, 0) > 0
    THEN COALESCE(attendance_metrics.attendance_rate, 0)
    ELSE 100
  END as attendance_score,
  
  CASE 
    WHEN COALESCE(attendance_metrics.days_present, 0) > 0
    THEN GREATEST(0, 100 - ((COALESCE(attendance_metrics.late_arrivals, 0) + COALESCE(attendance_metrics.early_departures, 0)) * 50.0 / attendance_metrics.days_present))
    ELSE 100
  END as punctuality_score,
  
  CASE 
    WHEN COALESCE(leave_metrics.total_leave_requests, 0) > 0
    THEN GREATEST(0, 100 - ((COALESCE(leave_metrics.post_facto_requests, 0) * 100.0) / leave_metrics.total_leave_requests))
    ELSE 100
  END as leave_planning_score,
  
  CASE 
    WHEN COALESCE(conversation_metrics.total_conversations, 0) > 0
    THEN (COALESCE(conversation_metrics.avg_conversation_quality, 0) * 20) -- Convert 0-5 scale to 0-100
    ELSE 50 -- Neutral score when no conversation data
  END as communication_score

FROM users u

-- Task Performance Subquery
LEFT JOIN (
  SELECT 
    t.assigned_to as user_id,
    COUNT(*) as total_tasks,
    COUNT(CASE WHEN t.status IN ('completed', 'Completed') THEN 1 END) as completed_tasks,
    COUNT(CASE 
      WHEN t.due_date < NOW() 
      AND t.status NOT IN ('completed', 'Completed') 
      THEN 1 
    END) as overdue_tasks,
    AVG(CASE 
      WHEN t.status IN ('completed', 'Completed') AND t.completed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 3600.0
    END) as avg_completion_hours,
    ROUND(
      (COUNT(CASE WHEN t.status IN ('completed', 'Completed') THEN 1 END) * 100.0) / 
      NULLIF(COUNT(*), 0), 
      2
    ) as task_completion_rate
  FROM tasks t
  WHERE t.organization_id IS NOT NULL
  GROUP BY t.assigned_to
) task_metrics ON u.id = task_metrics.user_id

-- Personal Tasks Subquery
LEFT JOIN (
  SELECT 
    user_id,
    COUNT(*) as total_personal_tasks,
    COUNT(CASE WHEN status IN ('completed', 'Completed') THEN 1 END) as completed_personal_tasks,
    ROUND(
      (COUNT(CASE WHEN status IN ('completed', 'Completed') THEN 1 END) * 100.0) / 
      NULLIF(COUNT(*), 0), 
      2
    ) as personal_completion_rate
  FROM (
    -- Personal tasks created by user
    SELECT pt.user_id, pt.status FROM personal_tasks pt
    UNION ALL
    -- Personal tasks assigned to user
    SELECT pt.assignee_id as user_id, pt.status FROM personal_tasks pt WHERE pt.assignee_id IS NOT NULL
  ) all_personal_tasks
  GROUP BY user_id
) personal_metrics ON u.id = personal_metrics.user_id

-- Attendance Metrics Subquery
LEFT JOIN (
  SELECT 
    a.user_id,
    COUNT(DISTINCT DATE(a.punch_in_time)) as days_present,
    -- Calculate total working days in the period (this will be filtered by date range in the main query)
    30 as total_working_days, -- This will be dynamically calculated based on date range
    ROUND(
      (COUNT(DISTINCT DATE(a.punch_in_time)) * 100.0) / 30, -- Will be dynamic
      2
    ) as attendance_rate,
    COUNT(CASE 
      WHEN EXTRACT(HOUR FROM a.punch_in_time) >= 9 
      THEN 1 
    END) as late_arrivals,
    COUNT(CASE 
      WHEN a.punch_out_time IS NOT NULL 
      AND EXTRACT(HOUR FROM a.punch_out_time) < 17 
      THEN 1 
    END) as early_departures,
    AVG(CASE 
      WHEN a.punch_out_time IS NOT NULL
      THEN EXTRACT(EPOCH FROM (a.punch_out_time - a.punch_in_time)) / 3600.0
    END) as avg_work_hours
  FROM attendance a
  GROUP BY a.user_id
) attendance_metrics ON u.id = attendance_metrics.user_id

-- Leave Metrics Subquery
LEFT JOIN (
  SELECT 
    t.assigned_to as user_id,
    COUNT(*) as total_leave_requests,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as approved_leaves,
    COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending_leaves,
    COUNT(CASE WHEN t.status = 'cancelled' THEN 1 END) as rejected_leaves,
    COUNT(CASE 
      WHEN t.created_at > t.due_date 
      THEN 1 
    END) as post_facto_requests
  FROM tasks t
  WHERE t.type = 'personalTask' 
  AND t.title ILIKE '%Leave Request%'
  GROUP BY t.assigned_to
) leave_metrics ON u.id = leave_metrics.user_id

-- Conversation Metrics Subquery
LEFT JOIN (
  SELECT 
    cl.employee_id as user_id,
    COUNT(*) as total_conversations,
    AVG(CASE 
      WHEN ca.response_quality = 'excellent' THEN 5
      WHEN ca.response_quality = 'good' THEN 4
      WHEN ca.response_quality = 'average' THEN 3
      WHEN ca.response_quality = 'poor' THEN 2
      ELSE 1
    END) as avg_conversation_quality,
    AVG(COALESCE(ca.sentiment_score, 0)) as avg_sentiment_score,
    AVG(COALESCE(ca.communication_effectiveness, 0)) as avg_communication_score
  FROM conversation_logs cl
  LEFT JOIN conversation_analysis ca ON cl.id = ca.conversation_log_id
  GROUP BY cl.employee_id
) conversation_metrics ON u.id = conversation_metrics.user_id

WHERE u.organization_id IS NOT NULL;

-- Create function to get performance metrics for a specific period and organization
CREATE OR REPLACE FUNCTION get_performance_metrics(
  p_organization_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_department TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  user_name TEXT,
  department TEXT,
  organization_id UUID,
  -- Task metrics
  total_tasks_assigned BIGINT,
  total_tasks_completed BIGINT,
  total_overdue_tasks BIGINT,
  avg_completion_time_hours NUMERIC,
  task_completion_rate NUMERIC,
  -- Personal task metrics
  total_personal_tasks BIGINT,
  completed_personal_tasks BIGINT,
  personal_completion_rate NUMERIC,
  -- Attendance metrics
  total_working_days INTEGER,
  days_present BIGINT,
  attendance_rate NUMERIC,
  late_arrivals BIGINT,
  early_departures BIGINT,
  avg_daily_work_hours NUMERIC,
  -- Leave metrics
  total_leave_requests BIGINT,
  approved_leaves BIGINT,
  pending_leaves BIGINT,
  rejected_leaves BIGINT,
  post_facto_requests BIGINT,
  -- Conversation metrics
  total_conversations BIGINT,
  avg_conversation_quality NUMERIC,
  avg_sentiment_score NUMERIC,
  avg_communication_score NUMERIC,
  -- Calculated scores
  task_performance_score NUMERIC,
  attendance_score NUMERIC,
  punctuality_score NUMERIC,
  leave_planning_score NUMERIC,
  communication_score NUMERIC,
  overall_hr_score NUMERIC
) AS $$
DECLARE
  working_days INTEGER;
BEGIN
  -- Calculate working days in the period (excluding weekends)
  SELECT INTO working_days 
    COUNT(*)
  FROM generate_series(p_start_date, p_end_date, '1 day'::interval) AS d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5; -- Monday to Friday

  RETURN QUERY
  SELECT 
    u.id,
    u.name,
    u.department,
    u.organization_id,
    
    -- Task Performance Metrics (filtered by date range)
    COALESCE(tm.total_tasks, 0)::BIGINT,
    COALESCE(tm.completed_tasks, 0)::BIGINT,
    COALESCE(tm.overdue_tasks, 0)::BIGINT,
    COALESCE(tm.avg_completion_hours, 0)::NUMERIC,
    COALESCE(tm.task_completion_rate, 0)::NUMERIC,
    
    -- Personal Task Metrics (filtered by date range)
    COALESCE(pm.total_personal_tasks, 0)::BIGINT,
    COALESCE(pm.completed_personal_tasks, 0)::BIGINT,
    COALESCE(pm.personal_completion_rate, 0)::NUMERIC,
    
    -- Attendance Metrics (filtered by date range)
    working_days::INTEGER,
    COALESCE(am.days_present, 0)::BIGINT,
    CASE 
      WHEN working_days > 0 
      THEN ROUND((COALESCE(am.days_present, 0) * 100.0) / working_days, 2)
      ELSE 0
    END::NUMERIC,
    COALESCE(am.late_arrivals, 0)::BIGINT,
    COALESCE(am.early_departures, 0)::BIGINT,
    COALESCE(am.avg_work_hours, 0)::NUMERIC,
    
    -- Leave Metrics (filtered by date range)
    COALESCE(lm.total_leave_requests, 0)::BIGINT,
    COALESCE(lm.approved_leaves, 0)::BIGINT,
    COALESCE(lm.pending_leaves, 0)::BIGINT,
    COALESCE(lm.rejected_leaves, 0)::BIGINT,
    COALESCE(lm.post_facto_requests, 0)::BIGINT,
    
    -- Conversation Metrics (filtered by date range)
    COALESCE(cm.total_conversations, 0)::BIGINT,
    COALESCE(cm.avg_conversation_quality, 0)::NUMERIC,
    COALESCE(cm.avg_sentiment_score, 0)::NUMERIC,
    COALESCE(cm.avg_communication_score, 0)::NUMERIC,
    
    -- Calculated Performance Scores
    CASE 
      WHEN COALESCE(tm.total_tasks, 0) > 0 
      THEN COALESCE(tm.task_completion_rate, 0)
      ELSE 0
    END::NUMERIC as task_performance_score,
    
    CASE 
      WHEN working_days > 0
      THEN ROUND((COALESCE(am.days_present, 0) * 100.0) / working_days, 2)
      ELSE 100
    END::NUMERIC as attendance_score,
    
    CASE 
      WHEN COALESCE(am.days_present, 0) > 0
      THEN GREATEST(0, 100 - ((COALESCE(am.late_arrivals, 0) + COALESCE(am.early_departures, 0)) * 50.0 / am.days_present))
      ELSE 100
    END::NUMERIC as punctuality_score,
    
    CASE 
      WHEN COALESCE(lm.total_leave_requests, 0) > 0
      THEN GREATEST(0, 100 - ((COALESCE(lm.post_facto_requests, 0) * 100.0) / lm.total_leave_requests))
      ELSE 100
    END::NUMERIC as leave_planning_score,
    
    CASE 
      WHEN COALESCE(cm.total_conversations, 0) > 0
      THEN (COALESCE(cm.avg_conversation_quality, 0) * 20)
      ELSE 50
    END::NUMERIC as communication_score,
    
    -- Overall HR Score (weighted average)
    ROUND(
      (CASE 
        WHEN COALESCE(tm.total_tasks, 0) > 0 
        THEN COALESCE(tm.task_completion_rate, 0)
        ELSE 0
      END * 0.3) +
      (CASE 
        WHEN working_days > 0
        THEN (COALESCE(am.days_present, 0) * 100.0) / working_days
        ELSE 100
      END * 0.25) +
      (CASE 
        WHEN COALESCE(am.days_present, 0) > 0
        THEN GREATEST(0, 100 - ((COALESCE(am.late_arrivals, 0) + COALESCE(am.early_departures, 0)) * 50.0 / am.days_present))
        ELSE 100
      END * 0.25) +
      (CASE 
        WHEN COALESCE(lm.total_leave_requests, 0) > 0
        THEN GREATEST(0, 100 - ((COALESCE(lm.post_facto_requests, 0) * 100.0) / lm.total_leave_requests))
        ELSE 100
      END * 0.1) +
      (CASE 
        WHEN COALESCE(cm.total_conversations, 0) > 0
        THEN (COALESCE(cm.avg_conversation_quality, 0) * 20)
        ELSE 50
      END * 0.1), 
      2
    )::NUMERIC as overall_hr_score

  FROM users u
  
  -- Task Performance (filtered by date)
  LEFT JOIN (
    SELECT 
      t.assigned_to as task_user_id,
      COUNT(*) as total_tasks,
      COUNT(CASE WHEN t.status IN ('completed', 'Completed') THEN 1 END) as completed_tasks,
      COUNT(CASE 
        WHEN t.due_date < NOW() 
        AND t.status NOT IN ('completed', 'Completed') 
        THEN 1 
      END) as overdue_tasks,
      AVG(CASE 
        WHEN t.status IN ('completed', 'Completed') AND t.completed_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 3600.0
      END) as avg_completion_hours,
      ROUND(
        (COUNT(CASE WHEN t.status IN ('completed', 'Completed') THEN 1 END) * 100.0) / 
        NULLIF(COUNT(*), 0), 
        2
      ) as task_completion_rate
    FROM tasks t
    WHERE t.organization_id = p_organization_id
    AND t.created_at >= p_start_date
    AND t.created_at <= p_end_date
    GROUP BY t.assigned_to
  ) tm ON u.id = tm.task_user_id
  
  -- Personal Tasks (filtered by date)
  LEFT JOIN (
    SELECT 
      personal_user_id,
      COUNT(*) as total_personal_tasks,
      COUNT(CASE WHEN status IN ('completed', 'Completed') THEN 1 END) as completed_personal_tasks,
      ROUND(
        (COUNT(CASE WHEN status IN ('completed', 'Completed') THEN 1 END) * 100.0) / 
        NULLIF(COUNT(*), 0), 
        2
      ) as personal_completion_rate
    FROM (
      SELECT pt.user_id as personal_user_id, pt.status FROM personal_tasks pt
      WHERE pt.created_at >= p_start_date AND pt.created_at <= p_end_date
      UNION ALL
      SELECT pt.assignee_id as personal_user_id, pt.status FROM personal_tasks pt 
      WHERE pt.assignee_id IS NOT NULL 
      AND pt.created_at >= p_start_date AND pt.created_at <= p_end_date
    ) all_personal_tasks
    GROUP BY personal_user_id
  ) pm ON u.id = pm.personal_user_id
  
  -- Attendance (filtered by date)
  LEFT JOIN (
    SELECT 
      a.user_id as attendance_user_id,
      COUNT(DISTINCT DATE(a.punch_in_time)) as days_present,
      COUNT(CASE 
        WHEN EXTRACT(HOUR FROM a.punch_in_time) >= 9 
        THEN 1 
      END) as late_arrivals,
      COUNT(CASE 
        WHEN a.punch_out_time IS NOT NULL 
        AND EXTRACT(HOUR FROM a.punch_out_time) < 17 
        THEN 1 
      END) as early_departures,
      AVG(CASE 
        WHEN a.punch_out_time IS NOT NULL
        THEN EXTRACT(EPOCH FROM (a.punch_out_time - a.punch_in_time)) / 3600.0
      END) as avg_work_hours
    FROM attendance a
    WHERE DATE(a.punch_in_time) >= p_start_date 
    AND DATE(a.punch_in_time) <= p_end_date
    GROUP BY a.user_id
  ) am ON u.id = am.attendance_user_id
  
  -- Leave Metrics (filtered by date)
  LEFT JOIN (
    SELECT 
      t.assigned_to as leave_user_id,
      COUNT(*) as total_leave_requests,
      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as approved_leaves,
      COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending_leaves,
      COUNT(CASE WHEN t.status = 'cancelled' THEN 1 END) as rejected_leaves,
      COUNT(CASE 
        WHEN t.created_at > t.due_date 
        THEN 1 
      END) as post_facto_requests
    FROM tasks t
    WHERE t.type = 'personalTask' 
    AND t.title ILIKE '%Leave Request%'
    AND t.organization_id = p_organization_id
    AND t.created_at >= p_start_date
    AND t.created_at <= p_end_date
    GROUP BY t.assigned_to
  ) lm ON u.id = lm.leave_user_id
  
  -- Conversation Metrics (filtered by date)
  LEFT JOIN (
    SELECT 
      cl.employee_id as conversation_user_id,
      COUNT(*) as total_conversations,
      AVG(CASE 
        WHEN ca.response_quality = 'excellent' THEN 5
        WHEN ca.response_quality = 'good' THEN 4
        WHEN ca.response_quality = 'average' THEN 3
        WHEN ca.response_quality = 'poor' THEN 2
        ELSE 1
      END) as avg_conversation_quality,
      AVG(COALESCE(ca.sentiment_score, 0)) as avg_sentiment_score,
      AVG(COALESCE(ca.communication_effectiveness, 0)) as avg_communication_score
    FROM conversation_logs cl
    LEFT JOIN conversation_analysis ca ON cl.id = ca.conversation_log_id
    WHERE cl.created_at >= p_start_date
    AND cl.created_at <= p_end_date
    GROUP BY cl.employee_id
  ) cm ON u.id = cm.conversation_user_id
  
  WHERE u.organization_id = p_organization_id
  AND (p_department IS NULL OR u.department = p_department)
  AND (p_user_id IS NULL OR u.id = p_user_id);
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT SELECT ON performance_metrics_view TO authenticated;
GRANT EXECUTE ON FUNCTION get_performance_metrics TO authenticated;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_org_date ON tasks(assigned_to, organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_user_date ON personal_tasks(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_assignee_date ON personal_tasks(assignee_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, punch_in_time);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_employee_date ON conversation_logs(employee_id, created_at);
