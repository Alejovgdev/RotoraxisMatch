// Ensayo de la migración 100 (denuncias y bloqueos). Nunca aplica ni registra
// la migración ni inicia sesión en la app: cada paso es una transacción que
// termina en ROLLBACK, y al final se comprueba que datos, esquema e historial
// están igual que al empezar.
//
//   node scripts/rehearseReportsAndBlocks.cjs              candidata (100 sin aplicar)
//   node scripts/rehearseReportsAndBlocks.cjs --installed  base con la 100 ya aplicada
//
// Pasos: la autoprueba de la 100 caso a caso (crea sus propios usuarios, así que
// no depende de los datos de la base); las suites de seguridad de siempre con
// la 100 puesta; mutantes que la autoprueba tiene que cazar; y aplicar la 100 y
// deshacerla con supabase/rollbacks/100_reports_and_blocks.down.sql deja el
// esquema idéntico.
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

const migration = read('supabase/migrations/100_reports_and_blocks.sql');
const down = read('supabase/rollbacks/100_reports_and_blocks.down.sql');
const installed = process.argv.includes('--installed');
const CASES = 50;

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${host.split('.')[0]}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(90000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.message ?? 'SQL failed'}`);
  return data;
}
function rolledBack(sql) {
  return query(`BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';\n${sql}\nROLLBACK;`);
}
function suite(name) {
  const sql = read(`scripts/${name}`);
  assert.match(sql, /\bBEGIN;/); assert.match(sql, /ROLLBACK;\s*$/);
  return sql.replace(/\bBEGIN;/, '').replace(/ROLLBACK;\s*$/, '');
}
function downBody() {
  assert.match(down, /\nBEGIN;\n/); assert.match(down, /\nCOMMIT;\s*$/);
  return down.replace(/\nBEGIN;\n/, '\n').replace(/\nCOMMIT;\s*$/, '\n');
}
// La autoprueba sin el resto de la migración, para la base ya instalada.
function installedSelftest() {
  const start = migration.indexOf('CREATE FUNCTION pg_temp.attempt_100');
  const end = migration.indexOf('-- <<< selftest 100');
  assert.ok(start > 0 && end > start, 'Self-test markers not found');
  return migration.slice(start, end) + '\nDROP FUNCTION pg_temp.attempt_100(text);';
}
async function selftest(candidate) {
  return rolledBack(`CREATE TEMP TABLE selftest_100_results (test text, passed boolean, observed text);
${candidate}
SELECT test, passed, observed FROM pg_temp.selftest_100_results;`);
}
function checkRows(rows, expected) {
  assert.equal(rows.length, expected, 'Missing test results');
  assert.deepEqual(rows.filter(r => r.passed !== true), [], 'SQL failures');
}

const SCHEMA_SNAPSHOT = `SELECT item, hash FROM (
  SELECT 'policies' AS item, md5(jsonb_agg(to_jsonb(p) ORDER BY schemaname, tablename, policyname)::text) AS hash
    FROM pg_policies p WHERE schemaname IN ('public', 'storage')
  UNION ALL SELECT 'functions', md5(jsonb_agg(pg_get_functiondef(oid) ORDER BY oid)::text)
    FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prokind = 'f'
  UNION ALL SELECT 'function_acl', md5(jsonb_agg(coalesce(proacl::text, '') ORDER BY oid)::text)
    FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'triggers', md5(jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid)::text) FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'tables', md5(jsonb_agg(tablename ORDER BY tablename)::text) FROM pg_tables WHERE schemaname = 'public'
  UNION ALL SELECT 'columns', md5(jsonb_agg(to_jsonb(c) ORDER BY table_name, ordinal_position)::text)
    FROM information_schema.columns c WHERE table_schema = 'public'
  UNION ALL SELECT 'constraints', md5(jsonb_agg(pg_get_constraintdef(oid) ORDER BY oid)::text)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'views', md5(jsonb_agg(to_jsonb(v) ORDER BY viewname)::text) FROM pg_views v WHERE schemaname = 'public'
) s ORDER BY item`;

// Mutantes: la 100 con un fallo a propósito. La autoprueba tiene que fallar, y
// por el caso que ese fallo rompe.
const MUTANTS = [
  ['block never found', "AND EXISTS (SELECT 1 FROM contact_blocks b", "AND false AND EXISTS (SELECT 1 FROM contact_blocks b", 'chat hidden from technician'],
  ['outsiders learn blocks', '(public.my_technician_id() = p_technician_id', '(true OR public.my_technician_id() = p_technician_id', 'outsider cannot learn the block'],
  ['accepting allowed', "NEW.status IN ('pending', 'accepted')", "NEW.status IN ('pending')", 'technician cannot accept a direct offer'],
  ['offer company ignored', 'OR b.company_id = (SELECT o.company_id FROM offers o WHERE o.id = NEW.offer_id)', '', 'block follows the offer company'],
  ['viewer may block', 'COALESCE(public.can_act_for_company(p_company_id), false)',
    'EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = auth.uid() AND m.company_id = p_company_id)', 'viewer cannot block'],
  ['own message reportable', "AND cm.sender_role = 'company')", ')', 'own message cannot be reported'],
  ['company chat policy unchanged', `ALTER POLICY cr_select_company ON public.chat_rooms
  USING (is_active_user() AND company_id = my_company_id()
         AND NOT public.contact_blocked(company_id, technician_id));`, '', 'chat policies without the block condition'],
];

async function main() {
  const [pre] = await query(`SELECT to_regclass('public.contact_blocks') IS NOT NULL AS installed,
    (SELECT count(*) FROM location_countries WHERE is_active) AS countries`);
  assert.equal(pre.installed, installed, installed
    ? '100 is not installed: run without --installed'
    : '100 is already installed: use --installed (never replay it)');
  console.log(`Preflight: 100 ${installed ? 'installed (not replayed)' : 'candidate'}; ${pre.countries} active countries in the catalog.`);

  const tables = await query(`SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'
    OR (schemaname = 'storage' AND tablename IN ('objects', 'buckets'))
    OR (schemaname = 'auth' AND tablename = 'users')
    OR (schemaname = 'supabase_migrations' AND tablename = 'schema_migrations') ORDER BY schemaname, tablename`);
  const dataSnapshot = tables.map(({ schemaname: s, tablename: t }) => {
    assert.match(s, /^[a-z_]+$/); assert.match(t, /^[a-z0-9_]+$/);
    return `SELECT '${s}.${t}' AS item, md5(coalesce(jsonb_agg(j ORDER BY j::text)::text, '[]')) AS hash FROM (SELECT to_jsonb(x) j FROM "${s}"."${t}" x) q`;
  }).join('\nUNION ALL\n') + '\nORDER BY item';
  const beforeData = await query(dataSnapshot);
  const beforeSchema = await query(SCHEMA_SNAPSHOT);
  const candidate = installed ? '' : migration;

  try {
    const rows = await selftest(installed ? installedSelftest() : migration);
    checkRows(rows, CASES);
    rows.forEach(r => console.log(`PASS ${r.test}`));
    console.log(`PASS 100 self-test: ${rows.length}/${CASES}`);

    for (const [file, count] of [['testApplicationSecurity.sql', 23], ['testTransactionalWrites.sql', 27]]) {
      checkRows(await rolledBack(`${candidate}\n${suite(file)}`), count);
      console.log(`PASS 100 + ${file}: ${count}/${count}`);
    }
    const scope = await rolledBack(`${candidate}\nSET LOCAL app.scope_baseline='false';\n${read('scripts/testHabilitationScope.sql')}`);
    assert.equal(scope.length, 1); assert.equal(scope[0].cases, 412); assert.equal(scope[0].failures, 0);
    console.log('PASS 100 + H3: 412/412');

    if (installed) return;

    // Base sin datos: la autoprueba no lee usuarios existentes (crea los suyos);
    // si además faltan los catálogos, comprueba la estructura, avisa y sigue.
    const noCatalogs = "SELECT code INTO v_country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;";
    assert.ok(migration.includes(noCatalogs), 'Catalog lookup not found');
    const empty = await selftest(migration.replace(noCatalogs, 'v_country := NULL;'));
    assert.equal(empty.length, 0, 'Behaviour checks ran without catalogs');
    console.log('PASS empty catalogs: structure checked, behaviour skipped with a notice, migration not aborted.');

    for (const [label, from, to, expected] of MUTANTS) {
      assert.ok(migration.includes(from), `Mutant does not apply: ${label}`);
      const mutant = migration.replace(from, to);
      let message = null;
      try { await selftest(mutant); } catch (error) { message = error.message; }
      assert.ok(message && message.includes('100 self-test failed') && message.includes(expected),
        `Missed mutant: ${label} (${message ?? 'no failure'})`);
      console.log(`PASS negative control: ${label} -> "${expected}"`);
    }

    const undone = await rolledBack(`${migration}\n${downBody()}\n${SCHEMA_SNAPSHOT};`);
    assert.deepEqual(undone, beforeSchema, 'Undo script does not restore the schema');
    console.log(`PASS undo: ${beforeSchema.length} schema fingerprints identical after applying and undoing 100.`);
  } finally {
    assert.deepEqual(await query(dataSnapshot), beforeData, 'Rollback mismatch: data or history changed');
    assert.deepEqual(await query(SCHEMA_SNAPSHOT), beforeSchema, 'Rollback mismatch: schema changed');
    console.log(`PASS rollback: ${tables.length} tables, auth users, Storage metadata, schema and migration history unchanged.`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
