-- ============================================================
-- FIX: Payroll Functions - Complete recreation
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- Date: 2026-02-09
-- Fixes: "syntax error at end of jsonpath input"
-- Root cause: compensation_payload stored as JSON string 
--             (double-encoded) instead of JSON object
-- ============================================================

-- ============================================================
-- 1. fn_calculate_pt - Professional Tax by state
-- ============================================================
DROP FUNCTION IF EXISTS fn_calculate_pt(numeric, text);

CREATE OR REPLACE FUNCTION fn_calculate_pt(
  p_gross numeric,
  p_state text
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Gujarat PT slabs
  IF p_state IN ('Gujarat', 'GJ') THEN
    IF p_gross <= 5999 THEN RETURN 0;
    ELSIF p_gross <= 8999 THEN RETURN 80;
    ELSIF p_gross <= 11999 THEN RETURN 150;
    ELSE RETURN 200;
    END IF;

  -- Maharashtra PT slabs
  ELSIF p_state IN ('Maharashtra', 'MH') THEN
    IF p_gross <= 7500 THEN RETURN 0;
    ELSIF p_gross <= 10000 THEN RETURN 175;
    ELSE RETURN 200;
    END IF;

  -- Karnataka
  ELSIF p_state IN ('Karnataka', 'KA') THEN
    RETURN 200;

  -- Tamil Nadu
  ELSIF p_state IN ('Tamil Nadu', 'TN') THEN
    IF p_gross <= 21000 THEN RETURN 0;
    ELSIF p_gross <= 30000 THEN RETURN 135;
    ELSIF p_gross <= 45000 THEN RETURN 315;
    ELSIF p_gross <= 60000 THEN RETURN 690;
    ELSIF p_gross <= 75000 THEN RETURN 1025;
    ELSE RETURN 1250;
    END IF;

  -- Andhra Pradesh / Telangana
  ELSIF p_state IN ('Andhra Pradesh', 'AP', 'Telangana', 'TS') THEN
    IF p_gross <= 15000 THEN RETURN 150;
    ELSIF p_gross <= 20000 THEN RETURN 200;
    ELSE RETURN 200;
    END IF;

  -- West Bengal
  ELSIF p_state IN ('West Bengal', 'WB') THEN
    IF p_gross <= 10000 THEN RETURN 0;
    ELSIF p_gross <= 15000 THEN RETURN 110;
    ELSIF p_gross <= 25000 THEN RETURN 130;
    ELSIF p_gross <= 40000 THEN RETURN 150;
    ELSE RETURN 200;
    END IF;

  -- Rajasthan
  ELSIF p_state IN ('Rajasthan', 'RJ') THEN
    IF p_gross <= 12000 THEN RETURN 0;
    ELSIF p_gross <= 15000 THEN RETURN 100;
    ELSIF p_gross <= 20000 THEN RETURN 150;
    ELSE RETURN 200;
    END IF;

  -- Delhi (no PT)
  ELSIF p_state IN ('Delhi', 'DL') THEN
    RETURN 0;

  ELSE
    RETURN 0;
  END IF;
END;
$$;


-- ============================================================
-- 2. fn_resolve_attendance_basis
-- ============================================================
DROP FUNCTION IF EXISTS fn_resolve_attendance_basis(uuid, integer, integer);

CREATE OR REPLACE FUNCTION fn_resolve_attendance_basis(
  p_user uuid,
  p_month integer,
  p_year integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
  v_start_date date;
  v_end_date date;
  v_working_days integer;
  v_present_days integer := 0;
  v_lop_days integer := 0;
  v_paid_leaves integer := 0;
  v_ot_hours numeric := 0;
  v_late_count integer := 0;
  v_total_hours numeric := 0;
  v_override record;
BEGIN
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := (v_start_date + interval '1 month' - interval '1 day')::date;

  -- Working days (exclude Sunday only - many Indian orgs work Saturdays)
  SELECT COUNT(*)
  INTO v_working_days
  FROM generate_series(v_start_date, v_end_date, '1 day'::interval) d
  WHERE EXTRACT(DOW FROM d) != 0;

  -- Aggregate attendance
  SELECT
    COALESCE(COUNT(*) FILTER (WHERE NOT COALESCE(is_absent, false) 
                                AND NOT COALESCE(is_weekend, false) 
                                AND NOT COALESCE(is_holiday, false)), 0),
    COALESCE(COUNT(*) FILTER (WHERE COALESCE(is_absent, false) 
                                AND NOT COALESCE(is_holiday, false) 
                                AND NOT COALESCE(is_weekend, false)
                                AND NOT COALESCE(is_regularized, false)), 0),
    COALESCE(COUNT(*) FILTER (WHERE COALESCE(is_holiday, false) 
                                OR (COALESCE(is_absent, false) AND COALESCE(is_regularized, false))), 0),
    COALESCE(COUNT(*) FILTER (WHERE COALESCE(is_late, false)), 0),
    COALESCE(SUM(COALESCE(effective_hours, 0)), 0)
  INTO v_present_days, v_lop_days, v_paid_leaves, v_late_count, v_total_hours
  FROM attendance
  WHERE user_id = p_user
    AND date >= v_start_date
    AND date <= v_end_date;

  -- Check for manual overrides
  SELECT *
  INTO v_override
  FROM attendance_monthly_overrides
  WHERE user_id = p_user
    AND month = p_month
    AND year = p_year
  LIMIT 1;

  IF FOUND THEN
    v_present_days := COALESCE((v_override.payload->>'present_days')::integer, v_present_days);
    v_lop_days := COALESCE((v_override.payload->>'lop_days')::integer, v_lop_days);
    v_paid_leaves := COALESCE((v_override.payload->>'paid_leaves')::integer, v_paid_leaves);
    v_ot_hours := COALESCE((v_override.payload->>'ot_hours')::numeric, 0);
    v_late_count := COALESCE((v_override.payload->>'late_count')::integer, v_late_count);
  END IF;

  -- PAYABLE DAYS LOGIC:
  -- If attendance records exist (present + absent + paid_leaves > 0),
  -- pay only for days actually present + approved paid leaves.
  -- If NO attendance data at all, assume full attendance (org hasn't set up tracking yet).
  IF (v_present_days + v_lop_days + v_paid_leaves) > 0 THEN
    -- Standard Indian payroll: pay for present days + paid leaves, capped at working days
    v_lop_days := GREATEST(v_working_days - v_present_days - v_paid_leaves, 0);
  ELSE
    -- No attendance tracking for this employee/month — assume full attendance
    v_lop_days := 0;
  END IF;

  v_result := jsonb_build_object(
    'present_days', v_present_days,
    'lop_days', v_lop_days,
    'paid_leaves', v_paid_leaves,
    'ot_hours', v_ot_hours,
    'late_count', v_late_count,
    'total_hours', v_total_hours,
    'working_days', v_working_days,
    'payable_days', GREATEST(v_working_days - v_lop_days, 0)
  );

  RETURN v_result;
END;
$$;


-- ============================================================
-- 3. fn_get_active_compensation
--    CRITICAL FIX: handles compensation_payload stored as
--    a JSON string (double-encoded) vs a native JSONB object
-- ============================================================
DROP FUNCTION IF EXISTS fn_get_active_compensation(uuid, integer, integer);

CREATE OR REPLACE FUNCTION fn_get_active_compensation(
  p_user uuid,
  p_month integer,
  p_year integer
) RETURNS TABLE (
  compensation_id uuid,
  ctc_annual numeric,
  pay_schedule text,
  currency text,
  components jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_date date;
  v_raw_payload jsonb;
  v_components jsonb;
  v_rec record;
BEGIN
  v_target_date := make_date(p_year, p_month, 15);

  SELECT ec.id, ec.ctc_annual, ec.pay_schedule, ec.currency, ec.compensation_payload
  INTO v_rec
  FROM employee_compensation ec
  WHERE ec.user_id = p_user
    AND ec.effective_from <= v_target_date
    AND (ec.effective_to IS NULL OR ec.effective_to >= v_target_date)
  ORDER BY ec.effective_from DESC
  LIMIT 1;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'No active compensation found for user % in %-%', p_user, p_month, p_year;
  END IF;

  v_raw_payload := v_rec.compensation_payload;

  -- FIX: Handle double-encoded JSON string
  -- If compensation_payload is a JSON string like '"{ ... }"', 
  -- the ->> operator returns the string, then we cast it to jsonb
  IF jsonb_typeof(v_raw_payload) = 'string' THEN
    -- It's a JSON string, extract the text and parse it
    v_raw_payload := (v_raw_payload #>> '{}')::jsonb;
  END IF;

  -- Now extract components array
  v_components := v_raw_payload -> 'components';

  IF v_components IS NULL OR jsonb_typeof(v_components) != 'array' THEN
    RAISE EXCEPTION 'No components array found in compensation for user %', p_user;
  END IF;

  compensation_id := v_rec.id;
  ctc_annual := v_rec.ctc_annual;
  pay_schedule := v_rec.pay_schedule;
  currency := v_rec.currency;
  components := v_components;
  RETURN NEXT;
END;
$$;


-- ============================================================
-- 4. fn_eval_components
-- ============================================================
DROP FUNCTION IF EXISTS fn_eval_components(uuid, integer, integer);

CREATE OR REPLACE FUNCTION fn_eval_components(
  p_user uuid,
  p_month integer,
  p_year integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attendance_basis jsonb;
  v_comp record;
  v_components jsonb;
  v_component jsonb;
  v_result jsonb[] := '{}';

  v_annual_amount numeric;
  v_monthly_amount numeric;
  v_prorated_amount numeric;
  v_comp_code text;
  v_comp_name text;
  v_comp_type text;

  v_payable_days integer;
  v_working_days integer;
  v_proration_factor numeric;
  v_gross_earnings numeric := 0;
BEGIN
  -- 1. Get attendance basis
  v_attendance_basis := fn_resolve_attendance_basis(p_user, p_month, p_year);
  v_payable_days := COALESCE((v_attendance_basis->>'payable_days')::integer, 0);
  v_working_days := COALESCE((v_attendance_basis->>'working_days')::integer, 1);

  IF v_working_days > 0 THEN
    v_proration_factor := v_payable_days::numeric / v_working_days::numeric;
  ELSE
    v_proration_factor := 1;
  END IF;

  -- 2. Get active compensation
  SELECT * INTO v_comp
  FROM fn_get_active_compensation(p_user, p_month, p_year);

  v_components := v_comp.components;

  -- 3. Evaluate each component
  FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
  LOOP
    v_comp_code := v_component->>'component_code';
    IF v_comp_code IS NULL THEN
      v_comp_code := v_component->>'code';
    END IF;

    v_annual_amount := COALESCE((v_component->>'amount')::numeric, 0);
    v_monthly_amount := v_annual_amount / 12.0;

    -- Look up the component definition
    SELECT pc.name, pc.type
    INTO v_comp_name, v_comp_type
    FROM pay_components pc
    WHERE pc.code = v_comp_code AND pc.active = true;

    IF NOT FOUND THEN
      v_comp_name := v_comp_code;
      -- Negative amounts are deductions, positive are earnings
      IF v_annual_amount < 0 THEN
        v_comp_type := 'deduction';
      ELSE
        v_comp_type := 'earning';
      END IF;
    END IF;

    -- Prorate: only prorate earnings, not deductions (deductions are usually fixed)
    IF v_comp_type = 'earning' THEN
      v_prorated_amount := v_monthly_amount * v_proration_factor;
    ELSE
      v_prorated_amount := ABS(v_monthly_amount);
    END IF;

    v_result := v_result || jsonb_build_object(
      'code', v_comp_code,
      'name', v_comp_name,
      'type', v_comp_type,
      'annual_amount', v_annual_amount,
      'monthly_amount', ROUND(v_monthly_amount, 2),
      'prorated_amount', ROUND(v_prorated_amount, 2),
      'amount', ROUND(v_prorated_amount, 2)
    );

    IF v_comp_type = 'earning' THEN
      v_gross_earnings := v_gross_earnings + v_prorated_amount;
    END IF;
  END LOOP;

  RETURN array_to_json(v_result)::jsonb;
END;
$$;


-- ============================================================
-- 5. fn_apply_compliance
-- ============================================================
DROP FUNCTION IF EXISTS fn_apply_compliance(uuid, integer, integer, jsonb, text);

CREATE OR REPLACE FUNCTION fn_apply_compliance(
  p_user uuid,
  p_month integer,
  p_year integer,
  p_components jsonb,
  p_state text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
  v_component jsonb;
  v_basic numeric := 0;
  v_da numeric := 0;
  v_gross numeric := 0;

  v_pf_wages numeric;
  v_pf_employee numeric := 0;
  v_pf_employer numeric := 0;
  v_pf_ceiling numeric := 15000;

  v_esic_wages numeric := 0;
  v_esic_employee numeric := 0;
  v_esic_employer numeric := 0;
  v_esic_ceiling numeric := 21000;

  v_pt_amount numeric := 0;
  v_tds_amount numeric := 0;
BEGIN
  -- Calculate gross and identify Basic/DA
  FOR v_component IN SELECT * FROM jsonb_array_elements(p_components)
  LOOP
    IF (v_component->>'type') = 'earning' THEN
      v_gross := v_gross + COALESCE((v_component->>'amount')::numeric, 0);

      IF UPPER(COALESCE(v_component->>'code', '')) IN ('BASIC', 'BASIC_SALARY') THEN
        v_basic := COALESCE((v_component->>'amount')::numeric, 0);
      ELSIF UPPER(COALESCE(v_component->>'code', '')) IN ('DA', 'DEARNESS_ALLOWANCE') THEN
        v_da := COALESCE((v_component->>'amount')::numeric, 0);
      END IF;
    END IF;
  END LOOP;

  -- PF: 12% of (Basic + DA), capped at 15000
  v_pf_wages := LEAST(v_basic + v_da, v_pf_ceiling);
  v_pf_employee := ROUND(v_pf_wages * 0.12, 2);
  v_pf_employer := ROUND(v_pf_wages * 0.12, 2);

  -- ESIC: only if gross <= 21000
  IF v_gross <= v_esic_ceiling THEN
    v_esic_wages := v_gross;
    v_esic_employee := ROUND(v_gross * 0.0075, 2);
    v_esic_employer := ROUND(v_gross * 0.0325, 2);
  END IF;

  -- PT
  v_pt_amount := fn_calculate_pt(v_gross, p_state);

  -- TDS placeholder (needs annual projection - keep 0 for now)
  v_tds_amount := 0;

  v_result := jsonb_build_object(
    'pf_wages', v_pf_wages,
    'pf_employee', v_pf_employee,
    'pf_employer', v_pf_employer,
    'esic_wages', v_esic_wages,
    'esic_employee', v_esic_employee,
    'esic_employer', v_esic_employer,
    'pt_amount', v_pt_amount,
    'tds_amount', v_tds_amount,
    'gross_earnings', v_gross
  );

  RETURN v_result;
END;
$$;


-- ============================================================
-- 6. fn_finalize_run - the main function called by the edge fn
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

  v_pf_employee numeric;
  v_esic_employee numeric;
  v_pt_amount numeric;
  v_tds_amount numeric;
  v_pf_employer numeric;
  v_esic_employer numeric;

  v_run_id uuid;
  v_existing_run uuid;
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

  -- Step 1: Evaluate components
  v_components := fn_eval_components(p_user, v_month, v_year);

  -- Step 2: Apply compliance
  v_compliance := fn_apply_compliance(p_user, v_month, v_year, v_components, p_state);

  -- Step 3: Get attendance basis
  v_attendance_basis := fn_resolve_attendance_basis(p_user, v_month, v_year);

  -- Step 4: Calculate totals from evaluated components
  FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
  LOOP
    IF (v_component->>'type') = 'earning' THEN
      v_gross_earnings := v_gross_earnings + COALESCE((v_component->>'amount')::numeric, 0);
    ELSIF (v_component->>'type') = 'deduction' THEN
      v_total_deductions := v_total_deductions + ABS(COALESCE((v_component->>'amount')::numeric, 0));
    END IF;
  END LOOP;

  -- Add statutory deductions
  v_pf_employee := COALESCE((v_compliance->>'pf_employee')::numeric, 0);
  v_esic_employee := COALESCE((v_compliance->>'esic_employee')::numeric, 0);
  v_pt_amount := COALESCE((v_compliance->>'pt_amount')::numeric, 0);
  v_tds_amount := COALESCE((v_compliance->>'tds_amount')::numeric, 0);
  v_pf_employer := COALESCE((v_compliance->>'pf_employer')::numeric, 0);
  v_esic_employer := COALESCE((v_compliance->>'esic_employer')::numeric, 0);

  v_total_deductions := v_total_deductions + v_pf_employee + v_esic_employee + v_pt_amount + v_tds_amount;

  -- Net pay
  v_net_pay := v_gross_earnings - v_total_deductions;

  -- Employer cost
  v_employer_cost := v_gross_earnings + v_pf_employer + v_esic_employer;

  -- Build snapshot: combine components + statutory items
  v_snapshot := v_components;

  -- Add statutory deduction entries to snapshot
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
  -- Add employer contributions to snapshot
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
    COALESCE((v_compliance->>'pf_wages')::numeric, 0),
    COALESCE((v_compliance->>'esic_wages')::numeric, 0),
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


-- ============================================================
-- Grant permissions
-- ============================================================
GRANT EXECUTE ON FUNCTION fn_calculate_pt(numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_calculate_pt(numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION fn_resolve_attendance_basis(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_resolve_attendance_basis(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION fn_get_active_compensation(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_get_active_compensation(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION fn_eval_components(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_eval_components(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION fn_apply_compliance(uuid, integer, integer, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_apply_compliance(uuid, integer, integer, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION fn_finalize_run(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_finalize_run(uuid, uuid, text) TO service_role;


-- ============================================================
-- Quick test (replace with a real user_id)
-- ============================================================
-- SELECT fn_resolve_attendance_basis('c33ea6fe-338a-4108-932b-484709255550'::uuid, 1, 2026);
-- SELECT * FROM fn_get_active_compensation('c33ea6fe-338a-4108-932b-484709255550'::uuid, 1, 2026);
-- SELECT fn_eval_components('c33ea6fe-338a-4108-932b-484709255550'::uuid, 1, 2026);
