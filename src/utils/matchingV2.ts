import { offerRepository } from '../repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../repositories/v2/technicianRepositoryV2';
import { catalogRepository } from '../repositories/v2/catalogRepository';
import { createMatchingService } from './matchingService';
import { OfferWithRequirements } from '../types/offer';
import { TechnicianWithRelations } from '../types/technician';
import type { PairMatch } from './offerMatchExplain';

// La lógica de puntuación, elegibilidad y orden es pura y vive en
// src/utils/offerMatchExplain.ts; los envoltorios, también puros, en
// src/utils/matchingService.ts. Este fichero sólo los conecta a los
// repositorios reales — ver scripts/testMatching.ts para la prueba de que
// pasar por aquí da lo mismo que llamar a las funciones directas.
//
// Paso 5b: `calculateOfferTechnicianMatch` YA NO SE EXPORTA desde aquí. Las
// pantallas que la llamaban a pelo puntuaban sin catálogo de motores y sin el
// filtro de elegibilidad; ahora piden el par a `matchPairs`. Quien la
// necesite de verdad (tests, el propio servicio) la importa de
// offerMatchExplain, que es donde vive.
export { getMatchLabel, getMatchScoreWeights, getMatchDisplayLabel, ineligibilityReasonText } from './offerMatchExplain';
export type { MatchScoreWeights, PairMatch, IneligibilityReason } from './offerMatchExplain';
export type { TechnicianMatchResult, OfferMatchResult } from './matchingService';

const matchingService = createMatchingService({
  getOfferWithRequirements: (offerId) => offerRepository.getWithRequirements(offerId),
  getPublishedOffersWithRequirements: () => offerRepository.getPublishedWithRequirements(),
  getMatchCandidates: (minYears) => technicianRepositoryV2.getPublicMatchCandidates(minYears),
  getTechnicianWithRelations: (technicianId) => technicianRepositoryV2.getWithRelations(technicianId),
  getAircraftTypeRatings: () => catalogRepository.getAircraftTypeRatings(),
  getEngines: () => catalogRepository.getEngines(),
});

// Todos los técnicos públicos (cuenta activa + perfil verificado) elegibles
// para la oferta, ordenados por match.
export const getTechnicianMatchesForOffer = matchingService.getTechnicianMatchesForOffer;

// Todas las ofertas publicadas para las que el técnico es elegible, ordenadas
// por match.
export const getOfferMatchesForTechnician = matchingService.getOfferMatchesForTechnician;

// Pares sueltos ya cargados por la pantalla: filtro + scorer con los dos
// catálogos. Ver MatchingService.matchPairs.
export const matchPairs = matchingService.matchPairs;

/** Un par suelto. Lanza si los catálogos no cargan: la pantalla decide qué pintar entonces. */
export async function matchPair(offer: OfferWithRequirements, technician: TechnicianWithRelations): Promise<PairMatch> {
  const [result] = await matchingService.matchPairs([{ offer, technician }]);
  return result;
}
