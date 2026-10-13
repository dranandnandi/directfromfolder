-- Multiple punch in/out cycles per day.
--
-- attendance stays one row per user per date (payroll and dashboards unchanged).
-- attendance_sessions holds every punch cycle. A trigger keeps the parent row in
-- sync: punch_in_time = first session in, punch_out_time = last session out
-- (NULL while a session is still open), session_count and session_hours = sum
-- of closed session durations.
--
-- fn_attendance_punch_compute now uses session_hours as total hours when
-- sessions exist. With one session the shift break (or 1h default) is still
-- subtracted, so ordinary single-cycle days compute exactly as before. With
-- two or more sessions no break is subtracted: the gaps between sessions are
-- the break.
--
-- Rows created before this migration have session_count = 0 and keep the old
-- behaviour. The app creates a session from the legacy punch fields the first
-- time such a day gets a second punch.

-- ------------------------------------------------------------------
-- 1. Parent columns
-- ------------------------------------------------------------------
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_count integer NOT NULL DEFAULT 0;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_hours numeric;

-- ------------------------------------------------------------------
-- 2. Sessions table
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid REFERENCES organizations(id),
  date date NOT NULL,

  punch_in_time timestamptz NOT NULL,
  punch_in_latitude numeric,
  punch_in_longitude numeric,
  punch_in_address text,
  punch_in_selfie_url text,
  punch_in_device_info jsonb,
  punch_in_distance_meters numeric,

  punch_out_time timestamptz,
  punch_out_latitude numeric,
  punch_out_longitude numeric,
  punch_out_address text,
  punch_out_selfie_url text,
  punch_out_device_info jsonb,
  punch_out_distance_meters numeric,

  is_outside_geofence boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendance_sessions_out_after_in
    CHECK (punch_out_time IS NULL OR punch_out_time >= punch_in_time)
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_attendance
  ON attendance_sessions(attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_user_date
  ON attendance_sessions(user_id, date);
-- At most one open session per user at any time.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_one_open_per_user
  ON attendance_sessions(user_id) WHERE punch_out_time IS NULL;

ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_sessions_organization_access" ON attendance_sessions;
CREATE POLICY "attendance_sessions_organization_access"
  ON attendance_sessions FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE auth_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE auth_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------
-- 3. Keep the parent attendance row in sync with its sessions
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_attendance_sessions_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_att_id uuid;
  v_count integer;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_has_open boolean;
  v_hours numeric;
  v_outside boolean;
  v_first record;
  v_last record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_att_id := OLD.attendance_id;
  ELSE
    v_att_id := NEW.attendance_id;
  END IF;

  SELECT
    COUNT(*),
    MIN(punch_in_time),
    MAX(punch_out_time),
    COALESCE(BOOL_OR(punch_out_time IS NULL), false),
    COALESCE(SUM(EXTRACT(EPOCH FROM (punch_out_time - punch_in_time)) / 3600.0)
             FILTER (WHERE punch_out_time IS NOT NULL), 0),
    COALESCE(BOOL_OR(is_outside_geofence), false)
  INTO v_count, v_first_in, v_last_out, v_has_open, v_hours, v_outside
  FROM attendance_sessions
  WHERE attendance_id = v_att_id;

  IF v_count = 0 THEN
    -- Last session removed: leave legacy punch fields alone, just reset counters.
    UPDATE attendance
       SET session_count = 0,
           session_hours = NULL,
           updated_at = now()
     WHERE id = v_att_id;
    RETURN NULL;
  END IF;

  -- First punch-in details and last punch-out details for the parent row.
  SELECT * INTO v_first
    FROM attendance_sessions
   WHERE attendance_id = v_att_id
   ORDER BY punch_in_time ASC
   LIMIT 1;

  SELECT * INTO v_last
    FROM attendance_sessions
   WHERE attendance_id = v_att_id AND punch_out_time IS NOT NULL
   ORDER BY punch_out_time DESC
   LIMIT 1;

  IF v_has_open THEN
    -- Still checked in: parent shows an open day.
    UPDATE attendance
       SET session_count             = v_count,
           session_hours             = ROUND(v_hours, 2),
           punch_in_time             = v_first_in,
           punch_in_latitude         = v_first.punch_in_latitude,
           punch_in_longitude        = v_first.punch_in_longitude,
           punch_in_address          = v_first.punch_in_address,
           punch_in_selfie_url       = v_first.punch_in_selfie_url,
           punch_in_device_info      = v_first.punch_in_device_info,
           punch_in_distance_meters  = v_first.punch_in_distance_meters,
           punch_out_time            = NULL,
           punch_out_latitude        = NULL,
           punch_out_longitude       = NULL,
           punch_out_address         = NULL,
           punch_out_selfie_url      = NULL,
           punch_out_device_info     = NULL,
           punch_out_distance_meters = NULL,
           total_hours               = NULL,
           effective_hours           = NULL,
           is_early_out              = false,
           is_outside_geofence       = v_outside,
           is_absent                 = false,
           updated_at                = now()
     WHERE id = v_att_id;
  ELSE
    UPDATE attendance
       SET session_count             = v_count,
           session_hours             = ROUND(v_hours, 2),
           punch_in_time             = v_first_in,
           punch_in_latitude         = v_first.punch_in_latitude,
           punch_in_longitude        = v_first.punch_in_longitude,
           punch_in_address          = v_first.punch_in_address,
           punch_in_selfie_url       = v_first.punch_in_selfie_url,
           punch_in_device_info      = v_first.punch_in_device_info,
           punch_in_distance_meters  = v_first.punch_in_distance_meters,
           punch_out_time            = v_last_out,
           punch_out_latitude        = v_last.punch_out_latitude,
           punch_out_longitude       = v_last.punch_out_longitude,
           punch_out_address         = v_last.punch_out_address,
           punch_out_selfie_url      = v_last.punch_out_selfie_url,
           punch_out_device_info     = v_last.punch_out_device_info,
           punch_out_distance_meters = v_last.punch_out_distance_meters,
           is_outside_geofence       = v_outside,
           is_absent                 = false,
           updated_at                = now()
     WHERE id = v_att_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_sessions_sync ON attendance_sessions;
CREATE TRIGGER trg_attendance_sessions_sync
  AFTER INSERT OR UPDATE OR DELETE ON attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fn_attendance_sessions_sync();

CREATE OR REPLACE FUNCTION fn_attendance_sessions_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_sessions_touch ON attendance_sessions;
CREATE TRIGGER trg_attendance_sessions_touch
  BEFORE UPDATE ON attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fn_attendance_sessions_touch();

-- ------------------------------------------------------------------
-- 4. Hours from sessions in the compute trigger
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_attendance_punch_compute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift record;
  v_shift_found boolean := false;
  v_punch_in_minutes integer;
  v_punch_out_minutes integer;
  v_shift_start_minutes integer;
  v_shift_end_minutes integer;
  v_total_hours numeric;
  v_break_hours numeric;
  v_effective_hours numeric;
  v_is_late boolean := false;
  v_is_early_out boolean := false;
  v_is_half_day boolean := false;
  v_day_name text;
  v_is_weekend boolean := false;
  v_is_holiday boolean := false;
BEGIN
  -- Always assign v_shift so it is never an unassigned record.
  SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
  v_shift_found := FOUND;

  IF NEW.punch_in_time IS NOT NULL AND NEW.punch_out_time IS NOT NULL THEN
    -- Break: shift break, or 1h default when no shift.
    IF v_shift_found THEN
      v_break_hours := COALESCE(v_shift.break_duration_minutes, 0) / 60.0;
    ELSE
      v_break_hours := 1.0;
    END IF;

    IF COALESCE(NEW.session_count, 0) > 0 AND NEW.session_hours IS NOT NULL THEN
      -- Hours are the sum of closed sessions. With several sessions the gaps
      -- between them are the break, so none is subtracted.
      v_total_hours := NEW.session_hours;
      IF NEW.session_count > 1 THEN
        v_break_hours := 0;
      END IF;
    ELSE
      v_total_hours := EXTRACT(EPOCH FROM (NEW.punch_out_time::timestamptz - NEW.punch_in_time::timestamptz)) / 3600.0;
    END IF;

    v_effective_hours := GREATEST(v_total_hours - v_break_hours, 0);

    IF v_shift_found THEN
      v_shift_start_minutes := EXTRACT(HOUR FROM v_shift.start_time::time) * 60
                              + EXTRACT(MINUTE FROM v_shift.start_time::time);
      v_shift_end_minutes := EXTRACT(HOUR FROM v_shift.end_time::time) * 60
                            + EXTRACT(MINUTE FROM v_shift.end_time::time);

      v_punch_in_minutes := EXTRACT(HOUR FROM NEW.punch_in_time::timestamptz) * 60
                           + EXTRACT(MINUTE FROM NEW.punch_in_time::timestamptz);
      v_punch_out_minutes := EXTRACT(HOUR FROM NEW.punch_out_time::timestamptz) * 60
                            + EXTRACT(MINUTE FROM NEW.punch_out_time::timestamptz);

      v_is_late := v_punch_in_minutes > (v_shift_start_minutes + COALESCE(v_shift.late_threshold_minutes, 15));

      IF NOT COALESCE(v_shift.is_overnight, false) THEN
        v_is_early_out := v_punch_out_minutes < (v_shift_end_minutes - COALESCE(v_shift.early_out_threshold_minutes, 15));
      END IF;

      v_is_half_day := v_effective_hours < (COALESCE(v_shift.duration_hours, 8)::numeric / 2.0);
    ELSE
      v_is_half_day := v_effective_hours < 4.0;
    END IF;

    NEW.total_hours := ROUND(v_total_hours, 2);
    NEW.effective_hours := ROUND(v_effective_hours, 2);
    NEW.is_late := v_is_late;
    NEW.is_early_out := v_is_early_out;
    NEW.is_half_day := v_is_half_day;
    NEW.is_absent := false;
  END IF;

  IF NEW.date IS NOT NULL THEN
    v_day_name := TRIM(LOWER(TO_CHAR(NEW.date::date, 'day')));

    v_is_weekend := EXTRACT(DOW FROM NEW.date::date) = 0; -- fallback: Sunday
    IF v_shift_found THEN
      IF v_shift.weekly_off_days IS NOT NULL THEN
        v_is_weekend := v_day_name = ANY(v_shift.weekly_off_days);
      END IF;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM org_holidays oh
      WHERE oh.organization_id = NEW.organization_id
        AND oh.date = NEW.date::date
        AND (oh.applies_to_shifts IS NULL OR NEW.shift_id = ANY(oh.applies_to_shifts))
    ) INTO v_is_holiday;

    NEW.is_weekend := v_is_weekend;
    IF v_is_holiday THEN
      NEW.is_holiday := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_punch_compute ON attendance;
CREATE TRIGGER trg_attendance_punch_compute
  BEFORE INSERT OR UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION fn_attendance_punch_compute();
