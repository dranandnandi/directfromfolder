-- AI-native attendance foundation
-- Date: 2026-02-07

CREATE TABLE IF NOT EXISTS public.attendance_ai_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_name text NOT NULL,
  policy_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft'::text, 'approved'::text, 'active'::text, 'retired'::text])),
  instruction_text text NOT NULL,
  instruction_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_name text NOT NULL DEFAULT 'gemini-2.5-flash'::text,
  confidence_score numeric,
  created_by uuid REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_policy_unique_ver
  ON public.attendance_ai_policies(organization_id, policy_name, policy_version);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_policy_one_active
  ON public.attendance_ai_policies(organization_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ai_policy_org_status
  ON public.attendance_ai_policies(organization_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.attendance_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.attendance_ai_policies(id) ON DELETE SET NULL,
  run_type text NOT NULL
    CHECK (run_type = ANY (ARRAY['weekly_hydration'::text, 'shift_compile'::text, 'payroll_preview'::text])),
  period_start date,
  period_end date,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running'
    CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_org_period
  ON public.attendance_ai_runs(organization_id, period_start, period_end, started_at DESC);

CREATE TABLE IF NOT EXISTS public.attendance_ai_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.attendance_ai_runs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  attendance_id uuid REFERENCES public.attendance(id) ON DELETE SET NULL,
  decision_type text NOT NULL
    CHECK (decision_type = ANY (ARRAY['late_flag'::text, 'holiday_flag'::text, 'override_apply'::text, 'ot_calc'::text, 'attendance_status'::text])),
  decision_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_priority text NOT NULL DEFAULT 'ai'
    CHECK (source_priority = ANY (ARRAY['compliance'::text, 'manual'::text, 'ai'::text, 'default'::text])),
  confidence numeric,
  human_review_required boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_review
  ON public.attendance_ai_decisions(human_review_required, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_run
  ON public.attendance_ai_decisions(run_id, user_id, attendance_id);

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS ai_hydration_meta jsonb,
  ADD COLUMN IF NOT EXISTS ai_hydrated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_source text NOT NULL DEFAULT 'default'
    CHECK (ai_source = ANY (ARRAY['default'::text, 'manual'::text, 'ai'::text, 'compliance'::text]));

ALTER TABLE public.attendance_monthly_overrides
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source = ANY (ARRAY['manual'::text, 'ai_suggested'::text, 'ai_approved'::text]));

ALTER TABLE public.employee_pay_overrides
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source = ANY (ARRAY['manual'::text, 'ai_suggested'::text, 'ai_approved'::text)),
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS explainability jsonb;

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

GRANT SELECT, INSERT, UPDATE ON public.attendance_ai_policies TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance_ai_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance_ai_decisions TO authenticated;
GRANT SELECT ON public.attendance_ai_review_queue_view TO authenticated;

