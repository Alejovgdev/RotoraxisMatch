// Every mutation rolls back. Default: rehearse the candidate migration.
// --installed tests the production functions/triggers without replacing them.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const i = line.indexOf('=');
    return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const token = process.env.SUPABASE_TEST_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_ACCESS_TOKEN;
const baseline = process.argv.includes('--baseline');
const installed = process.argv.includes('--installed');
async function query(query) {
  const host = new URL(env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL).hostname;
  if (!/^[a-z0-9]+\.supabase\.co$/.test(host) || !token) throw new Error('Missing hosted test project / token');
  const response = await fetch(`https://api.supabase.com/v1/projects/${host.split('.')[0]}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message ?? 'SQL failed'}`);
  return data;
}
async function main() {
  const snapshotQuery = `SELECT jsonb_build_object(
    'ratings',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]') FROM public.technician_habilitations h),
    'licenses',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]') FROM public.technician_licenses l),
    'functions',(SELECT coalesce(jsonb_agg(pg_get_functiondef(oid) ORDER BY proname),'[]') FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname IN ('individual_type_rating_scope_error','enforce_individual_type_rating_scope','enforce_credential_type_rating_scope')),
    'triggers',(SELECT coalesce(jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname),'[]') FROM pg_trigger WHERE tgname IN ('enforce_individual_type_rating_scope','enforce_credential_type_rating_scope'))
  ) AS snapshot`;
  const before = await query(snapshotQuery);
  const migration = baseline || installed ? '' : fs.readFileSync(path.join(root, 'supabase/migrations/083_individual_type_rating_scope.sql'), 'utf8');
  const sql = fs.readFileSync(path.join(__dirname, 'testHabilitationScope.sql'), 'utf8');
  const rows = await query(`BEGIN; SET LOCAL statement_timeout='45s'; SET LOCAL app.scope_baseline='${baseline}';\n${migration}\n${sql}\nROLLBACK;`);
  const after = await query(snapshotQuery);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Rollback did not restore the exact data / schema snapshot');
  const result = rows[0];
  if (rows.length !== 1 || result.cases < 300 || result.failures !== 0) throw new Error(JSON.stringify(rows));
  console.log(`PASS H3 ${baseline ? 'baseline reproduction' : installed ? 'installed migration' : 'migration rehearsal'}: ${result.cases} cases; rollback restored exact data, functions and triggers`);
  if (!baseline) {
    for (const [file, expected] of [['testApplicationSecurity.sql', 23], ['testTransactionalWrites.sql', 27]]) {
      const suite = fs.readFileSync(path.join(__dirname, file), 'utf8');
      if (!/\bBEGIN;/.test(suite) || !/ROLLBACK;\s*$/.test(suite)) throw new Error(`Missing rollback: ${file}`);
      const body = suite.replace(/\bBEGIN;/, '').replace(/ROLLBACK;\s*$/, '');
      const checks = await query(`BEGIN;\n${migration}\n${body}\nROLLBACK;`);
      if (checks.length !== expected || checks.some(row => row.passed !== true)) throw new Error(`${file}: ${JSON.stringify(checks)}`);
      console.log(`PASS 083 + ${file}: ${checks.length} regressions with rollback`);
    }
    if (JSON.stringify(before) !== JSON.stringify(await query(snapshotQuery))) throw new Error('Integration rollback changed data / schema');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
