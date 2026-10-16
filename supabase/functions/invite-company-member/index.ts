// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0';

// ── CORS ──────────────────────────────────────────────────
// Add domains here as the product expands to new environments.
const ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'https://aviationjobtalent.vercel.app',
  'https://ajt-dev.vercel.app',
  'https://app.aviationjobtalent.com',
];

function buildCorsHeaders(origin) {
  // No Origin header → native mobile or server call; CORS not applicable.
  // Known Origin → echo it back so the browser accepts the response.
  // Unknown Origin → omit Allow-Origin so the browser blocks the response.
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

// ── Rate limits ───────────────────────────────────────────
const RATE = {
  perInviterPerHour:    10,
  perCompanyPerDay:     20,
  perEmailPer24h:        3,
};

// ── Helpers ───────────────────────────────────────────────
const VALID_ROLES = new Set(['admin', 'recruiter', 'viewer']);
// Roles de alta de una cuenta de empresa en los metadatos de Auth.
const COMPANY_SIGNUP_ROLES = new Set(['company', 'company_user']);

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

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function inviteRedirectTo() {
  const baseUrl =
    Deno.env.get('APP_PUBLIC_URL') ??
    Deno.env.get('SITE_URL') ??
    Deno.env.get('PUBLIC_SITE_URL');
  if (!baseUrl) {
    throw new AppError(500, 'APP_PUBLIC_URL or SITE_URL must be configured for invitation redirects.');
  }
  return `${baseUrl.replace(/\/$/, '')}/auth/set-password`;
}

async function findProfileByEmail(supabaseAdmin, email) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role, status')
    .ilike('email', email);
  if (error) throw new AppError(500, 'Could not check existing profiles.');
  if ((data ?? []).length > 1) throw new AppError(409, 'More than one profile exists for this email.');
  return data?.[0] ?? null;
}

async function findAuthUserByEmail(supabaseAdmin, email) {
  let page = 1;
  const perPage = 1000;
  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new AppError(500, 'Could not check existing auth users.');
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (users.length < perPage) return null;
    page++;
  }
  throw new AppError(500, 'Auth user lookup exceeded the supported page limit.');
}

async function checkRateLimits(supabaseAdmin, callerId, companyId, email) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oneDayAgo  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [byInviter, byCompany, byEmail] = await Promise.all([
    supabaseAdmin
      .from('company_invitation_log')
      .select('id', { count: 'exact', head: true })
      .eq('inviter_id', callerId)
      .gte('created_at', oneHourAgo),
    supabaseAdmin
      .from('company_invitation_log')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', oneDayAgo),
    supabaseAdmin
      .from('company_invitation_log')
      .select('id', { count: 'exact', head: true })
      .eq('invited_email', email)
      .gte('created_at', oneDayAgo),
  ]);

  if ((byInviter.count ?? 0) >= RATE.perInviterPerHour) {
    throw new AppError(429, 'You have sent too many invitations recently. Please wait before sending more.');
  }
  if ((byCompany.count ?? 0) >= RATE.perCompanyPerDay) {
    throw new AppError(429, 'Your company has reached the daily invitation limit. Try again tomorrow.');
  }
  if ((byEmail.count ?? 0) >= RATE.perEmailPer24h) {
    throw new AppError(429, 'Too many invitations have been sent to this address recently. Try again tomorrow.');
  }
}

// ── Main handler ──────────────────────────────────────────
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = buildCorsHeaders(origin);
  const json = makeJson(corsHeaders);

  // Reject browser requests from unknown origins before doing anything else.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Forbidden', { status: 403, headers: { 'Vary': 'Origin' } });
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl      = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new AppError(500, 'Function environment is not configured.');
    }

    // ── 1. Authenticate caller ────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) throw new AppError(401, 'Missing bearer token.');

    // Service role is used only here, inside the Edge Function.
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      throw new AppError(401, 'Invalid or expired session.');
    }

    // ── 2. Parse and validate input ───────────────────────
    const body        = await req.json().catch(() => ({}));
    const email       = normalizeEmail(body.email);
    const role        = body.role;
    const displayName = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : null;
    const redirectTo  = inviteRedirectTo();

    if (!isValidEmail(email))    throw new AppError(400, 'Enter a valid email address.');
    if (!VALID_ROLES.has(role))  throw new AppError(400, 'Select a valid company role.');

    // ── 3. Verify caller profile and company admin role ───
    const callerId = authData.user.id;

    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('profiles')
      .select('role, status')
      .eq('id', callerId)
      .maybeSingle();
    if (callerProfileError) throw new AppError(500, 'Could not verify caller profile.');
    if (callerProfile?.role !== 'company_user' || callerProfile?.status !== 'active') {
      throw new AppError(403, 'Only active company users can invite members.');
    }

    const { data: callerMember, error: callerMemberError } = await supabaseAdmin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', callerId)
      .maybeSingle();
    if (callerMemberError) throw new AppError(500, 'Could not verify caller membership.');
    if (!callerMember || callerMember.role !== 'admin') {
      throw new AppError(403, 'Only company admins can invite members.');
    }

    // ── 4. Rate limiting ──────────────────────────────────
    await checkRateLimits(supabaseAdmin, callerId, callerMember.company_id, email);

    // ── 5. Resolve target user ────────────────────────────
    let targetProfile = await findProfileByEmail(supabaseAdmin, email);
    let targetUserId  = targetProfile?.id ?? null;
    let invited       = false;
    let recoverySent  = false;

    if (targetProfile) {
      if (targetProfile.role !== 'company_user') {
        throw new AppError(400, 'This email cannot be invited as a company member.');
      }
      if (targetProfile.status === 'blocked' || targetProfile.status === 'suspended') {
        throw new AppError(400, 'This account is not eligible for access.');
      }
    } else {
      const authUser = await findAuthUserByEmail(supabaseAdmin, email);

      if (authUser) {
        // `company` es el nombre de alta desde la migración 102; `company_user`,
        // el de las cuentas creadas antes.
        const metadataRole = authUser.user_metadata?.role;
        if (metadataRole && !COMPANY_SIGNUP_ROLES.has(metadataRole)) {
          throw new AppError(400, 'This email cannot be invited as a company member.');
        }
        targetUserId = authUser.id;
      } else {
        // Rol de ALTA `company`, el único de empresa que acepta el trigger de
        // auth.users desde la 102 (con `company_user` rechaza la cuenta y la
        // invitación no sale). La base la guarda como company_user pendiente;
        // el paso 8 la activa y la añade al equipo, como antes de la 102.
        const { data: inviteData, error: inviteError } =
          await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            data: { role: 'company' },
            redirectTo,
          });
        if (inviteError) throw new AppError(400, 'The invitation could not be sent. Please try again.');
        targetUserId = inviteData?.user?.id ?? null;
        invited = true;
      }

      if (!targetUserId) throw new AppError(500, 'Invited user id could not be resolved.');

      const { error: profileUpsertError } = await supabaseAdmin
        .from('profiles')
        .upsert(
          { id: targetUserId, email, role: 'company_user', status: 'active' },
          { onConflict: 'id' },
        );
      if (profileUpsertError) throw new AppError(500, 'Could not prepare invited profile.');

      targetProfile = { id: targetUserId, email, role: 'company_user', status: 'active' };
    }

    // ── 6. Check existing membership ─────────────────────
    const { data: existingMembership, error: membershipError } = await supabaseAdmin
      .from('company_members')
      .select('company_id')
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (membershipError) throw new AppError(500, 'Could not check existing membership.');
    if (existingMembership?.company_id === callerMember.company_id) {
      throw new AppError(409, 'This user is already a member of your company.');
    }
    if (existingMembership) {
      throw new AppError(409, 'This user already belongs to another company.');
    }

    // ── 7. Send invite / recovery email ──────────────────
    if (!invited) {
      const { error: recoveryError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (recoveryError) throw new AppError(400, 'Could not send the invitation email. Please try again.');
      recoverySent = true;
    }

    // ── 8. Activate profile and add company member ────────
    const { error: profileUpdateError } = await supabaseAdmin
      .from('profiles')
      .update({ status: 'active' })
      .eq('id', targetUserId)
      .eq('role', 'company_user');
    if (profileUpdateError) throw new AppError(500, 'Could not activate invited profile.');

    const { data: member, error: insertError } = await supabaseAdmin
      .from('company_members')
      .insert({
        company_id: callerMember.company_id,
        user_id: targetUserId,
        role,
        ...(displayName ? { display_name: displayName } : {}),
      })
      .select('id, company_id, user_id, role, display_name, created_at')
      .single();
    if (insertError) throw new AppError(500, 'Could not add company member.');

    // ── 9. Log for rate limiting (non-blocking) ───────────
    supabaseAdmin
      .from('company_invitation_log')
      .insert({
        inviter_id:    callerId,
        company_id:    callerMember.company_id,
        invited_email: email,
      })
      .then(() => {})
      .catch(() => {});

    return json({ member, invited, recoverySent, redirectTo });

  } catch (error) {
    const status  = error?.status ?? 500;
    const message = error?.message ?? 'Could not invite company member.';
    return json({ error: message }, status);
  }
});
