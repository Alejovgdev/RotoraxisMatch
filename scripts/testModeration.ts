// Standalone tests — sin Supabase real y sin navegador. Denunciar y bloquear
// (migración 100; norma 1.2 de App Store y Google Play):
//
//   - los motivos y los tipos de contenido son los mismos que en la base (se
//     leen del CHECK y de report_content en la migración);
//   - qué ofrece el "⋯" y qué dice al bloquear;
//   - el caso de uso: la denuncia no espera al aviso por correo ni falla con
//     él, y sólo avisa de las nuevas y con el aviso encendido;
//   - los repositorios REALES sobre un supabase falso: llamadas a las funciones
//     de la base, el rechazo por bloqueo traducido al aceptar, y que un chat
//     bloqueado (oculto por RLS) no cuente como sin leer;
//   - que cada sitio pedido tiene su botón: perfil, candidatura, oferta,
//     oferta directa y los dos chats.
//
// Run via: npm run test:moderation
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ── Un supabase falso, instalado antes de cargar los repositorios ───────────

type Result = { data: unknown; error: unknown };
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
const invokes: { name: string; body: unknown }[] = [];
let rpcResult: (name: string) => Result = () => ({ data: null, error: null });
let invokeError: unknown = null;
const tableResults: Record<string, Result> = {};
const inFilters: Record<string, unknown[]> = {};

function makeQuery(table: string) {
  const result = () => Promise.resolve(tableResults[table] ?? { data: [], error: null });
  const query: any = {
    select: () => query,
    update: () => query,
    eq: () => query,
    order: () => query,
    in: (_column: string, values: unknown[]) => { inFilters[table] = values; return query; },
    maybeSingle: result,
    single: result,
    then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => result().then(resolve, reject),
  };
  return query;
}

const fakeSupabase = {
  rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return rpcResult(name); },
  from: (table: string) => makeQuery(table),
  functions: {
    invoke: async (name: string, options: { body: unknown }) => {
      invokes.push({ name, body: options.body });
      return { data: null, error: invokeError };
    },
  },
};

for (const [name, moduleExports] of [
  ['../src/lib/supabase', { supabase: fakeSupabase }],
  // La carga de documentos tira de React Native; aquí no se usa.
  ['../src/lib/documentStorage', {}],
] as const) {
  const resolved = require.resolve(name);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: moduleExports } as NodeModule;
}

/* eslint-disable @typescript-eslint/no-var-requires */
const moderation = require('../src/utils/moderation') as typeof import('../src/utils/moderation');
const usecase = require('../src/usecases/moderation') as typeof import('../src/usecases/moderation');
const { moderationRepository } = require('../src/repositories/v2/moderationRepository') as typeof import('../src/repositories/v2/moderationRepository');
const { offerApplicationRepository } = require('../src/repositories/v2/offerApplicationRepository') as typeof import('../src/repositories/v2/offerApplicationRepository');
const { offerRequestRepository } = require('../src/repositories/v2/offerRequestRepository') as typeof import('../src/repositories/v2/offerRequestRepository');
const { activityRepository } = require('../src/repositories/v2/activityRepository') as typeof import('../src/repositories/v2/activityRepository');
const { canBlockContacts } = require('../src/utils/companyPermissionsV2') as typeof import('../src/utils/companyPermissionsV2');
const { REPORT_EMAIL_NOTIFICATIONS_ENABLED } = require('../src/constants/moderation') as typeof import('../src/constants/moderation');
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
const migration = read('supabase/migrations/100_reports_and_blocks.sql');
const blockedError = { code: 'PT403', details: 'contact_blocked', message: 'Contact between this technician and this company is blocked.' };

async function main() {
  // ── Mismos códigos que la base ──────────────────────────────────────────

  await test('los motivos son los del CHECK de content_reports, en el mismo orden', () => {
    const check = migration.match(/CHECK \(reason IN \(([^)]*)\)\)/);
    assert.ok(check, 'CHECK de reason no encontrado');
    const sql = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(moderation.REPORT_REASONS.map((r) => r.code), sql);
    // report_content repite la lista: tiene que ser la misma.
    const rpc = migration.match(/p_reason NOT IN \(([^)]*)\)/);
    assert.ok(rpc);
    assert.deepEqual([...rpc[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), sql);
    assert.equal(new Set(moderation.REPORT_REASONS.map((r) => r.label)).size, sql.length, 'cada motivo con su texto');
  });

  await test('los tipos de contenido son los del CHECK de target_type', () => {
    const check = migration.match(/CHECK \(target_type IN \(([^)]*)\)\)/);
    assert.ok(check);
    assert.deepEqual(Object.keys(moderation.REPORT_TITLES).sort(), [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort());
  });

  // ── El menú y los textos ────────────────────────────────────────────────

  await test('el "⋯" ofrece denunciar y bloquear; bloqueado queda como "Blocked", desactivado', () => {
    assert.deepEqual(moderation.moderationMenuItems({ report: 'offer', block: { counterpart: 'company', blocked: null } }), [
      { key: 'report', label: 'Report offer' },
      { key: 'block', label: 'Block company', disabled: false },
    ]);
    assert.deepEqual(moderation.moderationMenuItems({ report: 'technician_profile', block: { counterpart: 'technician', blocked: false } }), [
      { key: 'report', label: 'Report profile' },
      { key: 'block', label: 'Block technician', disabled: false },
    ]);
    assert.deepEqual(moderation.moderationMenuItems({ report: 'offer', block: { counterpart: 'company', blocked: true } })[1],
      { key: 'block', label: 'Blocked', disabled: true });
    // El viewer: sólo denunciar. En el chat (sin denuncia en el menú) un viewer no tiene "⋯".
    assert.deepEqual(moderation.moderationMenuItems({ report: 'technician_profile', block: null }), [{ key: 'report', label: 'Report profile' }]);
    assert.deepEqual(moderation.moderationMenuItems({ report: null, block: null }), []);
    // Una oferta directa antigua sin oferta: sólo bloquear.
    assert.deepEqual(moderation.moderationMenuItems({ report: null, block: { counterpart: 'company', blocked: null } }).map((i) => i.key), ['block']);
  });

  await test('bloquear pide confirmación en rojo, dice qué pasa y cómo se deshace', () => {
    const named = moderation.blockConfirmOptions('company', 'Acme MRO');
    assert.equal(named.title, 'Block Acme MRO?');
    assert.equal(named.destructive, true);
    assert.equal(named.confirmLabel, 'Block');
    assert.match(named.message, /won't be able to message each other/);
    assert.match(named.message, /can't be sent or accepted/);
    assert.match(named.message, /disappears for both of you/);
    assert.match(named.message, /contact support/);
    assert.equal(moderation.blockConfirmOptions('technician', '  ').title, 'Block this technician?');
    assert.equal(moderation.blockConfirmOptions('company').title, 'Block this company?');
  });

  await test('cómo se denuncia un mensaje: banderita en web, mantener pulsado en el móvil', () => {
    assert.match(moderation.reportMessageHint('web'), /flag/);
    assert.match(moderation.reportMessageHint('ios'), /press and hold/);
    assert.match(moderation.reportMessageHint('android'), /press and hold/);
  });

  await test('sólo el rechazo del bloqueo se traduce; el resto sigue su camino', () => {
    assert.equal(moderation.isContactBlockedError(blockedError), true);
    assert.equal(moderation.isContactBlockedError({ code: 'PT403', details: 'no_engine_experience' }), false);
    assert.equal(moderation.isContactBlockedError({ code: '42501', details: 'contact_blocked' }), false);
    assert.equal(moderation.isContactBlockedError(null), false);
    assert.throws(() => moderation.throwIfContactBlocked(blockedError), { message: moderation.CONTACT_BLOCKED_TEXT });
    assert.doesNotThrow(() => moderation.throwIfContactBlocked({ code: 'PT403', details: 'licensed_technician' }));
  });

  await test('bloquean admin y recruiter; el viewer y una sesión sin resolver, no', () => {
    assert.equal(canBlockContacts('admin'), true);
    assert.equal(canBlockContacts('recruiter'), true);
    assert.equal(canBlockContacts('viewer'), false);
    assert.equal(canBlockContacts(undefined), false);
  });

  // ── El caso de uso ──────────────────────────────────────────────────────

  await test('el aviso por correo está apagado hasta tener el correo propio', () => {
    assert.equal(REPORT_EMAIL_NOTIFICATIONS_ENABLED, false);
  });

  await test('denuncia nueva con el aviso encendido: avisa, sin esperar y sin fallar si el aviso falla', async () => {
    const notified: string[] = [];
    let release: () => void = () => {};
    const deps = {
      report: async () => ({ reportId: 'r1', alreadyReported: false }),
      block: async () => {},
      isBlocked: async () => false,
      notify: (id: string) => { notified.push(id); return new Promise<void>((_, reject) => { release = () => reject(new Error('down')); }); },
      notificationsEnabled: true,
    };
    const result = await usecase.submitReport({ type: 'chat_message', id: 'm1' }, 'harassment', deps);
    assert.deepEqual(result, { alreadyReported: false });
    assert.deepEqual(notified, ['r1']);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await test('denuncia repetida, o con el aviso apagado: no avisa', async () => {
    const notified: string[] = [];
    const base = {
      block: async () => {},
      isBlocked: async () => false,
      notify: async (id: string) => { notified.push(id); },
    };
    const again = await usecase.submitReport({ type: 'offer', id: 'o1' }, 'spam_scam', {
      ...base, report: async () => ({ reportId: 'r1', alreadyReported: true }), notificationsEnabled: true,
    });
    assert.deepEqual(again, { alreadyReported: true });
    await usecase.submitReport({ type: 'offer', id: 'o1' }, 'spam_scam', {
      ...base, report: async () => ({ reportId: 'r2', alreadyReported: false }), notificationsEnabled: false,
    });
    assert.deepEqual(notified, []);
  });

  await test('si la base rechaza la denuncia, el error llega a la pantalla', async () => {
    await assert.rejects(usecase.submitReport({ type: 'offer', id: 'o1' }, 'other', {
      report: async () => { throw new Error('This content cannot be reported.'); },
      block: async () => {}, isBlocked: async () => false, notify: async () => {}, notificationsEnabled: true,
    }), { message: 'This content cannot be reported.' });
  });

  // ── Repositorios reales sobre el supabase falso ─────────────────────────

  await test('denunciar llama a report_content con sus parámetros y lee la fila devuelta', async () => {
    rpcCalls.length = 0;
    rpcResult = () => ({ data: [{ report_id: 'r9', already_reported: true }], error: null });
    const result = await moderationRepository.reportContent('chat_message', 'm9', 'offensive');
    assert.deepEqual(result, { reportId: 'r9', alreadyReported: true });
    assert.deepEqual(rpcCalls, [{ name: 'report_content', args: { p_target_type: 'chat_message', p_target_id: 'm9', p_reason: 'offensive' } }]);
    rpcResult = () => ({ data: [], error: null });
    await assert.rejects(moderationRepository.reportContent('offer', 'o1', 'other'), /could not be saved/);
    rpcResult = () => ({ data: null, error: { message: 'This content cannot be reported.' } });
    await assert.rejects(moderationRepository.reportContent('offer', 'o1', 'other'), { message: 'This content cannot be reported.' });
  });

  await test('bloquear y preguntar por el bloqueo llaman a block_contact y contact_blocked', async () => {
    rpcCalls.length = 0;
    rpcResult = (name) => ({ data: name === 'contact_blocked' ? true : null, error: null });
    await moderationRepository.blockContact('c1', 't1');
    assert.equal(await moderationRepository.isContactBlocked('c1', 't1'), true);
    assert.deepEqual(rpcCalls, [
      { name: 'block_contact', args: { p_company_id: 'c1', p_technician_id: 't1' } },
      { name: 'contact_blocked', args: { p_company_id: 'c1', p_technician_id: 't1' } },
    ]);
    rpcResult = () => ({ data: null, error: null });
    assert.equal(await moderationRepository.isContactBlocked('c1', 't1'), false);
    rpcResult = () => ({ data: null, error: { message: 'You cannot block this contact.' } });
    await assert.rejects(moderationRepository.blockContact('c1', 't1'), { message: 'You cannot block this contact.' });
  });

  await test('el aviso llama a la función notify-report con el id', async () => {
    invokes.length = 0;
    invokeError = null;
    await moderationRepository.notifyReport('r1');
    assert.deepEqual(invokes, [{ name: 'notify-report', body: { report_id: 'r1' } }]);
    invokeError = new Error('not deployed');
    await assert.rejects(moderationRepository.notifyReport('r1'), /not deployed/);
  });

  await test('aceptar con un bloqueo: la candidatura y la oferta directa dicen por qué', async () => {
    tableResults.offer_applications = { data: null, error: blockedError };
    tableResults.offer_requests = { data: null, error: blockedError };
    await assert.rejects(offerApplicationRepository.updateStatus('a1', 'accepted'), { message: moderation.CONTACT_BLOCKED_TEXT });
    await assert.rejects(offerRequestRepository.updateStatus('r1', 'accepted'), { message: moderation.CONTACT_BLOCKED_TEXT });
    // Otro rechazo sigue con su mensaje de siempre.
    tableResults.offer_requests = { data: null, error: { code: '42501', message: 'Not authorized.' } };
    await assert.rejects(offerRequestRepository.updateStatus('r1', 'accepted'), { message: 'Not authorized.' });
    delete tableResults.offer_applications;
    delete tableResults.offer_requests;
  });

  await test('un chat bloqueado (oculto por RLS) no cuenta como sin leer', async () => {
    tableResults.activity_events = { data: [{ id: 'e1', entity_id: 'room-visible' }, { id: 'e2', entity_id: 'room-blocked' }], error: null };
    tableResults.activity_reads = { data: [], error: null };
    tableResults.chat_rooms = { data: [{ id: 'room-visible' }], error: null };
    const unread = await activityRepository.getUnreadChatRoomIds('technician', 't1');
    assert.deepEqual([...unread], ['room-visible']);
    assert.deepEqual(inFilters.chat_rooms, ['room-visible', 'room-blocked']);
    // Si la comprobación falla, se queda el número de antes en vez de inventar 0.
    tableResults.chat_rooms = { data: null, error: { message: 'offline' } };
    assert.deepEqual([...(await activityRepository.getUnreadChatRoomIds('technician', 't1'))], ['room-visible', 'room-blocked']);
    // Sin nada sin leer no pregunta por los chats.
    delete inFilters.chat_rooms;
    tableResults.activity_events = { data: [], error: null };
    assert.equal((await activityRepository.getUnreadChatRoomIds('technician', 't1')).size, 0);
    assert.equal(inFilters.chat_rooms, undefined);
  });

  // ── Cada sitio pedido tiene su botón ────────────────────────────────────

  await test('perfil, candidatura, oferta, oferta directa y los dos chats ofrecen denunciar y bloquear', () => {
    const surfaces: [string, RegExp[]][] = [
      ['app/company/technician/[id].tsx', [/type: 'technician_profile'/, /counterpart: 'technician'/, /canBlockContacts\(/]],
      ['app/company/applications/[id].tsx', [/type: 'technician_profile'/, /counterpart: 'technician'/, /canBlockContacts\(/]],
      ['app/technician/offers/[id].tsx', [/type: 'offer' as const/, /counterpart: 'company' as const/]],
      ['app/technician/direct-offers/[id].tsx', [/type: 'offer'/, /counterpart: 'company'/]],
      ['src/components/company/CompanyChatPanel.tsx', [/onReportMessage=/, /type: 'chat_message'/, /counterpart: 'technician'/, /canBlockContacts\(/]],
      ['src/components/technician/TechnicianChatPanel.tsx', [/onReportMessage=/, /type: 'chat_message'/, /counterpart: 'company'/]],
    ];
    for (const [file, patterns] of surfaces) {
      const source = read(file);
      assert.match(source, /<ModerationMenu/, `${file}: sin "⋯"`);
      for (const pattern of patterns) assert.match(source, pattern, `${file}: falta ${pattern}`);
    }
    // En móvil (PageBar right) y en escritorio, en las pantallas con dos marcos.
    for (const file of ['app/company/technician/[id].tsx', 'app/company/applications/[id].tsx', 'app/technician/direct-offers/[id].tsx']) {
      const source = read(file);
      assert.match(source, /right=\{moderation\}/, `${file}: sin "⋯" en móvil`);
      assert.match(source, /moderationRow/, `${file}: sin "⋯" en escritorio`);
    }
    const offerPage = read('app/technician/offers/[id].tsx');
    assert.equal((offerPage.match(/<ModerationMenu/g) ?? []).length, 2, 'oferta: móvil y escritorio');
    // El chat denuncia mensajes de la OTRA parte, nunca los propios.
    assert.match(read('src/components/chat/ChatView.tsx'), /const report = !mine && onReportMessage/);
  });

  await test('tras bloquear en el chat se sale de la conversación (móvil y escritorio)', () => {
    for (const file of ['app/company/chats/[id].tsx', 'app/technician/chats/[id].tsx']) {
      const source = read(file);
      assert.match(source, /onBlocked=\{goBack\}/, `${file}: móvil`);
      assert.match(source, /onBlocked=\{\(\) => router\.replace\(/, `${file}: escritorio`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
