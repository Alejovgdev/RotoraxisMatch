// Standalone — sin red ni Supabase real. Borrar la cuenta de un miembro de
// empresa (migración 105):
//
//   - los avisos de la pantalla (src/utils/accountDeletionNotice.ts): la
//     empresa se borra con su último miembro, el único admin con otros miembros
//     tiene que nombrar otro, y si no, la empresa sigue;
//   - la función delete-account con un backend simulado: el 409 sale de
//     must_assign_admin, el logo se borra (sólo la carpeta de esa empresa) ANTES
//     de borrar la cuenta, y si Storage falla no se borra nada;
//   - que la pantalla pasa por el repositorio y no habilita el botón hasta
//     saber qué pasa con la empresa.
//
// Run via: npm run test:company-account-deletion
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
let failed = 0;
const pending = [];
function test(name, fn) {
  pending.push((async () => {
    try {
      await fn();
      passed++;
      console.log(`PASS — ${name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL — ${name}`);
      console.error(err);
    }
  })());
}

function load(file, extraExports = '', mocks = {}, globals = {}) {
  const exports = {};
  const source = read(file) + extraExports;
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(js, {
    exports,
    require: key => { assert.ok(key in mocks, `Unexpected dependency ${key}`); return mocks[key]; },
    console, Map, Set, Date, ...globals,
  });
  return exports;
}

// Lo creado dentro del vm tiene otros prototipos: se compara en JSON.
const plain = value => JSON.parse(JSON.stringify(value));
const loaded = load('src/utils/accountDeletionNotice.ts');
const companyDeletionNotice = impact => plain(loaded.companyDeletionNotice(impact));
const companyAccountCanBeDeleted = loaded.companyAccountCanBeDeleted;
const { deleteAccountCompanyUser } = load('supabase/functions/delete-account/index.ts',
  '\nexport {deleteAccountCompanyUser};',
  { 'https://esm.sh/@supabase/supabase-js@2.107.0': { createClient: () => { throw Error('No network'); } } },
  { Deno: { serve: () => {} } });

const base = {
  companyId: 'c1', companyName: 'Acme MRO', memberRole: 'admin',
  otherMembers: 0, otherAdmins: 0, pendingInvitations: 0,
  offers: 3, applications: 1, directOffers: 2, chats: 1,
  deletesCompany: true, mustAssignAdmin: false,
};

// ── Avisos de la pantalla ─────────────────────────────────────────────────

test('último miembro: avisa con el nombre y lo que se borra', () => {
  const notice = companyDeletionNotice(base);
  assert.equal(notice.kind, 'deletes_company');
  assert.equal(notice.title, 'Acme MRO will be deleted too');
  assert.match(notice.intro, /last member of Acme MRO/);
  assert.deepEqual(notice.items, [
    'The company profile and logo',
    '3 offers',
    '1 application from technicians',
    '2 direct offers sent to technicians',
    '1 chat with technicians, including their messages',
  ]);
  assert.match(notice.footer, /Technicians will no longer see these applications, direct offers or chats/);
  assert.equal(companyAccountCanBeDeleted(base), true);
});

test('las invitaciones pendientes se anuncian como canceladas', () => {
  const notice = companyDeletionNotice({ ...base, pendingInvitations: 2, offers: 1, chats: 0 });
  assert.ok(notice.items.includes('2 pending invitations (cancelled)'));
  assert.ok(notice.items.includes('1 offer'));
  assert.ok(notice.items.includes('0 chats with technicians, including their messages'));
  const one = companyDeletionNotice({ ...base, pendingInvitations: 1 });
  assert.ok(one.items.includes('1 pending invitation (cancelled)'));
});

test('único admin con otros miembros: tiene que nombrar otro y no puede borrar', () => {
  const impact = { ...base, otherMembers: 2, deletesCompany: false, mustAssignAdmin: true };
  const notice = companyDeletionNotice(impact);
  assert.equal(notice.kind, 'must_assign_admin');
  assert.match(notice.text, /only administrator of Acme MRO/);
  assert.match(notice.text, /Pending invitations don't count as members/);
  assert.equal(companyAccountCanBeDeleted(impact), false);
});

test('con otros miembros y otro admin, o sin empresa, la empresa sigue', () => {
  const stays = { ...base, otherMembers: 1, otherAdmins: 1, deletesCompany: false };
  assert.deepEqual(companyDeletionNotice(stays), { kind: 'company_stays' });
  assert.deepEqual(companyDeletionNotice(null), { kind: 'company_stays' });
  assert.equal(companyAccountCanBeDeleted(stays), true);
  assert.equal(companyAccountCanBeDeleted(null), true);
});

// ── La función delete-account ─────────────────────────────────────────────

function backend({ impact, rpcError = null, storageMode = null } = {}) {
  const calls = [];
  const files = { 'company-logos': ['c1/logo-a.png', 'c1/old/logo-b.png', 'c2/keep.png'] };
  let deleted = false;
  return {
    calls, files, get deleted() { return deleted; },
    async rpc(name, args) {
      calls.push(`rpc:${name}`);
      assert.equal(name, 'company_account_deletion_impact');
      assert.deepEqual(plain(args), { p_user_id: 'user' });
      return rpcError ? { data: null, error: rpcError } : { data: impact ? [impact] : [], error: null };
    },
    from() { throw Error('The company path must not read tables directly'); },
    storage: { from(bucket) {
      assert.equal(bucket, 'company-logos');
      return {
        async list(folder, { offset, limit }) {
          calls.push(`list:${folder}`);
          if (storageMode === 'list') return { error: { message: 'fail' } };
          const children = new Map();
          files[bucket].filter(p => p.startsWith(folder + '/')).forEach(p => {
            const rest = p.slice(folder.length + 1);
            const name = rest.split('/')[0];
            children.set(name, { name, id: rest.includes('/') ? null : 'object' });
          });
          return { data: [...children.values()].slice(offset, offset + limit) };
        },
        async remove(paths) {
          calls.push(`remove:${paths.join(',')}`);
          assert.ok(paths.every(p => p.startsWith('c1/')), 'Only the deleted company folder');
          if (storageMode === 'remove') return { error: { message: 'fail' } };
          if (storageMode !== 'unconfirmed') files[bucket] = files[bucket].filter(p => !paths.includes(p));
          return { error: null };
        },
      };
    } },
    auth: { admin: { async deleteUser(id) {
      assert.equal(id, 'user'); calls.push('deleteUser'); deleted = true; return {};
    } } },
  };
}
const row = overrides => ({
  company_id: 'c1', company_name: 'Acme MRO', deletes_company: false, must_assign_admin: false, ...overrides,
});

test('función: único admin con otros miembros -> 409 sin tocar nada', async () => {
  const b = backend({ impact: row({ must_assign_admin: true }) });
  await assert.rejects(deleteAccountCompanyUser(b, 'user'), err => err.status === 409
    && /Pending invitations do not count as members/.test(err.message));
  assert.equal(b.deleted, false);
  assert.deepEqual(b.calls, ['rpc:company_account_deletion_impact']);
});

test('función: la empresa se va -> borra su logo y DESPUÉS la cuenta', async () => {
  const b = backend({ impact: row({ deletes_company: true }) });
  await deleteAccountCompanyUser(b, 'user');
  assert.equal(b.deleted, true);
  assert.deepEqual(b.files['company-logos'], ['c2/keep.png']);
  const removeAt = b.calls.findIndex(c => c.startsWith('remove:'));
  assert.ok(removeAt > 0 && removeAt < b.calls.indexOf('deleteUser'));
});

for (const mode of ['list', 'remove', 'unconfirmed']) {
  test(`función: si Storage no confirma el logo (${mode}), no se borra la cuenta`, async () => {
    const b = backend({ impact: row({ deletes_company: true }), storageMode: mode });
    await assert.rejects(deleteAccountCompanyUser(b, 'user'), err => err.status === 500);
    assert.equal(b.deleted, false);
  });
}

test('función: la empresa sigue -> no toca Storage y borra la cuenta', async () => {
  const b = backend({ impact: row({}) });
  await deleteAccountCompanyUser(b, 'user');
  assert.equal(b.deleted, true);
  assert.deepEqual(b.calls, ['rpc:company_account_deletion_impact', 'deleteUser']);
});

test('función: sin empresa -> borra la cuenta', async () => {
  const b = backend({ impact: null });
  await deleteAccountCompanyUser(b, 'user');
  assert.equal(b.deleted, true);
});

test('función: si no puede consultar la empresa, no borra nada', async () => {
  const b = backend({ rpcError: { message: 'fail' } });
  await assert.rejects(deleteAccountCompanyUser(b, 'user'), err => err.status === 500);
  assert.equal(b.deleted, false);
});

// ── La pantalla ───────────────────────────────────────────────────────────

test('la pantalla consulta la empresa por el repositorio y espera a saberlo', () => {
  const screen = read('app/account/delete.tsx');
  assert.match(screen, /accountDeletionRepository\.getCompanyDeletionImpact\(\)/);
  assert.match(screen, /companyDeletionNotice\(impact\)/);
  assert.match(screen, /companyAccountCanBeDeleted\(impactState\.impact\)/);
  assert.match(screen, /disabled=\{!canDelete \|\| loading\}/);
  assert.doesNotMatch(screen, /supabase\.rpc\(/);
  assert.doesNotMatch(screen, /you must assign another administrator before deleting/);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
