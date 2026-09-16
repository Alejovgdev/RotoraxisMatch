// Fase 10, paso 5b — el formulario de oferta y lo que el repositorio escribe.
//
// Dos mitades:
//   1. offerFormRules, puro: qué enseña el formulario y qué limpia cada cambio.
//   2. offerRepository de verdad contra un PostgREST falso (mismo truco que
//      scripts/testOfferSalary.ts: sólo se sustituye el transporte). Es la
//      prueba de que el selector de autoridad escribe una oferta FAA bien, que
//      es la condición para haber abierto la guarda Part-66 del repositorio.
//      Que Postgres acepte ese INSERT se comprobó aparte contra la base.
//
// Run: npm run test:offer-form
import assert from 'node:assert/strict';
import {
  OfferRequirementsForm,
  describeDropped,
  droppedByTransition,
  requirementsErrors,
  selectAuthority,
  selectLicense,
  selectOfferKind,
  selectProductType,
  selectTechnicianType,
  selectableAuthorities,
  selectableLicenses,
  setRequiresCertification,
  showsAcceptsEquivalent,
  showsAircraftEditor,
  showsCertificationQuestion,
  showsLicenseSection,
  showsOnlyUnlicensed,
} from '../src/utils/offerFormRules';
import { AUTHORITIES, licensesSelectableForOffer } from '../src/constants/licenses';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS — ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL — ${name}`);
    console.error(err instanceof Error ? err.stack ?? err.message : err);
  }
}

const A320 = { aircraftTypeRatingId: 'rating-a320' };

function baseForm(overrides: Partial<OfferRequirementsForm> = {}): OfferRequirementsForm {
  return {
    offerKind: 'aircraft',
    requiredEngineId: undefined,
    productType: 'Aeroplane',
    technicianType: 'mechanic',
    requiresCertification: true,
    licenseAuthority: 'EASA',
    licenseCode: 'B1.1',
    acceptsEquivalent: false,
    onlyUnlicensed: false,
    requiresAllAircraft: false,
    requiredHabilitations: [A320],
    ...overrides,
  };
}

async function main() {
  // ── 1. Reglas del formulario ────────────────────────────────────────────

  await test('Formulario — "Sólo sin licencia" sólo aparece con "No licence needed", en aeronave y en motor', () => {
    assert.equal(showsOnlyUnlicensed(baseForm()), false, 'licencia requerida: no aparece');
    const sinLicencia = setRequiresCertification(baseForm(), false);
    assert.equal(showsOnlyUnlicensed(sinLicencia), true, 'aeronave sin licencia: aparece');
    const motor = selectOfferKind(baseForm(), 'engine');
    assert.equal(showsOnlyUnlicensed(motor), true, 'motor: aparece');
  });

  await test('Formulario — volver a "Yes, licence required" desmarca "sólo sin licencia"', () => {
    const marcada = { ...setRequiresCertification(baseForm(), false), onlyUnlicensed: true };
    const deVuelta = setRequiresCertification(marcada, true);
    assert.equal(deVuelta.requiresCertification, true);
    assert.equal(deVuelta.onlyUnlicensed, false);
    // Y apagarla no la marca sola.
    assert.equal(setRequiresCertification(baseForm(), false).onlyUnlicensed, false);
  });

  await test('Formulario — pasar a motor limpia licencia, autoridad, equivalencias y aeronaves, y nombra el oficio de motor', () => {
    const motor = selectOfferKind(baseForm({ acceptsEquivalent: true }), 'engine');
    assert.equal(motor.offerKind, 'engine');
    assert.equal(motor.requiresCertification, false);
    assert.equal(motor.licenseAuthority, undefined);
    assert.equal(motor.licenseCode, undefined);
    assert.equal(motor.acceptsEquivalent, false);
    assert.deepEqual(motor.requiredHabilitations, []);
    assert.equal(motor.technicianType, 'engine_technician');
    assert.equal(showsAircraftEditor(motor), false);
    assert.equal(showsLicenseSection(motor), false);
    assert.equal(showsCertificationQuestion(motor), false);
    assert.equal(describeDropped(droppedByTransition(baseForm(), motor)), 'the B1.1 licence requirement and 1 aircraft requirement', 'editar tiene qué preguntar');

    const vuelta = selectOfferKind({ ...motor, requiredEngineId: 'eng-1' }, 'aircraft');
    assert.equal(vuelta.requiredEngineId, undefined, 'una oferta de aeronave no nombra motor');
    assert.equal(vuelta.technicianType, 'mechanic', 'el oficio de motor no se queda en una oferta de aeronave');
  });

  await test('Formulario — sin autoridad no hay licencias que elegir, y el error pide la autoridad', () => {
    const sinAutoridad = baseForm({ licenseAuthority: undefined, licenseCode: undefined });
    assert.deepEqual(selectableLicenses(sinAutoridad), []);
    const errores = requirementsErrors(sinAutoridad);
    assert.ok(errores.authority);
    assert.ok(errores.license);
    assert.deepEqual(requirementsErrors(baseForm()), { authority: undefined, license: undefined, engine: undefined });
    assert.ok(requirementsErrors(selectOfferKind(baseForm(), 'engine')).engine, 'motor sin motor elegido');
  });

  await test('Formulario — FAA: mecánico ve A, P y A&P; aviónico no ve la FAA; las aeronaves y las equivalencias desaparecen', () => {
    const faa = selectAuthority(baseForm({ acceptsEquivalent: true }), 'FAA');
    assert.equal(faa.licenseCode, undefined, 'B1.1 no existe en la FAA');
    assert.deepEqual(faa.requiredHabilitations, [], 'la FAA no emite type ratings');
    assert.equal(faa.acceptsEquivalent, false, 'la FAA no cruza con nadie');
    assert.equal(showsAircraftEditor(faa), false);
    assert.equal(showsAcceptsEquivalent(faa), false);
    assert.deepEqual(selectableLicenses(faa), ['A', 'P', 'A&P']);

    const conAyP = selectLicense(faa, 'A&P');
    assert.equal(conAyP.licenseCode, 'A&P');

    const avionico = baseForm({ technicianType: 'avionic', licenseCode: 'B2' });
    assert.ok(!selectableAuthorities(avionico, AUTHORITIES.map((a) => a.code)).includes('FAA'));
    // Cambiar un mecánico FAA a aviónico se lleva la autoridad y la licencia.
    const aAvionico = selectTechnicianType(conAyP, 'avionic');
    assert.equal(aAvionico.licenseAuthority, undefined);
    assert.equal(aAvionico.licenseCode, undefined);
  });

  await test('Formulario — cambiar entre Part-66 conserva la licencia y sus aeronaves si existe; CASA se lleva la B3', () => {
    const uk = selectAuthority(baseForm({ acceptsEquivalent: true }), 'UK_CAA');
    assert.equal(uk.licenseCode, 'B1.1');
    assert.deepEqual(uk.requiredHabilitations, [A320]);
    assert.equal(uk.acceptsEquivalent, true);
    assert.equal(showsAcceptsEquivalent(uk), true);

    const b3 = baseForm({ licenseCode: 'B3' });
    const casa = selectAuthority(b3, 'CASA');
    assert.equal(casa.licenseCode, undefined, 'CASA no emite B3');
    assert.deepEqual(casa.requiredHabilitations, []);
    assert.ok(!selectableLicenses(casa).includes('B3'));
  });

  await test('Formulario — lo que ofrecen los chips es lo que acepta la guarda del repositorio', () => {
    for (const technicianType of ['mechanic', 'avionic', 'painter'] as const) {
      for (const { code: authority } of AUTHORITIES) {
        for (const productType of ['Aeroplane', 'Helicopter'] as const) {
          const form = baseForm({ technicianType, licenseAuthority: authority, productType, licenseCode: undefined });
          const guard = licensesSelectableForOffer(technicianType, authority);
          for (const code of selectableLicenses(form)) {
            assert.ok(guard.includes(code), `${technicianType} ${authority} ${productType}: el chip ${code} lo rechazaría el repositorio`);
          }
        }
      }
    }
  });

  await test('Formulario — cambiar de producto no se lleva una licencia FAA (no distingue aviones de helicópteros)', () => {
    const faa = selectLicense(selectAuthority(baseForm(), 'FAA'), 'A&P');
    assert.equal(selectProductType(faa, 'Helicopter').licenseCode, 'A&P');
    assert.equal(selectProductType(baseForm(), 'Helicopter').licenseCode, undefined, 'la B1.1 sí se va');
  });

  // ── 2. El repositorio contra un PostgREST falso ────────────────────────

  type Call = {
    table: string;
    op: 'insert' | 'update' | 'delete' | 'select' | 'upsert';
    data?: Record<string, unknown>;
    inArgs?: [string, unknown[]];
    onConflict?: string;
  };
  const calls: Call[] = [];
  let offerRow: Record<string, unknown> = {};
  let habilitationRows: Record<string, unknown>[] = [];
  // Tablas del técnico, para technicianRepositoryV2.
  let licenseRows: Record<string, unknown>[] = [];
  let licenseDependents: Record<string, unknown>[] = [];

  const fakeSupabase = {
    from(table: string) {
      let op: Call['op'] = 'select';
      let write: Record<string, unknown> | Record<string, unknown>[] | undefined;
      let one = false;
      let inArgs: [string, unknown[]] | undefined;
      let onConflict: string | undefined;
      const query = {
        select() { return query; },
        eq() { return query; }, order() { return query; },
        in(column: string, values: unknown[]) { inArgs = [column, values]; return query; },
        delete() { op = 'delete'; return query; },
        insert(data: Record<string, unknown> | Record<string, unknown>[]) { op = 'insert'; write = data; return query; },
        upsert(data: Record<string, unknown>[], options: { onConflict: string }) { op = 'upsert'; write = data; onConflict = options.onConflict; return query; },
        update(data: Record<string, unknown>) { op = 'update'; write = data; return query; },
        single() { one = true; return query; },
        maybeSingle() { one = true; return query; },
        then(resolve: (result: unknown) => unknown) {
          calls.push({ table, op, data: Array.isArray(write) ? { rows: write } : write, inArgs, onConflict });
          if (table === 'technician_licenses') {
            if (op === 'delete' && inArgs) {
              const ids = inArgs[1];
              const deleted = licenseRows.filter((r) => ids.includes(r.id));
              licenseRows = licenseRows.filter((r) => !ids.includes(r.id));
              return Promise.resolve({ data: deleted.map((r) => ({ id: r.id })), error: null }).then(resolve);
            }
            if (op === 'upsert') return Promise.resolve({ data: write, error: null }).then(resolve);
            return Promise.resolve({ data: licenseRows, error: null }).then(resolve);
          }
          if (table === 'technician_habilitations') {
            return Promise.resolve({ data: licenseDependents, error: null }).then(resolve);
          }
          if (table === 'technician_engine_experience') {
            return Promise.resolve({ data: op === 'insert' ? write : [], error: null }).then(resolve);
          }
          if (table === 'offers') {
            if (write && !Array.isArray(write)) offerRow = { id: 'offer-1', created_at: '2026-09-16', updated_at: '2026-09-16', ...offerRow, ...write };
            if (op === 'delete') return Promise.resolve({ data: [{ id: 'offer-1' }], error: null }).then(resolve);
            return Promise.resolve({ data: one ? { ...offerRow } : [{ ...offerRow }], error: null }).then(resolve);
          }
          if (table === 'offer_required_habilitations') {
            if (op === 'delete') habilitationRows = [];
            if (op === 'insert' && Array.isArray(write)) habilitationRows = write;
            if (op === 'select') return Promise.resolve({ data: habilitationRows, error: null }).then(resolve);
            return Promise.resolve({ data: op === 'insert' ? habilitationRows : [], error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const modulePath = require.resolve('../src/lib/supabase');
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: { supabase: fakeSupabase } } as NodeModule;
  const { offerRepository } = require('../src/repositories/v2/offerRepository') as typeof import('../src/repositories/v2/offerRepository');

  const base = {
    companyId: 'company-1',
    title: 'Offer',
    description: 'Offer',
    contractType: 'permanent' as const,
    productType: 'Aeroplane' as const,
    location: { country: { code: 'ES', name: 'Spain' }, city: null },
    minYearsExperience: 0,
  };
  const lastWrite = (table: string, op: Call['op']) => [...calls].reverse().find((c) => c.table === table && c.op === op)?.data ?? {};
  const reset = () => { calls.length = 0; offerRow = {}; habilitationRows = []; };

  await test('Repositorio — una oferta FAA A&P se escribe con su autoridad, y sale igual al leerla', async () => {
    reset();
    const creada = await offerRepository.create({
      ...base,
      technicianType: 'mechanic',
      requiresCertification: true,
      licenseAuthority: 'FAA',
      licenseCode: 'A&P',
    });
    const fila = lastWrite('offers', 'insert');
    assert.equal(fila.license_code, 'A&P');
    assert.equal(fila.license_authority, 'FAA');
    assert.equal(fila.offer_kind, 'aircraft');
    assert.equal(fila.accepts_equivalent, false);
    assert.equal(fila.only_unlicensed, false);
    assert.equal(fila.required_engine_id, null);
    assert.equal(creada.licenseAuthority, 'FAA');
    assert.equal(creada.licenseCode, 'A&P');
  });

  await test('Repositorio — rechaza lo que el formulario no ofrece: FAA en aviónica, licencia sin autoridad, B1.1 FAA, FAA con aeronaves', async () => {
    reset();
    const certifica = { ...base, requiresCertification: true };
    await assert.rejects(offerRepository.create({ ...certifica, technicianType: 'avionic', licenseAuthority: 'FAA', licenseCode: 'A&P' }), /not a licence/);
    await assert.rejects(offerRepository.create({ ...certifica, technicianType: 'mechanic', licenseCode: 'B1.1' }), /authority/);
    await assert.rejects(offerRepository.create({ ...certifica, technicianType: 'mechanic', licenseAuthority: 'FAA', licenseCode: 'B1.1' }), /does not issue/);
    await assert.rejects(
      offerRepository.create({ ...certifica, technicianType: 'mechanic', licenseAuthority: 'FAA', licenseCode: 'A&P', requiredHabilitations: [A320] }),
      /no aircraft type ratings/,
    );
    assert.equal(calls.filter((c) => c.op !== 'select').length, 0, 'nada se escribió');
  });

  await test('Repositorio — oferta de motor con "sólo sin licencia": offer_kind, motor y filtro en la fila; sin licencia', async () => {
    reset();
    const creada = await offerRepository.create({
      ...base,
      technicianType: 'engine_technician',
      requiresCertification: false,
      offerKind: 'engine',
      requiredEngineId: 'eng-cfm56-7b',
      onlyUnlicensed: true,
    });
    const fila = lastWrite('offers', 'insert');
    assert.equal(fila.offer_kind, 'engine');
    assert.equal(fila.required_engine_id, 'eng-cfm56-7b');
    assert.equal(fila.only_unlicensed, true);
    assert.equal(fila.license_code, null);
    assert.equal(fila.license_authority, null);
    assert.equal(creada.offerKind, 'engine');

    await assert.rejects(offerRepository.create({ ...base, technicianType: 'engine_technician', requiresCertification: false, offerKind: 'engine' }), /must name the engine/);
    await assert.rejects(
      offerRepository.create({ ...base, technicianType: 'engine_technician', requiresCertification: false, offerKind: 'engine', requiredEngineId: 'e', requiredHabilitations: [A320] }),
      /cannot require aircraft/,
    );
    await assert.rejects(
      offerRepository.create({ ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'EASA', licenseCode: 'B1.1', onlyUnlicensed: true }),
      /without a licence/,
    );
    // Aeronave sin licencia con el filtro: válida.
    await offerRepository.create({ ...base, technicianType: 'painter', requiresCertification: false, onlyUnlicensed: true });
    assert.equal(lastWrite('offers', 'insert').only_unlicensed, true);
  });

  await test('Repositorio — pasar a motor borra las aeronaves ANTES del UPDATE y escribe clase y certificación juntas', async () => {
    reset();
    await offerRepository.create({
      ...base,
      technicianType: 'mechanic',
      requiresCertification: true,
      licenseAuthority: 'EASA',
      licenseCode: 'B1.1',
      requiredHabilitations: [A320],
    });
    assert.equal(habilitationRows.length, 1);
    calls.length = 0;

    await offerRepository.update('offer-1', {
      offerKind: 'engine',
      requiredEngineId: 'eng-cfm56-7b',
      technicianType: 'engine_technician',
      requiresCertification: false,
    });
    const borrado = calls.findIndex((c) => c.table === 'offer_required_habilitations' && c.op === 'delete');
    const update = calls.findIndex((c) => c.table === 'offers' && c.op === 'update');
    assert.ok(borrado !== -1 && update !== -1 && borrado < update, `orden: ${calls.map((c) => `${c.table}.${c.op}`).join(' → ')}`);
    const escrito = lastWrite('offers', 'update');
    assert.equal(escrito.offer_kind, 'engine');
    assert.equal(escrito.required_engine_id, 'eng-cfm56-7b');
    assert.equal(escrito.requires_certification, false);
    assert.equal(escrito.license_code, null);
    assert.equal(escrito.license_authority, null);
  });

  await test('Repositorio — volver a certificar desmarca "sólo sin licencia" en la misma escritura; pedirlo explícitamente lanza', async () => {
    reset();
    await offerRepository.create({ ...base, technicianType: 'mechanic', requiresCertification: false, onlyUnlicensed: true });
    const actualizada = await offerRepository.update('offer-1', { requiresCertification: true, licenseAuthority: 'UK_CAA', licenseCode: 'B1.1' });
    const escrito = lastWrite('offers', 'update');
    assert.equal(escrito.only_unlicensed, false);
    assert.equal(escrito.license_authority, 'UK_CAA');
    assert.equal(actualizada?.onlyUnlicensed, false);

    await assert.rejects(offerRepository.update('offer-1', { onlyUnlicensed: true }), /without a licence/);
  });

  await test('Repositorio — un patch que no toca requisitos no reescribe sus columnas', async () => {
    reset();
    await offerRepository.create({ ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'EASA', licenseCode: 'B1.1' });
    await offerRepository.update('offer-1', { title: 'Renamed' });
    const escrito = lastWrite('offers', 'update');
    assert.deepEqual(Object.keys(escrito).sort(), ['title']);
  });

  // ── Perfil del técnico: licencias por credencial y motores ──────────────

  // documentRepositoryV2 (importado por el de técnicos) arrastra
  // src/lib/documentStorage, que importa react-native y expo-file-system: Node
  // no los carga. Nada de lo que se prueba aquí toca documentos, así que se
  // sustituye por un módulo vacío, igual que Supabase.
  const storagePath = require.resolve('../src/lib/documentStorage');
  require.cache[storagePath] = {
    id: storagePath,
    filename: storagePath,
    loaded: true,
    exports: { removeDocumentFromStorage: async () => undefined },
  } as unknown as NodeModule;
  const { technicianRepositoryV2 } = require('../src/repositories/v2/technicianRepositoryV2') as typeof import('../src/repositories/v2/technicianRepositoryV2');

  await test('Repositorio de técnico — upsertLicenses manda la autoridad de cada credencial y el onConflict de la 073', async () => {
    calls.length = 0;
    await technicianRepositoryV2.upsertLicenses('tech-1', [
      { authority: 'UK_CAA', code: 'B1.1' },
      { authority: 'FAA', code: 'A&P' },
    ]);
    const upsert = calls.find((c) => c.table === 'technician_licenses' && c.op === 'upsert')!;
    const rows = upsert.data!.rows as Record<string, unknown>[];
    assert.deepEqual(rows.map((r) => `${r.authority} ${r.license_code}`), ['UK_CAA B1.1', 'FAA A&P']);
    assert.equal(upsert.onConflict, 'technician_id,authority,license_code');
  });

  await test('Repositorio de técnico — quitar la B1.1 EASA borra sólo esa fila; la UK CAA con habilitaciones se queda', async () => {
    licenseRows = [
      { id: 'lic-easa', authority: 'EASA', license_code: 'B1.1' },
      { id: 'lic-uk', authority: 'UK_CAA', license_code: 'B1.1' },
      { id: 'lic-b2', authority: 'EASA', license_code: 'B2' },
    ];
    licenseDependents = [];
    calls.length = 0;
    const { blocked } = await technicianRepositoryV2.removeUnreferencedLicenses('tech-1', [
      { authority: 'UK_CAA', code: 'B1.1' },
      { authority: 'EASA', code: 'B2' },
    ]);
    assert.deepEqual(blocked, []);
    assert.deepEqual(licenseRows.map((r) => r.id).sort(), ['lic-b2', 'lic-uk'], 'sólo cae la EASA');

    // Y una credencial con habilitaciones colgando se bloquea, con su nombre.
    licenseRows = [{ id: 'lic-uk', authority: 'UK_CAA', license_code: 'B1.1' }];
    licenseDependents = [{ technician_license_id: 'lic-uk' }];
    const segundo = await technicianRepositoryV2.removeUnreferencedLicenses('tech-1', []);
    assert.deepEqual(segundo.blocked, ['UK CAA B1.1']);
    assert.equal(licenseRows.length, 1);
  });

  await test('Repositorio de técnico — replaceEngineExperience reemplaza (borra e inserta) y guarda los años como NULL si no hay', async () => {
    calls.length = 0;
    await technicianRepositoryV2.replaceEngineExperience('tech-1', [{ engineId: 'eng-1', years: 6 }, { engineId: 'eng-2' }]);
    const ops = calls.filter((c) => c.table === 'technician_engine_experience').map((c) => c.op);
    assert.deepEqual(ops, ['delete', 'insert']);
    const rows = calls.find((c) => c.table === 'technician_engine_experience' && c.op === 'insert')!.data!.rows as Record<string, unknown>[];
    assert.deepEqual(rows, [
      { technician_id: 'tech-1', engine_id: 'eng-1', years: 6 },
      { technician_id: 'tech-1', engine_id: 'eng-2', years: null },
    ]);
    calls.length = 0;
    await technicianRepositoryV2.replaceEngineExperience('tech-1', []);
    assert.deepEqual(calls.map((c) => c.op), ['delete'], 'sin motores sólo se borra');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
