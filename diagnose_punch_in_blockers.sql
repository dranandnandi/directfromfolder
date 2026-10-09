-- Diagnose users blocked by "You already have an active punch-in"
-- Run in Supabase SQL editor.

-- 1) All users with an open attendance row right now.
select
  a.id as attendance_id,
  a.user_id,
  u.name as user_name,
  u.email,
  o.name as organization_name,
  a.date as attendance_date,
  a.punch_in_time,
  a.punch_out_time,
  s.id as shift_id,
  s.name as shift_name,
  s.start_time,
  s.end_time,
  coalesce(s.is_overnight, false) as is_overnight,
  round(extract(epoch from (now() - a.punch_in_time)) / 3600.0, 2) as open_hours
from attendance a
left join users u on u.id = a.user_id
left join organizations o on o.id = a.organization_id
left join shifts s on s.id = a.shift_id
where a.punch_in_time is not null
  and a.punch_out_time is null
order by a.punch_in_time asc;

-- 2) Users who will be blocked by current app logic.
-- Backend checks only last 2 days for an open row.
select
  a.id as attendance_id,
  a.user_id,
  u.name as user_name,
  u.email,
  a.date,
  a.punch_in_time,
  s.name as shift_name,
  coalesce(s.is_overnight, false) as is_overnight,
  round(extract(epoch from (now() - a.punch_in_time)) / 3600.0, 2) as open_hours
from attendance a
left join users u on u.id = a.user_id
left join shifts s on s.id = a.shift_id
where a.punch_in_time is not null
  and a.punch_out_time is null
  and a.date >= current_date - interval '2 day'
order by a.date desc, a.punch_in_time desc;

-- 3) Likely stale daytime/forgotten open sessions.
-- Good first pass for users seeing the error.
select
  a.id as attendance_id,
  a.user_id,
  u.name as user_name,
  u.email,
  a.date,
  a.punch_in_time,
  s.name as shift_name,
  round(extract(epoch from (now() - a.punch_in_time)) / 3600.0, 2) as open_hours
from attendance a
left join users u on u.id = a.user_id
left join shifts s on s.id = a.shift_id
where a.punch_in_time is not null
  and a.punch_out_time is null
  and (now() - a.punch_in_time) > interval '18 hours'
order by a.punch_in_time asc;

-- 4) Overnight-shift rows that match the cleanup migration logic:
-- invalid daytime punch-in window + still open + stale.
select
  a.id as attendance_id,
  a.user_id,
  u.name as user_name,
  u.email,
  a.date,
  a.punch_in_time,
  s.id as shift_id,
  s.name as shift_name,
  s.start_time,
  s.end_time,
  ((a.punch_in_time at time zone 'Asia/Kolkata')::time) as local_punch_time,
  round(extract(epoch from (now() - a.punch_in_time)) / 3600.0, 2) as open_hours
from attendance a
join shifts s on s.id = a.shift_id
left join users u on u.id = a.user_id
where coalesce(s.is_overnight, false) = true
  and a.punch_in_time is not null
  and a.punch_out_time is null
  and ((a.punch_in_time at time zone 'Asia/Kolkata')::time >= s.end_time)
  and ((a.punch_in_time at time zone 'Asia/Kolkata')::time < s.start_time)
  and (now() - a.punch_in_time) >= interval '10 hours'
order by a.punch_in_time asc;

-- 5) Check one specific user by email or UUID.
-- Replace the value below.
select
  a.*,
  u.name as user_name,
  u.email,
  s.name as shift_name,
  s.start_time,
  s.end_time,
  coalesce(s.is_overnight, false) as is_overnight
from attendance a
join users u on u.id = a.user_id
left join shifts s on s.id = a.shift_id
where u.email = 'replace-user-email@example.com'
   or u.id::text = 'replace-user-uuid'
order by a.date desc, a.punch_in_time desc nulls last;

-- 6) Safe manual fix for one stuck user:
-- close the latest open row instead of deleting it.
-- Replace the user email/uuid before running.
with target as (
  select a.id, a.punch_in_time
  from attendance a
  join users u on u.id = a.user_id
  where (u.email = 'replace-user-email@example.com' or u.id::text = 'replace-user-uuid')
    and a.punch_in_time is not null
    and a.punch_out_time is null
  order by a.punch_in_time desc
  limit 1
)
update attendance a
set
  punch_out_time = least(now(), (select punch_in_time + interval '9 hours' from target)),
  punch_out_address = coalesce(a.punch_out_address, 'Admin SQL cleanup of stale open attendance'),
  punch_out_device_info = coalesce(a.punch_out_device_info, '{}'::jsonb) || jsonb_build_object(
    'source', 'manual_sql_cleanup',
    'closed_at', now()
  ),
  is_regularized = true,
  regularization_reason = coalesce(a.regularization_reason, 'Closed stale open attendance session via SQL'),
  regularized_at = now()
from target
where a.id = target.id
returning a.id, a.user_id, a.date, a.punch_in_time, a.punch_out_time, a.regularization_reason;

-- 7) Existing helper already present in this repo for overnight cleanup:
-- supabase/migrations/fix_attendance_gaps.sql
-- Function:
--   fn_cleanup_open_overnight_records(uuid[], uuid, text, integer)
