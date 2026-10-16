// Standalone — sin red ni Supabase real. Invitar al equipo de una empresa:
//
//   - la función invite-company-member, petición completa con un backend
//     simulado: a un email nuevo lo invita con el rol de alta `company` (el que
//     acepta la base desde la 102), activa su perfil y lo añade al equipo con el
//     rol pedido; reutiliza cuentas existentes de empresa (`company` o la antigua
//     `company_user`) y rechaza las de técnico;
//   - el primer inicio de sesión del invitado en la app: con metadatos de
//     empresa sólo se llama al alta de empresa si NO hay membresía, y una cuenta
//     de empresa activa va a /company.
//
// La parte de base de datos (que la base acepta ese rol, que el invitado ve su
// membresía y que no se crea ninguna empresa) la prueba
// `npm run test:company-invitation:database`.
//
// Run via: npm run test:company-invitation
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
let failed = 0;
const pending = [];
function test(name, fn) {
  pending.push((async () => {
    try { await fn(); passed++; console.log(`PASS — ${name}`); }
    catch (err) { failed++; console.error(`FAIL — ${name}`); console.error(err); }
  })());
}

// ── Backend simulado ──────────────────────────────────────────────────────
const CALLER = 'caller-id';
function backend({ existingProfiles = [], authUsers = [] } = {}) {
  const log = [];
  function builder(table) {
    const q = { table, op: 'select', filters: {}, payload: null, columns: null };
    const resolve = () => {
      log.push(plain(q));
      if (table === 'profiles') {
        if (q.op === 'select' && q.filters.id === CALLER) return { data: { role: 'company_user', status: 'active' }, error: null };
        if (q.op === 'select' && 'email' in q.filters) return { data: existingProfiles, error: null };
        return { data: null, error: null };
      }
      if (table === 'company_members') {
        if (q.op === 'select' && q.filters.user_id === CALLER) return { data: { company_id: 'company-1', role: 'admin' }, error: null };
        if (q.op === 'select') return { data: null, error: null };
        if (q.op === 'insert') return { data: { id: 'member-1', ...q.payload }, error: null };
      }
      if (table === 'company_invitation_log') return { data: null, count: 0, error: null };
      return { data: null, error: null };
    };
    const b = {
      select(columns) { if (q.op === 'select') q.columns = columns; return b; },
      eq(column, value) { q.filters[column] = value; return b; },
      ilike(column, value) { q.filters[column] = value; return b; },
      gte() { return b; },
      upsert(payload) { q.op = 'upsert'; q.payload = payload; return b; },
      update(payload) { q.op = 'update'; q.payload = payload; return b; },
      insert(payload) { q.op = 'insert'; q.payload = payload; return b; },
      async maybeSingle() { return resolve(); },
      async single() { return resolve(); },
      then(onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); },
      catch() { return Promise.resolve(); },
    };
    return b;
  }
  return {
    log,
    from: builder,
    auth: {
      async getUser(token) { assert.equal(token, 'caller-token'); return { data: { user: { id: CALLER } }, error: null }; },
      admin: {
        async listUsers() { return { data: { users: authUsers }, error: null }; },
        async inviteUserByEmail(email, options) {
          log.push({ invite: email, options: plain(options) });
          return { data: { user: { id: 'invited-id' } }, error: null };
        },
      },
      async resetPasswordForEmail(email, options) { log.push({ recovery: email, options: plain(options) }); return { error: null }; },
    },
  };
}

function loadHandler(admin) {
  let handler = null;
  const source = read('supabase/functions/invite-company-member/index.ts');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const envVars = { SUPABASE_URL: 'https://dev.test', SUPABASE_SERVICE_ROLE_KEY: 'service', APP_PUBLIC_URL: 'https://app.test' };
  vm.runInNewContext(js, {
    exports: {},
    require: key => {
      assert.equal(key, 'https://esm.sh/@supabase/supabase-js@2.107.0');
      return { createClient: () => admin };
    },
    Deno: { serve: fn => { handler = fn; }, env: { get: key => envVars[key] } },
    Request, Response, Headers, URL, console, Date, Promise, JSON, Set, Map,
  });
  assert.ok(handler, 'Deno.serve was not called');
  return handler;
}

async function invite(admin, body) {
  const handler = loadHandler(admin);
  const res = await handler(new Request('https://dev.test/functions/v1/invite-company-member', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
}

// ── La función ────────────────────────────────────────────────────────────

test('email nuevo: invita con el rol de alta "company", lo activa y lo añade al equipo', async () => {
  const admin = backend();
  const { status, json } = await invite(admin, { email: 'New.Member@Example.com', role: 'recruiter', name: 'Ana' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.invited, true);
  const inv = admin.log.find(e => e.invite);
  assert.equal(inv.invite, 'new.member@example.com');
  assert.deepEqual(inv.options, { data: { role: 'company' }, redirectTo: 'https://app.test/auth/set-password' });
  const upsert = admin.log.find(e => e.table === 'profiles' && e.op === 'upsert');
  assert.deepEqual(upsert.payload, { id: 'invited-id', email: 'new.member@example.com', role: 'company_user', status: 'active' });
  const member = admin.log.find(e => e.table === 'company_members' && e.op === 'insert');
  assert.deepEqual(member.payload, { company_id: 'company-1', user_id: 'invited-id', role: 'recruiter', display_name: 'Ana' });
});

for (const metadataRole of ['company', 'company_user']) {
  test(`cuenta de Auth existente con rol "${metadataRole}": se reutiliza con correo de acceso`, async () => {
    const admin = backend({ authUsers: [{ id: 'existing-id', email: 'old@example.com', user_metadata: { role: metadataRole } }] });
    const { status, json } = await invite(admin, { email: 'old@example.com', role: 'viewer' });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.invited, false);
    assert.equal(json.recoverySent, true);
    assert.ok(!admin.log.some(e => e.invite), 'No new account for an existing one');
    const member = admin.log.find(e => e.table === 'company_members' && e.op === 'insert');
    assert.equal(member.payload.user_id, 'existing-id');
  });
}

test('cuenta de Auth existente de técnico: se rechaza sin tocar nada', async () => {
  const admin = backend({ authUsers: [{ id: 'tech-id', email: 'tech@example.com', user_metadata: { role: 'technician' } }] });
  const { status, json } = await invite(admin, { email: 'tech@example.com', role: 'viewer' });
  assert.equal(status, 400);
  assert.match(json.error, /cannot be invited/);
  assert.ok(!admin.log.some(e => e.op === 'insert' || e.op === 'upsert' || e.invite));
});

test('la función ya no da de alta cuentas con el rol company_user', () => {
  const source = read('supabase/functions/invite-company-member/index.ts');
  assert.doesNotMatch(source, /data:\s*\{\s*role:\s*'company_user'/);
});

// ── Primer inicio de sesión del invitado en la app ────────────────────────

test('AuthContext: con metadatos de empresa sólo llama al alta de empresa si no hay membresía', () => {
  const ctx = read('src/auth/AuthContext.tsx');
  const branch = /\} else if \(role === 'company' \|\| role === 'company_user'\) \{([\s\S]*?)\n      \}\n    \} catch/.exec(ctx);
  assert.ok(branch, 'Company branch of ensureRoleProfile not found');
  const code = branch[1];
  const lookup = code.indexOf(".from('company_members')");
  const guard = code.indexOf('if (!data) {');
  const signup = code.indexOf("rpc('signup_company'");
  assert.ok(lookup >= 0 && code.includes(".eq('user_id', user.id)"), 'Membership lookup by user id');
  assert.ok(lookup < guard && guard < signup, 'signup_company only runs when no membership was found');
});

test('una cuenta de empresa activa entra en /company, no en un alta', () => {
  const { roleHomeRoute } = (() => {
    const exports = {};
    const js = ts.transpileModule(read('src/utils/backNavigation.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(js, { exports, require: () => ({}) });
    return exports;
  })();
  assert.equal(roleHomeRoute('company_user', 'active'), '/company');
  assert.equal(roleHomeRoute('company_user', 'pending_verification'), '/auth/pending-verification');
  const setPassword = read('app/auth/set-password.tsx');
  assert.match(setPassword, /if \(profile\.role === 'company_user'\) return '\/company';/);
  assert.doesNotMatch(setPassword, /signup\/company/);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
