-- Fix: punching in/out with no shift assigned failed with
--   record "v_shift" is not assigned yet
-- fn_attendance_punch_compute() only ran SELECT ... INTO v_shift when
-- NEW.shift_id was set, then evaluated
--   IF v_shift_found AND v_shift.weekly_off_days IS NOT NULL
-- PL/pgSQL resolves v_shift.weekly_off_days before the AND is evaluated, so an
-- unassigned record raised. This version always assigns v_shift (a NULL row when
-- no shift matches) and only dereferences it inside IF v_shift_found blocks.
-- Behaviour without a shift is unchanged: 1h default break, 8h-day half-day
-- threshold, Sunday as the weekly off.

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
  -- Always assign v_shift so it is never an unassigned record.
  -- With shift_id NULL this selects no row and leaves v_shift as all-NULL columns.
  SELECT * INTO v_shift FROM shifts WHERE id = NEW.shift_id;
  v_shift_found := FOUND;

  IF NEW.punch_in_time IS NOT NULL AND NEW.punch_out_time IS NOT NULL THEN
    v_total_hours := EXTRACT(EPOCH FROM (NEW.punch_out_time::timestamptz - NEW.punch_in_time::timestamptz)) / 3600.0;

    IF v_shift_found THEN
      v_effective_hours := v_total_hours - COALESCE(v_shift.break_duration_minutes, 0) / 60.0;
    ELSE
      v_effective_hours := v_total_hours - 1.0; -- default 1hr break
    END IF;
    v_effective_hours := GREATEST(v_effective_hours, 0);

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
