import { OfferRequestStatus } from '../types/enums';
import { ActivityType } from '../types/activity';

export type OfferRelationKind = 'direct_offer' | 'application';

// `withdrawn` NO esta aqui desde 2026-07-28: es reversible, ver abajo.
const TERMINAL_STATUSES = new Set<OfferRequestStatus>([
  'accepted',
  'rejected',
  'expired',
]);

// withdrawn -> pending (2026-07-28): retirarse NO es lo mismo que ser
// rechazado, y que un tecnico que se echa atras quede vetado de por vida de
// esa oferta era un efecto colateral de la regla H6 (una aplicacion por
// oferta), no una decision de producto. En las plataformas de empleo
// retirarse no te veta.
//
// Se REACTIVA LA MISMA FILA, nunca se inserta una nueva: asi
// UNIQUE(technician_id, offer_id) sigue intacto y el historial (created_at,
// la fila original) se conserva.
//
// `rejected` sigue siendo terminal, a proposito: la asimetria es deliberada
// — la empresa dijo que no, y el tecnico no puede insistir.
//
// ── POR QUE LA TABLA DEPENDE DEL TIPO DE RELACION ────────────────────
// La reactivacion se permite SOLO en 'application', nunca en
// 'direct_offer', y no es una omision:
//
//   - offer_applications tiene UNIQUE(technician_id, offer_id) TOTAL, asi
//     que insertar una segunda fila es imposible: reactivar es la UNICA
//     forma de volver a aplicar.
//   - offer_requests tiene un unico PARCIAL (uq_offer_requests_one_active,
//     solo sobre estados activos), asi que tras retirar una oferta directa
//     la empresa simplemente crea una fila NUEVA — camino que ya existe y
//     ya funciona. Reactivar ahi no haria falta, y ademas seria peligroso:
//     reactivar una retirada mientras existe otra activa para el mismo par
//     chocaria con ese indice parcial con un error crudo de Postgres.
//
// Esta funcion tiene su ESPEJO EXACTO en la base de datos
// (assert_offer_relation_transition, migracion 033), que es quien enforcea
// de verdad — esta version de TypeScript no tiene call sites en produccion,
// es especificacion y cobertura de tests. Si cambias una, cambia la otra:
// una regla con dos implementaciones que divergen es el bug que la 033
// vino a cerrar.
// EXPORTADA a propósito: es la ÚNICA DECLARACIÓN de la regla. El enforcer
// real es `assert_offer_relation_transition` en Postgres (migración 033), y
// `scripts/validateOfferStateMachine.ts` recorre esta tabla entera contra esa
// función en vivo para probar que coinciden. Sin ese script, esto sería un
// espejo que puede desviarse sin que ningún test lo note — ver la norma
// "una regla en dos sitios: barrera o spec declarada" en
// docs/MISSION_PART66.md.
export const ALLOWED_TRANSITIONS: Record<OfferRelationKind, Record<OfferRequestStatus, OfferRequestStatus[]>> = {
  application: {
    pending: ['accepted', 'rejected', 'expired', 'withdrawn'],
    accepted: [],
    rejected: [],
    expired: [],
    withdrawn: ['pending'],
  },
  direct_offer: {
    pending: ['accepted', 'rejected', 'expired', 'withdrawn'],
    accepted: [],
    rejected: [],
    expired: [],
    withdrawn: [],
  },
};

/**
 * QUIÉN hace cada transición (migración 092). `ALLOWED_TRANSITIONS` dice qué
 * cambio es válido; esto, qué parte de la relación puede hacerlo:
 *
 *   - 'company'    la empresa de la fila (admin o recruiter: can_act_for_company);
 *   - 'technician' el técnico de la fila;
 *   - 'system'     sólo el mantenimiento, nunca un usuario de la app.
 *
 * Aceptar o rechazar lo hace siempre la parte que RECIBE la propuesta —la
 * empresa en una candidatura, el técnico en una oferta directa— y retirar,
 * la que la hizo. Un admin de la plataforma no es ninguna de las dos partes y
 * no hace ninguna de estas transiciones en nombre de nadie.
 *
 * Mismo régimen que ALLOWED_TRANSITIONS: el enforcer es la base
 * (`offer_relation_transition_actor`, dentro de
 * handle_offer_relation_status_transition), esto es la declaración, y
 * `scripts/validateOfferStateMachine.ts` compara las dos sobre las 40
 * combinaciones. Una transición válida sin parte aquí es un error que el
 * validador y los tests señalan.
 */
export type OfferRelationActor = 'company' | 'technician' | 'system';

export const TRANSITION_ACTORS: Record<
  OfferRelationKind,
  Partial<Record<OfferRequestStatus, Partial<Record<OfferRequestStatus, OfferRelationActor>>>>
> = {
  application: {
    pending: { accepted: 'company', rejected: 'company', withdrawn: 'technician', expired: 'system' },
    withdrawn: { pending: 'technician' },
  },
  direct_offer: {
    pending: { accepted: 'technician', rejected: 'technician', withdrawn: 'company', expired: 'system' },
  },
};

/** La parte que puede hacer `from -> to`, o null si no hay cambio o la transición no existe. */
export function transitionActor(
  kind: OfferRelationKind,
  from: OfferRequestStatus,
  to: OfferRequestStatus,
): OfferRelationActor | null {
  if (from === to) return null;
  return TRANSITION_ACTORS[kind][from]?.[to] ?? null;
}

export function isActiveOfferRelationStatus(status: OfferRequestStatus): boolean {
  return status === 'pending' || status === 'accepted';
}

export function assertOfferRelationTransition(
  from: OfferRequestStatus,
  to: OfferRequestStatus,
  kind: OfferRelationKind,
): void {
  if (from === to) return;
  const allowed = ALLOWED_TRANSITIONS[kind][from] ?? [];
  if (!allowed.includes(to)) {
    const terminalHint = TERMINAL_STATUSES.has(from) ? ' Terminal records cannot be changed.' : '';
    const reactivationHint =
      from === 'withdrawn' && kind === 'direct_offer'
        ? ' A withdrawn direct offer is not reactivated — send a new one instead.'
        : '';
    throw new Error(`Invalid status transition from ${from} to ${to} (${kind}).${terminalHint}${reactivationHint}`);
  }
}

export function shouldUnlockAcceptedRelation(status: OfferRequestStatus): boolean {
  return status === 'accepted';
}

// Pure conflict checks backing offerRequestRepository.create() and
// offerApplicationRepository.create() — extracted so the branching that
// decides whether a new direct-offer/application is allowed can be unit
// tested without a live Supabase connection. Each repository stays
// responsible for fetching the rows; these functions only decide.

/**
 * Guard for offerRequestRepository.create() (a company sending a direct
 * offer to a technician). `existingRequests` must already be scoped to
 * this (companyId, technicianId) pair; `existingApplicationsForOffer`
 * must already be scoped to this (companyId, technicianId, offerId) —
 * pass `[]` when `offerId` is undefined (an open-ended direct offer has
 * no matching application table to check).
 */
export function evaluateDirectOfferConflict(
  existingRequests: { status: OfferRequestStatus; offerId?: string }[],
  existingApplicationsForOffer: { status: OfferRequestStatus }[],
  offerId: string | undefined,
): string | null {
  const activeRequest = existingRequests.find((request) =>
    isActiveOfferRelationStatus(request.status) &&
    (offerId ? request.offerId === offerId : !request.offerId),
  );
  if (activeRequest) return 'An active direct offer already exists for this technician.';

  if (offerId) {
    const activeApplication = existingApplicationsForOffer.find((application) =>
      isActiveOfferRelationStatus(application.status),
    );
    if (activeApplication) return 'This technician already has an active application for this offer.';
  }

  return null;
}

/**
 * Guard for offerApplicationRepository.create() (a technician applying to
 * an offer). One application per technician per offer, regardless of
 * status, was already decided and implemented once — see
 * docs/archive/V2_S0B_H6_ONE_APPLICATION_PER_OFFER_REPORT.md (2026-05-31), back
 * when this repository read/wrote a local JSON array. That guard clause
 * did not survive the rewrite to real Supabase queries — the ported
 * create() checked for a conflicting direct offer but never checked its
 * own table at all, silently regressing H6's rule (confirmed by reading
 * that report while auditing this method for Fase 3b hardening, not a
 * newly-invented rule). This function restores it.
 *
 * `existingActiveDirectOffer` is the technician's active direct offer for
 * this same offer, if any. `existingApplication` is the technician's own
 * offer_applications row for this offer, if any — at
 * most one can ever exist (UNIQUE(technician_id, offer_id), migration
 * 001) and its status can never be re-opened once terminal (rejected/
 * expired/withdrawn — see assertOfferRelationTransition/
 * assert_offer_relation_transition, both of which map every terminal
 * status to zero allowed outgoing transitions). So a terminal existing row
 * always blocks a new attempt too — same one-shot-per-offer rule, just a
 * friendlier message than the raw unique-constraint violation Postgres
 * would otherwise surface.
 */
export function evaluateApplicationConflict(
  existingActiveDirectOffer: { status: OfferRequestStatus } | undefined | null,
  existingApplication: { status: OfferRequestStatus } | undefined | null,
): string | null {
  if (existingActiveDirectOffer && isActiveOfferRelationStatus(existingActiveDirectOffer.status)) {
    return 'You already have a direct offer for this role. Review it from Direct Offers.';
  }

  if (existingApplication) {
    if (isActiveOfferRelationStatus(existingApplication.status)) {
      return 'You already have an active application for this offer.';
    }
    // withdrawn es el UNICO estado desde el que se puede volver: no bloquea,
    // reactiva la fila existente (ver ALLOWED_TRANSITIONS y
    // offerApplicationRepository.create). El orden importa — la comprobacion
    // de oferta directa activa de arriba se ejecuta ANTES, asi que si la
    // empresa mando una oferta directa despues de la retirada, reactivar
    // sigue bloqueado.
    if (existingApplication.status === 'withdrawn') return null;
    return 'You already applied to this offer previously — re-applying is not available once an application has been decided.';
  }

  return null;
}

export function getStatusActivityType(
  kind: OfferRelationKind,
  status: OfferRequestStatus,
): ActivityType | null {
  if (kind === 'direct_offer') {
    if (status === 'accepted') return 'direct_offer_accepted';
    if (status === 'rejected') return 'direct_offer_rejected';
    return null;
  }

  if (status === 'accepted') return 'application_accepted';
  if (status === 'rejected') return 'application_rejected';
  return null;
}
