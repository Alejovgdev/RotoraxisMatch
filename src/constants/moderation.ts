/**
 * Aviso por correo de cada denuncia nueva a soporte, con la función
 * supabase/functions/notify-report (Resend).
 *
 * Apagado hasta tener el correo propio: la función está en el repo pero sin
 * desplegar, y llamarla sólo daría un error en la consola. Mientras tanto la
 * denuncia se guarda igual (content_reports, notified_at NULL) y soporte la ve
 * en Supabase. Cómo encenderlo: docs/MODERATION.md.
 */
export const REPORT_EMAIL_NOTIFICATIONS_ENABLED = false;
