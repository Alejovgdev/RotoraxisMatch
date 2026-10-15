// Denunciar y bloquear (migración 100; norma 1.2 de App Store y política de
// contenido de usuarios de Google Play). Reglas puras, sin red: los motivos,
// los textos y qué ofrece cada menú. La base es la que impone todo (quién puede
// denunciar qué, quién bloquea, qué deja de funcionar con un bloqueo); esto
// sólo decide qué se pinta y qué se dice.

export type ReportTargetType = 'technician_profile' | 'offer' | 'chat_message';
export type ReportReason = 'offensive' | 'harassment' | 'spam_scam' | 'misleading' | 'other';

export interface ReportTarget {
  type: ReportTargetType;
  id: string;
}

/** Los mismos códigos, en el mismo orden, que el CHECK de content_reports. */
export const REPORT_REASONS: ReadonlyArray<{ code: ReportReason; label: string }> = [
  { code: 'offensive', label: 'Offensive or inappropriate' },
  { code: 'harassment', label: 'Harassment or threats' },
  { code: 'spam_scam', label: 'Spam or scam' },
  { code: 'misleading', label: 'False or misleading' },
  { code: 'other', label: 'Something else' },
];

export const REPORT_TITLES: Record<ReportTargetType, string> = {
  technician_profile: 'Report profile',
  offer: 'Report offer',
  chat_message: 'Report message',
};

export const REPORT_SHEET_SUBTITLE = 'Why are you reporting this?';
export const REPORT_SENT = { title: 'Report sent', message: 'Thank you. Our team will review it promptly.' };
export const REPORT_ALREADY_SENT = { title: 'Already reported', message: 'You have already reported this. Our team will review it promptly.' };
export const REPORT_FAILED_TITLE = 'Could not send the report';

/** La otra parte, vista desde quien bloquea. */
export type BlockCounterpart = 'company' | 'technician';

export function blockLabel(counterpart: BlockCounterpart): string {
  return counterpart === 'company' ? 'Block company' : 'Block technician';
}

export const BLOCKED_LABEL = 'Blocked';

export function blockConfirmOptions(counterpart: BlockCounterpart, name?: string | null) {
  const who = name?.trim() || (counterpart === 'company' ? 'this company' : 'this technician');
  return {
    title: `Block ${who}?`,
    message:
      "You won't be able to message each other, and applications and direct offers between you can't be sent or accepted. "
      + 'Your conversation disappears for both of you. To undo this, contact support.',
    confirmLabel: 'Block',
    destructive: true,
  };
}

export const BLOCKED_NOTICE = {
  title: 'Blocked',
  message: "You won't be able to message each other or send or accept applications and direct offers.",
};
export const BLOCK_FAILED_TITLE = 'Could not block';

/** Lo que dice la app cuando la base rechaza por un bloqueo (100). */
export const CONTACT_BLOCKED_TEXT =
  'Contact between you has been blocked, so this can no longer be sent or accepted.';

/** El rechazo del trigger enforce_contact_not_blocked: PT403 con el motivo en `details`. */
export function isContactBlockedError(error: { code?: string; details?: string | null } | null | undefined): boolean {
  return error?.code === 'PT403' && error?.details === 'contact_blocked';
}

export function throwIfContactBlocked(error: { code?: string; details?: string | null } | null | undefined): void {
  if (isContactBlockedError(error)) throw new Error(CONTACT_BLOCKED_TEXT);
}

/**
 * Cómo se denuncia un mensaje: en web, una banderita junto a la hora de cada
 * mensaje de la otra parte; en iOS y Android, mantenerlo pulsado.
 */
export function reportMessageHint(platform: string): string {
  return platform === 'web'
    ? 'To report a message, select the flag next to it.'
    : 'To report a message, press and hold it.';
}

export type ModerationMenuItem =
  | { key: 'report'; label: string }
  | { key: 'block'; label: string; disabled: boolean };

/**
 * Lo que ofrece el "⋯". `blocked`: true si ya hay bloqueo entre las dos partes
 * (sea quien sea quien lo puso), null mientras no se sabe. Bloqueado no se
 * quita desde la app: el elemento queda como "Blocked", desactivado.
 */
export function moderationMenuItems({
  report,
  block,
}: {
  report?: ReportTargetType | null;
  block?: { counterpart: BlockCounterpart; blocked: boolean | null } | null;
}): ModerationMenuItem[] {
  const items: ModerationMenuItem[] = [];
  if (report) items.push({ key: 'report', label: REPORT_TITLES[report] });
  if (block) {
    items.push(block.blocked
      ? { key: 'block', label: BLOCKED_LABEL, disabled: true }
      : { key: 'block', label: blockLabel(block.counterpart), disabled: false });
  }
  return items;
}
