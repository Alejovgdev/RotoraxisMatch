// Standalone tests — sin Supabase y sin navegador. Cubren el rediseño del
// técnico, fase 5A (docs/UI_REDESIGN.md, sección 8):
//   - la navegación: qué pestaña y qué sección se marcan para cada URL, que las
//     cuatro pantallas raíz viven en (tabs) sin duplicar ninguna URL, y que la
//     barra inferior sólo la monta el grupo de pestañas;
//   - la sección Account del perfil (Settings, Help y Log out);
//   - la Home (mejor oferta y "Offers for you") y los filtros de Offers;
//   - la checklist de la página de oferta, con el CÁLCULO REAL del %: tiene los
//     mismos criterios que puntúan, su estado sale de los mismos puntos, y
//     cuando el % queda por debajo de lo que suman las filas, los avisos lo
//     explican. Es decir, que nunca contradice el %.
//
// Run via: npm run test:technician-nav
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TECHNICIAN_ADD_ROUTE,
  TECHNICIAN_SECTION_ROUTES,
  TECHNICIAN_ADD_ROUTES,
  TECHNICIAN_TAB_ROUTES,
  technicianAccountSectionForPath,
  technicianAddActiveForPath,
  technicianSectionForPath,
  technicianTabForPath,
  technicianTopActionForPath,
} from '../src/utils/technicianNavigation';
import {
  MINIMUM_USEFUL_MATCH,
  bestMatchKicker,
  opportunityReasons,
  profileImprovementHints,
  summarizeTechnicianHome,
} from '../src/utils/technicianHome';
import {
  EMPTY_OFFER_LIST_FILTERS,
  OFFER_QUICK_CHIPS,
  filterAndSortOffers,
  isQuickChipSelected,
  offerCardFacts,
  offerMatchesListFilters,
  technicianApplicationLook,
  technicianDirectOfferLook,
  toggleQuickChip,
} from '../src/utils/technicianOffers';
import {
  CHECKLIST_ORDER,
  checklistState,
  offerChecklistNotices,
  offerChecklistRows,
  scoreCapNote,
} from '../src/utils/offerChecklist';
import { visibleBreakdownRows, type BreakdownKey } from '../src/utils/matchBreakdownRows';
import { calculateOfferTechnicianMatch } from '../src/utils/offerMatchExplain';
import { offerShapeViolations } from '../src/utils/offerShape';
import { buildAircraftRatingIndex } from '../src/constants/aircraftTypeRatings';
import { buildEngineIndex } from '../src/constants/engines';
import type { OfferWithRequirements } from '../src/types/offer';
import type { TechnicianWithRelations, TechnicianLicense, TechnicianHabilitation } from '../src/types/technician';
import type { AircraftTypeRatingCatalog, AuthorityCode, AuthorityLicenseCode, EngineCatalog, LicenseCode } from '../src/types/catalog';
import type { MatchScore } from '../src/types/matching';
import type { OfferMatchResult } from '../src/utils/matchingService';

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

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── Navegación ─────────────────────────────────────────────────────────────

test('Pestañas — sólo las cuatro raíces marcan pestaña', () => {
  assert.equal(technicianTabForPath('/technician'), 'home');
  assert.equal(technicianTabForPath('/technician/'), 'home');
  assert.equal(technicianTabForPath('/technician/offers'), 'offers');
  assert.equal(technicianTabForPath('/technician/offers?x=1'), 'offers');
  assert.equal(technicianTabForPath('/technician/chats'), 'inbox');
  assert.equal(technicianTabForPath('/technician/profile'), 'you');
});

test('Pestañas — una pantalla interior no es raíz (ahí no hay barra inferior)', () => {
  for (const p of [
    '/technician/offers/123',
    '/technician/chats/9',
    '/technician/applications',
    '/technician/direct-offers',
    '/technician/direct-offers/4',
    '/technician/map',
    '/technician/documents',
    '/technician/requests',
  ]) {
    assert.equal(technicianTabForPath(p), null, p);
  }
});

test('Secciones de escritorio — Home, Offers, Applications, Direct offers y Map; las interiores cuelgan de la suya', () => {
  assert.deepEqual(Object.keys(TECHNICIAN_SECTION_ROUTES), ['home', 'offers', 'applications', 'direct', 'map']);
  assert.equal(technicianSectionForPath('/technician'), 'home');
  assert.equal(technicianSectionForPath('/technician/offers'), 'offers');
  assert.equal(technicianSectionForPath('/technician/offers/42'), 'offers');
  assert.equal(technicianSectionForPath('/technician/applications'), 'applications');
  assert.equal(technicianSectionForPath('/technician/direct-offers/7'), 'direct');
  assert.equal(technicianSectionForPath('/technician/map'), 'map');
});

test('Secciones — Inbox, You, Documents y la pantalla vieja de solicitudes no son sección', () => {
  for (const p of ['/technician/chats', '/technician/chats/1', '/technician/profile', '/technician/documents', '/technician/requests']) {
    assert.equal(technicianSectionForPath(p), null, p);
  }
  assert.equal(technicianSectionForPath('/technician/offersx'), null, 'un prefijo no basta: hace falta la barra');
});

test('Barra superior — Inbox incluye las conversaciones; You, el perfil', () => {
  assert.equal(technicianTopActionForPath('/technician/chats'), 'inbox');
  assert.equal(technicianTopActionForPath('/technician/chats/abc'), 'inbox');
  assert.equal(technicianTopActionForPath('/technician/profile'), 'you');
  assert.equal(technicianTopActionForPath('/technician/profiles'), null);
  assert.equal(technicianTopActionForPath('/technician'), null);
});

test('Barra superior — Documents cuelga de You y la marca; el "+" y sus asistentes marcan "+ Add" (fase 8)', () => {
  assert.equal(technicianTopActionForPath('/technician/documents'), 'you');
  assert.equal(technicianTopActionForPath('/technician/documents?upload=license'), 'you');
  assert.equal(technicianTopActionForPath('/technician/profile/work'), 'you');
  assert.equal(technicianTopActionForPath('/technician/documentsx'), null);
  for (const route of Object.values(TECHNICIAN_ADD_ROUTES)) {
    assert.equal(technicianAddActiveForPath(route), true, route);
    assert.equal(technicianTopActionForPath(route), null, `${route}: no marca You ni Inbox`);
    assert.equal(technicianSectionForPath(route), null, `${route}: no es sección`);
  }
  assert.equal(technicianAddActiveForPath('/technician/add/type-rating?licence=EASA%3AB1.1'), true);
  for (const p of ['/technician', '/technician/profile', '/technician/documents', '/technician/addx']) {
    assert.equal(technicianAddActiveForPath(p), false, p);
  }
  const bars = read('src/components/technician/TechnicianNavBars.tsx');
  assert.match(bars, /active: technicianAddActiveForPath\(pathname\)/);
});

test('Menú lateral de You (escritorio, fase 8, C) — la fila marcada sale de la URL; You misma enseña y marca My work', () => {
  assert.equal(technicianAccountSectionForPath('/technician/profile'), 'work');
  assert.equal(technicianAccountSectionForPath('/technician/profile/work'), 'work');
  assert.equal(technicianAccountSectionForPath('/technician/profile/personal'), 'personal');
  assert.equal(technicianAccountSectionForPath('/technician/profile/location'), 'location');
  assert.equal(technicianAccountSectionForPath('/technician/profile/contracts'), 'contracts');
  assert.equal(technicianAccountSectionForPath('/technician/profile/links'), 'links');
  assert.equal(technicianAccountSectionForPath('/technician/documents?upload=1'), 'documents');
  assert.equal(technicianAccountSectionForPath('/settings'), 'settings');
  assert.equal(technicianAccountSectionForPath('/account/delete'), 'settings');
  assert.equal(technicianAccountSectionForPath('/support'), 'help');
  assert.equal(technicianAccountSectionForPath('/delete-account'), 'help');
  assert.equal(technicianAccountSectionForPath('/privacy-policy'), 'settings');
  assert.equal(technicianAccountSectionForPath('/terms-of-service'), 'settings');
  assert.equal(technicianAccountSectionForPath('/technician/add'), null);
  for (const p of ['/settings', '/support', '/account/delete', '/delete-account', '/privacy-policy', '/terms-of-service']) {
    assert.equal(technicianTopActionForPath(p), 'you', p);
  }
  // Las filas del menú: las de You, más Settings, Help y Log out; You y sus pantallas lo usan en escritorio.
  const nav = read('src/components/technician/TechnicianAccount.tsx');
  const labels = [...nav.slice(nav.indexOf('export function TechnicianAccountNav')).matchAll(/label="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(labels, ['My work', 'Documents', 'Location', 'Contract types', 'Personal details', 'Professional links', 'Settings', 'Help', 'Log out']);
  const parts = read('src/components/technician/ProfileParts.tsx');
  assert.match(parts, /<AccountLayout nav=\{<TechnicianAccountNav beforeLeave=\{beforeLeave\} \/>\}>/);
  assert.doesNotMatch(parts, /<BackLink/, 'en escritorio el menú sustituye al "‹ You"');
});

test('You en escritorio — una página: tarjeta y disponibilidad arriba, el apartado debajo, sin la lista repetida', () => {
  const you = read('app/technician/(tabs)/profile.tsx');
  // /technician/profile lleva en escritorio a My work, dentro del layout; en móvil, el menú de siempre.
  assert.match(you, /const wide = useIsWide\(\);\s*if \(wide\) return <Redirect href=\{TECHNICIAN_PROFILE_ROUTES\.work as never\} \/>;\s*return <YouMobile \/>;/);
  assert.doesNotMatch(you, /<AccountLayout|TechnicianAccountNav/, 'You ya no pinta su versión de escritorio con la lista');
  assert.match(read('src/components/technician/TechnicianNavBars.tsx'), /onPress: \(\) => router\.navigate\(TECHNICIAN_PROFILE_ROUTES\.work as never\)/, 'la barra superior abre My work');
});

test('You en escritorio — un layout de Expo Router: menú, tarjeta y disponibilidad se quedan montados; sólo cambia el apartado', () => {
  // Los apartados son rutas hijas del grupo (you); las URLs no cambian.
  const you = path.join(ROOT, 'app', 'technician', '(you)');
  for (const rel of ['_layout.tsx', 'documents.tsx', ...['work', 'personal', 'location', 'contracts', 'links'].map((r) => path.join('profile', `${r}.tsx`))]) {
    assert.ok(fs.existsSync(path.join(you, rel)), `falta app/technician/(you)/${rel}`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'app', 'technician', 'profile')), 'sin la carpeta vieja: la misma URL resolvería dos veces');
  assert.ok(!fs.existsSync(path.join(ROOT, 'app', 'technician', 'documents.tsx')), 'sin la pantalla vieja de Documents');
  // Escritorio: el marco con <Slot /> dentro; móvil: la pila de siempre.
  const layout = read('app/technician/(you)/_layout.tsx');
  assert.match(layout, /if \(wide\) \{\s*return \(\s*<YouDesktopShell>\s*<Slot \/>\s*<\/YouDesktopShell>/);
  assert.match(layout, /return <Stack screenOptions=\{\{ headerShown: false/);
  // El marco: menú (con la pregunta de salida), tarjeta y disponibilidad, y el apartado debajo.
  const parts = read('src/components/technician/ProfileParts.tsx');
  const shell = parts.slice(parts.indexOf('export function YouDesktopShell'), parts.indexOf('function SectionFade'));
  assert.match(shell, /<AccountLayout nav=\{<TechnicianAccountNav beforeLeave=\{beforeLeave\} \/>\}>\s*<YouDesktopHeader \/>\s*\{children\}/);
  const header = parts.slice(parts.indexOf('export function YouDesktopHeader'), parts.indexOf('export function SaveFooter'));
  for (const piece of ['<ProfileImageEditor', 'compact', '<VerificationPill', 'youHeaderLine(', '<AvailabilitySwitch', 'useAvailabilityToggle(']) {
    assert.ok(header.includes(piece), piece);
  }
  assert.match(header, /void reload\(\);\s*\}, \[pathname, reload\]\);/, 'la cabecera se refresca al cambiar de apartado');
  // Dentro del marco, cada apartado pinta sólo lo suyo, con una entrada corta.
  const frame = parts.slice(parts.indexOf('export function ProfileScreenFrame'), parts.indexOf('export function ProfileSectionLoading'));
  assert.match(frame, /if \(wide && shell\) \{\s*return \(\s*<SectionFade>/);
  assert.doesNotMatch(frame.slice(frame.indexOf('if (wide && shell)'), frame.indexOf('if (wide) {')), /YouDesktopHeader|TechnicianAccountNav|PageBody/);
  const fade = parts.slice(parts.indexOf('function SectionFade'), parts.indexOf('export function ProfileScreenFrame'));
  assert.match(fade, /duration: 180/);
  // Todos los apartados (y Documents) usan el marco; cargando, el hueco con el indicador.
  for (const rel of ['work', 'personal', 'location', 'contracts', 'links']) {
    assert.match(read(`app/technician/(you)/profile/${rel}.tsx`), /<ProfileScreenFrame/, rel);
  }
  const documents = read('app/technician/(you)/documents.tsx');
  assert.match(documents, /<ProfileScreenFrame/);
  assert.match(documents, /if \(loading && documents\.length === 0\) return <ProfileSectionLoading \/>;/);
  assert.match(parts, /if \(state\.loading && !state\.profile\) return <ProfileSectionLoading \/>;/);
});

test('You en escritorio — cambiar de apartado con cambios sin guardar pregunta antes, y descartar los quita', () => {
  const nav = read('src/components/technician/TechnicianAccount.tsx');
  assert.match(nav, /if \(key === active\) return;/, 'el apartado abierto no hace nada');
  assert.match(nav, /if \(beforeLeave && !\(await beforeLeave\(\)\)\) return;/);
  const parts = read('src/components/technician/ProfileParts.tsx');
  assert.match(parts, /title: 'Unsaved changes',[\s\S]{0,200}confirmLabel: 'Discard changes',/);
  assert.match(parts, /if \(discard\) current\.onDiscard\?\.\(\);/);
  // El apartado registra la pregunta en el layout y la quita al irse.
  assert.match(parts, /shell\.setBeforeLeave\(async \(\) => \{/);
  assert.match(parts, /return \(\) => shell\.setBeforeLeave\(null\);/);
  const guards: Record<string, string> = { work: 'discardChanges', personal: 'discard', location: 'discard', contracts: 'discard', links: 'discard' };
  for (const [rel, fn] of Object.entries(guards)) {
    const src = read(`app/technician/(you)/profile/${rel}.tsx`);
    assert.ok(src.includes(`unsaved={dirty}\n      onDiscard={${fn}}`), rel);
  }
  // Settings y Help (AccountShell) llevan el menú, pero no la tarjeta ni la disponibilidad.
  assert.doesNotMatch(read('src/components/AccountShell.tsx'), /YouDesktopHeader|AvailabilitySwitch/);
});

test('Personal details — la foto ya no se cambia aquí, sino tocando el avatar de You', () => {
  assert.doesNotMatch(read('app/technician/(you)/profile/personal.tsx'), /ProfileImageEditor/);
  assert.match(read('app/technician/(tabs)/profile.tsx'), /<ProfileImageEditor kind="technician"[\s\S]{0,140}compact/, 'You en móvil');
});

test('"+ Add" abre el "+" (fase 6B), y You sigue en /technician/profile', () => {
  assert.equal(TECHNICIAN_TAB_ROUTES.you, '/technician/profile');
  assert.equal(TECHNICIAN_ADD_ROUTE, '/technician/add');
});

test('Rutas — las cuatro raíces viven en (tabs) y nada más resuelve su URL', () => {
  const tech = path.join(ROOT, 'app', 'technician');
  const tabs = path.join(tech, '(tabs)');
  for (const file of ['_layout.tsx', 'index.tsx', 'offers.tsx', 'chats.tsx', 'profile.tsx']) {
    assert.ok(fs.existsSync(path.join(tabs, file)), `falta app/technician/(tabs)/${file}`);
  }
  for (const stale of ['index.tsx', 'profile.tsx', path.join('offers', 'index.tsx'), path.join('chats', 'index.tsx')]) {
    assert.ok(!fs.existsSync(path.join(tech, stale)), `app/technician/${stale} duplicaría la URL de una pestaña`);
  }
  // Las pantallas interiores siguen donde estaban: sus URLs no cambian.
  // Documents vive en el grupo (you) desde la fase 8: la URL es la misma.
  for (const inner of [path.join('offers', '[id].tsx'), path.join('chats', '[id].tsx'), 'map.tsx', path.join('(you)', 'documents.tsx')]) {
    assert.ok(fs.existsSync(path.join(tech, inner)), `falta app/technician/${inner}`);
  }
  assert.deepEqual(Object.values(TECHNICIAN_TAB_ROUTES), ['/technician', '/technician/offers', '/technician/chats', '/technician/profile']);
});

test('Barras — la inferior sólo la monta el grupo de pestañas (y no en escritorio); la superior, el layout', () => {
  const tabsLayout = read('app/technician/(tabs)/_layout.tsx');
  assert.match(tabsLayout, /tabBar=\{\(\) => \(wide \? null : <TechnicianTabBar \/>\)\}/);
  const rootLayout = read('app/technician/_layout.tsx');
  assert.match(rootLayout, /\{wide \? <TechnicianTopBar \/> : null\}/);
  assert.match(rootLayout, /initialRouteName: '\(tabs\)'/);
  // Ninguna pantalla interior pinta la barra inferior por su cuenta.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      if (rel === 'app/technician/(tabs)/_layout.tsx') continue;
      if (fs.readFileSync(full, 'utf8').includes('TechnicianTabBar')) offenders.push(rel);
    }
  };
  walk(path.join(ROOT, 'app', 'technician'));
  assert.deepEqual(offenders, []);
});

test('Barras — sin campana; Inbox y You en las dos, "+ Add" en las dos', () => {
  const bars = read('src/components/technician/TechnicianNavBars.tsx');
  assert.doesNotMatch(bars, /\bBell\b/);
  assert.match(bars, /label: 'Add'/);
  assert.match(bars, /searchLabel="Search offers"/);
  for (const label of ["'Home'", "'Offers'", "'Applications'", "'Direct offers'", "'Map'", "'Inbox'", "'You'"]) {
    assert.ok(bars.includes(label), label);
  }
  const home = read('app/technician/(tabs)/index.tsx');
  assert.doesNotMatch(home, /\bBell\b/);
});

test('Pantallas interiores — la flecha de atrás es useGoBack', () => {
  for (const rel of ['app/technician/offers/[id].tsx', 'app/technician/map.tsx']) {
    const src = read(rel);
    assert.match(src, /useGoBack\(\)/, rel);
    assert.doesNotMatch(src, /router\.back\(\)/, rel);
  }
});

// ── Account ────────────────────────────────────────────────────────────────

test('Account — Settings, Help y Log out al final de You', () => {
  const profile = read('app/technician/(tabs)/profile.tsx');
  // Fase 6A: You es un menú; Account va después de las filas del perfil.
  const rows = profile.indexOf('<HubRow');
  const account = profile.indexOf('<TechnicianAccountSection />');
  assert.ok(rows > 0 && account > rows, 'la sección Account va después de las filas del perfil');
  const section = read('src/components/technician/TechnicianAccount.tsx');
  assert.match(section, /label="Settings" onPress=\{\(\) => router\.push\('\/settings'/);
  assert.match(section, /label="Help" onPress=\{\(\) => router\.push\('\/support'/);
  assert.match(section, /label="Log out"[^>]*onPress=\{logout\}/);
});

test('Account — "Log out" hace lo mismo que "Sign out" en Settings: cerrar sesión y volver al inicio', () => {
  const account = read('src/components/company/CompanyAccount.tsx');
  const hook = account.slice(account.indexOf('export function useLogout'), account.indexOf('export const useCompanyLogout'));
  assert.match(hook, /await signOut\(\);\s*router\.replace\('\/'/);
  const settings = read('app/settings.tsx');
  assert.match(settings, /await signOut\(\);\s*router\.replace\('\/'/);
});

// ── Fixtures de matching (pocos, a mano; el scorer no se toca) ─────────────

const NOW = new Date('2026-10-08T00:00:00Z');
const STAMP = '2026-01-01T00:00:00.000Z';

function rating(over: Partial<AircraftTypeRatingCatalog> & Pick<AircraftTypeRatingCatalog, 'id'>): AircraftTypeRatingCatalog {
  return {
    manufacturer: 'Airbus',
    aircraftFamily: 'A318/A319/A320/A321',
    easaEndorsement: `EASA-${over.id}`,
    displayName: `Rating ${over.id}`,
    commercialAliases: [],
    aircraftCategory: 'commercial_airplane',
    productType: 'Aeroplane',
    priority: 50,
    isActive: true,
    ...over,
  };
}

const RATINGS = [
  rating({ id: 'a320-cfm56', engineFamily: 'CFM56', displayName: 'Airbus A320 family — CFM56', engineId: 'eng-cfm56-5b' }),
  rating({ id: 'a320-v2500', engineFamily: 'V2500', displayName: 'Airbus A320 family — V2500' }),
  rating({ id: 'b737ng', manufacturer: 'Boeing', aircraftFamily: '737NG', displayName: 'Boeing 737NG — CFM56-7B', engineId: 'eng-cfm56-7b' }),
];
const RATING_INDEX = buildAircraftRatingIndex(RATINGS);

function engine(over: Omit<EngineCatalog, 'isActive' | 'isGeneric'> & Partial<EngineCatalog>): EngineCatalog {
  return { isActive: true, isGeneric: false, ...over };
}
const ENGINE_INDEX = buildEngineIndex([
  engine({ id: 'eng-cfm56-7b', manufacturer: 'CFM International', family: 'CFM56', engineType: 'turbofan', displayName: 'CFM56-7B' }),
  engine({ id: 'eng-cfm56-5b', manufacturer: 'CFM International', family: 'CFM56', engineType: 'turbofan', displayName: 'CFM56-5B' }),
  engine({ id: 'eng-pt6c', manufacturer: 'Pratt & Whitney Canada', family: 'PT6C', engineType: 'turboshaft', displayName: 'PT6C-67C' }),
]);

function offer(id: string, over: Partial<OfferWithRequirements> = {}): OfferWithRequirements {
  const o = {
    id,
    companyId: 'company-1',
    title: `Offer ${id}`,
    description: 'Test',
    contractType: 'permanent',
    productType: 'Aeroplane',
    technicianType: 'mechanic',
    requiresCertification: true,
    licenseCode: 'B1.1',
    licenseAuthority: 'EASA',
    locationCountryCode: 'ES',
    locationCountry: 'Spain',
    locationCity: 'Madrid',
    minYearsExperience: 0,
    status: 'published',
    visible: true,
    createdAt: STAMP,
    updatedAt: STAMP,
    requiresAllAircraft: false,
    requiredHabilitations: [],
    acceptedAuthorities: [],
    offerKind: 'aircraft',
    onlyUnlicensed: false,
    ...over,
  } as OfferWithRequirements;
  const violations = offerShapeViolations(o);
  assert.deepEqual(violations, [], `fixture ${id} imposible`);
  return o;
}

const req = (aircraftTypeRatingId: string, notes?: string) => ({ offerId: 'x', aircraftTypeRatingId, notes, createdAt: STAMP });

const OFFERS: OfferWithRequirements[] = [
  offer('aircraft', { requiredHabilitations: [req('a320-cfm56')] }),
  offer('all-aircraft', { requiresAllAircraft: true, requiredHabilitations: [req('a320-cfm56'), req('b737ng')] }),
  offer('license-only'),
  offer('no-cert-aircraft', { requiresCertification: false, licenseCode: undefined, licenseAuthority: undefined, requiredHabilitations: [req('a320-cfm56')] }),
  offer('no-requirements', { requiresCertification: false, licenseCode: undefined, licenseAuthority: undefined }),
  offer('engine', {
    offerKind: 'engine', technicianType: 'engine_technician', requiredEngineId: 'eng-cfm56-7b',
    requiresCertification: false, licenseCode: undefined, licenseAuthority: undefined, requiredEngineNotes: 'Shop visits',
  }),
  offer('engine-licensed', { offerKind: 'engine', technicianType: 'engine_technician', requiredEngineId: 'eng-cfm56-7b' }),
  offer('faa', { licenseAuthority: 'FAA', licenseCode: 'A&P' as never, requiredHabilitations: [req('a320-cfm56')] }),
  offer('min-years', { minYearsExperience: 15, requiredHabilitations: [req('a320-cfm56')] }),
  offer('avionic', { technicianType: 'avionic', licenseCode: 'B2' as never }),
  offer('equivalent', { acceptedAuthorities: ['UK_CAA'], requiredHabilitations: [req('a320-cfm56')] }),
  offer('contract-short', { contractType: 'short_term', locationCountryCode: 'FR', locationCountry: 'France' }),
];

function lic(id: string, licenseCode: AuthorityLicenseCode, authority: AuthorityCode = 'EASA', over: Partial<TechnicianLicense> = {}): TechnicianLicense {
  return { id, technicianId: 't', licenseCode, authority, createdAt: STAMP, ...over };
}
function hab(license: TechnicianLicense, aircraftTypeRatingId: string): TechnicianHabilitation {
  return {
    id: `hab-${license.id}-${aircraftTypeRatingId}`,
    technicianId: 't',
    technicianLicenseId: license.id,
    licenseCode: license.licenseCode as LicenseCode,
    aircraftTypeRatingId,
    createdAt: STAMP,
  } as TechnicianHabilitation;
}

function tech(id: string, over: Partial<TechnicianWithRelations> = {}): TechnicianWithRelations {
  return {
    id: 't',
    userId: 'u',
    anonymousCode: `AVT-${id}`,
    firstName: 'Test',
    lastName: id,
    email: 'test@example.invalid',
    birthDate: '1990-01-01',
    technicianTypes: ['mechanic'],
    locationCountryCode: 'ES',
    availability: { immediately: true, contractTypes: ['permanent'] },
    verificationStatus: 'verified',
    yearsExperience: 10,
    createdAt: STAMP,
    updatedAt: STAMP,
    licenses: [],
    habilitations: [],
    aircraftExperience: [],
    engines: [],
    ...over,
  } as TechnicianWithRelations;
}

const easaB11 = lic('easa-b11', 'B1.1');
const ukB11 = lic('uk-b11', 'B1.1', 'UK_CAA');
const expiredB11 = lic('old-b11', 'B1.1', 'EASA', { expiresAt: '2020-01-01' });
const faaAP = lic('faa-ap', 'A&P', 'FAA');
const b2 = lic('easa-b2', 'B2');

const TECHS: TechnicianWithRelations[] = [
  tech('perfect', { licenses: [easaB11], habilitations: [hab(easaB11, 'a320-cfm56'), hab(easaB11, 'b737ng')] }),
  tech('no-licence', { verificationStatus: 'pending', locationCountryCode: 'PT', availability: { immediately: false, contractTypes: ['short_term'] } }),
  tech('licence-only', { licenses: [easaB11] }),
  tech('related-rating', { licenses: [easaB11], habilitations: [hab(easaB11, 'a320-v2500')] }),
  tech('engine-tech', {
    technicianTypes: ['engine_technician'],
    engines: [{ id: 'e1', technicianId: 't', engineId: 'eng-cfm56-7b', createdAt: STAMP }],
  }),
  tech('faa', { licenses: [faaAP], aircraftExperience: [{ id: 'x1', technicianId: 't', aircraftTypeRatingId: 'a320-cfm56', signed: true, createdAt: STAMP }] }),
  tech('uk', { licenses: [ukB11], habilitations: [hab(ukB11, 'a320-cfm56')] }),
  tech('expired', { licenses: [expiredB11], habilitations: [hab(expiredB11, 'a320-cfm56')], yearsExperience: 3 }),
  tech('avionic', { technicianTypes: ['avionic'], licenses: [b2], verificationStatus: 'pending' }),
];

const ALL_KEYS: BreakdownKey[] = ['verified', 'habilitation', 'license', 'engine', 'contractFit', 'location'];

/** Comprueba que la checklist de un par no contradice su %. Devuelve lo visto, para medir la cobertura. */
function assertChecklistAgrees(o: OfferWithRequirements, score: MatchScore, where: string) {
  const rows = offerChecklistRows(o, score, RATING_INDEX, ENGINE_INDEX);
  const specs = visibleBreakdownRows(o, CHECKLIST_ORDER);
  const notices = offerChecklistNotices(score);

  // 1. Los mismos criterios que dan puntos hoy, ni uno más ni uno menos.
  assert.deepEqual(rows.map((r) => r.key), specs.map((s) => s.key), where);
  assert.deepEqual(
    [...rows.map((r) => r.key)].sort(),
    [...visibleBreakdownRows(o).map((r) => r.key)].sort(),
    `${where}: las mismas filas que las barras de antes`,
  );
  // 2. Ningún punto escondido en un criterio que no sale.
  for (const key of ALL_KEYS) {
    if (!rows.some((r) => r.key === key)) assert.equal(score.breakdown[key], 0, `${where}: ${key} puntúa sin fila`);
  }
  // 3. El estado de cada fila son sus puntos.
  specs.forEach((spec, i) => {
    const value = score.breakdown[spec.key];
    assert.ok(value >= 0 && value <= spec.max, `${where}: ${spec.key} ${value}/${spec.max}`);
    const expected = value === spec.max ? 'full' : value > 0 ? 'partial' : 'none';
    assert.equal(rows[i].state, expected, `${where}: ${spec.key} ${value}/${spec.max}`);
  });
  // 4. El % nunca supera lo que suman las filas; si queda por debajo, hay
  //    nota de tope que lo explica, y si no, no la hay.
  const sum = specs.reduce((s, spec) => s + score.breakdown[spec.key], 0);
  const maxSum = specs.reduce((s, spec) => s + spec.max, 0);
  const capNote = notices.find((n) => n.kind === 'cap');
  assert.ok(score.total <= sum, `${where}: total ${score.total} > filas ${sum}`);
  assert.equal(Boolean(capNote), score.total < sum, `${where}: nota de tope (${score.total} vs ${sum})`);
  assert.equal(Boolean(capNote), scoreCapNote(score) !== null, where);
  // 5. Todo en verde ⇔ el % máximo de la oferta, salvo un tope explicado.
  const allFull = rows.every((r) => r.state === 'full');
  if (allFull && !capNote) assert.equal(score.total, maxSum, `${where}: todo en verde y el % no es el máximo`);
  if (score.total === maxSum) assert.ok(allFull, `${where}: % máximo con alguna fila sin todos sus puntos`);
  // 6. Un bloqueo va el primero, como antes.
  if (score.blockers.length > 0) assert.equal(notices[0].kind, 'blockers', where);
  // 7. Sin repetir la checklist: la lista de "Matches" no es un aviso.
  const kinds = ['blockers', 'cap', 'validity', 'authority', 'clarifications', 'missing'];
  assert.ok(notices.every((n) => kinds.includes(n.kind)), where);
  return { rows, capped: Boolean(capNote) };
}

// ── Checklist ──────────────────────────────────────────────────────────────

test('Checklist — estado de una fila: todos los puntos, parte o ninguno', () => {
  assert.equal(checklistState(45, 45), 'full');
  assert.equal(checklistState(44, 45), 'partial');
  assert.equal(checklistState(1, 45), 'partial');
  assert.equal(checklistState(0, 45), 'none');
});

test('Checklist — nunca contradice el % (cálculo real, todas las combinaciones de oferta y técnico)', () => {
  const seen = { full: 0, partial: 0, none: 0, capped: 0, blocked: 0, maxScore: 0 };
  for (const o of OFFERS) {
    for (const t of TECHS) {
      const score = calculateOfferTechnicianMatch(o, t, RATING_INDEX, NOW, ENGINE_INDEX);
      const { rows, capped } = assertChecklistAgrees(o, score, `${o.id} × ${t.anonymousCode}`);
      for (const r of rows) if (r.state !== 'unknown') seen[r.state]++;
      if (capped) seen.capped++;
      if (score.blockers.length > 0) seen.blocked++;
      if (score.total === visibleBreakdownRows(o).reduce((s, r) => s + r.max, 0)) seen.maxScore++;
    }
  }
  // Los fixtures tienen que recorrer cada rama, o el test sólo prueba la fácil.
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `ningún par cubre "${k}"`);
});

test('Checklist — con sólo licencia, sin aeronave ni motor: las filas que puntúan, en el orden de la maqueta', () => {
  const o = OFFERS.find((x) => x.id === 'license-only')!;
  const rows = offerChecklistRows(o, null, RATING_INDEX, ENGINE_INDEX);
  assert.deepEqual(rows.map((r) => r.label), ['Licence', 'Verification', 'Contract', 'Location']);
  assert.ok(rows.every((r) => r.state === 'unknown'), 'sin score no hay estado');
  assert.deepEqual(rows[0].values, ['EASA B1.1']);
  assert.deepEqual(rows[3].values, ['Madrid, Spain']);
});

test('Checklist — aeronaves: "All of these" / "Any one of these" sólo con varias; FAA la rotula como experiencia', () => {
  const all = offerChecklistRows(OFFERS.find((x) => x.id === 'all-aircraft')!, null, RATING_INDEX, ENGINE_INDEX);
  const aircraft = all.find((r) => r.key === 'habilitation')!;
  assert.equal(aircraft.label, 'Aircraft');
  assert.equal(aircraft.caption, 'All of these');
  assert.deepEqual(aircraft.values, ['Airbus A320 family — CFM56', 'Boeing 737NG — CFM56-7B']);
  const one = offerChecklistRows(OFFERS.find((x) => x.id === 'aircraft')!, null, RATING_INDEX, ENGINE_INDEX);
  assert.equal(one.find((r) => r.key === 'habilitation')!.caption, undefined);
  const faa = offerChecklistRows(OFFERS.find((x) => x.id === 'faa')!, null, RATING_INDEX, ENGINE_INDEX);
  assert.equal(faa.find((r) => r.key === 'habilitation')!.label, 'Aircraft experience');
});

test('Checklist — oferta de motor: fila Engine con su nota; sin licencia ni aeronave', () => {
  const rows = offerChecklistRows(OFFERS.find((x) => x.id === 'engine')!, null, RATING_INDEX, ENGINE_INDEX);
  assert.deepEqual(rows.map((r) => r.key), ['engine', 'verified', 'contractFit', 'location']);
  assert.match(rows[0].values[0], /CFM56-7B — Shop visits$/);
  const licensed = offerChecklistRows(OFFERS.find((x) => x.id === 'engine-licensed')!, null, RATING_INDEX, ENGINE_INDEX);
  assert.deepEqual(licensed.map((r) => r.key), ['license', 'engine', 'verified', 'contractFit', 'location']);
});

test('Checklist — los avisos de hoy, sin "Matches" ni la fila de nivel, en el orden de siempre', () => {
  const score: MatchScore = {
    offerId: 'o', technicianId: 't', total: 19, label: 'Weak match', level: 'related',
    breakdown: { verified: 15, habilitation: 20, license: 20, contractFit: 15, location: 5, engine: 0 },
    matches: ['Holds EASA B1.1'],
    clarifications: ['Profile type differs'],
    vigenciaNotices: [{ kind: 'expired', label: 'Expired', detail: 'EASA B1.1 expired in 2020' } as never],
    authorityEquivalence: 'UK CAA licence accepted as equivalent',
    missingRequirements: ['Boeing 737NG not present in the profile'],
    profileTypeMismatch: true,
    blockers: ['Requires 15 years of experience'],
  };
  const kinds = offerChecklistNotices(score).map((n) => n.kind);
  assert.deepEqual(kinds, ['blockers', 'cap', 'validity', 'authority', 'clarifications', 'missing']);
  const clean: MatchScore = { ...score, total: 75, clarifications: [], vigenciaNotices: [], authorityEquivalence: undefined, missingRequirements: [], profileTypeMismatch: false, blockers: [] };
  assert.deepEqual(offerChecklistNotices(clean), [], 'sin nada que avisar no hay avisos (los aciertos ya los dice la checklist)');
});

test('Checklist — el texto del tope es el de siempre (MatchExplanation lo comparte)', () => {
  const src = read('src/components/MatchExplanation.tsx');
  assert.match(src, /scoreCapNote\(score\)/);
  assert.doesNotMatch(src, /Score capped:/, 'el texto vive en un único sitio');
});

test('Página de oferta — sin barras de puntos; con la checklist, los avisos y "Apply" con su confirmación de retirada', () => {
  // Fase 5B: la checklist y sus avisos viven en un bloque común con el
  // detalle de la oferta directa (src/components/technician/OfferDetailParts.tsx).
  const parts = read('src/components/technician/OfferDetailParts.tsx');
  assert.match(parts, /What they ask vs\. your profile/);
  assert.match(parts, /<OfferChecklistNotices notices=\{offerChecklistNotices\(score\)\}/);
  for (const rel of ['app/technician/offers/[id].tsx', 'app/technician/direct-offers/[id].tsx']) {
    const src = read(rel);
    assert.doesNotMatch(src, /<BreakdownBars|<BreakdownRow|<MatchExplanation/, rel);
    assert.match(src, /<OfferChecklistSection offer=\{/, rel);
  }
  const page = read('app/technician/offers/[id].tsx');
  assert.match(page, /'Apply again' : 'Apply'/);
  assert.match(page, /title: 'Withdraw application\?'/);
  assert.match(page, /Review direct offer/);
});

// ── Home ───────────────────────────────────────────────────────────────────

function m(id: string, total: number, over: Partial<MatchScore> = {}): OfferMatchResult {
  return {
    offer: offer(id),
    score: {
      offerId: id, technicianId: 't', total, label: 'Strong match', level: 'exact',
      breakdown: { verified: 15, habilitation: 0, license: 65, contractFit: 15, location: 5, engine: 0 },
      matches: [], clarifications: [], vigenciaNotices: [], missingRequirements: [], profileTypeMismatch: false, blockers: [],
      ...over,
    },
  };
}

test('Home — "Best match": la mejor sin bloqueos ni relación previa, y sólo desde 40 (como "Your next opportunity")', () => {
  const matches = [m('blocked', 90, { blockers: ['x'] }), m('applied', 85), m('best', 70), m('b', 50), m('c', 30)];
  const s = summarizeTechnicianHome(matches, new Set(['applied']), 5);
  assert.equal(s.featured?.offer.id, 'best');
  assert.deepEqual(s.offersForYou.map((x) => x.offer.id), ['b', 'c'], 'sin la de la tarjeta, sin bloqueadas ni ya relacionadas');
  const low = summarizeTechnicianHome([m('low', MINIMUM_USEFUL_MATCH - 1)], new Set(), 5);
  assert.equal(low.featured, null);
  assert.equal(low.bestEligible?.offer.id, 'low', 'las pistas para mejorar salen de ella');
  assert.deepEqual(low.offersForYou.map((x) => x.offer.id), ['low']);
  assert.equal(summarizeTechnicianHome(matches, new Set(), 1).offersForYou.length, 1, 'respeta el límite');
});

test('Home — rótulo, motivos y pistas de la Home vieja', () => {
  assert.equal(bestMatchKicker(60), 'Best match for you');
  assert.equal(bestMatchKicker(59), 'Worth exploring');
  assert.deepEqual(opportunityReasons(m('x', 80, { matches: ['Verified profile'] })).slice(0, 3), [
    'Contract type fits your preferences', 'Same country as your profile', 'Verified profile',
  ]);
  assert.equal(profileImprovementHints(null).length, 2);
});

test('Home — los círculos (My work en vez de Documents), la tarjeta "You" de escritorio y "Offers for you"; desaparecen la tarjeta de perfil, los números y la lista de navegación', () => {
  const home = read('app/technician/(tabs)/index.tsx');
  for (const circle of ['label="Applications"', 'label="Direct offers"', 'label="Map"', 'label="My work"']) {
    assert.ok(home.includes(circle), circle);
  }
  assert.doesNotMatch(home, /label="Documents"/, 'el círculo de Documents pasó a ser My work');
  assert.match(home, /label="My work"[\s\S]{0,160}router\.push\(TECHNICIAN_PROFILE_ROUTES\.work/);
  // Escritorio: la tarjeta "You" lleva My work y Documents.
  const panel = home.slice(home.indexOf('function YouPanel('), home.indexOf('const styles = '));
  assert.deepEqual([...panel.matchAll(/styles\.panelButtonText\}>([^<]+)</g)].map((m) => m[1]), ['My work', 'Documents']);
  assert.match(home, /onOpenWork=\{\(\) => router\.push\(TECHNICIAN_PROFILE_ROUTES\.work/);
  assert.match(home, /onOpenDocuments=\{\(\) => router\.push\(TECHNICIAN_DOCUMENTS_ROUTE/);
  // Sin el círculo, Documents sigue en You y en el asistente de licencia (el
  // "+" lo comprueba test:technician-add).
  assert.match(read('app/technician/(tabs)/profile.tsx'), /title: 'Documents',[\s\S]{0,160}onPress: go\(TECHNICIAN_DOCUMENTS_ROUTE\)/);
  assert.match(read('app/technician/add/licence.tsx'), /router\.push\(technicianDocumentsUploadHref\('license'\)/);
  // Applications cuenta las respuestas sin ver (fase 8; lo prueba test:application-badge).
  assert.match(home, /badge=\{unseenApplicationResponses\}/);
  assert.match(home, /Offers for you/);
  for (const gone of ['Operations overview', 'MetricTile', 'ActionPanel', 'SupabaseProfileCard', "from '../../../src/lib/supabase'"]) {
    assert.ok(!home.includes(gone), gone);
  }
});

// ── Offers ─────────────────────────────────────────────────────────────────

test('Offers — filtros de hoy: uno por grupo, tocar el elegido vuelve a "todos"', () => {
  assert.deepEqual(OFFER_QUICK_CHIPS.map((c) => c.label), ['Airplanes', 'Helicopters', 'Permanent', 'Long-term', 'Short-term']);
  const airplanes = OFFER_QUICK_CHIPS[0];
  const helicopters = OFFER_QUICK_CHIPS[1];
  let f = toggleQuickChip(EMPTY_OFFER_LIST_FILTERS, airplanes);
  assert.equal(f.product, 'Aeroplane');
  assert.ok(isQuickChipSelected(f, airplanes));
  f = toggleQuickChip(f, helicopters);
  assert.equal(f.product, 'Helicopter', 'dentro del grupo se elige uno');
  f = toggleQuickChip(f, helicopters);
  assert.equal(f.product, 'all');
  f = toggleQuickChip(f, OFFER_QUICK_CHIPS[4]);
  assert.equal(f.contract, 'short_term');
  assert.equal(f.product, 'all', 'los grupos no se pisan');
});

test('Offers — el mismo filtro y el mismo orden que antes', () => {
  const base = offer('a', { locationBaseAirport: 'LEMD' });
  assert.ok(offerMatchesListFilters(base, { ...EMPTY_OFFER_LIST_FILTERS, text: 'lemd' }), 'el texto busca también el aeropuerto base');
  assert.ok(offerMatchesListFilters(base, { ...EMPTY_OFFER_LIST_FILTERS, text: ' madrid ' }));
  assert.ok(!offerMatchesListFilters(base, { ...EMPTY_OFFER_LIST_FILTERS, contract: 'short_term' }));
  assert.ok(!offerMatchesListFilters(base, { ...EMPTY_OFFER_LIST_FILTERS, product: 'Helicopter' }));
  const sorted = filterAndSortOffers([m('low', 40), m('high', 90), m('unread', 10)], EMPTY_OFFER_LIST_FILTERS, (id) => id === 'unread');
  assert.deepEqual(sorted.map((x) => x.offer.id), ['unread', 'high', 'low']);
  const screen = read('app/technician/(tabs)/offers.tsx');
  assert.doesNotMatch(screen, /'My licences'|>My licences</);
});

test('Offers — textos de estado de la candidatura, los de antes', () => {
  assert.equal(technicianApplicationLook('pending', 'card').label, 'Applied - pending');
  assert.equal(technicianApplicationLook('pending', 'detail').label, 'Application sent - pending review');
  assert.equal(technicianApplicationLook('rejected', 'card').label, 'Not selected');
  assert.equal(technicianApplicationLook('expired', 'card').label, 'Offer expired');
  assert.equal(technicianDirectOfferLook('pending').label, 'Direct offer received - pending response');
  assert.equal(offerCardFacts(offer('f', { minYearsExperience: 3, contractType: 'long_term' })), 'Long-term · Airplanes · 3+ yrs');
});

test('Mapa — se queda como estaba; sólo se añade "List", que vuelve a Offers', () => {
  const screen = read('app/technician/map.tsx');
  assert.match(screen, /onShowList=\{\(\) => router\.dismissTo\('\/technician\/offers'/);
  const controls = read('src/components/offer-map/OfferMapControls.tsx');
  assert.match(controls, /accessibilityLabel="Show as list"/);
  for (const impl of ['src/components/OfferMap.native.tsx', 'src/components/OfferMapLeafletImpl.tsx']) {
    assert.match(read(impl), /onShowList=\{onShowList\}/, impl);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
