# AI-Native Attendance, Shift Configurator, and Payroll Automation Blueprint

## 1) Current State (from latest schema + code)

### Attendance and shift today
- `attendance` stores raw punch data, geofence checks, and derived flags (`is_late`, `is_holiday`, `is_weekend`, etc.).
- `shifts` defines static shift rules (`start_time`, `end_time`, late/early thresholds).
- `employee_shifts` maps users to shifts with effective dates.
- `attendance_dashboard_view` computes attendance status and punctuality using shift thresholds.

### Override-heavy areas (old-school pattern)
- `attendance_monthly_overrides.payload` stores manual monthly corrections.
- `employee_pay_overrides.override_payload` stores manual pay adjustments.
- `ApplyOverrides.tsx` currently drives manual editing/saving of these payloads.
- `ai-attendance-import-validate-apply` function still writes override payloads in a traditional monthly model.

### Gap
- Logic is mostly rule-by-column + manual correction, not policy-driven or conversational.
- No canonical AI instruction layer for reusable org policy.
- No scheduled AI pass that re-evaluates special overrides weekly with controlled precedence.

## 2) Target Product Goal
Enable SMB organizations to run attendance + shift + payroll logic from plain voice instructions, with AI safely compiling them into governed, auditable rules and auto-hydrating attendance/payroll signals.

## 3) Proposed AI-Native Architecture

### 3.1 Voice-to-Policy pipeline (Haiky 3.5 in Edge Function)
1. Voice input (mobile/web/WhatsApp admin) -> speech-to-text.
2. `ai-shift-configurator-haiky35` Edge Function parses instruction.
3. Function emits strict JSON policy DSL (schema-validated).
4. Policy compiler writes/updates shift templates, assignment rules, and exception rules.
5. Dry-run simulation returns impact summary before approval.
6. On approval, activate policy with versioning + audit trail.

### 3.2 Weekly AI override and hydration pass
- Cron job (weekly, e.g., Sunday 02:00 org local time): `ai-weekly-attendance-hydrator-haiky35`.
- Inputs:
  - attendance events
  - approved policy JSON
  - holiday/weekend calendars
  - leave data (when available)
  - monthly overrides
- Outputs:
  - hydrated per-day signals (`is_late`, `is_holiday`, `is_weekend`, `is_absent`, `is_early_leave`)
  - AI-suggested exceptions (if confidence low -> human review queue)
  - explainability notes for each decision.

### 3.3 Decision precedence (deterministic)
1. Hard compliance/legal rules
2. Approved manual HR override
3. Approved AI policy rule
4. Default shift/system rule

AI can suggest, but cannot bypass compliance and cannot auto-override locked payroll periods.

## 4) Schema Extensions (minimal but high-impact)

### 4.1 New table: `attendance_ai_policies`
Purpose: versioned org-level AI instruction JSON.
Suggested columns:
- `id`, `organization_id`
- `policy_name`, `policy_version`, `status` (`draft`, `approved`, `active`, `retired`)
- `instruction_text` (human instruction)
- `instruction_json` (validated DSL)
- `model_name` (e.g., `haiky-3.5`)
- `confidence_score`
- `created_by`, `approved_by`, `approved_at`
- `created_at`, `updated_at`

### 4.2 New table: `attendance_ai_runs`
Purpose: every weekly/daily AI execution is auditable.
Suggested columns:
- `id`, `organization_id`, `policy_id`
- `run_type` (`weekly_hydration`, `shift_compile`, `payroll_preview`)
- `period_start`, `period_end`
- `input_snapshot` jsonb
- `output_summary` jsonb
- `status`, `error_message`
- `started_at`, `completed_at`

### 4.3 New table: `attendance_ai_decisions`
Purpose: row-level explainability and replay.
Suggested columns:
- `id`, `run_id`, `user_id`, `attendance_id` (nullable for synthetic rows)
- `decision_type` (`late_flag`, `holiday_flag`, `override_apply`, `ot_calc`)
- `decision_payload` jsonb
- `source_priority` (manual/compliance/ai/default)
- `confidence`
- `human_review_required` boolean
- `reviewed_by`, `reviewed_at`

### 4.4 Optional extension on existing tables
- `attendance`: add `ai_hydration_meta jsonb`, `ai_hydrated_at timestamptz`.
- `attendance_monthly_overrides`: add `source` enum (`manual`, `ai_suggested`, `ai_approved`).
- `employee_pay_overrides`: add `source`, `reason_code`, `explainability` jsonb.

## 5) Policy JSON DSL (example)

```json
{
  "timezone": "Asia/Kolkata",
  "workweek": ["mon", "tue", "wed", "thu", "fri", "sat"],
  "default_shift": {
    "name": "General",
    "start": "09:30",
    "end": "18:30",
    "late_grace_min": 10,
    "early_out_grace_min": 15,
    "break_min": 60
  },
  "exceptions": [
    {
      "if": { "department": "Sales", "day": "sat" },
      "then": { "is_week_off": true }
    },
    {
      "if": { "location": "Plant-2", "date_range": ["2026-03-01", "2026-03-31"] },
      "then": { "start": "08:00", "end": "17:00" }
    }
  ],
  "hydration_rules": {
    "mark_absent_if_no_punch": true,
    "auto_holiday_from_calendar": true,
    "ot_rule": "effective_hours > shift_hours ? effective_hours-shift_hours : 0"
  }
}
```

## 6) Voice Instruction Examples
- “Create 3 shifts: General 9:30-6:30, Night 10 PM-6 AM, Warehouse 7-4 with 20 min late grace.”
- “From next Monday, Sales in Mumbai follows weekend off on Saturday, but month-end last Saturday is working.”
- “If employee is outside geofence but manager approved in WhatsApp, mark present with geofence override reason.”

System response should always include:
- Parsed policy JSON
- Conflicts detected
- Impacted employees count
- Required approvals

## 7) Attendance Hydration Design

### Inputs
- Punch events from `attendance`
- Shift assignment from `employee_shifts` + `shifts`
- Org geofence policy from `organizations.geofence_settings`
- Active AI policy JSON
- Manual override rows

### Daily/weekly output logic
- Recompute `total_hours` and `effective_hours` consistently.
- Hydrate booleans (`is_late`, `is_early_leave`, `is_holiday`, `is_weekend`, `is_absent`).
- Attach decision trace in `ai_hydration_meta`.
- If confidence below threshold or conflicting source, push to HR review queue.

## 8) Compensation and Payroll Automation

### Existing assets to leverage
- `employee_compensation.compensation_payload`
- `pay_components` and `payroll_runs.snapshot`
- `compliance_rules` for PF/ESIC/PT/TDS

### AI-native improvements
- AI generates compensation structure drafts from role/CTC narrative.
- AI suggests pay overrides with reason codes (attendance-linked OT/LOP/late penalties).
- AI validates compliance boundaries before payroll lock.
- AI-generated “why this net pay changed” explanation for HR + employee transparency.

## 9) Implementation Phases

### Phase 1: Foundation (2-3 weeks)
- Add `attendance_ai_policies`, `attendance_ai_runs`, `attendance_ai_decisions`.
- Build JSON schema validator + policy versioning.
- Build `ai-shift-configurator-haiky35` Edge Function (voice text -> DSL).

### Phase 2: Hydration Engine (2-3 weeks)
- Build weekly cron Edge Function.
- Write deterministic precedence engine.
- Persist decision traces and review queue.

### Phase 3: Payroll Intelligence (2-4 weeks)
- AI attendance-to-payroll mapper (LOP/OT/late policy).
- AI compensation assistant for SMB onboarding.
- Add explainability blocks in payroll UI.

### Phase 4: Trust and Ops (ongoing)
- Confidence thresholds + human-in-loop approvals.
- Drift monitoring by org (false positive overrides, rollback frequency).
- Prompt/policy regression tests with gold datasets.

## 10) Guardrails (must-have)
- No autonomous writes to locked payroll periods.
- All AI policy activations require admin approval.
- Every AI decision stores model version + input hash.
- PII-safe prompting and masked exports.
- One-click rollback to previous policy version.

## 11) Immediate Next Build Items (for your repo)
1. Create migration for the 3 AI tables and optional new columns.
2. Add `supabase/functions/ai-shift-configurator-haiky35`.
3. Add `supabase/functions/ai-weekly-attendance-hydrator-haiky35`.
4. Add admin UI page: “AI Shift Configurator” with voice + preview + approval.
5. Add review UI for low-confidence decisions before applying overrides.

## 12) Why this works for SMBs
- Replaces expert-heavy monthly manual overrides with policy automation.
- Keeps deterministic control where legal/compliance is critical.
- Provides human-readable explanations, reducing dependency on specialist HR/payroll operators.

## 13) UI Changes Needed Before Implementation

### 13.1 Attendance Dashboard: shift from static table to AI-native control center
Current file: `src/components/hr/AttendanceDashboard.tsx`

Required UI changes:
- Add top-level mode switch: `Operations` | `AI Policy` | `AI Review Queue`.
- Add AI status strip:
  - active policy version
  - last hydration run timestamp
  - pending low-confidence decisions count
  - payroll lock warnings
- Replace hardcoded status calculation in UI with server-provided hydrated fields (`attendance_status`, `calculated_is_late`, `calculated_is_early_out`, `source_priority`).
- Add filters for AI usability:
  - team/department
  - shift
  - status
  - source (`manual`, `ai`, `default`, `compliance`)
- Add "Why?" action for each row opening explainability panel (decision trace + rule matched + confidence).
- Replace `prompt()` based regularization with structured modal:
  - reason category
  - free text
  - approval routing

### 13.2 New page: AI Shift Configurator (voice-first)
New route suggestion: `/attendance/ai-configurator`

Required UI blocks:
- Voice capture + transcript editor:
  - record/pause/retry
  - editable transcript before submit
- Context selector chips:
  - organization scope
  - team(s)
  - department(s)
  - employee subset (optional)
- Parsed intent preview:
  - detected entities (shift names, times, grace, exceptions)
  - unresolved ambiguities (with inline dropdown disambiguation)
- Compiled policy JSON preview (readable + raw toggle).
- Impact simulator panel:
  - employees impacted
  - policy conflicts
  - likely late/absent distribution change
- Two-step activation:
  - `Save Draft`
  - `Approve & Activate`

### 13.3 Team/Department presence identification for AI voice
Need shared reusable selector in attendance + payroll pages.

Required component behavior:
- Accept natural language entities from AI (`sales`, `night shift`, `warehouse team`).
- Resolve to canonical DB entities with confidence.
- If confidence < threshold, force user selection via chips.
- Store final resolved IDs in payload before any write.

UI components to add:
- `EntityResolutionPanel`
- `ResolvedScopeBadge` (team/department/user counts)
- `AmbiguityDialog`

### 13.4 AI Review Queue page
New route suggestion: `/attendance/ai-review`

Required UI blocks:
- Queue table for low-confidence/conflicting decisions.
- Decision card per item:
  - proposed value
  - current value
  - confidence
  - reason/explanation
- Bulk actions:
  - approve selected
  - reject selected
  - convert to permanent policy rule
- Diff-first UX (before/after tags) to reduce accidental approvals.

### 13.5 Compensation Admin page: fix faulty conversational editing
Current files:
- `src/payroll/CompensationEditor.tsx`
- `src/payroll/CompensationChatNew.tsx`
- `supabase/functions/ai-compensation-chat/index.ts`
- `supabase/functions/ai-component-mapper/index.ts`

Observed failure patterns to fix in UI:
- Follow-up edits can drift because the user cannot see exact structured state deltas between turns.
- Finalize-only mapping creates hidden mismatch until late step.
- Unmapped components warning appears late and lacks quick-fix path.
- Text rendering has encoding artifacts (`â‚¹`, `â†’`) indicating display/encoding inconsistency.

Required UI changes:
- Add `Current Draft` side panel always visible with version history (`Draft v1, v2, ...`).
- Show AI response as `delta` + `full draft`:
  - what changed from previous draft
  - what remains unchanged
- Validate every turn (not only on Finalize):
  - component code mapping status
  - sign convention checks
  - CTC consistency indicator
- Add one-click fix actions in warning panel:
  - map to existing component
  - create component request draft
  - exclude line
- Add explicit intent buttons after each AI reply:
  - `Apply Changes`
  - `Revise`
  - `Discard`
- Add guardrail badges:
  - `Compliant` / `Needs Review`
  - `Mapped 100%` / `Unmapped N`

### 13.6 HR Admin workspace redesign (minimum IA)
Recommended tabs under payroll admin:
1. `Compensation Setup`
2. `AI Compensation Assistant`
3. `Attendance Intelligence`
4. `AI Review Queue`
5. `Policy & Compliance`

Each tab needs a persistent org scope bar:
- organization
- month/year
- team/department filter
- payroll period lock state

### 13.7 UX guardrails for SMB no-expert mode
- Add `Simple Mode` toggle:
  - hides raw JSON
  - guided questions only
- Add `Advanced Mode`:
  - JSON policy editing
  - rule priority tuning
- For all AI actions, show confidence and mandatory confirmation for destructive/high-impact changes.

## 14) UI Implementation Order (recommended)
1. Build shared scope/entity resolver components (team/department/user resolution).
2. Upgrade Compensation AI UI (draft history + per-turn validation + quick fixes).
3. Add AI Review Queue page and wire to decision tables.
4. Add AI Shift Configurator page with voice + policy preview + activation.
5. Integrate Attendance Dashboard with AI status strip and explainability drawer.

## 15) Ready-to-implement UI Backlog
- `feat(attendance): add AI status strip + source-aware filters`
- `feat(attendance): replace inline status calc with hydrated server fields`
- `feat(attendance): add explainability drawer and review actions`
- `feat(ai-config): add voice transcript, entity resolution, policy preview`
- `feat(payroll-ai): add compensation draft timeline and delta viewer`
- `feat(payroll-ai): per-turn mapper validation and unmapped quick-fix actions`
- `fix(payroll-ui): normalize UTF-8 currency/symbol rendering`
- `feat(shared): add organization scope + department/team resolver`
