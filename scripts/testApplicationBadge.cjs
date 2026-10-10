// El número de Applications del técnico (fase 8): respuestas a sus candidaturas
// que aún no ha visto, el mismo dato que el punto rojo de su lista.
//
// Ejecuta el repositorio real (src/repositories/v2/activityRepository.ts)
// contra una base en memoria con las dos tablas que lee y escribe
// (activity_events, activity_reads), con la RLS de activity_reads imitada
// (cada usuario sólo ve sus lecturas). Sin red y sin iniciar sesión.
//   - aplicar no suma (ese aviso es para la empresa);
//   - una respuesta (aceptada o rechazada) sin ver suma 1;
//   - al abrirla (markRead) baja, y reabrirla no cambia nada;
//   - mensajes de chat y ofertas directas no cuentan aquí.
// Y que las tres superficies (barra de escritorio, círculo de la Home y título
// de la lista) usan ese número, y Direct offers sigue contando las pendientes.
//
// Run via: npm run test:application-badge (también forma parte de npm test).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function fakeSupabase(db, userId) {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: userId } } } }) },
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        upsert(rows) {
          for (const row of rows) {
            const duplicate = db[table].some((r) => r.activity_event_id === row.activity_event_id && r.profile_id === row.profile_id);
            if (!duplicate) db[table].push({ ...row });
          }
          return Promise.resolve({ error: null });
        },
        then(resolve, reject) {
          let rows = db[table].filter((row) => filters.every((f) => f(row)));
          // RLS de activity_reads: cada usuario sólo ve sus propias lecturas.
          if (table === 'activity_reads') rows = rows.filter((row) => row.profile_id === userId);
          return Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function loadRepository(supabase) {
  const exportsObject = {};
  const compiled = ts.transpileModule(read('src/repositories/v2/activityRepository.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: exportsObject,
    console,
    require: (name) => {
      if (name === '../../lib/supabase') return { supabase };
      if (name === '../../types/activity') return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exportsObject.activityRepository;
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS — ${name}`);
}

async function main() {
  await test('Contador — aplicar no suma; una respuesta sin ver suma 1; al verla, baja', async () => {
    const db = { activity_events: [], activity_reads: [] };
    const repo = loadRepository(fakeSupabase(db, 'tech-user'));
    const count = async () => (await repo.getUnseenApplicationResponseIds('tech')).size;
    const event = (id, type, entity, scope = 'technician') => db.activity_events.push({
      id, type, entity_id: entity, recipient_scope: scope,
      recipient_technician_id: scope === 'technician' ? 'tech' : null,
      recipient_company_id: scope === 'company' ? 'company' : null,
    });

    assert.equal(await count(), 0, 'sin nada');
    // El técnico aplica: el aviso es para la empresa.
    event('e1', 'application_received', 'app-1', 'company');
    assert.equal(await count(), 0, 'aplicar no suma');
    // La empresa acepta: respuesta sin ver.
    event('e2', 'application_accepted', 'app-1');
    assert.equal(await count(), 1, 'una respuesta sin ver suma 1');
    // Otra empresa rechaza otra candidatura.
    event('e3', 'application_rejected', 'app-2');
    assert.equal(await count(), 2, 'un rechazo también es una respuesta');
    // Chat y ofertas directas no cuentan en Applications.
    event('e4', 'chat_message_received', 'room-1');
    event('e5', 'direct_offer_received', 'request-1');
    assert.equal(await count(), 2, 'chat y ofertas directas no cuentan aquí');
    // Otro técnico con respuestas: no son suyas.
    db.activity_events.push({ id: 'e6', type: 'application_accepted', entity_id: 'app-9', recipient_scope: 'technician', recipient_technician_id: 'other' });
    assert.equal(await count(), 2, 'sólo las suyas');

    // Abre la candidatura aceptada (la página de la oferta llama a markRead).
    await repo.markRead('technician', 'tech', 'app-1');
    assert.equal(await count(), 1, 'al verla, baja');
    assert.deepEqual([...(await repo.getUnseenApplicationResponseIds('tech'))], ['app-2']);
    await repo.markRead('technician', 'tech', 'app-1');
    assert.equal(await count(), 1, 'reabrirla no cambia nada');
    // Una lectura de otro usuario no cuenta como vista para este.
    db.activity_reads.push({ activity_event_id: 'e3', profile_id: 'someone-else' });
    assert.equal(await count(), 1, 'las lecturas de otro usuario no cuentan');
    await repo.markRead('technician', 'tech', 'app-2');
    assert.equal(await count(), 0, 'vistas las dos, a cero');
  });

  await test('Superficies — barra de escritorio, círculo de la Home y título de la lista usan ese número; Direct offers no cambia', () => {
    const navContext = read('src/state/TechnicianNavContext.tsx');
    assert.match(navContext, /activityRepository\.getUnseenApplicationResponseIds\(technicianId\)/);
    assert.match(navContext, /setUnseenApplicationResponses\(unseenResponses\.size\)/);
    assert.doesNotMatch(navContext, /countPendingForTechnician\(technicianId\),\s*offerRequestRepository/, 'Applications ya no cuenta las pendientes');
    assert.match(navContext, /offerRequestRepository\.countPendingForTechnician\(technicianId\)/, 'Direct offers sigue con las pendientes');
    const bars = read('src/components/technician/TechnicianNavBars.tsx');
    assert.match(bars, /count: s\.key === 'applications' \? unseenApplicationResponses : s\.key === 'direct' \? pendingDirectOffers : undefined/);
    const home = read('app/technician/(tabs)/index.tsx');
    assert.match(home, /badge=\{unseenApplicationResponses\}\s*badgeLabel="new"/);
    assert.match(home, /badge=\{pendingDirectOffers\}/);
    const list = read('app/technician/applications/index.tsx');
    assert.match(list, /activityRepository\.getUnseenApplicationResponseIds\(technicianId\)/, 'el punto rojo sale del mismo dato');
    assert.match(list, /const unseenCount = entries\.filter\(\(e\) => unreadIds\.has\(e\.app\.id\)\)\.length;/);
    assert.match(list, /unseenCount > 0 \? ` · \$\{unseenCount\} new` : ''/);
    // Al abrirla, el número baja sin esperar a cambiar de pantalla.
    assert.match(read('app/technician/offers/[id].tsx'), /markRead\('technician', technicianId, app\.id\);\s*\/\/[^\n]*\n\s*refreshCounts\(\);/);
  });

  console.log(`\n${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
