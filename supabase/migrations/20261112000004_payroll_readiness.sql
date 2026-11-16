-- One source for the UI checklist and database enforcement. No payroll amounts
-- are changed here: unresolved inputs must be resolved before processing.
CREATE FUNCTION public.fn_staff_payroll_readiness(p_org uuid, p_month integer, p_year integer, p_posting boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_start date; v_end date; v_result jsonb;
BEGIN
  IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2000 AND 2100 OR p_month IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'Choose a valid payroll month and year.';
  END IF;
  v_start := make_date(p_year, p_month, 1); v_end := (v_start + interval '1 month - 1 day')::date;
  WITH staff AS (
    SELECT id, name FROM users WHERE organization_id = p_org AND is_active IS DISTINCT FROM false
      AND role IN ('user', 'admin', 'superadmin', 'payroll_admin')
  ), issues AS (
    SELECT 'missing_compensation'::text AS code, 'Missing compensation'::text AS label, '/payroll/compensation'::text AS path,
      u.id AS user_id, u.name, 'No salary structure covers this payroll month.'::text AS detail, true AS blocking
    FROM staff u WHERE NOT EXISTS (SELECT 1 FROM employee_compensation c WHERE c.user_id = u.id AND c.organization_id = p_org
      AND c.effective_from <= v_end AND (c.effective_to IS NULL OR c.effective_to >= v_start) AND c.ctc_annual > 0)
    UNION ALL
    SELECT 'pending_leave', 'Leave awaiting a decision', '/approvals?kind=leave', u.id, u.name,
      t.leave_start_date::text || ' to ' || t.leave_end_date::text, true
    FROM tasks t JOIN staff u ON u.id = t.created_by WHERE t.organization_id = p_org
      AND t.leave_start_date <= v_end AND t.leave_end_date >= v_start AND fn_staff_leave_status(t.status, t.leave_cancelled_at) = 'pending'
    UNION ALL
    SELECT 'pending_corrections', 'Attendance corrections awaiting a decision', '/approvals?kind=correction', u.id, u.name, c.attendance_date::text, true
    FROM attendance_correction_requests c JOIN staff u ON u.id = c.user_id WHERE c.organization_id = p_org
      AND c.status = 'pending' AND c.attendance_date BETWEEN v_start AND v_end
    UNION ALL
    SELECT 'pending_regularizations', 'Attendance exceptions awaiting a decision', '/approvals?kind=regularization', u.id, u.name, a.date::text, true
    FROM attendance_regularizations r JOIN attendance a ON a.id = r.attendance_id JOIN staff u ON u.id = a.user_id
    WHERE a.organization_id = p_org AND r.status = 'pending' AND a.date BETWEEN v_start AND v_end
    UNION ALL
    SELECT 'ai_review', 'AI suggestions awaiting review', '/approvals?kind=ai_review', d.user_id, COALESCE(u.name, 'Organization attendance'),
      replace(d.decision_type, '_', ' '), true
    FROM attendance_ai_decisions d JOIN attendance_ai_runs run ON run.id = d.run_id LEFT JOIN attendance a ON a.id = d.attendance_id
      LEFT JOIN staff u ON u.id = d.user_id WHERE run.organization_id = p_org AND d.human_review_required AND d.reviewed_at IS NULL
      AND (a.date BETWEEN v_start AND v_end OR (a.date IS NULL AND run.period_start <= v_end AND run.period_end >= v_start))
    UNION ALL
    SELECT 'open_punches', 'Punch-outs still missing', '/attendance', u.id, u.name, a.date::text, true
    FROM attendance a JOIN staff u ON u.id = a.user_id WHERE a.organization_id = p_org AND a.date BETWEEN v_start AND v_end
      AND a.punch_in_time IS NOT NULL AND a.punch_out_time IS NULL
    UNION ALL
    SELECT 'pending_overrides', 'Attendance imports or overrides awaiting approval', '/payroll/import/overrides', u.id, u.name, 'Monthly attendance override is not approved.', true
    FROM attendance_monthly_overrides o JOIN staff u ON u.id = o.user_id WHERE o.organization_id = p_org AND o.month = p_month AND o.year = p_year AND o.approved_at IS NULL
    UNION ALL
    SELECT 'negative_net', 'Negative salary results', '/payroll/period-board', u.id, u.name, 'Review earnings and deductions before posting.', true
    FROM payroll_runs r JOIN payroll_periods p ON p.id = r.payroll_period_id JOIN staff u ON u.id = r.user_id
    WHERE p.organization_id = p_org AND p.month = p_month AND p.year = p_year AND r.net_pay < 0
    UNION ALL
    SELECT 'missing_runs', 'Employees still awaiting payroll', '/payroll/period-board', u.id, u.name, 'Process this employee before posting the month.', true
    FROM staff u WHERE p_posting AND NOT EXISTS (SELECT 1 FROM payroll_runs r JOIN payroll_periods p ON p.id = r.payroll_period_id
      WHERE r.user_id = u.id AND p.organization_id = p_org AND p.month = p_month AND p.year = p_year AND r.net_pay >= 0)
    UNION ALL
    SELECT 'no_attendance', 'No attendance recorded', '/attendance', u.id, u.name, 'Confirm absence or import attendance; no recorded work was found for this month.', false
    FROM staff u WHERE v_start <= (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.user_id = u.id AND a.organization_id = p_org AND a.date BETWEEN v_start AND v_end AND a.punch_in_time IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM attendance_monthly_overrides o WHERE o.user_id = u.id AND o.organization_id = p_org AND o.month = p_month AND o.year = p_year AND o.approved_at IS NOT NULL)
    UNION ALL
    SELECT 'future_period', 'Payroll month has not started', '/payroll', NULL::uuid, 'Payroll period', 'Choose a current or past payroll month.', true
      WHERE v_start > (now() AT TIME ZONE 'Asia/Kolkata')::date
    UNION ALL
    SELECT 'empty_staff', 'No active staff', '/team', NULL::uuid, 'Organization', 'Add active staff before processing payroll.', true WHERE NOT EXISTS (SELECT 1 FROM staff)
  ), grouped AS (
    SELECT code, label, path, blocking, count(*) AS count FROM issues GROUP BY code, label, path, blocking
  )
  SELECT jsonb_build_object('ready', NOT EXISTS(SELECT 1 FROM issues WHERE blocking), 'employee_count', (SELECT count(*) FROM staff),
    'period_start', v_start, 'period_end', v_end, 'checked_at', now(),
    'groups', COALESCE((SELECT jsonb_agg(to_jsonb(g) || jsonb_build_object('examples', (SELECT jsonb_agg(to_jsonb(sample)) FROM (
        SELECT user_id, name, detail FROM issues i WHERE i.code = g.code ORDER BY name, detail LIMIT 10) sample)) ORDER BY g.blocking DESC, g.label) FROM grouped g), '[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_staff_payroll_readiness(uuid, integer, integer, boolean) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_get_payroll_readiness(p_organization_id uuid, p_month integer, p_year integer, p_posting boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND organization_id = p_organization_id
      AND is_active IS DISTINCT FROM false AND role IN ('admin', 'superadmin', 'payroll_admin')) THEN
    RAISE EXCEPTION 'Only payroll admins in this organization can check payroll readiness.' USING ERRCODE = '42501';
  END IF;
  RETURN fn_staff_payroll_readiness(p_organization_id, p_month, p_year, p_posting);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_get_payroll_readiness(uuid, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_payroll_readiness(uuid, integer, integer, boolean) TO authenticated;

CREATE FUNCTION public.fn_guard_payroll_readiness()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_check jsonb; v_period payroll_periods%ROWTYPE; v_message text;
BEGIN
  IF TG_TABLE_NAME = 'payroll_periods' THEN
    IF NEW.status NOT IN ('locked', 'posted', 'challan_generated') THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    v_period := NEW;
  ELSE
    SELECT * INTO v_period FROM payroll_periods WHERE id = NEW.payroll_period_id FOR UPDATE;
    IF v_period.id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND organization_id = v_period.organization_id AND is_active IS DISTINCT FROM false) THEN
      RAISE EXCEPTION 'Payroll must belong to an active employee in this organization.';
    END IF;
    IF v_period.status <> 'locked' THEN RAISE EXCEPTION 'Lock a ready payroll period before processing salary.'; END IF;
    IF NEW.net_pay < 0 THEN RAISE EXCEPTION 'Net salary is negative. Review earnings and deductions first.'; END IF;
  END IF;
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') AND NOT EXISTS (
    SELECT 1 FROM users WHERE auth_id = auth.uid() AND organization_id = v_period.organization_id AND is_active IS DISTINCT FROM false
      AND role IN ('admin', 'superadmin', 'payroll_admin')) THEN
    RAISE EXCEPTION 'Only this organization payroll admins can process payroll.' USING ERRCODE = '42501';
  END IF;
  v_check := fn_staff_payroll_readiness(v_period.organization_id, v_period.month::int, v_period.year::int,
    TG_TABLE_NAME = 'payroll_periods' AND v_period.status IN ('posted', 'challan_generated'));
  IF NOT (v_check->>'ready')::boolean THEN
    SELECT string_agg(value->>'label' || ' (' || (value->>'count') || ')', ', ') INTO v_message
      FROM jsonb_array_elements(v_check->'groups') WHERE (value->>'blocking')::boolean;
    RAISE EXCEPTION 'Payroll is not ready: %. Resolve these items and retry.', v_message;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_payroll_period_readiness BEFORE INSERT OR UPDATE OF status ON public.payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_payroll_readiness();
CREATE TRIGGER guard_payroll_run_readiness BEFORE INSERT OR UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_payroll_readiness();
REVOKE ALL ON FUNCTION public.fn_guard_payroll_readiness() FROM PUBLIC, anon, authenticated;
