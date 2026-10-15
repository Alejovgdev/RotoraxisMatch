// Standalone tests — sin Supabase real y sin navegador. Confirmación del email
// al registrarse, que debe funcionar con la confirmación activada o desactivada
// en Supabase:
//
//   - las reglas puras: el resultado del alta (con sesión, por confirmar, email
//     ya registrado), la URL del enlace, la lectura de la vuelta del correo y
//     los textos de error;
//   - el módulo real sobre un supabase falso: reenviar el correo y completar la
//     confirmación con los tokens del enlace;
//   - que las pantallas usan esas piezas, y que con la confirmación desactivada
//     el alta sigue llamando al RPC y yendo a pending-verification.
//
// Run via: npm run test:email-confirmation
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// El enlace se construye con EXPO_PUBLIC_APP_URL al cargar el módulo. Con la
// barra final, para comprobar que no sale "//auth/confirm".
process.env.EXPO_PUBLIC_APP_URL = 'https://app.example.test/';

// ── Un supabase falso, instalado antes de cargar el módulo ─────────────────

type AuthResult = { data: any; error: any };
const resendCalls: unknown[] = [];
const setSessionCalls: unknown[] = [];
let resendResult: AuthResult = { data: { user: null, session: null }, error: null };
let setSessionResult: AuthResult = { data: { session: {} }, error: null };
let getSessionResult: AuthResult = { data: { session: null }, error: null };

const fakeSupabase = {
  auth: {
    resend: async (credentials: unknown) => { resendCalls.push(credentials); return resendResult; },
    setSession: async (tokens: unknown) => { setSessionCalls.push(tokens); return setSessionResult; },
    getSession: async () => getSessionResult,
  },
};

{
  const resolved = require.resolve('../src/lib/supabase');
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { supabase: fakeSupabase } } as NodeModule;
}

/* eslint-disable @typescript-eslint/no-var-requires */
const rules = require('../src/auth/emailConfirmationRules') as typeof import('../src/auth/emailConfirmationRules');
const service = require('../src/auth/emailConfirmation') as typeof import('../src/auth/emailConfirmation');
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
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const RATE_LIMIT_WAIT = {
  name: 'AuthApiError',
  status: 429,
  code: 'over_email_send_rate_limit',
  message: 'For security purposes, you can only request this after 42 seconds.',
};

async function main() {
  // ── Reglas puras ─────────────────────────────────────────────────────────

  await test('el enlace vuelve a /auth/confirm de EXPO_PUBLIC_APP_URL, con o sin barra final', () => {
    assert.equal(rules.confirmEmailRedirectUrl('https://app.example.test'), 'https://app.example.test/auth/confirm');
    assert.equal(rules.confirmEmailRedirectUrl('https://app.example.test//'), 'https://app.example.test/auth/confirm');
    assert.equal(service.EMAIL_CONFIRMATION_REDIRECT_URL, 'https://app.example.test/auth/confirm');
  });

  await test('"Check your email" recibe la dirección codificada y el motivo', () => {
    assert.equal(
      rules.checkEmailHref('ana+test@example.com', 'signup'),
      '/auth/check-email?email=ana%2Btest%40example.com&reason=signup',
    );
    assert.equal(
      rules.checkEmailHref('ana@example.com', 'unconfirmed'),
      '/auth/check-email?email=ana%40example.com&reason=unconfirmed',
    );
  });

  await test('resultado del alta: confirmación desactivada, activada y email ya registrado', () => {
    // Desactivada: Supabase devuelve la sesión.
    assert.equal(rules.signUpOutcome({ session: { access_token: 'x' }, user: { identities: [{}] } }), 'signed_in');
    // Activada: sin sesión, usuario con su identidad.
    assert.equal(rules.signUpOutcome({ session: null, user: { identities: [{ id: 'i' }] } }), 'needs_confirmation');
    // Activada y el email ya tenía cuenta: usuario de pega sin identidades.
    assert.equal(rules.signUpOutcome({ session: null, user: { identities: [] } }), 'already_registered');
    // Sin dato de identidades no se inventa un "ya registrado".
    assert.equal(rules.signUpOutcome({ session: null, user: {} }), 'needs_confirmation');
    assert.equal(rules.signUpOutcome({ session: null, user: null }), 'needs_confirmation');
  });

  await test('lee los tokens del hash y los errores del hash o de la query', () => {
    assert.deepEqual(
      rules.readAuthCallbackParams('https://app.example.test/auth/confirm#access_token=AT&refresh_token=RT&type=signup'),
      { accessToken: 'AT', refreshToken: 'RT', error: undefined, errorCode: undefined, errorDescription: undefined },
    );
    const hashError = rules.readAuthCallbackParams(
      'https://app.example.test/auth/confirm#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    assert.equal(hashError.errorCode, 'otp_expired');
    assert.equal(hashError.errorDescription, 'Email link is invalid or has expired');
    assert.equal(rules.callbackHasError(hashError), true);
    const queryError = rules.readAuthCallbackParams('https://app.example.test/auth/confirm?error=server_error&error_description=Boom');
    assert.equal(queryError.error, 'server_error');
    assert.equal(rules.confirmationLinkErrorText(queryError), 'Boom');
    assert.deepEqual(rules.readAuthCallbackParams('not a url'), {});
    assert.deepEqual(rules.readAuthCallbackParams(''), {});
    assert.equal(rules.callbackHasError({}), false);
  });

  await test('un enlace caducado o ya usado dice que, si ya confirmó, inicie sesión', () => {
    assert.equal(rules.confirmationLinkErrorText({ error: 'access_denied', errorCode: 'otp_expired' }), rules.LINK_EXPIRED_TEXT);
    assert.equal(rules.confirmationLinkErrorText({ error: 'access_denied' }), rules.LINK_EXPIRED_TEXT);
    assert.match(rules.LINK_EXPIRED_TEXT, /sign in/);
  });

  await test('textos de error: red, ya registrado, límites de envío y desconocidos', () => {
    assert.equal(rules.authErrorText({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }), rules.NETWORK_ERROR_TEXT);
    assert.equal(rules.authErrorText({ message: 'TypeError: Network request failed' }), rules.NETWORK_ERROR_TEXT);
    assert.equal(rules.authErrorText({ code: 'user_already_exists', status: 422, message: 'User already registered' }), rules.ALREADY_REGISTERED_TEXT);
    assert.equal(rules.authErrorText({ code: 'email_exists', status: 422, message: 'Email address already exists' }), rules.ALREADY_REGISTERED_TEXT);
    assert.equal(rules.authErrorText(RATE_LIMIT_WAIT), rules.WAIT_BEFORE_RESEND_TEXT);
    assert.equal(
      rules.authErrorText({ code: 'over_email_send_rate_limit', status: 429, message: 'Email rate limit exceeded' }),
      rules.TOO_MANY_EMAILS_TEXT,
    );
    assert.equal(rules.authErrorText({ code: 'over_request_rate_limit', status: 429, message: 'x' }), rules.TOO_MANY_ATTEMPTS_TEXT);
    assert.equal(rules.authErrorText({ code: 'otp_expired', status: 403, message: 'x' }), rules.LINK_EXPIRED_TEXT);
    // Lo que no se traduce conserva el texto de Supabase (p. ej. credenciales).
    assert.equal(rules.authErrorText({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }), 'Invalid login credentials');
    assert.match(rules.authErrorText(null), /Something went wrong/);
    assert.match(rules.authErrorText({ message: '  ' }), /Something went wrong/);
  });

  await test('segundos de espera y email sin confirmar', () => {
    assert.equal(rules.retryAfterSeconds(RATE_LIMIT_WAIT), 42);
    assert.equal(rules.retryAfterSeconds({ message: 'you can only request this after 1 second' }), 1);
    assert.equal(rules.retryAfterSeconds({ message: 'Email rate limit exceeded' }), null);
    assert.equal(rules.retryAfterSeconds(null), null);
    assert.equal(rules.isEmailNotConfirmed({ code: 'email_not_confirmed', message: 'Email not confirmed' }), true);
    assert.equal(rules.isEmailNotConfirmed({ code: 'invalid_credentials' }), false);
    assert.equal(rules.isEmailNotConfirmed(null), false);
  });

  // ── El módulo real sobre un supabase falso ───────────────────────────────

  await test('reenviar: tipo signup, la dirección y el enlace de vuelta', async () => {
    resendCalls.length = 0;
    resendResult = { data: { user: null, session: null }, error: null };
    assert.deepEqual(await service.resendSignupConfirmation('ana@example.com'), { ok: true });
    assert.deepEqual(resendCalls, [{
      type: 'signup',
      email: 'ana@example.com',
      options: { emailRedirectTo: 'https://app.example.test/auth/confirm' },
    }]);
  });

  await test('reenviar demasiado pronto: texto y segundos de espera', async () => {
    resendResult = { data: { user: null, session: null }, error: RATE_LIMIT_WAIT };
    assert.deepEqual(await service.resendSignupConfirmation('ana@example.com'), {
      ok: false,
      message: rules.WAIT_BEFORE_RESEND_TEXT,
      retryAfterSeconds: 42,
    });
    resendResult = { data: { user: null, session: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } };
    assert.deepEqual(await service.resendSignupConfirmation('ana@example.com'), {
      ok: false,
      message: rules.NETWORK_ERROR_TEXT,
      retryAfterSeconds: null,
    });
  });

  await test('confirmar: con los tokens del enlace inicia la sesión', async () => {
    setSessionCalls.length = 0;
    setSessionResult = { data: { session: {} }, error: null };
    const result = await service.completeEmailConfirmation(
      'https://app.example.test/auth/confirm#access_token=AT&refresh_token=RT&expires_in=3600&type=signup',
    );
    assert.deepEqual(result, { status: 'confirmed' });
    assert.deepEqual(setSessionCalls, [{ access_token: 'AT', refresh_token: 'RT' }]);
  });

  await test('confirmar: un enlace rechazado no intenta iniciar sesión', async () => {
    setSessionCalls.length = 0;
    const result = await service.completeEmailConfirmation(
      'https://app.example.test/auth/confirm#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    assert.deepEqual(result, { status: 'failed', message: rules.LINK_EXPIRED_TEXT });
    assert.equal(setSessionCalls.length, 0);
  });

  await test('confirmar: si la sesión falla se dice por qué', async () => {
    setSessionResult = { data: { session: null }, error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token' } };
    const result = await service.completeEmailConfirmation('https://app.example.test/auth/confirm#access_token=AT&refresh_token=RT');
    assert.deepEqual(result, { status: 'failed', message: 'Invalid Refresh Token' });
    setSessionResult = { data: { session: {} }, error: null };
  });

  await test('confirmar sin enlace: vale la sesión ya confirmada; si no, "no_link"', async () => {
    setSessionCalls.length = 0;
    getSessionResult = { data: { session: { user: { email_confirmed_at: '2026-10-15T10:00:00Z' } } }, error: null };
    assert.deepEqual(await service.completeEmailConfirmation('https://app.example.test/auth/confirm'), { status: 'confirmed' });
    getSessionResult = { data: { session: { user: { email_confirmed_at: null } } }, error: null };
    assert.deepEqual(await service.completeEmailConfirmation('https://app.example.test/auth/confirm'), { status: 'no_link' });
    getSessionResult = { data: { session: null }, error: null };
    assert.deepEqual(await service.completeEmailConfirmation(''), { status: 'no_link' });
    assert.equal(setSessionCalls.length, 0);
  });

  // ── Las pantallas ────────────────────────────────────────────────────────

  await test('los dos altas mandan el enlace de vuelta y reparten los tres resultados', () => {
    for (const [file, rpc] of [
      ['app/auth/signup/technician.tsx', 'signup_technician'],
      ['app/auth/signup/company.tsx', 'signup_company'],
    ] as const) {
      const source = read(file);
      assert.match(source, /emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL/, `${file}: sin enlace de vuelta`);
      assert.match(source, /signUpOutcome\(data\)/, `${file}: no mira el resultado del alta`);
      assert.match(source, /outcome === 'already_registered'[\s\S]*?setError\(ALREADY_REGISTERED_TEXT\)/, `${file}: ya registrado`);
      assert.match(source, /outcome === 'needs_confirmation'[\s\S]*?checkEmailHref\(email\.trim\(\), 'signup'\)/, `${file}: por confirmar`);
      // Confirmación desactivada: el camino de siempre, RPC y pending-verification.
      const signedIn = source.slice(source.indexOf("outcome === 'needs_confirmation'"));
      assert.match(signedIn, new RegExp(`supabase\\.rpc\\('${rpc}'`), `${file}: sin RPC con sesión`);
      assert.match(signedIn, /router\.replace\('\/auth\/pending-verification'/, `${file}: sin pending-verification`);
    }
  });

  await test('login: sin confirmar lleva a "Check your email" con la dirección', () => {
    const source = read('app/auth/login.tsx');
    assert.match(source, /if \(emailNotConfirmed\)[\s\S]*?checkEmailHref\(email\.trim\(\), 'unconfirmed'\)/);
    const context = read('src/auth/AuthContext.tsx');
    assert.match(context, /emailNotConfirmed: isEmailNotConfirmed\(error\)/);
  });

  await test('la ficha se crea en cualquier primera sesión, no sólo al pulsar el enlace', () => {
    // Las cuentas ya confirmadas (revisores de Apple y Google) nunca pasan por
    // /auth/confirm: su ficha la crea AuthContext al iniciar sesión.
    const context = read('src/auth/AuthContext.tsx');
    assert.match(context, /await ensureRoleProfile\(s\.user\)/);
    const confirm = read('app/auth/confirm.tsx');
    assert.doesNotMatch(confirm, /signup_technician|signup_company/);
    assert.match(confirm, /completeEmailConfirmation\(url\)/);
    // Los tokens salen de la barra de direcciones antes de usarse.
    assert.ok(confirm.indexOf('cleanUrl();') < confirm.indexOf('completeEmailConfirmation(url)'));
  });

  await test('"Check your email" reenvía con espera y vuelve al login', () => {
    const source = read('app/auth/check-email.tsx');
    assert.match(source, /resendSignupConfirmation\(email\)/);
    assert.match(source, /reason === 'signup' \? Date\.now\(\) \+ RESEND_COOLDOWN_SECONDS \* 1000 : 0/);
    assert.match(source, /router\.replace\('\/auth\/login'/);
  });

  await test('las pantallas no llaman a Supabase directamente', () => {
    for (const file of ['app/auth/check-email.tsx', 'app/auth/confirm.tsx']) {
      assert.doesNotMatch(read(file), /lib\/supabase/, file);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
