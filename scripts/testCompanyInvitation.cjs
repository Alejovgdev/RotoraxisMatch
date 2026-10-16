// Invitar a un email nuevo al equipo de una empresa y el primer inicio de sesión
// del invitado, contra la base de desarrollo, todo dentro de BEGIN … ROLLBACK
// (scripts/testCompanyInvitation.sql). No envía correos ni inicia sesión.
//
// El rol de alta que se prueba es el que manda de verdad la función
// invite-company-member (se lee de su código). Control negativo: con el rol
// antiguo `company_user` la invitación tiene que fallar, como ocurría desde la
// 102. Al terminar comprueba que no quedó nada.
//
// Run via: npm run test:company-invitation:database
const fs = require('node:fs');
const path = require('node:path');
require('./lib/devDatabaseGuard.cjs').assertDevDatabase();
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const env = Object.fromEntries(read('.env').split(/\r?\n/).filter(s => /^[A-Z_]+=/.test(s)).map(s => {
  const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
const token = process.env.SUPABASE_TEST_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_ACCESS_TOKEN;
const host = new URL(env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL).hostname;
assert.match(host, /^[a-z0-9]+\.supabase\.co$/);
assert.ok(token, 'Missing administrative test token');

const CASES = 13;
const fn = read('supabase/functions/invite-company-member/index.ts');
const sent = /inviteUserByEmail\(email,\s*\{\s*data:\s*\{\s*role:\s*'([a-z_]+)'\s*\}/.exec(fn);
assert.ok(sent, 'Could not find the signup role sent by inviteUserByEmail');
const inviteRole = sent[1];

const sql = read('scripts/testCompanyInvitation.sql');
assert.match(sql, /\bBEGIN;/); assert.match(sql, /ROLLBACK;\s*$/);
const body = sql.replace(/\bBEGIN;/, '').replace(/ROLLBACK;\s*$/, '');

async function query(text) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${host.split('.')[0]}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: text }), signal: AbortSignal.timeout(60000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.message ?? 'SQL failed'}`);
  return data;
}
function run(role) {
  assert.match(role, /^[a-z_]+$/);
  return query(`BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL app.invite_signup_role='${role}';\n${body}\nROLLBACK;`);
}
const STATE = `SELECT (SELECT count(*) FROM auth.users) AS users, (SELECT count(*) FROM profiles) AS profiles,
  (SELECT count(*) FROM companies) AS companies, (SELECT count(*) FROM company_members) AS members,
  (SELECT count(*) FROM auth.users WHERE email LIKE 'invite-test-%') AS leftovers`;

async function main() {
  const [before] = await query(STATE);
  try {
    console.log(`Role sent by invite-company-member: "${inviteRole}"`);
    const rows = await run(inviteRole);
    rows.forEach(r => console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.test}${r.passed ? '' : ` [${r.observed}]`}`));
    assert.equal(rows.length, CASES, 'Missing test results');
    assert.deepEqual(rows.filter(r => r.passed !== true), [], 'Invitation test failures');
    console.log(`PASS invitation and first sign-in: ${rows.length}/${CASES}`);

    const legacy = await run('company_user');
    const accepted = legacy.find(r => r.test.startsWith('the invitation signup role'));
    assert.ok(accepted && accepted.passed === false && /^22023:/.test(accepted.observed),
      `Negative control did not reproduce the failure: ${JSON.stringify(accepted)}`);
    console.log(`PASS negative control: the old role is rejected (${accepted.observed.split(':').slice(0, 2).join(':')}).`);
  } finally {
    const [after] = await query(STATE);
    assert.deepEqual(after, before, 'The rollback left data behind');
    assert.equal(Number(after.leftovers), 0);
    console.log('PASS rollback: auth users, profiles, companies and members unchanged.');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
