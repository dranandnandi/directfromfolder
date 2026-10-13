(async () => {
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]; }));
const base = (env.VITE_EXTERNAL_WA_API_URL || '').replace(/\/+$/, '');
const apiKey = env.VITE_EXTERNAL_WA_API_KEY || '';
const ORG_ID = '328c8228-4ab8-4d7e-94e6-6615158eb1ca';
const USER = { id: '286094db-9fba-4795-8622-6ad5c5d47efa', name: 'Dr Rutvik', email: 'rutvik3129@gmail.com', role: 'admin' };
async function call(path, body, method='POST') {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, body: body ? JSON.stringify(body) : undefined });
  const p = await r.json().catch(() => null);
  if (!r.ok || p?.success === false) throw new Error(`${path} -> ${r.status}: ${p?.error || JSON.stringify(p)}`);
  return p?.data;
}
console.log('sync-admins:', JSON.stringify(await call('/api/external/users/sync-admins', { organizationId: ORG_ID, admins: [USER] })));
console.log('handshake:', JSON.stringify(await call('/api/external/users/sync', { id: USER.id })));
console.log('status:', JSON.stringify(await call(`/api/users/${USER.id}/whatsapp/status`, null, 'GET').catch(e => ({ error: e.message }))));
})().catch(e => { console.error(e.message); process.exit(1); });
