-- Employees can access their own attendance; admins/superadmins can access
-- everyone in their own organisation. Preserve self-service punches and the
-- existing daily RPC result/calculation contract.

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_organization_access ON public.attendance;
CREATE POLICY attendance_organization_access ON public.attendance
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_current_user_org_id_safe()
    AND (user_id = public.get_current_user_id() OR public.is_current_user_admin_safe())
  )
  WITH CHECK (
    organization_id = public.get_current_user_org_id_safe()
    AND (user_id = public.get_current_user_id() OR public.is_current_user_admin_safe())
  );

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_sessions_organization_access ON public.attendance_sessions;
CREATE POLICY attendance_sessions_organization_access ON public.attendance_sessions
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_current_user_org_id_safe()
    AND (user_id = public.get_current_user_id() OR public.is_current_user_admin_safe())
  )
  WITH CHECK (
    organization_id = public.get_current_user_org_id_safe()
    AND (user_id = public.get_current_user_id() OR public.is_current_user_admin_safe())
    AND EXISTS (
      SELECT 1 FROM public.attendance a
      WHERE a.id = attendance_sessions.attendance_id
        AND a.user_id = attendance_sessions.user_id
        AND a.organization_id = attendance_sessions.organization_id
    )
  );

DROP POLICY IF EXISTS attendance_monthly_overrides_select ON public.attendance_monthly_overrides;
CREATE POLICY attendance_monthly_overrides_select ON public.attendance_monthly_overrides
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_current_user_org_id_safe()
    AND (user_id = public.get_current_user_id() OR public.is_current_user_admin_safe())
  );

-- Requests are readable only when the underlying attendance is readable.
-- Employees may request corrections; approval/rejection remains admin-only.
DROP POLICY IF EXISTS attendance_regularizations_access ON public.attendance_regularizations;
DROP POLICY IF EXISTS attendance_regularizations_select ON public.attendance_regularizations;
DROP POLICY IF EXISTS attendance_regularizations_insert ON public.attendance_regularizations;
DROP POLICY IF EXISTS attendance_regularizations_admin ON public.attendance_regularizations;
CREATE POLICY attendance_regularizations_select ON public.attendance_regularizations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.attendance a WHERE a.id = attendance_id));
CREATE POLICY attendance_regularizations_insert ON public.attendance_regularizations
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = public.get_current_user_id()
    AND status = 'pending' AND approved_by IS NULL
    AND EXISTS (SELECT 1 FROM public.attendance a WHERE a.id = attendance_id)
  );
CREATE POLICY attendance_regularizations_admin ON public.attendance_regularizations
  FOR ALL TO authenticated
  USING (
    public.is_current_user_admin_safe()
    AND EXISTS (SELECT 1 FROM public.attendance a WHERE a.id = attendance_id)
  )
  WITH CHECK (
    public.is_current_user_admin_safe()
    AND EXISTS (SELECT 1 FROM public.attendance a WHERE a.id = attendance_id)
  );

ALTER VIEW public.attendance_dashboard_view SET (security_invoker = on);
ALTER VIEW public.v_attendance_monthly SET (security_invoker = on);

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
  WHERE u.auth_id = auth.uid() AND u.organization_id = p_organization_id;

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
    CASE WHEN adv.punch_in_time IS NOT NULL AND adv.punch_out_time IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (adv.punch_out_time - adv.punch_in_time)) / 3600.0, 2)
      ELSE adv.total_hours END,
    CASE WHEN adv.punch_in_time IS NOT NULL AND adv.punch_out_time IS NOT NULL
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
  WHERE u.organization_id = p_organization_id
    AND u.role IN ('admin', 'user', 'superadmin')
    AND (p_user_id IS NULL OR u.id = p_user_id)
  ORDER BY u.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_with_details(uuid, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_with_details(uuid, date, uuid) TO authenticated;
