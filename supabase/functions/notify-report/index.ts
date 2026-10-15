// @ts-nocheck
// notify-report — aviso por correo a soporte de una denuncia nueva (migración 100).
//
// SIN DESPLEGAR (decisión del 2026-10-15): se activará con el correo propio.
// Para activarla (docs/MODERATION.md):
//   1. Secrets: RESEND_API_KEY y REPORT_EMAIL_FROM (un remitente de un dominio
//      verificado en Resend). Opcional: REPORT_EMAIL_TO (por defecto
//      support@aviationjobtalent.com).
//   2. Desplegarla con verify_jwt = true.
//   3. Poner REPORT_EMAIL_NOTIFICATIONS_ENABLED = true en src/constants/moderation.ts.
//
// La llama la app justo después de guardar la denuncia, con { report_id }. Sólo
// avisa de una denuncia de quien llama, y una sola vez (notified_at). Sin la
// clave de Resend responde { sent: false, reason: 'not_configured' } y no
// cambia nada: la denuncia sigue guardada y sin avisar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0';

// ── CORS (la misma lista que delete-account) ──────────────
const ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'https://aviationjobtalent.vercel.app',
  'https://ajt-dev.vercel.app',
  'https://app.aviationjobtalent.com',
];

function buildCorsHeaders(origin) {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin ?? ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    };
  }
  return { 'Vary': 'Origin' };
}

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function makeJson(corsHeaders) {
  return (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TO = 'support@aviationjobtalent.com';
const EXCERPT_MAX = 1000;

const REASON_LABELS = {
  offensive: 'Offensive or inappropriate',
  harassment: 'Harassment or threats',
  spam_scam: 'Spam or scam',
  misleading: 'False or misleading',
  other: 'Something else',
};
const TARGET_LABELS = {
  technician_profile: 'Technician profile',
  offer: 'Offer',
  chat_message: 'Chat message',
};

function excerpt(text) {
  const value = String(text ?? '').trim();
  return value.length > EXCERPT_MAX ? `${value.slice(0, EXCERPT_MAX)}…` : value;
}

/** Lo denunciado, tal como está ahora, para que soporte no tenga que buscarlo. */
async function describeTarget(admin, report) {
  if (report.target_type === 'chat_message') {
    const { data } = await admin
      .from('chat_messages')
      .select('id, chat_room_id, sender_user_id, sender_role, body, sent_at')
      .eq('id', report.target_id)
      .maybeSingle();
    if (!data) return ['Message: no longer exists'];
    return [
      `Chat room: ${data.chat_room_id}`,
      `Sender: ${data.sender_role} (user ${data.sender_user_id})`,
      `Sent at: ${data.sent_at}`,
      `Message: ${excerpt(data.body)}`,
    ];
  }
  if (report.target_type === 'offer') {
    const { data } = await admin
      .from('offers')
      .select('id, title, description, status, company_id, companies(name)')
      .eq('id', report.target_id)
      .maybeSingle();
    if (!data) return ['Offer: no longer exists'];
    return [
      `Company: ${data.companies?.name ?? '?'} (${data.company_id})`,
      `Offer: ${data.title} [${data.status}]`,
      `Description: ${excerpt(data.description)}`,
    ];
  }
  const { data } = await admin
    .from('technician_profiles')
    .select('id, anonymous_code, user_id')
    .eq('id', report.target_id)
    .maybeSingle();
  if (!data) return ['Technician: no longer exists'];
  return [`Technician: ${data.anonymous_code} (technician ${data.id}, user ${data.user_id})`];
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = buildCorsHeaders(origin);
  const json = makeJson(corsHeaders);

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Forbidden', { status: 403, headers: { 'Vary': 'Origin' } });
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new AppError(500, 'Function environment is not configured.');

    // ── 1. Quién llama ────────────────────────────────────
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new AppError(401, 'Missing bearer token.');
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) throw new AppError(401, 'Invalid session.');

    // ── 2. La denuncia, sólo si es suya ───────────────────
    let body;
    try { body = await req.json(); } catch { throw new AppError(400, 'Invalid JSON body.'); }
    const reportId = typeof body?.report_id === 'string' ? body.report_id : '';
    if (!UUID_RE.test(reportId)) throw new AppError(400, 'Invalid report id.');

    const { data: report, error: reportError } = await admin
      .from('content_reports')
      .select('id, reporter_user_id, target_type, target_id, reason, created_at, notified_at')
      .eq('id', reportId)
      .maybeSingle();
    if (reportError) throw new AppError(500, 'Could not read the report.');
    if (!report || report.reporter_user_id !== authData.user.id) throw new AppError(404, 'Report not found.');
    if (report.notified_at) return json({ sent: false, reason: 'already_notified' });

    // ── 3. Sin correo configurado, no hace nada ───────────
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('REPORT_EMAIL_FROM');
    const to = Deno.env.get('REPORT_EMAIL_TO') || DEFAULT_TO;
    if (!resendKey || !from) return json({ sent: false, reason: 'not_configured' });

    // ── 4. El correo ──────────────────────────────────────
    const { data: reporter } = await admin
      .from('profiles')
      .select('role')
      .eq('id', report.reporter_user_id)
      .maybeSingle();
    const lines = [
      `New report on Aviation Job Talent.`,
      ``,
      `Report: ${report.id}`,
      `Created at: ${report.created_at}`,
      `Reported: ${TARGET_LABELS[report.target_type] ?? report.target_type} (${report.target_id})`,
      `Reason: ${REASON_LABELS[report.reason] ?? report.reason}`,
      `Reporter: ${reporter?.role ?? 'user'} (user ${report.reporter_user_id})`,
      ``,
      ...(await describeTarget(admin, report)),
      ``,
      `What to do: docs/MODERATION.md.`,
    ];
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `[Report] ${TARGET_LABELS[report.target_type] ?? report.target_type}: ${REASON_LABELS[report.reason] ?? report.reason}`,
        text: lines.join('\n'),
      }),
    });
    if (!response.ok) throw new AppError(502, 'The notification email could not be sent.');

    await admin
      .from('content_reports')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', report.id)
      .is('notified_at', null);

    return json({ sent: true });
  } catch (error) {
    const status = error?.status ?? 500;
    const message = error instanceof AppError ? error.message : 'Unexpected error.';
    return json({ error: message }, status);
  }
});
