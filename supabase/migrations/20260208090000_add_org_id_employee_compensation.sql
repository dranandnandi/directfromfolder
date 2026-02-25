-- Add organization_id to employee_compensation for easier filtering
ALTER TABLE public.employee_compensation
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Backfill organization_id from users table
UPDATE public.employee_compensation ec
SET organization_id = u.organization_id
FROM public.users u
WHERE ec.user_id = u.id
  AND ec.organization_id IS NULL;

-- Helpful indexes for org + effective period filtering
CREATE INDEX IF NOT EXISTS employee_compensation_org_user_idx
  ON public.employee_compensation (organization_id, user_id);

CREATE INDEX IF NOT EXISTS employee_compensation_org_effective_idx
  ON public.employee_compensation (organization_id, effective_from, effective_to);
