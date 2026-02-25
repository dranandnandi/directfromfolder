-- Normalize repeated source/status values using shared enum/domain types
-- Date: 2026-02-07

-- 1) Shared enums/domains
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_source_enum') THEN
    CREATE TYPE public.ai_source_enum AS ENUM ('default', 'manual', 'ai', 'compliance');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'manual_ai_source') THEN
    CREATE DOMAIN public.manual_ai_source AS text
      CHECK (VALUE = ANY (ARRAY['manual'::text, 'ai_suggested'::text, 'ai_approved'::text]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_run_status_enum') THEN
    CREATE TYPE public.ai_run_status_enum AS ENUM ('running', 'completed', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_policy_status_enum') THEN
    CREATE TYPE public.ai_policy_status_enum AS ENUM ('draft', 'approved', 'active', 'retired');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_source_priority_enum') THEN
    CREATE TYPE public.ai_source_priority_enum AS ENUM ('compliance', 'manual', 'ai', 'default');
  END IF;
END $$;

-- 2) Convert existing columns to shared types
-- Drop legacy text CHECK constraints first (from previous migration),
-- otherwise enum/domain conversions can fail with enum=text operator errors.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'attendance'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%ai_source%'
  LOOP
    EXECUTE format('ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'attendance_monthly_overrides'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.attendance_monthly_overrides DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'employee_pay_overrides'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.employee_pay_overrides DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'attendance_ai_runs'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.attendance_ai_runs DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'attendance_ai_policies'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.attendance_ai_policies DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'attendance_ai_decisions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%source_priority%'
  LOOP
    EXECUTE format('ALTER TABLE public.attendance_ai_decisions DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

-- Drop dependent partial index built on text status comparison before enum conversion.
DROP INDEX IF EXISTS public.idx_ai_policy_one_active;
DROP VIEW IF EXISTS public.attendance_ai_review_queue_view;

ALTER TABLE public.attendance
  ALTER COLUMN ai_source DROP DEFAULT,
  ALTER COLUMN ai_source TYPE public.ai_source_enum USING ai_source::public.ai_source_enum,
  ALTER COLUMN ai_source SET DEFAULT 'default'::public.ai_source_enum;

ALTER TABLE public.attendance_monthly_overrides
  ALTER COLUMN source DROP DEFAULT,
  ALTER COLUMN source TYPE public.manual_ai_source USING source::text,
  ALTER COLUMN source SET DEFAULT 'manual'::public.manual_ai_source;

ALTER TABLE public.employee_pay_overrides
  ALTER COLUMN source DROP DEFAULT,
  ALTER COLUMN source TYPE public.manual_ai_source USING source::text,
  ALTER COLUMN source SET DEFAULT 'manual'::public.manual_ai_source;

ALTER TABLE public.attendance_ai_runs
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.ai_run_status_enum USING status::public.ai_run_status_enum,
  ALTER COLUMN status SET DEFAULT 'running'::public.ai_run_status_enum;

ALTER TABLE public.attendance_ai_policies
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE public.ai_policy_status_enum USING status::public.ai_policy_status_enum,
  ALTER COLUMN status SET DEFAULT 'draft'::public.ai_policy_status_enum;

ALTER TABLE public.attendance_ai_decisions
  ALTER COLUMN source_priority DROP DEFAULT,
  ALTER COLUMN source_priority TYPE public.ai_source_priority_enum USING source_priority::public.ai_source_priority_enum,
  ALTER COLUMN source_priority SET DEFAULT 'ai'::public.ai_source_priority_enum;

-- 3) Focused index for frequent "get decisions by run" access pattern
CREATE INDEX IF NOT EXISTS idx_ai_decisions_run_only
  ON public.attendance_ai_decisions(run_id);

-- Recreate partial unique index with enum-aware predicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_policy_one_active
  ON public.attendance_ai_policies(organization_id)
  WHERE status = 'active'::public.ai_policy_status_enum;

-- Recreate dependent view after source_priority enum conversion.
CREATE OR REPLACE VIEW public.attendance_ai_review_queue_view AS
SELECT
  d.id,
  d.run_id,
  r.organization_id,
  d.user_id,
  u.name AS user_name,
  u.department AS user_department,
  d.attendance_id,
  a.date AS attendance_date,
  d.decision_type,
  d.decision_payload,
  d.source_priority,
  d.confidence,
  d.human_review_required,
  d.reviewed_by,
  d.reviewed_at,
  d.created_at
FROM public.attendance_ai_decisions d
LEFT JOIN public.attendance_ai_runs r ON r.id = d.run_id
LEFT JOIN public.users u ON u.id = d.user_id
LEFT JOIN public.attendance a ON a.id = d.attendance_id
WHERE d.human_review_required = true
  AND d.reviewed_at IS NULL;

GRANT SELECT ON public.attendance_ai_review_queue_view TO authenticated;
