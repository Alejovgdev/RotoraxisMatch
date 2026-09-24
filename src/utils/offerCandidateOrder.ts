// En qué orden lista el detalle de oferta de empresa a sus técnicos.
//
// Tres grupos: con candidatura, con oferta directa, sin relación. Dentro de
// los dos primeros, por estado (accepted, pending, rejected, y después
// expired/withdrawn); dentro de cada estado, y en el grupo sin relación, por
// puntuación.
//
// Ajustes finales de Fase 10 — UNA CANDIDATURA RETIRADA NO CUENTA PARA EL
// ORDEN. La retiró el técnico: no hay nada que revisar, y en el grupo de
// candidaturas subía por encima de técnicos mejor puntuados sin relación. Se
// ordena como si no existiera (con los sin relación, o con su oferta directa si
// la tiene); la etiqueta "Withdrawn" la sigue pintando la pantalla, que no lee
// de aquí.
import { OfferRequestStatus } from '../types/enums';

export const OFFER_RELATION_STATUS_ORDER: Record<OfferRequestStatus, number> = {
  accepted: 0,
  pending: 1,
  rejected: 2,
  expired: 3,
  withdrawn: 3,
};

export interface OfferCandidateOrderEntry {
  applicationStatus?: OfferRequestStatus;
  directOfferStatus?: OfferRequestStatus;
  total: number;
}

function orderKey(entry: OfferCandidateOrderEntry): { group: number; status: number } {
  const application = entry.applicationStatus === 'withdrawn' ? undefined : entry.applicationStatus;
  if (application) return { group: 0, status: OFFER_RELATION_STATUS_ORDER[application] ?? 4 };
  if (entry.directOfferStatus) return { group: 1, status: OFFER_RELATION_STATUS_ORDER[entry.directOfferStatus] ?? 4 };
  return { group: 2, status: 10 };
}

export function compareOfferCandidates(a: OfferCandidateOrderEntry, b: OfferCandidateOrderEntry): number {
  const keyA = orderKey(a);
  const keyB = orderKey(b);
  if (keyA.group !== keyB.group) return keyA.group - keyB.group;
  if (keyA.status !== keyB.status) return keyA.status - keyB.status;
  return b.total - a.total;
}
