// Confirmación del email al registrarse: las reglas puras, sin Supabase ni
// React Native, para poder probarlas en Node (`npm run test:email-confirmation`).
//
// La app funciona igual con la confirmación activada o desactivada en Supabase
// ("Confirm email"). Lo que decide el camino es la respuesta de signUp(), nunca
// una bandera propia:
//   - con sesión: la confirmación está desactivada y el alta sigue como siempre;
//   - sin sesión: hay que confirmar, y se va a "Check your email";
//   - sin sesión y sin identidades: el email ya tenía cuenta (Supabase no da
//     error en ese caso ni envía nada; lo decidido es decirlo en claro, igual
//     que ya lo dice con la confirmación desactivada).
//
// Los textos van en inglés, como el resto de la app.

export const CONFIRM_EMAIL_PATH = '/auth/confirm';
export const CHECK_EMAIL_PATH = '/auth/check-email';

/** Lo que Supabase obliga a esperar entre dos correos a la misma dirección. */
export const RESEND_COOLDOWN_SECONDS = 60;

export const ALREADY_REGISTERED_TEXT =
  'An account with this email already exists. Sign in or reset your password.';
export const NETWORK_ERROR_TEXT =
  "We couldn't reach the server. Check your connection and try again.";
export const LINK_EXPIRED_TEXT =
  'This link has expired or has already been used. If you already confirmed your email, just sign in.';
export const WAIT_BEFORE_RESEND_TEXT =
  'Please wait a moment before requesting another email.';
export const TOO_MANY_EMAILS_TEXT =
  'Too many emails have been sent. Please try again later.';
export const TOO_MANY_ATTEMPTS_TEXT =
  'Too many attempts. Please wait a few minutes and try again.';
const FALLBACK_ERROR_TEXT = 'Something went wrong. Please try again.';

/** Adónde lleva el enlace del correo. `appUrl` es EXPO_PUBLIC_APP_URL. */
export function confirmEmailRedirectUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}${CONFIRM_EMAIL_PATH}`;
}

export type CheckEmailReason = 'signup' | 'unconfirmed';

/**
 * `signup`: se acaba de enviar el correo. `unconfirmed`: alguien intentó entrar
 * sin haber confirmado y no se ha enviado nada todavía.
 */
export function checkEmailHref(email: string, reason: CheckEmailReason): string {
  return `${CHECK_EMAIL_PATH}?email=${encodeURIComponent(email)}&reason=${reason}`;
}

export type SignUpOutcome = 'signed_in' | 'needs_confirmation' | 'already_registered';

export function signUpOutcome(data: {
  session: unknown;
  user: { identities?: unknown[] | null } | null;
}): SignUpOutcome {
  if (data.session) return 'signed_in';
  // Con la confirmación activada, un email que ya tiene cuenta confirmada
  // devuelve un usuario de pega sin identidades, sin error y sin enviar correo.
  const identities = data.user?.identities;
  if (Array.isArray(identities) && identities.length === 0) return 'already_registered';
  return 'needs_confirmation';
}

/** La forma mínima de un AuthError de supabase-js que miran estas reglas. */
export interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

export function isEmailNotConfirmed(error: AuthErrorLike | null | undefined): boolean {
  return error?.code === 'email_not_confirmed';
}

/**
 * Los segundos que Supabase pide esperar antes de otro correo ("For security
 * purposes, you can only request this after 42 seconds."), o null si el error
 * no es ése.
 */
export function retryAfterSeconds(error: AuthErrorLike | null | undefined): number | null {
  if (!error) return null;
  const match = /after (\d+) seconds?/i.exec(error.message ?? '');
  return match ? Number(match[1]) : null;
}

function isNetworkError(error: AuthErrorLike): boolean {
  return (
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    /failed to fetch|network request failed|load failed/i.test(error.message ?? '')
  );
}

/** El texto que ve el usuario para un error de Supabase Auth. */
export function authErrorText(error: AuthErrorLike | null | undefined): string {
  if (!error) return FALLBACK_ERROR_TEXT;
  if (isNetworkError(error)) return NETWORK_ERROR_TEXT;
  switch (error.code) {
    case 'user_already_exists':
    case 'email_exists':
      return ALREADY_REGISTERED_TEXT;
    case 'email_not_confirmed':
      return 'Confirm your email before signing in.';
    case 'otp_expired':
      return LINK_EXPIRED_TEXT;
    case 'over_email_send_rate_limit':
      // El mismo código sirve para "espera N segundos" (por dirección) y para
      // el tope de correos por hora del proyecto.
      return retryAfterSeconds(error) !== null ? WAIT_BEFORE_RESEND_TEXT : TOO_MANY_EMAILS_TEXT;
    case 'over_request_rate_limit':
      return TOO_MANY_ATTEMPTS_TEXT;
    default:
      return error.message?.trim() || FALLBACK_ERROR_TEXT;
  }
}

/** Lo que trae la URL a la que vuelve el enlace del correo. */
export interface AuthCallbackParams {
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  errorCode?: string;
  errorDescription?: string;
}

/**
 * Supabase vuelve con los tokens en el hash (flujo implícito, el de este
 * cliente) y con los errores en el hash o en la query, según la versión.
 */
export function readAuthCallbackParams(url: string): AuthCallbackParams {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const get = (key: string) => hash.get(key) ?? parsed.searchParams.get(key) ?? undefined;
    return {
      accessToken: get('access_token'),
      refreshToken: get('refresh_token'),
      error: get('error'),
      errorCode: get('error_code'),
      errorDescription: get('error_description'),
    };
  } catch {
    return {};
  }
}

export function callbackHasError(params: AuthCallbackParams): boolean {
  return Boolean(params.error || params.errorCode || params.errorDescription);
}

/** El texto para un enlace del correo que Supabase rechazó. */
export function confirmationLinkErrorText(params: AuthCallbackParams): string {
  // Un enlace caducado y uno ya usado llegan igual: `otp_expired`, o
  // `access_denied` sin código en servidores más viejos.
  if (params.errorCode === 'otp_expired' || params.error === 'access_denied') {
    return LINK_EXPIRED_TEXT;
  }
  return params.errorDescription?.trim() || LINK_EXPIRED_TEXT;
}
