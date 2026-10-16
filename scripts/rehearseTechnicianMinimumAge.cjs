// Ensayo de la migración 104 (edad mínima de 18 años del técnico). Nunca aplica
// ni registra la migración ni inicia sesión en la app: cada paso es una
// transacción que termina en ROLLBACK, y al final se comprueba que datos,
// esquema e historial están igual que al empezar.
//
//   node scripts/rehearseTechnicianMinimumAge.cjs              candidata (104 sin aplicar)
//   node scripts/rehearseTechnicianMinimumAge.cjs --installed  base con la 104 ya aplicada
//
// Pasos: la autoprueba de la 104 caso a caso (crea sus propios usuarios, así que
// no depende de los datos de la base); las suites de alta, roles y seguridad de
// siempre con la 104 puesta; una base sin técnicos y sin catálogos (avisa y
// sigue); un técnico menor ya guardado (la migración para sin cambiar nada);
// mutantes que la autoprueba tiene que cazar; y aplicar la 104 y deshacerla con
// supabase/rollbacks/104_technician_minimum_age.down.sql deja el esquema idéntico.
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

const migration = read('supabase/migrations/104_technician_minimum_age.sql');
const down = read('supabase/rollbacks/104_technician_minimum_age.down.sql');
const installed = process.argv.includes('--installed');
const CASES = 18;
const RULE_CASES = 10;
const SECURE = "SET LOCAL app.company_offer_guard_secure='true'; SET LOCAL app.signup_roles_secure='true';\n";

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
  assert.match(down, /\nBEGIN;\r?\n/); assert.match(down, /\nCOMMIT;\s*$/);
  return down.replace(/\nBEGIN;\r?\n/, '\n').replace(/\nCOMMIT;\s*$/, '\n');
}
// La autoprueba sin el resto de la migración, para la base ya instalada.
function installedSelftest() {
  const start = migration.indexOf('CREATE FUNCTION pg_temp.attempt_104');
  const end = migration.indexOf('-- <<< selftest 104');
  assert.ok(start > 0 && end > start, 'Self-test markers not found');
  return migration.slice(start, end) + '\nDROP FUNCTION pg_temp.attempt_104(text);';
}
async function selftest(candidate, prefix = '') {
  return rolledBack(`CREATE TEMP TABLE selftest_104_results (test text, passed boolean, observed text);
${prefix}
${candidate}
SELECT test, passed, observed FROM pg_temp.selftest_104_results;`);
}
function checkRows(rows, expected) {
  assert.equal(rows.length, expected, 'Missing test results');
  assert.deepEqual(rows.filter(r => r.passed !== true), [], 'SQL failures');
}

const SCHEMA_SNAPSHOT = `SELECT item, hash FROM (
  SELECT 'policies' AS item, md5(jsonb_agg(to_jsonb(p) ORDER BY schemaname, tablename, policyname)::text) AS hash
    FROM pg_policies p WHERE schemaname IN ('public', 'storage')
  UNION ALL SELECT 'functions', md5(jsonb_agg(replace(pg_get_functiondef(oid), chr(13), '') ORDER BY oid)::text)
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

// Mutantes: la 104 con un fallo a propósito. La autoprueba tiene que fallar, y
// por el caso que ese fallo rompe.
const MUTANTS = [
  ['birthday itself not accepted', "SELECT p_birth_date <= (p_today - interval '18 years')::date",
    "SELECT p_birth_date < (p_today - interval '18 years')::date", 'rule: born 2008-10-16, 18 on 2026-10-16 = true'],
  ['age by year difference only', "SELECT p_birth_date <= (p_today - interval '18 years')::date",
    'SELECT extract(year FROM p_today) - extract(year FROM p_birth_date) >= 18', 'rule: born 2008-12-31, 18 on 2026-01-01 = false'],
  ['updates not checked', 'BEFORE INSERT OR UPDATE OF birth_date ON public.technician_profiles',
    'BEFORE INSERT ON public.technician_profiles', 'privileged update to under 18 is rejected'],
  ['trigger not created', `CREATE TRIGGER enforce_technician_minimum_age
  BEFORE INSERT OR UPDATE OF birth_date ON public.technician_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_technician_minimum_age();`, '', 'trigger missing'],
  ['trigger function left executable', 'REVOKE ALL ON FUNCTION public.enforce_technician_minimum_age() FROM PUBLIC, anon, authenticated;',
    '', 'trigger function is executable by clients'],
];

async function main() {
  const [pre] = await query(`SELECT to_regprocedure('public.meets_minimum_technician_age(date,date)') IS NOT NULL AS installed,
    (SELECT count(*) FROM location_countries WHERE is_active) AS countries,
    (SELECT count(*) FROM technician_profiles) AS technicians,
    (SELECT count(*) FROM technician_profiles
      WHERE birth_date > ((now() AT TIME ZONE 'UTC')::date - interval '18 years')::date) AS under_age`);
  assert.equal(pre.installed, installed, installed
    ? '104 is not installed: run without --installed'
    : '104 is already installed: use --installed (never replay it)');
  console.log(`Preflight: 104 ${installed ? 'installed (not replayed)' : 'candidate'}; ${pre.countries} active countries; `
    + `${pre.technicians} technician profiles, ${pre.under_age} under 18.`);
  if (Number(pre.technicians) === 0) console.log('NOTICE: no technician profiles in this database; the existing-data check has nothing to read.');

  const tables = await query(`SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'
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
    console.log(`PASS 104 self-test: ${rows.length}/${CASES}`);

    for (const [file, count] of [['testTechnicianSignup.sql', 25], ['testSignupRoles.sql', 40],
      ['testCompanyOfferWrites.sql', 53], ['testApplicationSecurity.sql', 23], ['testTransactionalWrites.sql', 27]]) {
      checkRows(await rolledBack(`${candidate}\n${SECURE}${suite(file)}`), count);
      console.log(`PASS 104 + ${file}: ${count}/${count}`);
    }
    const scope = await rolledBack(`${candidate}\nSET LOCAL app.scope_baseline='false';\n${read('scripts/testHabilitationScope.sql')}`);
    assert.equal(scope.length, 1); assert.equal(scope[0].cases, 412); assert.equal(scope[0].failures, 0);
    console.log('PASS 104 + H3: 412/412');

    if (installed) return;

    // Base vacía: sin técnicos, la comprobación previa avisa y sigue; sin
    // catálogos, la autoprueba comprueba regla y estructura, avisa y sigue.
    const existing = 'FROM public.technician_profiles;\n  IF v_total = 0 THEN';
    assert.ok(migration.includes(existing), 'Existing-data check not found');
    const noCatalogs = "SELECT code INTO v_country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;";
    assert.ok(migration.includes(noCatalogs), 'Catalog lookup not found');
    const emptyBase = migration
      .replace(existing, 'FROM public.technician_profiles WHERE false;\n  IF v_total = 0 THEN')
      .replace(noCatalogs, 'v_country := NULL;');
    const empty = await selftest(emptyBase);
    checkRows(empty, RULE_CASES);
    assert.ok(empty.every(r => r.test.startsWith('rule: ')), 'Behaviour checks ran without catalogs');
    console.log(`PASS empty base: no technicians and no catalogs -> notices, ${RULE_CASES} rule cases and structure checked, migration not aborted.`);

    // Un técnico de 17 años ya guardado: la migración para y no crea nada.
    const minorFixture = `DO $fixture$
DECLARE u uuid := gen_random_uuid(); c text;
BEGIN
  SELECT code INTO c FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
  INSERT INTO profiles (id, email, role, status) VALUES (u, 'rehearse-104-minor@example.invalid', 'technician', 'active');
  INSERT INTO technician_profiles (user_id, anonymous_code, first_name, last_name, email, birth_date, technician_type, location_country_code)
  VALUES (u, 'TR104' || left(replace(gen_random_uuid()::text, '-', ''), 6), 'Minor', 'Fixture',
          'rehearse-104-minor@example.invalid', ((now() AT TIME ZONE 'UTC')::date - interval '17 years')::date, 'mechanic', c);
END $fixture$;`;
    let stopped = null;
    try { await selftest(migration, minorFixture); } catch (error) { stopped = error.message; }
    assert.ok(stopped && stopped.includes('104 stopped: 1 technician profile(s) have a birth date under 18'),
      `Existing under-age data not detected (${stopped ?? 'no failure'})`);
    console.log('PASS existing under-age profile: migration stops before creating anything.');

    for (const [label, from, to, expected] of MUTANTS) {
      assert.ok(migration.includes(from), `Mutant does not apply: ${label}`);
      const mutant = migration.replace(from, to);
      let message = null;
      try { await selftest(mutant); } catch (error) { message = error.message; }
      assert.ok(message && message.includes('104 self-test failed') && message.includes(expected),
        `Missed mutant: ${label} (${message ?? 'no failure'})`);
      console.log(`PASS negative control: ${label} -> "${expected}"`);
    }

    const undone = await rolledBack(`${migration}\n${downBody()}\n${SCHEMA_SNAPSHOT};`);
    assert.deepEqual(undone, beforeSchema, 'Undo script does not restore the schema');
    console.log(`PASS undo: ${beforeSchema.length} schema fingerprints identical after applying and undoing 104.`);
  } finally {
    assert.deepEqual(await query(dataSnapshot), beforeData, 'Rollback mismatch: data or history changed');
    assert.deepEqual(await query(SCHEMA_SNAPSHOT), beforeSchema, 'Rollback mismatch: schema changed');
    console.log(`PASS rollback: ${tables.length} tables, auth users, schema and migration history unchanged.`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
