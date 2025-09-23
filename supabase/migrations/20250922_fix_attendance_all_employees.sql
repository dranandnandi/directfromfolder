-- Fix attendance function to show all employees with proper calculations and security
-- Update: 2025-09-22 - Include all employees with fixed calculations and role-based access

-- Update the function with proper security and calculations
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
  shift_name character varying,
  shift_start_time time,
  shift_end_time time,
  attendance_status text,
  is_late boolean,
  is_early_out boolean,
  is_regularized boolean,
  minutes_late_or_early numeric,
  minutes_early_out numeric
) AS $$
DECLARE
  current_user_id uuid;
  current_user_role text;
BEGIN
  -- Get current authenticated user
  SELECT auth.uid() INTO current_user_id;
  
  -- Get current user's role
  SELECT u.role INTO current_user_role 
  FROM users u
  WHERE u.auth_id = current_user_id AND u.organization_id = p_organization_id;
  
  -- Security check: Only admins can view all users, others can only see their own
  IF current_user_role NOT IN ('admin', 'superadmin') THEN
    -- Get the database user_id for the current auth user
    SELECT u.id INTO current_user_id 
    FROM users u
    WHERE u.auth_id = auth.uid() AND u.organization_id = p_organization_id;
    
    -- Force p_user_id to be the current user for non-admins
    p_user_id := current_user_id;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(adv.id, gen_random_uuid()) as id,
    u.id as user_id,
    u.name as user_name,
    u.department as user_department,
    u.role as user_role,
    p_date as date,
    adv.punch_in_time,
    adv.punch_out_time,
    adv.punch_in_address,
    adv.punch_out_address,
    adv.punch_in_selfie_url,
    adv.punch_out_selfie_url,
    
    -- Fix total hours calculation
    CASE 
      WHEN adv.punch_in_time IS NOT NULL AND adv.punch_out_time IS NOT NULL 
      THEN ROUND(EXTRACT(EPOCH FROM (adv.punch_out_time - adv.punch_in_time)) / 3600.0, 2)
      ELSE adv.total_hours
    END as total_hours,
    
    -- Fix effective hours calculation  
    CASE 
      WHEN adv.punch_in_time IS NOT NULL AND adv.punch_out_time IS NOT NULL 
      THEN ROUND((EXTRACT(EPOCH FROM (adv.punch_out_time - adv.punch_in_time)) / 3600.0) - COALESCE(adv.break_hours, 1.0), 2)
      ELSE adv.effective_hours
    END as effective_hours,
    
    adv.shift_name,
    adv.shift_start_time,
    adv.shift_end_time,
    COALESCE(adv.attendance_status, 'absent') as attendance_status,
    
    -- Fix late calculation
    CASE 
      WHEN adv.punch_in_time IS NOT NULL AND adv.shift_start_time IS NOT NULL
      THEN adv.punch_in_time::time > (adv.shift_start_time + INTERVAL '15 minutes')
      ELSE false
    END as is_late,
    
    -- Fix early out calculation
    CASE 
      WHEN adv.punch_out_time IS NOT NULL AND adv.shift_end_time IS NOT NULL
      THEN adv.punch_out_time::time < (adv.shift_end_time - INTERVAL '15 minutes')
      ELSE false
    END as is_early_out,
    
    COALESCE(adv.is_regularized, false) as is_regularized,
    
    -- Fix minutes calculation  
    CASE 
      WHEN adv.punch_in_time IS NOT NULL AND adv.shift_start_time IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (adv.punch_in_time::time - adv.shift_start_time)) / 60.0, 2)
      ELSE NULL
    END as minutes_late_or_early,
    
    CASE 
      WHEN adv.punch_out_time IS NOT NULL AND adv.shift_end_time IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (adv.shift_end_time - adv.punch_out_time::time)) / 60.0, 2)
      ELSE NULL
    END as minutes_early_out
    
  FROM users u
  LEFT JOIN attendance_dashboard_view adv ON (
    u.id = adv.user_id 
    AND adv.date = p_date
    AND adv.organization_id = p_organization_id
  )
  WHERE u.organization_id = p_organization_id
    AND u.role IN ('admin', 'user', 'superadmin')
    AND (p_user_id IS NULL OR u.id = p_user_id)
  ORDER BY u.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_attendance_with_details(uuid, date, uuid) TO authenticated;