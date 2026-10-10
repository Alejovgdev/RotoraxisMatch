// Standalone tests — sin Supabase real y sin navegador. Cubren el rediseño del
// técnico, fase 6A (docs/UI_REDESIGN.md, respuestas 25 y 29, T3 y T4):
//
//   - el caso de uso que sustituye a handleSave (src/usecases/technicianProfile.ts),
//     con las validaciones de hoy, cada una antes de escribir nada;
//   - que guardar una pantalla pequeña no cambia los demás campos: el caso de
//     uso y el REPOSITORIO REAL sobre una tabla en memoria, incluida la columna
//     `availability`, que guarda disponibilidad y contratos juntos;
//   - el aviso al quitar Engine Technician teniendo motores, que ahora se
//     guarda al tocar;
//   - las reglas puras de You y My work (candados, borrador de licencias,
//     resúmenes) y la carga del perfil;
//   - la estructura de las pantallas: cada campo de hoy acaba en una pantalla.
//
// Run via: npm run test:technician-profile
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { TechnicianWithRelations } from '../src/types/technician';
import type { AircraftTypeRatingCatalog, EngineCatalog } from '../src/types/catalog';

// ── Una tabla technician_profiles en memoria, detrás del supabase falso ──────
//
// El repositorio real (getOwnJsonColumns, updateOwnProfile) habla con esto. Se
// instala antes de cargar nada que importe src/lib/supabase.

type Row = Record<string, unknown> & { id: string };
const table: { rows: Row[]; rlsBlocksUpdates: boolean } = { rows: [], rlsBlocksUpdates: false };
const writeLog: string[] = [];

function makeQuery(tableName: string) {
  const state: { op: 'select' | 'update'; cols: string; payload: Record<string, unknown> | null; filters: Record<string, unknown> } = {
    op: 'select', cols: '*', payload: null, filters: {},
  };
  const matching = () => table.rows.filter((r) => Object.entries(state.filters).every(([k, v]) => r[k] === v));
  const pick = (r: Row) => (state.cols === '*'
    ? { ...r }
    : Object.fromEntries(state.cols.split(',').map((c) => c.trim()).map((c) => [c, r[c]])));
  const run = async (single: boolean) => {
    if (tableName !== 'technician_profiles') {
      writeLog.push(`touched:${tableName}`);
      return { data: single ? null : [], error: null };
    }
    if (state.op === 'update') {
      const rows = table.rlsBlocksUpdates ? [] : matching();
      for (const r of rows) Object.assign(r, structuredClone(state.payload));
      writeLog.push(`update:${Object.keys(state.payload ?? {}).sort().join(',')}`);
      return { data: rows.map((r) => ({ id: r.id })), error: null };
    }
    const rows = matching().map(pick);
    return { data: single ? rows[0] ?? null : rows, error: null };
  };
  const api: any = {
    select(cols: string) { if (state.op !== 'update') state.cols = cols; return api; },
    update(payload: Record<string, unknown>) { state.op = 'update'; state.payload = payload; return api; },
    eq(col: string, value: unknown) { state.filters[col] = value; return api; },
    maybeSingle() { return run(true); },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return run(false).then(resolve, reject); },
  };
  return api;
}

const fakeSupabase = {
  from: (name: string) => makeQuery(name),
  rpc: async (name: string) => { writeLog.push(`rpc:${name}`); return { data: null, error: null }; },
};

for (const [name, moduleExports] of [
  ['../src/lib/supabase', { supabase: fakeSupabase }],
  ['../src/lib/documentStorage', {}],
] as const) {
  const resolved = require.resolve(name);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: moduleExports } as NodeModule;
}

/* eslint-disable @typescript-eslint/no-var-requires */
const usecase = require('../src/usecases/technicianProfile') as typeof import('../src/usecases/technicianProfile');
const { technicianRepositoryV2 } = require('../src/repositories/v2/technicianRepositoryV2') as typeof import('../src/repositories/v2/technicianRepositoryV2');
const work = require('../src/utils/technicianWork') as typeof import('../src/utils/technicianWork');
const { toggleProfileType } = require('../src/utils/profileTypes') as typeof import('../src/utils/profileTypes');
const nav = require('../src/utils/technicianNavigation') as typeof import('../src/utils/technicianNavigation');
const { buildAircraftRatingIndex } = require('../src/constants/aircraftTypeRatings') as typeof import('../src/constants/aircraftTypeRatings');
const { engineRemovalWarning } = require('../src/utils/profileEngines') as typeof import('../src/utils/profileEngines');
type TechnicianProfileStore = import('../src/usecases/technicianProfile').TechnicianProfileStore;
type WorkChanges = import('../src/usecases/technicianProfile').WorkChanges;
/* eslint-enable @typescript-eslint/no-var-requires */

const { saveTechnicianProfile, changeProfileTypes, editableProfileFromTechnician } = usecase;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`PASS — ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL — ${name}`);
    console.error(err);
  }
}

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── Fixtures ────────────────────────────────────────────────────────────────

function seedRow(): Row {
  return {
    id: 'tech',
    first_name: 'Ana',
    last_name: 'López',
    email: 'ana@example.invalid',
    phone: '+34 600 000 000',
    location_country_code: 'ES',
    location_city_name: 'Madrid',
    location_city_lat: 40.4,
    location_city_lng: -3.7,
    location_city_geoname_id: 3117735,
    availability: { immediately: true, contract_types: ['permanent'] },
    years_experience: 8,
    social_links: { linkedin: 'https://linkedin.com/in/ana', mastodon: 'https://mastodon.social/@ana' },
    verification_status: 'verified',
  };
}

function resetTable() {
  table.rows = [seedRow()];
  table.rlsBlocksUpdates = false;
  writeLog.length = 0;
}

/** Lo que tiene la fila salvo las columnas que el grupo puede tocar. */
function without(row: Row, columns: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !columns.includes(k)));
}

const a320 = { id: 'a320', displayName: 'Airbus A320 — CFM56', productType: 'Aeroplane', engineId: 'cfm56', isActive: true } as AircraftTypeRatingCatalog;
const ratings = buildAircraftRatingIndex([a320]);
const engines = new Map([['cfm56', { id: 'cfm56', engineType: 'turbofan' } as EngineCatalog]]);
const b11 = { authority: 'EASA' as const, code: 'B1.1' as const };
const habA320 = { authority: 'EASA' as const, licenseCode: 'B1.1', aircraftTypeRatingId: 'a320' };

/** Un almacén falso para My work y los tipos: cuenta y registra las escrituras. */
function fakeStore(over: Partial<Record<keyof TechnicianProfileStore, unknown>> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record = (name: string, result: unknown) => async (...args: unknown[]) => { calls.push({ name, args }); return result; };
  const store = {
    getOwnJsonColumns: record('getOwnJsonColumns', { availability: { immediately: true, contractTypes: [] }, socialLinks: null }),
    updateOwnProfile: record('updateOwnProfile', true),
    replaceProfileTypes: record('replaceProfileTypes', undefined),
    upsertLicenses: record('upsertLicenses', undefined),
    replaceHabilitations: record('replaceHabilitations', undefined),
    replaceAircraftExperience: record('replaceAircraftExperience', undefined),
    replaceEngineExperience: record('replaceEngineExperience', undefined),
    removeUnreferencedLicenses: record('removeUnreferencedLicenses', { blocked: [] }),
    describeHabilitationScopeRejection: record('describeHabilitationScopeRejection', 'described'),
    ...over,
  } as unknown as TechnicianProfileStore;
  const writes = () => calls.filter((c) => c.name !== 'getOwnJsonColumns' && c.name !== 'describeHabilitationScopeRejection');
  return { store, calls, writes };
}

function workChanges(over: Partial<WorkChanges> = {}): WorkChanges {
  return {
    types: ['mechanic'],
    licenses: [b11],
    habilitations: [habA320],
    habDirty: false,
    aircraftExperience: [],
    experienceDirty: false,
    engines: [],
    enginesDirty: false,
    ratingsById: ratings,
    engineIndex: engines,
    ...over,
  };
}

async function main() {
  // ── El caso de uso: las validaciones de hoy, antes de escribir nada ───────

  await test('Validación — tipos: al menos uno (tipos sueltos y My work), sin escribir nada', async () => {
    const { store, writes } = fakeStore();
    let r = await saveTechnicianProfile('tech', { types: { codes: [], licenseCodes: [] } }, store);
    assert.deepEqual(r, { ok: false, error: 'Select at least one profile type.' });
    r = await saveTechnicianProfile('tech', { work: workChanges({ types: [] }) }, store);
    assert.deepEqual(r, { ok: false, error: 'Select at least one profile type.' });
    assert.equal(writes().length, 0);
  });

  await test('Validación — años: obligatorios, de 0 a 70; 0 es una respuesta válida', async () => {
    const { store, writes } = fakeStore();
    let r = await saveTechnicianProfile('tech', { personal: { fullName: 'Ana López', phone: '', yearsInput: '' } }, store);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /Total years of experience is required\. Enter 0/);
    r = await saveTechnicianProfile('tech', { personal: { fullName: 'Ana López', phone: '', yearsInput: '71' } }, store);
    assert.match(!r.ok ? r.error : '', /between 0 and 70/);
    assert.equal(writes().length, 0);
    r = await saveTechnicianProfile('tech', { personal: { fullName: 'Ana López', phone: '', yearsInput: '0' } }, store);
    assert.equal(r.ok, true);
    const update = writes().find((c) => c.name === 'updateOwnProfile');
    assert.equal((update?.args[1] as { yearsExperience: number }).yearsExperience, 0, "'0' se guarda como 0, no como NULL");
  });

  await test('Validación — enlaces: cada uno vacío o válido; el mal escrito no se guarda', async () => {
    const { store, writes } = fakeStore();
    const r = await saveTechnicianProfile('tech', { socialLinks: { linkedin: 'not a link', instagram: '', website: 'javascript:alert(1)' } }, store);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /LinkedIn: enter a valid link/);
    assert.match(!r.ok ? r.error : '', /Personal website: enter a valid link/);
    assert.doesNotMatch(!r.ok ? r.error : '', /Instagram/);
    assert.equal(writes().length, 0);
  });

  await test('Validación — fechas: caducidad posterior a la emisión (no se mira en FAA ni CASA)', async () => {
    const { store, writes } = fakeStore();
    let r = await saveTechnicianProfile('tech', {
      work: workChanges({ licenses: [{ ...b11, issuedAt: '2024-05-01', expiresAt: '2024-01-01' }] }),
    }, store);
    assert.match(!r.ok ? r.error : '', /EASA B1\.1: expiry date must be after the issue date/);
    r = await saveTechnicianProfile('tech', {
      work: workChanges({ habilitations: [{ ...habA320, issuedAt: '2024-05-01', expiresAt: '2024-05-01' }] }),
    }, store);
    assert.match(!r.ok ? r.error : '', /EASA B1\.1 \+ Airbus A320 — CFM56: expiry date must be after the issue date/);
    assert.equal(writes().length, 0);
    // FAA: sin caducidad de documento, una fecha vieja no bloquea.
    r = await saveTechnicianProfile('tech', {
      work: workChanges({ types: ['mechanic'], licenses: [b11, { authority: 'FAA', code: 'A&P', issuedAt: '2024-05-01', expiresAt: '2020-01-01' }] }),
    }, store);
    assert.equal(r.ok, true);
  });

  await test('Validación — habilitaciones: una licencia quitada que aún sostiene un rating bloquea antes de escribir', async () => {
    const { store, writes } = fakeStore();
    const r = await saveTechnicianProfile('tech', { work: workChanges({ licenses: [{ authority: 'EASA', code: 'B1.2' }] }) }, store);
    assert.match(!r.ok ? r.error : '', /still linked to EASA B1\.1/);
    assert.equal(writes().length, 0);
  });

  await test('My work — el orden de hoy: tipos, licencias, ratings, aeronaves, motores y, al final, quitar licencias', async () => {
    const { store, calls } = fakeStore();
    const r = await saveTechnicianProfile('tech', {
      work: workChanges({ habDirty: true, experienceDirty: true, enginesDirty: true, types: ['mechanic', 'engine_technician'], engines: [{ engineId: 'cfm56' }] }),
    }, store);
    assert.equal(r.ok, true);
    assert.deepEqual(calls.map((c) => c.name), [
      'replaceProfileTypes', 'upsertLicenses', 'replaceHabilitations', 'replaceAircraftExperience', 'replaceEngineExperience', 'removeUnreferencedLicenses',
    ]);
    assert.deepEqual(calls[0].args, ['tech', ['mechanic', 'engine_technician'], ['B1.1']], 'los tipos se validan contra las licencias que van a QUEDAR');
  });

  await test('My work — sin tocarlas, ni ratings ni aeronaves ni motores se reescriben; ninguna columna del perfil', async () => {
    const { store, calls } = fakeStore();
    await saveTechnicianProfile('tech', { work: workChanges() }, store);
    assert.deepEqual(calls.map((c) => c.name), ['replaceProfileTypes', 'upsertLicenses', 'removeUnreferencedLicenses']);
  });

  await test('My work — licencia que no se pudo quitar: se guarda y se avisa, con el texto de hoy', async () => {
    const { store } = fakeStore({ removeUnreferencedLicenses: async () => ({ blocked: ['EASA B1.2'] }) });
    const r = await saveTechnicianProfile('tech', { work: workChanges() }, store);
    assert.deepEqual(r, {
      ok: true,
      licenseRemovalWarning: 'Saved — but could not remove EASA B1.2: the technician still has habilitations declared under it. Remove those habilitations first if the license should come off the profile.',
    });
  });

  await test('Sesión caducada — 0 filas actualizadas es un error, no un "guardado"', async () => {
    const { store } = fakeStore({ updateOwnProfile: async () => false });
    const r = await saveTechnicianProfile('tech', { personal: { fullName: 'Ana', phone: '', yearsInput: '3' } }, store);
    assert.deepEqual(r, { ok: false, error: 'Could not save your profile — your session may have expired. Sign in again and retry.' });
  });

  await test('Ubicación sin país — no escribe y lo dice', async () => {
    const { store, writes } = fakeStore();
    const r = await saveTechnicianProfile('tech', { location: { country: null, city: null } }, store);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /requires a country/);
    assert.equal(writes().length, 0);
  });

  // ── Cada pantalla pequeña guarda sólo lo suyo (repositorio real) ──────────

  await test('Personal details — sólo nombre, teléfono y años; el resto de la fila intacto', async () => {
    resetTable();
    const before = structuredClone(table.rows[0]);
    const r = await saveTechnicianProfile('tech', { personal: { fullName: 'Ana María  López', phone: '', yearsInput: '12' } });
    assert.equal(r.ok, true);
    const after = table.rows[0];
    assert.deepEqual(writeLog, ['update:first_name,last_name,phone,years_experience']);
    assert.equal(after.first_name, 'Ana');
    assert.equal(after.last_name, 'María López');
    assert.equal(after.phone, null, 'teléfono vacío -> NULL, como hoy');
    assert.equal(after.years_experience, 12);
    assert.deepEqual(without(after, ['first_name', 'last_name', 'phone', 'years_experience']), without(before, ['first_name', 'last_name', 'phone', 'years_experience']));
    assert.equal(after.email, before.email, 'el email no se vuelve a escribir');
  });

  await test('Personal details — un solo nombre se guarda como hoy (apellido = nombre)', async () => {
    resetTable();
    await saveTechnicianProfile('tech', { personal: { fullName: 'Ana', phone: '+1 555', yearsInput: '8' } });
    assert.equal(table.rows[0].first_name, 'Ana');
    assert.equal(table.rows[0].last_name, 'Ana');
    assert.equal(table.rows[0].phone, '+1 555');
  });

  await test('Location — las cinco columnas juntas y nada más; ciudad a mano sin coordenadas', async () => {
    resetTable();
    const before = structuredClone(table.rows[0]);
    const cols = ['location_country_code', 'location_city_name', 'location_city_lat', 'location_city_lng', 'location_city_geoname_id'];
    const r = await saveTechnicianProfile('tech', { location: { country: { code: 'EC', name: 'Ecuador' }, city: { kind: 'manual', name: 'Guayaquil' } } });
    assert.equal(r.ok, true);
    assert.deepEqual(writeLog, [`update:${[...cols].sort().join(',')}`]);
    const after = table.rows[0];
    assert.equal(after.location_country_code, 'EC');
    assert.equal(after.location_city_name, 'Guayaquil');
    assert.equal(after.location_city_lat, null, 'la ciudad anterior no deja sus coordenadas');
    assert.deepEqual(without(after, cols), without(before, cols));
  });

  await test('Contract types — cambia los contratos y conserva la disponibilidad de la BASE, no la de la pantalla', async () => {
    resetTable();
    // La pantalla cargó con "Open to offers"; después, en otra pantalla, se
    // marcó "Unavailable". Guardar los contratos no puede devolverlo.
    (table.rows[0].availability as { immediately: boolean }).immediately = false;
    const before = structuredClone(table.rows[0]);
    const r = await saveTechnicianProfile('tech', { contractTypes: ['short_term', 'long_term'] });
    assert.equal(r.ok, true);
    assert.deepEqual(writeLog, ['update:availability']);
    assert.deepEqual(table.rows[0].availability, { immediately: false, contract_types: ['short_term', 'long_term'] });
    assert.deepEqual(without(table.rows[0], ['availability']), without(before, ['availability']));
  });

  await test('Availability (You, al tocar) — cambia sólo `immediately` y conserva los contratos de la base', async () => {
    resetTable();
    (table.rows[0].availability as { contract_types: string[] }).contract_types = ['long_term'];
    const before = structuredClone(table.rows[0]);
    const r = await saveTechnicianProfile('tech', { availability: 'unavailable' });
    assert.equal(r.ok, true);
    assert.deepEqual(writeLog, ['update:availability']);
    assert.deepEqual(table.rows[0].availability, { immediately: false, contract_types: ['long_term'] });
    assert.deepEqual(without(table.rows[0], ['availability']), without(before, ['availability']));
  });

  await test('Professional links — normaliza, conserva las claves sin campo y no toca nada más', async () => {
    resetTable();
    const before = structuredClone(table.rows[0]);
    const r = await saveTechnicianProfile('tech', { socialLinks: { linkedin: '', instagram: 'Instagram.com/ana', website: '' } });
    assert.equal(r.ok, true);
    assert.deepEqual(writeLog, ['update:social_links']);
    assert.deepEqual(table.rows[0].social_links, { mastodon: 'https://mastodon.social/@ana', instagram: 'https://instagram.com/ana' });
    assert.deepEqual(without(table.rows[0], ['social_links']), without(before, ['social_links']));
    // Todo vacío y sin claves desconocidas: NULL, no {}.
    table.rows[0].social_links = { linkedin: 'https://linkedin.com/in/ana' };
    await saveTechnicianProfile('tech', { socialLinks: { linkedin: '', instagram: '', website: '' } });
    assert.equal(table.rows[0].social_links, null);
  });

  await test('Pantallas pequeñas — ninguna toca licencias, ratings, tipos, aeronaves ni motores', async () => {
    resetTable();
    await saveTechnicianProfile('tech', { personal: { fullName: 'Ana López', phone: '', yearsInput: '8' } });
    await saveTechnicianProfile('tech', { location: { country: { code: 'ES', name: 'Spain' }, city: null } });
    await saveTechnicianProfile('tech', { contractTypes: [] });
    await saveTechnicianProfile('tech', { socialLinks: { linkedin: '', instagram: '', website: '' } });
    await saveTechnicianProfile('tech', { availability: 'open_to_offers' });
    assert.ok(writeLog.every((entry) => entry.startsWith('update:')), writeLog.join(' | '));
  });

  await test('Repositorio — RLS que no deja pasar la fila: error de sesión, no "guardado"', async () => {
    resetTable();
    table.rlsBlocksUpdates = true;
    const r = await saveTechnicianProfile('tech', { availability: 'unavailable' });
    assert.deepEqual(r, { ok: false, error: 'Could not save your profile — your session may have expired. Sign in again and retry.' });
    assert.equal(await technicianRepositoryV2.updateOwnProfile('tech', {}), true, 'un patch vacío no escribe');
  });

  // ── Tipos al tocar y el aviso de Engine Technician ─────────────────────────

  await test('Engine Technician con motores — avisa antes; cancelar no escribe nada', async () => {
    const { store, writes } = fakeStore();
    const asked: unknown[] = [];
    let saving = 0;
    const change = await changeProfileTypes(
      'tech',
      { current: ['mechanic', 'engine_technician'], next: ['mechanic'], licenseCodes: ['B1.1'], engineCount: 2 },
      async (options) => { asked.push(options); return false; },
      { store, onSaving: () => { saving++; } },
    );
    assert.deepEqual(change, { status: 'cancelled' });
    assert.deepEqual(asked, [{ ...engineRemovalWarning(2), destructive: true }]);
    assert.match(engineRemovalWarning(2).message, /2 declared engines will be deleted\.$/);
    assert.equal(engineRemovalWarning(2).title, 'Remove Engine Technician?');
    assert.equal(writes().length, 0);
    assert.equal(saving, 0, 'el chip no se marca "guardando" mientras pregunta');
  });

  await test('Engine Technician con motores — confirmar guarda los tipos y se lleva los motores', async () => {
    const { store, calls } = fakeStore();
    let saving = 0;
    const change = await changeProfileTypes(
      'tech',
      { current: ['mechanic', 'engine_technician'], next: ['mechanic'], licenseCodes: ['B1.1'], engineCount: 1 },
      async () => true,
      { store, onSaving: () => { saving++; } },
    );
    assert.deepEqual(change, { status: 'saved', enginesRemoved: true });
    assert.deepEqual(calls.map((c) => [c.name, ...c.args]), [['replaceProfileTypes', 'tech', ['mechanic'], ['B1.1']]]);
    assert.equal(saving, 1);
  });

  await test('Tipos — sin motores, o quitando otro tipo, no se pregunta y se guarda al momento', async () => {
    for (const input of [
      { current: ['mechanic', 'engine_technician'], next: ['mechanic'], licenseCodes: [], engineCount: 0 },
      { current: ['painter', 'engine_technician'], next: ['engine_technician'], licenseCodes: [], engineCount: 3 },
      { current: ['painter'], next: ['painter', 'engine_technician'], licenseCodes: [], engineCount: 0 },
    ]) {
      const { store, calls } = fakeStore();
      let asked = 0;
      const change = await changeProfileTypes('tech', input, async () => { asked++; return true; }, { store });
      assert.deepEqual(change, { status: 'saved', enginesRemoved: false });
      assert.equal(asked, 0);
      assert.deepEqual(calls.map((c) => c.name), ['replaceProfileTypes']);
    }
  });

  await test('Tipos — un error de la base se enseña tal cual', async () => {
    const { store } = fakeStore({ replaceProfileTypes: async () => { throw new Error('Could not save your profile types — your session may have expired. Sign in again and retry.'); } });
    const change = await changeProfileTypes('tech', { current: ['painter'], next: ['painter', 'composite'], licenseCodes: [], engineCount: 0 }, async () => true, { store });
    assert.deepEqual(change, { status: 'error', error: 'Could not save your profile types — your session may have expired. Sign in again and retry.' });
  });

  await test('Tipos — la regla de siempre: el bloqueado por licencia y el último no se quitan', () => {
    const label = (c: string) => ({ mechanic: 'Mechanic' } as Record<string, string>)[c] ?? c;
    assert.deepEqual(toggleProfileType(['mechanic'], 'painter', [], label), { kind: 'change', next: ['mechanic', 'painter'] });
    assert.deepEqual(toggleProfileType(['mechanic', 'painter'], 'painter', ['mechanic'], label), { kind: 'change', next: ['mechanic'] });
    const locked = toggleProfileType(['mechanic', 'painter'], 'mechanic', ['mechanic'], label);
    assert.equal(locked.kind, 'notice');
    assert.equal(locked.kind === 'notice' && locked.title, 'Mechanic comes from your licences');
    const last = toggleProfileType(['painter'], 'painter', [], label);
    assert.equal(last.kind === 'notice' && last.title, 'Keep at least one profile type');
    // El selector del alta usa la misma función.
    assert.match(read('src/components/TechnicianTypeSelector.tsx'), /toggleProfileType\(/);
  });

  // ── Reglas puras de My work y You ──────────────────────────────────────────

  await test('Borrador — añadir una licencia marca su tipo; quitarla lo desmarca; los manuales se quedan', () => {
    const base: import('../src/utils/technicianWork').WorkDraft = {
      types: ['painter'], licenses: [], habilitations: [], aircraftExperience: [], engines: [],
      habDirty: false, experienceDirty: false, enginesDirty: false,
    };
    const added = work.toggleDraftLicense(base, 'EASA', 'B1.1');
    assert.deepEqual(added.types, ['painter', 'mechanic']);
    assert.deepEqual(added.licenses, [{ authority: 'EASA', code: 'B1.1' }]);
    const removed = work.toggleDraftLicense(added, 'EASA', 'B1.1');
    assert.deepEqual(removed.types, ['painter']);
    assert.equal(work.licencesChanged([], added.licenses), true);
    assert.equal(work.licencesChanged(added.licenses, [{ ...b11, issuedAt: '2020-01-01' }]), true, 'una fecha nueva también es un cambio');
    assert.equal(work.licencesChanged(added.licenses, [{ ...b11 }]), false);
  });

  await test('Borrador — sin FAA A ni A&P ninguna aeronave queda firmada (094)', () => {
    const draft: import('../src/utils/technicianWork').WorkDraft = {
      types: ['mechanic'], licenses: [{ authority: 'FAA', code: 'A&P' }], habilitations: [],
      aircraftExperience: [{ aircraftTypeRatingId: 'a320', signed: true }], engines: [],
      habDirty: false, experienceDirty: false, enginesDirty: false,
    };
    const next = work.toggleDraftLicense(draft, 'FAA', 'A&P');
    assert.deepEqual(next.aircraftExperience, [{ aircraftTypeRatingId: 'a320', signed: false }]);
    assert.equal(next.experienceDirty, true);
  });

  await test('Candados — qué licencia pone cada tipo (una P sola bloquea Mechanic; con la A, no)', () => {
    assert.deepEqual(work.typeLockLines([b11, { authority: 'EASA', code: 'B1.3' }]), ['Mechanic comes from your EASA B1.1 and EASA B1.3.']);
    assert.deepEqual(work.typeLockLines([{ authority: 'FAA', code: 'A' }, { authority: 'FAA', code: 'P' }]), []);
    assert.deepEqual(work.typeLockLines([{ authority: 'FAA', code: 'A&P' }]), []);
    assert.deepEqual(work.typeLockLines([{ authority: 'FAA', code: 'P' }]), ['Mechanic comes from your FAA P.']);
    assert.deepEqual(work.typeLockLines([b11, { authority: 'FAA', code: 'P' }, { authority: 'FAA', code: 'A' }]), ['Mechanic comes from your EASA B1.1.']);
    assert.deepEqual(work.typeLockLines([b11, { authority: 'UK_CAA', code: 'B2' }]), [
      'Mechanic comes from your EASA B1.1.',
      'Avionics Technician comes from your UK CAA B2.',
    ]);
    assert.deepEqual(work.typeLockLines([{ authority: 'EASA', code: 'C' }]), [], 'la C no implica oficio');
  });

  await test('Tarjetas — ratings por credencial; los de una licencia quitada no se pierden', () => {
    const ukB11 = { authority: 'UK_CAA' as const, licenseCode: 'B1.1', aircraftTypeRatingId: 'a320' };
    assert.deepEqual(work.habilitationsOfLicence([habA320, ukB11], b11), [habA320]);
    assert.deepEqual(work.habilitationsWithoutLicence([habA320, ukB11], [b11]), [ukB11]);
    assert.equal(work.licenceCategoryText('B1.1'), 'Mechanical: Turbine-powered Aeroplanes');
    assert.equal(work.licenceCategoryText('A&P'), 'Airframe and Powerplant');
    assert.equal(work.licenceDatesText({ authority: 'EASA' }), 'no dates added');
    assert.equal(work.licenceDatesText({ authority: 'EASA', issuedAt: '2020-03-12', expiresAt: '2030-03-12' }), 'Issued 12 Mar 2020 · Expires 12 Mar 2030');
    assert.equal(work.licenceDatesText({ authority: 'FAA', issuedAt: '2020-03-12', expiresAt: '2030-03-12' }), 'Issued 12 Mar 2020', 'la FAA no caduca');
  });

  await test('You — las líneas de cada fila', () => {
    assert.equal(
      work.workSummary({
        technicianTypes: ['mechanic'],
        licenses: [b11, { authority: 'EASA', code: 'B1.3' }, { authority: 'FAA', code: 'A&P' }],
        habilitations: [habA320, habA320],
        aircraftExperience: [{ aircraftTypeRatingId: 'a320' }],
        engines: [],
      }),
      'Mechanic · 3 licences · 2 type ratings · 1 aircraft',
    );
    assert.equal(work.workSummary({ technicianTypes: [], licenses: [], habilitations: [], aircraftExperience: [], engines: [] }), 'Add your licences and experience');
    assert.equal(work.documentsSummary([]), 'No documents yet');
    assert.equal(work.documentsSummary([{ status: 'verified' }, { status: 'pending' }, { status: 'rejected' }]), '1 verified · 1 under review · 1 need attention');
    assert.equal(work.contractTypesSummary(['short_term', 'permanent']), 'Permanent · Short-term');
    assert.equal(work.contractTypesSummary([]), 'Any contract type', 'ninguno = abierto a cualquiera, como lo puntúa el matching');
    assert.equal(work.youHeaderLine('T3FD8E0D5F', '8'), 'ID T3FD8E0D5F · 8 years of experience');
    assert.equal(work.youHeaderLine('T3FD8E0D5F', '1'), 'ID T3FD8E0D5F · 1 year of experience');
    assert.equal(work.youHeaderLine('T3FD8E0D5F', ''), 'ID T3FD8E0D5F');
    assert.deepEqual(
      work.withCountryName({ country: { code: 'EC', name: 'EC' }, city: null }, [{ code: 'EC', name: 'Ecuador' }]),
      { country: { code: 'EC', name: 'Ecuador' }, city: null },
    );
  });

  // ── La carga del perfil ────────────────────────────────────────────────────

  await test('Carga — repara los tipos que bloquea una licencia, ordena y distingue "sin años" de 0', () => {
    const tech = {
      id: 'tech', userId: 'u', anonymousCode: 'T1', firstName: 'Ana', lastName: 'López', email: 'a@x.invalid',
      birthDate: '', technicianTypes: ['avionic'], locationCountryCode: 'ES', locationCityName: undefined,
      availability: { immediately: false, contractTypes: ['permanent'] }, yearsExperience: 0,
      verificationStatus: 'pending', socialLinks: { website: 'https://ana.dev', other: 'x' },
      createdAt: '', updatedAt: '',
      licenses: [
        { id: 'l2', technicianId: 'tech', authority: 'FAA', licenseCode: 'A', createdAt: '' },
        { id: 'l1', technicianId: 'tech', authority: 'EASA', licenseCode: 'B1.1', issuedAt: '2020-01-01', createdAt: '' },
      ],
      habilitations: [{ id: 'h1', technicianId: 'tech', technicianLicenseId: 'l1', licenseCode: 'B1.1', aircraftTypeRatingId: 'a320', isCurrent: true, createdAt: '' }],
      aircraftExperience: [
        { id: 'e2', technicianId: 'tech', aircraftTypeRatingId: 'b737', createdAt: '2026-02-01' },
        { id: 'e1', technicianId: 'tech', aircraftTypeRatingId: 'a320', years: 3, signed: true, createdAt: '2026-01-01' },
      ],
      engines: [],
    } as unknown as TechnicianWithRelations;
    const profile = editableProfileFromTechnician(tech);
    assert.deepEqual(profile.technicianTypes, ['avionic', 'mechanic'], 'la B1.1 bloquea Mechanic; la FAA A no lo añadiría');
    assert.deepEqual(profile.licenses.map((l) => `${l.authority} ${l.code}`), ['EASA B1.1', 'FAA A']);
    assert.deepEqual(profile.habilitations, [{ id: 'h1', authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'a320', experienceYears: undefined, issuedAt: undefined, expiresAt: undefined, isCurrent: true }]);
    assert.deepEqual(profile.aircraftExperience.map((e) => e.id), ['e1', 'e2']);
    assert.equal(profile.yearsInput, '0');
    assert.equal(profile.availability.status, 'unavailable');
    assert.deepEqual(profile.socialInputs, { linkedin: '', instagram: '', website: 'https://ana.dev' });
    assert.equal(profile.fullName, 'Ana López');
    assert.equal(editableProfileFromTechnician({ ...tech, yearsExperience: undefined }).yearsInput, '');
    assert.throws(
      () => editableProfileFromTechnician({ ...tech, licenses: [] }),
      /points at a licence that could not be loaded/,
    );
  });

  // ── Las pantallas ──────────────────────────────────────────────────────────

  await test('Rutas — las pantallas nuevas cuelgan de You ("+ Add" abre el "+" desde la 6B)', () => {
    assert.equal(nav.TECHNICIAN_ADD_ROUTE, '/technician/add');
    for (const route of Object.values(nav.TECHNICIAN_PROFILE_ROUTES)) {
      assert.equal(nav.technicianTabForPath(route), null, `${route} no es raíz de pestaña: sin barra inferior`);
      assert.equal(nav.technicianTopActionForPath(route), 'you', `${route} marca You en escritorio`);
      // Viven en el grupo (you) desde la fase 8; el grupo no cambia la URL.
      const file = path.join(ROOT, 'app', `${route.replace(/^\/technician\//, 'technician/(you)/')}.tsx`);
      assert.ok(fs.existsSync(file), `falta ${file}`);
    }
  });

  await test('Cada pantalla guarda sólo su grupo, por el caso de uso, y ninguna llama a Supabase', () => {
    const groups: Record<string, RegExp> = {
      'app/technician/(you)/profile/personal.tsx': /saveTechnicianProfile\(profile\.id, \{ personal: \{ fullName, phone, yearsInput \} \}\)/,
      'app/technician/(you)/profile/location.tsx': /saveTechnicianProfile\(profile\.id, \{ location \}\)/,
      'app/technician/(you)/profile/contracts.tsx': /saveTechnicianProfile\(profile\.id, \{ contractTypes: selected \}\)/,
      'app/technician/(you)/profile/links.tsx': /saveTechnicianProfile\(profile\.id, \{ socialLinks: inputs \}\)/,
      // La disponibilidad: un hook que comparten You en móvil y la cabecera de escritorio (fase 8).
      'src/state/useAvailabilityToggle.ts': /saveTechnicianProfile\(profile\.id, \{ availability: next \}\)/,
      'app/technician/(you)/profile/work.tsx': /saveTechnicianProfile\(saved\.id, \{\s*work: \{/,
    };
    for (const [file, pattern] of Object.entries(groups)) {
      const src = read(file);
      assert.match(src, pattern, file);
      assert.equal((src.match(/saveTechnicianProfile\(/g) ?? []).length, 1, `${file}: un solo guardado`);
      assert.doesNotMatch(src, /lib\/supabase|supabase\./, `${file} no llama a Supabase`);
      if (file.startsWith('app/')) assert.match(src, /useGoBack\(\)|refreshOnFocus/, `${file}: atrás con useGoBack (You es raíz)`);
    }
    // You (móvil) y la cabecera de escritorio usan el hook; You sigue recargando al volver el foco.
    const you = read('app/technician/(tabs)/profile.tsx');
    assert.match(you, /useAvailabilityToggle\(profile, reload\)/);
    assert.match(you, /refreshOnFocus: true/);
    assert.doesNotMatch(you, /saveTechnicianProfile\(/, 'You ya no guarda por su cuenta');
    assert.match(read('src/components/technician/ProfileParts.tsx'), /useAvailabilityToggle\(profile, reload\)/);
    // Tipos al tocar, con el aviso de motores, desde My work (el hook comparte
    // changeProfileTypes con el "+", fase 6B).
    assert.match(read('app/technician/(you)/profile/work.tsx'), /useProfileTypesEditor\(/);
    assert.match(read('src/state/useProfileTypesEditor.ts'), /changeProfileTypes\(/);
  });

  await test('Ningún campo de hoy se pierde: cada uno acaba en una pantalla', () => {
    const personal = read('app/technician/(you)/profile/personal.tsx');
    for (const label of ['"Full name"', '"Email"', '"Phone"', '"Total years of experience"']) assert.ok(personal.includes(`label=${label}`), label);
    assert.match(read('app/technician/(you)/profile/location.tsx'), /<CountryCityPicker/);
    assert.match(read('app/technician/(you)/profile/contracts.tsx'), /CONTRACT_TYPES\.map/);
    assert.match(read('app/technician/(you)/profile/links.tsx'), /SOCIAL_FIELDS\.map/);
    const you = read('app/technician/(tabs)/profile.tsx');
    assert.match(you, /<AvailabilitySwitch/);
    assert.match(you, /VerificationPill status=\{profile\.verificationStatus\}/);
    assert.match(you, /youHeaderLine\(profile\.anonymousCode/);
    // My work edita y quita; añadir licencias, ratings, aeronaves y motores
    // es de los asistentes del "+" (fase 6B).
    const myWork = read('app/technician/(you)/profile/work.tsx');
    for (const piece of ['<WhatYouDo', '<DateField', '<HabilitationItem', '<AircraftExperienceEditor', '<EngineExperienceEditor', '<CatalogRequestPanel', 'whatYouDoFacts(']) {
      assert.ok(myWork.includes(piece), piece);
    }
    const licence = read('app/technician/add/licence.tsx');
    for (const piece of ['AUTHORITIES.map', 'licenceChoices(', 'licenceDateBlocks(', '<DateField']) assert.ok(licence.includes(piece), piece);
    assert.match(read('app/technician/add/type-rating.tsx'), /typeRatingRows\(/);
    assert.match(read('app/technician/add/aircraft.tsx'), /aircraftExperienceRows\(/);
    assert.match(read('app/technician/add/engine.tsx'), /engineRows\(/);
    // Motores: bloqueado sin Engine Technician, con lo que falta.
    assert.match(myWork, /showsEngineExperience\(draft\.types\) \?[\s\S]*<EngineExperienceEditor[\s\S]*<LockedRow tile="ENG" title="Only for Engine Technicians"/);
  });

  await test('You — un menú: filas en el orden de T-You y Account al final', () => {
    const you = read('app/technician/(tabs)/profile.tsx');
    const order = ["title: 'My work'", "title: 'Documents'", "title: 'Location'", "title: 'Contract types'", "title: 'Personal details'", "title: 'Professional links'"]
      .map((t) => you.indexOf(t));
    assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), 'filas en orden');
    assert.ok(you.indexOf('<TechnicianAccountSection />') > you.indexOf('<HubRow'), 'Account después de las filas');
    assert.doesNotMatch(you, /'Save Changes'/, 'ya no hay guardado global');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
