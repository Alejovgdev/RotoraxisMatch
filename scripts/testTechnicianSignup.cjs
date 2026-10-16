// Default: check installed behaviour. --rehearse: test migration 101 inside
// ROLLBACK, including its undo and existing security/write regressions.
const fs = require('node:fs');
const path = require('node:path');
require('./lib/devDatabaseGuard.cjs').assertDevDatabase();
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const env = Object.fromEntries(read('.env').split(/\r?\n/).filter(s => /^[A-Z_]+=/.test(s)).map(s => {
  const i = s.indexOf('='); return [s.slice(0,i), s.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];
}));
const token = process.env.SUPABASE_TEST_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_ACCESS_TOKEN;
const host = new URL(env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL).hostname;
assert.match(host, /^[a-z0-9]+\.supabase\.co$/);
assert.ok(token, 'Missing administrative test token');
const rehearse = process.argv.includes('--rehearse');
const migration = read('supabase/migrations/101_auto_approve_new_technicians.sql');
const down = read('supabase/rollbacks/101_auto_approve_new_technicians.down.sql')
  .replace(/\bBEGIN;/, '').replace(/COMMIT;\s*$/, '');
const suite = file => {
  const sql = read(`scripts/${file}`);
  assert.match(sql, /\bBEGIN;/); assert.match(sql, /ROLLBACK;\s*$/);
  return sql.replace(/\bBEGIN;/, '').replace(/ROLLBACK;\s*$/, '');
};
async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${host.split('.')[0]}/database/query`, {
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql}), signal:AbortSignal.timeout(60000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.message ?? 'SQL failed'}`);
  return data;
}
const rolledBack = sql => query(`BEGIN; SET LOCAL lock_timeout='3s';\n${sql}\nROLLBACK;`);
// Fingerprint data and history without returning any personal data. Function
// CRLF/LF differences are ignored when comparing the restored definitions.
const schemaSnapshot = `SELECT md5(jsonb_build_object(
  'functions',(SELECT jsonb_agg(replace(pg_get_functiondef(oid),chr(13),'') ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'),
  'acl',(SELECT jsonb_agg(coalesce(proacl::text,'') ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace),
  'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage'))
)::text) AS hash`;
async function main() {
  const [state] = await query(`SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name='101_auto_approve_new_technicians') AS installed,
    EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='102_signup_role_guards') AS roles_secure`);
  assert.equal(state.installed,!rehearse,rehearse
    ? '101 is already installed: run without --rehearse; never replay it'
    : '101 is not installed: use --rehearse first');
  const tables = await query(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public'
    OR (schemaname='auth' AND tablename='users')
    OR (schemaname='supabase_migrations' AND tablename='schema_migrations') ORDER BY schemaname,tablename`);
  const dataSnapshot = tables.map(({schemaname:s,tablename:t}) => {
    assert.match(s,/^[a-z_]+$/); assert.match(t,/^[a-z0-9_]+$/);
    return `SELECT '${s}.${t}' AS item,md5(coalesce(jsonb_agg(j ORDER BY j::text)::text,'[]')) AS hash FROM (SELECT to_jsonb(x) j FROM "${s}"."${t}" x) q`;
  }).join('\nUNION ALL\n')+'\nORDER BY item';
  const beforeData = await query(dataSnapshot);
  const beforeSchema = await query(schemaSnapshot);
  const candidate = `SET LOCAL app.signup_roles_secure='${state.roles_secure}';\n`+(rehearse ? migration : '');
  try {
    const rows = await rolledBack(candidate+'\n'+suite('testTechnicianSignup.sql'));
    const checks = rows.filter(r => r.kind==='test');
    assert.equal(checks.length,25,'Missing signup checks');
    assert.ok(checks.every(r => r.passed===true));
    checks.forEach(r => console.log(`PASS ${r.test}`));
    rows.filter(r => r.kind==='audit').forEach(r => console.log(`AUDIT ${r.test}: ${r.observed}`));
    for (const [file,count] of [['testApplicationSecurity.sql',23],['testTransactionalWrites.sql',27]]) {
      const results = await rolledBack(candidate+'\n'+suite(file));
      assert.equal(results.length,count); assert.ok(results.every(r => r.passed===true),JSON.stringify(results.filter(r => !r.passed)));
      console.log(`PASS ${file}: ${count}/${count}`);
    }
    if (rehearse) {
      for (const [label,from,to,expected] of [
        ['companies accidentally activated', "v_role = 'technician'::app_role", "v_role IN ('technician'::app_role,'company_user'::app_role)", 'new company account stays pending'],
        ['old pending profiles auto-verified', " AND status = 'active'", '', 'delayed profile of an older pending technician stays pending'],
        ['all active roles auto-verified', " AND role = 'technician'", '', 'active company role does not get an auto-verified technician profile'],
      ]) {
        assert.ok(migration.includes(from),`Missing mutation target: ${label}`);
        let errorMessage='';
        try { await rolledBack(migration.replace(from,to)+'\n'+suite('testTechnicianSignup.sql')); }
        catch (error) { errorMessage=error.message; }
        assert.ok(errorMessage.includes(`Signup test failed: ${expected}`),`Missed negative control: ${label}: ${errorMessage}`);
        console.log(`PASS negative control: ${label}`);
      }
      const undoChecks = await rolledBack(`${migration}\n${suite('testTechnicianSignup.sql')}
        ${down}
        DO $$ DECLARE u uuid:=gen_random_uuid(); tid uuid; country text; BEGIN
          PERFORM set_config('request.jwt.claims','{}',true);
          PERFORM pg_temp.check_signup('undo keeps existing active accounts active',
            (SELECT p.status='active' AND tp.verification_status='verified' FROM signup_fixture f
             JOIN profiles p ON p.id=f.user_id JOIN technician_profiles tp ON tp.id=f.technician_id));
          INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(u,u||'@example.invalid','{"role":"technician"}');
          PERFORM pg_temp.check_signup('undo restores pending new accounts',(SELECT status='pending_verification' FROM profiles WHERE id=u));
          SELECT code INTO country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
          PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
          SET LOCAL ROLE authenticated;
          tid:=signup_technician('Undo','Test',DATE '1990-01-01','mechanic',country);
          RESET ROLE;
          PERFORM pg_temp.check_signup('undo restores pending new technician profiles',(SELECT verification_status='pending' FROM technician_profiles WHERE id=tid));
        END $$;
        ${schemaSnapshot};`);
      assert.deepEqual(undoChecks,beforeSchema,'Undo did not restore the original definitions, grants, triggers and policies');
      console.log('PASS undo: new signups return to pending; existing active accounts stay active; schema restored.');
    }
  } finally {
    assert.deepEqual(await query(dataSnapshot),beforeData,'Data or migration history changed during rollback tests');
    assert.deepEqual(await query(schemaSnapshot),beforeSchema,'Schema changed during rollback tests');
    console.log(`PASS rollback: ${tables.length} tables, auth users, schema and migration history unchanged.`);
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
