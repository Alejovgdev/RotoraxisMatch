// Candidate 097 only. Never applies/registers a migration; every write rolls back.
// Uses the existing administrative test token, never signs in to the application.
// --installed checks the applied schema without replaying the migration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const i = line.indexOf('=');
    return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const token = process.env.SUPABASE_TEST_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_ACCESS_TOKEN;
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/097_offer_required_engine_notes.sql'), 'utf8');
const installed = process.argv.includes('--installed');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const snapshotSql = `SELECT jsonb_build_object(
  'offers',(SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY id)::text,'[]')) FROM public.offers o),
  'aircraft',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY offer_id,aircraft_type_rating_id)::text,'[]')) FROM public.offer_required_habilitations h),
  'technicians',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.technician_profiles t),
  'licenses',(SELECT md5(coalesce(jsonb_agg(to_jsonb(l) ORDER BY id)::text,'[]')) FROM public.technician_licenses l),
  'ratings',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY id)::text,'[]')) FROM public.technician_habilitations h),
  'engines',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY technician_id,engine_id)::text,'[]')) FROM public.technician_engine_experience e),
  'experience',(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY technician_id,aircraft_type_rating_id)::text,'[]')) FROM public.technician_aircraft_experience a),
  'types',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY technician_id,type_code)::text,'[]')) FROM public.technician_profile_types t),
  'applications',(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'[]')) FROM public.offer_applications a),
  'requests',(SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM public.offer_requests r),
  'columns',(SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY ordinal_position)::text) FROM information_schema.columns c WHERE table_schema='public' AND table_name='offers'),
  'functions',(SELECT md5(jsonb_agg(pg_get_functiondef(oid) ORDER BY oid)::text) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'),
  'triggers',(SELECT md5(jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid)::text) FROM pg_trigger WHERE NOT tgisinternal),
  'policies',(SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname)::text) FROM pg_policies p WHERE schemaname='public'),
  'checks',(SELECT md5(jsonb_agg(pg_get_constraintdef(oid) ORDER BY oid)::text) FROM pg_constraint WHERE conrelid='public.offers'::regclass),
  'history',(SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY version)::text) FROM supabase_migrations.schema_migrations m)
) AS snapshot`;

async function query(sql) {
  const host = new URL(env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL).hostname;
  if (!/^[a-z0-9]+\.supabase\.co$/.test(host) || !token) throw new Error('Missing hosted test project / token');
  const response = await fetch(`https://api.supabase.com/v1/projects/${host.split('.')[0]}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message ?? 'SQL failed'}`);
  return data;
}
function body(file) {
  const sql = read(file);
  assert.match(sql, /\bBEGIN;/);
  assert.match(sql, /ROLLBACK;\s*$/);
  return sql.replace(/\bBEGIN;/, '').replace(/ROLLBACK;\s*$/, '');
}
async function rolledBack(candidate, sql) {
  return query(`BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s';\n${candidate}\n${sql}\nROLLBACK;`);
}
function checkRows(rows, expected) {
  assert.equal(rows.length, expected, 'Incomplete test results');
  assert.deepEqual(rows.filter(row => row.passed !== true), [], 'Failed SQL tests');
}
async function main() {
  const metadata = await query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='offers' AND column_name='required_engine_notes') AS column_exists,
    (SELECT coalesce(jsonb_agg(DISTINCT view_schema||'.'||view_name),'[]') FROM information_schema.view_table_usage WHERE table_schema='public' AND table_name='offers') AS offer_views,
    (SELECT jsonb_agg(proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prorettype='public.offers'::regtype) AS offer_rpcs,
    pg_get_functiondef('public.update_offer_with_habilitations(uuid,jsonb,jsonb)'::regprocedure) AS rpc`);
  assert.equal(metadata[0].column_exists, installed, installed ? '097 is not installed' : '097 already installed; use --installed');
  // Reject schema drift instead of overwriting a newer RPC with the 096 copy.
  const previous = installed ? migration : fs.readFileSync(path.join(root,'supabase/migrations/096_faa_offer_accepts_part66_license.sql'),'utf8');
  const previousBody = previous.slice(previous.indexOf('DECLARE old_offer public.offers;'), previous.indexOf('END $$;', previous.indexOf('DECLARE old_offer public.offers;')) + 3);
  const installedBody = metadata[0].rpc.slice(metadata[0].rpc.indexOf('DECLARE old_offer public.offers;'), metadata[0].rpc.lastIndexOf('END') + 3);
  assert.equal(installedBody.replace(/\r/g,''), previousBody.replace(/\r/g,''), `Installed RPC differs from ${installed ? '097' : '096'}`);
  console.log(`Preflight: ${installed ? 'installed 097' : 'candidate 097'}; offer views ${JSON.stringify(metadata[0].offer_views)}; row-returning RPCs ${JSON.stringify(metadata[0].offer_rpcs)}`);
  const candidate = installed ? '' : migration;
  const before = await query(snapshotSql);
  try {
    const rows = await rolledBack(candidate, body('testOfferEngineNotes.sql'));
    checkRows(rows, 20);
    rows.forEach(row => console.log(`PASS ${row.test}`));
    for (const [file, expected] of [['testApplicationSecurity.sql',23],['testTransactionalWrites.sql',27]]) {
      checkRows(await rolledBack(candidate, body(file)), expected);
      console.log(`PASS 097 + ${file}: ${expected}/${expected}`);
    }
    const scope = await rolledBack(candidate, "SET LOCAL app.scope_baseline='false';\n" + read('testHabilitationScope.sql'));
    assert.equal(scope.length,1);
    assert.equal(scope[0].cases,412);
    assert.equal(scope[0].failures,0);
    console.log('PASS 097 + H3: 412/412');
    if (installed) return;

    // Controls show that the dedicated tests detect each essential omission.
    const controls = [
      ['without 097','',/required_engine_notes.*does not exist/],
      ['RPC omits allowlist key',migration.replace("'required_engine_id','required_engine_notes','location_country'","'required_engine_id','location_country'"),/Unsupported offer field/],
      ['RPC retains stale notes',migration.replace("IF NOT (p_patch ? 'required_engine_notes')","IF false AND NOT (p_patch ? 'required_engine_notes')"),/chk_offers_engine_notes/],
      ['missing engine-only CHECK',migration.replace("CHECK (required_engine_notes IS NULL OR offer_kind = 'engine')","CHECK (true)"),null],
    ];
    for (const [label, candidate, expectedError] of controls) {
      let result; let error;
      try { result = await rolledBack(candidate, body('testOfferEngineNotes.sql')); }
      catch (caught) { error = caught; }
      if (expectedError) { assert.ok(error,`Control not caught: ${label}`); assert.match(error.message,expectedError); }
      else {
        if (error) throw error;
        assert.ok(result.some(row => row.test==='direct aircraft write rejects engine note' && row.passed===false),`Control not caught: ${label}`);
      }
      console.log(`PASS negative control: ${label}`);
    }
  } finally {
    assert.deepEqual(await query(snapshotSql),before,'Rollback changed data, schema or migration history');
    console.log('PASS rollback: data, columns, functions, triggers, policies, checks and migration history unchanged');
  }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
