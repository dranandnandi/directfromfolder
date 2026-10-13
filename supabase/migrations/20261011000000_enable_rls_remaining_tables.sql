/*
  Enable RLS on the 10 public tables that are still open, close the anon
  holes, and fix policies that were written against the wrong column.

  Reconciled against the live pg_tables / pg_policies dump on 2026-10-11.
  NOT yet applied. Apply with `supabase db push` or paste into the SQL editor.

  Access model (unchanged, matches the client code):
    - auth.uid()  ->  users.auth_id           (one users row per auth user)
    - users.organization_id                   (one organization per user)
    - users.role in ('user','admin','superadmin')
    - Edge functions use the service-role key and bypass RLS entirely.
    - Client reads/writes go through the anon key + user JWT, so they are
      the only callers these policies have to keep working.

  Helpers already live in the DB (20250625060135_floral_shore.sql):
    get_current_user_id()            -> users.id of the caller
    get_current_user_org_id_safe()   -> organization_id of the caller
    is_current_user_admin_safe()     -> role in ('admin','superadmin')
    is_current_user_superadmin_safe()

  Live state this migration changes:
    RLS OFF today ........ attendance_ai_decisions, attendance_ai_policies,
                           attendance_ai_runs, compliance_rules,
                           employee_compensation, org_statutory_profiles,
                           pay_components, payroll_periods, payroll_runs,
                           statutory_filings
    RLS ON, no policies .. attendance_import_batches, attendance_import_rows,
                           attendance_monthly_overrides, employee_pay_overrides
                           (client queries on these silently return nothing today)
    Wrong/open policies .. notifications ("Allow anon read" TO anon USING true),
                           org_holidays (users.id = auth.uid()),
                           device_tokens (auth.uid() = user_id, roles public),
                           payroll_runs (auth.uid() = user_id),
                           users_admin_create_v5 (lets a user with no users row
                           insert themselves into any org with any role)
    Views ................ run as owner, so they bypass RLS and are readable by anon
*/

-- ---------------------------------------------------------------------------
-- 0. Helper hardening
-- ---------------------------------------------------------------------------

-- STABLE lets the planner evaluate the helper once per statement instead of
-- once per row; pinned search_path is standard SECURITY DEFINER hygiene.
ALTER FUNCTION public.get_current_user_id()             STABLE SET search_path = public;
ALTER FUNCTION public.get_current_user_org_id_safe()    STABLE SET search_path = public;
ALTER FUNCTION public.is_current_user_admin_safe()      STABLE SET search_path = public;
ALTER FUNCTION public.is_current_user_superadmin_safe() STABLE SET search_path = public;
ALTER FUNCTION public.get_user_org_id()                 STABLE SET search_path = public;

-- "Does this users.id belong to the caller's organization?"
CREATE OR REPLACE FUNCTION public.fn_user_in_my_org(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_user
      AND u.organization_id = public.get_current_user_org_id_safe()
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_user_in_my_org(uuid) TO authenticated;

-- "Is the caller an admin of the org that owns this users.id?"
CREATE OR REPLACE FUNCTION public.fn_admin_of_user(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_current_user_admin_safe() AND public.fn_user_in_my_org(p_user);
$$;
GRANT EXECUTE ON FUNCTION public.fn_admin_of_user(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. PAYROLL  (RLS OFF today; rows readable with the anon key)
-- ---------------------------------------------------------------------------

-- employee_compensation: own row readable, admins manage.
ALTER TABLE public.employee_compensation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view compensation data for their organization"   ON public.employee_compensation;
DROP POLICY IF EXISTS "Users can insert compensation data for their organization" ON public.employee_compensation;
DROP POLICY IF EXISTS "Users can update compensation data for their organization" ON public.employee_compensation;
DROP POLICY IF EXISTS "Users can delete compensation data for their organization" ON public.employee_compensation;
DROP POLICY IF EXISTS employee_compensation_select ON public.employee_compensation;
DROP POLICY IF EXISTS employee_compensation_admin  ON public.employee_compensation;
CREATE POLICY employee_compensation_select ON public.employee_compensation
  FOR SELECT TO authenticated
  USING (user_id = public.get_current_user_id() OR public.fn_admin_of_user(user_id));
CREATE POLICY employee_compensation_admin ON public.employee_compensation
  FOR ALL TO authenticated
  USING (public.fn_admin_of_user(user_id))
  WITH CHECK (public.fn_admin_of_user(user_id)
              AND (organization_id IS NULL OR organization_id = public.get_current_user_org_id_safe()));

-- payroll_periods: org scoped. Members read, admins manage.
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_periods_select ON public.payroll_periods;
DROP POLICY IF EXISTS payroll_periods_admin  ON public.payroll_periods;
CREATE POLICY payroll_periods_select ON public.payroll_periods
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_user_org_id_safe());
CREATE POLICY payroll_periods_admin ON public.payroll_periods
  FOR ALL TO authenticated
  USING (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe())
  WITH CHECK (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe());

-- payroll_runs: keyed by user_id. Own run readable, admins manage.
-- Live policy pr_employee_read_self compares auth.uid() to users.id (always false).
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pr_employee_read_self ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_select   ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_admin    ON public.payroll_runs;
CREATE POLICY payroll_runs_select ON public.payroll_runs
  FOR SELECT TO authenticated
  USING (user_id = public.get_current_user_id() OR public.fn_admin_of_user(user_id));
CREATE POLICY payroll_runs_admin ON public.payroll_runs
  FOR ALL TO authenticated
  USING (public.fn_admin_of_user(user_id))
  WITH CHECK (public.fn_admin_of_user(user_id));

-- org_statutory_profiles: PF/ESIC/TAN/PAN/bank details. Admin only.
ALTER TABLE public.org_statutory_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_statutory_profiles_admin ON public.org_statutory_profiles;
CREATE POLICY org_statutory_profiles_admin ON public.org_statutory_profiles
  FOR ALL TO authenticated
  USING (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe())
  WITH CHECK (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe());

-- statutory_filings: scoped through payroll_periods.organization_id. Admin only.
ALTER TABLE public.statutory_filings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS statutory_filings_admin ON public.statutory_filings;
CREATE POLICY statutory_filings_admin ON public.statutory_filings
  FOR ALL TO authenticated
  USING (
    public.is_current_user_admin_safe()
    AND EXISTS (SELECT 1 FROM public.payroll_periods p
                WHERE p.id = statutory_filings.payroll_period_id
                  AND p.organization_id = public.get_current_user_org_id_safe())
  )
  WITH CHECK (
    public.is_current_user_admin_safe()
    AND EXISTS (SELECT 1 FROM public.payroll_periods p
                WHERE p.id = statutory_filings.payroll_period_id
                  AND p.organization_id = public.get_current_user_org_id_safe())
  );

-- pay_components: GLOBAL reference table (no organization_id). Everyone can
-- read; admins can edit. NOTE: an admin of any org edits the shared list.
ALTER TABLE public.pay_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pay_components_select ON public.pay_components;
DROP POLICY IF EXISTS pay_components_admin  ON public.pay_components;
CREATE POLICY pay_components_select ON public.pay_components
  FOR SELECT TO authenticated USING (true);
CREATE POLICY pay_components_admin ON public.pay_components
  FOR ALL TO authenticated
  USING (public.is_current_user_admin_safe())
  WITH CHECK (public.is_current_user_admin_safe());

-- compliance_rules: GLOBAL reference table. Read only from the client.
ALTER TABLE public.compliance_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compliance_rules_select ON public.compliance_rules;
CREATE POLICY compliance_rules_select ON public.compliance_rules
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 2. ATTENDANCE AI  (RLS OFF today)
-- ---------------------------------------------------------------------------

ALTER TABLE public.attendance_ai_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_ai_policies_select ON public.attendance_ai_policies;
DROP POLICY IF EXISTS attendance_ai_policies_admin  ON public.attendance_ai_policies;
CREATE POLICY attendance_ai_policies_select ON public.attendance_ai_policies
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_user_org_id_safe());
CREATE POLICY attendance_ai_policies_admin ON public.attendance_ai_policies
  FOR ALL TO authenticated
  USING (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe())
  WITH CHECK (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe());

ALTER TABLE public.attendance_ai_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_ai_runs_select ON public.attendance_ai_runs;
DROP POLICY IF EXISTS attendance_ai_runs_admin  ON public.attendance_ai_runs;
CREATE POLICY attendance_ai_runs_select ON public.attendance_ai_runs
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_user_org_id_safe());
CREATE POLICY attendance_ai_runs_admin ON public.attendance_ai_runs
  FOR ALL TO authenticated
  USING (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe())
  WITH CHECK (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe());

-- attendance_ai_decisions: keyed by user_id. Own row readable, admins review.
ALTER TABLE public.attendance_ai_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_ai_decisions_select ON public.attendance_ai_decisions;
DROP POLICY IF EXISTS attendance_ai_decisions_admin  ON public.attendance_ai_decisions;
CREATE POLICY attendance_ai_decisions_select ON public.attendance_ai_decisions
  FOR SELECT TO authenticated
  USING (user_id = public.get_current_user_id() OR public.fn_admin_of_user(user_id));
CREATE POLICY attendance_ai_decisions_admin ON public.attendance_ai_decisions
  FOR ALL TO authenticated
  USING (public.fn_admin_of_user(user_id))
  WITH CHECK (public.fn_admin_of_user(user_id));

-- ---------------------------------------------------------------------------
-- 3. RLS ON BUT NO POLICIES  (client queries return nothing today; these
--    give admins back the import wizard and pay overrides)
-- ---------------------------------------------------------------------------

ALTER TABLE public.attendance_import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_import_batches_admin ON public.attendance_import_batches;
CREATE POLICY attendance_import_batches_admin ON public.attendance_import_batches
  FOR ALL TO authenticated
  USING (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe())
  WITH CHECK (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe());

-- attendance_import_rows: user_id is nullable, so scope through the batch.
ALTER TABLE public.attendance_import_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_import_rows_admin ON public.attendance_import_rows;
CREATE POLICY attendance_import_rows_admin ON public.attendance_import_rows
  FOR ALL TO authenticated
  USING (
    public.is_current_user_admin_safe()
    AND EXISTS (SELECT 1 FROM public.attendance_import_batches b
                WHERE b.id = attendance_import_rows.batch_id
                  AND b.organization_id = public.get_current_user_org_id_safe())
  )
  WITH CHECK (
    public.is_current_user_admin_safe()
    AND EXISTS (SELECT 1 FROM public.attendance_import_batches b
                WHERE b.id = attendance_import_rows.batch_id
                  AND b.organization_id = public.get_current_user_org_id_safe())
  );

ALTER TABLE public.attendance_monthly_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_monthly_overrides_select ON public.attendance_monthly_overrides;
DROP POLICY IF EXISTS attendance_monthly_overrides_admin  ON public.attendance_monthly_overrides;
CREATE POLICY attendance_monthly_overrides_select ON public.attendance_monthly_overrides
  FOR SELECT TO authenticated
  USING (user_id = public.get_current_user_id()
         OR (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe()));
CREATE POLICY attendance_monthly_overrides_admin ON public.attendance_monthly_overrides
  FOR ALL TO authenticated
  USING (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe())
  WITH CHECK (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe());

ALTER TABLE public.employee_pay_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_pay_overrides_admin ON public.employee_pay_overrides;
CREATE POLICY employee_pay_overrides_admin ON public.employee_pay_overrides
  FOR ALL TO authenticated
  USING (public.fn_admin_of_user(user_id))
  WITH CHECK (public.fn_admin_of_user(user_id));

-- ---------------------------------------------------------------------------
-- 4. NOTIFICATIONS: drop the anon policy (358 rows public today) and let
--    users notify OTHER org members (leave request -> admin, decision ->
--    employee). The live insert policy only allows user_id = self, so those
--    inserts fail silently today.
-- ---------------------------------------------------------------------------

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read"               ON public.notifications;
DROP POLICY IF EXISTS notifications_select_policy_v4  ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_policy_v4  ON public.notifications;
DROP POLICY IF EXISTS notifications_update_policy_v4  ON public.notifications;
DROP POLICY IF EXISTS notifications_select ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
DROP POLICY IF EXISTS notifications_update ON public.notifications;
DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = public.get_current_user_id() OR public.fn_admin_of_user(user_id));
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_user_in_my_org(user_id));
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = public.get_current_user_id() OR public.fn_admin_of_user(user_id))
  WITH CHECK (user_id = public.get_current_user_id() OR public.fn_admin_of_user(user_id));
CREATE POLICY notifications_delete ON public.notifications
  FOR DELETE TO authenticated
  USING (public.fn_admin_of_user(user_id));

-- device_tokens: keep the correct v4 policy, drop the four "public" ones that
-- compare auth.uid() to users.id.
DROP POLICY IF EXISTS "Users can view own device tokens"   ON public.device_tokens;
DROP POLICY IF EXISTS "Users can insert own device tokens" ON public.device_tokens;
DROP POLICY IF EXISTS "Users can update own device tokens" ON public.device_tokens;
DROP POLICY IF EXISTS "Users can delete own device tokens" ON public.device_tokens;

-- ---------------------------------------------------------------------------
-- 5. org_holidays: live policy compares users.id = auth.uid() (always false),
--    so holiday reads return nothing today.
-- ---------------------------------------------------------------------------

ALTER TABLE public.org_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_holidays_org_access ON public.org_holidays;
DROP POLICY IF EXISTS org_holidays_select ON public.org_holidays;
DROP POLICY IF EXISTS org_holidays_admin  ON public.org_holidays;
CREATE POLICY org_holidays_select ON public.org_holidays
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_user_org_id_safe());
CREATE POLICY org_holidays_admin ON public.org_holidays
  FOR ALL TO authenticated
  USING (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe())
  WITH CHECK (public.is_current_user_admin_safe() AND organization_id = public.get_current_user_org_id_safe());

-- ---------------------------------------------------------------------------
-- 6. conversation_analysis: client updates analysis rows
--    (src/utils/conversationUtils.ts) but only SELECT policies exist.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS conversation_analysis_update ON public.conversation_analysis;
CREATE POLICY conversation_analysis_update ON public.conversation_analysis
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversation_logs cl
                 WHERE cl.id = conversation_analysis.conversation_log_id
                   AND (cl.employee_id = public.get_current_user_id()
                        OR public.fn_admin_of_user(cl.employee_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversation_logs cl
                      WHERE cl.id = conversation_analysis.conversation_log_id
                        AND (cl.employee_id = public.get_current_user_id()
                             OR public.fn_admin_of_user(cl.employee_id))));

-- ---------------------------------------------------------------------------
-- 7. users: close the self-provisioning branch. users_admin_create_v5 lets
--    any authenticated account that has no users row insert one into ANY
--    organization with ANY role. All real accounts are created by the
--    create-user edge function (service role), so the branch is not needed.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS users_admin_create_v5 ON public.users;
DROP POLICY IF EXISTS users_admin_create_v6 ON public.users;
CREATE POLICY users_admin_create_v6 ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_current_user_superadmin_safe()
    OR (public.is_current_user_admin_safe()
        AND organization_id = public.get_current_user_org_id_safe())
  );

-- ---------------------------------------------------------------------------
-- 8. VIEWS: a view runs with its owner's rights by default and therefore
--    bypasses RLS on the tables underneath. attendance_dashboard_view alone
--    hands 3,918 attendance rows to the anon key. security_invoker makes
--    each view obey the caller's RLS; revoking anon closes the public hole.
-- ---------------------------------------------------------------------------

ALTER VIEW public.attendance_dashboard_view        SET (security_invoker = on);
ALTER VIEW public.attendance_ai_review_queue_view  SET (security_invoker = on);
ALTER VIEW public.conversation_insights            SET (security_invoker = on);
ALTER VIEW public.performance_analytics            SET (security_invoker = on);
ALTER VIEW public.performance_metrics_view         SET (security_invoker = on);
ALTER VIEW public.active_device_tokens             SET (security_invoker = on);
ALTER VIEW public.v_attendance_monthly             SET (security_invoker = on);

REVOKE ALL ON public.attendance_dashboard_view       FROM anon;
REVOKE ALL ON public.attendance_ai_review_queue_view FROM anon;
REVOKE ALL ON public.conversation_insights           FROM anon;
REVOKE ALL ON public.performance_analytics           FROM anon;
REVOKE ALL ON public.performance_metrics_view        FROM anon;
REVOKE ALL ON public.active_device_tokens            FROM anon;
REVOKE ALL ON public.v_attendance_monthly            FROM anon;

-- auth_users_view: a view over auth.users (560 rows readable by anon today).
-- Nothing in the client or edge functions references it, so no app role
-- needs it at all. Service role still can read it.
ALTER VIEW public.auth_users_view SET (security_invoker = on);
REVOKE ALL ON public.auth_users_view FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. OPTIONAL HARDENING (run separately once 1-8 are verified in the app):
--    nothing in the client, the edge functions or the WhatsApp server talks
--    to PostgREST without a login, so the anon role needs no table access.
-- ---------------------------------------------------------------------------
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
