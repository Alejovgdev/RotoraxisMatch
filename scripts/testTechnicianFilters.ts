// Standalone tests — sin Supabase y sin navegador. Cubren los filtros de
// técnicos que comparten la búsqueda y el mapa de empresa (rediseño, fase 3B;
// respuesta 23 y decisiones del dueño del 2026-10-07):
//   - qué categorías de licencia salen según el oficio, aviones/helicópteros y
//     la autoridad;
//   - cuándo salen las secciones Licencia y Motor;
//   - qué se limpia al cambiar algo;
//   - qué técnicos pasan el filtro (la función única, matchesTechnicianSearch);
//   - cuánto duran los filtros al navegar.
//
// Run via: npm run test:technician-filters
import assert from 'node:assert/strict';
import {
  EMPTY_TECHNICIAN_FILTERS,
  NO_APPLIED_FILTERS,
  activeFilterCount,
  appliedAfterNavigation,
  applyTechnicianFilters,
  buildFamilyProductMap,
  isEngineSectionVisible,
  isLicenceSectionVisible,
  isTechnicianFilterScope,
  licenceCategoryOptions,
  normalizeTechnicianFilters,
  setLicenceAuthority,
  setProductFilter,
  toTechnicianSearchQuery,
  toggleTechnicianType,
  type TechnicianFilterState,
} from '../src/utils/technicianFilters';
import { matchesTechnicianSearch, type TechnicianSearchQuery } from '../src/utils/technicianSearchFilterMatch';
import { LICENSE_CODES } from '../src/constants/licenses';
import type { AircraftTypeRatingCatalog } from '../src/types/catalog';
import type { SafeTechnicianPreview } from '../src/types/privacy';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
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

const state = (over: Partial<TechnicianFilterState> = {}): TechnicianFilterState => ({ ...EMPTY_TECHNICIAN_FILTERS, ...over });

// Catálogo mínimo: dos familias de avión y una de helicóptero.
const RATINGS = [
  { id: 'r-a320', manufacturer: 'Airbus', aircraftFamily: 'A318/A319/A320/A321', productType: 'Aeroplane' },
  { id: 'r-737', manufacturer: 'Boeing', aircraftFamily: '737', productType: 'Aeroplane' },
  { id: 'r-h145', manufacturer: 'Airbus Helicopters', aircraftFamily: 'H145', productType: 'Helicopter' },
] as unknown as AircraftTypeRatingCatalog[];
const FAMILIES = buildFamilyProductMap(RATINGS);
const A320 = 'Airbus::A318/A319/A320/A321';
const B737 = 'Boeing::737';
const H145 = 'Airbus Helicopters::H145';
const RATING_INDEX = new Map(RATINGS.map((r) => [r.id, r]));

// ── Categorías que salen ──────────────────────────────────────────────────

test('Licencia — mecánico: su rama Part-66 y la C, como en el formulario de oferta', () => {
  assert.deepEqual(
    licenceCategoryOptions(['mechanic'], 'any', 'any'),
    ['A1', 'A2', 'A3', 'A4', 'B1.1', 'B1.2', 'B1.3', 'B1.4', 'B3', 'L', 'C'],
  );
});

test('Licencia — helicópteros acota a lo que vale para helicóptero', () => {
  assert.deepEqual(licenceCategoryOptions(['mechanic'], 'Helicopter', 'any'), ['A3', 'A4', 'B1.3', 'B1.4', 'C']);
  assert.deepEqual(licenceCategoryOptions(['mechanic'], 'Aeroplane', 'any'), ['A1', 'A2', 'B1.1', 'B1.2', 'B3', 'L', 'C']);
});

test('Licencia — aviónico: B2, B2L y C; con CASA, sin B2L', () => {
  assert.deepEqual(licenceCategoryOptions(['avionic'], 'any', 'any'), ['B2', 'B2L', 'C']);
  assert.deepEqual(licenceCategoryOptions(['avionic'], 'Helicopter', 'any'), ['B2', 'B2L', 'C']);
  assert.deepEqual(licenceCategoryOptions(['avionic'], 'any', 'CASA'), ['B2', 'C']);
});

test('Licencia — Engine Technician: las B1 (FAA: P y A&P), como una oferta de motor', () => {
  assert.deepEqual(licenceCategoryOptions(['engine_technician'], 'any', 'any'), ['B1.1', 'B1.2', 'B1.3', 'B1.4']);
  assert.deepEqual(licenceCategoryOptions(['engine_technician'], 'Helicopter', 'EASA'), ['B1.3', 'B1.4']);
  assert.deepEqual(licenceCategoryOptions(['engine_technician'], 'any', 'FAA'), ['P', 'A&P']);
});

test('Licencia — FAA: A, P y A&P para mecánico; A y A&P para aviónico', () => {
  assert.deepEqual(licenceCategoryOptions(['mechanic'], 'any', 'FAA'), ['A', 'P', 'A&P']);
  assert.deepEqual(licenceCategoryOptions(['avionic'], 'any', 'FAA'), ['A', 'A&P']);
});

test('Licencia — sin oficio: todo lo que emite la autoridad; "Any authority" es la lista Part-66 de siempre', () => {
  assert.deepEqual(licenceCategoryOptions([], 'any', 'any'), [...LICENSE_CODES]);
  assert.deepEqual(licenceCategoryOptions([], 'any', 'FAA'), ['A', 'P', 'A&P']);
  assert.ok(!licenceCategoryOptions([], 'any', 'CASA').includes('B3'), 'CASA no emite B3');
  assert.ok(!licenceCategoryOptions([], 'Aeroplane', 'any').includes('B1.3'));
});

test('Licencia — varios oficios suman sus opciones; uno sin licencia no aporta ni quita', () => {
  assert.deepEqual(licenceCategoryOptions(['avionic', 'painter'], 'any', 'any'), ['B2', 'B2L', 'C']);
  const both = licenceCategoryOptions(['mechanic', 'avionic'], 'any', 'any');
  for (const code of ['B1.1', 'B2', 'B2L', 'C']) assert.ok(both.includes(code as never), code);
});

// ── Secciones ─────────────────────────────────────────────────────────────

test('Secciones — Licencia se oculta si todos los oficios elegidos trabajan sin licencia', () => {
  assert.equal(isLicenceSectionVisible([]), true, 'sin oficio elegido, sale');
  assert.equal(isLicenceSectionVisible(['painter']), false);
  assert.equal(isLicenceSectionVisible(['sheet_metal_worker', 'composite']), false);
  assert.equal(isLicenceSectionVisible(['painter', 'mechanic']), true);
  assert.equal(isLicenceSectionVisible(['engine_technician']), true);
  assert.deepEqual(licenceCategoryOptions(['painter'], 'any', 'any'), []);
});

test('Secciones — Motor sólo con Engine Technician elegido', () => {
  assert.equal(isEngineSectionVisible([]), false);
  assert.equal(isEngineSectionVisible(['mechanic']), false);
  assert.equal(isEngineSectionVisible(['mechanic', 'engine_technician']), true);
});

// ── Limpieza ──────────────────────────────────────────────────────────────

test('Limpieza — pasar a helicópteros quita las categorías y aeronaves de avión', () => {
  const before = state({ technicianTypes: ['mechanic'], licenseCodes: ['B1.1', 'B1.3', 'C'], aircraftFamilyKeys: [A320, H145] });
  const after = setProductFilter(before, 'Helicopter', FAMILIES);
  assert.deepEqual(after.licenseCodes, ['B1.3', 'C']);
  assert.deepEqual(after.aircraftFamilyKeys, [H145]);
  assert.deepEqual(setProductFilter(after, 'any', FAMILIES).aircraftFamilyKeys, [H145], 'volver a Any no devuelve lo quitado');
});

test('Limpieza — una familia que el catálogo cargado no conoce se conserva', () => {
  const after = setProductFilter(state({ aircraftFamilyKeys: ['Unknown::X', B737] }), 'Helicopter', FAMILIES);
  assert.deepEqual(after.aircraftFamilyKeys, ['Unknown::X']);
});

test('Limpieza — cambiar de autoridad quita lo que esa autoridad no emite', () => {
  const base = state({ technicianTypes: ['mechanic'], licenseCodes: ['B1.1', 'B3'] });
  assert.deepEqual(setLicenceAuthority(base, 'CASA', FAMILIES).licenseCodes, ['B1.1'], 'CASA no emite B3');
  assert.deepEqual(setLicenceAuthority(base, 'FAA', FAMILIES).licenseCodes, []);
});

test('Limpieza — quedarse sólo con oficios sin licencia vacía la sección Licencia', () => {
  const base = state({ technicianTypes: ['mechanic'], licenseAuthority: 'EASA', licenseCodes: ['B1.1'] });
  const withPainter = toggleTechnicianType(base, 'painter', FAMILIES);
  assert.deepEqual(withPainter.licenseCodes, ['B1.1'], 'mientras quede un oficio con licencia, se queda');
  const onlyPainter = toggleTechnicianType(withPainter, 'mechanic', FAMILIES);
  assert.deepEqual([onlyPainter.licenseAuthority, onlyPainter.licenseCodes], ['any', []]);
});

test('Limpieza — cambiar de oficio quita las categorías que ya no encajan', () => {
  const mech = state({ technicianTypes: ['mechanic'], licenseCodes: ['B1.1', 'C'] });
  const avionic = toggleTechnicianType(toggleTechnicianType(mech, 'avionic', FAMILIES), 'mechanic', FAMILIES);
  assert.deepEqual(avionic.licenseCodes, ['C']);
});

test('Limpieza — sin Engine Technician no quedan motores', () => {
  const base = state({ technicianTypes: ['engine_technician', 'mechanic'], engineIds: ['e1', 'e2'] });
  assert.deepEqual(toggleTechnicianType(base, 'mechanic', FAMILIES).engineIds, ['e1', 'e2']);
  assert.deepEqual(toggleTechnicianType(base, 'engine_technician', FAMILIES).engineIds, []);
  assert.deepEqual(normalizeTechnicianFilters(state({ engineIds: ['e1'] }), FAMILIES).engineIds, []);
});

test('Limpieza — lo que no depende de nada se queda', () => {
  const base = state({
    technicianTypes: ['mechanic'],
    availability: ['open_to_offers'],
    verifiedOnly: true,
    location: { country: { code: 'ES', name: 'Spain' }, city: null },
  });
  const after = toggleTechnicianType(setProductFilter(base, 'Helicopter', FAMILIES), 'painter', FAMILIES);
  assert.deepEqual([after.availability, after.verifiedOnly, after.location], [base.availability, true, base.location]);
});

// ── Consulta ──────────────────────────────────────────────────────────────

test('Consulta — el producto no viaja; "Any authority" tampoco', () => {
  const q = toTechnicianSearchQuery(state({ technicianTypes: ['mechanic'], product: 'Helicopter', licenseCodes: ['B1.3'] }));
  assert.deepEqual(q, { technicianTypes: ['mechanic'], licenseCodes: ['B1.3'] });
  assert.deepEqual(toTechnicianSearchQuery(EMPTY_TECHNICIAN_FILTERS), {}, 'sin filtros, todos');
});

test('Consulta — autoridad, motores, ubicación, disponibilidad y verificados', () => {
  const q = toTechnicianSearchQuery(state({
    technicianTypes: ['engine_technician'],
    licenseAuthority: 'EASA',
    engineIds: ['e1'],
    location: { country: { code: 'ES', name: 'Spain' }, city: { kind: 'manual', name: 'Getafe' } as never },
    availability: ['open_to_offers'],
    verifiedOnly: true,
  }));
  assert.deepEqual(q, {
    technicianTypes: ['engine_technician'],
    licenseAuthority: 'EASA',
    engineIds: ['e1'],
    countryCode: 'ES',
    city: 'Getafe',
    availabilityStatuses: ['open_to_offers'],
    verificationStatuses: ['verified'],
  });
});

test('Consulta — el número de "Filters" cuenta cada opción en uso', () => {
  assert.equal(activeFilterCount(EMPTY_TECHNICIAN_FILTERS), 0);
  assert.equal(activeFilterCount(state({ technicianTypes: ['mechanic'], product: 'Aeroplane', availability: ['open_to_offers'], verifiedOnly: true })), 4);
});

// ── Qué técnicos pasan ────────────────────────────────────────────────────

const tech = (over: Partial<SafeTechnicianPreview> = {}): SafeTechnicianPreview => ({
  id: 't',
  anonymousCode: 'T1',
  technicianTypes: ['mechanic'],
  country: 'Spain',
  city: 'Madrid',
  locationCountryCode: 'ES',
  licenses: [{ authority: 'EASA', licenseCode: 'B1.1' }],
  habilitations: [{ id: 'h', technicianId: 't', technicianLicenseId: 'l', licenseCode: 'B1.1', aircraftTypeRatingId: 'r-a320', createdAt: '' }],
  aircraftExperience: [{ id: 'x', technicianId: 't', aircraftTypeRatingId: 'r-h145', createdAt: '' }],
  engines: [],
  availability: { status: 'open_to_offers', immediately: true, contractTypes: [] },
  verificationStatus: 'verified',
  ...over,
} as unknown as SafeTechnicianPreview);

const passes = (query: TechnicianSearchQuery, t = tech()) => matchesTechnicianSearch(t, query, RATING_INDEX as never);

test('Filtro — licencia por código exacto; "Any authority" como antes', () => {
  const ukCaa = tech({ licenses: [{ authority: 'UK_CAA', licenseCode: 'B1.1' }] });
  assert.ok(passes({ licenseCodes: ['B1.1'] }, ukCaa), 'el código vale con cualquier autoridad');
  assert.ok(!passes({ licenseCodes: ['A1'] }), 'una B1.1 no cuenta por una A1: código exacto');
  assert.ok(passes({ licenseCodes: ['B1.1'], licenseAuthority: 'EASA' }));
  assert.ok(!passes({ licenseCodes: ['B1.1'], licenseAuthority: 'EASA' }, ukCaa));
  assert.ok(passes({ licenseAuthority: 'UK_CAA' }, ukCaa), 'sólo la autoridad: cualquier licencia suya');
  assert.ok(!passes({ licenseAuthority: 'FAA' }, ukCaa));
});

test('Filtro — la credencial que cumple es UNA: código y autoridad de la misma licencia', () => {
  const mixed = tech({ licenses: [{ authority: 'EASA', licenseCode: 'B2' }, { authority: 'UK_CAA', licenseCode: 'B1.1' }] });
  assert.ok(!passes({ licenseCodes: ['B1.1'], licenseAuthority: 'EASA' }, mixed), 'EASA B2 + UK CAA B1.1 no es una EASA B1.1');
});

test('Filtro — aeronave por familia y sólo por type rating, como antes', () => {
  assert.ok(passes({ aircraftFamilyKeys: [A320] }));
  assert.ok(passes({ aircraftFamilyKeys: [B737, A320] }), 'cualquiera de las elegidas');
  assert.ok(!passes({ aircraftFamilyKeys: [H145] }), 'la experiencia declarada no cuenta');
});

test('Filtro — motor: sólo los declarados por el técnico', () => {
  const engineTech = tech({ technicianTypes: ['engine_technician'], engines: [{ id: 'e', technicianId: 't', engineId: 'cfm56-7b', createdAt: '' }] as never });
  assert.ok(passes({ engineIds: ['cfm56-7b', 'x'] }, engineTech));
  assert.ok(!passes({ engineIds: ['leap-1a'] }, engineTech));
  assert.ok(!passes({ engineIds: ['cfm56-7b'] }), 'sin motores declarados, no pasa');
});

test('Filtro — cualquier opción dentro de una sección, y todas las secciones a la vez', () => {
  assert.ok(passes({ technicianTypes: ['avionic', 'mechanic'], availabilityStatuses: ['unavailable', 'open_to_offers'] }));
  assert.ok(!passes({ technicianTypes: ['mechanic'], verificationStatuses: ['verified'], countryCode: 'FR' }), 'falla la ubicación');
  assert.ok(!passes({ technicianTypes: ['mechanic'], licenseCodes: ['B1.1'], aircraftFamilyKeys: [B737] }), 'falla la aeronave');
  assert.ok(passes({}), 'sin filtros, todos');
});

// ── Cuánto duran ──────────────────────────────────────────────────────────

test('Duración — se conservan entre lista y mapa y al volver de un técnico', () => {
  const applied = applyTechnicianFilters(NO_APPLIED_FILTERS, state({ technicianTypes: ['mechanic'] }));
  let current = applied;
  for (const path of ['/company/search', '/company/map', '/company/technician/abc', '/company/map', '/company/search?offerId=1']) {
    current = appliedAfterNavigation(current, path);
    assert.equal(current, applied, path);
  }
});

test('Duración — se vacían al salir a otra sección', () => {
  const applied = applyTechnicianFilters(NO_APPLIED_FILTERS, state({ verifiedOnly: true }));
  for (const path of ['/company', '/company/applications', '/company/chats', '/company/chats/1', '/company/offers/new', '/company/profile', '/company/direct-offers']) {
    assert.deepEqual(appliedAfterNavigation(applied, path), NO_APPLIED_FILTERS, path);
  }
  assert.equal(appliedAfterNavigation(NO_APPLIED_FILTERS, '/company'), NO_APPLIED_FILTERS, 'sin nada aplicado no cambia nada');
});

test('Duración — qué pantallas son "búsqueda o mapa"', () => {
  assert.ok(isTechnicianFilterScope('/company/search'));
  assert.ok(isTechnicianFilterScope('/company/map/'));
  assert.ok(isTechnicianFilterScope('/company/technician/9'));
  assert.ok(!isTechnicianFilterScope('/company/searchx'));
  assert.ok(!isTechnicianFilterScope('/company/technician'));
  assert.ok(!isTechnicianFilterScope('/technician/offers'));
});

test('Duración — "Show technicians" aplica y cuenta', () => {
  const once = applyTechnicianFilters(NO_APPLIED_FILTERS, EMPTY_TECHNICIAN_FILTERS);
  const twice = applyTechnicianFilters(once, state({ verifiedOnly: true }));
  assert.deepEqual([once.version, twice.version, twice.filters.verifiedOnly], [1, 2, true]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
