-- ============================================================
-- FIX: payable_days / working_days must be numeric (not integer)
-- because half-days produce decimal values (e.g. 22.5)
-- Also: prorate deductions, skip statutory overlap codes
-- Run this in Supabase SQL Editor
-- Date: 2026-02-09
-- ============================================================

-- ============================================================
-- 1. Fix fn_eval_components
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
  v_comp_code_upper text;
  v_comp_name text;
  v_comp_type text;

  v_payable_days numeric;
  v_working_days numeric;
  v_proration_factor numeric;
  v_gross_earnings numeric := 0;

  -- Statutory codes computed by fn_apply_compliance — skip to avoid double-counting
  v_statutory_codes text[] := ARRAY['PF_EE', 'PF_ER', 'ESIC_EE', 'ESIC_ER', 'ESIC_EMPLOYEE', 'PT', 'TDS'];
BEGIN
  -- 1. Get attendance basis
  v_attendance_basis := fn_resolve_attendance_basis(p_user, p_month, p_year);
  v_payable_days := COALESCE((v_attendance_basis->>'payable_days')::numeric, 0);
  v_working_days := COALESCE((v_attendance_basis->>'working_days')::numeric, 1);

  IF v_working_days > 0 THEN
    v_proration_factor := v_payable_days / v_working_days;
  ELSE
    v_proration_factor := 1;
  END IF;

  -- 2. Get active compensation
  SELECT * INTO v_comp
  FROM fn_get_active_compensation(p_user, p_month, p_year);

  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  v_components := v_comp.components;

  -- 3. Evaluate each component
  FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
  LOOP
    -- Component code: try component_code first (saved by CompensationEditor), then code
    v_comp_code := v_component->>'component_code';
    IF v_comp_code IS NULL THEN
      v_comp_code := v_component->>'code';
    END IF;
    v_comp_code_upper := UPPER(COALESCE(v_comp_code, ''));

    -- Skip statutory deduction codes — fn_apply_compliance handles these
    IF v_comp_code_upper = ANY(v_statutory_codes) THEN
      CONTINUE;
    END IF;

    -- Amount is annual (stored by CompensationEditor as "amount")
    v_annual_amount := COALESCE((v_component->>'amount')::numeric, 0);
    v_monthly_amount := v_annual_amount / 12.0;

    -- Look up the component definition from pay_components
    SELECT pc.name, pc.type
    INTO v_comp_name, v_comp_type
    FROM pay_components pc
    WHERE pc.code = v_comp_code AND pc.active = true;

    IF NOT FOUND THEN
      v_comp_name := v_comp_code;
      IF v_annual_amount < 0 THEN
        v_comp_type := 'deduction';
      ELSE
        v_comp_type := 'earning';
      END IF;
    END IF;

    -- Prorate ALL components (earnings and deductions) proportionally
    v_prorated_amount := ROUND(v_monthly_amount * v_proration_factor, 2);

    IF v_comp_type = 'earning' THEN
      v_gross_earnings := v_gross_earnings + v_prorated_amount;
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

GRANT EXECUTE ON FUNCTION fn_eval_components(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_eval_components(uuid, integer, integer) TO service_role;


-- ============================================================
-- Done! Summary:
-- - Changed v_payable_days from integer to numeric (fixes "3.0" parse error)
-- - Changed v_working_days from integer to numeric
-- - Uses v_comp.components (not compensation_payload)
-- - Uses component_code / code field (not annual_amount/monthly_amount)
-- - Looks up pay_components for name/type
-- - Prorates earnings only, deductions kept fixed
-- ============================================================
