// Standalone tests — sin Supabase y sin navegador. Cubren la navegación de
// empresa del rediseño (docs/UI_REDESIGN.md, fase 2):
//   - qué pestaña y qué sección se marcan para cada URL, y
//   - que las cuatro pantallas raíz viven en el grupo (tabs) sin que ninguna
//     otra ruta resuelva la misma URL (el grupo no cambia URLs; un fichero
//     olvidado en su sitio viejo daría dos rutas para la misma dirección).
//
// Run via: npm run test:company-nav
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  COMPANY_TAB_ROUTES,
  accountPageForPath,
  companySearchActiveForPath,
  companySectionForPath,
  companyTabForPath,
  companyTopActionForPath,
  isProfileOpenedFromChat,
  technicianProfileHref,
} from '../src/utils/companyNavigation';
import { applicantsLabel, offerMetaLine, offerTile, relativeTime, summarizeCompanyHome } from '../src/utils/companyHome';
import { cardGridItemWidth } from '../src/utils/cardGrid';
import {
  applicationStatusLook,
  directOfferActivity,
  directOfferStatusLook,
  isFinishedRelation,
  matchesOfferListFilter,
  matchesRelationFilter,
  offerListFilterCounts,
  offerRelationLook,
  offerStatusLook,
  relationFilterCounts,
  teamSummaryLine,
} from '../src/utils/companyStatus';
import { v2OfferRequestToMatchRequest } from '../src/utils/v2CompatAdapters';
import type { OfferRequestStatus, OfferStatus } from '../src/types/enums';
import type { OfferRequest } from '../src/types/offerRequest';
import type { Offer } from '../src/types/offer';
import type { OfferApplication } from '../src/types/offerRequest';

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

test('Pestañas — sólo las cuatro raíces marcan pestaña', () => {
  assert.equal(companyTabForPath('/company'), 'home');
  assert.equal(companyTabForPath('/company/'), 'home');
  assert.equal(companyTabForPath('/company/search'), 'search');
  assert.equal(companyTabForPath('/company/search?offerId=abc'), 'search');
  assert.equal(companyTabForPath('/company/chats'), 'inbox');
  assert.equal(companyTabForPath('/company/profile'), 'you');
});

test('Pestañas — una pantalla interior no es raíz (ahí no hay barra inferior)', () => {
  for (const p of ['/company/chats/123', '/company/applications', '/company/offers/new', '/company/map', '/company/team', '/company/technician/9']) {
    assert.equal(companyTabForPath(p), null, p);
  }
});

test('Secciones — las interiores cuelgan de su sección', () => {
  assert.equal(companySectionForPath('/company'), 'home');
  assert.equal(companySectionForPath('/company/applications'), 'applications');
  assert.equal(companySectionForPath('/company/applications/42'), 'applications');
  assert.equal(companySectionForPath('/company/direct-offers/7'), 'direct');
  assert.equal(companySectionForPath('/company/offers'), 'offers');
  assert.equal(companySectionForPath('/company/offers/edit?id=1'), 'offers');
  assert.equal(companySectionForPath('/company/map'), 'map');
  assert.equal(companySectionForPath('/company/team'), 'team');
});

test('Secciones — search, inbox, you y el perfil de un técnico no son sección', () => {
  for (const p of ['/company/search', '/company/chats', '/company/chats/1', '/company/profile', '/company/technician/3', '/company/requests']) {
    assert.equal(companySectionForPath(p), null, p);
  }
  assert.equal(companySectionForPath('/company/offersx'), null, 'un prefijo no basta: hace falta la barra');
});

test('Barra superior — Inbox incluye las conversaciones; You, su pantalla y lo que cuelga de ella', () => {
  assert.equal(companyTopActionForPath('/company/chats'), 'inbox');
  assert.equal(companyTopActionForPath('/company/chats/abc'), 'inbox');
  assert.equal(companyTopActionForPath('/company/profile'), 'you');
  assert.equal(companyTopActionForPath('/company/profile/edit'), 'you');
  assert.equal(companyTopActionForPath('/company/profiles'), null, 'un prefijo no basta: hace falta la barra');
  assert.equal(companyTopActionForPath('/company'), null);
});

test('Barra superior — el botón de búsqueda se marca en la búsqueda y en nada más (fase 8)', () => {
  assert.equal(companySearchActiveForPath('/company/search'), true);
  assert.equal(companySearchActiveForPath('/company/search?offerId=abc'), true);
  assert.equal(companySearchActiveForPath('/company/search/'), true);
  // El mapa es su sección; el perfil de un técnico se queda sin marca (se llega desde muchos sitios).
  for (const p of ['/company/map', '/company/technician/3', '/company', '/company/searchx']) {
    assert.equal(companySearchActiveForPath(p), false, p);
  }
  const bars = fs.readFileSync(path.join(process.cwd(), 'src/components/company/CompanyNavBars.tsx'), 'utf8');
  assert.match(bars, /searchActive=\{companySearchActiveForPath\(pathname\)\}/);
});

test('Settings, Help, borrar la cuenta y textos legales — en escritorio cuelgan de You y marcan su fila (fase 8, B)', () => {
  assert.equal(accountPageForPath('/settings'), 'settings');
  assert.equal(accountPageForPath('/account/delete'), 'settings');
  assert.equal(accountPageForPath('/privacy-policy'), 'settings');
  assert.equal(accountPageForPath('/terms-of-service'), 'settings');
  assert.equal(accountPageForPath('/support'), 'help');
  assert.equal(accountPageForPath('/delete-account?x=1'), 'help');
  for (const p of ['/', '/settingsx', '/company/profile', '/privacy-policyx']) {
    assert.equal(accountPageForPath(p), null, p);
  }
  for (const p of ['/settings', '/support', '/account/delete', '/delete-account', '/privacy-policy', '/terms-of-service']) {
    assert.equal(companyTopActionForPath(p), 'you', p);
  }
  // Las pantallas pintan el marco con la sesión de empresa o técnico, y su contenido de siempre.
  const pages = [
    ['app/settings.tsx', 'settings'],
    ['app/support.tsx', 'help'],
    ['app/account/delete.tsx', 'settings'],
    ['app/delete-account.tsx', 'help'],
    ['app/privacy-policy.tsx', 'settings'],
    ['app/terms-of-service.tsx', 'settings'],
  ] as const;
  for (const [rel, active] of pages) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    assert.ok(src.includes('const shellRole = useAccountShellRole();'), rel);
    assert.match(src, new RegExp(String.raw`<AccountShell[\s\S]{0,40}role=\{shellRole\}[\s\S]{0,20}active="` + active + '"'), rel);
  }
  const shell = fs.readFileSync(path.join(process.cwd(), 'src/components/AccountShell.tsx'), 'utf8');
  assert.ok(
    shell.includes("if (!wide || !profile || profile.status !== 'active' || sessionLoading) return null;"),
    'sólo escritorio y sesión activa',
  );
});

test('Rejillas de escritorio — todas las tarjetas del mismo ancho, también las de la última fila (fase 8)', () => {
  assert.equal(cardGridItemWidth(0, 230, 16), null, 'sin medir no hay ancho');
  assert.equal(cardGridItemWidth(628, 230, 16), 306, 'dos columnas');
  assert.equal(cardGridItemWidth(844, 230, 16), 270, 'tres columnas');
  assert.equal(cardGridItemWidth(200, 230, 16), 200, 'más estrecho que el mínimo: una columna con todo el ancho');
  for (let width = 230; width <= 1300; width += 7) {
    const item = cardGridItemWidth(width, 230, 16)!;
    const columns = Math.floor((width + 16) / (230 + 16));
    assert.ok(item >= 230, `${width}: ${item} por debajo del mínimo`);
    assert.ok(columns * item + (columns - 1) * 16 <= width, `${width}: la fila se sale`);
  }
  for (const rel of ['app/company/(tabs)/index.tsx', 'app/company/offers/index.tsx', 'app/technician/(tabs)/index.tsx']) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    assert.match(src, /const grid = useCardGrid\(/, rel);
    assert.match(src, /onLayout=\{grid\.onLayout\}/, rel);
    assert.match(src, /grid\.itemStyle/, rel);
  }
});

test('Marcos de avatar — sólo con iniciales: los cuatro sitios con recuadro o franja usan AvatarFrame con la misma fuente que su Avatar (fase 8, H)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const home = read('app/company/(tabs)/index.tsx');
  assert.match(home, /<AvatarFrame\s+image=\{name \? \{ photoPath: companyTechnicianPhoto\(technician \?\? null\), anonymous: !unlocked \} : \{\}\}\s+style=\{\[styles\.pendingIcon/);
  const search = read('app/company/(tabs)/search.tsx');
  assert.match(search, /<AvatarFrame\s+image=\{\{ photoPath: unlocked \? technician\.photoPath : null, anonymous: !unlocked \}\}\s+style=\{\[styles\.cardTop/);
  assert.match(read('src/components/technician/OfferCards.tsx'), /<AvatarFrame image=\{\{ logoPath \}\} style=\{styles\.cardTop\}>/);
  assert.match(read('app/technician/offers/[id].tsx'), /<AvatarFrame image=\{\{ logoPath: company\?\.logoPath \}\} style=\{styles\.hero\}>/);
});

test('Rutas — editar la empresa es una pantalla aparte, no una segunda /company/profile', () => {
  const company = path.join(process.cwd(), 'app', 'company');
  assert.ok(fs.existsSync(path.join(company, 'profile', 'edit.tsx')), 'falta app/company/profile/edit.tsx');
  for (const clash of ['index.tsx', '_layout.tsx']) {
    assert.ok(!fs.existsSync(path.join(company, 'profile', clash)), `app/company/profile/${clash} competiría con la pestaña You`);
  }
  assert.equal(companySectionForPath('/company/profile/edit'), null);
  assert.equal(companyTabForPath('/company/profile/edit'), null, 'una pantalla interior no lleva barra inferior');
});

test('Rutas — las cuatro raíces viven en (tabs) y nada más resuelve su URL', () => {
  const company = path.join(process.cwd(), 'app', 'company');
  const tabs = path.join(company, '(tabs)');
  for (const file of ['_layout.tsx', 'index.tsx', 'search.tsx', 'chats.tsx', 'profile.tsx']) {
    assert.ok(fs.existsSync(path.join(tabs, file)), `falta app/company/(tabs)/${file}`);
  }
  for (const stale of ['index.tsx', 'search.tsx', 'profile.tsx', path.join('chats', 'index.tsx')]) {
    assert.ok(!fs.existsSync(path.join(company, stale)), `app/company/${stale} duplicaría la URL de una pestaña`);
  }
  assert.deepEqual(Object.values(COMPANY_TAB_ROUTES), ['/company', '/company/search', '/company/chats', '/company/profile']);
});

test('Perfil desde un chat — se marca y se reconoce; desde otro sitio, no', () => {
  assert.equal(technicianProfileHref('t-1'), '/company/technician/t-1');
  assert.equal(technicianProfileHref('t-1', { fromChat: true }), '/company/technician/t-1?from=chat');
  assert.equal(isProfileOpenedFromChat('chat'), true);
  assert.equal(isProfileOpenedFromChat(['chat']), true, 'expo-router puede dar el parámetro como lista');
  for (const other of [undefined, '', 'applications', 'map']) {
    assert.equal(isProfileOpenedFromChat(other), false, String(other));
  }
});

test('Perfil desde un chat — sigue siendo la misma pantalla para la navegación', () => {
  const href = technicianProfileHref('t-1', { fromChat: true });
  assert.equal(companySectionForPath(href), null, 'el perfil de un técnico no es sección');
  assert.equal(companyTabForPath(href), null, 'ni raíz de pestaña: no lleva barra inferior');
});

// ── Home ─────────────────────────────────────────────────────────────────

const offer = (id: string, over: Partial<Offer> = {}): Offer => ({
  id,
  companyId: 'c',
  title: `Offer ${id}`,
  status: 'published',
  createdAt: '2026-10-01T10:00:00Z',
  technicianType: 'mechanic',
  offerKind: 'aircraft',
  contractType: 'permanent',
  locationCity: 'Madrid',
  locationCountry: 'Spain',
  ...over,
} as Offer);

const app = (id: string, offerId: string, status: OfferApplication['status'], createdAt: string): OfferApplication => ({
  id, offerId, status, createdAt, technicianId: 't', companyId: 'c',
} as OfferApplication);

test('Home — sólo ofertas publicadas, las más nuevas primero', () => {
  const { offers } = summarizeCompanyHome(
    [
      offer('old', { createdAt: '2026-09-01T00:00:00Z' }),
      offer('draft', { status: 'draft' }),
      offer('new', { createdAt: '2026-10-05T00:00:00Z' }),
      offer('closed', { status: 'closed' }),
    ],
    [],
  );
  assert.deepEqual(offers.map((o) => o.offer.id), ['new', 'old']);
});

test('Home — "new" es pendiente; una retirada no cuenta como candidato', () => {
  const { offers, pending } = summarizeCompanyHome(
    [offer('a'), offer('b')],
    [
      app('1', 'a', 'pending', '2026-10-02T00:00:00Z'),
      app('2', 'a', 'accepted', '2026-10-01T00:00:00Z'),
      app('3', 'a', 'withdrawn', '2026-10-01T00:00:00Z'),
      app('4', 'b', 'pending', '2026-10-04T00:00:00Z'),
      app('5', 'b', 'rejected', '2026-10-01T00:00:00Z'),
    ],
  );
  const a = offers.find((o) => o.offer.id === 'a')!;
  const b = offers.find((o) => o.offer.id === 'b')!;
  assert.deepEqual([a.pending, a.applicants], [1, 2]);
  assert.deepEqual([b.pending, b.applicants], [1, 2]);
  assert.equal(pending.count, 2);
  assert.equal(pending.latest?.application.id, '4', 'la tarjeta lleva a la pendiente más reciente');
  assert.equal(pending.latest?.offerTitle, 'Offer b');
});

test('Home — sin pendientes no hay tarjeta que enseñar', () => {
  const { pending } = summarizeCompanyHome([offer('a')], [app('1', 'a', 'accepted', '2026-10-02T00:00:00Z')]);
  assert.deepEqual(pending, { count: 0, latest: null });
});

test('Home — el cuadrado nunca pinta una licencia que la oferta no pide', () => {
  assert.equal(offerTile(offer('x', { licenseCode: 'B1.1' } as Partial<Offer>)).code, 'B1.1');
  assert.equal(offerTile(offer('x')).code, 'MEC', 'mecánico sin licencia');
  assert.equal(offerTile(offer('x', { technicianType: 'avionic' })).code, 'AV');
  assert.equal(offerTile(offer('x', { technicianType: 'painter' })).code, 'PT');
  assert.equal(
    offerTile(offer('x', { technicianType: 'engine_technician', offerKind: 'engine', licenseCode: 'B1.1' } as Partial<Offer>)).code,
    'ENG',
    'una oferta de motor dice ENG aunque pida licencia',
  );
});

test('Home — meta, candidatos y tiempo relativo', () => {
  assert.equal(offerMetaLine(offer('x')), 'Permanent · Madrid, Spain');
  assert.equal(offerMetaLine(offer('x', { locationCity: '', locationCountry: '' })), 'Permanent');
  assert.equal(applicantsLabel(0), 'No applicants yet');
  assert.equal(applicantsLabel(1), '1 applicant');
  assert.equal(applicantsLabel(3), '3 applicants');
  const now = new Date('2026-10-06T12:00:00Z');
  assert.equal(relativeTime('2026-10-06T11:59:40Z', now), 'just now');
  assert.equal(relativeTime('2026-10-06T11:15:00Z', now), '45 min ago');
  assert.equal(relativeTime('2026-10-06T10:00:00Z', now), '2h ago');
  assert.equal(relativeTime('2026-10-05T10:00:00Z', now), 'yesterday');
  assert.equal(relativeTime('2026-10-02T10:00:00Z', now), '4 days ago');
});

// ── Pantallas de la fase 3: estados y filtros ───────────────────────────

const RELATION_STATUSES: OfferRequestStatus[] = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired'];

test('Estados — candidatura: "Needs review" en la lista, "Pending review" en su página', () => {
  assert.deepEqual(applicationStatusLook('pending'), { label: 'Needs review', tone: 'warning' });
  assert.equal(applicationStatusLook('pending', 'detail').label, 'Pending review');
  assert.equal(applicationStatusLook('accepted').tone, 'success');
  for (const s of ['rejected', 'withdrawn', 'expired'] as const) {
    assert.equal(applicationStatusLook(s).tone, 'closed', s);
    assert.ok(isFinishedRelation(s), s);
  }
  assert.ok(!isFinishedRelation('pending') && !isFinishedRelation('accepted'));
});

test('Estados — oferta directa: el rechazo del técnico se dice "Declined"', () => {
  assert.equal(directOfferStatusLook('pending').label, 'Awaiting response');
  assert.equal(directOfferStatusLook('rejected').label, 'Declined');
  assert.equal(directOfferStatusLook('withdrawn').label, 'Withdrawn');
  assert.equal(directOfferStatusLook('expired').label, 'Expired');
});

test('Estados — etiqueta de un técnico en la lista de una oferta: los textos de siempre', () => {
  assert.equal(offerRelationLook('application', 'pending').label, 'Application pending');
  assert.equal(offerRelationLook('direct_offer', 'accepted').label, 'Direct offer accepted');
  assert.equal(offerRelationLook('direct_offer', 'pending').tone, 'waiting');
  assert.equal(offerRelationLook('application', 'pending').tone, 'warning');
  assert.equal(offerRelationLook('application', 'withdrawn').tone, 'closed');
});

test('Filtros — All/Pending/Accepted/Rejected: retiradas y caducadas sólo en All', () => {
  const counts = relationFilterCounts(['pending', 'pending', 'accepted', 'rejected', 'withdrawn', 'expired']);
  assert.deepEqual(counts, { all: 6, pending: 2, accepted: 1, rejected: 1 });
  for (const s of RELATION_STATUSES) assert.ok(matchesRelationFilter(s, 'all'), s);
  assert.ok(!matchesRelationFilter('withdrawn', 'rejected'));
  assert.ok(!matchesRelationFilter('expired', 'pending'));
});

test('Filtros — ofertas: "Closed" reúne cerradas, caducadas y archivadas', () => {
  const statuses: OfferStatus[] = ['published', 'draft', 'closed', 'expired', 'archived', 'published'];
  assert.deepEqual(offerListFilterCounts(statuses), { all: 6, published: 2, draft: 1, closed: 3 });
  assert.ok(matchesOfferListFilter('expired', 'closed'));
  assert.ok(!matchesOfferListFilter('draft', 'published'));
  assert.equal(offerStatusLook('expired').tone, 'error');
  assert.equal(offerStatusLook('draft').label, 'Draft');
});

test('You — la actividad da los mismos números que la versión V1 de antes', () => {
  const statuses: OfferRequestStatus[] = ['pending', 'accepted', 'accepted', 'rejected', 'withdrawn', 'expired', 'pending'];
  const v1 = statuses.map((status, i) => v2OfferRequestToMatchRequest({ id: String(i), status } as OfferRequest));
  assert.deepEqual(directOfferActivity(statuses), {
    sent: v1.length,
    accepted: v1.filter((r) => r.status === 'accepted').length,
    awaiting: v1.filter((r) => r.status === 'sent').length,
  });
  assert.deepEqual(directOfferActivity([]), { sent: 0, accepted: 0, awaiting: 0 });
});

test('You — resumen del equipo', () => {
  assert.equal(teamSummaryLine(['admin', 'recruiter']), '2 members · 1 admin, 1 recruiter');
  assert.equal(teamSummaryLine(['admin']), '1 member · 1 admin');
  assert.equal(teamSummaryLine(['admin', 'viewer', 'viewer']), '3 members · 1 admin, 2 viewers');
  assert.equal(teamSummaryLine([]), '0 members');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
