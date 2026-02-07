-- Payroll System Enhancements Migration
-- Created based on comprehensive audit recommendations

-- ============================================================================
-- 1. Performance Indexes
-- ============================================================================

-- Attendance Lookups
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON public.attendance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_org_date ON public.attendance(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_shift_id ON public.attendance(shift_id);

-- Payroll Processing Lookups
CREATE INDEX IF NOT EXISTS idx_payroll_runs_period_user ON public.payroll_runs(payroll_period_id, user_id);
CREATE INDEX IF NOT EXISTS idx_employee_compensation_user_effective ON public.employee_compensation(user_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_user_effective ON public.employee_shifts(user_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_statutory_filings_period_type ON public.statutory_filings(payroll_period_id, filing_type);

-- Batch Processing
CREATE INDEX IF NOT EXISTS idx_attendance_import_rows_batch_id ON public.attendance_import_rows(batch_id);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read);


-- ============================================================================
-- 2. Data Integrity Constraints
-- ============================================================================

-- Attendance Validity
ALTER TABLE public.attendance
    ADD CONSTRAINT check_valid_punch_times 
    CHECK (punch_out_time > punch_in_time),
    
    ADD CONSTRAINT check_positive_break 
    CHECK (break_hours >= 0);

-- Compensation Validity
ALTER TABLE public.employee_compensation
    ADD CONSTRAINT check_positive_ctc 
    CHECK (ctc_annual > 0),
    
    ADD CONSTRAINT check_valid_dates 
    CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- Prevent overlapping active compensation records for the same user
-- Note: Requires btree_gist extension. If not available, this will fail.
-- CREATE EXTENSION IF NOT EXISTS btree_gist;
-- ALTER TABLE public.employee_compensation
--     ADD CONSTRAINT exclude_overlapping_compensation
--     EXCLUDE USING GIST (
--         user_id WITH =,
--         daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
--     );

-- Payroll Processing Safety
ALTER TABLE public.payroll_runs
    ADD CONSTRAINT unique_payroll_run_per_period_user 
    UNIQUE (payroll_period_id, user_id);


-- ============================================================================
-- 3. Database Functions for Payroll Logic
-- ============================================================================

-- Helper: Get active compensation for a specific date
CREATE OR REPLACE FUNCTION public.get_active_compensation(p_user_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_comp_record jsonb;
BEGIN
    SELECT to_jsonb(ec.*)
    INTO v_comp_record
    FROM public.employee_compensation ec
    WHERE ec.user_id = p_user_id
      AND ec.effective_from <= p_date
      AND (ec.effective_to IS NULL OR ec.effective_to >= p_date)
    ORDER BY ec.effective_from DESC
    LIMIT 1;
    
    RETURN v_comp_record;
END;
$$;

-- Helper: Calculate Attendance Summary for a Month
CREATE OR REPLACE FUNCTION public.calculate_attendance_summary(p_user_id uuid, p_month int, p_year int)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_start_date date;
    v_end_date date;
    v_summary jsonb;
BEGIN
    v_start_date := make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + interval '1 month' - interval '1 day')::date;

    SELECT jsonb_build_object(
        'total_days', COUNT(*),
        'present_days', COUNT(*) FILTER (WHERE punch_in_time IS NOT NULL),
        'absent_days', COUNT(*) FILTER (WHERE is_absent = true),
        'late_days', COUNT(*) FILTER (WHERE is_late = true),
        'half_days', COUNT(*) FILTER (WHERE effective_hours < 4), -- Assumption: < 4 hours is half day
        'total_effective_hours', COALESCE(SUM(effective_hours), 0),
        'avg_hours_per_day', CASE WHEN COUNT(*) > 0 THEN ROUND((SUM(effective_hours) / COUNT(*))::numeric, 2) ELSE 0 END
    )
    INTO v_summary
    FROM public.attendance
    WHERE user_id = p_user_id
      AND date BETWEEN v_start_date AND v_end_date;

    RETURN v_summary;
END;
$$;

-- Core: Calculate Monthly Payroll (Draft)
-- This function estimates the payroll based on attendance and compensation.
-- It does NOT write to payroll_runs, but returns the calculated structure.
CREATE OR REPLACE FUNCTION public.calculate_monthly_payroll(p_user_id uuid, p_month int, p_year int)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_comp_record jsonb;
    v_attendance_summary jsonb;
    v_ctc_monthly numeric;
    v_gross_earnings numeric := 0;
    v_total_deductions numeric := 0;
    v_net_pay numeric := 0;
    v_components jsonb;
    v_component jsonb;
    v_amount numeric;
    v_days_in_month int;
    v_payable_days numeric;
    v_lop_days numeric;
BEGIN
    -- 1. Get Compensation
    v_comp_record := public.get_active_compensation(p_user_id, make_date(p_year, p_month, 1));
    
    IF v_comp_record IS NULL THEN
        RETURN jsonb_build_object('error', 'No active compensation found');
    END IF;

    -- 2. Get Attendance
    v_attendance_summary := public.calculate_attendance_summary(p_user_id, p_month, p_year);
    
    -- 3. Calculate Payable Days
    v_days_in_month := date_part('days', (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date)::int;
    v_lop_days := (v_attendance_summary->>'absent_days')::numeric; -- Simplified LOP logic
    v_payable_days := v_days_in_month - v_lop_days;

    -- 4. Calculate Earnings
    -- Assuming monthly schedule for simplicity
    v_ctc_monthly := (v_comp_record->>'ctc_annual')::numeric / 12;
    v_components := v_comp_record->'compensation_payload'->'components';
    
    -- Iterate through components (simplified: pro-rata based on payable days)
    -- In a real system, this would need complex logic for fixed vs variable components
    IF v_components IS NOT NULL THEN
        FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
        LOOP
            v_amount := (v_component->>'amount')::numeric;
            -- Pro-rata calculation: (Amount / DaysInMonth) * PayableDays
            v_amount := ROUND((v_amount / v_days_in_month) * v_payable_days, 2);
            
            v_gross_earnings := v_gross_earnings + v_amount;
        END LOOP;
    ELSE
        -- Fallback if no components defined, just use CTC monthly pro-rata
        v_gross_earnings := ROUND((v_ctc_monthly / v_days_in_month) * v_payable_days, 2);
    END IF;

    -- 5. Calculate Deductions (Placeholder)
    -- PF, PT, TDS would go here. For now, 0.
    v_total_deductions := 0;

    -- 6. Net Pay
    v_net_pay := v_gross_earnings - v_total_deductions;

    RETURN jsonb_build_object(
        'user_id', p_user_id,
        'month', p_month,
        'year', p_year,
        'payable_days', v_payable_days,
        'lop_days', v_lop_days,
        'gross_earnings', v_gross_earnings,
        'total_deductions', v_total_deductions,
        'net_pay', v_net_pay,
        'attendance_summary', v_attendance_summary
    );
END;
$$;
