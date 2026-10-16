// Ensayo de la migración 106 (cuentas de prueba para los revisores). Nunca
// aplica ni registra la migración ni inicia sesión en la app: cada paso es una
// transacción que termina en ROLLBACK, y al final se comprueba que datos,
// esquema e historial están igual que al empezar.
//
//   node scripts/rehearseTestAccounts.cjs              candidata (106 sin aplicar)
//   node scripts/rehearseTestAccounts.cjs --installed  base con la 106 ya aplicada
//
// Pasos: la autoprueba de la 106 caso a caso (crea sus propias cuentas,
// empresas y ofertas, así que no depende de los datos de la base); las suites
// de siempre con la 106 puesta, incluidas las de alta, invitaciones y borrado
// de cuentas, y las autopruebas de la 100, la 104 y la 105; una base SIN
// usuarios ni empresas (se vacían dentro de la transacción) y una base sin
// catálogos (avisa y sigue); mutantes que la autoprueba tiene que cazar; y
// aplicar la 106 y deshacerla con supabase/rollbacks/106_test_accounts.down.sql
// deja el esquema idéntico.
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

const migration = read('supabase/migrations/106_test_accounts.sql');
const down = read('supabase/rollbacks/106_test_accounts.down.sql');
const installed = process.argv.includes('--installed');
const CASES = 22;
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
// Una autoprueba sin el resto de su migración (base ya instalada).
function selftestOf(file, number) {
  const sql = read(file);
  const start = sql.indexOf(`CREATE FUNCTION pg_temp.attempt_${number}`);
  const end = sql.indexOf(`-- <<< selftest ${number}`);
  assert.ok(start > 0 && end > start, `Self-test markers not found in ${file}`);
  const extra = number === 106 ? '\nDROP FUNCTION pg_temp.as_106(uuid, text, text);' : '';
  return sql.slice(start, end) + extra + `\nDROP FUNCTION pg_temp.attempt_${number}(text);`;
}
async function selftest(candidate, before = '') {
  return rolledBack(`CREATE TEMP TABLE selftest_106_results (test text, passed boolean, observed text);
${before}
${candidate}
SELECT test, passed, observed FROM pg_temp.selftest_106_results;`);
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
  UNION ALL SELECT 'view_acl', md5(jsonb_agg(coalesce(relacl::text, '') ORDER BY relname)::text)
    FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'v'
) s ORDER BY item`;

const VIEW_FILTER = '\n    AND p.is_test_account = (SELECT public.is_test_viewer());';
const VIEW_EQ = 'p.is_test_account = (SELECT public.is_test_viewer())';
const OFFERS_EQ = 'public.is_test_company(company_id) = (SELECT public.is_test_viewer())';
const COMPANIES_EQ = 'public.is_test_company(id) = (SELECT public.is_test_viewer())';
const GRANT_VIEWER = 'GRANT EXECUTE ON FUNCTION public.is_test_viewer() TO anon, authenticated, service_role;';
const NO_ANON = `REVOKE EXECUTE ON FUNCTION public.is_test_viewer() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_test_viewer() TO authenticated, service_role;`;
const ANON_CHECK = "\n     OR NOT has_function_privilege('anon', 'public.is_test_viewer()', 'EXECUTE')";
// ">=" deja a las reales ver las de prueba; "<=" deja a las de prueba ver las reales.
const op = (text, to) => text.replace(' = (SELECT', ` ${to} (SELECT`);
const MEMBERSHIP = `
      OR EXISTS (SELECT 1 FROM public.company_members m
                  WHERE m.user_id = auth.uid() AND public.is_test_company(m.company_id))`;
const GUARD_IDENTITY = `IF current_user IN ('anon', 'authenticated', 'service_role')
       OR auth.uid() IS NOT NULL
       OR COALESCE(auth.jwt() ->> 'role', '') <> '' THEN`;

// Mutantes: la 106 con un fallo a propósito. La autoprueba tiene que fallar, y
// por el caso que ese fallo rompe.
const MUTANTS = [
  ['real companies see test technicians', VIEW_EQ, op(VIEW_EQ, '>='), 'search: a real company sees real technicians, not test ones'],
  ['test companies see real technicians', VIEW_EQ, op(VIEW_EQ, '<='), 'search: a test company sees test technicians, not real ones'],
  ['real technicians see test offers', OFFERS_EQ, op(OFFERS_EQ, '>='), 'offer aircraft: a real technician reads real requirements, not test ones'],
  ['test technicians see real offers', OFFERS_EQ, op(OFFERS_EQ, '<='), 'offers: a test technician sees test offers, not real ones'],
  ['real technicians see test companies', COMPANIES_EQ, op(COMPANIES_EQ, '>='), 'companies: a real technician sees real companies, not test ones'],
  ['test technicians see real companies', COMPANIES_EQ, op(COMPANIES_EQ, '<='), 'companies: a test technician sees test companies, not real ones'],
  ['search filter removed', VIEW_FILTER, ';', 'view or policies do not separate test accounts'],
  ['company membership ignored', MEMBERSHIP, '', 'an unmarked member of a test company counts as test'],
  ['guard disabled', GUARD_IDENTITY, 'IF false THEN', 'guard: a platform admin cannot change the mark from the app'],
  ['guard only checks the user session', GUARD_IDENTITY, 'IF auth.uid() IS NOT NULL THEN',
    'guard: the service role (edge functions) cannot change the mark'],
  // Supabase da EXECUTE explícito a anon en cada función nueva: hay que
  // quitárselo por su nombre.
  ['helpers not callable without a session', [[GRANT_VIEWER, NO_ANON]], null, 'function privileges'],
  ['same, past the privilege check', [[GRANT_VIEWER, NO_ANON], [ANON_CHECK, '']], null,
    'anonymous visitors get no rows and no error'],
];

async function main() {
  const [pre] = await query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'profiles' AND column_name = 'is_test_account') AS installed,
    (SELECT count(*) FROM location_countries WHERE is_active) AS countries,
    (SELECT count(*) FROM auth.users) AS users, (SELECT count(*) FROM profiles) AS profiles,
    (SELECT count(*) FROM companies) AS companies`);
  assert.equal(pre.installed, installed, installed
    ? '106 is not installed: run without --installed'
    : '106 is already installed: use --installed (never replay it)');
  let marked = 'none (column not created yet)';
  if (installed) [{ marked }] = await query('SELECT count(*)::text AS marked FROM profiles WHERE is_test_account');
  console.log(`Preflight: 106 ${installed ? 'installed (not replayed)' : 'candidate'}; ${pre.countries} active countries; `
    + `${pre.users} auth users, ${pre.profiles} profiles, ${pre.companies} companies; marked test accounts: ${marked}.`);
  if (Number(pre.profiles) === 0) console.log('NOTICE: no accounts in this database; the self-test uses its own.');

  const tables = await query(`SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'
    OR (schemaname = 'auth' AND tablename IN ('users', 'identities'))
    OR (schemaname = 'supabase_migrations' AND tablename = 'schema_migrations') ORDER BY schemaname, tablename`);
  const dataSnapshot = tables.map(({ schemaname: s, tablename: t }) => {
    assert.match(s, /^[a-z_]+$/); assert.match(t, /^[a-z0-9_]+$/);
    return `SELECT '${s}.${t}' AS item, md5(coalesce(jsonb_agg(j ORDER BY j::text)::text, '[]')) AS hash FROM (SELECT to_jsonb(x) j FROM "${s}"."${t}" x) q`;
  }).join('\nUNION ALL\n') + '\nORDER BY item';
  const beforeData = await query(dataSnapshot);
  const beforeSchema = await query(SCHEMA_SNAPSHOT);
  const candidate = installed ? '' : migration;

  try {
    const rows = await selftest(installed ? selftestOf('supabase/migrations/106_test_accounts.sql', 106) : migration);
    checkRows(rows, CASES);
    rows.forEach(r => console.log(`PASS ${r.test} [${r.observed}]`));
    console.log(`PASS 106 self-test: ${rows.length}/${CASES}`);

    for (const [file, count] of [['testTechnicianSignup.sql', 25], ['testSignupRoles.sql', 40],
      ['testCompanyOfferWrites.sql', 53], ['testApplicationSecurity.sql', 23], ['testTransactionalWrites.sql', 27],
      ['testProfileImages.sql', 67]]) {
      checkRows(await rolledBack(`${candidate}\n${SECURE}${suite(file)}`), count);
      console.log(`PASS 106 + ${file}: ${count}/${count}`);
    }
    const fn = read('supabase/functions/invite-company-member/index.ts');
    const inviteRole = /inviteUserByEmail\(email,\s*\{\s*data:\s*\{\s*role:\s*'([a-z_]+)'\s*\}/.exec(fn)?.[1];
    assert.match(inviteRole ?? '', /^[a-z_]+$/, 'Could not read the invitation signup role');
    checkRows(await rolledBack(`${candidate}\nSET LOCAL app.invite_signup_role='${inviteRole}';\n${suite('testCompanyInvitation.sql')}`), 13);
    console.log('PASS 106 + testCompanyInvitation.sql: 13/13');
    const scope = await rolledBack(`${candidate}\nSET LOCAL app.scope_baseline='false';\n${read('scripts/testHabilitationScope.sql')}`);
    assert.equal(scope.length, 1); assert.equal(scope[0].cases, 412); assert.equal(scope[0].failures, 0);
    console.log('PASS 106 + H3: 412/412');
    for (const [file, number, table, count] of [
      ['supabase/migrations/100_reports_and_blocks.sql', 100, 'selftest_100_results', 50],
      ['supabase/migrations/104_technician_minimum_age.sql', 104, 'selftest_104_results', 18],
      ['supabase/migrations/105_delete_company_with_last_member.sql', 105, 'selftest_105_results', 24]]) {
      const other = await rolledBack(`${candidate}\nCREATE TEMP TABLE ${table} (test text, passed boolean, observed text);
${selftestOf(file, number)}
SELECT test, passed, observed FROM pg_temp.${table};`);
      checkRows(other, count);
      console.log(`PASS 106 + self-test ${number}: ${count}/${count}`);
    }

    if (installed) return;

    // Base SIN usuarios ni empresas: se vacían dentro de la transacción (se
    // revierte) y la autoprueba tiene que pasar entera con sus propias cuentas.
    const emptied = await selftest(migration, `TRUNCATE auth.users, public.profiles, public.companies CASCADE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM public.profiles)
     OR EXISTS (SELECT 1 FROM public.companies) OR EXISTS (SELECT 1 FROM public.technician_profiles) THEN
    RAISE EXCEPTION 'database was not emptied';
  END IF;
END $$;`);
    checkRows(emptied, CASES);
    console.log(`PASS database without users or companies: ${emptied.length}/${CASES} (notice "no accounts", migration not aborted).`);

    // Sin catálogos: comprueba la estructura, avisa y sigue.
    const noCatalogs = "SELECT code INTO v_country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;";
    assert.ok(migration.includes(noCatalogs), 'Catalog lookup not found');
    const empty = await selftest(migration.replace(noCatalogs, 'v_country := NULL;'));
    assert.equal(empty.length, 0, 'Behaviour checks ran without catalogs');
    console.log('PASS empty catalogs: structure checked, behaviour skipped with a notice, migration not aborted.');

    for (const [label, from, to, expected] of MUTANTS) {
      let mutant = migration;
      for (const [a, b] of Array.isArray(from) ? from : [[from, to]]) {
        assert.ok(mutant.includes(a), `Mutant does not apply: ${label}`);
        mutant = mutant.replace(a, b);
      }
      let message = null;
      try { await selftest(mutant); } catch (error) { message = error.message; }
      assert.ok(message && message.includes('106 self-test failed') && message.includes(expected),
        `Missed mutant: ${label} (${message ?? 'no failure'})`);
      console.log(`PASS negative control: ${label} -> "${expected}"`);
    }

    const undone = await rolledBack(`${migration}\n${downBody()}\n${SCHEMA_SNAPSHOT};`);
    assert.deepEqual(undone, beforeSchema, 'Undo script does not restore the schema');
    console.log(`PASS undo: ${beforeSchema.length} schema fingerprints identical after applying and undoing 106.`);
  } finally {
    assert.deepEqual(await query(dataSnapshot), beforeData, 'Rollback mismatch: data or history changed');
    assert.deepEqual(await query(SCHEMA_SNAPSHOT), beforeSchema, 'Rollback mismatch: schema changed');
    console.log(`PASS rollback: ${tables.length} tables (public, auth users and identities, migration history) and schema unchanged.`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
