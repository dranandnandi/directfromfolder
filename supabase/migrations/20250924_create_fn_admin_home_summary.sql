-- Create the fn_admin_home_summary function for payroll admin dashboard
CREATE OR REPLACE FUNCTION public.fn_admin_home_summary(p_org uuid, p_month integer, p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_period record;
  v_runs record;
  v_totals record;
  v_attendance record;
  v_filings record;
  v_health record;
  result jsonb;
begin
  -- Period
  select * into v_period
  from payroll_periods
  where organization_id = p_org
    and month = p_month
    and year = p_year
  limit 1;

  -- Runs summary
  select
    count(*) filter (where status = 'pending') as pending,
    count(*) filter (where status = 'processed') as processed,
    count(*) filter (where status = 'finalized') as finalized,
    count(distinct user_id) as total_users
  into v_runs
  from payroll_runs
  where payroll_period_id = v_period.id;

  -- Totals
  select
    coalesce(sum(gross_earnings),0) as gross_earnings,
    coalesce(sum(total_deductions),0) as total_deductions,
    coalesce(sum(net_pay),0) as net_pay,
    coalesce(sum(employer_cost),0) as employer_cost
  into v_totals
  from payroll_runs
  where payroll_period_id = v_period.id;

  -- Attendance (latest batch)
  select b.id as latest_batch_id,
         b.status,
         count(r.*) as rows_total,
         count(*) filter (where r.will_apply) as rows_will_apply,
         count(*) filter (where r.validation_errors is not null) as rows_errors,
         count(*) filter (where r.is_duplicate) as rows_duplicates
  into v_attendance
  from attendance_import_batches b
  left join attendance_import_rows r on r.batch_id = b.id
  where b.organization_id = p_org
    and b.month = p_month
    and b.year = p_year
  order by b.created_at desc
  limit 1;

  -- Filings
  select jsonb_object_agg(filing_type, status) as map
  into v_filings
  from statutory_filings
  where payroll_period_id = v_period.id;

  -- Health checks
  select
    (select count(*) from users u
      where u.organization_id = p_org
        and not exists (
          select 1 from employee_compensation ec
          where ec.user_id = u.id
            and ec.effective_from <= make_date(p_year,p_month,1)
            and (ec.effective_to is null or ec.effective_to >= make_date(p_year,p_month,1))
        )
    ) as missing_compensation,
    (select count(*) from users u
      where u.organization_id = p_org
        and not exists (
          select 1 from attendance_monthly_overrides ao
          where ao.user_id = u.id
            and ao.organization_id = p_org
            and ao.month = p_month
            and ao.year = p_year
        )
    ) as overrides_pending,
    (select count(*) from payroll_runs pr
      where pr.payroll_period_id = v_period.id
        and pr.net_pay < 0
    ) as negative_netpays,
    (select count(*) from payroll_runs pr
      where pr.payroll_period_id = v_period.id
        and pr.tds_amount > (pr.gross_earnings * 0.4) -- arbitrary flag for outlier
    ) as tds_outliers
  into v_health;

  -- Build JSON
  result := jsonb_build_object(
    'period', to_jsonb(v_period),
    'runs', to_jsonb(v_runs),
    'totals', to_jsonb(v_totals),
    'attendance', to_jsonb(v_attendance),
    'filings', coalesce(v_filings.map,'{}'::jsonb),
    'health', to_jsonb(v_health)
  );

  return result;
end;
$function$;