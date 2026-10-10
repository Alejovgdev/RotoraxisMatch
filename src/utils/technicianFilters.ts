// Los filtros de técnicos que COMPARTEN la búsqueda y el mapa de empresa
// (rediseño, fase 3B; respuesta 23 de la revisión y decisiones del dueño del
// 2026-10-07). Puro, sin React: qué secciones salen, qué opciones encajan, qué
// se limpia al cambiar algo, cómo se traduce a la consulta y cuándo se
// conservan. Con pruebas en scripts/testTechnicianFilters.ts.
//
// Las dependencias salen de las reglas que ya existen, no se reescriben:
//   - qué licencias encajan con un oficio: licensesSelectableForOffer
//     (src/constants/licenses.ts), la misma que decide los chips del
//     formulario de oferta, con la clase que da el oficio
//     (offerKindForTechnicianType: Engine Technician ⇒ motor);
//   - qué licencias encajan con aviones o helicópteros:
//     isLicenseCompatibleWithProductType;
//   - a qué producto pertenece una familia de aeronave: el `productType` del
//     catálogo aircraft_type_ratings.
//
// Lo que filtra técnicos lo decide matchesTechnicianSearch
// (src/utils/technicianSearchFilterMatch.ts). "Aviones o helicópteros" no
// llega ahí: sólo acota las opciones del panel.
import {
  AUTHORITIES,
  FAA_LICENSE_CODES,
  LICENSE_CODES,
  PART66_AUTHORITIES,
  isValidAuthorityLicense,
  licensesSelectableForOffer,
} from '../constants/licenses';
import { isLicenseCompatibleWithProductType } from './licenseCategoryProductType';
import { offerKindForTechnicianType } from './offerShape';
import { ENGINE_TECHNICIAN_TYPE_CODE } from '../constants/technicianTypes';
import type { AuthorityCode, AuthorityLicenseCode, AircraftTypeRatingCatalog, TechnicianTypeCode } from '../types/catalog';
import type { OfferProductType } from '../types/offer';
import type { AvailabilityStatus } from '../types/technician';
import type { LocationValue } from '../types/location';
import type { TechnicianSearchQuery } from './technicianSearchFilterMatch';

export type ProductFilter = 'any' | OfferProductType;
export type AuthorityFilter = 'any' | AuthorityCode;

export interface TechnicianFilterState {
  /** Qué hace. Varios; vacío = cualquiera. */
  technicianTypes: TechnicianTypeCode[];
  /** Aviones o helicópteros. Sólo acota opciones; no filtra técnicos. */
  product: ProductFilter;
  /** "any" = cualquier autoridad, como antes del rediseño. */
  licenseAuthority: AuthorityFilter;
  /** Códigos exactos ("B1.1"). */
  licenseCodes: AuthorityLicenseCode[];
  aircraftFamilyKeys: string[];
  engineIds: string[];
  location: LocationValue;
  availability: AvailabilityStatus[];
  verifiedOnly: boolean;
}

export const EMPTY_TECHNICIAN_FILTERS: TechnicianFilterState = Object.freeze({
  technicianTypes: [],
  product: 'any',
  licenseAuthority: 'any',
  licenseCodes: [],
  aircraftFamilyKeys: [],
  engineIds: [],
  location: Object.freeze({ country: null, city: null }),
  availability: [],
  verifiedOnly: false,
}) as TechnicianFilterState;

export const AVAILABILITY_FILTER_OPTIONS: readonly { value: AvailabilityStatus; label: string }[] = [
  { value: 'open_to_offers', label: 'Open to offers' },
  { value: 'unavailable', label: 'Unavailable' },
];

export const PRODUCT_FILTER_OPTIONS: readonly { value: ProductFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'Aeroplane', label: 'Airplanes' },
  { value: 'Helicopter', label: 'Helicopters' },
];

/** "Any authority" y las cinco, en el orden del catálogo. */
export const AUTHORITY_FILTER_OPTIONS: readonly { value: AuthorityFilter; label: string }[] = [
  { value: 'any', label: 'Any authority' },
  ...AUTHORITIES.map((a) => ({ value: a.code as AuthorityFilter, label: a.label })),
];

// ── Qué secciones salen ───────────────────────────────────────────────────

/** Los códigos que un oficio puede tener con esa autoridad (la regla del formulario de oferta). */
function codesForType(type: string, authority: AuthorityCode): AuthorityLicenseCode[] {
  return licensesSelectableForOffer({ offerKind: offerKindForTechnicianType(type), technicianType: type }, authority);
}

function typeHasLicences(type: string): boolean {
  return AUTHORITIES.some((a) => codesForType(type, a.code).length > 0);
}

/**
 * La sección Licencia sale salvo que TODOS los oficios elegidos trabajen sin
 * licencia (chapa, pintura, composite). Sin oficio elegido, sale.
 */
export function isLicenceSectionVisible(types: readonly string[]): boolean {
  return types.length === 0 || types.some(typeHasLicences);
}

/** La sección Motor, sólo con Engine Technician elegido. */
export function isEngineSectionVisible(types: readonly string[]): boolean {
  return types.includes(ENGINE_TECHNICIAN_TYPE_CODE);
}

/**
 * Las categorías que se ofrecen, en el orden del catálogo:
 *   - "Any authority": los códigos Part-66 de siempre (la lista de antes del
 *     rediseño), que valen con cualquier autoridad;
 *   - una autoridad: los códigos que ESA autoridad emite (la FAA, A, P y A&P);
 *   - con oficios elegidos, sólo los que encajan con alguno de ellos;
 *   - con aviones o helicópteros, sólo los compatibles con ese producto.
 */
export function licenceCategoryOptions(
  types: readonly string[],
  product: ProductFilter,
  authority: AuthorityFilter,
): AuthorityLicenseCode[] {
  if (!isLicenceSectionVisible(types)) return [];
  const authorities: AuthorityCode[] = authority === 'any' ? PART66_AUTHORITIES : [authority];
  const pool: readonly AuthorityLicenseCode[] = authority === 'FAA' ? FAA_LICENSE_CODES : LICENSE_CODES;
  // Sin oficio elegido, todo lo que la autoridad emite; con oficios, lo que
  // encaja con alguno de ellos.
  const fitsTypes = (code: AuthorityLicenseCode) => types.length === 0
    ? authorities.some((a) => isValidAuthorityLicense(a, code))
    : types.some((type) => authorities.some((a) => codesForType(type, a).includes(code)));
  return pool.filter((code) =>
    fitsTypes(code) && (product === 'any' || isLicenseCompatibleWithProductType(code, product)),
  );
}

// ── Familias de aeronave por producto ────────────────────────────────────

export type FamilyProductMap = ReadonlyMap<string, AircraftTypeRatingCatalog['productType']>;

/** De cada familia del catálogo, su producto (el de su primer rating). */
export function buildFamilyProductMap(
  ratings: readonly Pick<AircraftTypeRatingCatalog, 'manufacturer' | 'aircraftFamily' | 'productType'>[],
): FamilyProductMap {
  const map = new Map<string, AircraftTypeRatingCatalog['productType']>();
  for (const r of ratings) {
    const key = `${r.manufacturer}::${r.aircraftFamily}`;
    if (!map.has(key)) map.set(key, r.productType);
  }
  return map;
}

/**
 * ¿Encaja la familia con aviones o helicópteros? Una familia que el catálogo
 * cargado no conoce se conserva (no se puede juzgar, y borrarla porque el
 * catálogo aún no ha llegado sería perder la selección); una sin producto no
 * encaja en ninguno, igual que en el selector (getByProductType).
 */
export function familyFitsProduct(key: string, product: ProductFilter, families: FamilyProductMap): boolean {
  if (product === 'any') return true;
  if (!families.has(key)) return true;
  return families.get(key) === product;
}

// ── Cambios y limpieza ───────────────────────────────────────────────────

/**
 * Quita lo que ha dejado de encajar (respuesta 14: "changing something clears
 * what no longer fits"):
 *   - sin sección Licencia: autoridad y categorías fuera;
 *   - categorías que ya no se ofrecen con este oficio, producto o autoridad;
 *   - aeronaves de otro producto;
 *   - sin Engine Technician: motores fuera.
 * Lo demás no depende de nada y se queda.
 */
export function normalizeTechnicianFilters(state: TechnicianFilterState, families: FamilyProductMap): TechnicianFilterState {
  const licenceVisible = isLicenceSectionVisible(state.technicianTypes);
  const licenseAuthority = licenceVisible ? state.licenseAuthority : 'any';
  const options = new Set<string>(licenceCategoryOptions(state.technicianTypes, state.product, licenseAuthority));
  return {
    ...state,
    licenseAuthority,
    licenseCodes: licenceVisible ? state.licenseCodes.filter((code) => options.has(code)) : [],
    aircraftFamilyKeys: state.aircraftFamilyKeys.filter((key) => familyFitsProduct(key, state.product, families)),
    engineIds: isEngineSectionVisible(state.technicianTypes) ? state.engineIds : [],
  };
}

export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function toggleTechnicianType(state: TechnicianFilterState, type: TechnicianTypeCode, families: FamilyProductMap): TechnicianFilterState {
  return normalizeTechnicianFilters({ ...state, technicianTypes: toggleValue(state.technicianTypes, type) }, families);
}

export function setProductFilter(state: TechnicianFilterState, product: ProductFilter, families: FamilyProductMap): TechnicianFilterState {
  return normalizeTechnicianFilters({ ...state, product }, families);
}

export function setLicenceAuthority(state: TechnicianFilterState, authority: AuthorityFilter, families: FamilyProductMap): TechnicianFilterState {
  return normalizeTechnicianFilters({ ...state, licenseAuthority: authority }, families);
}

// ── A la consulta ─────────────────────────────────────────────────────────

/** Lo que se le pide al repositorio. El producto no viaja: no filtra técnicos. */
export function toTechnicianSearchQuery(state: TechnicianFilterState): TechnicianSearchQuery {
  const city = state.location.city;
  const query: TechnicianSearchQuery = {};
  if (state.technicianTypes.length) query.technicianTypes = [...state.technicianTypes];
  if (isLicenceSectionVisible(state.technicianTypes)) {
    if (state.licenseCodes.length) query.licenseCodes = [...state.licenseCodes];
    if (state.licenseAuthority !== 'any') query.licenseAuthority = state.licenseAuthority;
  }
  if (state.aircraftFamilyKeys.length) query.aircraftFamilyKeys = [...state.aircraftFamilyKeys];
  if (isEngineSectionVisible(state.technicianTypes) && state.engineIds.length) query.engineIds = [...state.engineIds];
  if (state.location.country) query.countryCode = state.location.country.code;
  // Ciudad del directorio por su id; una escrita a mano, por nombre (como antes).
  if (city?.kind === 'directory') query.cityGeonameId = city.geonameId;
  else if (city?.kind === 'manual') query.city = city.name;
  if (state.availability.length) query.availabilityStatuses = [...state.availability];
  if (state.verifiedOnly) query.verificationStatuses = ['verified'];
  return query;
}

/** Cuántas opciones hay en uso: el número del botón "Filters · N". */
export function activeFilterCount(state: TechnicianFilterState): number {
  const licence = isLicenceSectionVisible(state.technicianTypes)
    ? state.licenseCodes.length + (state.licenseAuthority !== 'any' ? 1 : 0)
    : 0;
  return (
    state.technicianTypes.length +
    (state.product !== 'any' ? 1 : 0) +
    licence +
    state.aircraftFamilyKeys.length +
    (isEngineSectionVisible(state.technicianTypes) ? state.engineIds.length : 0) +
    (state.location.country ? 1 : 0) +
    (state.location.city ? 1 : 0) +
    state.availability.length +
    (state.verifiedOnly ? 1 : 0)
  );
}

// ── Cuánto duran ──────────────────────────────────────────────────────────

/**
 * Las pantallas donde los filtros se conservan: la búsqueda, el mapa y el
 * perfil de un técnico abierto desde ellas (decisión del dueño, 2026-10-07).
 * Al salir a cualquier otra sección se vuelven a vaciar.
 */
export function isTechnicianFilterScope(pathname: string): boolean {
  const path = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '');
  return (
    path === '/company/search' ||
    path === '/company/map' ||
    path.startsWith('/company/technician/')
  );
}

export interface AppliedTechnicianFilters {
  filters: TechnicianFilterState;
  searchTab?: 'all' | 'contacts';
  /** 0 hasta pulsar "Show technicians"; sube cada vez que se aplican. */
  version: number;
}

export const NO_APPLIED_FILTERS: AppliedTechnicianFilters = Object.freeze({
  filters: EMPTY_TECHNICIAN_FILTERS,
  version: 0,
});

/** "Show technicians": lo que hay en el panel pasa a ser lo aplicado. */
export function applyTechnicianFilters(current: AppliedTechnicianFilters, next: TechnicianFilterState): AppliedTechnicianFilters {
  return { ...current, filters: next, version: current.version + 1 };
}

/** Al navegar: dentro de búsqueda, mapa o un técnico, se quedan; fuera, se vacían. */
export function appliedAfterNavigation(current: AppliedTechnicianFilters, pathname: string): AppliedTechnicianFilters {
  if (isTechnicianFilterScope(pathname)) return current;
  return current.version === 0 && current.filters === EMPTY_TECHNICIAN_FILTERS && current.searchTab !== 'contacts' ? current : NO_APPLIED_FILTERS;
}
