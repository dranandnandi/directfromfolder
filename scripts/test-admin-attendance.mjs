// Disposable database checks against the real attendance tables and triggers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const sqlFile = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params) => Object.values((await query(sql, params))[0])[0];
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const fails = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
const ids = {
  org: '00000000-0000-0000-0000-000000000001', otherOrg: '00000000-0000-0000-0000-000000000002',
  employee: '10000000-0000-0000-0000-000000000001', admin: '10000000-0000-0000-0000-000000000002',
  outsider: '10000000-0000-0000-0000-000000000003', colleague: '10000000-0000-0000-0000-000000000004',
  superadmin: '10000000-0000-0000-0000-000000000005', payroll: '10000000-0000-0000-0000-000000000006',
};
const root = () => db.exec('RESET ROLE');
const login = async user => {
  await root();
  await query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids[user]]);
  await db.exec('SET ROLE authenticated');
};
const mark = (action, date, time, user = 'employee', reason = 'Marked by admin after verification') =>
  scalar('SELECT fn_admin_mark_attendance_punch($1, $2, $3, $4, $5)', [ids[user], date, action, `${date}T${time}+05:30`, reason]);
const day = async date => (await query('SELECT * FROM attendance WHERE user_id = $1 AND date = $2', [ids.employee, date]))[0];

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE organizations(id uuid PRIMARY KEY, name text, geofence_settings jsonb);
    CREATE TABLE users(id uuid PRIMARY KEY, auth_id uuid, organization_id uuid REFERENCES organizations(id),
      name text, email text, department text, role text, is_active boolean DEFAULT true);
    CREATE FUNCTION get_current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT id FROM users WHERE auth_id = auth.uid() $$;
    CREATE FUNCTION fn_admin_of_user(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT EXISTS(SELECT 1 FROM users a JOIN users u ON u.organization_id = a.organization_id
         WHERE a.auth_id = auth.uid() AND a.role IN ('admin','superadmin') AND u.id = p_user) $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  `);
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
  for (const migration of ['20261011020000_attendance_sessions.sql', '20261011030000_multi_punch_setting.sql',
    '20261014000000_punch_corrections.sql', '20261112000000_attendance_correction_requests.sql',
    '20261114000000_admin_mark_attendance.sql']) await db.exec(await sqlFile(migration));
  await query(`INSERT INTO organizations(id, name, geofence_settings) VALUES
    ($1, 'Strict geofence', '{"enabled":true,"enforcement_mode":"strict","distance_threshold_meters":1}'),
    ($2, 'Other organization', '{}')`, [ids.org, ids.otherOrg]);
  for (const [name, role, org] of [['employee', 'user', ids.org], ['admin', 'admin', ids.org],
    ['outsider', 'admin', ids.otherOrg], ['colleague', 'user', ids.org],
    ['superadmin', 'superadmin', ids.org], ['payroll', 'payroll_admin', ids.org]]) {
    await query('INSERT INTO users(id, auth_id, organization_id, name, role) VALUES ($1, $1, $2, $3, $4)', [ids[name], org, name, role]);
  }

  // Both actions enforce the server-side role and organization boundary.
  for (const actor of ['employee', 'colleague', 'payroll']) {
    await login(actor);
    for (const action of ['in', 'out']) await fails(() => mark(action, '2025-11-03', '09:00'), /Only an active organization admin/);
  }
  await login('outsider');
  for (const action of ['in', 'out']) await fails(() => mark(action, '2025-11-03', '09:00'), /not found in your organization/);
  await db.exec('SET ROLE anon');
  await fails(() => mark('in', '2025-11-03', '09:00'), /permission denied/);
  await login('admin');
  await fails(() => mark('in', '2099-11-03', '09:00'), /not in the future/);
  await fails(() => mark('bad', '2025-11-03', '09:00'), /valid action/);
  await fails(() => mark('in', '2025-11-03', '09:00', 'employee', ' '), /reason/);
  await fails(() => mark('out', '2025-11-03', '18:00'), /No active punch-in/);

  // No location or selfie is provided, even for an organization with strict geofencing.
  const first = await mark('in', '2025-11-03', '09:00');
  await fails(() => mark('in', '2025-11-03', '10:00'), /already punched in/);
  await fails(() => mark('in', '2025-11-04', '09:00'), /already punched in/);
  await fails(() => mark('out', '2025-11-03', '08:00'), /after punch-in/);
  await mark('out', '2025-11-03', '18:00');
  await fails(() => mark('out', '2025-11-03', '19:00'), /No active punch-in/);
  await root();
  const record = await day('2025-11-03');
  check(record.id, first);
  check(Number(record.total_hours), 9);
  check(Number(record.effective_hours), 8);
  check(record.session_count, 1);
  check(record.is_absent, false);
  for (const field of ['punch_in_latitude', 'punch_in_longitude', 'punch_in_address', 'punch_in_selfie_url',
    'punch_in_distance_meters', 'punch_out_latitude', 'punch_out_longitude', 'punch_out_address',
    'punch_out_selfie_url', 'punch_out_distance_meters']) check(record[field], null);
  const audits = await query('SELECT * FROM attendance_punch_corrections ORDER BY action');
  check(audits.map(a => a.action), ['admin_punch_in', 'admin_punch_out']);
  check(audits.every(a => a.performed_by === ids.admin && a.reason && a.snapshot.before && a.snapshot.after), true);
  check(record.punch_in_device_info.source, 'admin');
  check(record.punch_out_device_info.marked_by, ids.admin);

  // Existing multiple-punch policy and session-based hour calculation are respected.
  await login('admin');
  await fails(() => mark('in', '2025-11-03', '19:00'), /Multiple punches/);
  await root(); await query('UPDATE users SET allow_multiple_punches = true WHERE id = $1', [ids.employee]);
  await login('superadmin');
  await mark('in', '2025-11-03', '19:00'); await mark('out', '2025-11-03', '20:00');
  await root();
  check((await day('2025-11-03')).session_count, 2);
  check(Number((await day('2025-11-03')).effective_hours), 10);
  await login('admin');
  await fails(() => mark('in', '2025-11-03', '19:30'), /overlaps/);

  // Backdated and overnight sessions keep their selected attendance date.
  await mark('in', '2025-11-02', '22:00');
  await scalar('SELECT fn_admin_mark_attendance_punch($1, $2, $3, $4, $5)',
    [ids.employee, '2025-11-02', 'out', '2025-11-03T06:00:00+05:30', 'Overnight work verified']);
  await root(); check(Number((await day('2025-11-02')).total_hours), 8);
  await login('admin');
  await mark('in', '2025-11-04', '09:00');
  await fails(() => scalar('SELECT fn_admin_mark_attendance_punch($1, $2, $3, $4, $5)',
    [ids.employee, '2025-11-04', 'out', '2025-11-05T10:00:00+05:30', 'Long work verified']), /within 24 hours/);
  await mark('out', '2025-11-04', '18:00');

  // Legacy day-only punches keep their original GPS and selfie evidence.
  await root();
  await query(`INSERT INTO attendance(user_id, organization_id, date, punch_in_time,
    punch_in_latitude, punch_in_longitude, punch_in_selfie_url, is_outside_geofence)
    VALUES($1, $2, '2025-11-05', '2025-11-05T09:00:00+05:30', 23, 72, 'original-selfie', true)`, [ids.employee, ids.org]);
  await login('admin'); await mark('out', '2025-11-05', '18:00');
  await root();
  const legacy = await day('2025-11-05');
  check(legacy.session_count, 1);
  check(legacy.punch_in_selfie_url, 'original-selfie');
  check(Number(legacy.punch_in_latitude), 23);
  check(legacy.is_outside_geofence, true);
  check(legacy.punch_out_latitude, null);

  // Finalized payroll and inactive accounts cannot be changed by the new RPC.
  await query("INSERT INTO payroll_periods(organization_id, year, month, status) VALUES ($1, 2025, 12, 'locked')", [ids.org]);
  await login('admin'); await fails(() => mark('in', '2025-12-03', '09:00'), /Payroll.*locked/);
  await root(); await query('UPDATE users SET is_active = false WHERE id = $1', [ids.employee]);
  await login('admin'); await fails(() => mark('in', '2025-11-06', '09:00'), /not found in your organization/);
  await root(); await query('UPDATE users SET is_active = false WHERE id = $1', [ids.admin]);
  await login('admin'); await fails(() => mark('in', '2025-11-06', '09:00'), /Only an active organization admin/);
  await root();
  check(await scalar("SELECT count(*)::int FROM attendance WHERE date = '2025-11-06' OR date = '2025-12-03'"), 0);
  console.log(`Admin attendance database checks passed (${checks} assertions).`);
} finally {
  await db.close();
}
