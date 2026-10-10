// Lógica pura de la Home del técnico (rediseño, fase 5A; maqueta T-Home). Sin
// React ni repositorios, para poder probarla: scripts/testTechnicianNavigation.ts.
//
// La tarjeta "Best match for you" muestra lo que antes mostraba "Your next
// opportunity", con la MISMA regla: la mejor oferta sin bloqueos y sin relación
// previa con el técnico (una vez que una de las dos partes ha creado una
// candidatura o una oferta directa, su siguiente paso vive en Applications,
// Direct offers o el chat, y no se vuelve a recomendar), y sólo si llega a 40.
// Los textos (motivos, aviso y pistas para mejorar) son los de la Home vieja,
// movidos aquí sin cambiarlos.
import type { OfferMatchResult } from './matchingService';

/** Por debajo de esto la tarjeta no recomienda nada (como antes). */
export const MINIMUM_USEFUL_MATCH = 40;
/** Desde aquí la tarjeta dice "Best match"; por debajo, "Worth exploring" (como antes). */
export const STRONG_MATCH = 60;

export const HOME_OFFER_ROWS = 5;
export const HOME_OFFER_CARDS = 6;

export interface TechnicianHomeSummary {
  /** La mejor oferta recomendable, aunque no llegue a 40: de ella salen las pistas. */
  bestEligible: OfferMatchResult | null;
  /** La que va en la tarjeta: la anterior, sólo si llega a MINIMUM_USEFUL_MATCH. */
  featured: OfferMatchResult | null;
  /**
   * "Offers for you": las demás ofertas recomendables, en el orden del ranking
   * (de más a menos %). Mismo criterio que la tarjeta —sin bloqueos y sin
   * relación previa— y sin repetir la de la tarjeta.
   */
  offersForYou: OfferMatchResult[];
}

function isRecommendable(match: OfferMatchResult, relatedOfferIds: ReadonlySet<string>): boolean {
  return match.score.blockers.length === 0 && !relatedOfferIds.has(match.offer.id);
}

/**
 * `matches` llega ordenado de más a menos % (rankOffersForTechnician), igual
 * que lo leía la Home vieja con `find`.
 */
export function summarizeTechnicianHome(
  matches: readonly OfferMatchResult[],
  relatedOfferIds: ReadonlySet<string>,
  limit: number,
): TechnicianHomeSummary {
  const recommendable = matches.filter((m) => isRecommendable(m, relatedOfferIds));
  const bestEligible = recommendable[0] ?? null;
  const featured = bestEligible && bestEligible.score.total >= MINIMUM_USEFUL_MATCH ? bestEligible : null;
  const offersForYou = recommendable
    .filter((m) => m.offer.id !== featured?.offer.id)
    .slice(0, Math.max(0, limit));
  return { bestEligible, featured, offersForYou };
}

/** El rótulo de la tarjeta: "Best match for you" desde 60; por debajo, "Worth exploring". */
export function bestMatchKicker(total: number): string {
  return total >= STRONG_MATCH ? 'Best match for you' : 'Worth exploring';
}

/** Hasta tres motivos por los que encaja (los de la Home vieja). */
export function opportunityReasons(match: OfferMatchResult): string[] {
  const { score } = match;
  const qualificationReasons = score.matches.filter((reason) => reason !== 'Verified profile');
  const supportingReasons = [
    score.breakdown.contractFit > 0 ? 'Contract type fits your preferences' : null,
    score.breakdown.location > 0 ? 'Same country as your profile' : null,
    score.matches.includes('Verified profile') ? 'Verified profile' : null,
  ].filter((reason): reason is string => Boolean(reason));

  const reasons = [...new Set([...qualificationReasons, ...supportingReasons])].slice(0, 3);
  return reasons.length > 0 ? reasons : ['Some role requirements match your profile'];
}

/** Lo que conviene mirar antes de aplicar, sólo por debajo de STRONG_MATCH. */
export function opportunityCaution(match: OfferMatchResult): string {
  return match.score.missingRequirements[0]
    ?? match.score.clarifications[0]
    ?? match.score.vigenciaNotices[0]?.detail
    ?? 'Review the full role requirements before applying';
}

/** Sin oferta que recomendar: qué tocar del perfil (las pistas de la Home vieja). */
export function profileImprovementHints(match: OfferMatchResult | null): string[] {
  if (!match) {
    return [
      'Add your licences, aircraft ratings and experience',
      'Set your preferred countries and contract types',
    ];
  }

  const hints: string[] = [];
  if (match.score.profileTypeMismatch) hints.push('Review the technician roles selected in your profile');
  if (match.offer.requiredHabilitations.length > 0 && match.score.breakdown.habilitation === 0) {
    hints.push('Add or update your aircraft ratings and experience');
  }
  if (match.offer.licenseCode && match.score.breakdown.license === 0) {
    hints.push('Add your current licence information');
  }
  // Paso 5b: en una oferta de motor el eje es el motor, y lo que sube la nota
  // es declararlo (el escalón más alto de la escalera).
  if (match.offer.offerKind === 'engine' && match.score.level !== 'exact') {
    hints.push('Add the engines you have worked on');
  }
  if (match.score.breakdown.contractFit === 0) hints.push('Review your preferred contract types');
  if (match.score.breakdown.location === 0) hints.push('Update your preferred work location');

  const uniqueHints = [...new Set(hints)].slice(0, 3);
  return uniqueHints.length > 0 ? uniqueHints : ['Review your qualifications and matching preferences'];
}
