import { habilitationCoversFamilyKey, type AircraftRatingIndex } from '../constants/aircraftTypeRatings';
import type { SafeTechnicianPreview } from '../types/privacy';
import type { AvailabilityStatus } from '../types/technician';

export interface TechnicianSearchIdentity {
  technicianTypes: readonly string[];
  locationCountryCode: string;
  locationCityGeonameId?: number;
  country: string;
  city: string;
}

export interface TechnicianSearchIdentityFilters {
  technicianTypes?: readonly string[];
  countryCode?: string;
  cityGeonameId?: number;
  /** Legacy/manual fallback when no stable catalog identifier is available. */
  country?: string;
  city?: string;
}

/**
 * Pure matching for the profile dimensions selected from catalog-backed UI.
 * Multiple trades are OR-matched: sharing any selected trade is sufficient.
 */
export function matchesTechnicianSearchIdentity(
  technician: TechnicianSearchIdentity,
  filters: TechnicianSearchIdentityFilters,
): boolean {
  if (
    filters.technicianTypes?.length &&
    !filters.technicianTypes.some((type) => technician.technicianTypes.includes(type))
  ) {
    return false;
  }
  if (filters.countryCode && technician.locationCountryCode !== filters.countryCode) return false;
  if (
    filters.cityGeonameId !== undefined &&
    technician.locationCityGeonameId !== filters.cityGeonameId
  ) {
    return false;
  }
  if (filters.country && technician.country !== filters.country) return false;
  if (filters.city && technician.city !== filters.city) return false;
  return true;
}

/**
 * Lo que la búsqueda y el mapa de empresa piden a technicianRepositoryV2.search
 * (rediseño, fase 3B; respuesta 23 de la revisión). Lo construye, desde el
 * estado de los filtros compartidos, `toTechnicianSearchQuery`
 * (src/utils/technicianFilters.ts).
 *
 * Vacío o ausente = esa sección no filtra.
 */
export interface TechnicianSearchQuery extends TechnicianSearchIdentityFilters {
  /** Código exacto de la licencia ("B1.1"), como antes del rediseño. */
  licenseCodes?: string[];
  /**
   * La autoridad que la emite. Ausente = "Any authority": el código vale sea
   * quien sea quien lo emite, igual que antes de que el filtro la tuviera.
   */
  licenseAuthority?: string;
  /** Familias de aeronave ("<manufacturer>::<aircraftFamily>"), sólo por type rating. */
  aircraftFamilyKeys?: string[];
  /** Motores DECLARADOS por el técnico, por id del catálogo. */
  engineIds?: string[];
  verificationStatuses?: string[];
  availabilityStatuses?: AvailabilityStatus[];
  availableImmediately?: boolean;
  minYearsExperience?: number;
}

// Vacío o ausente = no filtra; con valores, basta con coincidir en uno (OR).
function matchesAny<T>(selected: readonly T[] | undefined, value: T | undefined): boolean {
  if (!selected || selected.length === 0) return true;
  return value !== undefined && selected.includes(value);
}

/**
 * LA función que decide si un técnico entra en la búsqueda o en el mapa de
 * empresa. Las dos pantallas pasan por technicianRepositoryV2.search, que la
 * aplica a cada fila; no hay otra copia.
 *
 * La regla de siempre: dentro de una sección vale CUALQUIER opción elegida, y
 * todas las secciones en uso se cumplen A LA VEZ.
 *
 *   - Licencia: código exacto, como antes. Con autoridad, la credencial tiene
 *     que ser de esa autoridad; con sólo la autoridad (sin categoría), vale
 *     cualquier licencia suya.
 *   - Aeronave: por familia y sólo a través de los type ratings, como antes
 *     (habilitationCoversFamilyKey, la misma que usa el matching).
 *   - Motor: sólo los declarados por el técnico.
 *
 * "Aviones o helicópteros" NO está aquí a propósito: sólo acota las opciones
 * que ofrece el panel, no filtra técnicos.
 */
export function matchesTechnicianSearch(
  preview: SafeTechnicianPreview,
  query: TechnicianSearchQuery,
  ratingIndex: AircraftRatingIndex,
): boolean {
  if (!matchesTechnicianSearchIdentity(preview, query)) return false;
  if (!matchesAny(query.verificationStatuses, preview.verificationStatus)) return false;
  if (!matchesAny(query.availabilityStatuses, preview.availability.status)) return false;
  if (query.availableImmediately === true && !preview.availability.immediately) return false;

  const codes = query.licenseCodes ?? [];
  const authority = query.licenseAuthority;
  if (codes.length > 0 || authority) {
    const holds = preview.licenses.some((license) =>
      (codes.length === 0 || codes.includes(license.licenseCode)) &&
      (!authority || license.authority === authority),
    );
    if (!holds) return false;
  }

  const families = query.aircraftFamilyKeys ?? [];
  if (
    families.length > 0 &&
    !preview.habilitations.some((h) => families.some((key) => habilitationCoversFamilyKey(h, key, ratingIndex)))
  ) {
    return false;
  }

  const engines = query.engineIds ?? [];
  if (engines.length > 0 && !preview.engines.some((e) => engines.includes(e.engineId))) return false;

  return true;
}
