// Los dos envoltorios de E/S del matching, sin E/S propia (Fase 10, paso 5a).
//
// Hasta el paso 5a vivían en matchingV2.ts con un bucle propio: llamaban a
// calculateOfferTechnicianMatch por su cuenta, sin el filtro de elegibilidad,
// sin el catálogo de motores y con su propio orden. Una oferta de motor se
// puntuaba sin engineIndex (los escalones de familia y tipo no resolvían) y
// una "sólo sin licencia" enseñaba la lista entera.
//
// Aquí ya no se puntúa, ni se filtra, ni se ordena: eso lo hacen
// rankTechniciansForOffer y rankOffersForTechnician, que son las mismas
// funciones que prueban los tests. Este fichero sólo carga (con lo que le
// inyecten) y vuelve a pegar cada score a su oferta o a su técnico.
//
// Sin imports con efectos, por el mismo motivo que las cachés de catálogo: los
// tests montan el servicio con cargadores falsos y comprueban que el resultado
// es EXACTAMENTE el de las funciones directas. matchingV2.ts monta la
// instancia real con los repositorios.
import { OfferWithRequirements } from '../types/offer';
import { TechnicianWithRelations } from '../types/technician';
import { TechnicianView } from '../types/privacy';
import { MatchScore, TechnicianMatchCandidate } from '../types/matching';
import { AircraftTypeRatingCatalog, EngineCatalog } from '../types/catalog';
import { buildAircraftRatingIndex } from '../constants/aircraftTypeRatings';
import { buildEngineIndex } from '../constants/engines';
import { PairMatch, matchOfferTechnicianPair, rankOffersForTechnician, rankTechniciansForOffer } from './offerMatchExplain';

export interface TechnicianMatchResult {
  technician: TechnicianView;
  score: MatchScore;
}

export interface OfferMatchResult {
  offer: OfferWithRequirements;
  score: MatchScore;
}

export interface MatchingServiceDeps {
  getOfferWithRequirements(offerId: string): Promise<OfferWithRequirements | null>;
  getPublishedOffersWithRequirements(): Promise<OfferWithRequirements[]>;
  /** Técnicos públicos y verificados, con el filtro duro de años ya aplicado. */
  getMatchCandidates(minYearsExperience: number): Promise<TechnicianMatchCandidate[]>;
  getTechnicianWithRelations(technicianId: string): Promise<TechnicianWithRelations | null>;
  getAircraftTypeRatings(): Promise<AircraftTypeRatingCatalog[]>;
  /** El catálogo ENTERO, inactivos incluidos: los genéricos dan crédito de familia. */
  getEngines(): Promise<EngineCatalog[]>;
  /** Reloj inyectable para la vigencia, como en el scorer. */
  now?: () => Date;
}

export interface MatchingService {
  getTechnicianMatchesForOffer(offerId: string): Promise<TechnicianMatchResult[]>;
  getOfferMatchesForTechnician(technicianId: string): Promise<OfferMatchResult[]>;
  /**
   * Pares sueltos que la pantalla ya ha cargado (una candidatura, una oferta
   * directa, los resultados de una búsqueda frente a una oferta). Mismo filtro
   * y mismo scorer que las dos listas, con los dos catálogos cargados una sola
   * vez para todos los pares. Un resultado por par, en el mismo orden.
   */
  matchPairs(pairs: { offer: OfferWithRequirements; technician: TechnicianWithRelations }[]): Promise<PairMatch[]>;
}

export function createMatchingService(deps: MatchingServiceDeps): MatchingService {
  const now = deps.now ?? (() => new Date());

  async function loadIndexes() {
    const [ratings, engines] = await Promise.all([deps.getAircraftTypeRatings(), deps.getEngines()]);
    return { ratingIndex: buildAircraftRatingIndex(ratings), engineIndex: buildEngineIndex(engines) };
  }

  return {
    // Los técnicos de una oferta, puntuados, filtrados y ordenados por
    // rankTechniciansForOffer. El filtro de años va EN LA CONSULTA (un técnico
    // con menos años declarados no llega al scorer; el que no declaró nada sí,
    // ver applyMinYearsFilter en technicianRepositoryV2).
    async getTechnicianMatchesForOffer(offerId) {
      const offer = await deps.getOfferWithRequirements(offerId);
      if (!offer) return [];

      const [candidates, { ratingIndex, engineIndex }] = await Promise.all([
        deps.getMatchCandidates(offer.minYearsExperience),
        loadIndexes(),
      ]);

      const previewById = new Map(candidates.map((c) => [c.technician.id, c.preview]));
      const scores = rankTechniciansForOffer(
        offer,
        candidates.map((c) => c.technician),
        ratingIndex,
        engineIndex,
        now(),
      );
      return scores.map((score) => ({ technician: previewById.get(score.technicianId)!, score }));
    },

    // Las ofertas publicadas de un técnico, con exactamente las mismas reglas
    // en la dirección contraria.
    async getOfferMatchesForTechnician(technicianId) {
      const [technician, offers, { ratingIndex, engineIndex }] = await Promise.all([
        deps.getTechnicianWithRelations(technicianId),
        deps.getPublishedOffersWithRequirements(),
        loadIndexes(),
      ]);
      if (!technician) return [];

      const offerById = new Map(offers.map((o) => [o.id, o]));
      const scores = rankOffersForTechnician(technician, offers, ratingIndex, engineIndex, now());
      return scores.map((score) => ({ offer: offerById.get(score.offerId)!, score }));
    },

    async matchPairs(pairs) {
      if (pairs.length === 0) return [];
      const { ratingIndex, engineIndex } = await loadIndexes();
      const at = now();
      return pairs.map(({ offer, technician }) => matchOfferTechnicianPair(offer, technician, ratingIndex, engineIndex, at));
    },
  };
}
