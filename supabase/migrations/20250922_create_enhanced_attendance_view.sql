-- Enhanced Attendance View for comprehensive attendance dashboard
-- Includes shift information, photos, location, and proper calculations

-- First, let's fix any existing attendance records that don't have total_hours calculated
UPDATE attendance 
SET total_hours = EXTRACT(EPOCH FROM (punch_out_time - punch_in_time)) / 3600,
    effective_hours = (EXTRACT(EPOCH FROM (punch_out_time - punch_in_time)) / 3600) - COALESCE(break_hours, 1.0)
WHERE punch_in_time IS NOT NULL 
  AND punch_out_time IS NOT NULL 
  AND total_hours IS NULL;

-- Create comprehensive attendance view
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
  
  -- Shift information
  s.id as shift_id,
  s.name as shift_name,
  s.start_time as shift_start_time,
  s.end_time as shift_end_time,
  s.duration_hours as shift_duration_hours,
  s.break_duration_minutes as shift_break_duration,
  s.late_threshold_minutes as shift_late_threshold,
  s.early_out_threshold_minutes as shift_early_out_threshold,
  
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
  END as minutes_early_out,
  
  -- Attendance status summary
  CASE 
    WHEN a.punch_in_time IS NULL THEN 'absent'
    WHEN a.is_regularized THEN 'regularized'
    WHEN a.is_late AND NOT a.is_regularized THEN 'late'
    WHEN a.is_early_out AND NOT a.is_regularized THEN 'early_out'
    WHEN a.punch_in_time IS NOT NULL AND a.punch_out_time IS NOT NULL THEN 'present'
    WHEN a.punch_in_time IS NOT NULL AND a.punch_out_time IS NULL THEN 'checked_in'
    ELSE 'unknown'
  END as attendance_status

FROM attendance a
LEFT JOIN users u ON a.user_id = u.id
LEFT JOIN employee_shifts es ON (
  a.user_id = es.user_id 
  AND a.date >= es.effective_from 
  AND (es.effective_to IS NULL OR a.date <= es.effective_to)
)
LEFT JOIN shifts s ON es.shift_id = s.id;

-- Create function to get attendance with all details
CREATE OR REPLACE FUNCTION get_attendance_with_details(
  p_organization_id uuid,
  p_date date DEFAULT CURRENT_DATE,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_name text,
  user_department text,
  user_role text,
  date date,
  punch_in_time timestamptz,
  punch_out_time timestamptz,
  punch_in_address text,
  punch_out_address text,
  punch_in_selfie_url text,
  punch_out_selfie_url text,
  total_hours numeric,
  effective_hours numeric,
  shift_name text,
  shift_start_time time,
  shift_end_time time,
  attendance_status text,
  is_late boolean,
  is_early_out boolean,
  is_regularized boolean,
  minutes_late_or_early numeric,
  minutes_early_out numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    adv.id,
    adv.user_id,
    adv.user_name,
    adv.user_department,
    adv.user_role,
    adv.date,
    adv.punch_in_time,
    adv.punch_out_time,
    adv.punch_in_address,
    adv.punch_out_address,
    adv.punch_in_selfie_url,
    adv.punch_out_selfie_url,
    adv.total_hours,
    adv.effective_hours,
    adv.shift_name,
    adv.shift_start_time,
    adv.shift_end_time,
    adv.attendance_status,
    adv.calculated_is_late,
    adv.calculated_is_early_out,
    adv.is_regularized,
    adv.minutes_late_or_early,
    adv.minutes_early_out
  FROM attendance_dashboard_view adv
  WHERE adv.organization_id = p_organization_id
    AND adv.date = p_date
    AND (p_user_id IS NULL OR adv.user_id = p_user_id)
  ORDER BY adv.user_name;
END;
$$ LANGUAGE plpgsql;

-- Update the existing calculate_attendance_hours function to be more robust
CREATE OR REPLACE FUNCTION calculate_attendance_hours()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate total hours if both punch times exist
  IF NEW.punch_in_time IS NOT NULL AND NEW.punch_out_time IS NOT NULL THEN
    -- Calculate total hours with proper rounding
    NEW.total_hours = ROUND(EXTRACT(EPOCH FROM (NEW.punch_out_time - NEW.punch_in_time)) / 3600.0, 2);
    
    -- Calculate effective hours (total - break)
    NEW.effective_hours = ROUND(NEW.total_hours - COALESCE(NEW.break_hours, 1.0), 2);
    
    -- Ensure we don't have negative effective hours
    IF NEW.effective_hours < 0 THEN
      NEW.effective_hours = 0;
    END IF;
  ELSE
    -- If only punch in exists, set absent flag to false
    IF NEW.punch_in_time IS NOT NULL THEN
      NEW.is_absent = false;
    END IF;
  END IF;
  
  -- Check for late arrival and early out if shift is assigned
  IF NEW.shift_id IS NOT NULL THEN
    -- Get shift information
    WITH shift_info AS (
      SELECT 
        start_time, 
        end_time,
        late_threshold_minutes,
        early_out_threshold_minutes
      FROM shifts 
      WHERE id = NEW.shift_id
    )
    SELECT 
      -- Check late arrival
      CASE 
        WHEN NEW.punch_in_time IS NOT NULL AND NEW.punch_in_time::time > (si.start_time + INTERVAL '1 minute' * COALESCE(si.late_threshold_minutes, 15))
        THEN true 
        ELSE false 
      END,
      -- Check early out
      CASE 
        WHEN NEW.punch_out_time IS NOT NULL AND NEW.punch_out_time::time < (si.end_time - INTERVAL '1 minute' * COALESCE(si.early_out_threshold_minutes, 15))
        THEN true 
        ELSE false 
      END
    INTO NEW.is_late, NEW.is_early_out
    FROM shift_info si;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions for the view and function
GRANT SELECT ON attendance_dashboard_view TO authenticated;
GRANT EXECUTE ON FUNCTION get_attendance_with_details(uuid, date, uuid) TO authenticated;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_attendance_dashboard_view_org_date ON attendance(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_user_date ON employee_shifts(user_id, effective_from, effective_to);