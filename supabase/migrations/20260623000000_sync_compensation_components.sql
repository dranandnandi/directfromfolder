-- Keep compensation editor, AI drafts, and payroll finalization aligned.
-- Only active pay_components should affect payroll, and statutory deductions
-- selected in compensation should not be charged again by compliance.

CREATE OR REPLACE FUNCTION fn_pay_component_canonical_code(p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_code text;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN NULL;
  END IF;

  SELECT pc.code INTO v_code
  FROM pay_components pc
  WHERE pc.active = true
    AND lower(pc.code) = lower(btrim(p_code))
  ORDER BY pc.sort_order NULLS LAST, pc.code
  LIMIT 1;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  SELECT pc.code INTO v_code
  FROM pay_components pc
  WHERE pc.active = true
    AND pc.code = ANY (
      CASE lower(btrim(p_code))
        WHEN 'basic' THEN ARRAY['BASIC', 'basic']
        WHEN 'hra' THEN ARRAY['HRA', 'hra']
        WHEN 'conv' THEN ARRAY['CONV', 'conv', 'conveyance']
        WHEN 'conveyance' THEN ARRAY['CONV', 'conv', 'conveyance']
        WHEN 'special' THEN ARRAY['SPEC', 'special', 'SPECIAL']
        WHEN 'spec' THEN ARRAY['SPEC', 'special', 'SPECIAL']
        WHEN 'med' THEN ARRAY['MED', 'medical', 'MEDICAL']
        WHEN 'medical' THEN ARRAY['MED', 'medical', 'MEDICAL']
        WHEN 'pf' THEN ARRAY['PF_EE', 'PF', 'pf_employee']
        WHEN 'pf_ee' THEN ARRAY['PF_EE', 'PF', 'pf_employee']
        WHEN 'pf_employee' THEN ARRAY['PF_EE', 'PF', 'pf_employee']
        WHEN 'esi' THEN ARRAY['ESI', 'ESIC_EE', 'esic_employee']
        WHEN 'esic' THEN ARRAY['ESI', 'ESIC_EE', 'esic_employee']
        WHEN 'esic_employee' THEN ARRAY['ESI', 'ESIC_EE', 'esic_employee']
        WHEN 'pt' THEN ARRAY['PT', 'pt']
        WHEN 'tds' THEN ARRAY['TDS', 'tds']
        WHEN 'pf_er' THEN ARRAY['PF_ER', 'pf_employer']
        WHEN 'pf_employer' THEN ARRAY['PF_ER', 'pf_employer']
        WHEN 'esi_er' THEN ARRAY['ESI_ER', 'ESIC_ER', 'esi_employer', 'esic_employer']
        WHEN 'esic_er' THEN ARRAY['ESI_ER', 'ESIC_ER', 'esi_employer', 'esic_employer']
        WHEN 'esi_employer' THEN ARRAY['ESI_ER', 'ESIC_ER', 'esi_employer', 'esic_employer']
        WHEN 'esic_employer' THEN ARRAY['ESI_ER', 'ESIC_ER', 'esi_employer', 'esic_employer']
        ELSE ARRAY[]::text[]
      END
    )
  ORDER BY array_position(
    CASE lower(btrim(p_code))
      WHEN 'basic' THEN ARRAY['BASIC', 'basic']
      WHEN 'hra' THEN ARRAY['HRA', 'hra']
      WHEN 'conv' THEN ARRAY['CONV', 'conv', 'conveyance']
      WHEN 'conveyance' THEN ARRAY['CONV', 'conv', 'conveyance']
      WHEN 'special' THEN ARRAY['SPEC', 'special', 'SPECIAL']
      WHEN 'spec' THEN ARRAY['SPEC', 'special', 'SPECIAL']
      WHEN 'med' THEN ARRAY['MED', 'medical', 'MEDICAL']
      WHEN 'medical' THEN ARRAY['MED', 'medical', 'MEDICAL']
      WHEN 'pf' THEN ARRAY['PF_EE', 'PF', 'pf_employee']
      WHEN 'pf_ee' THEN ARRAY['PF_EE', 'PF', 'pf_employee']
      WHEN 'pf_employee' THEN ARRAY['PF_EE', 'PF', 'pf_employee']
      WHEN 'esi' THEN ARRAY['ESI', 'ESIC_EE', 'esic_employee']
      WHEN 'esic' THEN ARRAY['ESI', 'ESIC_EE', 'esic_employee']
      WHEN 'esic_employee' THEN ARRAY['ESI', 'ESIC_EE', 'esic_employee']
      WHEN 'pt' THEN ARRAY['PT', 'pt']
      WHEN 'tds' THEN ARRAY['TDS', 'tds']
      WHEN 'pf_er' THEN ARRAY['PF_ER', 'pf_employer']
      WHEN 'pf_employer' THEN ARRAY['PF_ER', 'pf_employer']
      WHEN 'esi_er' THEN ARRAY['ESI_ER', 'ESIC_ER', 'esi_employer', 'esic_employer']
      WHEN 'esic_er' THEN ARRAY['ESI_ER', 'ESIC_ER', 'esi_employer', 'esic_employer']
      WHEN 'esi_employer' THEN ARRAY['ESI_ER', 'ESIC_ER', 'esi_employer', 'esic_employer']
      WHEN 'esic_employer' THEN ARRAY['ESI_ER', 'ESIC_ER', 'esi_employer', 'esic_employer']
      ELSE ARRAY[]::text[]
    END,
    pc.code
  )
  LIMIT 1;

  RETURN v_code;
END;
$$;

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
  v_raw_code text;
  v_comp_name text;
  v_comp_type text;

  v_payable_days integer;
  v_working_days integer;
  v_proration_factor numeric;
BEGIN
  v_attendance_basis := fn_resolve_attendance_basis(p_user, p_month, p_year);
  v_payable_days := COALESCE((v_attendance_basis->>'payable_days')::integer, 0);
  v_working_days := COALESCE((v_attendance_basis->>'working_days')::integer, 1);

  IF v_working_days > 0 THEN
    v_proration_factor := v_payable_days::numeric / v_working_days::numeric;
  ELSE
    v_proration_factor := 1;
  END IF;

  SELECT * INTO v_comp
  FROM fn_get_active_compensation(p_user, p_month, p_year);

  v_components := v_comp.components;

  FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
  LOOP
    v_raw_code := COALESCE(v_component->>'component_code', v_component->>'code');
    v_comp_code := fn_pay_component_canonical_code(v_raw_code);

    -- If the component is inactive or not configured, it should not affect payroll.
    IF v_comp_code IS NULL THEN
      CONTINUE;
    END IF;

    SELECT pc.name, pc.type
    INTO v_comp_name, v_comp_type
    FROM pay_components pc
    WHERE pc.code = v_comp_code AND pc.active = true;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_annual_amount := COALESCE((v_component->>'amount')::numeric, 0);
    IF v_comp_type = 'deduction' AND v_annual_amount > 0 THEN
      v_annual_amount := -v_annual_amount;
    ELSIF v_comp_type <> 'deduction' AND v_annual_amount < 0 THEN
      v_annual_amount := ABS(v_annual_amount);
    END IF;

    v_monthly_amount := v_annual_amount / 12.0;

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
  END LOOP;

  RETURN array_to_json(v_result)::jsonb;
END;
$$;

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

  v_has_pf_employee boolean := false;
  v_has_esic_employee boolean := false;
  v_has_pt boolean := false;
  v_has_tds boolean := false;

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
  v_compliance := fn_apply_compliance(p_user, v_month, v_year, v_components, p_state);
  v_attendance_basis := fn_resolve_attendance_basis(p_user, v_month, v_year);

  FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
  LOOP
    IF (v_component->>'type') = 'earning' THEN
      v_gross_earnings := v_gross_earnings + COALESCE((v_component->>'amount')::numeric, 0);
    ELSIF (v_component->>'type') = 'deduction' THEN
      v_total_deductions := v_total_deductions + ABS(COALESCE((v_component->>'amount')::numeric, 0));

      IF UPPER(COALESCE(v_component->>'code', '')) IN ('PF', 'PF_EE', 'PF_EMPLOYEE') THEN
        v_has_pf_employee := true;
      ELSIF UPPER(COALESCE(v_component->>'code', '')) IN ('ESI', 'ESIC_EE', 'ESIC_EMPLOYEE') THEN
        v_has_esic_employee := true;
      ELSIF UPPER(COALESCE(v_component->>'code', '')) = 'PT' THEN
        v_has_pt := true;
      ELSIF UPPER(COALESCE(v_component->>'code', '')) = 'TDS' THEN
        v_has_tds := true;
      END IF;
    END IF;
  END LOOP;

  v_pf_employee := CASE
    WHEN v_has_pf_employee THEN 0
    ELSE COALESCE((v_compliance->>'pf_employee')::numeric, 0)
  END;
  v_esic_employee := CASE
    WHEN v_has_esic_employee THEN 0
    ELSE COALESCE((v_compliance->>'esic_employee')::numeric, 0)
  END;
  v_pt_amount := CASE
    WHEN v_has_pt THEN 0
    ELSE COALESCE((v_compliance->>'pt_amount')::numeric, 0)
  END;
  v_tds_amount := CASE
    WHEN v_has_tds THEN 0
    ELSE COALESCE((v_compliance->>'tds_amount')::numeric, 0)
  END;
  v_pf_employer := COALESCE((v_compliance->>'pf_employer')::numeric, 0);
  v_esic_employer := COALESCE((v_compliance->>'esic_employer')::numeric, 0);

  v_total_deductions := v_total_deductions + v_pf_employee + v_esic_employee + v_pt_amount + v_tds_amount;
  v_net_pay := v_gross_earnings - v_total_deductions;
  v_employer_cost := v_gross_earnings + v_pf_employer + v_esic_employer;

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

GRANT EXECUTE ON FUNCTION fn_pay_component_canonical_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pay_component_canonical_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION fn_eval_components(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_eval_components(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION fn_finalize_run(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_finalize_run(uuid, uuid, text) TO service_role;
