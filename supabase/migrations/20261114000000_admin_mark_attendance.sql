-- Admin entry deliberately leaves location, geofence distance and selfie fields
-- NULL. Employee self-punch validation is unchanged. Keep each entry atomic and
-- audited, and use session triggers for the normal attendance/payroll totals.
CREATE FUNCTION public.fn_admin_mark_attendance_punch(
  p_user_id uuid, p_date date, p_action text, p_punch_time timestamptz, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor users%ROWTYPE;
  v_user users%ROWTYPE;
  v_att attendance%ROWTYPE;
  v_session attendance_sessions%ROWTYPE;
  v_shift uuid;
  v_before jsonb;
  v_metadata jsonb;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS DISTINCT FROM false;
  IF v_actor.id IS NULL OR COALESCE(v_actor.role, '') NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only an active organization admin can mark attendance.' USING ERRCODE = '42501';
  END IF;
  -- Serialize admin operations for this employee, including when no day exists.
  SELECT * INTO v_user FROM users WHERE id = p_user_id
    AND organization_id = v_actor.organization_id AND is_active IS DISTINCT FROM false FOR UPDATE;
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Employee not found in your organization.' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('in', 'out') OR p_date IS NULL
      OR p_punch_time IS NULL OR NOT isfinite(p_punch_time) OR p_punch_time > now()
      OR p_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Choose a valid action, attendance date and punch time that is not in the future.';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Enter a reason of 5 to 2000 characters.';
  END IF;
  PERFORM fn_assert_correction_period_open(v_user.organization_id, p_date);
  SELECT * INTO v_att FROM attendance WHERE user_id = p_user_id AND date = p_date FOR UPDATE;
  IF v_att.id IS NOT NULL AND v_att.organization_id IS DISTINCT FROM v_user.organization_id THEN
    RAISE EXCEPTION 'Attendance belongs to a different organization.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM attendance_sessions WHERE user_id = p_user_id FOR UPDATE;
  v_before := fn_correction_day_snapshot(p_user_id, p_date);
  v_metadata := jsonb_build_object('source', 'admin', 'marked_by', v_actor.id);

  IF p_action = 'in' THEN
    IF (p_punch_time AT TIME ZONE 'Asia/Kolkata')::date <> p_date THEN
      RAISE EXCEPTION 'Punch-in must start on the attendance date.';
    END IF;
    IF EXISTS (SELECT 1 FROM attendance_sessions WHERE user_id = p_user_id AND punch_out_time IS NULL)
        OR EXISTS (SELECT 1 FROM attendance WHERE user_id = p_user_id
          AND punch_in_time IS NOT NULL AND punch_out_time IS NULL) THEN
      RAISE EXCEPTION 'This employee is already punched in. Punch out first.';
    END IF;
    IF EXISTS (SELECT 1 FROM attendance_sessions WHERE user_id = p_user_id
          AND punch_in_time <= p_punch_time AND punch_out_time >= p_punch_time)
        OR EXISTS (SELECT 1 FROM attendance WHERE user_id = p_user_id
          AND punch_in_time <= p_punch_time AND punch_out_time >= p_punch_time) THEN
      RAISE EXCEPTION 'Punch-in overlaps an existing attendance session.';
    END IF;
    IF v_att.punch_in_time IS NOT NULL AND NOT COALESCE(fn_user_allows_multiple_punches(p_user_id), false) THEN
      RAISE EXCEPTION 'Multiple punches per day are not enabled for this user.';
    END IF;
    IF v_att.id IS NULL THEN
      SELECT es.shift_id INTO v_shift FROM employee_shifts es JOIN shifts s ON s.id = es.shift_id
        WHERE es.user_id = p_user_id AND s.organization_id = v_user.organization_id
          AND es.effective_from <= p_date AND (es.effective_to IS NULL OR es.effective_to >= p_date)
        ORDER BY es.effective_from DESC LIMIT 1;
      INSERT INTO attendance(user_id, organization_id, date, shift_id, is_absent)
        VALUES(p_user_id, v_user.organization_id, p_date, v_shift, false) RETURNING * INTO v_att;
    END IF;
  ELSE
    IF v_att.id IS NULL OR v_att.punch_in_time IS NULL OR v_att.punch_out_time IS NOT NULL THEN
      RAISE EXCEPTION 'No active punch-in found on this attendance date.';
    END IF;
  END IF;

  -- Preserve all evidence from older day-only records before adding/closing a session.
  IF v_att.punch_in_time IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM attendance_sessions WHERE attendance_id = v_att.id) THEN
    INSERT INTO attendance_sessions(attendance_id, user_id, organization_id, date,
      punch_in_time, punch_in_latitude, punch_in_longitude, punch_in_address,
      punch_in_selfie_url, punch_in_device_info, punch_in_distance_meters,
      punch_out_time, punch_out_latitude, punch_out_longitude, punch_out_address,
      punch_out_selfie_url, punch_out_device_info, punch_out_distance_meters, is_outside_geofence)
    VALUES(v_att.id, p_user_id, v_user.organization_id, p_date,
      v_att.punch_in_time, v_att.punch_in_latitude, v_att.punch_in_longitude, v_att.punch_in_address,
      v_att.punch_in_selfie_url, v_att.punch_in_device_info, v_att.punch_in_distance_meters,
      v_att.punch_out_time, v_att.punch_out_latitude, v_att.punch_out_longitude, v_att.punch_out_address,
      v_att.punch_out_selfie_url, v_att.punch_out_device_info, v_att.punch_out_distance_meters,
      COALESCE(v_att.is_outside_geofence, false));
  END IF;

  IF p_action = 'in' THEN
    INSERT INTO attendance_sessions(attendance_id, user_id, organization_id, date, punch_in_time, punch_in_device_info)
      VALUES(v_att.id, p_user_id, v_user.organization_id, p_date, p_punch_time, v_metadata)
      RETURNING * INTO v_session;
  ELSE
    SELECT * INTO v_session FROM attendance_sessions WHERE attendance_id = v_att.id
      AND punch_out_time IS NULL FOR UPDATE;
    IF v_session.id IS NULL THEN RAISE EXCEPTION 'No open punch session found. Refresh attendance and try again.'; END IF;
    IF p_punch_time <= v_session.punch_in_time OR p_punch_time > v_session.punch_in_time + interval '24 hours' THEN
      RAISE EXCEPTION 'Punch-out must be after punch-in and within 24 hours.';
    END IF;
    IF EXISTS (SELECT 1 FROM attendance_sessions WHERE user_id = p_user_id AND id <> v_session.id
        AND punch_in_time < p_punch_time AND COALESCE(punch_out_time, 'infinity'::timestamptz) > v_session.punch_in_time)
        OR EXISTS (SELECT 1 FROM attendance WHERE user_id = p_user_id AND id <> v_att.id
          AND punch_in_time < p_punch_time AND COALESCE(punch_out_time, 'infinity'::timestamptz) > v_session.punch_in_time) THEN
      RAISE EXCEPTION 'Punch-out overlaps another attendance session.';
    END IF;
    UPDATE attendance_sessions SET punch_out_time = p_punch_time, punch_out_device_info = v_metadata
      WHERE id = v_session.id;
  END IF;

  INSERT INTO attendance_punch_corrections(attendance_id, session_id, user_id, organization_id,
      action, reason, performed_by, snapshot)
    VALUES(v_att.id, v_session.id, p_user_id, v_user.organization_id,
      'admin_punch_' || p_action, btrim(p_reason), v_actor.id,
      jsonb_build_object('before', v_before, 'after', fn_correction_day_snapshot(p_user_id, p_date)));
  RETURN v_att.id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_mark_attendance_punch(uuid, date, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_mark_attendance_punch(uuid, date, text, timestamptz, text) TO authenticated;
