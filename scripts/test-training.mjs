import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

const db = new PGlite();
let assertions = 0;
const ids = {
  org: '00000000-0000-0000-0000-000000000001', other: '00000000-0000-0000-0000-000000000002',
  admin: '10000000-0000-0000-0000-000000000001', employee: '10000000-0000-0000-0000-000000000002',
  colleague: '10000000-0000-0000-0000-000000000003', outsider: '10000000-0000-0000-0000-000000000004',
  inactive: '10000000-0000-0000-0000-000000000005', norole: '10000000-0000-0000-0000-000000000006',
  material: '20000000-0000-0000-0000-000000000001', foreignMaterial: '20000000-0000-0000-0000-000000000002',
};
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params = []) => Object.values((await query(sql, params))[0])[0];
const check = (value, expected) => { assert.deepEqual(value, expected); assertions++; };
const fail = async (action, pattern) => { await assert.rejects(action, pattern); assertions++; };
const root = () => db.exec('RESET ROLE');
const login = async name => {
  await root();
  await query("SELECT set_config('request.jwt.claim.sub',$1,false)", [ids[name] || '']);
  await db.exec('SET ROLE authenticated');
};
const input = (extra = {}) => ({ title: 'Safety induction', description: 'Practical instruction', trainer: 'Trainer',
  location: 'Training room', starts_at: '2025-01-03T09:00:00+05:30', ends_at: '2025-01-03T10:00:00+05:30', ...extra });
const save = (value = input(), attendees = [ids.employee, ids.colleague], id = null, expected = null) =>
  scalar('SELECT fn_save_training_session($1::jsonb,$2::uuid[],$3::uuid,$4::timestamptz)', [JSON.stringify(value), attendees, id, expected]);
const session = id => scalar('SELECT to_jsonb(s) FROM training_sessions s WHERE id=$1', [id]);
const attendee = (id, user = ids.employee) => scalar('SELECT to_jsonb(a) FROM training_attendees a WHERE session_id=$1 AND user_id=$2', [id, user]);
const record = (a, attendance = 'attended', completion = 'completed', notes = '') => query(
  'SELECT fn_record_training_attendee($1,$2,$3,$4,$5::timestamptz)', [a.id, attendance, completion, notes, a.updated_at]);
const status = (s, value) => query('SELECT fn_set_training_session_status($1,$2,$3::timestamptz)', [s.id, value, s.updated_at]);

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TABLE organizations(id uuid PRIMARY KEY);
    CREATE TABLE users(id uuid PRIMARY KEY,auth_id uuid,organization_id uuid,name text,department text,role text,is_active boolean);
    CREATE TABLE organization_documents(id uuid PRIMARY KEY,organization_id uuid,deleted_at timestamptz);
    GRANT SELECT ON users TO authenticated;
  `);
  await query('INSERT INTO organizations VALUES ($1),($2)', [ids.org, ids.other]);
  for (const [name, role, org, active] of [['admin','admin',ids.org,true],['employee','user',ids.org,true],
    ['colleague','user',ids.org,true],['outsider','superadmin',ids.other,true],['inactive','admin',ids.org,false],['norole',null,ids.org,true]]) {
    await query('INSERT INTO users VALUES ($1,$1,$2,$3,$4,$5,$6)', [ids[name], org, name, 'Operations', role, active]);
  }
  await query('INSERT INTO organization_documents VALUES ($1,$2,NULL),($3,$4,NULL)', [ids.material,ids.org,ids.foreignMaterial,ids.other]);
  await db.exec(await readFile(new URL('../supabase/migrations/20261116000000_training_management.sql', import.meta.url), 'utf8'));

  await login('employee'); await fail(() => save(), /Only active organization admins/);
  await login('inactive'); await fail(() => save(), /Only active organization admins/);
  await login('norole'); await fail(() => save(), /Only active organization admins/);
  await login('admin');
  await fail(() => save(input({ title: ' ' })), /title and a valid/);
  await fail(() => save(input({ ends_at: '2025-01-02T09:00:00Z' })), /valid training date range/);
  await fail(() => save(input(), []), /at least one attendee/);
  await fail(() => save(input(), [ids.outsider]), /active members/);
  await fail(() => save(input(), [null]), /active members/);
  await fail(() => save(input(), [ids.inactive]), /active members/);
  await fail(() => save(input({ material_document_id: ids.foreignMaterial })), /document from your organization/);
  check(await scalar('SELECT count(*)::int FROM training_sessions'), 0);
  const id = await save(input({ material_document_id: ids.material }), [ids.employee, ids.colleague, ids.employee]);
  let s = await session(id);
  check(s.organization_id, ids.org);
  check(await scalar('SELECT count(*)::int FROM training_attendees'), 2);
  check(await scalar('SELECT count(*)::int FROM training_events'), 3);
  await fail(() => save(input(), [ids.employee, ids.colleague], id, null), /session changed/);
  await fail(() => status(s, 'completed'), /record attendance/);
  await fail(() => query("UPDATE training_sessions SET title='Forged' WHERE id=$1", [id]), /permission denied/);
  await fail(() => query("UPDATE training_attendees SET completion_status='completed'"), /permission denied/);
  await fail(() => query('DELETE FROM training_events'), /permission denied/);

  let a = await attendee(id);
  await login('employee');
  check(await scalar('SELECT count(*)::int FROM training_sessions'), 1);
  check(await scalar('SELECT count(*)::int FROM training_attendees'), 1);
  check(await scalar('SELECT count(*)::int FROM training_events'), 2); // Session + own assignment only.
  await fail(() => record(a), /Only active organization admins/);
  await fail(() => status(s, 'cancelled'), /Only active organization admins/);
  await login('outsider');
  check(await scalar('SELECT count(*)::int FROM training_sessions'), 0);
  check(await scalar('SELECT count(*)::int FROM training_attendees'), 0);
  check(await scalar('SELECT count(*)::int FROM training_events'), 0);
  await fail(() => record(a), /not found in your organization/);
  await fail(() => status(s, 'cancelled'), /not found in your organization/);
  await fail(() => save(input(), [ids.outsider], id, s.updated_at), /not found in your organization/);
  await login('norole');
  await fail(() => record(a), /Only active organization admins/);
  await fail(() => status(s, 'cancelled'), /Only active organization admins/);
  await login('admin');
  await fail(() => record(a, 'absent', 'completed'), /Mark the attendee as attended/);
  await fail(() => record(a, 'attended', 'invalid'), /Invalid attendance/);
  await record(a, 'attended', 'in_progress', 'Practical assessment pending');
  await fail(() => record(a), /attendee record changed/);
  a = await attendee(id);
  check(a.completed_at, null);
  check(a.completion_status, 'in_progress');
  await fail(() => status(s, 'cancelled'), /attendance records cannot be cancelled/);
  await fail(() => save(input(), [ids.colleague], id, s.updated_at), /recorded activity cannot be removed/);
  await fail(() => save(input({ starts_at: '2025-01-03T08:00:00+05:30' }), [ids.employee, ids.colleague], id, s.updated_at), /Dates cannot change/);
  await record(a);
  a = await attendee(id);
  check(a.completed_at !== null, true);
  const completionDate = a.completed_at;
  await record(a, 'attended', 'completed', 'Passed');
  a = await attendee(id);
  check(a.completed_at, completionDate); // Notes do not rewrite completion date.
  await record(a, 'absent', 'pending', 'Correction: attendee was absent');
  a = await attendee(id);
  check(a.completed_at, null);
  check(await scalar("SELECT count(*)::int FROM training_events WHERE event_type='attendee_updated'"), 4);
  await record(a, 'attended', 'completed', 'Confirmed attendance and assessment');
  const colleague = await attendee(id, ids.colleague);
  await record(colleague, 'excused', 'pending', 'On leave');
  await status(s, 'completed');
  s = await session(id);
  check(s.status, 'completed');
  check((await attendee(id, ids.colleague)).completion_status, 'pending'); // Session close does not imply completion.
  await fail(async () => record(await attendee(id), 'invited', 'pending'), /must retain/);
  await fail(() => save(input(), [ids.employee, ids.colleague], id, s.updated_at), /Only scheduled/);
  await record(await attendee(id), 'attended', 'completed', 'Final verified note');
  await login('employee');
  check((await attendee(id)).notes, 'Final verified note');
  check(await scalar('SELECT count(*)::int FROM training_events WHERE user_id=$1', [ids.colleague]), 0);

  await login('admin');
  const future = await save(input({ starts_at: '2090-01-03T09:00:00Z', ends_at: '2090-01-03T10:00:00Z' }));
  await fail(async () => record(await attendee(future)), /once training starts/);
  await fail(async () => status(await session(future), 'completed'), /Wait until training ends/);
  let futureSession = await session(future);
  await save(input({ title: 'Rescheduled', starts_at: '2090-01-04T09:00:00Z', ends_at: '2090-01-04T10:00:00Z' }), [ids.employee], future, futureSession.updated_at);
  await fail(() => status(futureSession, 'cancelled'), /session changed/);
  check(await scalar('SELECT count(*)::int FROM training_attendees WHERE session_id=$1', [future]), 1);
  check(await scalar("SELECT count(*)::int FROM training_events WHERE session_id=$1 AND event_type='attendee_removed'", [future]), 1);
  futureSession = await session(future);
  check(futureSession.title, 'Rescheduled');
  await status(futureSession, 'cancelled');
  check((await session(future)).status, 'cancelled');
  await fail(async () => record(await attendee(future)), /Cancelled training/);

  // A notes-only record must also survive schedule edits.
  const noted = await save(input(), [ids.employee]);
  await record(await attendee(noted), 'invited', 'pending', 'Needs wheelchair access');
  await fail(async () => save(input(), [ids.colleague], noted, (await session(noted)).updated_at), /recorded activity cannot be removed/);
  await root(); await query('UPDATE users SET is_active=false WHERE id=$1', [ids.employee]);
  await login('employee');
  check(await scalar('SELECT count(*)::int FROM training_sessions'), 0);
  check(await scalar('SELECT count(*)::int FROM training_attendees'), 0);
  await login('admin'); // Inactive attendees can be retained in existing sessions.
  await save(input({ title: 'Keep history' }), [ids.employee], noted, (await session(noted)).updated_at);
  await login('inactive');
  await fail(() => record(a), /Only active organization admins/);
  await root(); await db.exec('SET ROLE anon');
  await fail(() => query('SELECT * FROM training_sessions'), /permission denied/);
  await fail(() => save(), /permission denied/);

  const source = await readFile(new URL('../src/utils/training.ts', import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  const { trainingSummary, trainingCsv, localTrainingDateTime } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
  const sessions = [{ id: 'one', title: '=Formula', trainer: 'Trainer', status: 'scheduled', starts_at: '2025-01-03T09:00:00Z', ends_at: '2025-01-03T10:00:00Z' },
    { id: 'two', title: 'Cancelled', status: 'cancelled' }];
  const assignments = [{ session_id: 'one', employee_name: 'A,"B"', department: 'Ops', attendance_status: 'attended', completion_status: 'completed', completed_at: '2025-01-03T10:00:00Z', notes: '@malicious' },
    { session_id: 'two', attendance_status: 'invited', completion_status: 'pending' }];
  check(trainingSummary(assignments, sessions), { assigned: 1, attended: 1, completed: 1, outstanding: 0 });
  check(trainingSummary([], sessions), { assigned: 0, attended: 0, completed: 0, outstanding: 0 });
  const csv = trainingCsv([sessions[0]], [assignments[0]]);
  check(csv.includes('"A,""B"""'), true);
  check(csv.includes('"\'=Formula"'), true);
  check(csv.includes('"\'@malicious"'), true);
  check(csv.startsWith('\uFEFF'), true);
  const iso = '2025-01-03T09:30:00.000Z';
  check(new Date(localTrainingDateTime(iso)).toISOString(), iso);

  console.log(`Training database checks passed (${assertions} assertions).`);
} catch (error) {
  console.error(error.message, error.where || '', error.query || '');
  process.exitCode = 1;
} finally { await db.close(); }
