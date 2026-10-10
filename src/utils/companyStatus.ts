// Cómo se pinta cada estado en las pantallas de empresa del rediseño (fase 3;
// maquetas W-Applications, W-Direct, C-Offers, W-Offer). Pura, sin React, para
// poder probarla: scripts/testCompanyNavigation.ts.
//
// Sólo los estados REALES (respuestas 16 y 19 de la revisión): una candidatura
// o una oferta directa está pendiente, aceptada, rechazada, retirada o
// caducada; no hay "leído / no leído" ni se inventa ninguno.
import type { OfferRequestStatus, OfferStatus } from '../types/enums';
import type { UiTone } from '../theme/ui';

export interface StatusLook {
  label: string;
  tone: UiTone;
}

const FINISHED: readonly OfferRequestStatus[] = ['rejected', 'withdrawn', 'expired'];

/**
 * Una candidatura. En la lista una pendiente dice "Needs review" y en su página
 * "Pending review", como antes del rediseño.
 */
export function applicationStatusLook(status: OfferRequestStatus, place: 'list' | 'detail' = 'list'): StatusLook {
  switch (status) {
    case 'pending': return { label: place === 'list' ? 'Needs review' : 'Pending review', tone: 'warning' };
    case 'accepted': return { label: 'Accepted', tone: 'success' };
    case 'rejected': return { label: 'Rejected', tone: 'closed' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'closed' };
    case 'expired': return { label: 'Expired', tone: 'closed' };
    default: return { label: String(status), tone: 'muted' };
  }
}

/** Una oferta directa enviada por la empresa. "rejected" lo dice el técnico: "Declined". */
export function directOfferStatusLook(status: OfferRequestStatus): StatusLook {
  switch (status) {
    case 'pending': return { label: 'Awaiting response', tone: 'waiting' };
    case 'accepted': return { label: 'Accepted', tone: 'success' };
    case 'rejected': return { label: 'Declined', tone: 'closed' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'closed' };
    case 'expired': return { label: 'Expired', tone: 'closed' };
    default: return { label: String(status), tone: 'muted' };
  }
}

/** Una oferta de empleo de la empresa. */
export function offerStatusLook(status: OfferStatus): StatusLook {
  switch (status) {
    case 'published': return { label: 'Published', tone: 'success' };
    case 'draft': return { label: 'Draft', tone: 'warning' };
    case 'closed': return { label: 'Closed', tone: 'closed' };
    case 'expired': return { label: 'Expired', tone: 'error' };
    case 'archived': return { label: 'Archived', tone: 'closed' };
    default: return { label: String(status), tone: 'muted' };
  }
}

/** Ya no espera nada de nadie: la fila se pinta atenuada. */
export function isFinishedRelation(status: OfferRequestStatus): boolean {
  return FINISHED.includes(status);
}

/**
 * La etiqueta de un técnico en la lista de una oferta: qué relación tiene con
 * ella. Mismos textos que antes del rediseño ("Application pending").
 */
export function offerRelationLook(kind: 'application' | 'direct_offer', status: OfferRequestStatus): StatusLook {
  const prefix = kind === 'application' ? 'Application' : 'Direct offer';
  const tone: UiTone = status === 'accepted'
    ? 'success'
    : status === 'pending'
      ? (kind === 'application' ? 'warning' : 'waiting')
      : 'closed';
  return { label: `${prefix} ${status}`, tone };
}

// ── Filtros de estado ──────────────────────────────────────────────────────

/** Candidaturas y ofertas directas: All, Pending, Accepted y Rejected/Declined. */
export type RelationFilter = 'all' | 'pending' | 'accepted' | 'rejected';
export const RELATION_FILTERS: readonly RelationFilter[] = ['all', 'pending', 'accepted', 'rejected'];

export function matchesRelationFilter(status: OfferRequestStatus, filter: RelationFilter): boolean {
  return filter === 'all' || status === filter;
}

export function relationFilterCounts(statuses: readonly OfferRequestStatus[]): Record<RelationFilter, number> {
  const counts: Record<RelationFilter, number> = { all: 0, pending: 0, accepted: 0, rejected: 0 };
  for (const s of statuses) {
    for (const f of RELATION_FILTERS) if (matchesRelationFilter(s, f)) counts[f]++;
  }
  return counts;
}

/**
 * Ofertas: All, Published, Drafts y Closed. "Closed" reúne todo lo que ya no
 * está abierto a técnicos: cerradas, caducadas y archivadas (maqueta C-Offers).
 */
export type OfferListFilter = 'all' | 'published' | 'draft' | 'closed';
export const OFFER_LIST_FILTERS: readonly OfferListFilter[] = ['all', 'published', 'draft', 'closed'];

export function matchesOfferListFilter(status: OfferStatus, filter: OfferListFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'closed') return status === 'closed' || status === 'expired' || status === 'archived';
  return status === filter;
}

export function offerListFilterCounts(statuses: readonly OfferStatus[]): Record<OfferListFilter, number> {
  const counts: Record<OfferListFilter, number> = { all: 0, published: 0, draft: 0, closed: 0 };
  for (const s of statuses) {
    for (const f of OFFER_LIST_FILTERS) if (matchesOfferListFilter(s, f)) counts[f]++;
  }
  return counts;
}

// ── You: actividad ─────────────────────────────────────────────────────────

/**
 * "Marketplace activity" de You (respuesta 21): ofertas directas enviadas,
 * aceptadas y esperando respuesta. Mismos números que antes del rediseño, que
 * los contaba sobre la versión V1 de las ofertas directas (pendiente → "sent").
 */
export function directOfferActivity(statuses: readonly OfferRequestStatus[]): { sent: number; accepted: number; awaiting: number } {
  return {
    sent: statuses.length,
    accepted: statuses.filter((s) => s === 'accepted').length,
    awaiting: statuses.filter((s) => s === 'pending').length,
  };
}

/** "2 members · 1 admin, 1 recruiter" (fila Team access de You). */
export function teamSummaryLine(roles: readonly ('admin' | 'recruiter' | 'viewer')[]): string {
  const total = roles.length;
  const head = `${total} member${total === 1 ? '' : 's'}`;
  const parts = (['admin', 'recruiter', 'viewer'] as const)
    .map((role) => {
      const n = roles.filter((r) => r === role).length;
      return n > 0 ? `${n} ${role}${n === 1 ? '' : 's'}` : null;
    })
    .filter(Boolean);
  return parts.length > 0 ? `${head} · ${parts.join(', ')}` : head;
}
