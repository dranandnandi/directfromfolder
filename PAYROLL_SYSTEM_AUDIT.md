# Payroll System Audit Report
**Date:** November 24, 2025  
**Status:** CRITICAL GAPS IDENTIFIED  
**Auditor:** System Analysis

---

## Executive Summary

### 🚨 CRITICAL FINDINGS

The payroll system has **MAJOR ARCHITECTURAL GAPS** that prevent accurate salary calculation based on attendance data. The system is **NOT PRODUCTION-READY** for payroll processing.

**Severity Level:** **HIGH**  
**Impact**: Payroll calculations cannot be accurately performed  
**Recommendation**: Immediate development required before payroll processing

---

## 1. Missing Core Calculation Engine

### 1.1 Database Functions - **COMPLETELY MISSING**

The edge functions reference database procedures that **DO NOT EXIST**:

#### Missing Functions:
1. **`fn_eval_components`** - Referenced in `payroll-preview-one/index.ts`
   - Purpose: Evaluate compensation components for a user/month/year
   - Status: ❌ NOT FOUND IN MIGRATIONS
   - Impact: Cannot calculate component-wise earnings

2. **`fn_apply_compliance`** - Referenced in `payroll-preview-one/index.ts`
   - Purpose: Apply PF, ESIC, PT, TDS compliance rules
   - Status: ❌ NOT FOUND IN MIGRATIONS
   - Impact: Cannot calculate statutory deductions

3. **`fn_resolve_attendance_basis`** - Referenced in `payroll-preview-one/index.ts`
   - Purpose: Resolve attendance data for payroll calculation
   - Status: ❌ NOT FOUND IN MIGRATIONS
   - Impact: **ATTENDANCE DATA CANNOT BE INTEGRATED INTO SALARY**

4. **`fn_finalize_run`** - Referenced in `payroll-finalize-run/index.ts`
   - Purpose: Finalize payroll run for an employee
   - Status: ❌ NOT FOUND IN MIGRATIONS
   - Impact: Cannot complete payroll processing

### 1.2 Current Implementation Status

**What Works:**
- ✅ Attendance tracking (punch in/out, GPS, selfies)
- ✅ Attendance import from CSV/Excel
- ✅ Employee compensation structure storage
- ✅ Pay component definitions
- ✅ Payroll period management (draft/locked/posted)
- ✅ UI for viewing compensation and attendance

**What's BROKEN:**
- ❌ **Linking attendance to salary calculation**
- ❌ Component-wise salary computation
- ❌ Statutory compliance calculations (PF, ESIC, PT, TDS)
- ❌ Attendance-based pay modifications (LOP, overtime)
- ❌ Actual payroll run generation

---

## 2. Attendance-to-Salary Calculation Gap

### 2.1 Current Attendance Data Structure

The system collects rich attendance data:

```typescript
// FROM: attendance table
{
  date: string,
  punch_in_time, punch_out_time: timestamp,
  total_hours: number,
  effective_hours: number,  // After break deduction
  is_late: boolean,
  is_early_out: boolean,
  is_absent: boolean,
  is_holiday: boolean,
  is_weekend: boolean,
  is_regularized: boolean
}

// FROM: attendance_monthly_overrides
{
  user_id, month, year,
  payload: {
    present_days?: number,
    payable_days?: number,
    lop_days?: number,
    paid_leaves?: number,
    ot_hours?: number,
    late_count?: number
  }
}
```

### 2.2 Expected Salary Calculation Flow

**MISSING IMPLEMENTATION:**

```
Step 1: Get Base Compensation
  ↓
Step 2: Fetch Attendance Summary for Month
  - Present days
  - LOP (Loss of Pay) days
  - Paid leaves
  - Overtime hours
  - Late arrivals
  ↓
Step 3: Calculate Payable Days
  payable_days = working_days - lop_days + paid_leaves
  ↓
Step 4: Pro-rate Earnings
  For each earning component:
    monthly_amount = (annual_amount / 12)
    actual_amount = monthly_amount * (payable_days / expected_working_days)
  ↓
Step 5: Calculate Overtime (if applicable)
  overtime_pay = ot_hours * hourly_rate * multiplier
  ↓
Step 6: Calculate Deductions
  - PF Employee = 12% of (Basic + DA) capped at ₹15,000
  - ESIC Employee = 0.75% of gross (if <= ₹21,000)
  - Professional Tax (state-specific slabs)
  - TDS (if applicable)
  ↓
Step 7: Calculate Employer Costs
  - PF Employer = 12% of (Basic + DA)
  - ESIC Employer = 3.25% of gross
  ↓
Step 8: Generate Payroll Run
  {
    gross_earnings: sum of all earnings,
    total_deductions: sum of all deductions,
    net_pay: gross - deductions,
    employer_cost: sum of employer contributions,
    attendance_summary: { present_days, lop_days, etc },
    snapshot: component-wise breakup
  }
```

**Current Status:** Steps 2-8 are **NOT IMPLEMENTED**

---

## 3. Data Model Analysis

### 3.1 Available Tables

| Table | Purpose | Status | Data Link |
|-------|---------|--------|-----------|
| `attendance` | Daily punch records | ✅ Complete | Not linked to payroll |
| `attendance_monthly_overrides` | Monthly attendance summary | ✅ Complete | **Not used in calculation** |
| `employee_compensation` | CTC structure | ✅ Complete | Not linked to attendance |
| `pay_components` | Component definitions | ✅ Complete | No calc logic |
| `payroll_periods` | Period management | ✅ Complete | No runs generated |
| `payroll_runs` | Salary outputs | ⚠️ Schema only | **Never populated** |
| `compliance_rules` | Statutory rules | ✅ Schema exists | **No evaluation logic** |

### 3.2 Critical Missing Links

#### Gap 1: No Attendance Aggregation Logic
```sql
-- MISSING: Function to aggregate attendance for payroll
CREATE OR REPLACE FUNCTION fn_resolve_attendance_basis(
  p_user uuid,
  p_month integer,
  p_year integer
) RETURNS jsonb AS $$
  -- Should return:
  -- {
  --   "present_days": 22,
  --   "lop_days": 2,
  --   "paid_leaves": 1,
  --   "ot_hours": 10,
  --   "late_count": 3,
  --   "total_effective_hours": 176
  -- }
$$ LANGUAGE plpgsql;
```

#### Gap 2: No Component Evaluation Logic
```sql
-- MISSING: Function to evaluate compensation components
CREATE OR REPLACE FUNCTION fn_eval_components(
  p_user uuid,
  p_month integer,
  p_year integer
) RETURNS jsonb AS $$
  -- Should:
  -- 1. Get active compensation for user
  -- 2. Fetch attendance basis
  -- 3. Pro-rate each component
  -- 4. Apply formulas (e.g., HRA = 40% of Basic)
  -- 5. Return component-wise amounts
$$ LANGUAGE plpgsql;
```

#### Gap 3: No Compliance Calculation Logic
```sql
-- MISSING: Function to apply statutory compliance
CREATE OR REPLACE FUNCTION fn_apply_compliance(
  p_user uuid,
  p_month integer,
  p_year integer,
  p_components jsonb,
  p_state text
) RETURNS jsonb AS $$
  -- Should:
  -- 1. Calculate PF wages (Basic + DA)
  -- 2. Calculate PF employee (12% capped at ₹1,800)
  -- 3. Calculate PF employer (12% + EPS + Admin charges)
  -- 4. Calculate ESIC (if gross <= ₹21,000)
  -- 5. Calculate PT based on state slabs
  -- 6. Calculate TDS projection
$$ LANGUAGE plpgsql;
```

---

## 4. Missing Business Logic

### 4.1 Attendance-Based Pay Rules

**Not Implemented:**
- ✗ Loss of Pay (LOP) calculation
  - Formula: `LOP amount = (Monthly salary / Working days) × LOP days`
- ✗ Overtime calculation
  - Formula: `OT pay = (Hourly rate × OT hours × Multiplier)`
- ✗ Late deduction policies
- ✗ Early departure deductions
- ✗ Weekend/Holiday overtime rules

### 4.2 Pro-ration Logic

**Not Implemented:**
- ✗ Mid-month joining pro-ration
- ✗ Mid-month resignation pro-ration
- ✗ Attendance-based pro-ration
- ✗ Leave without pay handling

### 4.3 Statutory Compliance

**Not Implemented:**
- ✗ PF calculation (employee + employer)
- ✗ ESIC calculation (employee + employer)
- ✗ Professional Tax (state-wise slabs)
- ✗ TDS calculation (if applicable)
- ✗ Wage ceiling checks (PF: ₹15,000, ESIC: ₹21,000)

### 4.4 Component Calculation Methods

**Pay components support calculation methods, but NO ENGINE to execute them:**

- `fixed`: Direct amount
- `percent_of_component`: Calculate based on another component
- `percent_of_gross`: Calculate based on gross salary
- `formula`: Custom formula evaluation

**Current Status:** Definitions exist, NO EVALUATION ENGINE

---

## 5. Frontend vs Backend Disconnect

### 5.1 Frontend Expectations

The UI components **assume** payroll calculations happen:

```typescript
// From PayrollPeriodBoard.tsx
const runsSummary: RunsSummary = {
  total: allRuns.length,
  processed: processedRuns.length,
  finalized: finalizedRuns.length,
  pending: pendingCount,
  avg_net_pay: avgNetPay
};
```

But the **data is NEVER generated** because calculation functions don't exist.

### 5.2 Mock/Placeholder Data

Several components use **placeholder calculations**:

```typescript
// From CompensationEditor.tsx - doPreview()
// CLIENT-SIDE MOCK CALCULATION (not real)
const grossEarnings = previewSnapshot
  .filter(c => c.type === 'earning')
  .reduce((sum, c) => sum + c.amount, 0);
```

This is **NOT** the same as server-side payroll calculation with attendance.

---

## 6. Critical Missing Features

### 6.1 Attendance Integration
- ❌ No function to aggregate daily attendance into monthly summary
- ❌ No logic to apply overrides (from `attendance_monthly_overrides`)
- ❌ No validation of attendance data completeness
- ❌ No handling of incomplete months

### 6.2 Compensation Calculation
- ❌ No engine to evaluate `calc_method` from `pay_components`
- ❌ No support for formula-based components
- ❌ No dependency resolution (e.g., HRA depends on Basic)
- ❌ No validation of component values

### 6.3 Compliance Management
- ❌ No PF/ESIC wage computation
- ❌ No threshold checks (PF ceiling, ESIC eligibility)
- ❌ No state-specific PT slabs
- ❌ No TDS calculation
- ❌ `compliance_rules` table is defined but NEVER USED

### 6.4 Payroll Run Generation
- ❌ No API to generate runs for all employees
- ❌ No bulk calculation capability
- ❌ No validation before finalization
- ❌ `attendance_summary` field in `payroll_runs` is NEVER populated

### 6.5 Error Handling
- ❌ No validation for missing compensation records
- ❌ No validation for missing attendance data
- ❌ No handling of overlapping compensation periods
- ❌ No validation of payroll period status

---

## 7. Recommended Implementation Plan

### Phase 1: Foundation (Week 1-2)
1. **Create `fn_resolve_attendance_basis`**
   - Aggregate daily attendance records
   - Apply monthly overrides
   - Return standardized attendance summary
   
2. **Create `fn_calculate_working_days`**
   - Calculate expected working days for month
   - Exclude weekends and holidays
   - Handle mid-month joins/exits

3. **Create `fn_get_active_compensation`**
   - Fetch effective compensation for user/date
   - Handle overlapping periods
   - Validate data completeness

### Phase 2: Calculation Engine (Week 3-4)
4. **Create `fn_eval_components`**
   - Implement all `calc_method` types
   - Handle component dependencies
   - Apply attendance-based pro-ration
   - Calculate overtime if applicable

5. **Create `fn_calculate_lop`**
   - Compute loss of pay amount
   - Handle different pay schedules (monthly, daily)
   - Apply organization policies

### Phase 3: Compliance (Week 5-6)
6. **Create `fn_apply_compliance`**
   - PF employee/employer calculation
   - ESIC employee/employer calculation
   - Professional Tax (state-wise)
   - TDS projection
   
7. **Create `fn_get_compliance_rules`**
   - Fetch applicable rules for state/date
   - Cache rules for performance
   - Support rule version history

### Phase 4: Payroll Run (Week 7-8)
8. **Create `fn_finalize_run`**
   - Generate payroll_run record
   - Populate all fields (gross, deductions, net, snapshot)
   - Store attendance_summary
   - Update payroll_period status

9. **Create `fn_bulk_calculate_payroll`**
   - Process all employees in a period
   - Parallel processing support
   - Error handling and rollback
   - Audit trail generation

### Phase 5: Validation & Testing (Week 9-10)
10. **Implement validation layer**
    - Pre-calculation checks
    - Post-calculation validation
    - Compliance verification
    - Audit reports

11. **Create test scenarios**
    - Normal month processing
    - Mid-month joins/exits
    - LOP scenarios
    - Overtime scenarios
    - Statutory compliance edge cases

---

## 8. Data Quality Issues

### 8.1 Missing Relationships

**employee_compensation table:**
- ❌ Missing `organization_id` field
  - Cannot filter by organization efficiently
  - Current schema doesn't enforce organization-level security at compensation level

**attendance table:**
- ✅ Has `organization_id`
- ⚠️ But no indexes on (organization_id, user_id, date)

### 8.2 Data Integrity

**No constraints to ensure:**
- One active compensation per user at a time
- Payroll period uniqueness (org + month + year)
- Attendance completeness before payroll
- Shift assignments before attendance

---

## 9. Security Concerns

### 9.1 Row-Level Security (RLS)

**Current Status:**
- ✅ Most tables have RLS enabled (based on PAYROLL_MIGRATION_SUMMARY.md)
- ⚠️ But calculation functions run with `SECURITY DEFINER` privileges (not implemented yet)
- ❌ No RLS policies visible for `payroll_runs`

### 9.2 Audit Trail

**Missing:**
- ❌ No audit log for payroll calculations
- ❌ No change tracking for compensation edits
- ❌ No approval workflow for attendance overrides
- ❌ No version history for payroll runs

---

## 10. Performance Concerns

### 10.1 Bulk Processing

**Current Design Issues:**
- ❌ No batch processing for multiple employees
- ❌ Frontend calls would need to loop (N+1 problem)
- ❌ No parallel processing capability
- ❌ No progress tracking for large organizations

### 10.2 Database Optimization

**Missing Indexes:**
```sql
-- Recommended indexes (NOT CREATED)
CREATE INDEX idx_attendance_org_user_date ON attendance(organization_id, user_id, date);
CREATE INDEX idx_compensation_user_effective ON employee_compensation(user_id, effective_from, effective_to);
CREATE INDEX idx_payroll_runs_period_user ON payroll_runs(payroll_period_id, user_id);
CREATE INDEX idx_monthly_overrides_lookup ON attendance_monthly_overrides(organization_id, user_id, month, year);
```

---

## 11. Testing Gaps

### 11.1 Unit Tests
- ❌ No tests for calculation functions (don't exist)
- ❌ No tests for attendance aggregation
- ❌ No tests for compliance rules

### 11.2 Integration Tests
- ❌ No end-to-end payroll process tests
- ❌ No validation of attendance → salary flow
- ❌ No regression tests

### 11.3 Edge Cases
- ❌ Mid-month joining/exit scenarios untested
- ❌ Leap year handling untested
- ❌ State transitions (draft → locked → posted) untested

---

## 12. Compliance & Legal Risks

### 12.1 Statutory Compliance

**Critical Gaps:**
- ❌ No validation against actual compliance rules
- ❌ PF/ESIC calculations not verified with formulas
- ❌ Professional Tax slabs not implemented
- ❌ No audit trail for statutory calculations

### 12.2 Employee Rights

**Risks:**
- ❌ Incorrect salary calculation due to missing logic
- ❌ No salary slip generation
- ❌ No transparency in deductions
- ❌ No dispute resolution mechanism

---

## 13. Immediate Action Items

### Priority 1 (Critical - Blocking Payroll)
1. ✅ **Implement `fn_resolve_attendance_basis`**
   - Aggregate attendance for a user/month
   - Apply overrides from `attendance_monthly_overrides`
   
2. ✅ **Implement `fn_eval_components`**
   - Calculate component-wise salary
   - Apply attendance-based pro-ration
   
3. ✅ **Implement `fn_apply_compliance`**
   - Calculate PF, ESIC, PT deductions
   - Calculate employer contributions

### Priority 2 (High - Required for Production)
4. ✅ **Implement `fn_finalize_run`**
   - Generate complete payroll run record
   - Populate all required fields
   
5. ✅ **Add organization_id to employee_compensation**
   - Migration required
   - Update all queries
   
6. ✅ **Create database indexes**
   - Performance optimization
   - Query efficiency

### Priority 3 (Medium - Quality & Safety)
7. ✅ **Implement validation layer**
   - Pre-calculation checks
   - Data completeness validation
   
8. ✅ **Add audit logging**
   - Track all calculations
   - Change history
   
9. ✅ **Create test suite**
   - Unit tests for functions
   - Integration tests for flow

---

## 14. Conclusion

### Current State: **NOT PRODUCTION-READY**

The payroll system has:
- ✅ Good data models (tables well-designed)
- ✅ Attendance tracking (works well)
- ✅ Compensation management (UI functional)
- ❌ **ZERO actual payroll calculation capability**
- ❌ **NO attendance-to-salary link**
- ❌ **NO statutory compliance engine**

### Estimated Development Effort
- **Minimum:** 8-10 weeks for complete implementation
- **Team:** 2 backend developers + 1 QA
- **Testing:** Additional 2-3 weeks
- **Total:** ~3 months to production-ready

### Risk Assessment
- **Financial Risk:** HIGH (incorrect salary calculations)
- **Legal Risk:** HIGH (non-compliance with statutory rules)
- **Operational Risk:** HIGH (no fallback mechanism)
- **Reputational Risk:** MEDIUM (employee dissatisfaction)

### Recommendation
**DO NOT process live payroll** until all missing functions are implemented and thoroughly tested. The current system can:
- Track attendance ✅
- Store compensation structures ✅
- Import attendance data ✅

But **CANNOT**:
- Calculate actual salaries ❌
- Apply attendance to pay ❌
- Generate compliant payroll runs ❌

---

**End of Audit Report**

*Next Steps: Review this report with stakeholders and prioritize implementation of missing calculation engine.*
