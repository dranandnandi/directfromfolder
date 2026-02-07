-- Fix early leave logic and unify flags
-- 1. Ensure is_early_leave column exists
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS is_early_leave BOOLEAN DEFAULT false;

-- 2. Define check_early_leave function with corrected logic
CREATE OR REPLACE FUNCTION public.check_early_leave()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  shift_end TIME;
  shift_threshold INT;
  is_overnight_shift BOOLEAN;
  punch_out_time_only TIME;
  punch_in_date DATE;
  punch_out_date DATE;
BEGIN
  IF NEW.punch_out_time IS NOT NULL AND NEW.shift_id IS NOT NULL THEN
    SELECT
      s.end_time,
      COALESCE(s.early_out_threshold_minutes, 15),
      COALESCE(s.is_overnight, false)
    INTO shift_end, shift_threshold, is_overnight_shift
    FROM shifts s
    WHERE s.id = NEW.shift_id;

    punch_out_time_only := NEW.punch_out_time::time;

    IF is_overnight_shift THEN
      punch_in_date := NEW.punch_in_time::date;
      punch_out_date := NEW.punch_out_time::date;

      IF punch_out_date = punch_in_date + INTERVAL '1 day' THEN
        NEW.is_early_leave := (
          punch_out_time_only < (shift_end - (shift_threshold || ' minutes')::interval)
        );
      ELSE
        -- Do not auto-flag early if same-day or more than 1 day difference
        NEW.is_early_leave := false;
      END IF;
    ELSE
      NEW.is_early_leave := (
        punch_out_time_only < (shift_end - (shift_threshold || ' minutes')::interval)
      );
    END IF;

    -- Sync is_early_out for compatibility with frontend/existing logic
    NEW.is_early_out := NEW.is_early_leave;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Create or update the trigger
DROP TRIGGER IF EXISTS check_early_leave_trigger ON public.attendance;
CREATE TRIGGER check_early_leave_trigger
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.check_early_leave();

-- 4. Update calculate_attendance_hours to remove conflicting early_out logic
CREATE OR REPLACE FUNCTION calculate_attendance_hours()
RETURNS TRIGGER AS $$
BEGIN
  -- Only calculate if both punch in and punch out are present
  IF NEW.punch_in_time IS NOT NULL AND NEW.punch_out_time IS NOT NULL THEN
    -- Calculate total hours
    NEW.total_hours = EXTRACT(EPOCH FROM (NEW.punch_out_time - NEW.punch_in_time)) / 3600;
    
    -- Calculate effective hours (total - break)
    NEW.effective_hours = NEW.total_hours - COALESCE(NEW.break_hours, 1.0);
    
    -- Note: Early out logic is now handled by check_early_leave() trigger
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
