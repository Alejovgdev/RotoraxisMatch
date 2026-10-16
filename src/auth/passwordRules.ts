// La regla de la contraseña al CREARLA o CAMBIARLA (alta de técnico, alta de
// empresa y /auth/set-password, que sirve a invitaciones y recuperación). Un
// solo sitio para que los formularios no puedan pedir mínimos distintos;
// `npm run test:password-rules` comprueba que todos la usan.
//
// Supabase Auth tiene su propio mínimo (Authentication → Sign In / Providers →
// Email → Minimum password length) y debe valer lo mismo. Si el del servidor
// fuera mayor, el usuario vería el mensaje de Supabase al enviar. Supabase
// cuenta bytes y `length` cuenta unidades UTF-16 (nunca más que bytes), así que
// lo que pasa aquí pasa también allí.
//
// Los textos van en inglés, como el resto de la app.

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_TOO_SHORT_TEXT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
export const PASSWORDS_DO_NOT_MATCH_TEXT = 'Passwords do not match.';
export const PASSWORD_PLACEHOLDER = `Min ${MIN_PASSWORD_LENGTH} characters`;

/** El error de una contraseña nueva y su repetición, o null si se puede enviar. */
export function newPasswordError(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_TOO_SHORT_TEXT;
  if (password !== confirmation) return PASSWORDS_DO_NOT_MATCH_TEXT;
  return null;
}
