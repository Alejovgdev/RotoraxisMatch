// Rehearse 098 or an additive correction: never applies migrations or signs in.
// All writes are one transaction per suite, ending in ROLLBACK.
const fs = require('node:fs');
const path = require('node:path');
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
const migration = read('supabase/migrations/098_profile_images.sql');
const installed = process.argv.includes('--installed');
const patchPath = process.argv.find(arg => arg.startsWith('--rehearse='))?.slice('--rehearse='.length);
assert.ok(!patchPath || installed, 'An additive correction requires --installed (never replay 098)');
const patch = patchPath ? read(patchPath) : '';
async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${host.split('.')[0]}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(60000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.message ?? 'SQL failed'}`);
  return data;
}
function body(name) {
  const sql = read(`scripts/${name}`);
  assert.match(sql, /\bBEGIN;/); assert.match(sql, /ROLLBACK;\s*$/);
  return sql.replace(/\bBEGIN;/, '').replace(/ROLLBACK;\s*$/, '');
}
async function rehearse(candidate, sql) {
  return query(`BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s';\n${candidate}\n${sql}\nROLLBACK;`);
}
function checkRows(rows, expected) {
  if (expected !== undefined) assert.equal(rows.length, expected, 'Missing test results');
  assert.ok(rows.length > 0);
  assert.deepEqual(rows.filter(r => r.passed !== true), [], 'SQL failures');
}
async function main() {
  const preflight = await query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='technician_profiles' AND column_name='photo_path') AS installed,
    pg_get_viewdef('public.technician_public_view'::regclass,true) AS view,
    to_regprocedure('storage.allow_only_operation(text)') IS NOT NULL AS operations,
    (SELECT count(*) FROM storage.buckets WHERE id IN ('technician-photos','company-logos')) AS buckets,
    (SELECT qual FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname='technician_photo_read') AS photo_policy`);
  assert.equal(preflight[0].installed, installed, '098 schema mismatch: use --installed after application; never replay it');
  assert.equal(preflight[0].operations, true, 'Storage operation helpers required');
  assert.equal(preflight[0].buckets, installed ? 2 : 0, 'Unexpected image buckets');
  // Fail if the view has drifted beyond the known 061 shape.
  assert.equal((preflight[0].view.match(/offer_accepted_between/g) ?? []).length, installed ? 6 : 5);
  assert.ok(preflight[0].view.includes('tp.years_experience'));
  console.log(`Preflight: 098 ${installed ? 'installed (not replayed)' : 'candidate'}, Storage operation helpers installed.`);
  const candidate = installed ? patch : migration;
  const checkInfoReads = !!patchPath || (preflight[0].photo_policy ?? '').includes('object.get_authenticated_info');
  const tables = await query(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public'
    OR (schemaname='storage' AND tablename IN ('objects','buckets'))
    OR (schemaname='auth' AND tablename='users')
    OR (schemaname='supabase_migrations' AND tablename='schema_migrations') ORDER BY schemaname,tablename`);
  const hashes = tables.map(({schemaname:s,tablename:t}) => {
    assert.match(s,/^[a-z_]+$/); assert.match(t,/^[a-z0-9_]+$/);
    return `SELECT '${s}.${t}' AS item,md5(coalesce(jsonb_agg(j ORDER BY j::text)::text,'[]')) AS hash FROM (SELECT to_jsonb(x) j FROM "${s}"."${t}" x) q`;
  });
  hashes.push(`SELECT 'schema.columns',md5(jsonb_agg(to_jsonb(c) ORDER BY table_schema,table_name,ordinal_position)::text) FROM information_schema.columns c WHERE table_schema IN ('public','storage')`,
    `SELECT 'schema.functions',md5(jsonb_agg(pg_get_functiondef(oid) ORDER BY oid)::text) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'storage'::regnamespace) AND prokind='f'`,
    `SELECT 'schema.policies',md5(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname)::text) FROM pg_policies p WHERE schemaname IN ('public','storage')`,
    `SELECT 'schema.triggers',md5(jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid)::text) FROM pg_trigger WHERE NOT tgisinternal`,
    `SELECT 'schema.constraints',md5(jsonb_agg(pg_get_constraintdef(oid) ORDER BY oid)::text) FROM pg_constraint WHERE connamespace IN ('public'::regnamespace,'storage'::regnamespace)`,
    `SELECT 'schema.views',md5(jsonb_agg(to_jsonb(v) ORDER BY schemaname,viewname)::text) FROM pg_views v WHERE schemaname='public'`);
  const snapshotSql = hashes.join('\nUNION ALL\n') + '\nORDER BY item';
  const before = await query(snapshotSql);
  try {
    const rows = await rehearse(candidate, body('testProfileImages.sql'));
    checkRows(rows);
    rows.forEach(r => console.log(`PASS ${r.test}`));
    console.log(`PASS profile images: ${rows.length}/${rows.length}`);
    if (checkInfoReads) {
      // Re-run ALL image/security cases with the actual gateway operation from
      // the incident logs, and with HEAD metadata reads. Includes locked/other
      // companies, both acceptance paths, removed photos and inactive accounts.
      for (const operation of ['object.get_authenticated_info','object.head_authenticated_info',
        'storage.object.get_authenticated_info','storage.object.head_authenticated_info']) {
        const sql = body('testProfileImages.sql').replaceAll('storage.object.get_authenticated',operation);
        checkRows(await rehearse(candidate,sql),rows.length);
        console.log(`PASS ${operation}: ${rows.length}/${rows.length}`);
      }
      if (patchPath) {
        const infoSql = body('testProfileImages.sql').replaceAll('storage.object.get_authenticated','object.get_authenticated_info');
        if (!(preflight[0].photo_policy ?? '').includes('object.get_authenticated_info')) {
          const withoutFix = await rehearse('',infoSql);
          assert.ok(withoutFix.some(r => r.test==='owner reads own photo' && !r.passed), 'Missing reproduction of 098 bug');
          console.log('PASS negative control: installed 098 denies owner info read without correction');
        }
        const widened = candidate.replaceAll("'object.head_authenticated_info'", "'object.head_authenticated_info','object.sign'");
        assert.notEqual(widened,candidate,'Ineffective signed-URL control');
        const unsafe = await rehearse(widened,infoSql);
        assert.ok(unsafe.some(r => r.test==='owner denied operation object.sign' && !r.passed),'Missed signed-URL leak');
        console.log('PASS negative control: regression catches signed URL permission leak');
      }
    }
    for (const [file,count] of [['testApplicationSecurity.sql',23],['testTransactionalWrites.sql',27]]) {
      checkRows(await rehearse(candidate,body(file)),count);
      console.log(`PASS 098 + ${file}: ${count}/${count}`);
    }
    const scope = await rehearse(candidate, "SET LOCAL app.scope_baseline='false';\n" + read('scripts/testHabilitationScope.sql'));
    assert.equal(scope.length,1); assert.equal(scope[0].cases,412); assert.equal(scope[0].failures,0);
    console.log('PASS 098 + H3: 412/412');
    if (installed) return;
    const controls = [
      ['view leaks photo', migration.replace('CASE WHEN offer_accepted_between(my_company_id(),tp.id) THEN tp.photo_path ELSE NULL::text END AS photo_path','tp.photo_path AS photo_path'), 'locked view hides photo and name'],
      ['Storage ignores acceptance',migration.replace('OR public.offer_accepted_between(public.my_company_id(),tp.id)','OR true'), 'known path still denied to locked company'],
      ['owner may sign URL',migration.replace("'object.get_authenticated','object.upload'","'object.sign','object.get_authenticated','object.upload'"), 'owner denied operation object.sign'],
      ['recruiter may upload logo',migration.replace("public.my_company_role(c.id)='admin'","public.my_company_role(c.id) IN ('admin','recruiter')"), null],
      ['removed photo remains downloadable',migration.replace('WHERE tp.photo_path=object_name',"WHERE split_part(object_name,'/',1)=tp.id::text"), 'removed photo inaccessible even if bytes remain'],
      ['missing tombstone cleanup',migration.replace("FOR EACH ROW WHEN (NEW.status='deleted')", "FOR EACH ROW WHEN (false)"), 'account deletion clears photo pointer'],
    ];
    for (const [label,candidate,failedTest] of controls) {
      assert.notEqual(candidate,migration,`Ineffective control: ${label}`);
      let result;
      try { result = await rehearse(candidate, body('testProfileImages.sql')); }
      catch (error) {
        // The widened recruiter policy inserts the logo early, then the admin's
        // insert hits the same unique key; that is an expected mutant rejection.
        if (label==='recruiter may upload logo' && /duplicate key/.test(error.message)) {
          console.log(`PASS negative control: ${label}`); continue;
        }
        throw error;
      }
      assert.ok(result.some(r => (failedTest ? r.test===failedTest : r.test==='recruiter logo upload permissions') && !r.passed), `Missed mutant: ${label}`);
      console.log(`PASS negative control: ${label}`);
    }
  } finally {
    assert.deepEqual(await query(snapshotSql),before,'Rollback mismatch: data/schema/history changed');
    console.log(`PASS rollback: ${tables.length} tables, auth users, Storage metadata, schema and migration history unchanged.`);
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
