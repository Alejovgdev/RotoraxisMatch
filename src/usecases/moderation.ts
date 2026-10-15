// Denunciar y bloquear (migración 100): lo que llaman las pantallas.
import { moderationRepository } from '../repositories/v2/moderationRepository';
import { REPORT_EMAIL_NOTIFICATIONS_ENABLED } from '../constants/moderation';
import type { ReportReason, ReportTarget } from '../utils/moderation';

export interface ModerationDeps {
  report: typeof moderationRepository.reportContent;
  block: typeof moderationRepository.blockContact;
  isBlocked: typeof moderationRepository.isContactBlocked;
  notify: typeof moderationRepository.notifyReport;
  notificationsEnabled: boolean;
}

const defaultDeps: ModerationDeps = {
  report: (...args) => moderationRepository.reportContent(...args),
  block: (...args) => moderationRepository.blockContact(...args),
  isBlocked: (...args) => moderationRepository.isContactBlocked(...args),
  notify: (...args) => moderationRepository.notifyReport(...args),
  notificationsEnabled: REPORT_EMAIL_NOTIFICATIONS_ENABLED,
};

/**
 * Guarda la denuncia y, si es nueva y el aviso está encendido, avisa a soporte.
 * El aviso no se espera ni puede hacer fallar la denuncia: ya está guardada, y
 * si el correo no sale queda con notified_at NULL, visible para soporte.
 */
export async function submitReport(
  target: ReportTarget,
  reason: ReportReason,
  deps: ModerationDeps = defaultDeps,
): Promise<{ alreadyReported: boolean }> {
  const { reportId, alreadyReported } = await deps.report(target.type, target.id, reason);
  if (!alreadyReported && deps.notificationsEnabled) {
    deps.notify(reportId).catch(() => {});
  }
  return { alreadyReported };
}

export function blockContact(companyId: string, technicianId: string, deps: ModerationDeps = defaultDeps): Promise<void> {
  return deps.block(companyId, technicianId);
}

export function isContactBlocked(companyId: string, technicianId: string, deps: ModerationDeps = defaultDeps): Promise<boolean> {
  return deps.isBlocked(companyId, technicianId);
}
