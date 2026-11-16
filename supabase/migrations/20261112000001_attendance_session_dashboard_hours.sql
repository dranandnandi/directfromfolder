-- Preserve the daily RPC contract and organization access checks while using
-- session totals. First-in to last-out includes unpaid gaps between sessions.
CREATE OR REPLACE FUNCTION public.get_attendance_with_details(
  p_organization_id uuid,
  p_date date DEFAULT CURRENT_DATE,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, user_id uuid, user_name text, user_department text, user_role text,
  date date, punch_in_time timestamptz, punch_out_time timestamptz,
  punch_in_address text, punch_out_address text,
  punch_in_selfie_url text, punch_out_selfie_url text,
  total_hours numeric, effective_hours numeric,
  shift_name character varying, shift_start_time time, shift_end_time time,
  attendance_status text, is_late boolean, is_early_out boolean,
  is_regularized boolean, minutes_late_or_early numeric, minutes_early_out numeric
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_user_id uuid;
  caller_role text;
BEGIN
  -- Check membership explicitly: NULL NOT IN (...) is not true and previously
  -- let an anonymous caller or a caller from another organisation pass through.
  SELECT u.id, u.role INTO caller_user_id, caller_role
  FROM public.users u
  WHERE u.auth_id = auth.uid() AND u.organization_id = p_organization_id AND u.is_active IS DISTINCT FROM false;

  IF caller_user_id IS NULL OR caller_role IS NULL THEN
    RAISE EXCEPTION 'You cannot access attendance for this organization.' USING ERRCODE = '42501';
  END IF;

  IF caller_role NOT IN ('admin', 'superadmin') THEN
    p_user_id := caller_user_id;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(adv.id, gen_random_uuid()),
    u.id, u.name, u.department, u.role, p_date,
    adv.punch_in_time, adv.punch_out_time,
    adv.punch_in_address, adv.punch_out_address,
    adv.punch_in_selfie_url, adv.punch_out_selfie_url,
    CASE WHEN COALESCE(actual.session_count, 0) > 0 THEN actual.total_hours WHEN adv.punch_in_time IS NOT NULL AND adv.punch_out_time IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (adv.punch_out_time - adv.punch_in_time)) / 3600.0, 2)
      ELSE adv.total_hours END,
    CASE WHEN COALESCE(actual.session_count, 0) > 0 THEN actual.effective_hours WHEN adv.punch_in_time IS NOT NULL AND adv.punch_out_time IS NOT NULL
      THEN ROUND((EXTRACT(EPOCH FROM (adv.punch_out_time - adv.punch_in_time)) / 3600.0) - COALESCE(adv.break_hours, 1.0), 2)
      ELSE adv.effective_hours END,
    adv.shift_name, adv.shift_start_time, adv.shift_end_time,
    COALESCE(adv.attendance_status, 'absent'),
    CASE WHEN adv.punch_in_time IS NOT NULL AND adv.shift_start_time IS NOT NULL
      THEN adv.punch_in_time::time > (adv.shift_start_time + INTERVAL '15 minutes') ELSE false END,
    CASE WHEN adv.punch_out_time IS NOT NULL AND adv.shift_end_time IS NOT NULL
      THEN adv.punch_out_time::time < (adv.shift_end_time - INTERVAL '15 minutes') ELSE false END,
    COALESCE(adv.is_regularized, false),
    CASE WHEN adv.punch_in_time IS NOT NULL AND adv.shift_start_time IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (adv.punch_in_time::time - adv.shift_start_time)) / 60.0, 2) ELSE NULL END,
    CASE WHEN adv.punch_out_time IS NOT NULL AND adv.shift_end_time IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (adv.shift_end_time - adv.punch_out_time::time)) / 60.0, 2) ELSE NULL END
  FROM public.users u
  LEFT JOIN public.attendance_dashboard_view adv ON (
    u.id = adv.user_id AND adv.date = p_date AND adv.organization_id = p_organization_id
  )
  LEFT JOIN public.attendance actual ON actual.id = adv.id AND actual.organization_id = p_organization_id
  WHERE u.organization_id = p_organization_id
    AND u.is_active IS DISTINCT FROM false
    AND u.role IN ('admin', 'user', 'superadmin', 'payroll_admin')
    AND (p_user_id IS NULL OR u.id = p_user_id)
  ORDER BY u.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_with_details(uuid, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_with_details(uuid, date, uuid) TO authenticated;
