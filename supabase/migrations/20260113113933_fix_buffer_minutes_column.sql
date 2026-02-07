-- Fix: Remove non-existent buffer_minutes column from attendance_dashboard_view
-- Error: "Failed to punch in: column s.buffer_minutes does not exist"
-- Date: 2026-01-13
-- Issue: The view was referencing a column that doesn't exist in the shifts table

-- Drop and recreate the view without the problematic buffer_minutes column
DROP VIEW IF EXISTS attendance_dashboard_view CASCADE;

CREATE OR REPLACE VIEW attendance_dashboard_view AS
SELECT 
  a.id,
  a.user_id,
  a.organization_id,
  a.date,
  a.punch_in_time,
  a.punch_out_time,
  a.punch_in_latitude,
  a.punch_in_longitude,
  a.punch_in_address,
  a.punch_in_selfie_url,
  a.punch_out_latitude,
  a.punch_out_longitude,
  a.punch_out_address,
  a.punch_out_selfie_url,
  
  -- Calculate total hours if both times exist
  CASE 
    WHEN a.punch_in_time IS NOT NULL AND a.punch_out_time IS NOT NULL 
    THEN ROUND(EXTRACT(EPOCH FROM (a.punch_out_time - a.punch_in_time)) / 3600.0, 2)
    ELSE a.total_hours
  END as total_hours,
  
  a.break_hours,
  
  -- Calculate effective hours
  CASE 
    WHEN a.punch_in_time IS NOT NULL AND a.punch_out_time IS NOT NULL 
    THEN ROUND((EXTRACT(EPOCH FROM (a.punch_out_time - a.punch_in_time)) / 3600.0) - COALESCE(a.break_hours, 1.0), 2)
    ELSE a.effective_hours
  END as effective_hours,
  
  a.is_late,
  a.is_early_out,
  a.is_absent,
  a.is_holiday,
  a.is_weekend,
  a.is_regularized,
  a.regularization_reason,
  a.regularized_at,
  a.created_at,
  a.updated_at,
  
  -- User information
  u.name as user_name,
  u.email as user_email,
  u.department as user_department,
  u.role as user_role,
  
  -- Shift information (WITHOUT buffer_minutes which doesn't exist)
  s.id as shift_id,
  s.name as shift_name,
  s.start_time as shift_start_time,
  s.end_time as shift_end_time,
  s.duration_hours as shift_duration_hours,
  s.break_duration_minutes as shift_break_duration,
  s.late_threshold_minutes as shift_late_threshold,
  s.early_out_threshold_minutes as shift_early_out_threshold,
  -- NOTE: Removed s.buffer_minutes (doesn't exist in shifts table)
  
  -- Employee shift assignment details
  es.effective_from as shift_assignment_start,
  es.effective_to as shift_assignment_end,
  
  -- Calculate punctuality based on shift times
  CASE 
    WHEN a.punch_in_time IS NOT NULL AND s.start_time IS NOT NULL
    THEN a.punch_in_time::time > (s.start_time + INTERVAL '1 minute' * COALESCE(s.late_threshold_minutes, 15))
    ELSE false
  END as calculated_is_late,
  
  CASE 
    WHEN a.punch_out_time IS NOT NULL AND s.end_time IS NOT NULL
    THEN a.punch_out_time::time < (s.end_time - INTERVAL '1 minute' * COALESCE(s.early_out_threshold_minutes, 15))
    ELSE false
  END as calculated_is_early_out,
  
  -- Time differences for analysis
  CASE 
    WHEN a.punch_in_time IS NOT NULL AND s.start_time IS NOT NULL
    THEN EXTRACT(EPOCH FROM (a.punch_in_time::time - s.start_time)) / 60
    ELSE NULL
  END as minutes_late_or_early,
  
  CASE 
    WHEN a.punch_out_time IS NOT NULL AND s.end_time IS NOT NULL
    THEN EXTRACT(EPOCH FROM (s.end_time - a.punch_out_time::time)) / 60
    ELSE NULL
  END as minutes_early_out
  
FROM attendance a
INNER JOIN users u ON a.user_id = u.id
LEFT JOIN employee_shifts es ON (
  a.user_id = es.user_id 
  AND a.date >= es.effective_from 
  AND (es.effective_to IS NULL OR a.date <= es.effective_to)
)
LEFT JOIN shifts s ON es.shift_id = s.id;

-- Grant permissions
GRANT SELECT ON attendance_dashboard_view TO authenticated;

-- Add helpful comment
COMMENT ON VIEW attendance_dashboard_view IS 'Comprehensive attendance view with shift info and calculations. Fixed: removed non-existent buffer_minutes column.';
