-- ============================================================
-- fn_finalize_run — statutory deductions are OPT-IN per head.
--
-- Previous behaviour: fn_apply_compliance computed PF / ESIC / PT
-- from Basic and gross, and fn_finalize_run added them to every
-- payslip even when the compensation carried no deduction component
-- at all. A BASIC-only compensation of 30,000 produced PF 1,800 and
-- PT 200 out of nowhere.
--
-- New behaviour: a statutory head applies only when the employee
-- compensation payload explicitly contains its component code.
--   * code absent             -> head is 0, nothing on the payslip
--   * code present, amount 0  -> system computes the statutory amount
--   * code present, amount >0 -> the entered amount is used as-is
-- PF Employer follows the PF opt-in, ESIC Employer follows ESIC.
--
-- Each head is gated independently: opting into PT does not switch
-- on PF or ESIC.
--
-- Run this in: Supabase Dashboard > SQL Editor
-- Date: 2026-09-15
-- ============================================================

DROP FUNCTION IF EXISTS fn_finalize_run(uuid, uuid, text);

CREATE OR REPLACE FUNCTION fn_finalize_run(
  p_period uuid,
  p_user uuid,
  p_state text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_month integer;
  v_year integer;
  v_period_status text;
  v_components jsonb;
  v_raw_components jsonb;
  v_compliance jsonb := '{}'::jsonb;
  v_attendance_basis jsonb;

  v_snapshot jsonb;
  v_component jsonb;
  v_code text;
  v_amount numeric;

  v_gross_earnings numeric := 0;
  v_total_deductions numeric := 0;
  v_explicit_employer numeric := 0;
  v_net_pay numeric;
  v_employer_cost numeric;

  -- Compliance-computed amounts actually applied
  v_pf_employee numeric := 0;
  v_esic_employee numeric := 0;
  v_pt_amount numeric := 0;
  v_tds_amount numeric := 0;
  v_pf_employer numeric := 0;
  v_esic_employer numeric := 0;

  -- Opt-in: code present in the saved compensation payload
  v_opt_pf boolean := false;
  v_opt_esic boolean := false;
  v_opt_pt boolean := false;
  v_opt_tds boolean := false;

  -- Explicit: code present in the evaluated components with an amount
  v_explicit_pf boolean := false;
  v_explicit_esic boolean := false;
  v_explicit_pt boolean := false;
  v_explicit_tds boolean := false;
  v_explicit_pf_er boolean := false;
  v_explicit_esic_er boolean := false;

  v_run_id uuid;
  v_existing_run uuid;
BEGIN
  SELECT month, year, status
  INTO v_month, v_year, v_period_status
  FROM payroll_periods
  WHERE id = p_period;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll period % not found', p_period;
  END IF;

  IF v_period_status != 'locked' THEN
    RAISE EXCEPTION 'Payroll period must be locked to finalize runs';
  END IF;

  SELECT id INTO v_existing_run
  FROM payroll_runs
  WHERE payroll_period_id = p_period AND user_id = p_user;

  IF v_existing_run IS NOT NULL THEN
    DELETE FROM payroll_runs WHERE id = v_existing_run;
  END IF;

  v_components := fn_eval_components(p_user, v_month, v_year);

  -- ----------------------------------------------------------
  -- Opt-in is read from the SAVED payload rather than the
  -- evaluated components, so that a head added with a zero amount
  -- still counts as "compute this for me".
  -- ----------------------------------------------------------
  SELECT components INTO v_raw_components
  FROM fn_get_active_compensation(p_user, v_month, v_year);

  IF v_raw_components IS NOT NULL AND jsonb_typeof(v_raw_components) = 'array' THEN
    FOR v_component IN SELECT * FROM jsonb_array_elements(v_raw_components)
    LOOP
      v_code := UPPER(btrim(COALESCE(v_component->>'component_code', v_component->>'code', '')));

      IF v_code IN ('PF', 'PF_EE', 'PF_EMPLOYEE', 'PF_ER', 'PF_EMPLOYER') THEN
        v_opt_pf := true;
      ELSIF v_code IN ('ESI', 'ESIC', 'ESIC_EE', 'ESIC_EMPLOYEE', 'ESI_ER', 'ESIC_ER', 'ESI_EMPLOYER', 'ESIC_EMPLOYER') THEN
        v_opt_esic := true;
      ELSIF v_code = 'PT' THEN
        v_opt_pt := true;
      ELSIF v_code = 'TDS' THEN
        v_opt_tds := true;
      END IF;
    END LOOP;
  END IF;

  -- ----------------------------------------------------------
  -- Totals from the evaluated components, noting which statutory
  -- heads already carry an explicit amount — those must not be
  -- recomputed or they would be charged twice.
  -- ----------------------------------------------------------
  FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
  LOOP
    v_code := UPPER(COALESCE(v_component->>'code', ''));
    v_amount := ABS(COALESCE((v_component->>'amount')::numeric, 0));

    IF (v_component->>'type') = 'earning' THEN
      v_gross_earnings := v_gross_earnings + COALESCE((v_component->>'amount')::numeric, 0);

    ELSIF (v_component->>'type') = 'deduction' THEN
      v_total_deductions := v_total_deductions + v_amount;

      IF v_amount > 0 THEN
        IF v_code IN ('PF', 'PF_EE', 'PF_EMPLOYEE') THEN
          v_explicit_pf := true;
        ELSIF v_code IN ('ESI', 'ESIC', 'ESIC_EE', 'ESIC_EMPLOYEE') THEN
          v_explicit_esic := true;
        ELSIF v_code = 'PT' THEN
          v_explicit_pt := true;
        ELSIF v_code = 'TDS' THEN
          v_explicit_tds := true;
        END IF;
      END IF;

    ELSIF (v_component->>'type') = 'employer_cost' THEN
      v_explicit_employer := v_explicit_employer + v_amount;

      IF v_amount > 0 THEN
        IF v_code IN ('PF_ER', 'PF_EMPLOYER') THEN
          v_explicit_pf_er := true;
        ELSIF v_code IN ('ESI_ER', 'ESIC_ER', 'ESI_EMPLOYER', 'ESIC_EMPLOYER') THEN
          v_explicit_esic_er := true;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- ----------------------------------------------------------
  -- Compliance runs only when at least one head was opted into.
  -- ----------------------------------------------------------
  IF v_opt_pf OR v_opt_esic OR v_opt_pt OR v_opt_tds THEN
    v_compliance := fn_apply_compliance(p_user, v_month, v_year, v_components, p_state);

    IF v_opt_pf AND NOT v_explicit_pf THEN
      v_pf_employee := COALESCE((v_compliance->>'pf_employee')::numeric, 0);
    END IF;
    IF v_opt_pf AND NOT v_explicit_pf_er THEN
      v_pf_employer := COALESCE((v_compliance->>'pf_employer')::numeric, 0);
    END IF;
    IF v_opt_esic AND NOT v_explicit_esic THEN
      v_esic_employee := COALESCE((v_compliance->>'esic_employee')::numeric, 0);
    END IF;
    IF v_opt_esic AND NOT v_explicit_esic_er THEN
      v_esic_employer := COALESCE((v_compliance->>'esic_employer')::numeric, 0);
    END IF;
    IF v_opt_pt AND NOT v_explicit_pt THEN
      v_pt_amount := COALESCE((v_compliance->>'pt_amount')::numeric, 0);
    END IF;
    IF v_opt_tds AND NOT v_explicit_tds THEN
      v_tds_amount := COALESCE((v_compliance->>'tds_amount')::numeric, 0);
    END IF;
  END IF;

  v_attendance_basis := fn_resolve_attendance_basis(p_user, v_month, v_year);

  v_total_deductions := v_total_deductions + v_pf_employee + v_esic_employee + v_pt_amount + v_tds_amount;
  v_net_pay := v_gross_earnings - v_total_deductions;
  v_employer_cost := v_gross_earnings + v_explicit_employer + v_pf_employer + v_esic_employer;

  -- ----------------------------------------------------------
  -- Snapshot = evaluated components + the computed statutory lines
  -- ----------------------------------------------------------
  v_snapshot := v_components;

  IF v_pf_employee > 0 THEN
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'code', 'PF_EE', 'name', 'PF Employee', 'type', 'statutory_deduction', 'amount', -v_pf_employee
    ));
  END IF;
  IF v_esic_employee > 0 THEN
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'code', 'ESIC_EE', 'name', 'ESIC Employee', 'type', 'statutory_deduction', 'amount', -v_esic_employee
    ));
  END IF;
  IF v_pt_amount > 0 THEN
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'code', 'PT', 'name', 'Professional Tax', 'type', 'statutory_deduction', 'amount', -v_pt_amount
    ));
  END IF;
  IF v_tds_amount > 0 THEN
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'code', 'TDS', 'name', 'TDS', 'type', 'statutory_deduction', 'amount', -v_tds_amount
    ));
  END IF;
  IF v_pf_employer > 0 THEN
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'code', 'PF_ER', 'name', 'PF Employer', 'type', 'employer_cost', 'amount', v_pf_employer
    ));
  END IF;
  IF v_esic_employer > 0 THEN
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'code', 'ESIC_ER', 'name', 'ESIC Employer', 'type', 'employer_cost', 'amount', v_esic_employer
    ));
  END IF;

  INSERT INTO payroll_runs (
    payroll_period_id, user_id, snapshot,
    gross_earnings, total_deductions, net_pay, employer_cost,
    pf_wages, esic_wages, pt_amount, tds_amount,
    attendance_summary, status, created_at
  ) VALUES (
    p_period, p_user, v_snapshot,
    ROUND(v_gross_earnings, 2),
    ROUND(v_total_deductions, 2),
    ROUND(v_net_pay, 2),
    ROUND(v_employer_cost, 2),
    CASE WHEN v_opt_pf THEN COALESCE((v_compliance->>'pf_wages')::numeric, 0) ELSE 0 END,
    CASE WHEN v_opt_esic THEN COALESCE((v_compliance->>'esic_wages')::numeric, 0) ELSE 0 END,
    v_pt_amount,
    v_tds_amount,
    v_attendance_basis,
    'processed',
    NOW()
  )
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_finalize_run(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_finalize_run(uuid, uuid, text) TO service_role;

-- ============================================================
-- Verify — a BASIC-only compensation should now show zero deductions:
--   SELECT gross_earnings, total_deductions, net_pay, employer_cost, snapshot
--   FROM payroll_runs
--   WHERE user_id = '<uuid>'
--   ORDER BY created_at DESC LIMIT 1;
-- ============================================================
