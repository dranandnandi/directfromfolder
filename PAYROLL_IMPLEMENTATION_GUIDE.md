# Payroll Calculation Engine - Implementation Guide

**Purpose:** Technical specification for implementing the missing payroll calculation functions  
**Audience:** Backend developers  
**Status:** Design Document  

---

## 1. Architecture Overview

### 1.1 Calculation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     PAYROLL CALCULATION FLOW                 │
└─────────────────────────────────────────────────────────────┘

Input: organization_id, month, year, user_id (optional)
  ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Resolve Attendance Basis                            │
│ fn_resolve_attendance_basis(user_id, month, year)          │
│                                                              │
│ Input Tables:                                                │
│   - attendance (daily punch records)                         │
│   - attendance_monthly_overrides (manual adjustments)        │
│   - shifts (for expected hours)                              │
│                                                              │
│ Output: JSONB                                                │
│ {                                                            │
│   "present_days": 22,                                        │
│   "lop_days": 2,                                             │
│   "paid_leaves": 1,                                          │
│   "ot_hours": 10.5,                                          │
│   "late_count": 3,                                           │
│   "total_hours": 176,                                        │
│   "working_days": 24                                         │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: Get Active Compensation                             │
│ fn_get_active_compensation(user_id, month, year)           │
│                                                              │
│ Input Tables:                                                │
│   - employee_compensation                                    │
│                                                              │
│ Output: Compensation record with components array            │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: Evaluate Components                                 │
│ fn_eval_components(user_id, month, year)                    │
│                                                              │
│ Input Tables:                                                │
│   - pay_components (component definitions)                   │
│   - employee_compensation (user's components)                │
│   - Result from Step 1 (attendance basis)                    │
│                                                              │
│ Logic:                                                       │
│   For each component:                                        │
│     1. Get annual amount from compensation                   │
│     2. Calculate monthly amount (÷ 12)                       │
│     3. Apply attendance pro-ration                           │
│     4. Evaluate calc_method (formula/percentage)             │
│     5. Add overtime if applicable                            │
│                                                              │
│ Output: JSONB array                                          │
│ [                                                            │
│   {                                                          │
│     "code": "BASIC",                                         │
│     "name": "Basic Salary",                                  │
│     "type": "earning",                                       │
│     "amount": 18333.33                                       │
│   },                                                         │
│   ...                                                        │
│ ]                                                            │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: Apply Compliance                                    │
│ fn_apply_compliance(user_id, month, year, components, state)│
│                                                              │
│ Input Tables:                                                │
│   - compliance_rules (PF/ESIC/PT rules by state)            │
│   - Result from Step 3 (evaluated components)                │
│                                                              │
│ Logic:                                                       │
│   1. Calculate PF wages (Basic + DA, capped at ₹15,000)    │
│   2. PF Employee = 12% of PF wages                           │
│   3. PF Employer = 12% of PF wages (split: EPS + EPF)        │
│   4. Check ESIC eligibility (gross <= ₹21,000)              │
│   5. ESIC Employee = 0.75% of gross                          │
│   6. ESIC Employer = 3.25% of gross                          │
│   7. Apply PT slab based on state and gross                  │
│   8. Calculate TDS (if applicable)                           │
│                                                              │
│ Output: JSONB                                                │
│ {                                                            │
│   "pf_wages": 15000,                                         │
│   "pf_employee": 1800,                                       │
│   "pf_employer": 1800,                                       │
│   "esic_wages": 0,                                           │
│   "esic_employee": 0,                                        │
│   "esic_employer": 0,                                        │
│   "pt_amount": 200,                                          │
│   "tds_amount": 0                                            │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: Finalize Run                                        │
│ fn_finalize_run(period_id, user_id, state)                 │
│                                                              │
│ Logic:                                                       │
│   1. Combine results from Steps 1-4                          │
│   2. Calculate totals:                                       │
│      - gross_earnings (sum of all earnings)                  │
│      - total_deductions (PF + PT + TDS)                      │
│      - net_pay (gross - deductions)                          │
│      - employer_cost (gross + PF_emp + ESIC_emp)             │
│   3. Create snapshot (component array)                       │
│   4. Insert into payroll_runs table                          │
│                                                              │
│ Output: payroll_runs record                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Function Specifications

### 2.1 fn_resolve_attendance_basis

**Purpose:** Aggregate daily attendance into monthly summary

```sql
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
  v_present_days integer;
  v_lop_days integer;
  v_paid_leaves integer;
  v_ot_hours numeric;
  v_late_count integer;
  v_total_hours numeric;
  v_override record;
BEGIN
  -- Calculate date range
  v_start_date := make_date(p_year::int, p_month::int, 1);
  v_end_date := (v_start_date + interval '1 month' - interval '1 day')::date;
  
  -- Calculate working days (excluding weekends)
  SELECT COUNT(*)
  INTO v_working_days
  FROM generate_series(v_start_date, v_end_date, '1 day'::interval) d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6); -- Exclude Sunday(0) and Saturday(6)
  
  -- Aggregate from attendance table
  SELECT 
    COUNT(*) FILTER (WHERE NOT is_absent AND NOT is_weekend AND NOT is_holiday) as present,
    COUNT(*) FILTER (WHERE is_absent AND NOT is_holiday AND NOT is_weekend) as lop,
    COUNT(*) FILTER (WHERE is_holiday OR (is_absent AND is_regularized)) as paid_leave,
    COUNT(*) FILTER (WHERE is_late) as late,
    COALESCE(SUM(effective_hours), 0) as total_hrs
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
  
  -- Apply overrides if present
  IF FOUND THEN
    v_present_days := COALESCE((v_override.payload->>'present_days')::integer, v_present_days);
    v_lop_days := COALESCE((v_override.payload->>'lop_days')::integer, v_lop_days);
    v_paid_leaves := COALESCE((v_override.payload->>'paid_leaves')::integer, v_paid_leaves);
    v_ot_hours := COALESCE((v_override.payload->>'ot_hours')::numeric, 0);
    v_late_count := COALESCE((v_override.payload->>'late_count')::integer, v_late_count);
  ELSE
    v_ot_hours := 0; -- OT only from manual overrides
  END IF;
  
  -- Calculate payable days
  -- payable_days = working_days - lop_days (paid leaves are already excluded from LOP)
  
  -- Build result JSON
  v_result := jsonb_build_object(
    'present_days', v_present_days,
    'lop_days', v_lop_days,
    'paid_leaves', v_paid_leaves,
    'ot_hours', v_ot_hours,
    'late_count', v_late_count,
    'total_hours', v_total_hours,
    'working_days', v_working_days,
    'payable_days', v_working_days - v_lop_days
  );
  
  RETURN v_result;
END;
$$;
```

**Test Query:**
```sql
SELECT fn_resolve_attendance_basis(
  'user-uuid-here',
  11,  -- November
  2025
);

-- Expected output:
{
  "present_days": 22,
  "lop_days": 2,
  "paid_leaves": 0,
  "ot_hours": 0,
  "late_count": 3,
  "total_hours": 176,
  "working_days": 24,
  "payable_days": 22
}
```

---

### 2.2 fn_get_active_compensation

**Purpose:** Get the effective compensation for a user in a given month/year

```sql
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
BEGIN
  -- Use 15th of the month as reference date
  v_target_date := make_date(p_year::int, p_month::int, 15);
  
  RETURN QUERY
  SELECT 
    ec.id,
    ec.ctc_annual,
    ec.pay_schedule,
    ec.currency,
    ec.compensation_payload->'components' as components
  FROM employee_compensation ec
  WHERE ec.user_id = p_user
    AND ec.effective_from <= v_target_date
    AND (ec.effective_to IS NULL OR ec.effective_to >= v_target_date)
  ORDER BY ec.effective_from DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active compensation found for user % in %-%', p_user, p_month, p_year;
  END IF;
END;
$$;
```

---

### 2.3 fn_eval_components

**Purpose:** Calculate component-wise salary with attendance pro-ration

```sql
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
  v_compensation record;
  v_components jsonb;
  v_component jsonb;
  v_result jsonb[] := '{}';
  v_evaluated_components jsonb := '{}';
  v_gross_earnings numeric := 0;
  
  v_annual_amount numeric;
  v_monthly_amount numeric;
  v_prorated_amount numeric;
  v_component_code text;
  v_component_name text;
  v_component_type text;
  v_calc_method text;
  v_calc_value numeric;
  
  v_payable_days integer;
  v_working_days integer;
  v_proration_factor numeric;
  v_ot_hours numeric;
  v_ot_amount numeric := 0;
BEGIN
  -- Step 1: Get attendance basis
  v_attendance_basis := fn_resolve_attendance_basis(p_user, p_month, p_year);
  v_payable_days := (v_attendance_basis->>'payable_days')::integer;
  v_working_days := (v_attendance_basis->>'working_days')::integer;
  v_ot_hours := (v_attendance_basis->>'ot_hours')::numeric;
  
  -- Calculate pro-ration factor
  IF v_working_days > 0 THEN
    v_proration_factor := v_payable_days::numeric / v_working_days::numeric;
  ELSE
    v_proration_factor := 1;
  END IF;
  
  -- Step 2: Get active compensation
  SELECT * INTO v_compensation
  FROM fn_get_active_compensation(p_user, p_month, p_year);
  
  v_components := v_compensation.components;
  
  -- Step 3: Evaluate each component
  FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
  LOOP
    v_component_code := v_component->>'component_code';
    v_annual_amount := (v_component->>'amount')::numeric;
    v_monthly_amount := v_annual_amount / 12;
    
    -- Get component definition for calc_method
    SELECT code, name, type, calc_method, calc_value
    INTO v_component_code, v_component_name, v_component_type, v_calc_method, v_calc_value
    FROM pay_components
    WHERE code = v_component_code
      AND active = true;
    
    IF NOT FOUND THEN
      -- Component not in pay_components, treat as fixed
      v_component_name := v_component_code;
      v_component_type := 'earning'; -- Assume earning if not found
      v_calc_method := 'fixed';
    END IF;
    
    -- Apply calculation method
    CASE v_calc_method
      WHEN 'fixed' THEN
        v_prorated_amount := v_monthly_amount * v_proration_factor;
        
      WHEN 'percent_of_gross' THEN
        -- Calculate after first pass (need gross)
        v_prorated_amount := v_monthly_amount * v_proration_factor;
        
      WHEN 'percent_of_component' THEN
        -- Calculate based on another component (e.g., HRA = 40% of Basic)
        -- For now, use fixed amount
        v_prorated_amount := v_monthly_amount * v_proration_factor;
        
      WHEN 'formula' THEN
        -- Custom formula evaluation (not implemented yet)
        v_prorated_amount := v_monthly_amount * v_proration_factor;
        
      ELSE
        v_prorated_amount := v_monthly_amount * v_proration_factor;
    END CASE;
    
    -- Add to result
    v_result := v_result || jsonb_build_object(
      'code', v_component_code,
      'name', v_component_name,
      'type', v_component_type,
      'annual_amount', v_annual_amount,
      'monthly_amount', v_monthly_amount,
      'prorated_amount', ROUND(v_prorated_amount, 2),
      'amount', ROUND(v_prorated_amount, 2)
    );
    
    -- Track for gross calculation
    IF v_component_type = 'earning' THEN
      v_gross_earnings := v_gross_earnings + v_prorated_amount;
    END IF;
  END LOOP;
  
  -- Step 4: Calculate overtime (if applicable)
  IF v_ot_hours > 0 THEN
    -- Calculate hourly rate from gross
    -- Hourly rate = (Monthly gross / 208 hours) * 2 (OT multiplier)
    v_ot_amount := (v_gross_earnings / 208) * 2 * v_ot_hours;
    
    v_result := v_result || jsonb_build_object(
      'code', 'OT',
      'name', 'Overtime Pay',
      'type', 'earning',
      'annual_amount', 0,
      'monthly_amount', 0,
      'prorated_amount', ROUND(v_ot_amount, 2),
      'amount', ROUND(v_ot_amount, 2),
      'ot_hours', v_ot_hours
    );
  END IF;
  
  RETURN array_to_json(v_result)::jsonb;
END;
$$;
```

---

### 2.4 fn_apply_compliance

**Purpose:** Calculate statutory deductions and employer contributions

```sql
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
  
  -- Wage calculations
  v_basic numeric := 0;
  v_da numeric := 0;
  v_gross numeric := 0;
  v_pf_wages numeric;
  v_esic_wages numeric;
  
  -- PF calculations
  v_pf_employee numeric := 0;
  v_pf_employer numeric := 0;
  v_pf_ceiling numeric := 15000; -- Current PF wage ceiling
  
  -- ESIC calculations
  v_esic_employee numeric := 0;
  v_esic_employer numeric := 0;
  v_esic_ceiling numeric := 21000; -- Current ESIC wage ceiling
  
  -- PT calculations
  v_pt_amount numeric := 0;
  
  -- TDS
  v_tds_amount numeric := 0;
BEGIN
  -- Step 1: Calculate wages
  FOR v_component IN SELECT * FROM jsonb_array_elements(p_components)
  LOOP
    IF (v_component->>'type')::text = 'earning' THEN
      v_gross := v_gross + (v_component->>'amount')::numeric;
      
      -- Identify Basic and DA for PF wage calculation
      IF UPPER(v_component->>'code') IN ('BASIC', 'BASIC_SALARY') THEN
        v_basic := (v_component->>'amount')::numeric;
      ELSIF UPPER(v_component->>'code') IN ('DA', 'DEARNESS_ALLOWANCE') THEN
        v_da := (v_component->>'amount')::numeric;
      END IF;
    END IF;
  END LOOP;
  
  -- Step 2: Calculate PF wages (Basic + DA, capped at ₹15,000)
  v_pf_wages := LEAST(v_basic + v_da, v_pf_ceiling);
  
  -- PF Employee contribution: 12% of PF wages
  v_pf_employee := ROUND(v_pf_wages * 0.12, 2);
  
  -- PF Employer contribution: 12% of PF wages
  -- (Actually split into EPS 8.33% and EPF 3.67%, but we'll show total)
  v_pf_employer := ROUND(v_pf_wages * 0.12, 2);
  
  -- Step 3: Calculate ESIC (if gross <= ₹21,000)
  IF v_gross <= v_esic_ceiling THEN
    v_esic_wages := v_gross;
    
    -- ESIC Employee: 0.75%
    v_esic_employee := ROUND(v_esic_wages * 0.0075, 2);
    
    -- ESIC Employer: 3.25%
    v_esic_employer := ROUND(v_esic_wages * 0.0325, 2);
  ELSE
    v_esic_wages := 0;
    v_esic_employee := 0;
    v_esic_employer := 0;
  END IF;
  
  -- Step 4: Calculate Professional Tax (state-specific)
  v_pt_amount := fn_calculate_pt(v_gross, p_state);
  
  -- Step 5: Calculate TDS (simplified - actual TDS requires annual projection)
  -- For now, set to 0 unless gross is very high
  IF v_gross > 50000 THEN
    -- This is a placeholder - proper TDS calculation is complex
    v_tds_amount := 0; -- Implement proper TDS logic
  END IF;
  
  -- Step 6: Build result
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

-- Helper function for PT calculation
CREATE OR REPLACE FUNCTION fn_calculate_pt(
  p_gross numeric,
  p_state text
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Maharashtra PT slabs (2025)
  IF p_state = 'Maharashtra' OR p_state = 'MH' THEN
    IF p_gross <= 7500 THEN
      RETURN 0;
    ELSIF p_gross <= 10000 THEN
      RETURN 175;
    ELSE
      RETURN 200;
    END IF;
    
  -- Karnataka PT slabs
  ELSIF p_state = 'Karnataka' OR p_state = 'KA' THEN
    IF p_gross <= 15000 THEN
      RETURN 200;
    ELSE
      RETURN 200; -- Same for all income levels in KA
    END IF;
    
  -- Add more states as needed
  -- Tamil Nadu, Delhi, Gujarat, etc.
  
  ELSE
    -- Default: no PT for unknown states
    RETURN 0;
  END IF;
END;
$$;
```

---

### 2.5 fn_finalize_run

**Purpose:** Generate final payroll run record

```sql
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
  v_components jsonb;
  v_compliance jsonb;
  v_attendance_basis jsonb;
  
  v_snapshot jsonb[] := '{}';
  v_component jsonb;
  
  v_gross_earnings numeric := 0;
  v_total_deductions numeric := 0;
  v_net_pay numeric;
  v_employer_cost numeric;
  
  v_run_id uuid;
BEGIN
  -- Get period details
  SELECT month, year
  INTO v_month, v_year
  FROM payroll_periods
  WHERE id = p_period;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll period % not found', p_period;
  END IF;
  
  -- Step 1: Evaluate components
  v_components := fn_eval_components(p_user, v_month, v_year);
  
  -- Step 2: Apply compliance
  v_compliance := fn_apply_compliance(p_user, v_month, v_year, v_components, p_state);
  
  -- Step 3: Get attendance basis
  v_attendance_basis := fn_resolve_attendance_basis(p_user, v_month, v_year);
  
  -- Step 4: Calculate totals
  FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
  LOOP
    IF (v_component->>'type')::text = 'earning' THEN
      v_gross_earnings := v_gross_earnings + (v_component->>'amount')::numeric;
    ELSIF (v_component->>'type')::text = 'deduction' THEN
      v_total_deductions := v_total_deductions + ABS((v_component->>'amount')::numeric);
    END IF;
  END LOOP;
  
  -- Add statutory deductions
  v_total_deductions := v_total_deductions 
    + (v_compliance->>'pf_employee')::numeric
    + (v_compliance->>'esic_employee')::numeric
    + (v_compliance->>'pt_amount')::numeric
    + (v_compliance->>'tds_amount')::numeric;
  
  -- Calculate net pay
  v_net_pay := v_gross_earnings - v_total_deductions;
  
  -- Calculate employer cost
  v_employer_cost := v_gross_earnings
    + (v_compliance->>'pf_employer')::numeric
    + (v_compliance->>'esic_employer')::numeric;
  
  -- Step 5: Build snapshot
  -- Combine earnings and deductions
  v_snapshot := ARRAY(SELECT * FROM jsonb_array_elements(v_components));
  
  -- Add statutory deductions to snapshot
  v_snapshot := v_snapshot || jsonb_build_object(
    'code', 'PF_EE',
    'name', 'PF Employee',
    'type', 'deduction',
    'amount', -(v_compliance->>'pf_employee')::numeric
  );
  
  IF (v_compliance->>'esic_employee')::numeric > 0 THEN
    v_snapshot := v_snapshot || jsonb_build_object(
      'code', 'ESIC_EE',
      'name', 'ESIC Employee',
      'type', 'deduction',
      'amount', -(v_compliance->>'esic_employee')::numeric
    );
  END IF;
  
  IF (v_compliance->>'pt_amount')::numeric > 0 THEN
    v_snapshot := v_snapshot || jsonb_build_object(
      'code', 'PT',
      'name', 'Professional Tax',
      'type', 'deduction',
      'amount', -(v_compliance->>'pt_amount')::numeric
    );
  END IF;
  
  -- Step 6: Insert payroll run
  INSERT INTO payroll_runs (
    payroll_period_id,
    user_id,
    snapshot,
    gross_earnings,
    total_deductions,
    net_pay,
    employer_cost,
    pf_wages,
    esic_wages,
    pt_amount,
    tds_amount,
    attendance_summary,
    status,
    created_at
  ) VALUES (
    p_period,
    p_user,
    array_to_json(v_snapshot)::jsonb,
    v_gross_earnings,
    v_total_deductions,
    v_net_pay,
    v_employer_cost,
    (v_compliance->>'pf_wages')::numeric,
    (v_compliance->>'esic_wages')::numeric,
    (v_compliance->>'pt_amount')::numeric,
    (v_compliance->>'tds_amount')::numeric,
    v_attendance_basis,
    'processed',
    NOW()
  )
  RETURNING id INTO v_run_id;
  
  RETURN v_run_id;
END;
$$;
```

---

### 2.6 fn_bulk_finalize_period

**Purpose:** Process all employees in a payroll period

```sql
CREATE OR REPLACE FUNCTION fn_bulk_finalize_period(
  p_period uuid,
  p_state text
) RETURNS TABLE (
  user_id uuid,
  run_id uuid,
  status text,
  error_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id uuid;
  v_user record;
  v_run_id uuid;
  v_error_msg text;
BEGIN
  -- Get organization from period
  SELECT organization_id
  INTO v_org_id
  FROM payroll_periods
  WHERE id = p_period;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll period % not found', p_period;
  END IF;
  
  -- Process each user in organization
  FOR v_user IN 
    SELECT DISTINCT u.id
    FROM users u
    WHERE u.organization_id = v_org_id
      AND u.role != 'superadmin' -- Exclude superadmins from payroll
  LOOP
    BEGIN
      -- Try to finalize run for this user
      v_run_id := fn_finalize_run(p_period, v_user.id, p_state);
      
      -- Return success
      RETURN QUERY SELECT v_user.id, v_run_id, 'success'::text, NULL::text;
      
    EXCEPTION WHEN OTHERS THEN
      -- Capture error and continue with next user
      GET STACKED DIAGNOSTICS v_error_msg = MESSAGE_TEXT;
      
      RETURN QUERY SELECT v_user.id, NULL::uuid, 'error'::text, v_error_msg;
    END;
  END LOOP;
END;
$$;
```

---

## 3. Migration Script

```sql
-- Migration: Add missing payroll calculation functions
-- Version: 1.0
-- Date: 2025-11-24

-- Drop existing functions if they exist (for development)
DROP FUNCTION IF EXISTS fn_resolve_attendance_basis(uuid, integer, integer);
DROP FUNCTION IF EXISTS fn_get_active_compensation(uuid, integer, integer);
DROP FUNCTION IF EXISTS fn_eval_components(uuid, integer, integer);
DROP FUNCTION IF EXISTS fn_calculate_pt(numeric, text);
DROP FUNCTION IF EXISTS fn_apply_compliance(uuid, integer, integer, jsonb, text);
DROP FUNCTION IF EXISTS fn_finalize_run(uuid, uuid, text);
DROP FUNCTION IF EXISTS fn_bulk_finalize_period(uuid, text);

-- Create functions (copy from above)
-- [Include all function definitions here]

-- Add missing column to employee_compensation
ALTER TABLE employee_compensation 
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);

-- Backfill organization_id
UPDATE employee_compensation ec
SET organization_id = u.organization_id
FROM users u
WHERE ec.user_id = u.id
  AND ec.organization_id IS NULL;

-- Make it required
ALTER TABLE employee_compensation 
ALTER COLUMN organization_id SET NOT NULL;

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_attendance_org_user_date 
  ON attendance(organization_id, user_id, date);

CREATE INDEX IF NOT EXISTS idx_compensation_user_effective 
  ON employee_compensation(user_id, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_period_user 
  ON payroll_runs(payroll_period_id, user_id);

CREATE INDEX IF NOT EXISTS idx_monthly_overrides_lookup 
  ON attendance_monthly_overrides(organization_id, user_id, month, year);

-- Add unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_period_unique 
  ON payroll_periods(organization_id, month, year);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_run_unique 
  ON payroll_runs(payroll_period_id, user_id)
  WHERE status != 'deleted'; -- Allow re-calculation by deleting old

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION fn_resolve_attendance_basis TO authenticated;
GRANT EXECUTE ON FUNCTION fn_get_active_compensation TO authenticated;
GRANT EXECUTE ON FUNCTION fn_eval_components TO authenticated;
GRANT EXECUTE ON FUNCTION fn_apply_compliance TO authenticated;
GRANT EXECUTE ON FUNCTION fn_finalize_run TO authenticated;
GRANT EXECUTE ON FUNCTION fn_bulk_finalize_period TO authenticated;

COMMENT ON FUNCTION fn_resolve_attendance_basis IS 
'Aggregates daily attendance into monthly summary with LOP, OT, etc.';

COMMENT ON FUNCTION fn_finalize_run IS 
'Generates complete payroll run for a user in a period';
```

---

## 4. Testing Plan

### 4.1 Unit Tests

Test each function independently:

```sql
-- Test 1: fn_resolve_attendance_basis
DO $$
DECLARE
  v_result jsonb;
  v_user_id uuid := 'test-user-uuid';
BEGIN
  -- Setup test data
  INSERT INTO attendance (user_id, organization_id, date, is_absent, is_weekend, is_holiday, effective_hours)
  VALUES 
    (v_user_id, 'test-org-uuid', '2025-11-01', false, false, false, 8),
    (v_user_id, 'test-org-uuid', '2025-11-02', false, true, false, 0), -- Weekend
    (v_user_id, 'test-org-uuid', '2025-11-03', true, false, false, 0); -- Absent (LOP)
  
  -- Execute function
  v_result := fn_resolve_attendance_basis(v_user_id, 11, 2025);
  
  -- Assert results
  ASSERT (v_result->>'present_days')::int = 1, 'Expected 1 present day';
  ASSERT (v_result->>'lop_days')::int = 1, 'Expected 1 LOP day';
  
  -- Cleanup
  DELETE FROM attendance WHERE user_id = v_user_id;
  
  RAISE NOTICE 'Test passed: fn_resolve_attendance_basis';
END $$;
```

### 4.2 Integration Tests

Test complete flow:

```sql
-- Integration Test: Complete payroll calculation
DO $$
DECLARE
  v_period_id uuid;
  v_user_id uuid;
  v_run_id uuid;
BEGIN
  -- Create test period
  INSERT INTO payroll_periods (organization_id, month, year, status)
  VALUES ('test-org-uuid', 11, 2025, 'draft')
  RETURNING id INTO v_period_id;
  
  -- Create test user with compensation
  -- [Setup test user and compensation data]
  
  -- Execute payroll
  v_run_id := fn_finalize_run(v_period_id, v_user_id, 'Maharashtra');
  
  -- Verify results
  ASSERT v_run_id IS NOT NULL, 'Run should be created';
  
  -- Verify payroll_runs record
  PERFORM 1 FROM payroll_runs
  WHERE id = v_run_id
    AND gross_earnings > 0
    AND net_pay > 0;
  
  ASSERT FOUND, 'Payroll run should have valid amounts';
  
  RAISE NOTICE 'Integration test passed';
END $$;
```

---

##5. Edge Cases to Handle

### 5.1 Mid-month Joining
```sql
-- Test: Employee joined on 15th of month
-- Expected: Pro-rated salary from 15th to end of month
```

### 5.2 Mid-month Exit
```sql
-- Test: Employee resigned on 20th
-- Expected: Pro-rated salary until 20th
```

### 5.3 No Compensation Record
```sql
-- Test: User has no active compensation
-- Expected: Raise exception with helpful message
```

### 5.4 No Attendance Data
```sql
-- Test: User has no attendance records for month
-- Expected: Handle gracefully (mark as full LOP or use override)
```

### 5.5 Overlapping Compensation
```sql
-- Test: User has two active compensation records
-- Expected: Use most recent effective_from
```

---

## 6. Performance Considerations

### 6.1 Optimization Strategies

1. **Batch Processing**
   - Use `fn_bulk_finalize_period` for all employees
   - Process in parallel if database supports it

2. **Caching**
   - Cache compliance rules per state
   - Cache pay components definitions

3. **Indexing**
   - Ensure indexes on all foreign keys
   - Add composite indexes on frequently joined columns

4. **Materialized Views**
   - Consider materialized view for attendance aggregation
   - Refresh daily during payroll period

---

## 7. Deployment Checklist

- [ ] All 6 functions created in database
- [ ] Migration script executed successfully
- [ ] Indexes created
- [ ] Unique constraints added
- [ ] Permissions granted (GRANT EXECUTE)
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Edge cases tested
- [ ] Performance tested with sample data
- [ ] Documentation updated
- [ ] Edge function updated to use new functions
- [ ] Frontend tested with real calculations
- [ ] Audit log implemented
- [ ] Rollback plan documented

---

## 8. Rollback Plan

If issues are discovered after deployment:

```sql
-- Rollback: Remove all calculations
DELETE FROM payroll_runs WHERE payroll_period_id = 'period-uuid';

-- Rollback: Drop functions
DROP FUNCTION IF EXISTS fn_finalize_run;
DROP FUNCTION IF EXISTS fn_bulk_finalize_period;
-- ... drop all functions

-- Rollback: Revert schema changes
ALTER TABLE employee_compensation DROP COLUMN IF EXISTS organization_id;

-- Rollback: Remove indexes
DROP INDEX IF EXISTS idx_payroll_run_unique;
-- ... drop all new indexes
```

---

**End of Implementation Guide**

*Implement functions in order: #1 → #2 → #3 → #4 → #5 → #6*
