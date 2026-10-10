// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0';

// ── CORS ──────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────

// El formato del email anonimizado (`deleted_<uuid>@deleted.invalid`) vive
// ahora en handle_deleted_user() (migración 039), que es el único dueño de la
// anonimización en base de datos. Se elimina de aquí para que no queden dos
// definiciones que puedan divergir.

// Espejo del CHECK de account_deletion_feedback (migración 043) y de
// src/constants/deletionReasons.ts. Se valida aquí y no sólo en el cliente
// porque esta función escribe con service_role, que salta RLS: lo que no filtre
// este allowlist entra en la tabla.
const DELETION_REASONS = [
  'goal_met_here',
  'goal_met_elsewhere',
  'not_enough_supply',
  'verification_slow',
  'privacy_concerns',
  'just_testing',
  'other',
];
const COMMENT_MAX_LENGTH = 1000;
const STORAGE_BATCH_SIZE = 100;

/**
 * Guarda el motivo de baja una vez la cuenta YA se ha borrado.
 *
 * Nunca lanza. El borrado es un derecho que la persona ya ha ejercido: que
 * falle una encuesta opcional no puede impedirlo, ni dejar la cuenta a medio
 * borrar, ni devolver un error que parezca que el borrado no ocurrió. Si esto
 * se cae, se pierde una respuesta — y eso es todo lo que se pierde.
 *
 * La fila NO lleva user_id ni FK (ver cabecera de la migración 043): es lo que
 * le permite sobrevivir al borrado sin quedar atada a quien la escribió.
 */
async function recordDeletionFeedback(supabaseAdmin, role, feedback) {
  try {
    if (!feedback || typeof feedback !== 'object') return;
    const reason = feedback.reason;
    if (!DELETION_REASONS.includes(reason)) return;

    const rawComment = typeof feedback.comment === 'string' ? feedback.comment.trim() : '';
    const comment = rawComment.length > 0 ? rawComment.slice(0, COMMENT_MAX_LENGTH) : null;

    await supabaseAdmin.from('account_deletion_feedback').insert({ role, reason, comment });
  } catch (_err) {
    // Silencio deliberado: ver arriba.
  }
}

/**
 * Enumerate every real object below one technician-owned prefix, including
 * nested folders. Paths from the public `documents` table are deliberately
 * not trusted here: a forged row must never let service_role delete another
 * user's object during account deletion.
 */
async function listTechnicianStoragePaths(bucket, technicianId) {
  const paths = [];
  const folders = [technicianId];

  for (let folderIndex = 0; folderIndex < folders.length; folderIndex += 1) {
    if (folders.length > 10000) {
      throw new AppError(500, 'The uploaded-document folder is too complex to delete safely.');
    }

    const folder = folders[folderIndex];
    for (let offset = 0; ; offset += STORAGE_BATCH_SIZE) {
      const { data: entries, error: listErr } = await bucket.list(folder, {
        limit: STORAGE_BATCH_SIZE,
        offset,
      });
      if (listErr) {
        throw new AppError(500, 'Could not inspect the uploaded-document folder. The account was not deleted.');
      }

      for (const entry of entries ?? []) {
        if (!entry?.name) continue;
        const path = `${folder}/${entry.name}`;
        if (entry.id) paths.push(path);
        else folders.push(path);
      }
      if ((entries ?? []).length < STORAGE_BATCH_SIZE) break;
    }
  }

  return [...new Set(paths)];
}

async function deleteAccountTechnician(supabaseAdmin, userId) {
  // 1. Resolve technician_profiles row — sólo para localizar los ficheros.
  const { data: techProfile, error: techErr } = await supabaseAdmin
    .from('technician_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (techErr) throw new AppError(500, 'Could not retrieve technician profile.');

  if (techProfile) {
    // 2. Borrar todos los FICHEROS bajo la carpeta propia, incluso huérfanos
    //    sin fila `documents`. Las FILAS las borra después el trigger SQL.
    for (const bucketName of ['technician-documents', 'technician-photos']) {
      const bucket = supabaseAdmin.storage.from(bucketName);
      const paths = await listTechnicianStoragePaths(bucket, techProfile.id);
      for (let start = 0; start < paths.length; start += STORAGE_BATCH_SIZE) {
        const { error: storageErr } = await bucket.remove(paths.slice(start, start + STORAGE_BATCH_SIZE));
        if (storageErr) {
          throw new AppError(500, 'Could not remove every uploaded file. Some files may already be gone; retry account deletion.');
        }
      }

      const remainingPaths = await listTechnicianStoragePaths(bucket, techProfile.id);
      if (remainingPaths.length > 0) {
        throw new AppError(500, 'Storage did not confirm removal of every uploaded file. Retry account deletion.');
      }
    }
  }

  // 3. Borrar el usuario de auth. El trigger AFTER DELETE `on_auth_user_deleted`
  //    construye la lápida entera (anonimizar PII, limpiar cover notes y mensajes,
  //    borrar filas de documents, profiles.status='deleted') dentro de esta misma
  //    transacción: esas mutaciones de BD son atómicas. Storage es un sistema
  //    externo y ya puede haberse vaciado si este último paso falla; por eso la
  //    operación anterior es reintentable y nunca comunica éxito parcial.
  const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteErr) throw new AppError(500, 'Could not remove authentication credentials.');
}

async function deleteAccountCompanyUser(supabaseAdmin, userId) {
  // 1. Resolve company membership
  const { data: member, error: memberErr } = await supabaseAdmin
    .from('company_members')
    .select('id, company_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (memberErr) throw new AppError(500, 'Could not retrieve company membership.');

  if (member && member.role === 'admin') {
    // 2. Count admins in this company — block if last admin
    const { count, error: countErr } = await supabaseAdmin
      .from('company_members')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', member.company_id)
      .eq('role', 'admin');
    if (countErr) throw new AppError(500, 'Could not verify company admin count.');
    if ((count ?? 0) <= 1) {
      throw new AppError(
        409,
        'You are the only administrator of your company. Assign another administrator before deleting your account.',
      );
    }
  }

  // 3. Borrar el usuario de auth. El trigger `on_auth_user_deleted` quita la
  //    membresía de company_members, anonimiza los mensajes de chat y marca
  //    profiles.status='deleted', todo en esta misma transacción.
  //
  //    El guard de último admin de arriba se queda AQUÍ a propósito: es una
  //    regla de producto ("no dejes a tu empresa sin administrador"), no un
  //    invariante de integridad, así que no se replica en el trigger. Un
  //    borrado que no pase por esta función se la salta — pero sigue sin poder
  //    dejar un fantasma, que es lo que el trigger sí garantiza.
  const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteErr) throw new AppError(500, 'Could not remove authentication credentials.');
}

// ── Main handler ──────────────────────────────────────────
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
    const supabaseUrl    = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new AppError(500, 'Function environment is not configured.');
    }

    // ── 1. Authenticate caller ────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) throw new AppError(401, 'Missing bearer token.');

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      throw new AppError(401, 'Invalid or expired session.');
    }

    const userId = authData.user.id;

    // ── 2. Get profile role ───────────────────────────────
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('role, status')
      .eq('id', userId)
      .maybeSingle();
    if (profileErr) throw new AppError(500, 'Could not retrieve user profile.');
    if (!profile) throw new AppError(404, 'User profile not found.');
    if (profile.role === 'admin') {
      throw new AppError(403, 'Admin accounts cannot be self-deleted. Contact a super-admin.');
    }

    // El cuerpo puede venir vacío: las versiones anteriores del cliente no
    // mandaban ninguno y tienen que seguir funcionando.
    let feedback = null;
    try {
      feedback = await req.json();
    } catch (_err) {
      feedback = null;
    }

    // ── 3. Delete by role ─────────────────────────────────
    if (profile.role === 'technician') {
      await deleteAccountTechnician(supabaseAdmin, userId);
    } else {
      await deleteAccountCompanyUser(supabaseAdmin, userId);
    }

    // ── 4. Motivo de baja (opcional) ──────────────────────
    // DESPUÉS del borrado, no antes: ambas rutas de arriba lanzan si la baja
    // no procede (el guard de último administrador de la empresa es el caso
    // real), y una baja rechazada no puede dejar registrada una baja. La fila
    // no tiene user_id ni FK, así que escribirla cuando la cuenta ya no existe
    // es exactamente lo que la migración 043 hace posible.
    await recordDeletionFeedback(supabaseAdmin, profile.role, feedback);

    return json({ success: true });

  } catch (error) {
    const status  = error?.status ?? 500;
    const message = error?.message ?? 'Could not delete account.';
    return json({ error: message }, status);
  }
});
