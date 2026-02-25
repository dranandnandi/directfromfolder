-- ============================================================
-- FIX: Attendance Gaps - Half-day, Shift-aware working days,
--      org_holidays integration, punch-time flag computation
-- Run this in Supabase SQL Editor
-- Date: 2026-02-09
-- ============================================================

-- ============================================================
-- 1. Add is_half_day column to attendance table
-- ============================================================
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_half_day boolean DEFAULT false;

-- ============================================================
-- 2. DB trigger: auto-compute effective_hours, total_hours,
--    is_late, is_early_out, is_half_day on punch_out
-- ============================================================
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
  v_effective_hours numeric;
  v_is_late boolean := false;
  v_is_early_out boolean := false;
  v_is_half_day boolean := false;
  v_day_name text;
  v_is_weekend boolean := false;
  v_is_holiday boolean := false;
BEGIN
  -- Pre-load shift if shift_id is set (needed by both punch-out compute and weekend detect)
  IF NEW.shift_id IS NOT NULL THEN
    SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
    IF FOUND THEN
      v_shift_found := true;
    END IF;
  END IF;

  -- Only compute hours/late/early when punch_out_time is set (or updated)
  IF NEW.punch_in_time IS NOT NULL AND NEW.punch_out_time IS NOT NULL THEN

    -- Calculate total hours worked
    v_total_hours := EXTRACT(EPOCH FROM (NEW.punch_out_time::timestamptz - NEW.punch_in_time::timestamptz)) / 3600.0;
    
    -- Effective hours = total - break
    IF v_shift_found THEN
      v_effective_hours := v_total_hours - COALESCE(v_shift.break_duration_minutes, 0) / 60.0;
    ELSE
      v_effective_hours := v_total_hours - 1.0; -- default 1hr break
    END IF;
    v_effective_hours := GREATEST(v_effective_hours, 0);

    IF v_shift_found THEN
      -- Parse shift start/end to minutes
      v_shift_start_minutes := EXTRACT(HOUR FROM v_shift.start_time::time) * 60 
                              + EXTRACT(MINUTE FROM v_shift.start_time::time);
      v_shift_end_minutes := EXTRACT(HOUR FROM v_shift.end_time::time) * 60 
                            + EXTRACT(MINUTE FROM v_shift.end_time::time);

      -- Parse punch times to minutes
      v_punch_in_minutes := EXTRACT(HOUR FROM NEW.punch_in_time::timestamptz) * 60 
                           + EXTRACT(MINUTE FROM NEW.punch_in_time::timestamptz);
      v_punch_out_minutes := EXTRACT(HOUR FROM NEW.punch_out_time::timestamptz) * 60 
                            + EXTRACT(MINUTE FROM NEW.punch_out_time::timestamptz);

      -- is_late: punched in after shift_start + late_threshold
      v_is_late := v_punch_in_minutes > (v_shift_start_minutes + COALESCE(v_shift.late_threshold_minutes, 15));

      -- is_early_out: punched out before shift_end - early_threshold
      IF NOT COALESCE(v_shift.is_overnight, false) THEN
        v_is_early_out := v_punch_out_minutes < (v_shift_end_minutes - COALESCE(v_shift.early_out_threshold_minutes, 15));
      END IF;

      -- is_half_day: worked less than half the shift duration
      v_is_half_day := v_effective_hours < (v_shift.duration_hours::numeric / 2.0);
    ELSE
      -- No shift: use 8hr default
      v_is_half_day := v_effective_hours < 4.0;
    END IF;

    NEW.total_hours := ROUND(v_total_hours, 2);
    NEW.effective_hours := ROUND(v_effective_hours, 2);
    NEW.is_late := v_is_late;
    NEW.is_early_out := v_is_early_out;
    NEW.is_half_day := v_is_half_day;
    NEW.is_absent := false; -- they showed up
  END IF;

  -- Auto-detect weekend using shift weekly_off_days
  IF NEW.date IS NOT NULL THEN
    v_day_name := LOWER(TO_CHAR(NEW.date::date, 'day'));
    v_day_name := TRIM(v_day_name); -- TO_CHAR pads with spaces

    IF v_shift_found AND v_shift.weekly_off_days IS NOT NULL THEN
      v_is_weekend := v_day_name = ANY(v_shift.weekly_off_days);
    ELSE
      -- Fallback: Sunday only
      v_is_weekend := EXTRACT(DOW FROM NEW.date::date) = 0;
    END IF;

    -- Check org_holidays
    SELECT EXISTS(
      SELECT 1 FROM org_holidays oh
      WHERE oh.organization_id = NEW.organization_id
        AND oh.date = NEW.date::date
        AND (oh.applies_to_shifts IS NULL OR NEW.shift_id = ANY(oh.applies_to_shifts))
    ) INTO v_is_holiday;

    NEW.is_weekend := v_is_weekend;
    -- Only set holiday if org_holidays says so (don't override manual marks)
    IF v_is_holiday THEN
      NEW.is_holiday := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_attendance_punch_compute ON attendance;
CREATE TRIGGER trg_attendance_punch_compute
  BEFORE INSERT OR UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION fn_attendance_punch_compute();


-- ============================================================
-- 3. Fix fn_resolve_attendance_basis to use shift weekly_off_days
--    instead of hardcoded Sunday-only
-- ============================================================
DROP FUNCTION IF EXISTS fn_resolve_attendance_basis(uuid, integer, integer);

CREATE OR REPLACE FUNCTION fn_resolve_attendance_basis(
  p_user uuid,
  p_month integer,
  p_year integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
  v_start_date date;
  v_end_date date;
  v_working_days integer;
  v_present_days integer := 0;
  v_half_days integer := 0;
  v_lop_days numeric := 0;
  v_paid_leaves integer := 0;
  v_ot_hours numeric := 0;
  v_late_count integer := 0;
  v_total_hours numeric := 0;
  v_override record;
  v_shift record;
  v_weekly_offs text[];
BEGIN
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := (v_start_date + interval '1 month' - interval '1 day')::date;

  -- Get employee's current shift for weekly off days
  SELECT s.* INTO v_shift
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id
  WHERE es.user_id = p_user
    AND es.effective_from <= v_end_date
    AND (es.effective_to IS NULL OR es.effective_to >= v_start_date)
  ORDER BY es.effective_from DESC
  LIMIT 1;

  v_weekly_offs := COALESCE(v_shift.weekly_off_days, ARRAY['sunday']);

  -- Working days: exclude days matching shift's weekly_off_days + org holidays
  SELECT COUNT(*)
  INTO v_working_days
  FROM generate_series(v_start_date, v_end_date, '1 day'::interval) d
  WHERE LOWER(TRIM(TO_CHAR(d::date, 'day'))) != ALL(v_weekly_offs)
    AND NOT EXISTS (
      SELECT 1 FROM org_holidays oh
      WHERE oh.date = d::date
        AND oh.organization_id = (SELECT organization_id FROM users WHERE id = p_user LIMIT 1)
        AND NOT COALESCE(oh.is_optional, false)
    );

  -- Aggregate attendance (half_day counts as 0.5 present)
  SELECT
    COALESCE(COUNT(*) FILTER (WHERE NOT COALESCE(is_absent, false) 
                                AND NOT COALESCE(is_weekend, false) 
                                AND NOT COALESCE(is_holiday, false)
                                AND NOT COALESCE(is_half_day, false)), 0),
    COALESCE(COUNT(*) FILTER (WHERE COALESCE(is_half_day, false)
                                AND NOT COALESCE(is_absent, false)
                                AND NOT COALESCE(is_weekend, false)
                                AND NOT COALESCE(is_holiday, false)), 0),
    COALESCE(COUNT(*) FILTER (WHERE COALESCE(is_holiday, false) 
                                OR (COALESCE(is_absent, false) AND COALESCE(is_regularized, false))), 0),
    COALESCE(COUNT(*) FILTER (WHERE COALESCE(is_late, false)), 0),
    COALESCE(SUM(COALESCE(effective_hours, 0)), 0)
  INTO v_present_days, v_half_days, v_paid_leaves, v_late_count, v_total_hours
  FROM attendance
  WHERE user_id = p_user
    AND date >= v_start_date
    AND date <= v_end_date;

  -- Check for manual overrides
  SELECT *
  INTO v_override
  FROM attendance_monthly_overrides
  WHERE user_id = p_user
    AND month = p_month
    AND year = p_year
  LIMIT 1;

  IF FOUND THEN
    v_present_days := COALESCE((v_override.payload->>'present_days')::integer, v_present_days);
    v_lop_days := COALESCE((v_override.payload->>'lop_days')::numeric, v_lop_days);
    v_paid_leaves := COALESCE((v_override.payload->>'paid_leaves')::integer, v_paid_leaves);
    v_ot_hours := COALESCE((v_override.payload->>'ot_hours')::numeric, 0);
    v_late_count := COALESCE((v_override.payload->>'late_count')::integer, v_late_count);
    v_half_days := COALESCE((v_override.payload->>'half_days')::integer, v_half_days);
  END IF;

  -- PAYABLE DAYS LOGIC:
  -- Half days count as 0.5 present days
  -- present_days_effective = full_present + (half_days * 0.5)
  IF (v_present_days + v_half_days + v_paid_leaves) > 0 THEN
    v_lop_days := GREATEST(v_working_days - v_present_days - (v_half_days * 0.5) - v_paid_leaves, 0);
  ELSE
    -- No attendance tracking — assume full attendance
    v_lop_days := 0;
  END IF;

  v_result := jsonb_build_object(
    'present_days', v_present_days,
    'half_days', v_half_days,
    'lop_days', v_lop_days,
    'paid_leaves', v_paid_leaves,
    'ot_hours', v_ot_hours,
    'late_count', v_late_count,
    'total_hours', v_total_hours,
    'working_days', v_working_days,
    'payable_days', GREATEST(v_working_days - v_lop_days, 0),
    'weekly_offs', to_jsonb(v_weekly_offs)
  );

  RETURN v_result;
END;
$$;

-- Re-grant after DROP+CREATE
GRANT EXECUTE ON FUNCTION fn_resolve_attendance_basis(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_resolve_attendance_basis(uuid, integer, integer) TO service_role;


-- ============================================================
-- 4. Utility: Populate attendance for absent employees
--    (creates absent records for working days with no punch)
--    Called by the hydrator or scheduled function
-- ============================================================
CREATE OR REPLACE FUNCTION fn_populate_absent_records(
  p_organization_id uuid,
  p_date date
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_day_name text;
  v_inserted integer := 0;
BEGIN
  v_day_name := LOWER(TRIM(TO_CHAR(p_date, 'day')));

  -- Insert absent records for employees who have a shift but no attendance record
  INSERT INTO attendance (user_id, organization_id, date, shift_id, is_absent, is_weekend, is_holiday)
  SELECT 
    es.user_id,
    p_organization_id,
    p_date,
    es.shift_id,
    -- is_absent: true if it's a working day and they didn't punch
    NOT (v_day_name = ANY(COALESCE(s.weekly_off_days, ARRAY['sunday'])))
      AND NOT EXISTS (
        SELECT 1 FROM org_holidays oh 
        WHERE oh.date = p_date AND oh.organization_id = p_organization_id
          AND (oh.applies_to_shifts IS NULL OR es.shift_id = ANY(oh.applies_to_shifts))
      ),
    -- is_weekend
    v_day_name = ANY(COALESCE(s.weekly_off_days, ARRAY['sunday'])),
    -- is_holiday
    EXISTS (
      SELECT 1 FROM org_holidays oh 
      WHERE oh.date = p_date AND oh.organization_id = p_organization_id
        AND (oh.applies_to_shifts IS NULL OR es.shift_id = ANY(oh.applies_to_shifts))
    )
  FROM employee_shifts es
  JOIN shifts s ON s.id = es.shift_id AND s.organization_id = p_organization_id
  WHERE es.effective_from <= p_date
    AND (es.effective_to IS NULL OR es.effective_to >= p_date)
    AND NOT EXISTS (
      SELECT 1 FROM attendance a 
      WHERE a.user_id = es.user_id AND a.date = p_date
    )
  ON CONFLICT (user_id, date) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_populate_absent_records(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_populate_absent_records(uuid, date) TO service_role;

-- ============================================================
-- 5. Utility: Clean stale/invalid open overnight punch-ins
--    Use for users stuck on "Punch Out" due to wrong morning punch-in
-- ============================================================
CREATE OR REPLACE FUNCTION fn_cleanup_open_overnight_records(
  p_user_ids uuid[],
  p_shift_id uuid,
  p_timezone text DEFAULT 'Asia/Kolkata',
  p_max_open_hours integer DEFAULT 16
) RETURNS TABLE(
  attendance_id uuid,
  user_id uuid,
  attendance_date date,
  punch_in_time timestamptz,
  action_taken text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH target AS (
    SELECT
      a.id as attendance_id,
      a.user_id,
      a.date as attendance_date,
      a.punch_in_time
    FROM attendance a
    JOIN shifts s ON s.id = a.shift_id
    WHERE a.user_id = ANY(p_user_ids)
      AND a.shift_id = p_shift_id
      AND COALESCE(s.is_overnight, false) = true
      AND a.punch_in_time IS NOT NULL
      AND a.punch_out_time IS NULL
      -- Invalid daytime punch-in window for overnight shift
      AND ((a.punch_in_time AT TIME ZONE p_timezone)::time >= s.end_time)
      AND ((a.punch_in_time AT TIME ZONE p_timezone)::time < s.start_time)
      -- Also protect active ongoing shifts; only clean stale opens
      AND (NOW() - a.punch_in_time) >= make_interval(hours => p_max_open_hours)
  ),
  deleted AS (
    DELETE FROM attendance a
    USING target t
    WHERE a.id = t.attendance_id
    RETURNING a.id, a.user_id, a.date, a.punch_in_time
  )
  SELECT
    d.id as attendance_id,
    d.user_id,
    d.date as attendance_date,
    d.punch_in_time,
    'deleted_stale_invalid_open_overnight'::text as action_taken
  FROM deleted d;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cleanup_open_overnight_records(uuid[], uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_cleanup_open_overnight_records(uuid[], uuid, text, integer) TO service_role;

-- Example run for specific Night-shift users (safe to re-run; it only removes stale open invalid rows):
-- SELECT * FROM fn_cleanup_open_overnight_records(
--   ARRAY[
--     '4f94074a-3746-4028-90e5-5ceeebe08932'::uuid,
--     'e563afd3-17c2-4848-a4f5-d4a579243037'::uuid,
--     '25734924-9491-4e90-8340-47a3bfd8cd97'::uuid,
--     '62ea3979-6452-4031-9d8f-a09c864fc41b'::uuid
--   ],
--   'ceb3169f-6f6e-4dc6-89e1-75fb7f7556da'::uuid,
--   'Asia/Kolkata',
--   10
-- );


-- ============================================================
-- Done! Summary:
-- 1. Added is_half_day column to attendance
-- 2. Created trigger fn_attendance_punch_compute:
--    - Auto-computes total_hours, effective_hours on punch
--    - Sets is_late, is_early_out based on shift thresholds  
--    - Sets is_half_day (worked < shift_duration/2)
--    - Sets is_weekend from shift.weekly_off_days
--    - Sets is_holiday from org_holidays table
-- 3. Fixed fn_resolve_attendance_basis:
--    - Uses shift.weekly_off_days for working day calc
--    - Excludes org_holidays from working days
--    - Half days count as 0.5 present days
-- 4. Added fn_populate_absent_records:
--    - Creates absent records for employees who didn't punch
--    - Respects shift weekly offs and org holidays
-- 5. Added fn_cleanup_open_overnight_records:
--    - Removes stale open punch-ins in invalid daytime window for overnight shifts
--    - Useful for users stuck on wrong "Punch Out" state
-- ============================================================
