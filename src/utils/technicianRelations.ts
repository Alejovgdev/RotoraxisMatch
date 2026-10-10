// Lógica pura de las ofertas directas recibidas y de las candidaturas del
// técnico (rediseño, fase 5B; maqueta T-Direct y el patrón de las listas de
// empresa). Sin React ni repositorios: scripts/testTechnicianRelations.ts.
//
// Estados, orden y filtros son los de antes del rediseño; sólo cambia el
// aspecto. Los tonos siguen la regla del rediseño: ámbar lo que espera,
// verde lo aceptado y gris lo que ya terminó.
import type { OfferRequestStatus, OfferStatus } from '../types/enums';
import type { ChatMessage } from '../types/chat';
import type { UiTone } from '../theme/ui';

export interface RelationLook {
  label: string;
  tone: UiTone;
}

const FINISHED: readonly OfferRequestStatus[] = ['rejected', 'withdrawn', 'expired'];

/** Ya no espera nada de nadie: la fila se pinta atenuada. */
export function isFinishedStatus(status: OfferRequestStatus): boolean {
  return FINISHED.includes(status);
}

// ── Ofertas directas recibidas ─────────────────────────────────────────────

/** Los rótulos de antes: "rejected" lo dijo el técnico, así que es "Declined". */
export function technicianDirectOfferStatusLook(status: OfferRequestStatus): RelationLook {
  switch (status) {
    case 'pending': return { label: 'Pending', tone: 'warning' };
    case 'accepted': return { label: 'Accepted', tone: 'success' };
    case 'rejected': return { label: 'Declined', tone: 'closed' };
    case 'expired': return { label: 'Expired', tone: 'closed' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'closed' };
    default: return { label: String(status), tone: 'muted' };
  }
}

const DIRECT_OFFER_ORDER: Record<string, number> = { pending: 0, accepted: 1, rejected: 2, expired: 3, withdrawn: 4 };

/** El orden de antes: novedades sin leer primero, luego por estado y lo más nuevo arriba. */
export function sortDirectOffers<T extends { request: { id: string; status: OfferRequestStatus; createdAt: string } }>(
  entries: readonly T[],
  isUnread: (requestId: string) => boolean,
): T[] {
  return [...entries].sort((a, b) => {
    const aUnread = isUnread(a.request.id) ? 0 : 1;
    const bUnread = isUnread(b.request.id) ? 0 : 1;
    if (aUnread !== bUnread) return aUnread - bUnread;
    const so = (DIRECT_OFFER_ORDER[a.request.status] ?? 9) - (DIRECT_OFFER_ORDER[b.request.status] ?? 9);
    if (so !== 0) return so;
    return b.request.createdAt.localeCompare(a.request.createdAt);
  });
}

/**
 * ¿Se puede aceptar o rechazar? Como antes: sólo si está pendiente y, si va
 * ligada a una oferta, esa oferta sigue abierta (si no, "Offer closed" y sin
 * botones). `linkedOfferOpen` es isOfferOpenForTechnicians(oferta).
 */
export function canRespondToDirectOffer(
  request: { status: OfferRequestStatus; offerId?: string | null },
  linkedOfferOpen: boolean,
): boolean {
  if (request.status !== 'pending') return false;
  return !request.offerId || linkedOfferOpen;
}

/** Pendiente pero con su oferta cerrada: no se puede aceptar (aviso "Offer closed"). */
export function isDirectOfferBlockedByClosedOffer(
  request: { status: OfferRequestStatus; offerId?: string | null },
  linkedOfferOpen: boolean,
): boolean {
  return request.status === 'pending' && Boolean(request.offerId) && !linkedOfferOpen;
}

// ── Candidaturas ───────────────────────────────────────────────────────────

/** Los filtros que ya existían: All, Pending, Accepted y Closed (rechazada, retirada o caducada). */
export type TechnicianApplicationFilter = 'all' | 'pending' | 'accepted' | 'closed';
export const TECHNICIAN_APPLICATION_FILTERS: readonly TechnicianApplicationFilter[] = ['all', 'pending', 'accepted', 'closed'];
export const TECHNICIAN_APPLICATION_FILTER_LABELS: Record<TechnicianApplicationFilter, string> = {
  all: 'All',
  pending: 'Pending',
  accepted: 'Accepted',
  closed: 'Closed',
};

export function matchesApplicationFilter(status: OfferRequestStatus, filter: TechnicianApplicationFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'closed') return isFinishedStatus(status);
  return status === filter;
}

export function applicationFilterCounts(statuses: readonly OfferRequestStatus[]): Record<TechnicianApplicationFilter, number> {
  const counts = { all: 0, pending: 0, accepted: 0, closed: 0 };
  for (const status of statuses) {
    for (const filter of TECHNICIAN_APPLICATION_FILTERS) {
      if (matchesApplicationFilter(status, filter)) counts[filter]++;
    }
  }
  return counts;
}

/** Los rótulos de la lista de antes. */
export function technicianApplicationListLook(status: OfferRequestStatus): RelationLook {
  switch (status) {
    case 'pending': return { label: 'Pending review', tone: 'warning' };
    case 'accepted': return { label: 'Accepted', tone: 'success' };
    case 'rejected': return { label: 'Not selected', tone: 'closed' };
    case 'expired': return { label: 'Expired', tone: 'closed' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'closed' };
    default: return { label: String(status), tone: 'muted' };
  }
}

/** La etiqueta de la oferta cuando ya no está publicada (como antes; publicada, ninguna). */
export function applicationOfferStatusLook(status: OfferStatus | null | undefined): RelationLook | null {
  if (status === 'closed') return { label: 'Offer closed', tone: 'closed' };
  if (status === 'expired') return { label: 'Offer expired', tone: 'closed' };
  if (status === 'draft') return { label: 'Offer draft', tone: 'warning' };
  return null;
}

const APPLICATION_ORDER: readonly OfferRequestStatus[] = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired'];

/** El orden de antes: novedades sin leer primero, luego por estado y lo más nuevo arriba. */
export function sortApplications<T extends { app: { id: string; status: OfferRequestStatus; createdAt: string } }>(
  entries: readonly T[],
  isUnread: (applicationId: string) => boolean,
): T[] {
  return [...entries].sort((a, b) => {
    const aUnread = isUnread(a.app.id) ? 0 : 1;
    const bUnread = isUnread(b.app.id) ? 0 : 1;
    if (aUnread !== bUnread) return aUnread - bUnread;
    const ai = APPLICATION_ORDER.indexOf(a.app.status);
    const bi = APPLICATION_ORDER.indexOf(b.app.status);
    if (ai !== bi) return ai - bi;
    return new Date(b.app.createdAt).getTime() - new Date(a.app.createdAt).getTime();
  });
}

// ── Inbox ──────────────────────────────────────────────────────────────────

/** El último mensaje de una conversación, con "You: " si lo escribió el técnico (como antes). */
export function technicianMessagePreview(message: Pick<ChatMessage, 'senderRole' | 'body'> | null): string {
  if (!message) return 'No messages yet';
  return `${message.senderRole === 'technician' ? 'You: ' : ''}${message.body}`;
}
