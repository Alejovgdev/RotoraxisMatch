// Standalone tests — sin Supabase y sin navegador. Cubren el rediseño del
// técnico, fase 5B (docs/UI_REDESIGN.md, sección 8):
//   - ofertas directas recibidas: estados y orden de antes, cuándo se puede
//     aceptar o rechazar, y que aceptar/rechazar pasa SIEMPRE por la
//     confirmación de antes (respuesta 15);
//   - candidaturas: estados, orden y los filtros que ya existían;
//   - el aviso de identidad: la regla es la de la base (offer_accepted_between),
//     y los textos cambian sólo cuando esa empresa ya ve la identidad;
//   - Inbox y chat: el patrón de empresa, sin conversación abierta al entrar en
//     escritorio, y ?from=chat para que no haya bucle;
//   - el número de ofertas directas pendientes en la Home y en escritorio.
//
// Run via: npm run test:technician-relations
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TECHNICIAN_APPLICATION_FILTERS,
  applicationFilterCounts,
  applicationOfferStatusLook,
  canRespondToDirectOffer,
  isDirectOfferBlockedByClosedOffer,
  isFinishedStatus,
  matchesApplicationFilter,
  sortApplications,
  sortDirectOffers,
  technicianApplicationListLook,
  technicianDirectOfferStatusLook,
  technicianMessagePreview,
} from '../src/utils/technicianRelations';
import {
  IDENTITY_ALREADY_VISIBLE,
  applySheetNote,
  companyCanSeeIdentity,
  declinedNote,
  directOfferConfirm,
  offerPrivacyText,
} from '../src/utils/technicianPrivacy';
import { canRevealIdentity } from '../src/utils/privacyV2';
import {
  chatContextHref,
  isOpenedFromChat,
  technicianDirectOfferHref,
  technicianOfferHref,
  technicianSectionForPath,
  technicianTabForPath,
} from '../src/utils/technicianNavigation';
import type { OfferRequestStatus } from '../src/types/enums';
import type { OfferApplication, OfferRequest } from '../src/types/offerRequest';

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
const STATUSES: OfferRequestStatus[] = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired'];

/** El cuerpo de una función del fichero, para comprobar el orden de sus pasos. */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `no encuentro ${signature}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`cuerpo sin cerrar: ${signature}`);
}

// ── Ofertas directas ───────────────────────────────────────────────────────

test('Ofertas directas — los estados de antes', () => {
  assert.deepEqual(STATUSES.map((s) => technicianDirectOfferStatusLook(s).label), ['Pending', 'Accepted', 'Declined', 'Withdrawn', 'Expired']);
  assert.equal(technicianDirectOfferStatusLook('pending').tone, 'warning');
  assert.equal(technicianDirectOfferStatusLook('accepted').tone, 'success');
  for (const s of ['rejected', 'withdrawn', 'expired'] as const) {
    assert.equal(technicianDirectOfferStatusLook(s).tone, 'closed', s);
    assert.ok(isFinishedStatus(s), s);
  }
});

test('Ofertas directas — el orden de antes: sin leer, estado y lo más nuevo', () => {
  const e = (id: string, status: OfferRequestStatus, createdAt: string) => ({ request: { id, status, createdAt } });
  const sorted = sortDirectOffers([
    e('old-pending', 'pending', '2026-01-01'),
    e('accepted', 'accepted', '2026-05-01'),
    e('new-pending', 'pending', '2026-03-01'),
    e('unread-declined', 'rejected', '2026-02-01'),
    e('expired', 'expired', '2026-06-01'),
  ], (id) => id === 'unread-declined');
  assert.deepEqual(sorted.map((x) => x.request.id), ['unread-declined', 'new-pending', 'old-pending', 'accepted', 'expired']);
});

test('Ofertas directas — se responde sólo a una pendiente cuya oferta sigue abierta', () => {
  assert.equal(canRespondToDirectOffer({ status: 'pending', offerId: 'o' }, true), true);
  assert.equal(canRespondToDirectOffer({ status: 'pending', offerId: 'o' }, false), false, 'oferta cerrada: "Offer closed"');
  assert.equal(canRespondToDirectOffer({ status: 'pending', offerId: null }, false), true, 'sin oferta ligada, como antes');
  for (const s of ['accepted', 'rejected', 'withdrawn', 'expired'] as const) {
    assert.equal(canRespondToDirectOffer({ status: s, offerId: 'o' }, true), false, s);
  }
  assert.equal(isDirectOfferBlockedByClosedOffer({ status: 'pending', offerId: 'o' }, false), true);
  assert.equal(isDirectOfferBlockedByClosedOffer({ status: 'accepted', offerId: 'o' }, false), false, 'una aceptada no depende de la oferta');
});

test('Ofertas directas — confirmaciones de antes: aceptar avisa de que revela la identidad', () => {
  const accept = directOfferConfirm('accept', false);
  assert.deepEqual(accept, {
    title: 'Accept direct offer?',
    message: 'This will unlock your identity and admin-verified documents for the company and open a chat.',
    confirmLabel: 'Confirm accept',
  });
  const reject = directOfferConfirm('reject', false);
  assert.deepEqual(reject, {
    title: 'Reject direct offer?',
    message: 'The company will be notified. Your identity and documents will remain locked.',
    confirmLabel: 'Confirm reject',
    destructive: true,
  });
});

test('Ofertas directas — aceptar y rechazar SIEMPRE pasan por la confirmación, en la lista y en el detalle', () => {
  for (const rel of ['app/technician/direct-offers/index.tsx', 'app/technician/direct-offers/[id].tsx']) {
    const src = read(rel);
    const body = functionBody(src, 'async function respond(');
    const confirmAt = body.indexOf('await confirm(directOfferConfirm(action');
    const guardAt = body.indexOf('if (!confirmed) return;');
    const writeAt = body.indexOf('offerRequestRepository.updateStatus(');
    assert.ok(confirmAt > 0 && guardAt > confirmAt && writeAt > guardAt, `${rel}: confirmar antes de escribir`);
    // Ningún otro sitio del fichero cambia el estado.
    assert.equal(src.split('offerRequestRepository.updateStatus(').length - 1, 1, `${rel}: un único updateStatus`);
    assert.doesNotMatch(src, /confirmAction/, `${rel}: el diálogo del rediseño, no el del navegador`);
    assert.match(src, /\{dialog\}/, `${rel}: el diálogo se monta`);
    // Los botones llaman a respond, nunca a la escritura directamente.
    assert.match(src, /respond\((entry, )?'accept'\)/, rel);
    assert.match(src, /respond\((entry, )?'reject'\)/, rel);
  }
});

test('Ofertas directas — al aceptar, "Open chat" como antes (salvo si se llegó desde el chat)', () => {
  const detail = read('app/technician/direct-offers/[id].tsx');
  assert.match(detail, /isAccepted && chatRoom && !fromChat/);
  assert.match(detail, /The company can now see your full identity and admin-verified documents\. A chat room is available for direct communication\./);
  const list = read('app/technician/direct-offers/index.tsx');
  assert.match(list, /request\.status === 'accepted' && onOpenChat/);
});

// ── Candidaturas ───────────────────────────────────────────────────────────

test('Candidaturas — los filtros que ya existían: All, Pending, Accepted y Closed', () => {
  assert.deepEqual([...TECHNICIAN_APPLICATION_FILTERS], ['all', 'pending', 'accepted', 'closed']);
  const pick = (filter: Parameters<typeof matchesApplicationFilter>[1]) => STATUSES.filter((s) => matchesApplicationFilter(s, filter));
  assert.deepEqual(pick('all'), STATUSES);
  assert.deepEqual(pick('pending'), ['pending']);
  assert.deepEqual(pick('accepted'), ['accepted']);
  assert.deepEqual(pick('closed'), ['rejected', 'withdrawn', 'expired'], 'Closed = rechazada, retirada o caducada, como antes');
  assert.deepEqual(applicationFilterCounts(['pending', 'pending', 'accepted', 'withdrawn']), { all: 4, pending: 2, accepted: 1, closed: 1 });
});

test('Candidaturas — estados, etiqueta de la oferta y orden de antes', () => {
  assert.deepEqual(STATUSES.map((s) => technicianApplicationListLook(s).label), ['Pending review', 'Accepted', 'Not selected', 'Withdrawn', 'Expired']);
  assert.equal(applicationOfferStatusLook('published'), null);
  assert.equal(applicationOfferStatusLook('closed')?.label, 'Offer closed');
  assert.equal(applicationOfferStatusLook('expired')?.label, 'Offer expired');
  assert.equal(applicationOfferStatusLook('draft')?.label, 'Offer draft');
  const e = (id: string, status: OfferRequestStatus, createdAt: string) => ({ app: { id, status, createdAt } });
  const sorted = sortApplications([
    e('withdrawn', 'withdrawn', '2026-06-01'),
    e('pending-old', 'pending', '2026-01-01'),
    e('pending-new', 'pending', '2026-02-01'),
    e('unread', 'rejected', '2026-01-01'),
  ], (id) => id === 'unread');
  assert.deepEqual(sorted.map((x) => x.app.id), ['unread', 'pending-new', 'pending-old', 'withdrawn']);
});

test('Candidaturas — el detalle es la página de la oferta, donde se retira con la confirmación de siempre', () => {
  const list = read('app/technician/applications/index.tsx');
  assert.match(list, /onOpen=\{\(\) => router\.push\(technicianOfferHref\(entry\.app\.offerId\)/);
  assert.match(list, /<FilterChipRow/);
  const page = read('app/technician/offers/[id].tsx');
  const withdraw = functionBody(page, 'async function handleWithdraw(');
  assert.ok(
    withdraw.indexOf("title: 'Withdraw application?'") > 0
      && withdraw.indexOf('if (!confirmed) return;') < withdraw.indexOf('offerApplicationRepository.withdraw('),
    'retirar pide confirmación antes de escribir',
  );
  assert.match(withdraw, /message: 'This will cancel your application\. This cannot be undone\.'/);
});

// ── Identidad ──────────────────────────────────────────────────────────────

const req = (companyId: string, status: OfferRequestStatus): OfferRequest => ({
  id: `r-${companyId}-${status}`, companyId, technicianId: 't', status, createdAt: '2026-01-01', updatedAt: '2026-01-01',
} as OfferRequest);
const app = (companyId: string, status: OfferRequestStatus): OfferApplication => ({
  id: `a-${companyId}-${status}`, companyId, technicianId: 't', offerId: 'o', status, createdAt: '2026-01-01', updatedAt: '2026-01-01',
} as OfferApplication);

test('Identidad — la regla de la base: una oferta directa o candidatura ACEPTADA con esa empresa', () => {
  const sees = (offerRequests: OfferRequest[], offerApplications: OfferApplication[]) =>
    companyCanSeeIdentity({ companyId: 'c1', technicianId: 't', offerRequests, offerApplications });
  assert.equal(sees([req('c1', 'accepted')], []), true, 'oferta directa aceptada');
  assert.equal(sees([], [app('c1', 'accepted')]), true, 'candidatura aceptada');
  assert.equal(sees([req('c2', 'accepted')], [app('c2', 'accepted')]), false, 'aceptada con OTRA empresa no cuenta');
  for (const s of ['pending', 'rejected', 'withdrawn', 'expired'] as const) {
    assert.equal(sees([req('c1', s)], [app('c1', s)]), false, s);
  }
  // Exactamente canRevealIdentity, el espejo en TS de offer_accepted_between.
  for (const s of STATUSES) {
    for (const t of STATUSES) {
      const params = { companyId: 'c1', technicianId: 't', offerRequests: [req('c1', s)], offerApplications: [app('c1', t)] };
      assert.equal(companyCanSeeIdentity(params), canRevealIdentity(params), `${s}/${t}`);
    }
  }
});

test('Identidad — offer_accepted_between sigue siendo la de la migración 001 (nadie la redefine)', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const defining = fs.readdirSync(dir).filter((f) => /FUNCTION\s+(public\.)?offer_accepted_between/i.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(defining, ['001_initial_schema_v2.sql']);
  const sql = fs.readFileSync(path.join(dir, defining[0]), 'utf8');
  const fn = sql.slice(sql.search(/FUNCTION offer_accepted_between/), sql.indexOf('$$;', sql.search(/FUNCTION offer_accepted_between/)));
  assert.match(fn, /FROM offer_requests\s+WHERE company_id = cid AND technician_id = tid AND status = 'accepted'/);
  assert.match(fn, /FROM offer_applications\s+WHERE company_id = cid AND technician_id = tid AND status = 'accepted'/);
});

test('Identidad — los avisos de antes, salvo cuando esa empresa ya ve la identidad', () => {
  assert.equal(offerPrivacyText(false), 'Your identity remains private until a company accepts your application.');
  assert.equal(offerPrivacyText(true), IDENTITY_ALREADY_VISIBLE);
  assert.equal(IDENTITY_ALREADY_VISIBLE, 'This company can already see your identity because you connected with them before.');
  assert.match(applySheetNote(false), /^Do not include your real name or contact details\. Your identity will remain anonymous until the company accepts your application\.$/);
  assert.equal(applySheetNote(true), IDENTITY_ALREADY_VISIBLE);
  assert.equal(declinedNote(false), 'Your identity and documents remain private.');
  assert.equal(declinedNote(true), IDENTITY_ALREADY_VISIBLE);
  for (const action of ['accept', 'reject'] as const) {
    const visible = directOfferConfirm(action, true);
    assert.ok(visible.message.includes(IDENTITY_ALREADY_VISIBLE), action);
    assert.doesNotMatch(visible.message, /will unlock|remain locked/, `${action}: nada que prometa ocultar o desbloquear`);
    assert.equal(visible.title, directOfferConfirm(action, false).title, `${action}: la confirmación sigue siendo obligatoria`);
  }
});

test('Identidad — ninguna pantalla del técnico escribe el aviso a mano', () => {
  for (const rel of ['app/technician/offers/[id].tsx', 'app/technician/direct-offers/[id].tsx', 'app/technician/direct-offers/index.tsx']) {
    const src = read(rel);
    assert.doesNotMatch(src, /remains private until|remain anonymous until|will remain locked|remain private\./, rel);
  }
  const page = read('app/technician/offers/[id].tsx');
  assert.match(page, /offerPrivacyText\(identityVisible\)/);
  assert.match(page, /applySheetNote\(identityVisible\)/);
  assert.match(page, /companyCanSeeIdentity\(\{\s*companyId: offer\.companyId/);
  const detail = read('app/technician/direct-offers/[id].tsx');
  assert.match(detail, /declinedNote\(identityVisible\)/);
});

// ── Inbox y chat ───────────────────────────────────────────────────────────

test('?from=chat — la misma regla que empresa, y la tarjeta del chat abre su relación marcada', () => {
  assert.equal(technicianOfferHref('o1'), '/technician/offers/o1');
  assert.equal(technicianOfferHref('o1', { fromChat: true }), '/technician/offers/o1?from=chat');
  assert.equal(technicianDirectOfferHref('r1', { fromChat: true }), '/technician/direct-offers/r1?from=chat');
  assert.equal(isOpenedFromChat('chat'), true);
  assert.equal(isOpenedFromChat(['chat']), true);
  for (const other of [undefined, '', 'inbox']) assert.equal(isOpenedFromChat(other), false, String(other));
  assert.equal(chatContextHref({ offerRequestId: 'r1' }, 'o1'), '/technician/direct-offers/r1?from=chat');
  assert.equal(chatContextHref({ offerApplicationId: 'a1' }, 'o1'), '/technician/offers/o1?from=chat');
  assert.equal(chatContextHref({ offerApplicationId: 'a1' }, null), null);
  assert.equal(chatContextHref({}, 'o1'), null);
  // Una pantalla abierta desde el chat sigue siendo interior: sin barra inferior.
  assert.equal(technicianTabForPath('/technician/offers/o1?from=chat'), null);
  assert.equal(technicianSectionForPath('/technician/direct-offers/r1?from=chat'), 'direct');
});

test('?from=chat — las páginas abiertas desde el chat no ofrecen "Open chat"', () => {
  const page = read('app/technician/offers/[id].tsx');
  assert.match(page, /accepted && chatRoom && !fromChat/);
  const panel = read('src/components/technician/TechnicianChatPanel.tsx');
  assert.match(panel, /chatContextHref\(room, offerId\)/);
  assert.doesNotMatch(panel, /\/technician\/offers\/\$\{/, 'el chat no enlaza a la oferta sin marcarla');
});

test('Inbox — patrón de empresa: pestaña sin atrás; en escritorio lista y chat al lado, sin abrir ninguna al entrar', () => {
  const inbox = read('app/technician/(tabs)/chats.tsx');
  assert.match(inbox, /<TechnicianInboxSplit[\s\S]*?selectedRoomId=\{null\}/);
  assert.match(inbox, /Select a conversation to read it here\./);
  assert.doesNotMatch(inbox, /useGoBack|onBack/);
  const chat = read('app/technician/chats/[id].tsx');
  assert.match(chat, /<TechnicianChatPanel key=\{roomId\} roomId=\{roomId\} mode="pane"/);
  assert.match(chat, /router\.replace\(`\/technician\/chats\/\$\{other\}`/);
  assert.match(chat, /mode="screen" onBack=\{goBack\}/);
});

test('Inbox — el último mensaje dice "You:" cuando lo escribió el técnico, como antes', () => {
  const msg = (senderRole: 'technician' | 'company', body: string) => ({ id: 'm', chatRoomId: 'r', senderRole, body, sentAt: '2026-01-01' } as never);
  assert.equal(technicianMessagePreview(null), 'No messages yet');
  assert.equal(technicianMessagePreview(msg('technician', 'Hi')), 'You: Hi');
  assert.equal(technicianMessagePreview(msg('company', 'Hello')), 'Hello');
});

test('Chat — la lógica de antes: sala aceptada, leída al abrirla, el técnico escribe como technician', () => {
  const panel = read('src/components/technician/TechnicianChatPanel.tsx');
  assert.match(panel, /isAccepted = req\?\.status === 'accepted'/);
  assert.match(panel, /isAccepted = app\?\.status === 'accepted'/);
  assert.match(panel, /markChatRoomRead\('technician', technicianId, roomId\)/);
  assert.match(panel, /senderRole: 'technician'/);
  assert.match(panel, /Your identity is revealed to this company\. Messages are private between both parties\./);
});

test('Empresa — las piezas compartidas no cambian lo que hace su chat', () => {
  const company = read('src/components/company/CompanyChatPanel.tsx');
  assert.match(company, /Viewer role cannot send messages\./);
  assert.match(company, /technicianProfileHref\(room\.technicianId, \{ fromChat: true \}\)/);
  assert.match(company, /markChatRoomRead\('company', companyId, roomId\)/);
  assert.match(company, /<ChatView/);
  const list = read('src/components/company/CompanyInboxList.tsx');
  assert.match(list, /anonymous=\{!canViewProfile\}/, 'la identidad del técnico sigue la regla de la base');
});

// ── Home ───────────────────────────────────────────────────────────────────

test('Home — Direct offers con el número de pendientes; en escritorio, en su sección', () => {
  const home = read('app/technician/(tabs)/index.tsx');
  assert.match(home, /label="Direct offers"[\s\S]{0,120}badge=\{pendingDirectOffers\}/);
  const bars = read('src/components/technician/TechnicianNavBars.tsx');
  assert.match(bars, /s\.key === 'direct' \? pendingDirectOffers/);
  const repo = read('src/repositories/v2/offerRequestRepository.ts');
  const count = functionBody(repo, 'async countPendingForTechnician(');
  assert.match(count, /\.eq\('technician_id', technicianId\)\s*\.eq\('status', 'pending'\)/, 'las mismas filas que "N pending" de la lista');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
