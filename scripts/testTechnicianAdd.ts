// Standalone tests — sin Supabase y sin navegador. Cubren el rediseño del
// técnico, fase 6B (docs/UI_REDESIGN.md, T2, T5, T6 y respuestas 26 y 27): el
// "+" y sus asistentes.
//
//   - qué opciones del "+" salen en gris y por qué;
//   - "✓ Added": lo que ya está en el perfil se marca, lleva a My work y nunca
//     se añade dos veces (ni en las listas ni en el caso de uso);
//   - los tipos de perfil que añade una licencia, y lo que dice la pantalla
//     final (bloqueado por la licencia, o el texto de la FAA A o A&P);
//   - "Expires" sólo donde la licencia caduca (no FAA ni CASA);
//   - que cada asistente guarda sólo lo suyo, con las validaciones de hoy;
//   - la huella con la que My work detecta un borrador que se quedó viejo.
//
// Run via: npm run test:technician-add
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AircraftTypeRatingCatalog, EngineCatalog } from '../src/types/catalog';

// El caso de uso importa el repositorio, que importa supabase: un falso que no
// debe recibir ninguna llamada (los guardados van a un almacén falso).
const supabaseCalls: string[] = [];
const fakeSupabase = {
  from: (name: string) => { supabaseCalls.push(name); throw new Error(`unexpected supabase.from(${name})`); },
  rpc: async (name: string) => { supabaseCalls.push(name); throw new Error(`unexpected supabase.rpc(${name})`); },
};
for (const [name, moduleExports] of [
  ['../src/lib/supabase', { supabase: fakeSupabase }],
  ['../src/lib/documentStorage', {}],
] as const) {
  const resolved = require.resolve(name);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: moduleExports } as NodeModule;
}

/* eslint-disable @typescript-eslint/no-var-requires */
const add = require('../src/utils/technicianAdd') as typeof import('../src/utils/technicianAdd');
const work = require('../src/utils/technicianWork') as typeof import('../src/utils/technicianWork');
const nav = require('../src/utils/technicianNavigation') as typeof import('../src/utils/technicianNavigation');
const { saveTechnicianProfile } = require('../src/usecases/technicianProfile') as typeof import('../src/usecases/technicianProfile');
const { buildAircraftRatingIndex } = require('../src/constants/aircraftTypeRatings') as typeof import('../src/constants/aircraftTypeRatings');
type TechnicianProfileStore = import('../src/usecases/technicianProfile').TechnicianProfileStore;
type EditableTechnicianProfile = import('../src/types/technicianProfileEdit').EditableTechnicianProfile;
type HeldLicense = import('../src/utils/profileLicenses').HeldLicense;
type HabilitationRow = import('../src/types/technicianProfileEdit').HabilitationRow;
/* eslint-enable @typescript-eslint/no-var-requires */

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

const rating = (over: Partial<AircraftTypeRatingCatalog> & Pick<AircraftTypeRatingCatalog, 'id' | 'displayName'>): AircraftTypeRatingCatalog => ({
  manufacturer: 'Airbus',
  aircraftFamily: over.displayName,
  easaEndorsement: `EASA ${over.id}`,
  commercialAliases: [],
  aircraftCategory: 'commercial_airplane',
  productType: 'Aeroplane',
  priority: 1,
  isActive: true,
  ...over,
});
const a320 = rating({ id: 'a320', displayName: 'Airbus A320 — CFM56', engineId: 'cfm56' });
const b737 = rating({ id: 'b737', displayName: 'Boeing 737NG — CFM56-7B', manufacturer: 'Boeing', engineId: 'cfm56' });
const r44 = rating({ id: 'r44', displayName: 'Robinson R44 — Lycoming', manufacturer: 'Robinson', productType: 'Helicopter', aircraftCategory: 'helicopter', engineId: 'lycoming' });
const RATINGS = [a320, b737, r44];
const ratingsById = buildAircraftRatingIndex(RATINGS);
const engines = new Map<string, EngineCatalog>([
  ['cfm56', { id: 'cfm56', manufacturer: 'CFM', family: 'CFM56', engineType: 'turbofan', displayName: 'CFM56', isActive: true, isGeneric: false }],
  ['lycoming', { id: 'lycoming', manufacturer: 'Lycoming', family: 'O-360', engineType: 'piston', displayName: 'Lycoming O-360', isActive: true, isGeneric: false }],
]);
const ENGINE_LIST = [...engines.values()];

const easaB11: HeldLicense = { authority: 'EASA', code: 'B1.1' };
const easaB2: HeldLicense = { authority: 'EASA', code: 'B2' };
const faaAP: HeldLicense = { authority: 'FAA', code: 'A&P' };

function profile(over: Partial<EditableTechnicianProfile> = {}): EditableTechnicianProfile {
  return {
    id: 'tech',
    anonymousCode: 'T1',
    fullName: 'Ana López',
    email: 'ana@example.invalid',
    phone: '',
    verificationStatus: 'verified',
    location: { country: { code: 'ES', name: 'Spain' }, city: null },
    availability: { status: 'open_to_offers', contractTypes: [] },
    yearsInput: '8',
    socialInputs: { linkedin: '', instagram: '', website: '' },
    technicianTypes: ['mechanic'],
    licenses: [easaB11],
    habilitations: [{ id: 'h1', authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'a320', isCurrent: true }],
    aircraftExperience: [{ id: 'e1', aircraftTypeRatingId: 'b737', years: 3 }],
    engines: [],
    ...over,
  };
}

/** Un almacén falso: registra cada llamada; ninguna lanza salvo que se pida. */
function fakeStore(over: Partial<Record<keyof TechnicianProfileStore, unknown>> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record = (name: string, result: unknown) => async (...args: unknown[]) => { calls.push({ name, args }); return result; };
  const store = {
    getOwnJsonColumns: record('getOwnJsonColumns', null),
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
  return { store, calls };
}

async function main() {
  // ── El "+": qué sale en gris y por qué ────────────────────────────────────

  await test('"+" — sin licencias ni Engine Technician: Type rating y Engine experience en gris, con lo que falta', () => {
    const options = add.addMenuOptions({ licenses: [], technicianTypes: ['painter'] });
    assert.deepEqual(options.map((o) => o.key), ['licence', 'typeRating', 'aircraft', 'engine', 'document'], 'el orden de T-Add');
    const reason = Object.fromEntries(options.map((o) => [o.key, o.disabledReason]));
    assert.deepEqual(reason, {
      licence: null,
      typeRating: 'Add a licence first',
      aircraft: null,
      engine: 'Tick Engine Technician above',
      document: null,
    });
  });

  await test('"+" — con licencias que no admiten ratings individuales, Type rating dice que hace falta una B1, B2 o C', () => {
    for (const licenses of [[faaAP], [{ authority: 'EASA', code: 'A1' } as HeldLicense], [{ authority: 'EASA', code: 'B2L' } as HeldLicense]]) {
      const option = add.addMenuOptions({ licenses, technicianTypes: ['mechanic'] }).find((o) => o.key === 'typeRating');
      assert.equal(option?.disabledReason, 'Needs a B1, B2 or C licence', JSON.stringify(licenses));
    }
  });

  await test('"+" — con una B1/B2/C y Engine Technician, todo disponible; Document abre la subida normal', () => {
    for (const licenses of [[easaB11], [easaB2], [{ authority: 'UK_CAA', code: 'C' } as HeldLicense]]) {
      const options = add.addMenuOptions({ licenses, technicianTypes: ['mechanic', 'engine_technician'] });
      assert.ok(options.every((o) => o.disabledReason === null), JSON.stringify(licenses));
    }
    const doc = add.addMenuOptions({ licenses: [], technicianTypes: ['painter'] }).find((o) => o.key === 'document');
    assert.equal(doc?.href, '/technician/documents?upload=1');
    assert.equal(nav.technicianDocumentsUploadHref('license'), '/technician/documents?upload=license');
  });

  await test('"+" — la pantalla pinta las opciones de addMenuOptions, la gris con su motivo y sin responder', () => {
    const screen = read('app/technician/add/index.tsx');
    assert.match(screen, /addMenuOptions\(\{ licenses: profile\.licenses, technicianTypes: types \}\)/);
    assert.match(screen, /disabledReason=\{option\.disabledReason\}/);
    const parts = read('src/components/technician/WizardParts.tsx');
    const row = parts.slice(parts.indexOf('export function AddMenuRow'), parts.indexOf('// ── Pantalla final'));
    assert.match(row, /if \(disabledReason\) \{\s*return \(\s*<View/, 'en gris es un View: no responde');
    // "What you do" arriba, con la misma regla y el mismo aviso que My work.
    assert.match(screen, /useProfileTypesEditor\(/);
    assert.match(screen, /<WhatYouDo/);
  });

  await test('"+ Add" — las barras abren el "+"; My work no lleva "+ Add" en la cabecera y sus botones abren el asistente', () => {
    assert.equal(nav.TECHNICIAN_ADD_ROUTE, '/technician/add');
    for (const route of Object.values(nav.TECHNICIAN_ADD_ROUTES)) {
      assert.equal(nav.technicianTabForPath(route), null, `${route}: sin barra inferior`);
      const rel = route === nav.TECHNICIAN_ADD_ROUTES.menu ? 'app/technician/add/index.tsx' : `app${route}.tsx`;
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `falta ${rel}`);
    }
    const myWork = read('app/technician/(you)/profile/work.tsx');
    const bars = read('src/components/technician/TechnicianNavBars.tsx');
    assert.equal(bars.match(/router\.navigate\(TECHNICIAN_ADD_ROUTE as never\)/g)?.length, 2, 'barra inferior y barra superior');
    assert.doesNotMatch(myWork, /label="Add"|TECHNICIAN_ADD_ROUTE\b|\bright=\{/, 'la cabecera de My work no lleva "+ Add"');
    assert.match(myWork, /openAdd\(technicianTypeRatingHref\(license\)\)/);
    assert.match(myWork, /openAdd\(TECHNICIAN_ADD_ROUTES\.licence\)/);
    assert.match(myWork, /openAdd\(TECHNICIAN_ADD_ROUTES\.aircraft\)/);
    assert.match(myWork, /openAdd\(TECHNICIAN_ADD_ROUTES\.engine\)/);
    // Los editores provisionales de añadir ya no existen.
    for (const gone of ['HabilitationAddForm', 'AircraftTypeRatingPicker', 'EnginePicker', 'Issuing authority']) {
      assert.doesNotMatch(myWork + read('src/components/technician/HabilitationsEditor.tsx') + read('src/components/technician/AircraftExperienceEditor.tsx') + read('src/components/technician/EngineExperienceEditor.tsx'), new RegExp(gone), gone);
    }
    assert.equal(nav.technicianTypeRatingHref(easaB11), '/technician/add/type-rating?licence=EASA%3AB1.1');
  });

  // ── "✓ Added": se marca y no se duplica ───────────────────────────────────

  await test('"✓ Added" — licencias: la que ya tiene se marca y no se puede elegir', () => {
    const choices = add.licenceChoices('EASA', [easaB11], []);
    assert.equal(choices.find((c) => c.code === 'B1.1')?.added, true);
    assert.equal(choices.find((c) => c.code === 'B2')?.added, false);
    assert.equal(choices.length, 13, 'las 13 categorías Part-66 de EASA (authority_licenses)');
    assert.deepEqual(add.licenceChoices('FAA', [], []).map((c) => c.code), ['A', 'P', 'A&P']);
    assert.equal(add.licenceChoices('CASA', [], []).some((c) => c.code === 'B2L'), false, 'CASA no emite B2L');
    // La misma categoría de OTRA autoridad no está añadida.
    assert.equal(add.licenceChoices('UK_CAA', [easaB11], []).find((c) => c.code === 'B1.1')?.added, false);
    assert.deepEqual(add.togglePickedLicence([], [easaB11], 'EASA', 'B1.1'), [], 'tocar una añadida no la elige');
    const picked = add.togglePickedLicence([], [easaB11], 'EASA', 'B2');
    assert.deepEqual(picked, [easaB2]);
    assert.deepEqual(add.togglePickedLicence(picked, [easaB11], 'EASA', 'B2'), [], 'se desmarca');
  });

  await test('"✓ Added" — type ratings: por credencial; la misma aeronave en otra licencia sí se puede', () => {
    const habs = [{ authority: 'EASA' as const, licenseCode: 'B1.1', aircraftTypeRatingId: 'a320' }];
    const rows = add.typeRatingRows(RATINGS, '', easaB11, habs, engines);
    assert.deepEqual(rows.map((r) => [r.item.id, r.added]), [['a320', true], ['b737', false]], 'B1.1 no cubre el R44 (pistón, helicóptero)');
    const uk = add.typeRatingRows(RATINGS, '', { authority: 'UK_CAA', code: 'B1.1' }, habs, engines);
    assert.equal(uk.find((r) => r.item.id === 'a320')?.added, false);
    assert.deepEqual(add.typeRatingRows(RATINGS, '', { authority: 'EASA', code: 'B1.4' }, habs, engines).map((r) => r.item.id), ['r44']);
    assert.deepEqual(add.typeRatingRows(RATINGS, 'boeing', easaB11, habs, engines).map((r) => r.item.id), ['b737'], 'la búsqueda de siempre');
  });

  await test('"✓ Added" — aeronaves: la de la experiencia y la que ya tiene type rating, cada una con su motivo', () => {
    const rows = add.aircraftExperienceRows(RATINGS, '', profile());
    const byId = Object.fromEntries(rows.map((r) => [r.item.id, r]));
    assert.equal(byId.b737.added, true);
    assert.equal(byId.b737.addedNote, 'In your aircraft experience');
    assert.equal(byId.a320.added, true);
    assert.equal(byId.a320.addedNote, 'Type rating on your EASA B1.1');
    assert.equal(byId.r44.added, false, 'el catálogo entero: también helicópteros');
  });

  await test('"✓ Added" — motores: los declarados', () => {
    const rows = add.engineRows(ENGINE_LIST, '', [{ engineId: 'cfm56' }]);
    assert.deepEqual(rows.map((r) => [r.item.id, r.added]), [['cfm56', true], ['lycoming', false]]);
  });

  await test('"✓ Added" — las filas añadidas llevan a My work y no se eligen', () => {
    const parts = read('src/components/technician/WizardParts.tsx');
    const rowItem = parts.slice(parts.indexOf('export function CatalogRowItem'), parts.indexOf('export function CategoryTile'));
    assert.match(rowItem, /if \(added\) \{\s*return \(\s*<Pressable\s+onPress=\{onOpenAdded\}/);
    const tile = parts.slice(parts.indexOf('export function CategoryTile'), parts.indexOf('export function CategoryGrid'));
    assert.match(tile, /if \(added\) \{\s*return \(\s*<Pressable\s+onPress=\{onOpenAdded\}/);
    for (const file of ['licence', 'type-rating', 'aircraft', 'engine']) {
      assert.match(read(`app/technician/add/${file}.tsx`), /dismissTo\(TECHNICIAN_PROFILE_ROUTES\.work/, file);
    }
  });

  await test('"✓ Added" — y el caso de uso lo rechaza aunque llegue, sin escribir nada', async () => {
    const { store, calls } = fakeStore();
    const p = profile({ engines: [{ engineId: 'cfm56' }], technicianTypes: ['mechanic', 'engine_technician'] });
    const cases: [string, Parameters<typeof saveTechnicianProfile>[1], RegExp][] = [
      ['licencia', { newLicences: { licenses: [easaB11], profile: p } }, /EASA B1\.1 is already on your profile/],
      ['type rating', { newHabilitation: { habilitation: { authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'a320' }, profile: p, ratingsById, engineIndex: engines } }, /Airbus A320 — CFM56 is already on your EASA B1\.1/],
      ['aeronave', { newAircraftExperience: { row: { aircraftTypeRatingId: 'b737' }, profile: p, ratingsById } }, /Boeing 737NG — CFM56-7B is already in your aircraft experience/],
      ['aeronave con type rating', { newAircraftExperience: { row: { aircraftTypeRatingId: 'a320' }, profile: p, ratingsById } }, /already hold a type rating on this aircraft/],
      ['motor', { newEngine: { row: { engineId: 'cfm56' }, profile: p } }, /already in your engine experience/],
    ];
    for (const [name, changes, message] of cases) {
      const result = await saveTechnicianProfile('tech', changes, store);
      assert.equal(result.ok, false, name);
      assert.match(!result.ok ? result.error : '', message, name);
    }
    assert.equal(calls.length, 0);
  });

  // ── Los tipos que añade una licencia ──────────────────────────────────────

  await test('Tipos — la B2 añade Avionics Technician; una B1.1 a quien ya es Mechanic no añade nada', () => {
    assert.deepEqual(add.typesAddedByLicences(['mechanic'], [easaB11], [easaB2]), ['avionic']);
    assert.equal(add.licenceAddsNote(['mechanic'], [easaB11], [easaB2]), 'Adds Avionics Technician to what you do');
    assert.deepEqual(add.typesAddedByLicences(['mechanic'], [], [easaB11]), []);
    assert.equal(add.licenceAddsNote(['mechanic'], [], [easaB11]), null);
    assert.equal(add.licenceAddsNote(['painter'], [], [easaB11, easaB2]), 'Adds Mechanic and Avionics Technician to what you do');
    assert.deepEqual(add.typesAddedByLicences(['painter'], [], [{ authority: 'EASA', code: 'C' }]), [], 'la C no implica oficio');
    // La Mechanic que el técnico quitó (FAA A) no vuelve al añadir otra licencia que no la bloquea.
    assert.deepEqual(add.typesAddedByLicences(['avionic'], [{ authority: 'FAA', code: 'A' }], [easaB2]), []);
  });

  await test('Tipos — la pantalla final: "It stays while you hold the B2", o el texto de la FAA A o A&P (respuesta 27)', () => {
    assert.deepEqual(add.licenceTypeNotices(['mechanic'], [easaB11], [easaB2]), [
      { type: 'avionic', title: 'Avionics Technician added to what you do', text: 'It stays while you hold the B2.' },
    ]);
    assert.deepEqual(add.licenceTypeNotices(['painter'], [], [easaB11, { authority: 'EASA', code: 'B1.3' }]), [
      { type: 'mechanic', title: 'Mechanic added to what you do', text: 'It stays while you hold the B1.1 or B1.3.' },
    ]);
    assert.deepEqual(add.licenceTypeNotices(['painter'], [], [easaB11, { authority: 'UK_CAA', code: 'B1.1' }])[0].text, 'It stays while you hold the EASA B1.1 or UK CAA B1.1.');
    assert.deepEqual(add.licenceTypeNotices(['avionic'], [], [faaAP]), [
      { type: 'mechanic', title: 'Mechanic added to what you do', text: 'An FAA A or A&P ticks Mechanic, but you can untick it if you only do avionics.' },
    ]);
    // Con una B1.1 en el mismo alta, la Mechanic la bloquea la B1.1, no la A&P.
    assert.equal(add.licenceTypeNotices(['avionic'], [], [faaAP, easaB11])[0].text, 'It stays while you hold the B1.1.');
    assert.deepEqual(add.licenceTypeNotices(['mechanic'], [easaB11], [faaAP]), [], 'no añade nada: no hay aviso');
  });

  await test('Tipos — el asistente guarda los tipos que añade la licencia (antes que ella) y nada si no añade', async () => {
    let { store, calls } = fakeStore();
    let result = await saveTechnicianProfile('tech', { newLicences: { licenses: [easaB2], profile: profile() } }, store);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((c) => c.name), ['replaceProfileTypes', 'upsertLicenses']);
    assert.deepEqual(calls[0].args, ['tech', ['mechanic', 'avionic'], ['B1.1', 'B2']], 'contra las licencias que habrá después');
    ({ store, calls } = fakeStore());
    result = await saveTechnicianProfile('tech', { newLicences: { licenses: [{ authority: 'EASA', code: 'B1.3' }], profile: profile() } }, store);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((c) => c.name), ['upsertLicenses'], 'B1.3 a un Mechanic: los tipos no se tocan');
  });

  // ── "Expires" según la autoridad ──────────────────────────────────────────

  await test('Expires — sólo para las autoridades cuyas licencias caducan (no FAA ni CASA)', () => {
    const blocks = add.licenceDateBlocks([
      { authority: 'EASA', code: 'B2' },
      { authority: 'UK_CAA', code: 'B2' },
      { authority: 'GCAA', code: 'B2' },
      { authority: 'CASA', code: 'B2' },
      { authority: 'FAA', code: 'A&P' },
    ]);
    assert.deepEqual(blocks.map((b) => [b.license.authority, b.showsExpiry]), [
      ['EASA', true], ['UK_CAA', true], ['GCAA', true], ['CASA', false], ['FAA', false],
    ]);
    const screen = read('app/technician/add/licence.tsx');
    assert.match(screen, /licenceDateBlocks\(picked\)\.map\(\(\{ license, showsExpiry \}\)/);
    assert.match(screen, /\{showsExpiry \? \([\s\S]*?Expires/);
  });

  await test('Expires — el caso de uso valida el orden donde caduca y no guarda caducidad donde no', async () => {
    let { store, calls } = fakeStore();
    let result = await saveTechnicianProfile('tech', {
      newLicences: { licenses: [{ authority: 'EASA', code: 'B2', issuedAt: '2024-05-01', expiresAt: '2024-01-01' }], profile: profile() },
    }, store);
    assert.match(!result.ok ? result.error : '', /EASA B2: expiry date must be after the issue date/);
    assert.equal(calls.length, 0);
    ({ store, calls } = fakeStore());
    result = await saveTechnicianProfile('tech', {
      newLicences: { licenses: [{ authority: 'CASA', code: 'B2', issuedAt: '2024-05-01', expiresAt: '2020-01-01' }], profile: profile() },
    }, store);
    assert.equal(result.ok, true, 'CASA no caduca: una fecha vieja no bloquea');
    const upsert = calls.find((c) => c.name === 'upsertLicenses');
    assert.deepEqual(upsert?.args[1], [{ authority: 'CASA', code: 'B2', issuedAt: '2024-05-01', expiresAt: undefined }]);
  });

  // ── Cada asistente guarda sólo lo suyo ────────────────────────────────────

  await test('Licencia — escribe las nuevas y nada más: ni reescribe las que hay ni retira ninguna', async () => {
    const { store, calls } = fakeStore();
    const existing = profile({ licenses: [{ ...easaB11, issuedAt: '2019-01-01' }] });
    await saveTechnicianProfile('tech', { newLicences: { licenses: [{ authority: 'EASA', code: 'B1.3', issuedAt: '2021-02-03' }], profile: existing } }, store);
    assert.deepEqual(calls.map((c) => c.name), ['upsertLicenses']);
    assert.deepEqual(calls[0].args[1], [{ authority: 'EASA', code: 'B1.3', issuedAt: '2021-02-03', expiresAt: undefined }]);
  });

  await test('Type rating — sólo las habilitaciones: las de antes tal cual, más la nueva con sus detalles', async () => {
    const { store, calls } = fakeStore();
    const p = profile({ licenses: [easaB11, { authority: 'EASA', code: 'B1.4' }] });
    const result = await saveTechnicianProfile('tech', {
      newHabilitation: {
        habilitation: { authority: 'EASA', licenseCode: 'B1.4', aircraftTypeRatingId: 'r44', isCurrent: false, issuedAt: '2020-01-01', expiresAt: '2030-01-01', experienceYears: 4 },
        profile: p,
        ratingsById,
        engineIndex: engines,
      },
    }, store);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((c) => c.name), ['replaceHabilitations']);
    assert.deepEqual(calls[0].args[1], [
      { authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'a320', experienceYears: undefined, issuedAt: undefined, expiresAt: undefined, isCurrent: true },
      { authority: 'EASA', licenseCode: 'B1.4', aircraftTypeRatingId: 'r44', experienceYears: 4, issuedAt: '2020-01-01', expiresAt: '2030-01-01', isCurrent: false },
    ]);
  });

  await test('Type rating — las validaciones de hoy: licencia que no tiene, sin ratings, fuera de alcance, catálogo caído, fechas', async () => {
    const { store, calls } = fakeStore();
    const save = (habilitation: HabilitationRow, engineIndex = engines, p = profile()) =>
      saveTechnicianProfile('tech', { newHabilitation: { habilitation, profile: p, ratingsById, engineIndex } }, store);
    let r = await save({ authority: 'UK_CAA', licenseCode: 'B1.1', aircraftTypeRatingId: 'b737' });
    assert.match(!r.ok ? r.error : '', /Add the UK CAA B1\.1 licence first/);
    r = await save({ authority: 'FAA', licenseCode: 'A&P', aircraftTypeRatingId: 'b737' }, engines, profile({ licenses: [easaB11, faaAP] }));
    assert.match(!r.ok ? r.error : '', /Individual type ratings require a B1, B2 or C licence/);
    r = await save({ authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'r44' });
    assert.match(!r.ok ? r.error : '', /Robinson R44/, 'un helicóptero de pistón no cabe en una B1.1');
    r = await save({ authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'b737' }, new Map());
    assert.match(!r.ok ? r.error : '', /could not be checked, so they were not saved/, 'sin catálogo de motores no se puede comprobar');
    r = await save({ authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'b737', issuedAt: '2024-05-01', expiresAt: '2024-01-01' });
    assert.match(!r.ok ? r.error : '', /EASA B1\.1 \+ Boeing 737NG — CFM56-7B: expiry date must be after the issue date/);
    assert.equal(calls.length, 0);
  });

  await test('Type rating — un rechazo de la base (083) se explica por habilitación, sin reintentar', async () => {
    const { store, calls } = fakeStore({
      replaceHabilitations: async () => { throw Object.assign(new Error('Individual type rating is outside the licence scope.'), { code: '23514' }); },
    });
    const r = await saveTechnicianProfile('tech', {
      newHabilitation: { habilitation: { authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'b737' }, profile: profile(), ratingsById, engineIndex: engines },
    }, store);
    assert.deepEqual(r, { ok: false, error: 'described' });
    assert.equal(calls.filter((c) => c.name === 'describeHabilitationScopeRejection').length, 1);
  });

  await test('Aeronave — sólo la experiencia: la de antes tal cual, más la nueva; la firma sólo con FAA A o A&P', async () => {
    let { store, calls } = fakeStore();
    let r = await saveTechnicianProfile('tech', {
      newAircraftExperience: { row: { aircraftTypeRatingId: 'r44', years: 2, signed: true }, profile: profile(), ratingsById },
    }, store);
    assert.match(!r.ok ? r.error : '', /Sign-off needs an FAA A or A&P licence/);
    assert.equal(calls.length, 0);
    ({ store, calls } = fakeStore());
    r = await saveTechnicianProfile('tech', {
      newAircraftExperience: { row: { aircraftTypeRatingId: 'r44', years: 2, signed: true }, profile: profile({ licenses: [easaB11, faaAP] }), ratingsById },
    }, store);
    assert.equal(r.ok, true);
    assert.deepEqual(calls.map((c) => c.name), ['replaceAircraftExperience']);
    assert.deepEqual(calls[0].args[1], [
      { aircraftTypeRatingId: 'b737', years: 3, signed: undefined },
      { aircraftTypeRatingId: 'r44', years: 2, signed: true },
    ]);
  });

  await test('Motor — sólo los motores; sólo Engine Technician; años vacíos o de 0 a 70', async () => {
    let { store, calls } = fakeStore();
    let r = await saveTechnicianProfile('tech', { newEngine: { row: { engineId: 'lycoming' }, profile: profile() } }, store);
    assert.match(!r.ok ? r.error : '', /Only Engine Technician profiles can declare engines/);
    const engineTech = profile({ technicianTypes: ['engine_technician'], engines: [{ id: 'g1', engineId: 'cfm56', years: 6 }] });
    r = await saveTechnicianProfile('tech', { newEngine: { row: { engineId: 'lycoming', years: 71 }, profile: engineTech } }, store);
    assert.match(!r.ok ? r.error : '', /between 0 and 70/);
    assert.equal(calls.length, 0);
    ({ store, calls } = fakeStore());
    r = await saveTechnicianProfile('tech', { newEngine: { row: { engineId: 'lycoming' }, profile: engineTech } }, store);
    assert.equal(r.ok, true);
    assert.deepEqual(calls.map((c) => [c.name, c.args[1]]), [['replaceEngineExperience', [{ engineId: 'cfm56', years: 6 }, { engineId: 'lycoming', years: undefined }]]]);
    assert.deepEqual(add.parseOptionalYears(''), { years: undefined, invalid: false });
    assert.deepEqual(add.parseOptionalYears('0'), { years: 0, invalid: false });
    assert.equal(add.parseOptionalYears('71').invalid, true);
  });

  await test('Pantallas — cada asistente guarda su grupo, una vez, con el perfil recién leído, y ninguno llama a Supabase', () => {
    const groups: Record<string, RegExp> = {
      'app/technician/add/licence.tsx': /saveTechnicianProfile\(fresh\.id, \{ newLicences: \{ licenses: picked, profile: fresh \} \}\)/,
      'app/technician/add/type-rating.tsx': /saveTechnicianProfile\(fresh\.id, \{\s*newHabilitation: \{ habilitation, profile: fresh, ratingsById: allRatings, engineIndex \},?\s*\}\)/,
      'app/technician/add/aircraft.tsx': /saveTechnicianProfile\(fresh\.id, \{\s*newAircraftExperience: \{ row, profile: fresh, ratingsById: allRatings \},?\s*\}\)/,
      'app/technician/add/engine.tsx': /saveTechnicianProfile\(fresh\.id, \{ newEngine: \{ row, profile: fresh \} \}\)/,
    };
    for (const [file, pattern] of Object.entries(groups)) {
      const src = read(file);
      assert.match(src, pattern, file);
      assert.equal((src.match(/saveTechnicianProfile\(/g) ?? []).length, 1, `${file}: un solo guardado`);
      assert.ok(src.indexOf('const fresh = await reload()') > 0 && src.indexOf('const fresh = await reload()') < src.indexOf('saveTechnicianProfile(fresh.id'), `${file}: relee el perfil antes de guardar`);
      assert.doesNotMatch(src, /lib\/supabase|supabase\./, `${file} no llama a Supabase`);
    }
    assert.deepEqual(supabaseCalls, []);
  });

  await test('Escritorio — el mismo asistente dentro de una tarjeta centrada', () => {
    const parts = read('src/components/technician/WizardParts.tsx');
    assert.match(parts, /if \(wide\) \{[\s\S]*?<View style=\{styles\.wideCard\}>/);
    assert.match(parts, /wideCard: \{[\s\S]*?maxWidth: 640/);
    assert.match(parts, /widePageContent: \{[\s\S]*?alignItems: 'center'/);
  });

  // ── My work: un borrador que se quedó viejo ───────────────────────────────

  await test('My work — la huella del perfil no depende de ids ni del orden, y cambia si un asistente añade algo', () => {
    const p = profile();
    const shuffled = profile({
      habilitations: [{ authority: 'EASA', licenseCode: 'B1.1', aircraftTypeRatingId: 'a320', isCurrent: true }],
      aircraftExperience: [{ aircraftTypeRatingId: 'b737', years: 3 }],
    });
    assert.equal(work.workSnapshotKey(p), work.workSnapshotKey(shuffled));
    assert.notEqual(work.workSnapshotKey(p), work.workSnapshotKey(profile({ licenses: [easaB11, easaB2] })));
    assert.notEqual(work.workSnapshotKey(p), work.workSnapshotKey(profile({ engines: [{ engineId: 'cfm56' }] })));
    assert.notEqual(work.workSnapshotKey(p), work.workSnapshotKey(profile({ licenses: [{ ...easaB11, issuedAt: '2020-01-01' }] })));
    const myWork = read('app/technician/(you)/profile/work.tsx');
    assert.match(myWork, /const stale = dirty && workSnapshotKey\(base\) !== workSnapshotKey\(saved\)/);
    assert.match(myWork, /disabled=\{!dirty \|\| stale\}/, 'un borrador viejo no se guarda');
    assert.match(myWork, /if \(dirty\) \{\s*const discard = await confirm\(/, 'abrir un asistente con cambios sin guardar pregunta antes');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
