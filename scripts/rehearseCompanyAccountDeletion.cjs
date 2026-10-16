// Ensayo de la migración 105 (la empresa se va con su último miembro). Nunca
// aplica ni registra la migración ni inicia sesión en la app: cada paso es una
// transacción que termina en ROLLBACK, y al final se comprueba que datos,
// esquema e historial están igual que al empezar.
//
//   node scripts/rehearseCompanyAccountDeletion.cjs              candidata (105 sin aplicar)
//   node scripts/rehearseCompanyAccountDeletion.cjs --installed  base con la 105 ya aplicada
//
// Pasos: la autoprueba de la 105 caso a caso (crea sus propios usuarios de
// Auth, empresas, ofertas, candidaturas y chats, así que no depende de los
// datos de la base); las suites de siempre con la 105 puesta, incluidas las que
// borran cuentas (imágenes) y la autoprueba de denuncias y bloqueos (100); una
// base sin catálogos (avisa y sigue); mutantes que la autoprueba tiene que
// cazar; y aplicar la 105 y deshacerla con
// supabase/rollbacks/105_delete_company_with_last_member.down.sql deja el
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

const migration = read('supabase/migrations/105_delete_company_with_last_member.sql');
const down = read('supabase/rollbacks/105_delete_company_with_last_member.down.sql');
const installed = process.argv.includes('--installed');
const CASES = 24;
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
  return sql.slice(start, end) + `\nDROP FUNCTION pg_temp.attempt_${number}(text);`;
}
async function selftest(candidate) {
  return rolledBack(`CREATE TEMP TABLE selftest_105_results (test text, passed boolean, observed text);
${candidate}
SELECT test, passed, observed FROM pg_temp.selftest_105_results;`);
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

const GUARD_CLAUSE = `  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = OLD.company_id) THEN
    RETURN OLD;
  END IF;`;
const CANCEL_INVITES = `  DELETE FROM auth.users u
   WHERE u.id = ANY (v_pending)
     AND u.last_sign_in_at IS NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id AND p.role = 'company_user');`;
const NOTICES = `  DELETE FROM public.activity_events e
   WHERE e.recipient_scope = 'technician'
     AND e.entity_id IN (
       SELECT a.id FROM public.offer_applications a WHERE a.company_id = p_company_id
       UNION ALL
       SELECT r.id FROM public.offer_requests r WHERE r.company_id = p_company_id
       UNION ALL
       SELECT cr.id FROM public.chat_rooms cr WHERE cr.company_id = p_company_id);`;
const SIGNED_IN_CHECK = `  IF EXISTS (SELECT 1 FROM public.company_members m
              WHERE m.company_id = p_company_id
                AND public.company_member_has_signed_in(m.user_id)) THEN
    RETURN false;
  END IF;`;

// Mutantes: la 105 con un fallo a propósito. La autoprueba tiene que fallar, y
// por el caso que ese fallo rompe.
const MUTANTS = [
  ['pending invitations counted as members', 'WHERE u.id = p_user_id AND u.last_sign_in_at IS NOT NULL',
    'WHERE u.id = p_user_id', 'company is deleted with its last member'],
  ['invitations not cancelled', CANCEL_INVITES, '', 'pending invitation account is cancelled'],
  ['technician notices kept', NOTICES, '', 'technician notices about the company are removed'],
  ['guard blocks the cascade', GUARD_CLAUSE, '', 'deleting the last signed-in member succeeds'],
  ['guard opened for live companies', GUARD_CLAUSE, `  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;`, 'last admin still cannot be removed from a live company'],
  ['company closed despite signed-in members', SIGNED_IN_CHECK, '', 'company with another signed-in member stays'],
  ['impact readable by anyone',
    "     OR (v_uid IS DISTINCT FROM auth.uid() AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role') THEN",
    ' THEN', 'impact: nobody can read another account'],
  ['account deletion does not close', 'PERFORM public.close_company_without_members(v_company_id);', 'NULL;',
    'account deletion does not close the company'],
  ['internal close function exposed',
    'REVOKE ALL ON FUNCTION public.close_company_without_members(uuid) FROM PUBLIC, anon, authenticated, service_role;',
    '', 'function privileges'],
];

async function main() {
  const [pre] = await query(`SELECT to_regprocedure('public.close_company_without_members(uuid)') IS NOT NULL AS installed,
    (SELECT count(*) FROM location_countries WHERE is_active) AS countries,
    (SELECT count(*) FROM companies) AS companies,
    (SELECT count(*) FROM company_members m WHERE NOT EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = m.user_id AND u.last_sign_in_at IS NOT NULL)) AS pending_invitations,
    (SELECT count(*) FROM companies c WHERE NOT EXISTS (
      SELECT 1 FROM company_members m JOIN auth.users u ON u.id = m.user_id
       WHERE m.company_id = c.id AND u.last_sign_in_at IS NOT NULL)) AS companies_without_signed_in_members`);
  assert.equal(pre.installed, installed, installed
    ? '105 is not installed: run without --installed'
    : '105 is already installed: use --installed (never replay it)');
  console.log(`Preflight: 105 ${installed ? 'installed (not replayed)' : 'candidate'}; ${pre.countries} active countries; `
    + `${pre.companies} companies, ${pre.pending_invitations} pending invitations, `
    + `${pre.companies_without_signed_in_members} companies without a signed-in member (105 does not touch existing data).`);
  if (Number(pre.companies) === 0) console.log('NOTICE: no companies in this database; the self-test uses its own.');

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
    const rows = await selftest(installed ? selftestOf('supabase/migrations/105_delete_company_with_last_member.sql', 105) : migration);
    checkRows(rows, CASES);
    rows.forEach(r => console.log(`PASS ${r.test}`));
    console.log(`PASS 105 self-test: ${rows.length}/${CASES}`);

    for (const [file, count] of [['testTechnicianSignup.sql', 25], ['testSignupRoles.sql', 40],
      ['testCompanyOfferWrites.sql', 53], ['testApplicationSecurity.sql', 23], ['testTransactionalWrites.sql', 27],
      ['testProfileImages.sql', 67]]) {
      checkRows(await rolledBack(`${candidate}\n${SECURE}${suite(file)}`), count);
      console.log(`PASS 105 + ${file}: ${count}/${count}`);
    }
    const scope = await rolledBack(`${candidate}\nSET LOCAL app.scope_baseline='false';\n${read('scripts/testHabilitationScope.sql')}`);
    assert.equal(scope.length, 1); assert.equal(scope[0].cases, 412); assert.equal(scope[0].failures, 0);
    console.log('PASS 105 + H3: 412/412');
    for (const [file, number, table, count] of [
      ['supabase/migrations/100_reports_and_blocks.sql', 100, 'selftest_100_results', 50],
      ['supabase/migrations/104_technician_minimum_age.sql', 104, 'selftest_104_results', 18]]) {
      const other = await rolledBack(`${candidate}\nCREATE TEMP TABLE ${table} (test text, passed boolean, observed text);
${selftestOf(file, number)}
SELECT test, passed, observed FROM pg_temp.${table};`);
      checkRows(other, count);
      console.log(`PASS 105 + self-test ${number}: ${count}/${count}`);
    }

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
      assert.ok(message && message.includes('105 self-test failed') && message.includes(expected),
        `Missed mutant: ${label} (${message ?? 'no failure'})`);
      console.log(`PASS negative control: ${label} -> "${expected}"`);
    }

    const undone = await rolledBack(`${migration}\n${downBody()}\n${SCHEMA_SNAPSHOT};`);
    assert.deepEqual(undone, beforeSchema, 'Undo script does not restore the schema');
    console.log(`PASS undo: ${beforeSchema.length} schema fingerprints identical after applying and undoing 105.`);
  } finally {
    assert.deepEqual(await query(dataSnapshot), beforeData, 'Rollback mismatch: data or history changed');
    assert.deepEqual(await query(SCHEMA_SNAPSHOT), beforeSchema, 'Rollback mismatch: schema changed');
    console.log(`PASS rollback: ${tables.length} tables, auth users, schema and migration history unchanged.`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
