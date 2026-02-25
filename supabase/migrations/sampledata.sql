begin;

-- =========================================================
-- CONFIG
-- =========================================================
-- Org + users provided by you
with seed_users as (
  select * from (
    values
      (0,'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid,'Amit Singh Moga','OPREATION TEAM'),
      (1,'c33ea6fe-338a-4108-932b-484709255550'::uuid,'dhruti','EDITORT'),
      (2,'3e0865ca-ce9c-4e1a-bc52-c7b8f47c764f'::uuid,'himanshu','OPREATION TEAM'),
      (3,'a6da6759-e4fd-4477-bcc9-eeaa765ab42d'::uuid,'mahek','EDITORT'),
      (4,'33d1082a-930f-47a0-9d70-fa466ffeb751'::uuid,'mahendra','EDITORT'),
      (5,'ac33e639-6b12-4d80-8821-f55a10b8fcd4'::uuid,'manav','OPREATION TEAM'),
      (6,'6f1626a9-42cf-413a-99d8-0ba63aee9546'::uuid,'mayank','EDITORT'),
      (7,'6451cd56-e76d-4900-87e4-fdf35da9748a'::uuid,'payal','OPREATION TEAM'),
      (8,'f1cbc3d9-ce85-4d4f-82e6-5b688f2af748'::uuid,'shivam','EDITORT'),
      (9,'5043f462-30fa-409c-aed9-80ec402f068a'::uuid,'utsav','EDITORT')
  ) as t(idx,user_id,name,department)
),
cfg as (
  select
    '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid as org_id,
    'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid as admin_user_id
)
select 1;

-- =========================================================
-- 1) SHIFTS (sample)
-- =========================================================
with cfg as (
  select '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid as org_id
)
insert into public.shifts (
  organization_id, name, start_time, end_time, duration_hours,
  break_duration_minutes, late_threshold_minutes, early_out_threshold_minutes, is_active, is_overnight
)
select org_id, 'AI_OPS_DAY', '09:30'::time, '18:30'::time, 9, 60, 10, 15, true, false from cfg
where not exists (
  select 1 from public.shifts s where s.organization_id = cfg.org_id and s.name = 'AI_OPS_DAY'
)
union all
select org_id, 'AI_EDITOR_LATE', '10:30'::time, '19:30'::time, 9, 60, 10, 15, true, false from cfg
where not exists (
  select 1 from public.shifts s where s.organization_id = cfg.org_id and s.name = 'AI_EDITOR_LATE'
);

-- =========================================================
-- 2) EMPLOYEE SHIFT ASSIGNMENTS (effective from 2026-02-01)
-- =========================================================
with seed_users as (
  select * from (
    values
      (0,'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid,'OPREATION TEAM'),
      (1,'c33ea6fe-338a-4108-932b-484709255550'::uuid,'EDITORT'),
      (2,'3e0865ca-ce9c-4e1a-bc52-c7b8f47c764f'::uuid,'OPREATION TEAM'),
      (3,'a6da6759-e4fd-4477-bcc9-eeaa765ab42d'::uuid,'EDITORT'),
      (4,'33d1082a-930f-47a0-9d70-fa466ffeb751'::uuid,'EDITORT'),
      (5,'ac33e639-6b12-4d80-8821-f55a10b8fcd4'::uuid,'OPREATION TEAM'),
      (6,'6f1626a9-42cf-413a-99d8-0ba63aee9546'::uuid,'EDITORT'),
      (7,'6451cd56-e76d-4900-87e4-fdf35da9748a'::uuid,'OPREATION TEAM'),
      (8,'f1cbc3d9-ce85-4d4f-82e6-5b688f2af748'::uuid,'EDITORT'),
      (9,'5043f462-30fa-409c-aed9-80ec402f068a'::uuid,'EDITORT')
  ) as t(idx,user_id,department)
),
cfg as (
  select
    '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid as org_id,
    'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid as admin_user_id
),
shift_map as (
  select
    (
      select s1.id
      from public.shifts s1
      join cfg on cfg.org_id = s1.organization_id
      where s1.name = 'AI_OPS_DAY'
      order by s1.created_at desc nulls last, s1.id
      limit 1
    ) as ops_shift_id,
    (
      select s2.id
      from public.shifts s2
      join cfg on cfg.org_id = s2.organization_id
      where s2.name = 'AI_EDITOR_LATE'
      order by s2.created_at desc nulls last, s2.id
      limit 1
    ) as edt_shift_id
)
-- close active assignments (optional)
update public.employee_shifts es
set effective_to = '2026-01-31'::date
from seed_users su
where es.user_id = su.user_id
  and es.effective_to is null
  and es.effective_from <= '2026-02-01'::date;

with seed_users as (
  select * from (
    values
      (0,'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid,'OPREATION TEAM'),
      (1,'c33ea6fe-338a-4108-932b-484709255550'::uuid,'EDITORT'),
      (2,'3e0865ca-ce9c-4e1a-bc52-c7b8f47c764f'::uuid,'OPREATION TEAM'),
      (3,'a6da6759-e4fd-4477-bcc9-eeaa765ab42d'::uuid,'EDITORT'),
      (4,'33d1082a-930f-47a0-9d70-fa466ffeb751'::uuid,'EDITORT'),
      (5,'ac33e639-6b12-4d80-8821-f55a10b8fcd4'::uuid,'OPREATION TEAM'),
      (6,'6f1626a9-42cf-413a-99d8-0ba63aee9546'::uuid,'EDITORT'),
      (7,'6451cd56-e76d-4900-87e4-fdf35da9748a'::uuid,'OPREATION TEAM'),
      (8,'f1cbc3d9-ce85-4d4f-82e6-5b688f2af748'::uuid,'EDITORT'),
      (9,'5043f462-30fa-409c-aed9-80ec402f068a'::uuid,'EDITORT')
  ) as t(idx,user_id,department)
),
cfg as (
  select
    '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid as org_id,
    'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid as admin_user_id
),
shift_map as (
  select
    (
      select s1.id
      from public.shifts s1
      join cfg on cfg.org_id = s1.organization_id
      where s1.name = 'AI_OPS_DAY'
      order by s1.created_at desc nulls last, s1.id
      limit 1
    ) as ops_shift_id,
    (
      select s2.id
      from public.shifts s2
      join cfg on cfg.org_id = s2.organization_id
      where s2.name = 'AI_EDITOR_LATE'
      order by s2.created_at desc nulls last, s2.id
      limit 1
    ) as edt_shift_id
)
insert into public.employee_shifts(user_id, shift_id, effective_from, effective_to, assigned_by)
select
  su.user_id,
  case when su.department='OPREATION TEAM' then sm.ops_shift_id else sm.edt_shift_id end,
  '2026-02-01'::date,
  null,
  cfg.admin_user_id
from seed_users su
cross join cfg
cross join shift_map sm
where not exists (
  select 1 from public.employee_shifts e
  where e.user_id = su.user_id
    and e.effective_from = '2026-02-01'::date
);

-- =========================================================
-- 3) ATTENDANCE DATA (1-7 Feb 2026)
-- =========================================================
-- cleanup existing records in range for these users
with seed_users as (
  select * from (
    values
      ('cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid),
      ('c33ea6fe-338a-4108-932b-484709255550'::uuid),
      ('3e0865ca-ce9c-4e1a-bc52-c7b8f47c764f'::uuid),
      ('a6da6759-e4fd-4477-bcc9-eeaa765ab42d'::uuid),
      ('33d1082a-930f-47a0-9d70-fa466ffeb751'::uuid),
      ('ac33e639-6b12-4d80-8821-f55a10b8fcd4'::uuid),
      ('6f1626a9-42cf-413a-99d8-0ba63aee9546'::uuid),
      ('6451cd56-e76d-4900-87e4-fdf35da9748a'::uuid),
      ('f1cbc3d9-ce85-4d4f-82e6-5b688f2af748'::uuid),
      ('5043f462-30fa-409c-aed9-80ec402f068a'::uuid)
  ) as t(user_id)
)
delete from public.attendance a
using seed_users su
where a.user_id = su.user_id
  and a.date between '2026-02-01'::date and '2026-02-07'::date;

with seed_users as (
  select * from (
    values
      (0,'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid,'OPREATION TEAM'),
      (1,'c33ea6fe-338a-4108-932b-484709255550'::uuid,'EDITORT'),
      (2,'3e0865ca-ce9c-4e1a-bc52-c7b8f47c764f'::uuid,'OPREATION TEAM'),
      (3,'a6da6759-e4fd-4477-bcc9-eeaa765ab42d'::uuid,'EDITORT'),
      (4,'33d1082a-930f-47a0-9d70-fa466ffeb751'::uuid,'EDITORT'),
      (5,'ac33e639-6b12-4d80-8821-f55a10b8fcd4'::uuid,'OPREATION TEAM'),
      (6,'6f1626a9-42cf-413a-99d8-0ba63aee9546'::uuid,'EDITORT'),
      (7,'6451cd56-e76d-4900-87e4-fdf35da9748a'::uuid,'OPREATION TEAM'),
      (8,'f1cbc3d9-ce85-4d4f-82e6-5b688f2af748'::uuid,'EDITORT'),
      (9,'5043f462-30fa-409c-aed9-80ec402f068a'::uuid,'EDITORT')
  ) as t(idx,user_id,department)
),
cfg as (
  select '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid as org_id
),
shift_map as (
  select
    (
      select s1.id
      from public.shifts s1
      join cfg on cfg.org_id = s1.organization_id
      where s1.name = 'AI_OPS_DAY'
      order by s1.created_at desc nulls last, s1.id
      limit 1
    ) as ops_shift_id,
    (
      select s2.id
      from public.shifts s2
      join cfg on cfg.org_id = s2.organization_id
      where s2.name = 'AI_EDITOR_LATE'
      order by s2.created_at desc nulls last, s2.id
      limit 1
    ) as edt_shift_id
),
dates as (
  select d::date as dt
  from generate_series('2026-02-01'::date, '2026-02-07'::date, interval '1 day') g(d)
),
base as (
  select
    su.idx,
    su.user_id,
    su.department,
    d.dt,
    extract(dow from d.dt)::int as dow,
    case when su.department='OPREATION TEAM' then sm.ops_shift_id else sm.edt_shift_id end as shift_id,
    case when su.department='OPREATION TEAM' then time '09:30' else time '10:30' end as shift_start,
    case when su.department='OPREATION TEAM' then time '18:30' else time '19:30' end as shift_end
  from seed_users su
  cross join dates d
  cross join shift_map sm
),
calc as (
  select
    b.*,
    -- sample rules
    (b.dt = date '2026-02-05' and b.idx in (1,2)) as is_holiday_row,
    (b.dow in (0,6)) as is_weekend_row,
    (b.idx % 5 = 0 and b.dt = date '2026-02-04') as is_absent_row,
    (b.idx % 4 = 0 and b.dt = date '2026-02-03') as is_late_row,
    (b.idx % 3 = 0 and b.dt = date '2026-02-06') as is_early_row
  from base b
),
final_rows as (
  select
    c.*,
    -- weekend attendance: only some users present
    (
      case
        when c.is_holiday_row then false
        when c.is_absent_row then false
        when c.is_weekend_row and c.idx in (0,3,6,9) then true
        when c.is_weekend_row then false
        else true
      end
    ) as is_present
  from calc c
)
insert into public.attendance (
  user_id, organization_id, date, shift_id,
  punch_in_time, punch_out_time,
  punch_in_latitude, punch_in_longitude, punch_in_address, punch_in_selfie_url, punch_in_device_info,
  punch_out_latitude, punch_out_longitude, punch_out_address, punch_out_selfie_url, punch_out_device_info,
  total_hours, break_hours, effective_hours,
  is_late, is_early_out, is_early_leave, is_absent, is_holiday, is_weekend,
  punch_in_distance_meters, punch_out_distance_meters, is_outside_geofence,
  ai_source, ai_hydrated_at, ai_hydration_meta,
  created_at, updated_at
)
select
  f.user_id,
  cfg.org_id,
  f.dt,
  f.shift_id,
  case
    when f.is_present then (f.dt::timestamp + f.shift_start + (case when f.is_late_row then interval '18 minutes' else interval '4 minutes' end))
    else null
  end as punch_in_time,
  case
    when f.is_present then (f.dt::timestamp + f.shift_end - (case when f.is_early_row then interval '22 minutes' else interval '6 minutes' end))
    else null
  end as punch_out_time,
  23.0225, 72.5714,
  'Office Campus',
  'placeholder-punchin',
  jsonb_build_object('device','android','app_version','1.0.0-seed'),
  23.0226, 72.5716,
  'Office Campus Exit',
  'placeholder-punchout',
  jsonb_build_object('device','android','app_version','1.0.0-seed'),
  case when f.is_present then 9.0 else null end,
  1.0,
  case when f.is_present then 8.0 else null end,
  (f.is_present and f.is_late_row),
  (f.is_present and f.is_early_row),
  (f.is_present and f.is_early_row),
  (not f.is_present),
  f.is_holiday_row,
  f.is_weekend_row,
  case when f.is_present then 120 else null end,
  case when f.is_present then 140 else null end,
  (f.is_present and f.idx in (2,7)),
  case
    when f.is_holiday_row then 'compliance'::public.ai_source_enum
    when f.dt >= date '2026-02-03' then 'ai'::public.ai_source_enum
    else 'default'::public.ai_source_enum
  end,
  now(),
  jsonb_build_object('seed','feb-2026','note','sample hydration'),
  now(),
  now()
from final_rows f
cross join cfg;

-- =========================================================
-- 4) AI POLICY (active) + retire old active policy
-- =========================================================
with cfg as (
  select
    '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid as org_id,
    'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid as admin_user_id
)
update public.attendance_ai_policies p
set status = 'retired'::public.ai_policy_status_enum, updated_at = now()
from cfg
where p.organization_id = cfg.org_id
  and p.status = 'active'::public.ai_policy_status_enum;

with cfg as (
  select
    '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid as org_id,
    'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid as admin_user_id
),
next_ver as (
  select coalesce(max(policy_version),0) + 1 as v
  from public.attendance_ai_policies
  where organization_id = (select org_id from cfg)
    and policy_name = 'Seed Policy Feb 2026'
)
insert into public.attendance_ai_policies (
  organization_id, policy_name, policy_version, status,
  instruction_text, instruction_json, model_name, confidence_score,
  created_by, approved_by, approved_at, created_at, updated_at
)
select
  cfg.org_id,
  'Seed Policy Feb 2026',
  next_ver.v,
  'active'::public.ai_policy_status_enum,
  'Sample voice policy seed for 1-7 Feb 2026 validation',
  jsonb_build_object(
    'timezone','Asia/Kolkata',
    'workweek',jsonb_build_array('mon','tue','wed','thu','fri','sat'),
    'holidays',jsonb_build_array('2026-02-05'),
    'hydration_rules',jsonb_build_object('mark_absent_if_no_punch',true,'auto_holiday_from_calendar',true)
  ),
  'claude-3.5-haiku',
  0.91,
  cfg.admin_user_id,
  cfg.admin_user_id,
  now(),
  now(),
  now()
from cfg, next_ver;

-- =========================================================
-- 5) AI RUN + hydrate meta linkage
-- =========================================================
with cfg as (
  select '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid as org_id
),
p as (
  select id
  from public.attendance_ai_policies
  where organization_id = (select org_id from cfg)
    and status='active'::public.ai_policy_status_enum
  order by updated_at desc
  limit 1
),
r as (
  insert into public.attendance_ai_runs (
    organization_id, policy_id, run_type, period_start, period_end,
    input_snapshot, output_summary, status, started_at, completed_at
  )
  select
    cfg.org_id, p.id, 'weekly_hydration',
    '2026-02-01'::date, '2026-02-07'::date,
    jsonb_build_object('mode','apply','seed',true),
    jsonb_build_object('updated_rows',70,'review_required',12,'ai_summary','Seed run completed'),
    'completed'::public.ai_run_status_enum,
    now() - interval '5 minutes',
    now()
  from cfg, p
  returning id
)
update public.attendance a
set
  ai_hydrated_at = now(),
  ai_hydration_meta = jsonb_build_object('run_id', (select id from r), 'seed', true)
where a.organization_id = '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid
  and a.date between '2026-02-01'::date and '2026-02-07'::date;

-- =========================================================
-- 6) AI DECISIONS + REVIEW QUEUE ITEMS
-- =========================================================
with run_ref as (
  select id as run_id
  from public.attendance_ai_runs
  where organization_id = '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid
    and run_type = 'weekly_hydration'
  order by started_at desc
  limit 1
)
insert into public.attendance_ai_decisions (
  run_id, user_id, attendance_id, decision_type, decision_payload,
  source_priority, confidence, human_review_required, created_at
)
select
  rr.run_id,
  a.user_id,
  a.id,
  'attendance_status',
  jsonb_build_object(
    'previous', jsonb_build_object('is_late', false, 'is_absent', false),
    'next', jsonb_build_object('is_late', a.is_late, 'is_absent', a.is_absent, 'is_holiday', a.is_holiday)
  ),
  'ai'::public.ai_source_priority_enum,
  case when a.is_absent then 0.62 else 0.88 end,
  case when a.is_absent or a.is_outside_geofence then true else false end,
  now()
from public.attendance a
cross join run_ref rr
where a.organization_id = '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid
  and a.date between '2026-02-01'::date and '2026-02-07'::date
  and (a.is_late or a.is_absent or a.is_outside_geofence);

-- mark a few decisions reviewed so queue has mixed state
update public.attendance_ai_decisions d
set reviewed_at = now(), reviewed_by = 'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid
where d.id in (
  select id
  from public.attendance_ai_decisions
  where run_id = (
    select id from public.attendance_ai_runs
    where organization_id = '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid
    order by started_at desc limit 1
  )
  order by created_at asc
  limit 3
);

-- =========================================================
-- 7) MONTHLY/PAY OVERRIDES samples (domain-backed source)
-- =========================================================
insert into public.attendance_monthly_overrides (
  organization_id, user_id, month, year, payload, source, approved_by, approved_at, created_at
)
values
(
  '5cf04b2d-4f50-44b7-a42a-3531215af073'::uuid,
  'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid,
  2, 2026,
  jsonb_build_object(
    'present_days', 5,
    'lop_days', 1,
    'paid_leaves', 1,
    'holidays', 1,
    'weekly_offs', 2,
    'overtime_hours', 3,
    'late_occurrences', 2,
    'early_outs', 1,
    'remarks','Seed override for validation'
  ),
  'ai_approved'::public.manual_ai_source,
  'cb14e1dc-ed78-4895-979e-e1c27377e3da'::uuid,
  now(),
  now()
)
on conflict do nothing;

insert into public.employee_pay_overrides (
  user_id, period_month, period_year, override_payload, source, reason_code, explainability, created_at
)
values
(
  '3e0865ca-ce9c-4e1a-bc52-c7b8f47c764f'::uuid,
  2, 2026,
  jsonb_build_object('component_code','BONUS','amount',5000,'remarks','AI suggested performance bonus'),
  'ai_suggested'::public.manual_ai_source,
  'performance_bonus',
  jsonb_build_object('confidence',0.74,'basis','attendance+output'),
  now()
),
(
  'a6da6759-e4fd-4477-bcc9-eeaa765ab42d'::uuid,
  2, 2026,
  jsonb_build_object('component_code','RECOVERY','amount',-1200,'remarks','Late penalty simulation'),
  'manual'::public.manual_ai_source,
  'late_penalty',
  jsonb_build_object('confidence',0.66,'basis','late_count'),
  now()
)
on conflict do nothing;

commit;


