import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
let assertions = 0;
const ids = Object.fromEntries(['org','other','admin','employee','trainer','leave','attendance','staff','outsider','inactive'].map((key,i) => [key, `00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`]));
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params = []) => Object.values((await query(sql, params))[0])[0];
const check = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const fail = async (fn, pattern) => { await assert.rejects(fn, pattern); assertions++; };
const file = name => readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const root = async () => { await db.exec('RESET ROLE'); await query("SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','',false)"); };
const login = async name => { await root(); await query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[ids[name]]); await db.exec('SET ROLE authenticated'); };
const service = async () => { await root(); await query("SELECT set_config('request.jwt.claim.role','service_role',false)"); await db.exec('SET ROLE service_role'); };
const mine = () => scalar('SELECT fn_my_staff_access()');
const groups = () => scalar('SELECT fn_staff_access_groups()');
const saveGroup = (g, members, permissions=g.permissions, enabled=true, name=g.name) => scalar('SELECT fn_save_staff_access_group($1,$2,$3,$4,$5,$6::timestamptz)',[name,permissions,members,enabled,g.id,g.updated_at]);
const group = async code => (await groups()).groups.find(g => g.code===code);
const leave = async (owner, day, assigned=ids.admin) => scalar(`INSERT INTO tasks(organization_id,type,title,description,created_by,assigned_to,status)
  VALUES($1,'personalTask','Leave Request: employee',$2,$3,$4,'pending') RETURNING id`,[ids.org,`LEAVE REQUEST DETAILS:\nEmployee: Employee\nLeave Type: full day\nLeave Category: CL\nStart Date: ${day}\nEnd Date: ${day}\nReason: Appointment`,ids[owner],assigned]);
const decide = (id, action='approve',note='') => query('SELECT fn_decide_staff_leave($1,$2,$3)',[id,action,note]);
const inbox = (kind='all',status='pending') => scalar('SELECT fn_staff_approvals($1,$2,0)',[status,kind]);
const trainingInput = {title:'Safety',starts_at:'2025-01-02T09:00:00Z',ends_at:'2025-01-02T10:00:00Z'};
const schedule = (attendees=[ids.employee],extra={}) => scalar('SELECT fn_save_training_session($1,$2,NULL,NULL)',[{...trainingInput,...extra},attendees]);
const trainingRecord = (a,attendance='attended',completion='completed') => query('SELECT fn_record_training_attendee($1,$2,$3,$4,$5::timestamptz)',[a.id,attendance,completion,'Verified',a.updated_at]);

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role',true),'') $$;
    GRANT USAGE ON SCHEMA auth,storage TO authenticated,anon,service_role;
    CREATE TABLE organizations(id uuid PRIMARY KEY,name text);
    CREATE TABLE users(id uuid PRIMARY KEY,auth_id uuid,organization_id uuid,name text,email text,department text DEFAULT 'Operations',role text,is_active boolean DEFAULT true);
    CREATE FUNCTION get_current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM users WHERE auth_id=auth.uid() $$;
    CREATE FUNCTION fn_admin_of_user(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM users a JOIN users u ON a.organization_id=u.organization_id WHERE a.auth_id=auth.uid() AND a.role IN ('admin','superadmin') AND u.id=p_user) $$;
    CREATE TABLE organization_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,uploaded_by uuid,category text DEFAULT 'general',file_path text,is_public boolean DEFAULT false,deleted_at timestamptz);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
    ALTER TABLE organization_documents ENABLE ROW LEVEL SECURITY; ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON organization_documents,storage.objects TO authenticated;
    CREATE POLICY docs_read ON organization_documents FOR SELECT TO authenticated USING(organization_id IN(SELECT organization_id FROM users WHERE auth_id=auth.uid()));
    CREATE POLICY objects_read ON storage.objects FOR SELECT TO authenticated USING(split_part(name,'/',1) IN(SELECT organization_id::text FROM users WHERE auth_id=auth.uid()));
  `);
  await db.exec(await file('20250821_create_hr_attendance_system.sql'));
  await db.exec(await file('add_shift_weekly_off_days.sql'));
  await db.exec(`ALTER TABLE shifts ADD COLUMN is_overnight boolean DEFAULT false;
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
  for (const name of ['20261011020000_attendance_sessions.sql','20261011030000_multi_punch_setting.sql','20261014000000_punch_corrections.sql',
    '20261112000000_attendance_correction_requests.sql','20261112000002_staff_leave_workflows.sql','20261112000003_staff_approvals_inbox.sql','20261112000004_payroll_readiness.sql',
    '20261114000000_admin_mark_attendance.sql','20261116000000_training_management.sql','20261116000001_staff_access_groups.sql']) await db.exec(await file(name));
  await query('INSERT INTO organizations VALUES($1,$2),($3,$4)',[ids.org,'Staff',ids.other,'Other']);
  for (const name of ['admin','employee','trainer','leave','attendance','staff','outsider','inactive']) await query(
    'INSERT INTO users(id,auth_id,organization_id,name,role,is_active) VALUES($1,$1,$2,$3,$4,$5)',[ids[name],name==='outsider'?ids.other:ids.org,name,['admin','outsider'].includes(name)?'admin':'user',name!=='inactive']);
  await db.exec(`GRANT SELECT,INSERT,UPDATE ON tasks,users,attendance,attendance_regularizations TO authenticated;
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    CREATE POLICY self_users ON users FOR SELECT TO authenticated USING(auth_id=auth.uid());
    CREATE POLICY update_self_users ON users FOR UPDATE TO authenticated USING(auth_id=auth.uid()) WITH CHECK(auth_id=auth.uid());
    ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_tasks ON tasks FOR ALL TO authenticated USING(created_by=get_current_user_id()) WITH CHECK(created_by=get_current_user_id());
    ALTER TABLE employee_compensation ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_salary ON employee_compensation FOR SELECT TO authenticated USING(user_id=get_current_user_id() OR fn_admin_of_user(user_id));
    GRANT SELECT ON employee_compensation TO authenticated;
  `);
  await login('admin');
  check((await groups()).groups.length,4);
  check((await mine()).full_admin,true);
  check((await mine()).permissions.length,4);
  check(await scalar("SELECT fn_has_staff_permission('payroll.manage')"),false);
  let trainingGroup=await group('training'),leaveGroup=await group('leave'),attendanceGroup=await group('attendance'),staffGroup=await group('staff_admin');
  await fail(()=>saveGroup(trainingGroup,[ids.outsider]),/active users in your organization/);
  await fail(()=>saveGroup(trainingGroup,[ids.inactive]),/active users in your organization/);
  await fail(()=>saveGroup(trainingGroup,[ids.employee],['payroll.manage']),/supported staff permissions/);
  await fail(()=>saveGroup(trainingGroup,[null]),/active users in your organization/);
  await saveGroup(trainingGroup,[ids.trainer]); await saveGroup(leaveGroup,[ids.leave]);
  await saveGroup(attendanceGroup,[ids.attendance]); await saveGroup(staffGroup,[ids.staff]);
  await fail(()=>saveGroup(trainingGroup,[]),/changed. Refresh/);
  check(await scalar('SELECT count(*)::int FROM staff_access_events'),4);
  trainingGroup=await group('training'); leaveGroup=await group('leave'); attendanceGroup=await group('attendance'); staffGroup=await group('staff_admin');

  await login('employee');
  check((await mine()).permissions,[]);
  check((await mine()).full_admin,false);
  await fail(()=>groups(),/Only full admins/);
  await fail(()=>saveGroup(trainingGroup,[ids.employee]),/Only full admins/);
  await fail(()=>query('INSERT INTO staff_access_members VALUES($1,$2)',[trainingGroup.id,ids.employee]),/permission denied/);
  await fail(()=>query('DELETE FROM staff_access_events'),/permission denied/);
  await fail(()=>query('SELECT fn_staff_user_has_permission($1,$2,$3)',[ids.admin,ids.org,'leave.approve']),/permission denied/);
  await fail(()=>query('SELECT fn_service_leave_approvers($1)',[ids.employee]),/permission denied/);
  check((await query("SELECT * FROM fn_staff_approvers('leave.approve')")).map(x=>x.name),['leave','staff','admin']);
  const pending=await leave('employee','2090-01-02',ids.leave);
  const otherPending=await leave('employee','2090-01-03');
  await fail(()=>inbox(),/Authorized approvers/);
  await fail(()=>decide(pending),/authorized leave approver/);
  await fail(()=>query('SELECT fn_staff_attendance_day($1)',['2025-01-01']),/permission required/);
  await fail(()=>schedule(),/Training managers/);

  await login('trainer');
  await fail(()=>query("UPDATE users SET role='admin' WHERE id=$1",[ids.trainer]),/Only full admins can change account access/);
  await fail(()=>query('UPDATE users SET organization_id=$1 WHERE id=$2',[ids.other,ids.trainer]),/Only full admins can change account access/);
  await fail(()=>query('UPDATE users SET is_active=false WHERE id=$1',[ids.trainer]),/Only full admins can change account access/);
  check((await mine()).permissions.sort(),['training.manage','training_materials.manage']);
  check((await mine()).full_admin,false);
  check(await scalar('SELECT count(*)::int FROM users'),1); // No broad profile read was granted.
  check((await query('SELECT * FROM fn_training_employee_directory()')).length,7);
  check(await scalar('SELECT fn_admin_of_user($1)',[ids.employee]),false); // Payroll helper is unchanged.
  await fail(()=>groups(),/Only full admins/);
  await fail(()=>decide(pending),/authorized leave approver/);
  const training=await schedule([ids.employee,ids.trainer]);
  const trainingRows=await query('SELECT to_jsonb(a) AS item FROM training_attendees a WHERE session_id=$1',[training]);
  await trainingRecord(trainingRows.find(x=>x.item.user_id===ids.employee).item);
  await fail(()=>trainingRecord(trainingRows.find(x=>x.item.user_id===ids.trainer).item),/Another training manager/);
  await query("INSERT INTO organization_documents(organization_id,uploaded_by,category,file_path) VALUES($1,$2,'training',$3)",[ids.org,ids.trainer,`${ids.org}/training/material.pdf`]);
  await fail(()=>query("INSERT INTO organization_documents(organization_id,uploaded_by,category,file_path) VALUES($1,$2,'hr',$3)",[ids.org,ids.trainer,`${ids.org}/hr/salary.pdf`]),/row-level security/);
  await fail(()=>query("UPDATE organization_documents SET category='hr' WHERE category='training'"),/row-level security/);
  await query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['organization-documents',`${ids.org}/training/material.pdf`]);
  await fail(()=>query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['organization-documents',`${ids.org}/hr/private.pdf`]),/row-level security/);
  await fail(()=>query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['organization-documents',`${ids.other}/training/private.pdf`]),/row-level security/);
  await root(); await query('INSERT INTO employee_compensation(organization_id,user_id,ctc_annual) VALUES($1,$2,120000)',[ids.org,ids.employee]);
  await login('trainer'); check(await scalar('SELECT count(*)::int FROM employee_compensation'),0);

  await login('leave');
  check((await inbox()).total,2);
  check((await inbox('correction')).total,0);
  check(await scalar('SELECT count(*)::int FROM tasks'),2);
  await decide(pending);
  const ownLeave=await leave('leave','2090-02-03');
  await fail(()=>decide(ownLeave),/authorized leave approver/);
  check((await inbox()).items.find(x=>x.id===ownLeave).can_review,false);
  await fail(()=>query("SELECT fn_review_staff_request('regularization',gen_random_uuid(),'approve','')"),/Permission for this request type/);
  await fail(()=>query("SELECT fn_review_staff_request('ai_review',gen_random_uuid(),'approve','')"),/Permission for this request type/);

  await root();
  const day=await scalar("INSERT INTO attendance(user_id,organization_id,date,punch_in_time,punch_out_time) VALUES($1,$2,'2025-01-03','2025-01-03T09:00:00Z','2025-01-03T10:00:00Z') RETURNING id",[ids.employee,ids.org]);
  const regularization=await scalar("INSERT INTO attendance_regularizations(attendance_id,requested_by,reason,status) VALUES($1,$2,'Late due to transport','pending') RETURNING id",[day,ids.employee]);
  await login('employee');
  const correction=await scalar("SELECT fn_request_attendance_correction('2025-02-03','2025-02-03T04:00:00Z','2025-02-03T05:00:00Z','Missing attendance record',NULL)");
  await login('attendance');
  check((await inbox()).total,2);
  check((await inbox('leave')).total,0);
  check((await scalar("SELECT fn_staff_attendance_day('2025-01-03')")).some(x=>x.name==='employee' && x.punch_in!==null),true);
  await query("SELECT fn_review_staff_request('regularization',$1,'approve','Transport issue verified')",[regularization]);
  await query("SELECT fn_review_staff_request('correction',$1,'approve','Verified')",[correction]);
  const selfCorrection=await scalar("SELECT fn_request_attendance_correction('2025-02-04','2025-02-04T04:00:00Z','2025-02-04T05:00:00Z','Missing my attendance',NULL)");
  await fail(()=>query("SELECT fn_decide_attendance_correction($1,'approve','')",[selfCorrection]),/Another authorized attendance approver/);
  await fail(()=>decide(otherPending),/authorized leave approver/);
  await fail(()=>query("SELECT fn_admin_mark_attendance_punch($1,'2025-01-03','in','2025-01-03T09:00:00Z','Manual change')",[ids.employee]),/Only an active organization admin/);
  await fail(()=>query('SELECT fn_get_payroll_readiness($1,1,2025,false)',[ids.org]),/Only payroll admins/);

  await login('staff');
  check((await mine()).permissions.length,4);
  check((await mine()).full_admin,false);
  check((await inbox()).items.some(x=>x.kind==='leave'),true);
  check((await inbox()).items.some(x=>x.kind==='correction'),true);
  await fail(()=>groups(),/Only full admins/);
  await login('outsider');
  check((await groups()).groups.length,4);
  check((await inbox()).total,0);
  await fail(()=>saveGroup(trainingGroup,[ids.outsider]),/not found in your organization/);
  await fail(()=>decide(otherPending),/not found in your organization/);
  check(await scalar("SELECT fn_has_staff_permission('leave.approve',$1)",[ids.org]),false);

  // Disabling, removal, and permission changes take effect on the very next operation.
  await login('admin'); await saveGroup(trainingGroup,[ids.trainer],trainingGroup.permissions,false);
  await login('trainer'); check((await mine()).permissions,[]);
  await fail(()=>schedule(),/Training managers/);
  await fail(()=>query('SELECT * FROM fn_training_employee_directory()'),/permission required/);
  check(await scalar('SELECT count(*)::int FROM training_sessions'),1); // Still sees own assignment.
  check(await scalar('SELECT count(*)::int FROM training_attendees'),1); // Other employee is hidden again.
  await login('admin'); await saveGroup(leaveGroup,[]);
  await login('leave'); await fail(()=>decide(otherPending),/authorized leave approver/);
  check((await mine()).permissions,[]);
  // Revoking an assignee must not strand their pending requests for other approvers.
  await login('staff'); await decide(ownLeave);
  await login('admin'); attendanceGroup=await group('attendance'); await saveGroup(attendanceGroup,[ids.attendance],['leave.approve']);
  await login('attendance');
  check((await mine()).permissions,['leave.approve']);
  await fail(()=>query("SELECT fn_decide_attendance_correction($1,'approve','')",[selfCorrection]),/authorized attendance approver/);

  // Trusted WhatsApp bridge enforces the same decisions, rather than service-role table updates.
  await service();
  await query('SELECT fn_service_decide_staff_leave($1,$2,$3,$4)',[ids.staff,otherPending,'approve','Approved via WhatsApp']);
  await fail(()=>query('SELECT fn_service_decide_staff_leave($1,$2,$3,$4)',[ids.leave,ownLeave,'approve','']),/permission required/);
  await root(); const selfStaff=await leave('staff','2090-03-03');
  await service(); await fail(()=>query('SELECT fn_service_decide_staff_leave($1,$2,$3,$4)',[ids.staff,selfStaff,'approve','']),/authorized leave approver/);
  await root();
  await query("INSERT INTO payroll_periods(organization_id,month,year,status) VALUES($1,4,2090,'draft')",[ids.org]);
  const lockedLeave=await leave('employee','2090-04-03');
  await db.exec('ALTER TABLE payroll_periods DISABLE TRIGGER ALL'); await query("UPDATE payroll_periods SET status='locked' WHERE month=4");
  await service(); await fail(()=>query('SELECT fn_service_decide_staff_leave($1,$2,$3,$4)',[ids.staff,lockedLeave,'approve','']),/Payroll is locked/);
  await login('employee'); await fail(()=>query('SELECT fn_service_decide_staff_leave($1,$2,$3,$4)',[ids.staff,lockedLeave,'approve','']),/permission denied/);
  await root(); await query('UPDATE users SET is_active=false WHERE id=$1',[ids.staff]);
  await login('staff'); await fail(()=>mine(),/Active organization membership/);
  await fail(()=>inbox(),/Authorized approvers/);
  await root(); await db.exec('SET ROLE anon'); await fail(()=>mine(),/permission denied/);
  console.log(`Staff access integration checks passed (${assertions} assertions).`);
} catch(error) { console.error(error.message,error.where || '',error.query || ''); process.exitCode=1; }
finally { await db.close(); }
