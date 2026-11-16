import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
let assertions = 0;
const sqlFile = path => readFile(new URL(`../supabase/migrations/${path}`, import.meta.url), 'utf8');
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params) => Object.values((await query(sql, params))[0])[0];
const check = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const fail = async (fn, pattern) => { await assert.rejects(fn, pattern); assertions++; };
const ids = {
  org: '00000000-0000-0000-0000-000000000001', other: '00000000-0000-0000-0000-000000000002',
  employee: '10000000-0000-0000-0000-000000000001', admin: '10000000-0000-0000-0000-000000000002',
  reviewer: '10000000-0000-0000-0000-000000000003', outsider: '10000000-0000-0000-0000-000000000004'
};
const root = async () => { await db.exec('RESET ROLE'); await db.exec("SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false)"); };
const login = async name => { await root(); await query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [ids[name]]); await db.exec('SET ROLE authenticated'); };
const leave = async (start, end = start, owner = 'employee', kind = 'full day') => scalar(`INSERT INTO tasks(organization_id,type,title,description,created_by,assigned_to,status)
  VALUES ($1,'personalTask','Leave Request: staff',$2,$3,$4,'pending') RETURNING id`, [ids.org, `LEAVE REQUEST DETAILS:\nEmployee: Employee\nLeave Type: ${kind}\nLeave Category: CL\nStart Date: ${start}\nEnd Date: ${end}\nReason: Family appointment\nEmergency: NO`, ids[owner], ids.admin]);
const decide = (id, action = 'approve', note = '') => query('SELECT fn_decide_staff_leave($1,$2,$3)', [id, action, note]);
const readiness = (month, posting = false, org = ids.org) => scalar('SELECT fn_get_payroll_readiness($1,$2,2025,$3)', [org, month, posting]);
const inbox = (status = 'pending', kind = 'all') => scalar('SELECT fn_staff_approvals($1,$2,0)', [status, kind]);

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role',true),'') $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TABLE organizations(id uuid PRIMARY KEY,name text);
    CREATE TABLE users(id uuid PRIMARY KEY,auth_id uuid,organization_id uuid,name text,email text,department text DEFAULT 'Operations',role text,is_active boolean DEFAULT true);
    CREATE FUNCTION get_current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM users WHERE auth_id=auth.uid() $$;
    CREATE FUNCTION fn_admin_of_user(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM users a JOIN users u ON a.organization_id=u.organization_id WHERE a.auth_id=auth.uid() AND a.role IN ('admin','superadmin') AND u.id=p_user) $$;
  `);
  await db.exec(await sqlFile('20250821_create_hr_attendance_system.sql'));
  await db.exec(await sqlFile('add_shift_weekly_off_days.sql'));
  await db.exec(`
    ALTER TABLE shifts ADD COLUMN is_overnight boolean DEFAULT false;
    ALTER TABLE attendance ADD COLUMN is_half_day boolean DEFAULT false;
    ALTER TABLE attendance ADD COLUMN punch_in_distance_meters numeric;
    ALTER TABLE attendance ADD COLUMN punch_out_distance_meters numeric;
    ALTER TABLE attendance ADD COLUMN is_outside_geofence boolean DEFAULT false;
    CREATE TABLE payroll_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,month numeric,year numeric,status text DEFAULT 'draft',lock_at timestamptz);
    CREATE TABLE payroll_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payroll_period_id uuid,user_id uuid,net_pay numeric,status text DEFAULT 'processed');
    CREATE TABLE employee_compensation(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,user_id uuid,ctc_annual numeric,effective_from date,effective_to date);
    CREATE TABLE attendance_monthly_overrides(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,user_id uuid,month int,year int,approved_at timestamptz);
    CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,type text,title text,description text,created_by uuid,assigned_to uuid,status text,completed_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,task_id uuid,type text,title text,message text,scheduled_for timestamptz);
    CREATE TABLE attendance_ai_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,period_start date,period_end date);
    CREATE TABLE attendance_ai_decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid,user_id uuid,attendance_id uuid,decision_type text,decision_payload jsonb DEFAULT '{}',confidence numeric,human_review_required boolean DEFAULT false,reviewed_by uuid,reviewed_at timestamptz,created_at timestamptz DEFAULT now());
  `);
  await db.exec(await sqlFile('20261011020000_attendance_sessions.sql'));
  await db.exec(await sqlFile('20261011030000_multi_punch_setting.sql'));
  await db.exec(await sqlFile('20261014000000_punch_corrections.sql'));
  await db.exec(await sqlFile('20261112000000_attendance_correction_requests.sql'));
  await query('INSERT INTO organizations VALUES ($1,$2),($3,$4)', [ids.org,'Test staff',ids.other,'Other staff']);
  for (const [name, role, org] of [['employee','user',ids.org],['admin','admin',ids.org],['reviewer','superadmin',ids.org],['outsider','admin',ids.other]]) {
    await query('INSERT INTO users(id,auth_id,organization_id,name,role) VALUES ($1,$1,$2,$3,$4)', [ids[name],org,name,role]);
  }
  const historical = await leave('2025-01-01');
  await query("UPDATE tasks SET status='cancelled' WHERE id=$1", [historical]);
  await db.exec(await sqlFile('20261112000002_staff_leave_workflows.sql'));
  await db.exec(await sqlFile('20261112000003_staff_approvals_inbox.sql'));
  await db.exec(await sqlFile('20261112000004_payroll_readiness.sql'));
  await db.exec('GRANT SELECT,INSERT,UPDATE ON tasks,users,payroll_periods,payroll_runs,attendance,attendance_regularizations TO authenticated');
  await db.exec('GRANT SELECT ON attendance_ai_decisions TO authenticated');
  check(await scalar('SELECT fn_staff_leave_status(status,leave_cancelled_at) FROM tasks WHERE id=$1',[historical]), 'rejected');

  await login('employee');
  const future = await leave('2090-01-03','2090-01-05');
  check(await scalar('SELECT leave_start_date::text FROM tasks WHERE id=$1',[future]),'2090-01-03');
  await fail(() => leave('2090-01-04'), /overlap/);
  await fail(() => leave('2090-01-06','2090-01-02'), /valid leave date range/);
  await fail(() => leave('2090-02-30'), /valid leave date range/);
  await fail(() => decide(future), /Another organization admin/);
  await fail(() => query("UPDATE tasks SET status='completed' WHERE id=$1",[future]), /Another organization admin/);
  await fail(() => inbox(), /Only organization admins/);
  await fail(() => readiness(9), /Only payroll admins/);
  await login('outsider');
  await fail(() => decide(future), /not found in your organization/);
  await fail(() => readiness(9), /Only payroll admins/);
  check((await inbox()).total,0);
  await login('admin');
  check((await inbox()).pending_count,1);
  await fail(() => decide(future,'reject',''), /reason for rejecting/);
  await decide(future,'approve','Cover is arranged');
  await fail(() => decide(future), /already been decided/);
  check((await inbox('approved','leave')).items[0].reviewer_name,'admin');
  await login('employee');
  await decide(future,'cancel','Plans changed');
  check(await scalar('SELECT fn_staff_leave_status(status,leave_cancelled_at) FROM tasks WHERE id=$1',[future]),'cancelled');
  await login('admin'); check((await inbox('cancelled','leave')).items[0].decision_note,'Plans changed');
  await login('employee');
  await fail(() => query('UPDATE tasks SET leave_decided_by=$1 WHERE id=$2',[ids.admin,future]), /Decision history cannot be edited/);
  await fail(() => query("UPDATE tasks SET leave_cancelled_at=NULL,status='pending' WHERE id=$1",[future]), /already closed/);
  const resubmitted = await leave('2090-01-04');
  await decide(resubmitted,'cancel');
  const pending = await leave('2025-09-03');
  await fail(() => query("UPDATE tasks SET description=replace(description,'2025-09-03','2025-09-04') WHERE id=$1",[pending]), /dates and employee cannot be changed/);
  await login('admin');
  check((await readiness(9)).groups.some(group => group.code==='pending_leave'),true);
  check((await readiness(9)).groups.find(group => group.code==='missing_compensation').count,3);
  const period = await scalar("INSERT INTO payroll_periods(organization_id,month,year,status) VALUES ($1,9,2025,'draft') RETURNING id",[ids.org]);
  await fail(() => query("UPDATE payroll_periods SET status='locked' WHERE id=$1",[period]), /Payroll is not ready/);
  await root();
  for (const name of ['employee','admin','reviewer']) await query("INSERT INTO employee_compensation(organization_id,user_id,ctc_annual,effective_from) VALUES ($1,$2,120000,'2020-01-01')",[ids.org,ids[name]]);
  await login('admin'); await decide(pending,'approve','Confirmed worked leave');
  await login('employee'); await fail(() => decide(pending,'cancel'), /already started/);
  await login('admin');
  check((await readiness(9)).ready,true); // No-attendance warnings do not silently count as blockers.
  await query("UPDATE payroll_periods SET status='locked' WHERE id=$1",[period]);
  await login('employee'); await fail(() => leave('2025-09-04'), /Payroll is locked/);
  await login('admin');
  await fail(() => query("INSERT INTO payroll_runs(payroll_period_id,user_id,net_pay) VALUES ($1,$2,-100)",[period,ids.employee]), /Net salary is negative/);
  await fail(() => query("UPDATE payroll_periods SET status='posted' WHERE id=$1",[period]), /Employees still awaiting payroll/);
  await login('employee'); await fail(() => query('INSERT INTO payroll_runs(payroll_period_id,user_id,net_pay) VALUES ($1,$2,9000)',[period,ids.employee]), /Only this organization payroll admins/);
  await login('admin');
  for (const name of ['employee','admin','reviewer']) await query('INSERT INTO payroll_runs(payroll_period_id,user_id,net_pay) VALUES ($1,$2,9000)',[period,ids[name]]);
  check((await readiness(9,true)).ready,true);
  await query("UPDATE payroll_periods SET status='posted' WHERE id=$1",[period]);
  await fail(() => query('UPDATE payroll_runs SET net_pay=9100 WHERE payroll_period_id=$1',[period]), /Lock a ready payroll period/);

  await root();
  const day = await scalar("INSERT INTO attendance(user_id,organization_id,date,punch_in_time) VALUES ($1,$2,'2025-08-03','2025-08-03T09:00:00+05:30') RETURNING id",[ids.employee,ids.org]);
  const regularization = await scalar("INSERT INTO attendance_regularizations(attendance_id,requested_by,reason,status) VALUES ($1,$2,'Please excuse late arrival','pending') RETURNING id",[day,ids.employee]);
  const aiRun = await scalar("INSERT INTO attendance_ai_runs(organization_id,period_start,period_end) VALUES ($1,'2025-08-01','2025-08-31') RETURNING id",[ids.org]);
  const ai = await scalar("INSERT INTO attendance_ai_decisions(run_id,user_id,attendance_id,decision_type,human_review_required,decision_payload) VALUES ($1,$2,$3,'late_flag',true,'{\"previous\":{\"late\":true},\"next\":{\"late\":false}}') RETURNING id",[aiRun,ids.employee,day]);
  await login('admin');
  const before = await readiness(8);
  check(before.groups.some(group => group.code==='open_punches'),true);
  check(before.groups.some(group => group.code==='ai_review'),true);
  check(before.groups.some(group => group.code==='pending_regularizations'),true);
  check((await inbox('pending','regularization')).total,1);
  await query("SELECT fn_review_staff_request('regularization',$1,'approve','Excused by supervisor')",[regularization]);
  await query("SELECT fn_review_staff_request('ai_review',$1,'reject','Original attendance is correct')",[ai]);
  check(await scalar("SELECT decision_payload->'previous'->>'late' FROM attendance_ai_decisions WHERE id=$1",[ai]),'true');
  check((await inbox('rejected','ai_review')).total,1);
  await fail(() => query("SELECT fn_review_staff_request('ai_review',$1,'approve','')",[ai]), /already been reviewed/);
  await root(); await query("UPDATE attendance SET punch_out_time='2025-08-03T18:00:00+05:30' WHERE id=$1",[day]);
  await login('admin'); check((await readiness(8)).ready,true);
  await root(); await query("INSERT INTO attendance_monthly_overrides(organization_id,user_id,month,year) VALUES ($1,$2,8,2025)",[ids.org,ids.employee]);
  await login('admin'); check((await readiness(8)).groups.some(group => group.code==='pending_overrides'),true);
  await fail(() => query("SELECT fn_staff_payroll_readiness($1,8,2025,false)",[ids.org]), /permission denied/);
  console.log(`Staff workflow database checks passed (${assertions} assertions).`);
} catch (error) { console.error(error.message, error.where || '', error.query || ''); process.exitCode = 1; }
finally { await db.close(); }
