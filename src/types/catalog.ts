export type TechnicianTypeCode =
  | 'mechanic'
  | 'avionic'
  | 'sheet_metal_worker'
  | 'painter'
  | 'composite'
  | 'pilot' // standby — not active in V2 UI
  // Fase 10, paso 5a: fila de `technician_types` desde la migración 076. El
  // filtro de elegibilidad de las ofertas de motor la lee; ninguna pantalla la
  // ofrece todavía (paso 5b).
  | 'engine_technician';

/**
 * Las cinco autoridades que emiten licencias (Fase 10, migración 064).
 *
 * Las cuatro Part-66 comparten códigos y catálogo de aeronaves; la FAA tiene
 * los suyos (A, P, A&P) y no lleva habilitaciones de tipo. Qué códigos admite
 * cada una lo dice la tabla `authority_licenses`, no este tipo.
 */
export type AuthorityCode = 'EASA' | 'UK_CAA' | 'CASA' | 'GCAA' | 'FAA';

export type LicenseCode =
  | 'A1' | 'A2' | 'A3' | 'A4'
  | 'B1.1' | 'B1.2' | 'B1.3' | 'B1.4'
  | 'B2' | 'B2L' | 'B3' | 'L' | 'C';

/**
 * Los tres certificados de la FAA (14 CFR 65, migración 065).
 *
 * TIPO APARTE, y no tres miembros más de `LicenseCode`, por lo que dice esa
 * migración: son otro sistema. No llevan habilitaciones de tipo
 * (`authorities.has_type_ratings = false`), su `category_group` es 'FAA' y no
 * 'A' —la `A` de Airframe no tiene nada que ver con las A1–A4 Part-66—, y no
 * cruzan por equivalencia con ninguna Part-66. Fundirlos en `LicenseCode`
 * habría obligado a toda función que hoy razona sobre categorías Part-66
 * (propulsión, producto, rama de oficio) a contestar también por ellos.
 *
 * `A&P` satisface `A`, `P` y `A&P`. Lo dice `licenseCodeSatisfies`
 * (src/constants/licenses.ts), y sólo ella.
 */
export type FaaLicenseCode = 'A' | 'P' | 'A&P';

/**
 * Cualquier código que una autoridad pueda emitir. Es el tipo de
 * `TechnicianLicense.licenseCode` y de `Offer.licenseCode`: una credencial
 * concreta y una oferta pueden ser FAA. `LicenseCode` a secas sigue
 * significando "categoría Part-66" en todo lo demás, y por eso
 * `TechnicianHabilitation.licenseCode` NO se ensancha: la FAA no tiene type
 * ratings, así que ninguna habilitación puede colgar de un certificado suyo.
 */
export type AuthorityLicenseCode = LicenseCode | FaaLicenseCode;

/** Mismo dominio que el CHECK de `engines.engine_type` (migración 067). */
export type EngineType = 'turbofan' | 'turbojet' | 'turboprop' | 'turboshaft' | 'piston' | 'apu';

/**
 * Un motor del catálogo (`engines`, migración 067).
 *
 * Las dos columnas de agrupación SON los escalones del matching de motores:
 * mismo id = motor exacto, mismo `family` = misma familia, mismo `engineType`
 * = mismo tipo. Por eso `family` se repite entre filas y la clave natural es
 * (manufacturer, displayName), no (manufacturer, family).
 *
 * Dos banderas distintas desde la migración 089:
 *   - `isGeneric`: la fila no nombra un modelo ("<fabricante> (model not
 *     specified)"). El matching NUNCA le da crédito de motor exacto — sólo de
 *     familia, que es lo único que una genérica sabe decir — y ningún selector
 *     la ofrece.
 *   - `isActive`: la fila se ofrece en los selectores. Desactivar un modelo
 *     concreto no cambia la puntuación de quien ya lo tiene.
 */
export interface EngineCatalog {
  id: string;
  manufacturer: string;
  family: string;
  engineType: EngineType;
  displayName: string;
  isActive: boolean;
  isGeneric: boolean;
}

export type ContractTypeCode = 'permanent' | 'long_term' | 'short_term';

export type CompanyTypeCode =
  | 'MRO'
  | 'airline'
  | 'recruitment_agency'
  | 'helicopter_operator'
  | 'other';

export interface TechnicianTypeCatalog {
  code: TechnicianTypeCode;
  label: string;
  /**
   * ¿Este oficio tiene licencias Part-66? Propiedad del OFICIO, no de una
   * oferta concreta: un mecánico puede no tener licencia y seguir siendo
   * mecánico, pero un pintor no tiene ninguna que tener.
   *
   * Estuvo marcado SIN CONSUMIDORES entre la Fase 6 tanda C (2026-08-10) y el
   * 2026-08-13, cuando su lector `isLicensedTechnicianType` volvió a tenerlos:
   * el formulario de oferta decide con él si la pregunta "¿hace falta
   * licencia?" existe, y `licensesSelectableForOfferType` acota con él la
   * lista de licencias que un puesto puede pedir. Sale, por tanto, de la
   * lista de LIMPIEZA de docs/MISSION_PART66.md, y con él la columna
   * `technician_types.requires_license`, que vuelve a tener lectores.
   */
  requiresLicense: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface LicenseCategoryCatalog {
  code: LicenseCode;
  label: string;
  categoryGroup: string; // 'A' | 'B1' | 'B2' | 'B3' | 'L' | 'C'
  sortOrder: number;
}

export interface CompanyTypeCatalog {
  code: CompanyTypeCode;
  label: string;
  sortOrder: number;
}

export interface ContractTypeCatalog {
  code: ContractTypeCode;
  label: string;
  sortOrder: number;
}

// --- Part-66 aircraft-engine type rating catalog (EASA, 80-entry initial set) ---
//
// A rating is a real, valid aircraft+engine combination as it would appear on
// an EASA Part-66 AML (e.g. "Airbus A318/A319/A320/A321 (CFM56)"). Unlike the
// legacy aircraft_types catalog (family/model only, no engine dimension) and
// unlike the small Phase-1 engine_types/aircraft_ratings tables it replaces
// (see docs/archive/PART66_AIRCRAFT_MODEL_ANALYSIS.md and
// docs/archive/AIRCRAFT_TYPE_RATINGS_IMPLEMENTATION_REPORT.md), manufacturer/family/
// engine are stored directly on the row — deliberately not normalized into a
// separate reusable engine catalog, so a single table search covers
// manufacturer, family, engine and aliases without joins.
export type AircraftRatingCategory =
  | 'commercial_airplane'
  | 'regional_airplane'
  | 'regional_turboprop'
  | 'business_jet'
  | 'general_aviation'
  | 'helicopter';

export interface AircraftTypeRatingCatalog {
  id: string;
  manufacturer: string;
  aircraftFamily: string;
  engineManufacturer?: string;
  engineFamily?: string;
  /** Canonical EASA denomination — unique, the authoritative value for the catalog. */
  easaEndorsement: string;
  /** User-facing label, e.g. "Airbus A320 family — CFM56". */
  displayName: string;
  /** Search aliases: individual model codes, commercial nicknames, engine nicknames. */
  commercialAliases: string[];
  aircraftCategory: AircraftRatingCategory;
  /** Optional EASA regulatory group/subgroup — not populated for the initial 80, kept for future use. */
  easaGroup?: string;
  /**
   * El motor del rating (`aircraft_type_ratings.engine_id`, migración 069).
   *
   * ⚠ ES LA ÚNICA FUENTE del escalón "motor implícito en un type rating".
   * `engineManufacturer` / `engineFamily` de arriba son el texto de origen de
   * EASA y están sucios (el Model 250 aparece como `Corp 250`, `250` y `M250`;
   * 12 filas llevan el modelo escrito en el fabricante), así que inferir el
   * motor leyéndolos da falsos positivos. No lo hagas: hay un test que lo fija.
   *
   * Ausente = el rating no dice qué motor lleva, y entonces no aporta ninguno.
   */
  engineId?: string;
  /** Which catalog batch/import this row came from, for future re-imports. */
  sourceRevision?: string;
  /**
   * The EASA source's own top-level classification, kept verbatim alongside
   * the (heuristic) aircraftCategory above. Not populated for the initial
   * 80 rows. Reserved for a later phase's category faceting/pre-filtering —
   * nothing reads this yet.
   */
  productType?: 'Aeroplane' | 'Helicopter' | 'Gas Airship';
  priority: number;
  isActive: boolean;
}

/**
 * ⚠ SIN CONSUMIDORES desde la Fase 6 tanda D (2026-08-10). `mandatory` /
 * `preferred` se evaluaba por fila de requisito y nadie entendía cómo se
 * combinaban varias; lo sustituye `Offer.requiresAllAircraft`, una decisión
 * por oferta. La columna `offer_required_habilitations.requirement_level` la
 * retira la migración 054.
 *
 * Pendiente del barrido de exports muertos — ver docs/MISSION_PART66.md,
 * sección "LIMPIEZA". No se borra aquí para no mezclar la corrección con una
 * retirada.
 */
export type RequirementLevel = 'mandatory' | 'preferred';
