import { TechnicianTypeCode, LicenseCode, ContractTypeCode } from './catalog';
import { LocationValue } from './location';

// --- V2 types ---

export interface TechnicianSearchFilters {
  technicianTypes?: TechnicianTypeCode[];
  licenses?: LicenseCode[];
  aircraftTypes?: string[];
  contractTypes?: ContractTypeCode[];
  country?: string;
  city?: string;
  verifiedOnly?: boolean;
  availableImmediately?: boolean;
  minYearsExperience?: number;
}

// --- V1-compatible UI contracts — intentionally retained until the V2 UI migration ---

/**
 * @deprecated V1-compatible single-select state still used by
 * app/company/search.tsx and useTechnicianSearch.ts. New code should use the
 * normalized, array-based filter contract accepted by
 * technicianRepositoryV2.search(). Remove this interface only after the search
 * screen and hook expose that V2 contract directly.
 */
export interface TechnicianFilters {
  technicianTypes?: TechnicianTypeCode[];
  /** Canonical country/city selector value used by company search. */
  location?: LocationValue;
  licenseCategory?: string;
  /**
   * @deprecated Legacy V1 aircraft code/label field retained for source
   * compatibility with existing TechnicianFilters callers; there is no current
   * internal reader. The live search screen and hook use aircraftFamilyKeys.
   * Remove it when TechnicianFilters is retired and downstream callers have
   * been audited.
   */
  aircraftType?: string;
  // Family keys ("<manufacturer>::<aircraftFamily>", see getAircraftFamilyKey)
  // from the 606-row aircraft_type_ratings catalog — OR-matched against a
  // technician's resolved ratings (Fase 3b screen 3, 2026-07-22). Same shape
  // ApproximateFilterSection/offerMatchExplain.ts already use for the broad
  // aircraft filter, reused here for consistency.
  aircraftFamilyKeys?: string[];
  specialty?: string;
  availabilityStatus?: string;
  verificationStatus?: string;
  minYearsExperience?: number;
  country?: string;
  city?: string;
  baseAirport?: string;
  contractType?: string;
}

/**
 * @deprecated V1-compatible map state still consumed by app/company/map.tsx,
 * both TechnicianMap implementations, and useMapTechnicians.ts. New code
 * should use the plural array fields and pass their normalized values to
 * technicianRepositoryV2.search(). Remove this interface only after those
 * consumers expose a dedicated V2 map-filter contract.
 */
export interface MapFilters {
  licenseCategories?: string[];
  // Family keys ("<manufacturer>::<aircraftFamily>", see getAircraftFamilyKey)
  // from the 606-row aircraft_type_ratings catalog (Fase 3b screen 4,
  // 2026-07-22) — same shape as TechnicianFilters.aircraftFamilyKeys above,
  // ApproximateFilterSection, and offerMatchExplain.ts's broad filter.
  aircraftFamilyKeys?: string[];
  availabilityStatuses?: string[];
  /**
   * @deprecated Active singular fallback read by useMapTechnicians.ts and both
   * TechnicianMap implementations for older map state. New code should write
   * licenseCategories. Remove it after all map callers use the plural field and
   * the fallback rendering paths are removed.
   */
  licenseCategory?: string;
  /**
   * @deprecated Legacy V1 aircraft-code list retained for source compatibility
   * with MapFilters callers; there is no current internal reader. New code
   * should use aircraftFamilyKeys. Remove it after the V1 map-filter contract
   * and any downstream callers have been retired.
   */
  aircraftTypes?: string[];
  /**
   * @deprecated Legacy V1 singular aircraft code/label retained for source
   * compatibility with MapFilters callers; there is no current internal
   * reader. New code should use aircraftFamilyKeys. Remove it together with the
   * V1 map-filter contract after downstream callers have been audited.
   */
  aircraftType?: string;
  /**
   * @deprecated Active singular fallback read by useMapTechnicians.ts and both
   * TechnicianMap implementations for older map state. New code should write
   * availabilityStatuses. Remove it after all map callers use the plural field
   * and the fallback paths are removed.
   */
  availabilityStatus?: string;
}

