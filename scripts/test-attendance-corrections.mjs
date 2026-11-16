// Disposable PostgreSQL integration tests. No connection to a live Supabase project.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
let assertions = 0;
const sqlFile = path => readFile(new URL(`../supabase/migrations/${path}`, import.meta.url), 'utf8');
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params) => Object.values((await query(sql, params))[0])[0];
const expectFailure = async (fn, pattern) => { await assert.rejects(fn, pattern); assertions++; };
const check = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const ids = {
  org: '00000000-0000-0000-0000-000000000001', otherOrg: '00000000-0000-0000-0000-000000000002',
  employee: '10000000-0000-0000-0000-000000000001', admin: '10000000-0000-0000-0000-000000000002',
  outsider: '10000000-0000-0000-0000-000000000003', colleague: '10000000-0000-0000-0000-000000000004',
  superadmin: '10000000-0000-0000-0000-000000000005'
};
const login = async user => {
  await db.exec('RESET ROLE');
  await query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids[user]]);
  await db.exec('SET ROLE authenticated');
};
const root = () => db.exec('RESET ROLE');
const submit = async (date, start = '09:00', end = '18:00', session = null, reason = 'Forgot to punch correctly') =>
  scalar('SELECT fn_request_attendance_correction($1, $2, $3, $4, $5)', [date, `${date}T${start}:00+05:30`, `${date}T${end}:00+05:30`, reason, session]);
const decide = (id, action = 'approve', note = 'Verified with supervisor') => query('SELECT fn_decide_attendance_correction($1, $2, $3)', [id, action, note]);

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE TABLE organizations(id uuid PRIMARY KEY, name text);
    CREATE TABLE users(id uuid PRIMARY KEY, auth_id uuid, organization_id uuid REFERENCES organizations(id),
      name text, email text, department text DEFAULT 'Operations', role text, is_active boolean DEFAULT true);
    CREATE FUNCTION get_current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT id FROM users WHERE auth_id = auth.uid() $$;
    CREATE FUNCTION fn_admin_of_user(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT EXISTS(SELECT 1 FROM users a JOIN users u ON u.organization_id = a.organization_id
         WHERE a.auth_id = auth.uid() AND a.role IN ('admin','superadmin') AND u.id = p_user) $$;
  `);
  // Use the project's actual original tables, session triggers and punch audit.
  await db.exec(await sqlFile('20250821_create_hr_attendance_system.sql'));
  await db.exec(await sqlFile('add_shift_weekly_off_days.sql'));
  await db.exec(`
    ALTER TABLE shifts ADD COLUMN is_overnight boolean DEFAULT false;
    ALTER TABLE attendance ADD COLUMN is_half_day boolean DEFAULT false;
    ALTER TABLE attendance ADD COLUMN punch_in_distance_meters numeric;
    ALTER TABLE attendance ADD COLUMN punch_out_distance_meters numeric;
    ALTER TABLE attendance ADD COLUMN is_outside_geofence boolean DEFAULT false;
    CREATE TABLE payroll_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
      year numeric, month numeric, status text DEFAULT 'draft');
  `);
  await db.exec(await sqlFile('20261011020000_attendance_sessions.sql'));
  await db.exec(await sqlFile('20261011030000_multi_punch_setting.sql'));
  await db.exec(await sqlFile('20261014000000_punch_corrections.sql'));
  await db.exec('GRANT SELECT ON users, organizations TO authenticated');
  await db.exec(await sqlFile('20261112000000_attendance_correction_requests.sql'));
  const enhancedView = await sqlFile('20250922_create_enhanced_attendance_view.sql');
  await db.exec(enhancedView.split('-- Create function to get attendance')[0]);
  await db.exec(await sqlFile('20261112000001_attendance_session_dashboard_hours.sql'));
  await query('INSERT INTO organizations(id, name) VALUES ($1, $2), ($3, $4)', [ids.org, 'Test organization', ids.otherOrg, 'Other organization']);
  for (const [name, role, org] of [['employee', 'user', ids.org], ['admin', 'admin', ids.org], ['outsider', 'admin', ids.otherOrg], ['colleague', 'user', ids.org], ['superadmin', 'superadmin', ids.org]]) {
    await query('INSERT INTO users(id, auth_id, organization_id, name, role) VALUES ($1, $1, $2, $3, $4)', [ids[name], org, name, role]);
  }
  await login('employee');
  const missing = await submit('2025-11-03');
  await root();
  check(await scalar('SELECT count(*)::int FROM attendance'), 0); // Pending requests do not fabricate attendance.
  await login('employee');
  await expectFailure(() => submit('2025-11-03'), /already have a pending/);
  await expectFailure(() => decide(missing), /Another organization admin/);
  await expectFailure(() => submit('2025-11-04', '18:00', '09:00'), /completed punch times/);
  await expectFailure(() => submit('2099-11-04'), /completed punch times/);
  await expectFailure(() => submit('2025-11-04', '09:00', '18:00', null, '   '), /reason/);
  await expectFailure(() => query("UPDATE attendance_correction_requests SET status = 'approved' WHERE id = $1", [missing]), /permission denied/);
  await login('colleague');
  check(await scalar('SELECT count(*)::int FROM attendance_correction_requests'), 0);
  await expectFailure(() => decide(missing), /Another organization admin/);
  await login('outsider');
  check(await scalar('SELECT count(*)::int FROM attendance_correction_requests'), 0);
  await expectFailure(() => decide(missing), /not found in your organization/);
  await login('admin');
  await expectFailure(() => decide(missing, 'reject', ''), /why the request is rejected/);
  await decide(missing);
  await root();
  const [day] = await query('SELECT * FROM attendance WHERE user_id = $1 AND date = $2', [ids.employee, '2025-11-03']);
  check(Number(day.total_hours), 9);
  check(Number(day.effective_hours), 8);
  check(day.is_regularized, true);
  check(await scalar('SELECT count(*)::int FROM attendance_sessions WHERE attendance_id = $1', [day.id]), 1);
  check(await scalar('SELECT count(*)::int FROM attendance_punch_corrections WHERE attendance_id = $1', [day.id]), 1);
  await login('admin');
  await expectFailure(() => decide(missing), /already been decided/);

  // A session edit recalculates the parent without adding a second session.
  await root();
  const session = await scalar('SELECT id FROM attendance_sessions WHERE attendance_id = $1', [day.id]);
  await login('employee');
  await expectFailure(() => submit('2025-11-03', '08:00', '18:00'), /Select the session/);
  const edit = await submit('2025-11-03', '08:00', '18:00', session);
  await login('superadmin'); await decide(edit);
  await root();
  check(Number(await scalar('SELECT effective_hours FROM attendance WHERE id = $1', [day.id])), 9);
  check(await scalar('SELECT count(*)::int FROM attendance_sessions WHERE attendance_id = $1', [day.id]), 1);

  // Stale snapshots must not overwrite a newer punch or admin correction.
  await login('employee'); const stale = await submit('2025-11-03', '07:00', '18:00', session);
  await root(); await query('UPDATE attendance_sessions SET punch_out_time = $1 WHERE id = $2', ['2025-11-03T17:00:00+05:30', session]);
  await login('admin'); await expectFailure(() => decide(stale), /Attendance changed/);
  await decide(stale, 'reject', 'Recorded punches changed; please resubmit');

  await login('employee'); const cancelled = await submit('2025-11-04');
  await login('admin'); await expectFailure(() => decide(cancelled, 'cancel'), /only cancel your own/);
  await login('employee'); await decide(cancelled, 'cancel', 'No longer needed');
  const rejected = await submit('2025-11-04');
  await login('admin'); await decide(rejected, 'reject', 'Please confirm actual work times');
  await root();
  check(await scalar("SELECT count(*)::int FROM attendance WHERE date = '2025-11-04'"), 0);

  // Payroll lock protection is checked both when requesting and when approving.
  await query('INSERT INTO payroll_periods(organization_id, year, month, status) VALUES ($1, 2025, 12, $2)', [ids.org, 'locked']);
  await login('employee'); await expectFailure(() => submit('2025-12-03'), /Payroll.*locked/);
  await root(); await db.exec("UPDATE payroll_periods SET status = 'draft'");
  await login('employee'); const payroll = await submit('2025-12-03');
  await root(); await db.exec("UPDATE payroll_periods SET status = 'posted'");
  await login('admin'); await expectFailure(() => decide(payroll), /Payroll.*locked/);
  await root(); check(await scalar("SELECT count(*)::int FROM attendance WHERE date = '2025-12-03'"), 0);

  // Legacy days are edited in place and preserve unrelated evidence.
  const legacy = await scalar(`INSERT INTO attendance(user_id, organization_id, date, punch_in_time, punch_out_time, punch_in_selfie_url)
    VALUES ($1, $2, '2025-11-05', '2025-11-05T09:00:00+05:30', '2025-11-05T17:00:00+05:30', 'original-photo') RETURNING id`, [ids.employee, ids.org]);
  await login('employee'); const legacyEdit = await submit('2025-11-05');
  await login('admin'); await decide(legacyEdit);
  await root();
  check(await scalar('SELECT punch_in_selfie_url FROM attendance WHERE id = $1', [legacy]), 'original-photo');
  check(Number(await scalar('SELECT effective_hours FROM attendance WHERE id = $1', [legacy])), 8);

  // Overnight requests retain the shift date, and cannot overlap another day.
  await login('employee');
  const overnight = await scalar('SELECT fn_request_attendance_correction($1, $2, $3, $4)', ['2025-11-06', '2025-11-06T22:00:00+05:30', '2025-11-07T06:00:00+05:30', 'Missed overnight punches']);
  await login('admin'); await decide(overnight);
  await login('employee'); const overlap = await submit('2025-11-07', '05:00', '12:00');
  await login('admin'); await expectFailure(() => decide(overlap), /overlap another attendance session/);
  await root();
  check(await scalar("SELECT date::text FROM attendance WHERE user_id = $1 AND date = '2025-11-06'", [ids.employee]), '2025-11-06');

  // Editing one of several sessions must preserve the other session and count
  // only hours actually worked (gaps between sessions remain unpaid breaks).
  await query('UPDATE users SET allow_multiple_punches = true WHERE id = $1', [ids.employee]);
  const multipleDay = await scalar("INSERT INTO attendance(user_id, organization_id, date) VALUES ($1, $2, '2025-11-10') RETURNING id", [ids.employee, ids.org]);
  const firstSession = await scalar(`INSERT INTO attendance_sessions(attendance_id,user_id,organization_id,date,punch_in_time,punch_out_time)
    VALUES ($1,$2,$3,'2025-11-10','2025-11-10T09:00:00+05:30','2025-11-10T12:00:00+05:30') RETURNING id`, [multipleDay, ids.employee, ids.org]);
  await query(`INSERT INTO attendance_sessions(attendance_id,user_id,organization_id,date,punch_in_time,punch_out_time)
    VALUES ($1,$2,$3,'2025-11-10','2025-11-10T14:00:00+05:30','2025-11-10T18:00:00+05:30')`, [multipleDay, ids.employee, ids.org]);
  await login('employee'); const multipleEdit = await submit('2025-11-10', '08:00', '12:00', firstSession);
  await login('admin'); await decide(multipleEdit);
  await root();
  check(Number(await scalar('SELECT effective_hours FROM attendance WHERE id = $1', [multipleDay])), 8);
  check(await scalar('SELECT count(*)::int FROM attendance_sessions WHERE attendance_id = $1', [multipleDay]), 2);
  await login('admin');
  check(Number(await scalar("SELECT effective_hours FROM get_attendance_with_details($1, '2025-11-10') WHERE user_id = $2", [ids.org, ids.employee])), 8);
  await login('colleague');
  check(await scalar("SELECT count(*)::int FROM get_attendance_with_details($1, '2025-11-10') WHERE user_id = $2", [ids.org, ids.employee]), 0);
  await login('outsider');
  await expectFailure(() => query("SELECT * FROM get_attendance_with_details($1, '2025-11-10')", [ids.org]), /cannot access attendance/);
  await login('employee'); const sessionOverlap = await submit('2025-11-10', '08:00', '15:00', firstSession);
  await login('admin'); await expectFailure(() => decide(sessionOverlap), /overlap another attendance session/);
  await root(); check(Number(await scalar('SELECT effective_hours FROM attendance WHERE id = $1', [multipleDay])), 8);

  // Empty-role and inactive accounts cannot approve an employee's request.
  await query('UPDATE users SET role = NULL WHERE id = $1', [ids.colleague]);
  await login('colleague'); await expectFailure(() => decide(sessionOverlap), /Another organization admin/);
  await root(); await query('UPDATE users SET is_active = false WHERE id = $1', [ids.employee]);
  await login('employee'); await expectFailure(() => submit('2025-11-11'), /Active organization membership/);
  await login('admin'); await expectFailure(() => decide(sessionOverlap), /no longer active/);
  const selfRequest = await submit('2025-11-12');
  await expectFailure(() => decide(selfRequest), /Another organization admin/);
  await db.exec('SET ROLE anon');
  await expectFailure(() => scalar('SELECT fn_request_attendance_correction($1, $2, $3, $4)', ['2025-11-08', '2025-11-08T09:00:00Z', '2025-11-08T18:00:00Z', 'Not signed in']), /permission denied/);
  console.log(`Attendance correction database checks passed (${assertions} assertions).`);
} finally {
  await db.close();
}
