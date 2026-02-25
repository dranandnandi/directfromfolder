-- ============================================================
-- Migration: Add weekly_off_days to shifts table
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add weekly_off_days column (array of day names)
ALTER TABLE shifts 
ADD COLUMN IF NOT EXISTS weekly_off_days text[] DEFAULT '{"sunday"}'::text[];

-- 2. Remove restrictive duration_hours CHECK (allow 4-12 hour shifts)
-- First find and drop the existing constraint
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'shifts'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%duration_hours%';
  
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE shifts DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Add a more flexible check (4-12 hours)
ALTER TABLE shifts ADD CONSTRAINT shifts_duration_hours_check 
  CHECK (duration_hours >= 4 AND duration_hours <= 12);

-- 3. Create org_holidays table (centralized holiday calendar)
CREATE TABLE IF NOT EXISTS org_holidays (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  date date NOT NULL,
  is_optional boolean DEFAULT false,
  applies_to_shifts uuid[] DEFAULT NULL, -- null = all shifts
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, date)
);

ALTER TABLE org_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_holidays_org_access" ON org_holidays
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

GRANT ALL ON org_holidays TO authenticated;
GRANT ALL ON org_holidays TO service_role;

-- 4. Backfill existing shifts with default weekly_off_days = ['sunday']
UPDATE shifts SET weekly_off_days = '{"sunday"}'::text[] WHERE weekly_off_days IS NULL;

COMMENT ON COLUMN shifts.weekly_off_days IS 'Array of days off for this shift, e.g. {"sunday"} or {"friday","saturday"}. Used for attendance proration and payroll.';
