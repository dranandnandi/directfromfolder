-- Employee requests never change punches. Decisions apply the requested session
-- and record its before/after state in one transaction. Times use the existing
-- Indian attendance calendar; payroll remains anchored to attendance_date.
CREATE TABLE public.attendance_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  attendance_date date NOT NULL,
  attendance_id uuid,
  session_id uuid,
  proposed_punch_in timestamptz NOT NULL,
  proposed_punch_out timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb,
  reviewed_by uuid REFERENCES public.users(id),
  reviewer_name text,
  decision_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (proposed_punch_out > proposed_punch_in AND proposed_punch_out <= proposed_punch_in + interval '24 hours')
);
CREATE UNIQUE INDEX attendance_correction_one_pending_day
  ON public.attendance_correction_requests(user_id, attendance_date) WHERE status = 'pending';
CREATE INDEX attendance_correction_org_status
  ON public.attendance_correction_requests(organization_id, status, created_at);
ALTER TABLE public.attendance_correction_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_correction_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.attendance_correction_requests TO authenticated;
CREATE POLICY attendance_correction_read ON public.attendance_correction_requests
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.users u WHERE u.auth_id = auth.uid()
      AND u.is_active IS DISTINCT FROM false
      AND u.organization_id = attendance_correction_requests.organization_id
      AND (u.id = attendance_correction_requests.user_id OR u.role IN ('admin', 'superadmin'))
  ));

CREATE FUNCTION public.fn_correction_day_snapshot(p_user uuid, p_date date)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'attendance', (SELECT jsonb_build_object('id', a.id, 'shift_id', a.shift_id,
      'punch_in_time', a.punch_in_time, 'punch_out_time', a.punch_out_time,
      'updated_at', a.updated_at) FROM attendance a WHERE a.user_id = p_user AND a.date = p_date),
    'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id,
      'punch_in_time', s.punch_in_time, 'punch_out_time', s.punch_out_time,
      'updated_at', s.updated_at) ORDER BY s.id)
      FROM attendance_sessions s WHERE s.user_id = p_user AND s.date = p_date), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.fn_correction_day_snapshot(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_assert_correction_period_open(p_org uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Lock any existing period until the correction transaction finishes.
  PERFORM 1 FROM payroll_periods WHERE organization_id = p_org
    AND year = extract(year FROM p_date) AND month = extract(month FROM p_date) FOR UPDATE;
  IF EXISTS (SELECT 1 FROM payroll_periods WHERE organization_id = p_org
      AND year = extract(year FROM p_date) AND month = extract(month FROM p_date) AND status <> 'draft') THEN
    RAISE EXCEPTION 'Payroll for this attendance month is locked. Ask payroll admin to reopen it before correcting attendance.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_assert_correction_period_open(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_request_attendance_correction(
  p_date date, p_punch_in timestamptz, p_punch_out timestamptz, p_reason text,
  p_session_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user users%ROWTYPE;
  v_att attendance%ROWTYPE;
  v_session attendance_sessions%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_user FROM users WHERE auth_id = auth.uid()
    AND is_active IS DISTINCT FROM false FOR UPDATE;
  IF v_user.id IS NULL OR v_user.organization_id IS NULL THEN
    RAISE EXCEPTION 'Active organization membership is required.' USING ERRCODE = '42501';
  END IF;
  IF p_date IS NULL OR p_punch_in IS NULL OR p_punch_out IS NULL OR p_reason IS NULL
      OR length(btrim(p_reason)) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Provide a date, both punch times and a reason of 5 to 2000 characters.';
  END IF;
  IF p_date > (now() AT TIME ZONE 'Asia/Kolkata')::date OR p_punch_out > now()
      OR (p_punch_in AT TIME ZONE 'Asia/Kolkata')::date <> p_date
      OR p_punch_out <= p_punch_in OR p_punch_out > p_punch_in + interval '24 hours' THEN
    RAISE EXCEPTION 'Use completed punch times, starting on the attendance date, with a duration of at most 24 hours.';
  END IF;
  PERFORM fn_assert_correction_period_open(v_user.organization_id, p_date);
  SELECT * INTO v_att FROM attendance WHERE user_id = v_user.id AND date = p_date FOR UPDATE;
  IF v_att.id IS NOT NULL AND v_att.organization_id IS DISTINCT FROM v_user.organization_id THEN
    RAISE EXCEPTION 'This attendance belongs to a different organization.' USING ERRCODE = '42501';
  END IF;
  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM attendance_sessions WHERE id = p_session_id FOR UPDATE;
    IF v_session.id IS NULL OR v_session.user_id <> v_user.id
        OR v_session.attendance_id IS DISTINCT FROM v_att.id THEN
      RAISE EXCEPTION 'Select one of your recorded sessions for this date.' USING ERRCODE = '42501';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM attendance_sessions WHERE attendance_id = v_att.id) THEN
    RAISE EXCEPTION 'Select the session you want to correct.';
  END IF;
  IF COALESCE(v_session.punch_in_time, v_att.punch_in_time) IS NOT DISTINCT FROM p_punch_in
      AND COALESCE(v_session.punch_out_time, v_att.punch_out_time) IS NOT DISTINCT FROM p_punch_out THEN
    RAISE EXCEPTION 'The proposed times are unchanged.';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance_correction_requests WHERE user_id = v_user.id
      AND attendance_date = p_date AND status = 'pending') THEN
    RAISE EXCEPTION 'You already have a pending correction for this date. Cancel it before submitting another.';
  END IF;
  INSERT INTO attendance_correction_requests(organization_id, user_id, attendance_date,
      attendance_id, session_id, proposed_punch_in, proposed_punch_out, reason, before_snapshot)
    VALUES(v_user.organization_id, v_user.id, p_date, v_att.id, p_session_id,
      p_punch_in, p_punch_out, btrim(p_reason), fn_correction_day_snapshot(v_user.id, p_date))
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.fn_decide_attendance_correction(p_request_id uuid, p_action text, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor users%ROWTYPE;
  v_request attendance_correction_requests%ROWTYPE;
  v_att attendance%ROWTYPE;
  v_shift uuid;
  v_after jsonb;
BEGIN
  SELECT * INTO v_actor FROM users WHERE auth_id = auth.uid() AND is_active IS DISTINCT FROM false;
  IF v_actor.id IS NULL OR p_action IS NULL OR p_action NOT IN ('approve', 'reject', 'cancel') THEN
    RAISE EXCEPTION 'An active account and a valid action are required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM attendance_correction_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.organization_id IS DISTINCT FROM v_actor.organization_id THEN
    RAISE EXCEPTION 'Request not found in your organization.' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been decided.'; END IF;
  IF p_action = 'cancel' THEN
    IF v_request.user_id <> v_actor.id THEN
      RAISE EXCEPTION 'You can only cancel your own request.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF COALESCE(v_actor.role, '') NOT IN ('admin', 'superadmin') OR v_request.user_id = v_actor.id THEN
      RAISE EXCEPTION 'Another organization admin must review this request.' USING ERRCODE = '42501';
    END IF;
    IF p_action = 'reject' AND length(btrim(COALESCE(p_note, ''))) < 3 THEN
      RAISE EXCEPTION 'Explain why the request is rejected.';
    END IF;
  END IF;
  IF length(COALESCE(p_note, '')) > 2000 THEN RAISE EXCEPTION 'Keep the decision note within 2000 characters.'; END IF;

  IF p_action = 'approve' THEN
    PERFORM 1 FROM users WHERE id = v_request.user_id AND organization_id = v_actor.organization_id
      AND is_active IS DISTINCT FROM false FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The employee is no longer active in this organization.'; END IF;
    PERFORM fn_assert_correction_period_open(v_actor.organization_id, v_request.attendance_date);
    SELECT * INTO v_att FROM attendance WHERE user_id = v_request.user_id
      AND date = v_request.attendance_date FOR UPDATE;
    PERFORM 1 FROM attendance_sessions WHERE attendance_id = v_att.id FOR UPDATE;
    IF fn_correction_day_snapshot(v_request.user_id, v_request.attendance_date) <> v_request.before_snapshot THEN
      RAISE EXCEPTION 'Attendance changed after this request. Reject it and ask the employee to submit an updated request.';
    END IF;
    IF EXISTS (SELECT 1 FROM attendance_sessions s WHERE s.user_id = v_request.user_id
        AND s.id IS DISTINCT FROM v_request.session_id
        AND s.punch_in_time < v_request.proposed_punch_out
        AND COALESCE(s.punch_out_time, 'infinity'::timestamptz) > v_request.proposed_punch_in)
      OR EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = v_request.user_id
        AND a.id IS DISTINCT FROM v_att.id AND a.punch_in_time IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM attendance_sessions s WHERE s.attendance_id = a.id)
        AND a.punch_in_time < v_request.proposed_punch_out
        AND COALESCE(a.punch_out_time, 'infinity'::timestamptz) > v_request.proposed_punch_in) THEN
      RAISE EXCEPTION 'These times overlap another attendance session.';
    END IF;
    IF v_att.id IS NULL THEN
      SELECT es.shift_id INTO v_shift FROM employee_shifts es JOIN shifts s ON s.id = es.shift_id
        WHERE es.user_id = v_request.user_id AND s.organization_id = v_actor.organization_id
          AND es.effective_from <= v_request.attendance_date
          AND (es.effective_to IS NULL OR es.effective_to >= v_request.attendance_date)
        ORDER BY es.effective_from DESC LIMIT 1;
      INSERT INTO attendance(user_id, organization_id, date, shift_id)
        VALUES(v_request.user_id, v_actor.organization_id, v_request.attendance_date, v_shift)
        RETURNING * INTO v_att;
    END IF;
    IF v_request.session_id IS NOT NULL THEN
      UPDATE attendance_sessions SET punch_in_time = v_request.proposed_punch_in,
        punch_out_time = v_request.proposed_punch_out, updated_at = now() WHERE id = v_request.session_id;
    ELSIF v_att.punch_in_time IS NULL THEN
      INSERT INTO attendance_sessions(attendance_id, user_id, organization_id, date, punch_in_time, punch_out_time)
        VALUES(v_att.id, v_request.user_id, v_actor.organization_id, v_request.attendance_date,
          v_request.proposed_punch_in, v_request.proposed_punch_out);
    ELSE
      UPDATE attendance SET punch_in_time = v_request.proposed_punch_in,
        punch_out_time = v_request.proposed_punch_out, updated_at = now() WHERE id = v_att.id;
    END IF;
    -- Session triggers recalculate hours; the approved exception is also visible
    -- through the existing regularization fields used by reports and payroll.
    UPDATE attendance SET is_regularized = true, regularized_by = v_actor.id,
      regularization_reason = v_request.reason, regularized_at = now(), updated_at = now() WHERE id = v_att.id;
    v_after := fn_correction_day_snapshot(v_request.user_id, v_request.attendance_date);
    INSERT INTO attendance_punch_corrections(attendance_id, session_id, user_id, organization_id,
        action, reason, performed_by, snapshot)
      VALUES(v_att.id, v_request.session_id, v_request.user_id, v_actor.organization_id,
        'approved_attendance_request', v_request.reason, v_actor.id,
        jsonb_build_object('request_id', v_request.id, 'before', v_request.before_snapshot, 'after', v_after));
  END IF;
  UPDATE attendance_correction_requests SET
    status = CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'cancelled' END,
    attendance_id = COALESCE(v_att.id, attendance_id), after_snapshot = v_after,
    reviewed_by = v_actor.id, reviewer_name = v_actor.name, decision_note = NULLIF(btrim(p_note), ''),
    reviewed_at = now(), updated_at = now() WHERE id = v_request.id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_request_attendance_correction(date, timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_decide_attendance_correction(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_request_attendance_correction(date, timestamptz, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_decide_attendance_correction(uuid, text, text) TO authenticated;
