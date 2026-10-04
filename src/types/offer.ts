import {
  TechnicianTypeCode,
  AuthorityLicenseCode,
  ContractTypeCode,
  AircraftTypeRatingCatalog,
  AuthorityCode,
  LicenseCode,
} from './catalog';
import { OfferStatus } from './enums';
import { PersistedLocation } from './location';
import { OfferSalary } from './offerSalary';

/**
 * Aviones o helicópteros — nunca las dos cosas en la misma oferta
 * (migración 047, `offers.product_type`).
 *
 * Derivado del productType del catálogo en vez de reescrito, para que las dos
 * listas no puedan separarse. `Gas Airship` se excluye a propósito: son 3
 * filas del catálogo y quedan fuera de las ofertas por decisión de producto,
 * que es también lo que impone el CHECK de la columna.
 */
export type OfferProductType = Exclude<
  NonNullable<AircraftTypeRatingCatalog['productType']>,
  'Gas Airship'
>;

/**
 * Qué pide una oferta (`offers.offer_kind`, migración 070).
 *
 *   'aircraft'  licencia y/o aeronaves. Todo lo anterior a la Fase 10.
 *   'engine'    UN motor, sin aeronaves; licencia opcional desde la sesión 2.
 *
 * Desde la sesión 4 (091) no se elige: se deriva del tipo de técnico. Una
 * oferta es de motor si y sólo si es para Engine Technician
 * (`offerKindForTechnicianType`, CHECK chk_offers_kind_matches_technician_type).
 *
 * No es una etiqueta decorativa: decide la tabla de pesos, qué eje mira el
 * tope de cero cualificación y quién es elegible. Ver offerMatchExplain.ts.
 */
export type OfferKind = 'aircraft' | 'engine';

/**
 * UNA AERONAVE que la oferta pide (fila de `offer_required_habilitations`).
 *
 * Fase 6 tanda D: perdió `licenseCode` y `requirementLevel`.
 *  - La licencia es de la OFERTA (`Offer.licenseCode`), no de cada fila:
 *    repetirla por fila permitía pedir B1.3 y B2 a la vez, que son dos
 *    profesiones y por tanto dos ofertas.
 *  - `requirementLevel` (mandatory/preferred) se evaluaba por fila y nadie
 *    entendía cómo se combinaban varias — el scorer se quedaba con la mejor,
 *    así que "tres obligatorias" significaba en la práctica "una cualquiera".
 *    Lo sustituye `Offer.requiresAllAircraft`, una decisión por oferta.
 *
 * ⚠ La invariante de MISMA FILA de CLAUDE.md sigue viva y NO se ha relajado:
 * es una regla sobre el TÉCNICO (`technician_habilitations`, cuyo
 * `licenseCode` sigue siendo NOT NULL). Aquí desaparece la ambigüedad que la
 * hacía necesaria — con una sola licencia por oferta no hay dos entre las
 * que confundirse al cruzarla con cada aeronave.
 */
export interface OfferRequiredHabilitation {
  offerId: string;
  aircraftTypeRatingId: string;
  notes?: string;
  createdAt: string;
}

// Fase 7: `PersistedLocation` trae el modelo nuevo (país ISO obligatorio +
// ciudad opcional con o sin coordenadas). `locationCityId` se retiró en F2d;
// `locationCountry` (el nombre) y `locationCity` siguen porque las pantallas
// de oferta los leen.
export interface Offer extends PersistedLocation {
  id: string;
  companyId: string;
  title: string;
  description: string;
  contractType: ContractTypeCode;
  /** Optional gross remuneration; null explicitly removes it when editing. */
  salary?: OfferSalary | null;
  /**
   * Declarado por la empresa, primer campo del formulario. Acota QUÉ puede
   * pedir la oferta (licencias compatibles y ratings del catálogo); no entra
   * en el scoring — el scorer no lo mira.
   */
  productType: OfferProductType;
  /**
   * UN SOLO tipo de perfil por oferta (Fase 6 tanda C, migración 051).
   *
   * Antes era `requiredTechnicianTypes: TechnicianTypeCode[]` en
   * `OfferWithRequirements`, alimentado por la tabla puente
   * `offer_required_technician_types`. Pedir mecánico Y pintor a la vez eran
   * dos puestos en un anuncio; misma regla que ya rige la licencia (una), el
   * producto (aviones o helicópteros, migración 047) y la certificación de
   * aquí abajo: **una oferta afirma una sola cosa**.
   *
   * Vive en `Offer` y no en `OfferWithRequirements` porque ya es una columna
   * de `offers`, no una relación.
   */
  technicianType: TechnicianTypeCode;
  /**
   * ¿El puesto exige poder CERTIFICAR el trabajo — es decir, licencia EASA en
   * vigor — o basta con saber hacerlo?
   *
   * Es propiedad del PUESTO, no del tipo de perfil de quien lo ocupe. Antes
   * esto se deducía del tipo (`isLicensedTechnicianType`), lo que hacía
   * imposible publicar "ayudante para el A320, sin licencia" y convertía al
   * tipo en portero. Un mecánico puede no tener licencia y seguir siendo
   * mecánico.
   *
   * En la tanda C se guarda y se muestra pero NO cambia el scoring: con
   * `true` el comportamiento es idéntico al de antes de existir la columna
   * (de ahí el DEFAULT true de la migración). Que el scorer elija la fuente
   * de evidencia según este booleano —habilitaciones con licencia vs.
   * experiencia declarada— es la Tanda E.
   */
  requiresCertification: boolean;
  /**
   * UNA sola licencia por oferta (Fase 6 tanda D, migración 053).
   *
   * `undefined` EXACTAMENTE cuando `requiresCertification` es false — una
   * oferta que no exige certificar no puede exigir licencia (invariante de
   * la tanda C). No es opcional en el sentido de "puedes no rellenarlo": la
   * base lo ata con un CHECK en las dos direcciones.
   *
   * Antes eran `requiredLicenses: LicenseCode[]` más una `licenseCode` por
   * cada fila de requisito, que permitían pedir B1.3 y B2 a la vez.
   *
   * `AuthorityLicenseCode` desde el paso 5b, cuando el formulario de oferta
   * aprendió a elegir autoridad: una oferta puede pedir un A&P de la FAA. Qué
   * pares existen lo dice `isValidAuthorityLicense` (y la FK compuesta contra
   * `authority_licenses`), no este tipo.
   */
  licenseCode?: AuthorityLicenseCode;
  /**
   * La autoridad de esa licencia (Fase 10, migración 075). Presente
   * EXACTAMENTE cuando lo está `licenseCode`: la base lo ata con
   * chk_offers_license_authority_pairing, y el par se valida contra
   * `authority_licenses` con una FK compuesta.
   *
   * Sin ella "B1.1" no identifica nada: con cinco autoridades hay cinco B1.1
   * distintas y el scorer no sabría contra cuál cruzar.
   */
  licenseAuthority?: AuthorityCode;
  /**
   * ¿Basta con UNA de las aeronaves listadas, o hacen falta TODAS?
   *
   * `false` por defecto — "basta con una" — porque es la respuesta esperada
   * en la mayoría de casos y porque coincide con lo que el scorer ya hacía
   * (se quedaba con la mejor coincidencia). `true` es lo que hereda el cap
   * que antes disparaba una fila `mandatory` incumplida.
   */
  requiresAllAircraft: boolean;
  /**
   * ¿Qué clase de oferta es (migración 070)? Ver `OfferKind`.
   *
   * NO opcional aunque la columna tenga DEFAULT: el scorer ramifica sobre
   * este campo, y un `undefined` que cayera en 'aircraft' por omisión sería
   * exactamente el fallo mudo de `license_code` y `requires_all_aircraft`
   * (una oferta de motor puntuada como si no pidiera nada). Que un SELECT
   * que se olvide de la columna reviente es la dirección segura.
   */
  offerKind: OfferKind;
  /**
   * Las OTRAS autoridades Part-66 cuya misma categoría vale (migración 088,
   * sustituye al booleano `accepts_equivalent` de la 070).
   *
   * Vacía = sólo la autoridad exacta. Ensancha la AUTORIDAD, nunca el código:
   * una B2 UK no cumple una B1.1 EASA por aceptar UK CAA. El equivalente
   * puntúa por debajo del exacto (87 frente a 100). Qué autoridades caben lo
   * dice `equivalentAuthoritiesForLicense`.
   *
   * En una oferta FAA (096) son autoridades Part-66 que emiten
   * `acceptedLicenseCode`: allí la categoría no es la de la oferta, la elige
   * la empresa.
   */
  acceptedAuthorities: AuthorityCode[];
  /**
   * 096: en una oferta FAA con autoridades aceptadas, la categoría Part-66 que
   * también cuenta (una sola). Presente exactamente cuando la oferta es FAA y
   * `acceptedAuthorities` no está vacía (chk_offers_accepted_license_code); qué
   * categorías caben lo dice `faaOfferAcceptableLicenseCodes`.
   */
  acceptedLicenseCode?: LicenseCode;
  /** El motor que pide una oferta de motor. Presente sólo si `offerKind` es 'engine'. */
  requiredEngineId?: string;
  /**
   * "Sólo técnicos sin licencia". Vale en ofertas de aeronave y de motor, y
   * sólo en las que NO exigen licencia (chk_offers_only_unlicensed_without_license,
   * migración 077).
   *
   * ⚠ Filtro EXCLUYENTE: todo lo demás ordena; esto deja fuera. Ver
   * `isTechnicianEligibleForOffer`.
   */
  onlyUnlicensed: boolean;
  // Controlled snapshot copied from the canonical location catalog at create/update time.
  locationCountry: string;
  locationCity: string;
  locationBaseAirport?: string;
  minYearsExperience: number;
  status: OfferStatus;
  visible: boolean;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OfferWithRequirements extends Offer {
  // Fase 6 tanda C: aquí vivía `requiredTechnicianTypes: TechnicianTypeCode[]`.
  // Ahora es `Offer.technicianType`, un valor único y una columna de `offers`.
  // La tabla puente `offer_required_technician_types` se retira en la 052.
  //
  // Fase 6 tanda D: y aquí vivía `requiredLicenses: LicenseCode[]`. Ahora es
  // `Offer.licenseCode`, una sola y también columna de `offers`.
  //
  // Fase 5 (2026-08-04): requiredAircraftTypes — the approximate by-family
  // requirement — was retired with offer_required_aircraft_types. Aircraft is
  // now only ever expressed exactly.
  //
  // Lista de AERONAVES, a secas: la licencia con la que se cruzan es la de la
  // oferta. Vacía para una oferta que sólo exige la categoría de licencia (o
  // que no exige nada).
  requiredHabilitations: OfferRequiredHabilitation[];
}
