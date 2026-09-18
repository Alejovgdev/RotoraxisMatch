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
    const motor = selectOfferKind(sinLicencia, 'engine');
    assert.equal(showsOnlyUnlicensed(motor), true, 'motor sin licencia: aparece');
    // Sesión 2: un motor que pide licencia no puede ser "sólo sin licencia" (077).
    assert.equal(showsOnlyUnlicensed(selectOfferKind(baseForm(), 'engine')), false, 'motor con B1.1: no aparece');
  });

  await test('Formulario — volver a "Yes, licence required" desmarca "sólo sin licencia"', () => {
    const marcada = { ...setRequiresCertification(baseForm(), false), onlyUnlicensed: true };
    const deVuelta = setRequiresCertification(marcada, true);
    assert.equal(deVuelta.requiresCertification, true);
    assert.equal(deVuelta.onlyUnlicensed, false);
    // Y apagarla no la marca sola.
    assert.equal(setRequiresCertification(baseForm(), false).onlyUnlicensed, false);
  });

  await test('Formulario — pasar a motor limpia aeronaves y una licencia que no certifica motor, y nombra el oficio de motor', () => {
    // Una B2 no vale para motor: se va con su autoridad y sus equivalencias.
    const avionico = baseForm({ technicianType: 'avionic', licenseCode: 'B2', acceptsEquivalent: true });
    const motor = selectOfferKind(avionico, 'engine');
    assert.equal(motor.offerKind, 'engine');
    assert.equal(motor.requiresCertification, false);
    assert.equal(motor.licenseAuthority, undefined);
    assert.equal(motor.licenseCode, undefined);
    assert.equal(motor.acceptsEquivalent, false);
    assert.deepEqual(motor.requiredHabilitations, []);
    assert.equal(motor.technicianType, 'engine_technician');
    assert.equal(showsAircraftEditor(motor), false);
    assert.equal(showsLicenseSection(motor), false, 'sin licencia elegida no hay sección');
    assert.equal(showsCertificationQuestion(motor), true, 'sesión 2: en motor la pregunta existe (licencia opcional)');
    assert.equal(describeDropped(droppedByTransition(avionico, motor)), 'the B2 licence requirement and 1 aircraft requirement', 'editar tiene qué preguntar');

    // Sesión 2: una B1.1 sí certifica motor y se queda; sólo se van las aeronaves.
    const conB11 = selectOfferKind(baseForm(), 'engine');
    assert.equal(conB11.licenseCode, 'B1.1');
    assert.equal(conB11.requiresCertification, true);
    assert.deepEqual(conB11.requiredHabilitations, []);
    assert.equal(describeDropped(droppedByTransition(baseForm(), conB11)), '1 aircraft requirement');

    const vuelta = selectOfferKind({ ...motor, requiredEngineId: 'eng-1' }, 'aircraft');
    assert.equal(vuelta.requiredEngineId, undefined, 'una oferta de aeronave no nombra motor');
    assert.equal(vuelta.technicianType, 'mechanic', 'el oficio de motor no se queda en una oferta de aeronave');
  });

  await test('Formulario — motor: la licencia es opcional y los chips sólo ofrecen B1.x, P y A&P', () => {
    const motor = selectOfferKind(baseForm({ requiresCertification: false, licenseAuthority: undefined, licenseCode: undefined }), 'engine');
    assert.equal(showsLicenseSection(motor), false);
    const pide = setRequiresCertification(motor, true);
    assert.equal(showsLicenseSection(pide), true);
    assert.equal(requirementsErrors({ ...pide, requiredEngineId: 'eng-1' }).license, 'Select the licence this role certifies under.');
    assert.deepEqual(selectableLicenses({ ...pide, licenseAuthority: 'FAA' }), ['P', 'A&P']);
    assert.deepEqual(selectableLicenses({ ...pide, licenseAuthority: 'EASA' }), ['B1.1', 'B1.2'], 'aviones');
    assert.deepEqual(selectableLicenses({ ...pide, licenseAuthority: 'UK_CAA', productType: 'Helicopter' }), ['B1.3', 'B1.4'], 'helicópteros');
    assert.deepEqual(selectableAuthorities(pide, AUTHORITIES.map((a) => a.code)), ['EASA', 'UK_CAA', 'CASA', 'GCAA', 'FAA']);
    // Un motor FAA P que vuelve a aeronave conserva la P: la pide un mecánico.
    const faaP = selectLicense(selectAuthority(pide, 'FAA'), 'P');
    assert.equal(selectOfferKind(faaP, 'aircraft').licenseCode, 'P');
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

  await test('Formulario — FAA: mecánico ve A, P y A&P; aviónico ve A y A&P; las equivalencias desaparecen', () => {
    const faa = selectAuthority(baseForm({ acceptsEquivalent: true }), 'FAA');
    assert.equal(faa.licenseCode, undefined, 'B1.1 no existe en la FAA');
    assert.deepEqual(faa.requiredHabilitations, [], 'las aeronaves colgaban de la B1.1 que se fue');
    assert.equal(faa.acceptsEquivalent, false, 'la FAA no cruza con nadie');
    assert.equal(showsAcceptsEquivalent(faa), false);
    assert.deepEqual(selectableLicenses(faa), ['A', 'P', 'A&P']);

    const conAyP = selectLicense(faa, 'A&P');
    assert.equal(conAyP.licenseCode, 'A&P');

    // Sesión 2: aviónica puede pedir A o A&P a la FAA; P no.
    const avionico = baseForm({ technicianType: 'avionic', licenseCode: 'B2' });
    assert.ok(selectableAuthorities(avionico, AUTHORITIES.map((a) => a.code)).includes('FAA'));
    assert.deepEqual(selectableLicenses({ ...avionico, licenseAuthority: 'FAA', licenseCode: undefined }), ['A', 'A&P']);
    // Un mecánico FAA A&P que pasa a aviónico conserva autoridad y licencia;
    // con P, la licencia se va.
    const aAvionico = selectTechnicianType(conAyP, 'avionic');
    assert.equal(aAvionico.licenseAuthority, 'FAA');
    assert.equal(aAvionico.licenseCode, 'A&P');
    assert.equal(selectTechnicianType(selectLicense(faa, 'P'), 'avionic').licenseCode, undefined);
  });

  await test('Formulario — FAA con aeronaves: el editor aparece y cambiar A por A&P no se lleva la experiencia', () => {
    const faa = baseForm({ licenseAuthority: 'FAA', licenseCode: 'A', requiredHabilitations: [A320] });
    assert.equal(showsAircraftEditor(faa), true, 'sesión 2: las aeronaves se piden como experiencia');
    assert.deepEqual(selectLicense(faa, 'A&P').requiredHabilitations, [A320], 'no cuelgan de la licencia');
    // Part-66 no cambia: cambiar de licencia sigue limpiando las aeronaves.
    assert.deepEqual(selectLicense(baseForm(), 'B1.2').requiredHabilitations, []);
    // Sin licencia elegida, pasar de EASA a la FAA conserva las aeronaves.
    const sinLicencia = baseForm({ licenseCode: undefined });
    assert.deepEqual(selectAuthority(sinLicencia, 'FAA').requiredHabilitations, [A320]);
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
          const guard = licensesSelectableForOffer({ offerKind: 'aircraft', technicianType }, authority);
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
    op: 'insert' | 'update' | 'delete' | 'select' | 'upsert' | 'rpc';
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
  // offer_applications, para offerApplicationRepository (paso 5c). La base de
  // verdad rechaza con el trigger de la 080; aquí se simula su respuesta.
  let applicationRows: Record<string, unknown>[] = [];
  let applicationRejection: { code: string; message: string; details: string } | null = null;

  const fakeSupabase = {
    async rpc(name: string, args: Record<string, any>) {
      calls.push({ table: name, op: 'rpc', data: args });
      if (name === 'update_offer_with_habilitations') {
        const oldProduct = offerRow.product_type;
        offerRow = { ...offerRow, ...args.p_patch };
        if (args.p_habilitations !== null) habilitationRows = args.p_habilitations.map((h: any) => ({ ...h, offer_id: args.p_offer_id, product_type: offerRow.product_type }));
        else if (oldProduct !== offerRow.product_type || offerRow.offer_kind === 'engine') habilitationRows = [];
        return { data: [{ ...offerRow }], error: null };
      }
      return { data: null, error: null };
    },
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
          if (table === 'offer_applications') {
            if ((op === 'insert' || op === 'update') && applicationRejection) {
              return Promise.resolve({ data: null, error: applicationRejection }).then(resolve);
            }
            if (op === 'insert' && write && !Array.isArray(write)) {
              const row = { id: 'app-1', status: 'pending', identity_revealed: false, documents_unlocked: false, created_at: '2026-09-16', updated_at: '2026-09-16', ...write };
              applicationRows = [row];
              return Promise.resolve({ data: row, error: null }).then(resolve);
            }
            if (op === 'update' && write && !Array.isArray(write)) {
              applicationRows = applicationRows.map((r) => ({ ...r, ...write }));
              return Promise.resolve({ data: applicationRows[0], error: null }).then(resolve);
            }
            return Promise.resolve({ data: applicationRows, error: null }).then(resolve);
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
  const lastWrite = (table: string, op: Call['op']) => table === 'offers' && op === 'update'
    ? ([...calls].reverse().find((c) => c.table === 'update_offer_with_habilitations')?.data?.p_patch as Record<string, unknown> ?? {})
    : [...calls].reverse().find((c) => c.table === table && c.op === op)?.data ?? {};
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

  await test('Repositorio — rechaza lo que el formulario no ofrece: P FAA en aviónica, licencia sin autoridad, B1.1 FAA', async () => {
    reset();
    const certifica = { ...base, requiresCertification: true };
    await assert.rejects(offerRepository.create({ ...certifica, technicianType: 'avionic', licenseAuthority: 'FAA', licenseCode: 'P' }), /not a licence/);
    await assert.rejects(offerRepository.create({ ...certifica, technicianType: 'mechanic', licenseCode: 'B1.1' }), /authority/);
    await assert.rejects(offerRepository.create({ ...certifica, technicianType: 'mechanic', licenseAuthority: 'FAA', licenseCode: 'B1.1' }), /does not issue/);
    assert.equal(calls.filter((c) => c.op !== 'select').length, 0, 'nada se escribió');
  });

  await test('Repositorio — sesión 2: aviónica FAA A&P y una oferta FAA con aeronaves se escriben', async () => {
    reset();
    await offerRepository.create({ ...base, technicianType: 'avionic', requiresCertification: true, licenseAuthority: 'FAA', licenseCode: 'A&P' });
    assert.equal(lastWrite('offers', 'insert').technician_type, 'avionic');

    reset();
    await offerRepository.create({
      ...base, technicianType: 'mechanic', requiresCertification: true, licenseAuthority: 'FAA', licenseCode: 'A&P', requiredHabilitations: [A320],
    });
    assert.deepEqual(habilitationRows.map((h) => h.aircraft_type_rating_id), ['rating-a320'], 'las aeronaves llegan a la RPC');
    // Un patch posterior sin lista nueva no las vacía (la 086 quita la cláusula FAA).
    await offerRepository.update('offer-1', { title: 'Renamed' });
    assert.equal(habilitationRows.length, 1);
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
    // Sesión 2: licencia opcional en motor, sólo B1.x, P o A&P.
    await offerRepository.create({
      ...base, technicianType: 'engine_technician', offerKind: 'engine', requiredEngineId: 'eng-cfm56-7b',
      requiresCertification: true, licenseAuthority: 'FAA', licenseCode: 'A&P',
    });
    const conLicencia = lastWrite('offers', 'insert');
    assert.equal(conLicencia.license_code, 'A&P');
    assert.equal(conLicencia.requires_certification, true);
    await offerRepository.create({
      ...base, technicianType: 'engine_technician', offerKind: 'engine', requiredEngineId: 'eng-cfm56-7b',
      requiresCertification: true, licenseAuthority: 'EASA', licenseCode: 'B1.1',
    });
    for (const [licenseAuthority, licenseCode] of [['EASA', 'B2'], ['EASA', 'C'], ['FAA', 'A']] as const) {
      await assert.rejects(
        offerRepository.create({
          ...base, technicianType: 'engine_technician', offerKind: 'engine', requiredEngineId: 'eng-cfm56-7b',
          requiresCertification: true, licenseAuthority, licenseCode,
        }),
        /Part-66 B1 licence or an FAA P or A&P/,
        `${licenseAuthority} ${licenseCode}`,
      );
    }
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

  await test('Repositorio — pasar a motor guarda clase, certificación y aeronaves en una RPC', async () => {
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
    assert.deepEqual(calls.filter((c) => c.op !== 'select').map((c) => c.table), ['update_offer_with_habilitations']);
    assert.equal(habilitationRows.length, 0);
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

  await test('Repositorio de técnico — replaceEngineExperience usa una RPC y conserva NULL', async () => {
    calls.length = 0;
    await technicianRepositoryV2.replaceEngineExperience('tech-1', [{ engineId: 'eng-1', years: 6 }, { engineId: 'eng-2' }]);
    assert.deepEqual(calls.map((c) => c.table), ['replace_technician_engines']);
    const rows = calls[0].data!.p_entries as Record<string, unknown>[];
    assert.deepEqual(rows, [
      { engine_id: 'eng-1', years: 6 },
      { engine_id: 'eng-2', years: null },
    ]);
    calls.length = 0;
    await technicianRepositoryV2.replaceEngineExperience('tech-1', []);
    assert.deepEqual(calls.map((c) => c.op), ['rpc']);
    assert.deepEqual(calls[0].data!.p_entries, []);
  });

  // ── Candidaturas: el rechazo de la base llega como el texto de siempre ──

  const { offerApplicationRepository } = require('../src/repositories/v2/offerApplicationRepository') as typeof import('../src/repositories/v2/offerApplicationRepository');
  const { ineligibilityReasonText } = require('../src/utils/offerMatchExplain') as typeof import('../src/utils/offerMatchExplain');
  const aplicar = () =>
    offerApplicationRepository.create({ technicianId: 'tech-1', offerId: 'offer-1', companyId: 'company-1', coverNote: 'hola' });
  const ofertaPublicada = () => {
    offerRow = { id: 'offer-1', company_id: 'company-1', status: 'published', visible: true, offer_kind: 'engine', required_engine_id: 'eng-1' };
  };

  await test('Candidatura — un técnico no elegible no la crea aunque salte la UI: el PT403 de la base llega con su motivo', async () => {
    ofertaPublicada();
    applicationRows = [];
    for (const reason of ['no_engine_experience', 'licensed_technician'] as const) {
      applicationRejection = { code: 'PT403', message: 'The technician is not eligible for this offer.', details: reason };
      await assert.rejects(aplicar(), (err: Error) => err.message === ineligibilityReasonText(reason), `motivo ${reason}`);
    }
    assert.deepEqual(applicationRows, [], 'no queda candidatura');
  });

  await test('Candidatura — re-aplicar tras retirarse también pasa por la base: la reactivación rechazada da el mismo texto', async () => {
    ofertaPublicada();
    applicationRows = [{ id: 'app-1', technician_id: 'tech-1', offer_id: 'offer-1', company_id: 'company-1', status: 'withdrawn', created_at: '2026-09-01', updated_at: '2026-09-01' }];
    applicationRejection = { code: 'PT403', message: 'The technician is not eligible for this offer.', details: 'no_engine_experience' };
    await assert.rejects(aplicar(), (err: Error) => err.message === ineligibilityReasonText('no_engine_experience'));
    assert.equal(applicationRows[0].status, 'withdrawn', 'sigue retirada');
  });

  await test('Candidatura — un técnico elegible la crea; un error que no es de elegibilidad no se disfraza de motivo', async () => {
    ofertaPublicada();
    applicationRows = [];
    applicationRejection = null;
    const creada = await aplicar();
    assert.equal(creada.status, 'pending');
    assert.equal(creada.technicianId, 'tech-1');

    applicationRows = [];
    applicationRejection = { code: '42501', message: 'new row violates row-level security policy', details: '' };
    await assert.rejects(aplicar(), /row-level security/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
