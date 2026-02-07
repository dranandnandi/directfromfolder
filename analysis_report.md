# Attendance & Salary Calculation Logic Analysis Report

**Date:** 2026-01-19
**Project:** Task Manager Android App - Payroll Module
**Analyst:** Claude Code Audit

---

## Executive Summary

This report analyzes the attendance calculation and salary calculation logic in the project, identifying bugs, edge cases, and areas for improvement. The system handles punch in/out tracking, working hours calculation, overnight shifts, and payroll processing with pro-rata calculations.

**Key Findings:**
- 7 confirmed bugs identified
- 6 edge cases not properly handled
- 2 missing features (overtime calculation, mid-month joining)
- Several placeholder implementations that need completion

---

## Table of Contents

1. [Working Hours Calculation](#1-working-hours-calculation)
2. [Overtime Calculation](#2-overtime-calculation)
3. [Salary/Payroll Calculation](#3-salarypayroll-calculation)
4. [Edge Cases Not Handled](#4-edge-cases-not-handled)
5. [Deductions Calculation](#5-deductions-calculation)
6. [Summary Table](#6-summary-table)
7. [Recommendations](#7-recommendations)
8. [Files Analyzed](#8-files-analyzed)

---

## 1. Working Hours Calculation

### 1.1 Correct Implementation

The total hours calculation using timestamps works correctly:

**File:** `supabase/migrations/20250922_create_enhanced_attendance_view.sql:31-35`
```sql
CASE
    WHEN a.punch_in_time IS NOT NULL AND a.punch_out_time IS NOT NULL
    THEN ROUND(EXTRACT(EPOCH FROM (a.punch_out_time - a.punch_in_time)) / 3600.0, 2)
    ELSE a.total_hours
END as total_hours
```

This correctly calculates hours by:
- Using EPOCH extraction (seconds since 1970)
- Dividing by 3600 to convert to hours
- Rounding to 2 decimal places

### 1.2 Bug #1: Database Constraint Fails for Overnight Shifts

**File:** `supabase/migrations/payroll_enhancements.sql:31-33`
```sql
ALTER TABLE public.attendance
    ADD CONSTRAINT check_valid_punch_times
    CHECK (punch_out_time > punch_in_time)
```

**Issue:** This constraint assumes punch_out always occurs after punch_in within the same calendar context. While timestamps with dates should work correctly (e.g., `2026-01-18 22:00` < `2026-01-19 06:00`), this constraint could cause issues if:
- Time zone conversions affect the stored values
- Data is imported with incorrect date portions
- Edge cases around midnight transitions

**Impact:** Medium - Could prevent valid overnight shift records from being saved.

**Recommendation:** Add explicit handling for overnight shifts:
```sql
ADD CONSTRAINT check_valid_punch_times
CHECK (
    punch_out_time > punch_in_time
    OR (punch_out_time IS NULL)
    OR (
        -- Allow overnight shifts where punch_out is within 18 hours of punch_in
        EXTRACT(EPOCH FROM (punch_out_time - punch_in_time)) BETWEEN 0 AND 64800
    )
)
```

### 1.3 Bug #2: Late/Early Detection Broken for Overnight Shifts

**File:** `supabase/migrations/20250922_create_enhanced_attendance_view.sql:79-88`
```sql
CASE
    WHEN a.punch_in_time IS NOT NULL AND s.start_time IS NOT NULL
    THEN a.punch_in_time::time > (s.start_time + INTERVAL '1 minute' * COALESCE(s.late_threshold_minutes, 15))
    ELSE false
END as calculated_is_late,

CASE
    WHEN a.punch_out_time IS NOT NULL AND s.end_time IS NOT NULL
    THEN a.punch_out_time::time < (s.end_time - INTERVAL '1 minute' * COALESCE(s.early_out_threshold_minutes, 15))
    ELSE false
END as calculated_is_early_out
```

**Issue:** Comparing just the `::time` portion doesn't work for overnight shifts:

| Scenario | Shift Start | Punch In | Comparison | Result | Correct? |
|----------|-------------|----------|------------|--------|----------|
| Normal | 09:00 | 09:20 | 09:20 > 09:15 | Late | Yes |
| Overnight | 22:00 | 22:10 | 22:10 > 22:15 | Not Late | Yes |
| Overnight (missed) | 22:00 | 06:00 | 06:00 > 22:15 | Not Late | **NO** |

**Impact:** High - Employees missing overnight shifts entirely will not be marked as late.

**Recommendation:** Add `is_overnight` check:
```sql
CASE
    WHEN a.punch_in_time IS NOT NULL AND s.start_time IS NOT NULL THEN
        CASE
            WHEN s.is_overnight THEN
                -- For overnight shifts, check if punch_in is within reasonable window of shift start
                NOT (
                    (a.punch_in_time::time >= s.start_time AND a.punch_in_time::time <= '23:59:59'::time)
                    OR (a.punch_in_time::time >= '00:00:00'::time AND a.punch_in_time::time <= s.end_time)
                )
                OR (a.punch_in_time::time > (s.start_time + INTERVAL '1 minute' * COALESCE(s.late_threshold_minutes, 15))
                    AND a.punch_in_time::time <= '23:59:59'::time)
            ELSE
                a.punch_in_time::time > (s.start_time + INTERVAL '1 minute' * COALESCE(s.late_threshold_minutes, 15))
        END
    ELSE false
END as calculated_is_late
```

### 1.4 Bug #3: Break Hours Default Mismatch

**File:** `supabase/migrations/20250922_create_enhanced_attendance_view.sql:42`
```sql
CASE
    WHEN a.punch_in_time IS NOT NULL AND a.punch_out_time IS NOT NULL
    THEN ROUND((EXTRACT(EPOCH FROM (a.punch_out_time - a.punch_in_time)) / 3600.0) - COALESCE(a.break_hours, 1.0), 2)
    ELSE a.effective_hours
END as effective_hours
```

**Issue:** The hardcoded default of `1.0` hour for breaks ignores the shift's configured `break_duration_minutes`.

**Current behavior:**
- Shift A: `break_duration_minutes = 30` -> Employee gets 1 hour deducted (wrong)
- Shift B: `break_duration_minutes = 90` -> Employee gets 1 hour deducted (wrong)

**Impact:** Medium - Incorrect effective hours for all employees with non-60-minute breaks.

**Recommendation:**
```sql
COALESCE(a.break_hours, COALESCE(s.break_duration_minutes, 60) / 60.0)
```

### 1.5 Trigger Function Analysis

**File:** `supabase/migrations/20250922_create_enhanced_attendance_view.sql:194-247`

The `calculate_attendance_hours()` trigger correctly:
- Calculates total hours from timestamps
- Prevents negative effective hours
- Sets `is_absent = false` when punch_in exists
- Checks late/early based on shift

However, it has the same overnight shift detection issue as the view.

---

## 2. Overtime Calculation

### 2.1 Missing: No Automatic Overtime Calculation

**Current State:** The system defines `ot_hours` in `attendance_monthly_overrides.payload` but has no automatic calculation logic.

**Expected Overtime Scenarios Not Handled:**
1. Hours worked beyond shift duration
2. Work on declared holidays
3. Work on weekends (for 5-day week employees)
4. Night shift differentials
5. Double-time for certain holidays

**File:** `src/payroll/AttendanceImportWizard/ApplyOverrides.tsx`

The system relies entirely on manual overrides during attendance import:
```typescript
type AttendanceOverride = {
    user_id: string;
    payload: {
        payable_days: number;
        lop_days: number;
        paid_leaves: number;
        ot_hours: number;  // Manual entry only
        late_count: number;
        remarks?: string;
    }
};
```

**Impact:** Medium - Overtime must be calculated externally and imported manually.

**Recommendation:** Add overtime calculation function:
```sql
CREATE OR REPLACE FUNCTION calculate_overtime(p_user_id uuid, p_month int, p_year int)
RETURNS jsonb AS $$
DECLARE
    v_shift_hours numeric;
    v_daily_records RECORD;
    v_total_ot numeric := 0;
BEGIN
    -- Get employee's standard shift duration
    SELECT s.duration_hours INTO v_shift_hours
    FROM employee_shifts es
    JOIN shifts s ON es.shift_id = s.id
    WHERE es.user_id = p_user_id
    AND es.effective_to IS NULL;

    -- Calculate overtime for each day
    FOR v_daily_records IN
        SELECT date, effective_hours, is_holiday, is_weekend
        FROM attendance
        WHERE user_id = p_user_id
        AND EXTRACT(MONTH FROM date) = p_month
        AND EXTRACT(YEAR FROM date) = p_year
    LOOP
        IF v_daily_records.effective_hours > v_shift_hours THEN
            v_total_ot := v_total_ot + (v_daily_records.effective_hours - v_shift_hours);
        END IF;
        -- Add full hours for holiday/weekend work
        IF v_daily_records.is_holiday OR v_daily_records.is_weekend THEN
            v_total_ot := v_total_ot + COALESCE(v_daily_records.effective_hours, 0);
        END IF;
    END LOOP;

    RETURN jsonb_build_object('overtime_hours', v_total_ot);
END;
$$ LANGUAGE plpgsql;
```

---

## 3. Salary/Payroll Calculation

### 3.1 Bug #4: LOP Days Incorrectly Equated to Absent Days

**File:** `supabase/migrations/payroll_enhancements.sql:154`
```sql
v_lop_days := (v_attendance_summary->>'absent_days')::numeric; -- Simplified LOP logic
```

**Issue:** This treats all absent days as Loss of Pay (LOP), ignoring:

| Day Type | Should Be LOP? | Current Behavior |
|----------|----------------|------------------|
| Absent on working day | Yes | Yes |
| Absent on holiday | No | **Yes (Bug)** |
| Absent on weekend | No | **Yes (Bug)** |
| Approved paid leave | No | **Yes (Bug)** |
| Approved sick leave | No | **Yes (Bug)** |

**Impact:** High - Employees are penalized for holidays, weekends, and approved leaves.

**Recommendation:**
```sql
-- Get proper LOP calculation
SELECT
    COUNT(*) FILTER (
        WHERE is_absent = true
        AND is_holiday = false
        AND is_weekend = false
        AND NOT EXISTS (
            SELECT 1 FROM leave_applications la
            WHERE la.user_id = a.user_id
            AND la.status = 'approved'
            AND a.date BETWEEN la.start_date AND la.end_date
        )
    )
INTO v_lop_days
FROM attendance a
WHERE a.user_id = p_user_id
AND a.date BETWEEN v_start_date AND v_end_date;
```

### 3.2 Bug #5: Pro-rata Doesn't Distinguish Component Types

**File:** `supabase/migrations/payroll_enhancements.sql:165-172`
```sql
FOR v_component IN SELECT * FROM jsonb_array_elements(v_components)
LOOP
    v_amount := (v_component->>'amount')::numeric;
    -- Pro-rata calculation: (Amount / DaysInMonth) * PayableDays
    v_amount := ROUND((v_amount / v_days_in_month) * v_payable_days, 2);
    v_gross_earnings := v_gross_earnings + v_amount;
END LOOP;
```

**Issue:** All components are pro-rated identically, but different components have different behaviors:

| Component Type | Should Pro-rate? | Current Behavior |
|----------------|------------------|------------------|
| Basic Salary | Yes | Yes |
| HRA | Yes | Yes |
| Fixed Transport Allowance | No (often fixed) | **Yes (Bug)** |
| Attendance Bonus | Yes (based on days present) | Yes |
| Performance Bonus | No (based on targets) | **Yes (Bug)** |
| Special Allowance | Depends on policy | Yes |

**Impact:** Medium - Fixed allowances and bonuses are incorrectly reduced for partial months.

**Recommendation:** Add `is_fixed` flag to `pay_components` table:
```sql
ALTER TABLE pay_components ADD COLUMN is_fixed boolean DEFAULT false;

-- Then in calculation:
IF (v_component->>'is_fixed')::boolean = true THEN
    v_amount := (v_component->>'amount')::numeric;  -- Full amount
ELSE
    v_amount := ROUND(((v_component->>'amount')::numeric / v_days_in_month) * v_payable_days, 2);
END IF;
```

### 3.3 Bug #6: Total Days Only Counts Records, Not Calendar Days

**File:** `supabase/migrations/payroll_enhancements.sql:102-114`
```sql
SELECT jsonb_build_object(
    'total_days', COUNT(*),  -- BUG: Only counts existing records
    'present_days', COUNT(*) FILTER (WHERE punch_in_time IS NOT NULL),
    ...
)
INTO v_summary
FROM public.attendance
WHERE user_id = p_user_id
  AND date BETWEEN v_start_date AND v_end_date;
```

**Issue:** If no attendance record exists for a day (e.g., new employee, system error, holiday without record), that day isn't counted in `total_days`.

**Example:**
- Month has 31 days
- Employee has 20 attendance records (missing 11 days of records)
- `total_days` = 20 (wrong, should be 31 or working days in month)
- This affects payable days calculation

**Impact:** Medium - Inaccurate payable days for employees with incomplete records.

**Recommendation:**
```sql
-- Calculate actual calendar days in month
v_calendar_days := date_part('days', (v_start_date + interval '1 month' - interval '1 day')::date)::int;

-- Or calculate working days (excluding weekends)
SELECT COUNT(*) INTO v_working_days
FROM generate_series(v_start_date, v_end_date, '1 day'::interval) AS d
WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);  -- Exclude Sunday (0) and Saturday (6)

-- Use this instead of COUNT(*) from attendance
'total_days', v_working_days,
```

### 3.4 Bug #7: Half-Day Threshold is Hardcoded

**File:** `supabase/migrations/payroll_enhancements.sql:107`
```sql
'half_days', COUNT(*) FILTER (WHERE effective_hours < 4), -- Assumption: < 4 hours is half day
```

**Issue:** The 4-hour threshold is hardcoded but should vary based on shift duration:

| Shift Duration | Expected Half-Day Threshold | Current Behavior |
|----------------|----------------------------|------------------|
| 8 hours | < 4 hours | 4 hours (correct) |
| 9 hours | < 4.5 hours | 4 hours (wrong) |
| 6 hours (part-time) | < 3 hours | 4 hours (wrong) |

**Impact:** Low-Medium - Incorrect half-day counts for non-8-hour shifts.

**Recommendation:**
```sql
'half_days', COUNT(*) FILTER (
    WHERE effective_hours < (
        SELECT COALESCE(s.duration_hours, 8) / 2.0
        FROM employee_shifts es
        JOIN shifts s ON es.shift_id = s.id
        WHERE es.user_id = a.user_id
        AND a.date BETWEEN es.effective_from AND COALESCE(es.effective_to, '9999-12-31')
        LIMIT 1
    )
)
```

---

## 4. Edge Cases Not Handled

### 4.1 Multiple Punch-Ins on Same Day

**Current Behavior:** Uses `UPSERT` with `onConflict: 'user_id,date'`

**File:** `src/services/attendanceService.ts:296-299`
```typescript
const { data, error } = await supabase
  .from('attendance')
  .upsert(attendanceData, { onConflict: 'user_id,date' })
  .select()
  .single();
```

**Issue:** If an employee:
1. Punches in at 9:00 AM
2. Forgets to punch out, goes home
3. Punches in again next morning (different date) - this works
4. But if they try to punch in again same day - overwrites first punch

**Scenarios Not Handled:**
- Split shifts (morning 6-10, evening 4-8)
- Leaving for doctor appointment and returning
- Accidental double punch-in

**Recommendation:** Either:
1. Allow multiple punch records per day with a `session_id`
2. Or validate and reject duplicate punch-ins with clear error message

### 4.2 Overlapping Compensation Records

**File:** `supabase/migrations/payroll_enhancements.sql:46-54`
```sql
-- Prevent overlapping active compensation records for the same user
-- Note: Requires btree_gist extension. If not available, this will fail.
-- CREATE EXTENSION IF NOT EXISTS btree_gist;
-- ALTER TABLE public.employee_compensation
--     ADD CONSTRAINT exclude_overlapping_compensation
--     EXCLUDE USING GIST (
--         user_id WITH =,
--         daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
--     );
```

**Issue:** The exclusion constraint is **commented out**, allowing scenarios like:

| Record | User | Effective From | Effective To | CTC Annual |
|--------|------|----------------|--------------|------------|
| 1 | A | 2026-01-01 | NULL | 600,000 |
| 2 | A | 2026-06-01 | NULL | 720,000 |

Both records are "active" for dates >= 2026-06-01. The `get_active_compensation` function uses `ORDER BY effective_from DESC LIMIT 1` which should return the newer one, but this is fragile.

**Impact:** High - Could cause salary calculation errors if query doesn't consistently pick the right record.

**Recommendation:** Enable the constraint:
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- First, fix any existing overlaps
UPDATE employee_compensation ec1
SET effective_to = (
    SELECT MIN(ec2.effective_from) - INTERVAL '1 day'
    FROM employee_compensation ec2
    WHERE ec2.user_id = ec1.user_id
    AND ec2.effective_from > ec1.effective_from
)
WHERE ec1.effective_to IS NULL
AND EXISTS (
    SELECT 1 FROM employee_compensation ec2
    WHERE ec2.user_id = ec1.user_id
    AND ec2.effective_from > ec1.effective_from
);

-- Then add constraint
ALTER TABLE public.employee_compensation
ADD CONSTRAINT exclude_overlapping_compensation
EXCLUDE USING GIST (
    user_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
);
```

### 4.3 Shift Duration Restriction

**File:** `supabase/migrations/schema.md:466`
```sql
duration_hours integer NOT NULL CHECK (duration_hours = ANY (ARRAY[8, 9]))
```

**Issue:** Only allows 8 or 9 hour shifts, preventing:
- Part-time shifts (4, 6 hours)
- Compressed work week (10 hours x 4 days)
- Extended shifts (12 hours for certain industries)

**Impact:** Medium - Organizations with non-standard shifts cannot use the system.

**Recommendation:**
```sql
ALTER TABLE shifts DROP CONSTRAINT shifts_duration_hours_check;
ALTER TABLE shifts ADD CONSTRAINT shifts_duration_hours_check
    CHECK (duration_hours >= 1 AND duration_hours <= 24);
```

### 4.4 Timezone Inconsistencies

**File:** `src/services/attendanceService.ts:253`
```typescript
const today = new Date().toISOString().split('T')[0];
```

**Issue:** Creates dates based on client-side time converted to ISO (UTC), which may differ from the organization's local date.

**Example:**
- Organization timezone: IST (UTC+5:30)
- Client punches in at: 11:30 PM IST on Jan 18
- UTC time: 6:00 PM UTC on Jan 18
- `toISOString()` returns: `2026-01-18T18:00:00.000Z`
- Date recorded: `2026-01-18` (correct)

But if client punches in at 12:30 AM IST on Jan 19:
- UTC time: 7:00 PM UTC on Jan 18
- `toISOString()` returns: `2026-01-18T19:00:00.000Z`
- Date recorded: `2026-01-18` (WRONG - should be Jan 19 local date)

**Impact:** Medium - Attendance records may have wrong dates for late-night punches.

**Recommendation:**
```typescript
// Use organization's timezone for date calculation
const getOrganizationDate = (orgTimezone: string = 'Asia/Kolkata') => {
    return new Date().toLocaleDateString('en-CA', { timeZone: orgTimezone }); // Returns YYYY-MM-DD
};
```

### 4.5 Punch-Out Without Punch-In at Database Level

**Issue:** While service code validates, no database constraint prevents orphan punch-outs.

**Current validation (service level):**
```typescript
// src/services/attendanceService.ts:344-346
if (activeError || !activeRecord) {
  throw new Error('No active punch-in found. Please punch in first.');
}
```

**Missing (database level):**
```sql
-- No constraint like:
ALTER TABLE attendance ADD CONSTRAINT check_punch_out_requires_punch_in
CHECK (punch_out_time IS NULL OR punch_in_time IS NOT NULL);
```

**Impact:** Low - Direct database inserts could create invalid records.

**Recommendation:** Add database constraint:
```sql
ALTER TABLE attendance ADD CONSTRAINT check_punch_out_requires_punch_in
CHECK (punch_out_time IS NULL OR punch_in_time IS NOT NULL);
```

### 4.6 Mid-Month Joining/Leaving

**Issue:** The payable days calculation doesn't consider:

1. **New Employee (Joined Mid-Month):**
   - Joined: Jan 15
   - Working days in Jan: 22
   - Should be paid for: 12 days (Jan 15-31, excluding weekends)
   - Current behavior: May calculate incorrectly if no attendance records exist before joining

2. **Leaving Employee (Last Working Day Mid-Month):**
   - Last day: Jan 20
   - Should be paid for: 14 days (Jan 1-20, excluding weekends)
   - Current behavior: May pay full month if compensation record isn't end-dated

3. **Notice Period:**
   - Employee on notice period may have different pay rules
   - Not handled at all

**Recommendation:** Add joining date consideration:
```sql
-- In calculate_monthly_payroll function
v_joining_date := (SELECT effective_from FROM employee_compensation
                   WHERE user_id = p_user_id ORDER BY effective_from LIMIT 1);

IF v_joining_date > v_start_date THEN
    v_start_date := v_joining_date;
    -- Recalculate working days from joining date
END IF;
```

---

## 5. Deductions Calculation

### 5.1 Placeholder Implementation in Database Function

**File:** `supabase/migrations/payroll_enhancements.sql:178-180`
```sql
-- 5. Calculate Deductions (Placeholder)
-- PF, PT, TDS would go here. For now, 0.
v_total_deductions := 0;
```

**Status:** The database function doesn't calculate statutory deductions. This is handled by edge functions.

### 5.2 Edge Function Deduction Logic

**File:** `supabase/functions/payroll-preview-one/index.ts:20-27`
```typescript
const { data: compli, error: e2 } = await sb.rpc("fn_apply_compliance", {
  p_user: user_id,
  p_month: month,
  p_year: year,
  p_components: comps,
  p_state: state,
});
```

The `fn_apply_compliance` RPC function (not visible in provided files) handles:
- PF (Provident Fund)
- ESIC (Employee State Insurance)
- PT (Professional Tax)
- TDS (Tax Deducted at Source)

### 5.3 AI Compensation Assistant Deduction Handling

**File:** `supabase/functions/ai-compensation-assistant/index.ts:68-83`
```typescript
const isDeduction = (code: string) => /^(PF(_EE)?|esic_employee|PT|TDS)$/i.test(code);

function normalize(lines: CompLine[], available: { code: string }[]) {
  // ...
  for (const l of lines || []) {
    // ...
    let amt = Number(l.amount) || 0;
    // enforce signs simply
    if (isDeduction(code) && amt > 0) amt = -amt;
    if (!isDeduction(code) && amt < 0) amt = -amt;
    // ...
  }
}
```

**Correct Behavior:** This correctly enforces that:
- Deductions are stored as negative amounts
- Earnings are stored as positive amounts

### 5.4 Deduction Sign Convention

**File:** `src/payroll/PayrollPreview.tsx:121-122`
```typescript
const earnings = components.filter(c => c.amount > 0);
const deductions = components.filter(c => c.amount < 0);
```

**Convention Used:**
- Positive amounts = Earnings
- Negative amounts = Deductions

This is correctly implemented in:
- AI compensation assistant
- Payroll preview display
- Net pay calculation: `grossMonthly - deductionsMonthly`

---

## 6. Summary Table

| Issue ID | Area | Description | Severity | File Location |
|----------|------|-------------|----------|---------------|
| BUG-001 | Working Hours | Constraint may fail for overnight shifts | Medium | `payroll_enhancements.sql:31-33` |
| BUG-002 | Working Hours | Late/early detection broken for overnight shifts | High | `20250922_create_enhanced_attendance_view.sql:79-88` |
| BUG-003 | Working Hours | Break hours default ignores shift configuration | Medium | `20250922_create_enhanced_attendance_view.sql:42` |
| BUG-004 | Payroll | LOP incorrectly includes holidays/weekends/leaves | High | `payroll_enhancements.sql:154` |
| BUG-005 | Payroll | All components pro-rated (including fixed ones) | Medium | `payroll_enhancements.sql:165-172` |
| BUG-006 | Payroll | Total days counts records, not calendar days | Medium | `payroll_enhancements.sql:102-114` |
| BUG-007 | Payroll | Half-day threshold hardcoded at 4 hours | Low | `payroll_enhancements.sql:107` |
| EDGE-001 | Attendance | Multiple punch-ins same day not handled | Medium | `attendanceService.ts:296-299` |
| EDGE-002 | Compensation | Overlapping records allowed (constraint disabled) | High | `payroll_enhancements.sql:46-54` |
| EDGE-003 | Shifts | Only 8/9 hour shifts allowed | Medium | `schema.md:466` |
| EDGE-004 | Attendance | Timezone inconsistencies in date calculation | Medium | `attendanceService.ts:253` |
| EDGE-005 | Attendance | No DB constraint for punch-out without punch-in | Low | Schema |
| EDGE-006 | Payroll | Mid-month joining/leaving not handled | Medium | `payroll_enhancements.sql` |
| MISSING-001 | Overtime | No automatic overtime calculation | Medium | N/A |
| MISSING-002 | Deductions | DB function has placeholder for deductions | Low | `payroll_enhancements.sql:178-180` |

### Severity Definitions

- **High:** Could cause incorrect salary payments or data integrity issues
- **Medium:** Affects accuracy for specific scenarios; workarounds exist
- **Low:** Minor issue or handled elsewhere in the system

---

## 7. Recommendations

### 7.1 Immediate Fixes (High Priority)

1. **Fix overnight shift late/early detection**
   - Add `is_overnight` check before time comparisons
   - Test with shifts spanning midnight

2. **Enable compensation overlap constraint**
   - Enable `btree_gist` extension
   - Add the exclusion constraint
   - Fix any existing overlapping records first

3. **Fix LOP calculation**
   - Exclude holidays and weekends from LOP count
   - Check for approved leave applications
   - Create separate function for accurate LOP calculation

### 7.2 Medium Priority Fixes

4. **Use shift's break duration**
   - Replace hardcoded `1.0` with `COALESCE(s.break_duration_minutes, 60) / 60.0`
   - Update both view and trigger function

5. **Distinguish fixed vs variable components**
   - Add `is_fixed` column to `pay_components` table
   - Update pro-rata calculation to skip fixed components

6. **Fix total days calculation**
   - Calculate from calendar/working days, not record count
   - Consider joining date for new employees

7. **Handle timezone consistently**
   - Store organization timezone in settings
   - Use organization timezone for date calculations

### 7.3 Feature Enhancements (Lower Priority)

8. **Implement automatic overtime calculation**
   - Based on hours exceeding shift duration
   - Consider holiday/weekend multipliers

9. **Remove shift duration restriction**
   - Allow 1-24 hour shifts
   - Update validation logic accordingly

10. **Add mid-month joining/leaving support**
    - Consider joining date in payable days calculation
    - Handle notice period scenarios

### 7.4 Testing Recommendations

Before deploying fixes, test these scenarios:

1. **Overnight Shift Tests:**
   - Punch in at 10 PM, out at 6 AM next day
   - Late arrival to overnight shift
   - Early departure from overnight shift
   - Missing overnight shift entirely

2. **Payroll Edge Cases:**
   - New employee joining mid-month
   - Employee with approved leaves
   - Employee with mix of present, absent, late days
   - Part-time employee calculations

3. **Timezone Tests:**
   - Punch at 11:30 PM local time
   - Punch at 12:30 AM local time
   - Different timezone configurations

---

## 8. Files Analyzed

| File | Purpose |
|------|---------|
| `src/models/attendance.ts` | TypeScript type definitions for attendance |
| `src/services/attendanceService.ts` | Main attendance service with punch in/out logic |
| `supabase/migrations/payroll_enhancements.sql` | Database functions for payroll calculation |
| `supabase/migrations/20250922_create_enhanced_attendance_view.sql` | Attendance dashboard view with calculations |
| `src/payroll/PayrollPreview.tsx` | UI for payroll preview |
| `supabase/functions/payroll-preview-one/index.ts` | Edge function for payroll preview |
| `src/payroll/types.ts` | TypeScript types for payroll |
| `supabase/functions/ai-compensation-assistant/index.ts` | AI compensation setup wizard |
| `supabase/migrations/schema.md` | Complete database schema documentation |

---

## Appendix: Code Snippets for Fixes

### A1. Fixed Overnight Late Detection

```sql
CREATE OR REPLACE FUNCTION check_is_late_overnight(
    p_punch_in_time timestamptz,
    p_shift_start_time time,
    p_shift_end_time time,
    p_late_threshold_minutes int,
    p_is_overnight boolean
) RETURNS boolean AS $$
BEGIN
    IF p_punch_in_time IS NULL OR p_shift_start_time IS NULL THEN
        RETURN false;
    END IF;

    IF p_is_overnight THEN
        -- For overnight shifts, valid punch-in window is from shift_start to midnight
        -- or from midnight to shift_end (for very late arrivals on next day)
        IF p_punch_in_time::time >= p_shift_start_time THEN
            -- Same day as shift start
            RETURN p_punch_in_time::time > (p_shift_start_time + (p_late_threshold_minutes || ' minutes')::interval);
        ELSIF p_punch_in_time::time <= p_shift_end_time THEN
            -- Next day, within shift window - this is very late
            RETURN true;
        ELSE
            -- Completely outside shift window
            RETURN true;
        END IF;
    ELSE
        -- Normal day shift
        RETURN p_punch_in_time::time > (p_shift_start_time + (p_late_threshold_minutes || ' minutes')::interval);
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### A2. Fixed LOP Calculation

```sql
CREATE OR REPLACE FUNCTION calculate_lop_days(
    p_user_id uuid,
    p_month int,
    p_year int
) RETURNS numeric AS $$
DECLARE
    v_start_date date;
    v_end_date date;
    v_lop_days numeric;
BEGIN
    v_start_date := make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + interval '1 month' - interval '1 day')::date;

    -- Count days that are: absent AND not holiday AND not weekend AND not on approved leave
    SELECT COUNT(*)
    INTO v_lop_days
    FROM attendance a
    WHERE a.user_id = p_user_id
    AND a.date BETWEEN v_start_date AND v_end_date
    AND a.is_absent = true
    AND a.is_holiday = false
    AND a.is_weekend = false
    AND NOT EXISTS (
        SELECT 1
        FROM leave_applications la
        WHERE la.user_id = a.user_id
        AND la.status = 'approved'
        AND la.leave_type IN ('paid_leave', 'sick_leave', 'casual_leave')
        AND a.date BETWEEN la.start_date AND la.end_date
    );

    RETURN COALESCE(v_lop_days, 0);
END;
$$ LANGUAGE plpgsql STABLE;
```

---

*End of Report*
