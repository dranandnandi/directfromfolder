-- Honest-mistake fixes for punches.
--
-- Employee (own punches, sessions of 5 minutes or less):
--   fn_undo_my_punch('out')     reopens the short session, user stays checked in
--   fn_undo_my_punch('discard') deletes the short session
--   fn_undo_my_punch('in')      cancels a punch-in made at most 5 minutes ago
-- Admin (any punch in the organization, reason required):
--   fn_admin_reopen_punch_out  clears the punch-out so the day is open again
--   fn_admin_delete_punch      removes a session (or the legacy punch of a day)
--
-- Every correction is written to attendance_punch_corrections. The audit table
-- has no FK to attendance so the history survives when a day row is removed.
-- The attendance_sessions triggers keep the day row in sync, so these
-- functions only touch session rows (or the day row for pre-session days).

-- ------------------------------------------------------------------
-- 1. Audit table
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_punch_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid,
  session_id uuid,
  user_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid REFERENCES organizations(id),
  action text NOT NULL,
  reason text,
  performed_by uuid REFERENCES users(id),
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_punch_corrections_user
  ON attendance_punch_corrections(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_punch_corrections_org
  ON attendance_punch_corrections(organization_id, created_at DESC);

ALTER TABLE attendance_punch_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS punch_corrections_select ON attendance_punch_corrections;
-- Read only: rows are written by the SECURITY DEFINER functions below.
CREATE POLICY punch_corrections_select ON attendance_punch_corrections
  FOR SELECT TO authenticated
  USING (user_id = public.get_current_user_id() OR public.fn_admin_of_user(user_id));
REVOKE ALL ON attendance_punch_corrections FROM anon, PUBLIC;
GRANT SELECT ON attendance_punch_corrections TO authenticated;

-- ------------------------------------------------------------------
-- 2. Internal helpers (not callable from the API)
-- ------------------------------------------------------------------

-- Clears punch-out data on a day row that has no session rows.
CREATE OR REPLACE FUNCTION fn_attendance_clear_legacy_punch_out(p_att uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE attendance
     SET punch_out_time = NULL,
         punch_out_latitude = NULL,
         punch_out_longitude = NULL,
         punch_out_address = NULL,
         punch_out_selfie_url = NULL,
         punch_out_device_info = NULL,
         punch_out_distance_meters = NULL,
         total_hours = NULL,
         effective_hours = NULL,
         is_early_out = false,
         is_half_day = false,
         updated_at = now()
   WHERE id = p_att;
$$;

-- A day row whose last punch was removed: drop it, or when it carries
-- regularization history, reset it to an empty day instead.
CREATE OR REPLACE FUNCTION fn_attendance_drop_empty_day(p_att uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM attendance_regularizations WHERE attendance_id = p_att) THEN
    UPDATE attendance
       SET punch_in_time = NULL,
           punch_in_latitude = NULL,
           punch_in_longitude = NULL,
           punch_in_address = NULL,
           punch_in_selfie_url = NULL,
           punch_in_device_info = NULL,
           punch_in_distance_meters = NULL,
           punch_out_time = NULL,
           punch_out_latitude = NULL,
           punch_out_longitude = NULL,
           punch_out_address = NULL,
           punch_out_selfie_url = NULL,
           punch_out_device_info = NULL,
           punch_out_distance_meters = NULL,
           total_hours = NULL,
           effective_hours = NULL,
           is_late = false,
           is_early_out = false,
           is_half_day = false,
           is_outside_geofence = false,
           session_count = 0,
           session_hours = NULL,
           updated_at = now()
     WHERE id = p_att;
  ELSE
    DELETE FROM attendance WHERE id = p_att;
  END IF;
END;
$$;

-- Reopens one closed session. Shared by the employee and admin entry points.
CREATE OR REPLACE FUNCTION fn_punch_reopen_session(p_session uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE attendance_sessions
     SET punch_out_time = NULL,
         punch_out_latitude = NULL,
         punch_out_longitude = NULL,
         punch_out_address = NULL,
         punch_out_selfie_url = NULL,
         punch_out_device_info = NULL,
         punch_out_distance_meters = NULL
   WHERE id = p_session;
END;
$$;

-- Removes one session and cleans the day row if it was the last one.
CREATE OR REPLACE FUNCTION fn_punch_delete_session(p_session uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att uuid;
BEGIN
  SELECT attendance_id INTO v_att FROM attendance_sessions WHERE id = p_session;
  DELETE FROM attendance_sessions WHERE id = p_session;
  IF NOT EXISTS (SELECT 1 FROM attendance_sessions WHERE attendance_id = v_att) THEN
    PERFORM fn_attendance_drop_empty_day(v_att);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fn_attendance_clear_legacy_punch_out(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_attendance_drop_empty_day(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_punch_reopen_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_punch_delete_session(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------
-- 3. Employee self-undo
--
-- A punch is a "mistake" when the session lasted at most 5 minutes
-- (punch-in to punch-out). The request itself may come later the same day
-- (12 hour lookback, which also covers overnight shifts).
--   'in'      cancel an open punch-in made at most 5 minutes ago
--   'out'     reopen a short session, employee stays checked in
--   'discard' delete a short session entirely
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_undo_my_punch(p_kind text)
RETURNS uuid  -- attendance id the punch belonged to
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_window   CONSTANT interval := interval '5 minutes';
  c_lookback CONSTANT interval := interval '12 hours';
  v_uid uuid := public.get_current_user_id();
  v_sess attendance_sessions%ROWTYPE;
  v_att attendance%ROWTYPE;
  v_action text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF p_kind NOT IN ('in', 'out', 'discard') THEN
    RAISE EXCEPTION 'Unknown punch kind: %', p_kind;
  END IF;

  -- ---- cancel an open punch-in ----
  IF p_kind = 'in' THEN
    SELECT * INTO v_sess
      FROM attendance_sessions
     WHERE user_id = v_uid
       AND punch_out_time IS NULL
       AND punch_in_time >= now() - c_window
     ORDER BY punch_in_time DESC
     LIMIT 1;

    IF FOUND THEN
      PERFORM fn_punch_delete_session(v_sess.id);
      INSERT INTO attendance_punch_corrections
        (attendance_id, session_id, user_id, organization_id, action, reason, performed_by, snapshot)
      VALUES
        (v_sess.attendance_id, v_sess.id, v_uid, v_sess.organization_id,
         'self_cancel_punch_in', 'Cancelled by employee within 5 minutes', v_uid, to_jsonb(v_sess));
      RETURN v_sess.attendance_id;
    END IF;

    SELECT * INTO v_att
      FROM attendance
     WHERE user_id = v_uid
       AND COALESCE(session_count, 0) = 0
       AND punch_in_time IS NOT NULL
       AND punch_out_time IS NULL
       AND punch_in_time >= now() - c_window
     ORDER BY punch_in_time DESC
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nothing to cancel. Punch-in can only be cancelled within 5 minutes.';
    END IF;

    PERFORM fn_attendance_drop_empty_day(v_att.id);
    INSERT INTO attendance_punch_corrections
      (attendance_id, user_id, organization_id, action, reason, performed_by, snapshot)
    VALUES
      (v_att.id, v_uid, v_att.organization_id,
       'self_cancel_punch_in', 'Cancelled by employee within 5 minutes', v_uid, to_jsonb(v_att));
    RETURN v_att.id;
  END IF;

  -- ---- 'out' / 'discard': act on the latest closed session ----
  v_action := CASE p_kind WHEN 'out' THEN 'self_undo_punch_out' ELSE 'self_discard_short_punch' END;

  IF EXISTS (SELECT 1 FROM attendance_sessions WHERE user_id = v_uid AND punch_out_time IS NULL) THEN
    RAISE EXCEPTION 'You are punched in. Punch out first.';
  END IF;

  SELECT * INTO v_sess
    FROM attendance_sessions
   WHERE user_id = v_uid
     AND punch_out_time IS NOT NULL
     AND punch_out_time >= now() - c_lookback
   ORDER BY punch_out_time DESC
   LIMIT 1;

  IF FOUND THEN
    IF v_sess.punch_out_time - v_sess.punch_in_time > c_window THEN
      RAISE EXCEPTION 'Only a punch that lasted 5 minutes or less can be undone. Ask your administrator.';
    END IF;

    IF p_kind = 'out' THEN
      PERFORM fn_punch_reopen_session(v_sess.id);
    ELSE
      PERFORM fn_punch_delete_session(v_sess.id);
    END IF;

    INSERT INTO attendance_punch_corrections
      (attendance_id, session_id, user_id, organization_id, action, reason, performed_by, snapshot)
    VALUES
      (v_sess.attendance_id, v_sess.id, v_uid, v_sess.organization_id,
       v_action, 'Short punch (5 minutes or less) corrected by employee', v_uid, to_jsonb(v_sess));
    RETURN v_sess.attendance_id;
  END IF;

  -- Day recorded before sessions existed.
  SELECT * INTO v_att
    FROM attendance
   WHERE user_id = v_uid
     AND COALESCE(session_count, 0) = 0
     AND punch_in_time IS NOT NULL
     AND punch_out_time IS NOT NULL
     AND punch_out_time >= now() - c_lookback
   ORDER BY punch_out_time DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nothing to undo.';
  END IF;
  IF v_att.punch_out_time - v_att.punch_in_time > c_window THEN
    RAISE EXCEPTION 'Only a punch that lasted 5 minutes or less can be undone. Ask your administrator.';
  END IF;

  IF p_kind = 'out' THEN
    PERFORM fn_attendance_clear_legacy_punch_out(v_att.id);
  ELSE
    PERFORM fn_attendance_drop_empty_day(v_att.id);
  END IF;
  INSERT INTO attendance_punch_corrections
    (attendance_id, user_id, organization_id, action, reason, performed_by, snapshot)
  VALUES
    (v_att.id, v_uid, v_att.organization_id,
     v_action, 'Short punch (5 minutes or less) corrected by employee', v_uid, to_jsonb(v_att));
  RETURN v_att.id;
END;
$$;

-- ------------------------------------------------------------------
-- 4. Admin corrections
-- ------------------------------------------------------------------

-- Reopens the punch-out of a day. p_session_id picks a session; without it the
-- most recently closed session (or the legacy punch-out) is used.
CREATE OR REPLACE FUNCTION fn_admin_reopen_punch_out(
  p_attendance_id uuid,
  p_reason text,
  p_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att attendance%ROWTYPE;
  v_sess attendance_sessions%ROWTYPE;
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT * INTO v_att FROM attendance WHERE id = p_attendance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance record not found';
  END IF;
  IF NOT public.fn_admin_of_user(v_att.user_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance_sessions WHERE user_id = v_att.user_id AND punch_out_time IS NULL) THEN
    RAISE EXCEPTION 'This employee is already punched in. Close that punch first.';
  END IF;

  IF COALESCE(v_att.session_count, 0) > 0 THEN
    SELECT * INTO v_sess
      FROM attendance_sessions
     WHERE attendance_id = p_attendance_id
       AND punch_out_time IS NOT NULL
       AND (p_session_id IS NULL OR id = p_session_id)
     ORDER BY punch_out_time DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No closed session to reopen';
    END IF;

    PERFORM fn_punch_reopen_session(v_sess.id);
    INSERT INTO attendance_punch_corrections
      (attendance_id, session_id, user_id, organization_id, action, reason, performed_by, snapshot)
    VALUES
      (p_attendance_id, v_sess.id, v_att.user_id, v_att.organization_id,
       'admin_reopen_punch_out', p_reason, public.get_current_user_id(), to_jsonb(v_sess));
  ELSE
    IF v_att.punch_out_time IS NULL THEN
      RAISE EXCEPTION 'This day has no punch-out to reopen';
    END IF;

    PERFORM fn_attendance_clear_legacy_punch_out(p_attendance_id);
    INSERT INTO attendance_punch_corrections
      (attendance_id, user_id, organization_id, action, reason, performed_by, snapshot)
    VALUES
      (p_attendance_id, v_att.user_id, v_att.organization_id,
       'admin_reopen_punch_out', p_reason, public.get_current_user_id(), to_jsonb(v_att));
  END IF;
END;
$$;

-- Deletes a punch. With p_session_id it removes that session; without it the
-- day must be a pre-session day and its legacy punch is removed.
CREATE OR REPLACE FUNCTION fn_admin_delete_punch(
  p_attendance_id uuid,
  p_reason text,
  p_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att attendance%ROWTYPE;
  v_sess attendance_sessions%ROWTYPE;
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT * INTO v_att FROM attendance WHERE id = p_attendance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance record not found';
  END IF;
  IF NOT public.fn_admin_of_user(v_att.user_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_sess
      FROM attendance_sessions
     WHERE id = p_session_id AND attendance_id = p_attendance_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Session not found on this day';
    END IF;

    -- Audit first: the day row may disappear with its last session.
    INSERT INTO attendance_punch_corrections
      (attendance_id, session_id, user_id, organization_id, action, reason, performed_by, snapshot)
    VALUES
      (p_attendance_id, v_sess.id, v_att.user_id, v_att.organization_id,
       'admin_delete_punch', p_reason, public.get_current_user_id(), to_jsonb(v_sess));
    PERFORM fn_punch_delete_session(v_sess.id);
  ELSE
    IF COALESCE(v_att.session_count, 0) > 0 THEN
      RAISE EXCEPTION 'This day has several sessions. Choose which one to delete.';
    END IF;
    IF v_att.punch_in_time IS NULL THEN
      RAISE EXCEPTION 'This day has no punch to delete';
    END IF;

    INSERT INTO attendance_punch_corrections
      (attendance_id, user_id, organization_id, action, reason, performed_by, snapshot)
    VALUES
      (p_attendance_id, v_att.user_id, v_att.organization_id,
       'admin_delete_punch', p_reason, public.get_current_user_id(), to_jsonb(v_att));
    PERFORM fn_attendance_drop_empty_day(p_attendance_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fn_undo_my_punch(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fn_admin_reopen_punch_out(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fn_admin_delete_punch(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_undo_my_punch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_admin_reopen_punch_out(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_admin_delete_punch(uuid, text, uuid) TO authenticated;
