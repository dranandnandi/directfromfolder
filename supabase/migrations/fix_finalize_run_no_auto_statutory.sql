-- ============================================================
-- FIX: fn_finalize_run — Only apply statutory deductions when
-- the compensation explicitly includes statutory deduction codes
-- (PF, ESIC, PT, TDS). Simple single-component compensations
-- (e.g., BASIC only) should NOT auto-generate deductions.
--
-- Root cause: fn_apply_compliance always calculated PF/ESIC/PT
-- from the BASIC/gross amount and those were unconditionally added
-- to total_deductions, even when the comp payload had no deduction
-- components at all.
--
-- Run this in: Supabase Dashboard > SQL Editor
-- Date: 2026-02-25
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
  v_compliance jsonb;
  v_attendance_basis jsonb;

  v_snapshot jsonb;
  v_component jsonb;

  v_gross_earnings numeric := 0;
  v_total_deductions numeric := 0;
  v_net_pay numeric;
  v_employer_cost numeric;

  v_pf_employee numeric := 0;
  v_esic_employee numeric := 0;
  v_pt_amount numeric := 0;
  v_tds_amount numeric := 0;
  v_pf_employer numeric := 0;
  v_esic_employer numeric := 0;

  v_run_id uuid;
  v_existing_run uuid;

  -- Check whether compensation explicitly includes statutory deduction codes
  v_raw_comps jsonb;
  v_has_statutory boolean := false;
  -- Statutory codes that must be present in the compensation payload for
  -- auto-deductions to be applied
  v_statutory_codes text[] := ARRAY['PF', 'PF_EE', 'ESI', 'ESIC_EE', 'ESIC_EMPLOYEE', 'PT', 'TDS'];
BEGIN
  -- Get period details and verify status
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

  -- Check if run already exists for this user+period
  SELECT id INTO v_existing_run
  FROM payroll_runs
  WHERE payroll_period_id = p_period AND user_id = p_user;

  IF v_existing_run IS NOT NULL THEN
    -- Delete existing run so we can recalculate
    DELETE FROM payroll_runs WHERE id = v_existing_run;
  END IF;

  -- Step 1: Evaluate components (statutory codes already skipped inside fn_eval_components)
  v_components := fn_eval_components(p_user, v_month, v_year);

  -- Step 2: Check whether the ORIGINAL compensation payload explicitly includes
  -- any statutory deduction codes. If not, skip auto-statutory compliance entirely.
  SELECT components INTO v_raw_comps
  FROM fn_get_active_compensation(p_user, v_month, v_year);

  IF v_raw_comps IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_raw_comps) AS c
      WHERE UPPER(COALESCE(c->>'component_code', c->>'code', '')) = ANY(v_statutory_codes)
    ) INTO v_has_statutory;
  END IF;

  -- Step 3: Apply compliance — only when compensation explicitly has statutory codes
  IF v_has_statutory THEN
    v_compliance := fn_apply_compliance(p_user, v_month, v_year, v_components, p_state);
    v_pf_employee  := COALESCE((v_compliance->>'pf_employee')::numeric,  0);
    v_esic_employee:= COALESCE((v_compliance->>'esic_employee')::numeric, 0);
    v_pt_amount    := COALESCE((v_compliance->>'pt_amount')::numeric,     0);
    v_tds_amount   := COALESCE((v_compliance->>'tds_amount')::numeric,    0);
    v_pf_employer  := COALESCE((v_compliance->>'pf_employer')::numeric,   0);
    v_esic_employer:= COALESCE((v_compliance->>'esic_employer')::numeric, 0);
  END IF;

  -- Step 4: Get attendance basis
  v_attendance_basis := fn_resolve_attendance_basis(p_user, v_month, v_year);

  -- Step 5: Calculate totals from evaluated components
  FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
  LOOP
    IF (v_component->>'type') = 'earning' THEN
      v_gross_earnings := v_gross_earnings + COALESCE((v_component->>'amount')::numeric, 0);
    ELSIF (v_component->>'type') = 'deduction' THEN
      v_total_deductions := v_total_deductions + ABS(COALESCE((v_component->>'amount')::numeric, 0));
    END IF;
  END LOOP;

  -- Step 6: Add statutory deductions (only when compensation explicitly includes them)
  v_total_deductions := v_total_deductions + v_pf_employee + v_esic_employee + v_pt_amount + v_tds_amount;

  -- Net pay
  v_net_pay := v_gross_earnings - v_total_deductions;

  -- Employer cost
  v_employer_cost := v_gross_earnings + v_pf_employer + v_esic_employer;

  -- Build snapshot: combine components + statutory items (only when applicable)
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

  -- Insert payroll run
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
    CASE WHEN v_has_statutory THEN COALESCE((v_compliance->>'pf_wages')::numeric, 0) ELSE 0 END,
    CASE WHEN v_has_statutory THEN COALESCE((v_compliance->>'esic_wages')::numeric, 0) ELSE 0 END,
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
