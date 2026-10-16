// Standalone — nunca sale a la red: cada proceso hijo arranca con `fetch`
// bloqueado (fixtures/dev-db-guard/blockFetch.cjs) y un token de mentira.
// El candado de los scripts que escriben en la base (lib/devDatabaseGuard.cjs):
//
//   - la regla pura: sólo pasa si todas las URLs definidas son la de dev;
//   - cada script escritor PARA con otra base antes de intentar enviar nada, y
//     con dev llega hasta el primer envío (que el bloqueo corta);
//   - el modo --rehearse de los validadores TS pasa por el mismo candado, y
//     sin --rehearse (sólo lectura) no;
//   - ningún script llama a la Management API sin estar en la lista.
//
// Run via: npm run test:dev-db-guard
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DEV_SUPABASE_URL, devDatabaseProblem, projectRef, DEV_PROJECT_REF } = require('./lib/devDatabaseGuard.cjs');

const root = path.resolve(__dirname, '..');
const BLOCK_FETCH = path.join(__dirname, 'fixtures', 'dev-db-guard', 'blockFetch.cjs');
const OTHER_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const STOPPED = /^PARADO: /m;
const FETCH_ATTEMPTED = 'FETCH_ATTEMPTED';
const WRITERS = [
  'testDatabaseRegressions.cjs',
  'testHabilitationScopeDatabase.cjs',
  'testTechnicianSignup.cjs',
  'testSignupRoles.cjs',
  'testCompanyOfferWrites.cjs',
  'testCompanyInvitation.cjs',
  'rehearseOfferEngineNotes.cjs',
  'rehearseProfileImages.cjs',
  'rehearseReportsAndBlocks.cjs',
  'rehearseTechnicianMinimumAge.cjs',
  'rehearseCompanyAccountDeletion.cjs',
  'rehearseTestAccounts.cjs',
];

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS — ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL — ${name}`);
    console.error(err);
  }
}

function run(args, url) {
  const env = { ...process.env, SUPABASE_TEST_ACCESS_TOKEN: 'not-a-real-token' };
  if (url === undefined) delete env.EXPO_PUBLIC_SUPABASE_URL;
  else env.EXPO_PUBLIC_SUPABASE_URL = url;
  return spawnSync(process.execPath, ['-r', BLOCK_FETCH, ...args], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
}

function assertStopped(result, label) {
  assert.equal(result.status, 1, `${label}: código ${result.status}\n${result.stderr}`);
  assert.match(result.stderr, STOPPED, `${label}: sin el mensaje del candado\n${result.stderr}`);
  assert.ok(!result.stderr.includes(FETCH_ATTEMPTED), `${label}: intentó enviar algo`);
}

function assertReachedFetch(result, label) {
  assert.doesNotMatch(result.stderr, STOPPED, `${label}: el candado paró dev`);
  assert.equal(result.status, 99, `${label}: no llegó al primer envío (código ${result.status})\n${result.stderr}`);
}

const envFile = path.join(root, '.env');
const envFileUrl = fs.existsSync(envFile)
  ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find(l => l.startsWith('EXPO_PUBLIC_SUPABASE_URL='))
    ?.slice('EXPO_PUBLIC_SUPABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '')
  : undefined;
const envFileIsDev = envFileUrl !== undefined && projectRef(envFileUrl) === DEV_PROJECT_REF;
if (!envFileIsDev) {
  console.log(`NOTICE — el .env ${envFileUrl === undefined ? 'no existe o no define la URL' : 'no apunta a dev'}: se saltan las pruebas "con dev llega al envío".`);
}

// ── La regla ───────────────────────────────────────────────────────────────

test('dev en las fuentes definidas pasa', () => {
  assert.equal(devDatabaseProblem({ '.env': DEV_SUPABASE_URL, terminal: DEV_SUPABASE_URL }), null);
  assert.equal(devDatabaseProblem({ '.env': DEV_SUPABASE_URL, terminal: undefined }), null);
  assert.equal(devDatabaseProblem({ '.env': undefined, terminal: `${DEV_SUPABASE_URL}/` }), null);
  assert.equal(devDatabaseProblem({ '.env': DEV_SUPABASE_URL, terminal: '' }), null);
});

test('otra base en cualquiera de las fuentes para', () => {
  for (const sources of [
    { '.env': OTHER_URL, terminal: undefined },
    { '.env': DEV_SUPABASE_URL, terminal: OTHER_URL },
    { '.env': OTHER_URL, terminal: DEV_SUPABASE_URL },
    { '.env': DEV_SUPABASE_URL, terminal: DEV_SUPABASE_URL, script: OTHER_URL },
  ]) {
    const problem = devDatabaseProblem(sources);
    assert.match(problem ?? '', STOPPED, JSON.stringify(sources));
    assert.match(problem, /<- NO es dev/);
    assert.ok(problem.includes(OTHER_URL));
    assert.ok(problem.includes(DEV_SUPABASE_URL), 'el mensaje dice a qué URL apuntar');
  }
});

test('sin URL, una local o una que sólo se parece a dev, para', () => {
  assert.match(devDatabaseProblem({ '.env': undefined, terminal: undefined }), /no está definida/);
  for (const url of [
    'http://127.0.0.1:54321',
    `https://${DEV_PROJECT_REF}.supabase.co.example.com`,
    `https://example.com/${DEV_PROJECT_REF}`,
    `https://x${DEV_PROJECT_REF}.supabase.co`,
    'not a url',
  ]) {
    assert.match(devDatabaseProblem({ '.env': url, terminal: undefined }) ?? '', STOPPED, url);
  }
});

// ── Los scripts escritores ─────────────────────────────────────────────────

for (const file of WRITERS) {
  test(`${file}: con otra base para antes de enviar nada`, () => {
    assertStopped(run([path.join('scripts', file)], OTHER_URL), file);
  });
  if (envFileIsDev) {
    test(`${file}: con dev llega al primer envío`, () => {
      assertReachedFetch(run([path.join('scripts', file)], DEV_SUPABASE_URL), file);
    });
  }
}

// ── El --rehearse de los validadores (scripts/lib/rehearseMigration.ts) ─────

const tmp = path.join(root, '.tmp-test-dev-db-guard');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, 'lib'), { recursive: true });
const ts = require('typescript');
for (const name of ['loadEnv', 'rehearseMigration']) {
  const source = fs.readFileSync(path.join(__dirname, 'lib', `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  fs.writeFileSync(path.join(tmp, 'lib', `${name}.js`), outputText);
}
const driver = path.join(tmp, 'driver.cjs');
fs.writeFileSync(driver, [
  "const lib = require('./lib/rehearseMigration.js');",
  "const [mode, url] = process.argv.slice(2);",
  "if (mode === 'argument') { lib.rehearseArgument(); process.exit(0); }",
  "lib.queryWithRehearsedMigration(url, 'package.json', 'SELECT 1').then(() => process.exit(0), () => process.exit(2));",
].join('\n'));

test('--rehearse con otra base para', () => {
  assertStopped(run([driver, 'argument', '--rehearse=supabase/migrations/x.sql'], OTHER_URL), 'rehearseArgument');
  assertStopped(run([driver, 'query', OTHER_URL], OTHER_URL), 'queryWithRehearsedMigration');
});

test('el ensayo para si la URL que recibe no es dev aunque el entorno sí lo sea', () => {
  assertStopped(run([driver, 'query', OTHER_URL], DEV_SUPABASE_URL), 'queryWithRehearsedMigration');
});

test('sin --rehearse los validadores (sólo lectura) no se bloquean', () => {
  const result = run([driver, 'argument'], OTHER_URL);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, STOPPED);
});

if (envFileIsDev) {
  test('--rehearse con dev llega al envío', () => {
    assertReachedFetch(run([driver, 'query', DEV_SUPABASE_URL], DEV_SUPABASE_URL), 'queryWithRehearsedMigration');
  });
}

// ── Nadie llama a la Management API sin candado ─────────────────────────────

test('todo script que llama a la Management API está en la lista', () => {
  const callsApi = /api\.supabase\.com|database\/query/;
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'fixtures' && entry.name !== 'data') walk(full); continue; }
      if (/\.(c?js|mjs|ts)$/.test(entry.name) && full !== __filename && callsApi.test(fs.readFileSync(full, 'utf8'))) {
        found.push(path.relative(__dirname, full).split(path.sep).join('/'));
      }
    }
  })(__dirname);
  const allowed = new Set([...WRITERS, 'lib/rehearseMigration.ts']);
  assert.deepEqual(found.filter(f => !allowed.has(f)), [], 'añádelo a WRITERS y llama a assertDevDatabase() al principio');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
