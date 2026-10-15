// Confirmación del email: las llamadas a Supabase Auth. Las pantallas pasan por
// aquí y no tocan el cliente directamente. Las reglas puras viven en
// `emailConfirmationRules.ts`.
import { supabase } from '../lib/supabase';
import { APP_PUBLIC_URL } from '../lib/appUrl';
import {
  authErrorText,
  callbackHasError,
  confirmationLinkErrorText,
  confirmEmailRedirectUrl,
  readAuthCallbackParams,
  retryAfterSeconds,
} from './emailConfirmationRules';

/**
 * El `emailRedirectTo` del alta y del reenvío. Supabase sólo lo respeta si la
 * dirección está en "Redirect URLs" del proyecto; si no, manda al Site URL.
 */
export const EMAIL_CONFIRMATION_REDIRECT_URL = confirmEmailRedirectUrl(APP_PUBLIC_URL);

export type ResendResult =
  | { ok: true }
  | { ok: false; message: string; retryAfterSeconds: number | null };

export async function resendSignupConfirmation(email: string): Promise<ResendResult> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL },
  });
  if (!error) return { ok: true };
  return { ok: false, message: authErrorText(error), retryAfterSeconds: retryAfterSeconds(error) };
}

export type EmailConfirmationResult =
  | { status: 'confirmed' }
  | { status: 'failed'; message: string }
  /** Se abrió la pantalla sin el enlace del correo y sin sesión confirmada. */
  | { status: 'no_link' };

/**
 * Completa la vuelta del enlace del correo. Supabase ya ha confirmado el email
 * antes de redirigir; aquí se inicia la sesión con los tokens que trae, para
 * que AuthContext cree la ficha de técnico o empresa en ese momento (como en
 * cualquier primer inicio de sesión) y el equipo pueda revisar la identidad
 * aunque el usuario no vuelva a entrar.
 */
export async function completeEmailConfirmation(url: string): Promise<EmailConfirmationResult> {
  const params = readAuthCallbackParams(url);
  if (callbackHasError(params)) {
    return { status: 'failed', message: confirmationLinkErrorText(params) };
  }

  if (params.accessToken && params.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (error) return { status: 'failed', message: authErrorText(error) };
    return { status: 'confirmed' };
  }

  // Sin tokens: una recarga después de limpiar la URL. Si ya hay una sesión
  // con el email confirmado, el resultado es el mismo.
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.email_confirmed_at) return { status: 'confirmed' };
  return { status: 'no_link' };
}
