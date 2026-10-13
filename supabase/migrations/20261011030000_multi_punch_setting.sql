-- Per-user switch for multiple punch in/out cycles per day.
--
-- organizations.allow_multiple_punches: the default for the org (false).
-- users.allow_multiple_punches: NULL = use the org default, true/false = override.
--
-- Enforced in the database: a second session for the same day is rejected
-- unless the resolved setting is true. The app checks the same function
-- before offering "Punch In Again".

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allow_multiple_punches boolean NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allow_multiple_punches boolean; -- NULL = organization default

CREATE OR REPLACE FUNCTION fn_user_allows_multiple_punches(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(u.allow_multiple_punches, o.allow_multiple_punches, false)
  FROM users u
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION fn_user_allows_multiple_punches(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION fn_attendance_sessions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM attendance_sessions WHERE attendance_id = NEW.attendance_id)
     AND NOT COALESCE(fn_user_allows_multiple_punches(NEW.user_id), false) THEN
    RAISE EXCEPTION 'Multiple punches per day are not enabled for this user'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_sessions_guard ON attendance_sessions;
CREATE TRIGGER trg_attendance_sessions_guard
  BEFORE INSERT ON attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fn_attendance_sessions_guard();
