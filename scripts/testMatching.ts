// Standalone tests — no Supabase/DB connection required. Exercises the pure
// functions in src/utils/offerMatchExplain.ts, src/constants/aircraftTypeRatings.ts,
// and src/repositories/v2/aircraftTypeRatingsCache.ts against small
// in-memory fixtures.
//
// Deliberately does NOT import or duplicate the real 80-row aircraft_type_ratings
// catalog — that catalog lives exclusively in Supabase now (see
// docs/archive/AIRCRAFT_TYPE_RATINGS_SUPABASE_SOURCE_REPORT.md) and is validated
// against the live database by `npm run validate:aircraft-ratings`
// (scripts/validateAircraftTypeRatingsCatalog.ts), not here. Every function
// under test here takes its catalog/index as an argument, so a handful of
// fabricated fixtures is enough to exercise every code path.
//
// Run via: npm run test:matching  (compiles with tsc to a scratch dir, then
// runs the plain JS output with node — see package.json).
import assert from 'node:assert/strict';
import {
  calculateOfferTechnicianMatch,
  getMatchLabel,
  applyScoreCeilings,
  getMatchScoreWeights,
  isTechnicianEligibleForOffer,
  rankTechniciansForOffer,
  rankOffersForTechnician,
} from '../src/utils/offerMatchExplain';
import { OfferWithRequirements, OfferRequiredHabilitation } from '../src/types/offer';
import {
  TechnicianWithRelations,
  TechnicianHabilitation,
  TechnicianLicense,
  TechnicianAircraftExperience,
  TechnicianEngineExperience,
} from '../src/types/technician';
import {
  AircraftTypeRatingCatalog,
  AuthorityCode,
  AuthorityLicenseCode,
  EngineCatalog,
  LicenseCode,
  TechnicianTypeCode,
} from '../src/types/catalog';
import {
  buildAircraftRatingIndex,
  getAircraftTypeRatingLabel,
  sortAircraftTypeRatings,
  filterAircraftTypeRatings,
  mapAircraftTypeRatingRow,
  AircraftTypeRatingRow,
} from '../src/constants/aircraftTypeRatings';
import { createAircraftTypeRatingsCache } from '../src/repositories/v2/aircraftTypeRatingsCache';
import { createEnginesCache } from '../src/repositories/v2/enginesCache';
import { createMatchingService } from '../src/utils/matchingService';
import {
  QUALIFICATION_FIRST_ORDER,
  VERIFIED_FIRST_ORDER,
  visibleBreakdownRows,
} from '../src/utils/matchBreakdownRows';
import { loadSearchOfferResults, visibleSearchResults } from '../src/utils/searchOfferResults';
import { offerShapeViolations } from '../src/utils/offerShape';
import {
  heldCountByAuthority,
  heldLicenseCodes,
  holdsLicense,
  licensesForHabilitations,
  sortHeldLicenses,
  toggleHeldLicense,
  updateHeldLicenseDates,
} from '../src/utils/profileLicenses';
import { SafeTechnicianPreview } from '../src/types/privacy';
import { planLicenseRemoval, planLicenseRemovalById } from '../src/utils/licenseUpdatePlan';
import { getFamilies, getByProductType, searchRatings, resolveAircraftCategoryForFamilyKeys } from '../src/constants/aircraftTypeRatingViews';
import { getAircraftFamilyKey } from '../src/constants/aircraftTypeRatings';
import {
  getLicenseRatingProductType,
  isLicenseCompatibleWithProductType,
  isUnusualCombination,
} from '../src/utils/licenseCategoryProductType';
import { isValidDateOrder } from '../src/utils/validityDates';
import {
  isActiveOfferRelationStatus,
  assertOfferRelationTransition,
  shouldUnlockAcceptedRelation,
  getStatusActivityType,
  evaluateDirectOfferConflict,
  evaluateApplicationConflict,
} from '../src/utils/offerRelationStateMachine';
import { canHold, getCompatiblePropulsion } from '../src/utils/habilitationScope';
import { HabilitationScope } from '../src/types/habilitationScope';
import { isLicensedTechnicianType, offerTargetsLicensedProfiles } from '../src/constants/technicianTypes';
import {
  AUTHORITY_LICENSES,
  LICENSE_CODES,
  authorityLicenseCanExpire,
  licenseCodeSatisfies,
  licenseSatisfiesRequirement,
  equivalentAuthorities,
  equivalentAuthoritiesForLicense,
  retainApplicableAuthorities,
  isValidAuthorityLicense,
  licensesSelectableForOffer,
  licensesSelectableForOfferType,
  typesAfterLicenseChange,
  typesImpliedByLicenses,
} from '../src/constants/licenses';
import { getMatchDisplayLabel } from '../src/utils/offerMatchExplain';
import { GENERAL_COMPATIBILITY_LABEL } from '../src/types/matching';
import { Technician } from '../src/types';
import {
  parseYearsExperience,
  validateSignupYearsExperience,
  validateProfileYearsExperience,
} from '../src/utils/yearsExperienceValidation';
import { AircraftRatingIndex } from '../src/constants/aircraftTypeRatings';
import { EngineIndex, buildEngineIndex, searchEngines } from '../src/constants/engines';
import { MatchScore } from '../src/types/matching';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS — ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL — ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

// ── Fase 10, paso 4: lo pendiente ya existe ───────────────────────────────
//
// Aquí vivía `pendiente(módulo, 'nombre')`, un lector por string que permitía
// escribir la red ANTES que el scorer: con `tsc && node`, un import con nombre
// de algo inexistente tumbaba los 185 tests de arriba en vez de fallar sólo el
// suyo. Con el paso 4 las ocho exportaciones existen, así que entran por
// nombre y el compilador comprueba además sus firmas — que es justo lo que
// `pendiente` no podía hacer.
//
// También se han ido `PendingOfferFields` (acceptsEquivalent —hoy acceptedAuthorities, sesión 2—, offerKind,
// requiredEngineId y onlyUnlicensed son ya campos de `Offer`) y los alias de
// firma ScoreFnV3 / RankTechniciansFn / RankOffersFn / EligibilityFn, que
// describían a mano lo que ahora declara el propio módulo.

// `licenseCode` SIGUE abierto a string, y no por pereza: los códigos FAA (A, P,
// A&P) SÍ existen como tipo (`AuthorityLicenseCode`), y
// `TechnicianLicense.licenseCode` ya los admite; `Offer.licenseCode` no,
// mientras el formulario de oferta no sepa elegir autoridad. El scorer sí sabe
// puntuarlos, que es lo que estos tests comprueban. Es del paso 5b. Ver el cast
// de makeOffer.
//
// `technicianType` ya no: 'engine_technician' es fila de `technician_types`
// desde la migración 076 (paso 5a) y está en `TechnicianTypeCode`, así que un
// oficio mal escrito en un fixture deja de compilar.
type OfferOverrides = Omit<Partial<OfferWithRequirements>, 'licenseCode'> & {
  licenseCode?: string;
};

// Sin nada abierto desde el paso 5a: `engines` es relación del técnico desde la
// Fase 10 y 'engine_technician' está en `TechnicianTypeCode`.
type TechnicianOverrides = Partial<TechnicianWithRelations>;

// ── Offer/technician fixture builders ─────────────────────────────────────

function makeOffer(overrides: OfferOverrides = {}): OfferWithRequirements {
  const offer = {
    id: 'offer-test',
    companyId: 'company-test',
    title: 'Test offer',
    description: 'Test',
    contractType: 'permanent',
    // El scorer no lee productType (la 047 restringe qué se puede PEDIR, no
    // cómo se puntúa); está aquí porque el tipo lo exige, no porque estos
    // tests dependan de su valor.
    productType: 'Aeroplane',
    // Fase 6 tanda C: toda oferta nombra UN tipo y declara si exige
    // certificar. `mechanic` + `true` reproducen el comportamiento previo a
    // que existieran las dos columnas, que es lo que fijan los tests de
    // invariancia de más abajo.
    technicianType: 'mechanic',
    requiresCertification: true,
    // Fase 7 F2b: el tipo lo exige (NOT NULL en Postgres), pero el scorer NO
    // lo lee todavía — sigue puntuando por locationCityId. Que pase a
    // puntuar por país es F2c, y ahí sí se moverán los números.
    locationCountryCode: 'XX',
    locationCountry: 'Nowhere',
    locationCity: 'Nowhere City',
    locationBaseAirport: 'XXXX',
    minYearsExperience: 0,
    status: 'published',
    visible: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    // Fase 6 tanda D: UNA licencia por oferta, y `requiresAllAircraft: false`
    // = basta con una de las aeronaves listadas. La licencia va emparejada
    // con `requiresCertification: true` de arriba: son las DOS MITADES DE UNA
    // MISMA FILA, y la 053 sólo admite (true + licencia) o (false + sin
    // licencia). Ver la guarda de abajo.
    licenseCode: 'B1.1',
    requiresAllAircraft: false,
    requiredHabilitations: [],
    acceptedAuthorities: [],
    offerKind: 'aircraft',
    onlyUnlicensed: false,
    ...overrides,
    // El cast cubre EXACTAMENTE un campo, el de OfferOverrides: los códigos
    // FAA (Offer.licenseCode sigue siendo Part-66 hasta el paso 5b). Todo lo
    // demás de aquí arriba —technicianType, offerKind, acceptedAuthorities,
    // requiredEngineId, onlyUnlicensed— son campos de `Offer` y los comprueba
    // el compilador.
  } as OfferWithRequirements;

  // Fase 9: la fila que sale de aquí tiene que ser una fila que Postgres
  // aceptaría. `chk_offers_license_matches_certification` (migración 053) ata
  // los dos campos en las DOS direcciones, y un override que mueva sólo uno
  // —`requiresCertification: false` a secas es el caso fácil de escribir—
  // fabrica una oferta que no puede existir. El scorer la puntúa igual, sin
  // quejarse: elige rama por si hay licencia, así que el test acaba midiendo
  // la rama certificada mientras su nombre dice lo contrario. Eso ya pasó.
  //
  // La guarda no adivina la mitad que falta a propósito: quien quiera la rama
  // sin requisitos la pide entera (`requiresCertification: false` Y
  // `licenseCode: undefined`), que es justo lo que el test tiene que declarar.
  if (offer.requiresCertification !== (offer.licenseCode !== undefined)) {
    throw new Error(
      `makeOffer: fila imposible — requiresCertification=${offer.requiresCertification} con licenseCode=${String(offer.licenseCode)}. ` +
        'La 053 sólo admite (requiresCertification: true + licenseCode) o (requiresCertification: false + licenseCode: undefined). ' +
        'Declara las dos mitades en el override.',
    );
  }

  // Fase 10: la autoridad es la tercera mitad de la misma fila. Sin licencia
  // no hay autoridad que declarar; con licencia y sin autoridad declarada se
  // asume EASA, que es lo que describen los 180 tests anteriores a la fase.
  if (offer.licenseCode === undefined && offer.licenseAuthority !== undefined) {
    throw new Error(`makeOffer: fila imposible — licenseAuthority=${offer.licenseAuthority} sin licenseCode.`);
  }
  if (offer.licenseCode !== undefined && offer.licenseAuthority === undefined) {
    offer.licenseAuthority = 'EASA';
  }

  // Paso 5b: el resto de la forma lo dice el mismo espejo de los CHECK que usa
  // offerRepository (motor sin licencia ni aeronaves y con motor, aeronave sin
  // motor, "sólo sin licencia" sin licencia). Una fixture que Postgres
  // rechazaría no llega al scorer. Las dos guardas de arriba se quedan: dan un
  // mensaje que dice qué override falta.
  const violations = offerShapeViolations(offer);
  if (violations.length > 0) {
    throw new Error(`makeOffer: fila imposible — ${violations.join(' ')} Para motor usa makeEngineOffer().`);
  }

  return offer;
}

// Fase 10: oferta de motor. El tipo de perfil es 'engine_technician' porque
// la columna es NOT NULL, pero en estas ofertas el oficio NO puntúa — hay un
// test que lo fija.
function makeEngineOffer(requiredEngineId: string, overrides: OfferOverrides = {}): OfferWithRequirements {
  return makeOffer({
    offerKind: 'engine',
    requiredEngineId,
    technicianType: 'engine_technician',
    requiresCertification: false,
    licenseCode: undefined,
    requiredHabilitations: [],
    ...overrides,
  });
}

// Fase 6 tanda D: una fila de requisito es UNA AERONAVE, y este helper sólo
// recibe eso. La licencia la declara la OFERTA (makeOffer -> licenseCode) y la
// exigencia también (requiresAllAircraft). Dejar aquí un parámetro de licencia
// que el scorer ignora habría sido una trampa: el test diría B1.3 y la oferta
// exigiría B1.1.
function makeHabReq(aircraftTypeRatingId: string): OfferRequiredHabilitation {
  return {
    offerId: 'offer-test',
    aircraftTypeRatingId,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

// Dos casts, los dos estructurales:
//  - `as TechnicianHabilitation` porque una habilitación nombra la CREDENCIAL
//    de la que cuelga, y ese id no existe hasta que existe el técnico que la
//    tiene. makeTechnician lo rellena al enlazar (linkHabilitationToLicense) y
//    LANZA si no puede, así que una fixture sin licencia no llega nunca al
//    scorer disfrazada de válida.
//  - `as LicenseCode` porque el parámetro acepta el código de CUALQUIER
//    credencial (makeHabOn pasa `license.licenseCode`, que es
//    `AuthorityLicenseCode`) mientras que una habilitación sólo puede ser
//    Part-66: la FAA no tiene type ratings. Colgar una habilitación de un A&P
//    sería una fila imposible, y el cast es el sitio donde eso está escrito.
function makeHab(licenseCode: string, extra: Partial<TechnicianHabilitation> = {}): TechnicianHabilitation {
  return {
    id: `hab-${Math.random()}`,
    technicianId: 'tech-test',
    licenseCode: licenseCode as LicenseCode,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as TechnicianHabilitation;
}

// Fase 10: segundo parámetro opcional. La autoridad es EASA por defecto, que
// es lo que los 185 tests anteriores describían sin decirlo — y por eso ninguno
// de ellos cubre el cruce entre autoridades: ver la sección de Fase 10.
//
// Sin casts desde el paso 4: `AuthorityLicenseCode` incluye ya los tres
// códigos FAA, así que makeLicense('A&P', { authority: 'FAA' }) lo comprueba el
// compilador. Un código que no exista deja de compilar, que es lo que se
// quiere de una fixture.
function makeLicense(
  licenseCode: AuthorityLicenseCode,
  extra: Partial<TechnicianLicense> & { authority?: AuthorityCode } = {},
): TechnicianLicense {
  return {
    id: `lic-${Math.random()}`,
    technicianId: 'tech-test',
    licenseCode,
    createdAt: '2026-01-01T00:00:00.000Z',
    authority: 'EASA',
    ...extra,
  };
}

// Fase 10: la habilitación cuelga de UNA licencia concreta (technicianLicenseId),
// no de un código. Obligatorio en cuanto el técnico tiene el mismo código en
// dos autoridades.
function makeHabOn(license: TechnicianLicense, extra: Partial<TechnicianHabilitation> = {}): TechnicianHabilitation {
  return {
    ...makeHab(license.licenseCode, extra),
    technicianId: license.technicianId,
    technicianLicenseId: license.id,
  };
}

// Fase 10: cuelga de su licencia una habilitación hecha con makeHab(código).
// Existe para que los 180 tests sigan describiendo filas posibles cuando el
// scorer pase a leer technicianLicenseId. Sólo enlaza cuando no hay nada que
// adivinar: con dos licencias del mismo código lanza, y el test tiene que usar
// makeHabOn. Sin ninguna licencia de ese código la deja como está (hoy hay
// tests que construyen ese caso a propósito).
function linkHabilitationToLicense(hab: TechnicianHabilitation, licenses: TechnicianLicense[]): TechnicianHabilitation {
  if (hab.technicianLicenseId) return hab;
  const candidates = licenses.filter((l) => l.licenseCode === hab.licenseCode);
  if (candidates.length > 1) {
    throw new Error(
      `makeTechnician: habilitación ${hab.licenseCode} ambigua — hay ${candidates.length} licencias con ese código. Usa makeHabOn(licencia).`,
    );
  }
  if (candidates.length === 0) {
    throw new Error(
      `makeTechnician: la habilitación ${hab.licenseCode} no tiene licencia de la que colgar. ` +
        'Desde la 074 eso es una fila imposible: añade makeLicense(código) al fixture.',
    );
  }
  return { ...hab, technicianLicenseId: candidates[0].id };
}

// Fase 10: `engines: []` por defecto, y las habilitaciones sin licencia
// explícita se enlazan (ver linkHabilitationToLicense).
function makeTechnician(overrides: TechnicianOverrides = {}): TechnicianWithRelations {
  const technician = {
    id: 'tech-test',
    userId: 'user-test',
    anonymousCode: 'AVT-0000',
    firstName: 'Test',
    lastName: 'Technician',
    email: 'test@example.com',
    birthDate: '1990-01-01',
    technicianTypes: ['mechanic'],
    // Distinto del de la oferta a propósito, igual que locationCityId: así
    // el caso por defecto de estos tests sigue siendo "no coinciden".
    locationCountryCode: 'YY',
    availability: { immediately: true, contractTypes: ['permanent'] },
    verificationStatus: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    licenses: [],
    habilitations: [],
    aircraftExperience: [],
    engines: [],
    ...overrides,
  } as TechnicianWithRelations;
  return {
    ...technician,
    habilitations: technician.habilitations.map((h) => linkHabilitationToLicense(h, technician.licenses)),
  };
}

// Fase 6 tanda B. Existe para poder ASEVERAR que el scorer la ignora: sin un
// constructor, "ningún score cambia" sería una afirmación sin prueba.
function makeAircraftExperience(aircraftTypeRatingId: string, years?: number): TechnicianAircraftExperience {
  return {
    id: `exp-${aircraftTypeRatingId}-${years ?? 'na'}`,
    technicianId: 'tech-test',
    aircraftTypeRatingId,
    years,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

// ── Aircraft rating fixture builder + small fixture catalog ──────────────
// Deliberately 7 rows, never the real 80 — every field the domain type
// requires gets a sane default so each fixture below only needs to override
// what the test actually cares about.

function makeRating(
  overrides: Partial<AircraftTypeRatingCatalog> & Pick<AircraftTypeRatingCatalog, 'id'>,
): AircraftTypeRatingCatalog {
  return {
    manufacturer: 'TestMfr',
    aircraftFamily: 'TestFamily',
    easaEndorsement: `EASA-${overrides.id}`,
    displayName: `Test rating ${overrides.id}`,
    commercialAliases: [],
    aircraftCategory: 'general_aviation',
    priority: 50,
    isActive: true,
    ...overrides,
  };
}

const FIXTURES: AircraftTypeRatingCatalog[] = [
  makeRating({
    id: 'fx-a320-cfm56',
    manufacturer: 'Airbus',
    aircraftFamily: 'A318/A319/A320/A321',
    engineManufacturer: 'CFM International',
    engineFamily: 'CFM56',
    easaEndorsement: 'A320 CFM56-5',
    displayName: 'Airbus A320 family — CFM56',
    commercialAliases: ['A318', 'A319', 'A320', 'A321', 'CFM56'],
    aircraftCategory: 'commercial_airplane',
    productType: 'Aeroplane',
    priority: 100,
  }),
  makeRating({
    id: 'fx-a320-v2500',
    manufacturer: 'Airbus',
    aircraftFamily: 'A318/A319/A320/A321',
    engineManufacturer: 'IAE',
    engineFamily: 'V2500',
    easaEndorsement: 'A320 V2500',
    displayName: 'Airbus A320 family — V2500',
    commercialAliases: ['A320', 'V2500'],
    aircraftCategory: 'commercial_airplane',
    productType: 'Aeroplane',
    priority: 90,
  }),
  makeRating({
    id: 'fx-a320neo-leap1a',
    manufacturer: 'Airbus',
    aircraftFamily: 'A319neo/A320neo/A321neo',
    engineManufacturer: 'CFM International',
    engineFamily: 'LEAP-1A',
    easaEndorsement: 'A320 LEAP-1A',
    displayName: 'Airbus A320neo family — LEAP-1A',
    commercialAliases: ['A319neo', 'A320neo', 'A321neo', 'LEAP-1A', 'LEAP'],
    aircraftCategory: 'commercial_airplane',
    productType: 'Aeroplane',
    priority: 95,
  }),
  makeRating({
    id: 'fx-b777-ge90',
    manufacturer: 'Boeing',
    aircraftFamily: '777',
    engineManufacturer: 'GE Aviation',
    engineFamily: 'GE90',
    easaEndorsement: 'B777 GE90',
    displayName: 'Boeing 777 — GE90',
    commercialAliases: ['777', 'B777', 'GE90'],
    aircraftCategory: 'commercial_airplane',
    productType: 'Aeroplane',
    priority: 80,
  }),
  makeRating({
    id: 'fx-b787-genx',
    manufacturer: 'Boeing',
    aircraftFamily: '787',
    engineManufacturer: 'GE Aviation',
    engineFamily: 'GEnx',
    easaEndorsement: 'B787 GEnx',
    displayName: 'Boeing 787 — GEnx',
    commercialAliases: ['787', 'B787', 'GEnx', 'Dreamliner'],
    aircraftCategory: 'commercial_airplane',
    productType: 'Aeroplane',
    priority: 85,
  }),
  makeRating({
    id: 'fx-aw139-pt6',
    manufacturer: 'Leonardo',
    aircraftFamily: 'AW139',
    engineManufacturer: 'Pratt & Whitney Canada',
    engineFamily: 'PT6',
    easaEndorsement: 'AW139 PT6C',
    displayName: 'Leonardo AW139 — PT6',
    commercialAliases: ['AW139', 'PT6'],
    aircraftCategory: 'helicopter',
    productType: 'Helicopter',
    priority: 70,
  }),
  makeRating({
    id: 'fx-bell412-pt6-inactive',
    manufacturer: 'Bell',
    aircraftFamily: '412',
    engineManufacturer: 'Pratt & Whitney Canada',
    engineFamily: 'PT6',
    easaEndorsement: 'Bell 412 PT6 (test)',
    displayName: 'Bell 412 — PT6 (test, inactive)',
    commercialAliases: ['Bell412', '412'],
    aircraftCategory: 'helicopter',
    productType: 'Helicopter',
    priority: 10,
    isActive: false,
  }),
];

const RATING_INDEX = buildAircraftRatingIndex(FIXTURES);
const NOT_A_REAL_RATING = 'fx-pending-catalog-request'; // never in FIXTURES — models a rating still awaiting admin resolution

// ── Fase 10: motores ──────────────────────────────────────────────────────

function makeEngine(overrides: Omit<EngineCatalog, 'displayName' | 'isActive' | 'isGeneric'> & Partial<EngineCatalog>): EngineCatalog {
  return { displayName: `${overrides.manufacturer} ${overrides.id}`, isActive: true, isGeneric: false, ...overrides };
}

// Motor declarado en el perfil. Años display-only: existen para poder ASEVERAR
// que no puntúan.
function makeEngineDeclaration(engineId: string, years?: number): TechnicianEngineExperience {
  return {
    id: `engdecl-${engineId}-${years ?? 'na'}`,
    technicianId: 'tech-test',
    engineId,
    years,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

// Un rating con su motor. `engineId` ausente (no undefined) cuando la fila no
// lo tiene: así es como llega una fila sucia que nadie ha curado, y la
// diferencia importa porque el test del catálogo comprueba la AUSENCIA de la
// clave. Sin cast desde el paso 4: `engineId` es campo del catálogo.
function makeEngineRating(
  overrides: Partial<AircraftTypeRatingCatalog> & Pick<AircraftTypeRatingCatalog, 'id'>,
): AircraftTypeRatingCatalog {
  const { engineId, ...rest } = overrides;
  const rating = makeRating(rest);
  return engineId === undefined ? rating : { ...rating, engineId };
}

// Escalera de la oferta de referencia (pide CFM56-7B, turbofán):
//   CFM56-7B  -> exacto
//   CFM56-5B  -> misma familia
//   V2500-A5  -> mismo tipo (turbofán), otra familia
//   PT6C-67C  -> tipo distinto (turboeje)
const ENGINE_FIXTURES: EngineCatalog[] = [
  makeEngine({ id: 'eng-cfm56-7b', manufacturer: 'CFM International', family: 'CFM56', engineType: 'turbofan', displayName: 'CFM56-7B' }),
  makeEngine({ id: 'eng-cfm56-5b', manufacturer: 'CFM International', family: 'CFM56', engineType: 'turbofan', displayName: 'CFM56-5B' }),
  makeEngine({ id: 'eng-v2500-a5', manufacturer: 'International Aero Engines', family: 'V2500', engineType: 'turbofan', displayName: 'V2500-A5' }),
  makeEngine({ id: 'eng-pt6c-67c', manufacturer: 'Pratt & Whitney Canada', family: 'PT6C', engineType: 'turboshaft', displayName: 'PT6C-67C' }),
  makeEngine({ id: 'eng-rr-m250', manufacturer: 'Rolls-Royce', family: 'M250', engineType: 'turboshaft', displayName: 'Rolls-Royce M250' }),
  makeEngine({ id: 'eng-pw307', manufacturer: 'Pratt & Whitney Canada', family: 'PW300', engineType: 'turbofan', displayName: 'PW307' }),
  // Pistones con la forma del seed (migración 071): la familia es la línea del
  // fabricante, y la genérica "model not specified" va GENÉRICA e INACTIVA
  // (089). Existe para que los 140 ratings Lycoming sin modelo den crédito de
  // familia sin que nadie pueda declararla ni pedirla.
  makeEngine({ id: 'eng-lycoming-o360', manufacturer: 'Lycoming', family: 'Lycoming', engineType: 'piston', displayName: 'O-360 series' }),
  makeEngine({ id: 'eng-lycoming-o320', manufacturer: 'Lycoming', family: 'Lycoming', engineType: 'piston', displayName: 'O-320 series' }),
  makeEngine({
    id: 'eng-lycoming-generica',
    manufacturer: 'Lycoming',
    family: 'Lycoming',
    engineType: 'piston',
    displayName: 'Lycoming (model not specified)',
    isActive: false,
    isGeneric: true,
  }),
  makeEngine({ id: 'eng-continental-io550', manufacturer: 'Continental', family: 'Continental', engineType: 'piston', displayName: 'IO-550 series' }),
];

const ENGINE_INDEX: EngineIndex = buildEngineIndex(ENGINE_FIXTURES);

// Aparte de FIXTURES a propósito: los tests de Sort, Views y getByProductType
// cuentan las filas de FIXTURES, y meter éstas ahí los rompería.
const ENGINE_RATING_FIXTURES: AircraftTypeRatingCatalog[] = [
  // LIMPIAS — con engineId. Son las únicas que alimentan el escalón "motor
  // implícito en un type rating".
  makeEngineRating({
    id: 'fx-b737ng-cfm56-7b',
    manufacturer: 'Boeing',
    aircraftFamily: '737-600/737-700/737-800/737-900',
    engineManufacturer: 'CFM International',
    engineFamily: 'CFM56',
    easaEndorsement: 'Boeing 737-600/700/800/900 (CFM56)',
    displayName: 'Boeing 737NG — CFM56-7B',
    commercialAliases: ['737NG', 'CFM56-7B'],
    aircraftCategory: 'commercial_airplane',
    productType: 'Aeroplane',
    engineId: 'eng-cfm56-7b',
  }),
  // Paso 5b: la escalera y la elegibilidad por FAMILIA desde un type rating B1.
  makeEngineRating({
    id: 'fx-a320-cfm56-5b-limpia',
    manufacturer: 'Airbus',
    aircraftFamily: 'A318/A319/A320/A321',
    engineManufacturer: 'CFM International',
    engineFamily: 'CFM56',
    easaEndorsement: 'Airbus A318/A319/A320/A321 (CFM56-5B) — test',
    displayName: 'Airbus A320 family — CFM56-5B',
    aircraftCategory: 'commercial_airplane',
    productType: 'Aeroplane',
    engineId: 'eng-cfm56-5b',
  }),
  makeEngineRating({
    id: 'fx-bell407-rr250',
    manufacturer: 'Bell',
    aircraftFamily: 'Bell 407',
    engineManufacturer: 'Rolls-Royce',
    engineFamily: '250',
    easaEndorsement: 'Bell 407 (RR 250)',
    displayName: 'Bell 407 — Rolls-Royce 250',
    aircraftCategory: 'helicopter',
    productType: 'Helicopter',
    engineId: 'eng-rr-m250',
  }),
  // SUCIAS — copian la FORMA de filas reales de rotoaxismatch-dev, verificadas
  // el 2026-09-15, sin engineId:
  //  - `Rolls-Royce | Corp 250`: el Model 250 mal partido, 22 ratings detrás.
  //    El mismo motor aparece además como `250` (3) y `M250` (1).
  //  - modelo escrito en engine_manufacturer con engine_family NULL (`PW307`,
  //    `HF120`, `TPE331`…).
  // Un escalón que las lea por texto da un falso positivo.
  makeEngineRating({
    id: 'fx-sucia-a109-corp250',
    manufacturer: 'LEONARDO S.p.A.',
    aircraftFamily: 'Agusta A109 Series',
    engineManufacturer: 'Rolls-Royce',
    engineFamily: 'Corp 250',
    easaEndorsement: 'Agusta A109 (Corp 250) — test',
    displayName: 'Agusta A109 — Corp 250 (fila sucia)',
    aircraftCategory: 'helicopter',
    productType: 'Helicopter',
  }),
  makeEngineRating({
    id: 'fx-sucia-falcon7x-pw307',
    manufacturer: 'Dassault Aviation',
    aircraftFamily: 'Falcon 7X',
    engineManufacturer: 'PW307',
    easaEndorsement: 'Falcon 7X (PW307) — test',
    displayName: 'Falcon 7X — PW307 (fila sucia)',
    aircraftCategory: 'business_jet',
    productType: 'Aeroplane',
  }),
  // Enlazada a la genérica inactiva: así llegan los ratings de pistón cuyo
  // texto sólo dice el fabricante ("Piper PA-28 (Lycoming)").
  makeEngineRating({
    id: 'fx-pa28-lycoming-generica',
    manufacturer: 'PIPER AIRCRAFT',
    aircraftFamily: 'Piper PA-28',
    engineManufacturer: 'Lycoming',
    easaEndorsement: 'Piper PA-28 (Lycoming) — test',
    displayName: 'Piper PA-28 — Lycoming (sin modelo)',
    aircraftCategory: 'general_aviation',
    productType: 'Aeroplane',
    engineId: 'eng-lycoming-generica',
  }),
  // Control: el mismo avión con el motor concreto y activo.
  makeEngineRating({
    id: 'fx-pa28-o360-limpia',
    manufacturer: 'PIPER AIRCRAFT',
    aircraftFamily: 'Piper PA-28-180',
    engineManufacturer: 'Lycoming',
    easaEndorsement: 'Piper PA-28-180 (O-360) — test',
    displayName: 'Piper PA-28-180 — O-360',
    aircraftCategory: 'general_aviation',
    productType: 'Aeroplane',
    engineId: 'eng-lycoming-o360',
  }),
];

const RATING_INDEX_MOTORES = buildAircraftRatingIndex([...FIXTURES, ...ENGINE_RATING_FIXTURES]);

async function main() {
  // ── Matching ─────────────────────────────────────────────────────────

  await test('Matching — Case 1: exact category+rating match', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.level, 'exact', `expected level 'exact', got '${result.level}'`);
    assert.equal(result.missingRequirements.length, 0);
  });

  await test('Matching — Case 2: no false combination across categories', () => {
    // Fase 6 tanda D: la licencia la declara la OFERTA. `requiresAllAircraft`
    // para que la aeronave no cumplida entre en missingRequirements — antes
    // eso lo pedía la etiqueta `mandatory` de la fila.
    const offer = makeOffer({
      licenseCode: 'B1.3',
      requiresAllAircraft: true,
      requiredHabilitations: [makeHabReq('fx-aw139-pt6')],
    });
    const technician = makeTechnician({
      licenses: [makeLicense('B2'), makeLicense('B1.3')],
      // AW139 habilitation exists ONLY under B2, never under B1.3.
      habilitations: [makeHab('B2', { aircraftTypeRatingId: 'fx-aw139-pt6' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.notEqual(result.level, 'exact', 'must not report exact — B1.3+AW139 was never held together');
    assert.ok(
      result.missingRequirements.some((m) => m.includes('B1.3')),
      'missingRequirements should flag the unmet B1.3 + AW139 requirement',
    );
  });

  await test('Matching — Case 3: same family, different engine => related + clarification', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-v2500' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.level, 'related');
    assert.ok(result.clarifications.length > 0, 'expected at least one clarification about the engine mismatch');
  });

  await test('Matching — Case 4: technician can hold several distinct ratings under one license at once', () => {
    const habilitations = [
      makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' }),
      makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-v2500' }),
      makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320neo-leap1a' }),
    ];
    const uniqueKeys = new Set(habilitations.map((h) => `${h.technicianId}|${h.licenseCode}|${h.aircraftTypeRatingId}`));
    assert.equal(uniqueKeys.size, 3, 'all three (technicianId, licenseCode, aircraftTypeRatingId) keys must be distinct');

    // Each one independently resolves to an exact match for its own requirement.
    const technician = makeTechnician({ licenses: [makeLicense('B1.1')], habilitations });
    for (const ratingId of ['fx-a320-cfm56', 'fx-a320-v2500', 'fx-a320neo-leap1a']) {
      const offer = makeOffer({ requiredHabilitations: [makeHabReq(ratingId)] });
      const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
      assert.equal(result.level, 'exact', `expected exact match for ${ratingId}`);
    }
  });

  // Fase 5 (2026-08-04) — Cases 5, 5b, 5c and 5d lived here and are gone with
  // offer.requiredAircraftTypes (the approximate by-family requirement). All
  // four exercised evaluateLegacyBroadMatch's two aircraft-bearing branches,
  // which no longer exist: an offer cannot state an aircraft requirement
  // approximately anymore, only exactly as a license+rating pair.
  //
  // The same-row invariant Case 5 guarded (a license and an aircraft only
  // count when held in the SAME technician_habilitations row — see CLAUDE.md)
  // is NOT left uncovered: it now lives exclusively in the exact path, where
  // "Matching — Case 2: no false combination across categories" above asserts
  // exactly that, and Case 5b's family-vs-engine coverage is Case 3's job.

  await test('Matching — Case 6: preferred requirement mismatch stays related, never excluded', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-v2500' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.level, 'related');
    assert.equal(result.missingRequirements.length, 0, 'preferred misses must not appear in missingRequirements');
  });

  await test('Matching — Case 7: una aeronave exigida y no cumplida se señala, y el perfil sigue apareciendo como related', () => {
    const offer = makeOffer({ requiresAllAircraft: true, requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-v2500' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.level, 'related', 'unmet mandatory must not silently become exact');
    assert.ok(result.missingRequirements.length > 0, 'expected the unmet mandatory requirement to be listed');
  });

  await test('Matching — Case 8: a pending catalog request id is never a resolvable rating', () => {
    const offer = makeOffer({
      licenseCode: 'B1.3',
      requiresAllAircraft: true,
      requiredHabilitations: [makeHabReq(NOT_A_REAL_RATING)],
    });
    const technician = makeTechnician({ licenses: [makeLicense('B1.3')], habilitations: [] });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.notEqual(result.level, 'exact');
    assert.ok(result.missingRequirements.length > 0);
  });

  await test('Matching — Case 9: no match from sharing only a manufacturer (Boeing 777 vs Boeing 787)', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-b787-genx')] });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-b777-ge90' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.level, 'not_met', 'Boeing 777 and Boeing 787 are different families — same manufacturer alone must not count as related');
    assert.equal(result.clarifications.some((c) => c.includes('777')), false);
  });

  await test('Matching — Case 10: a habilitation referencing a deactivated rating still matches exactly, and its label still resolves', () => {
    const offer = makeOffer({ licenseCode: 'B1.3', requiredHabilitations: [makeHabReq('fx-bell412-pt6-inactive')] });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.3')],
      habilitations: [makeHab('B1.3', { aircraftTypeRatingId: 'fx-bell412-pt6-inactive' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.level, 'exact', 'matching must not penalize a rating just because it was later deactivated');
    assert.equal(
      getAircraftTypeRatingLabel('fx-bell412-pt6-inactive', RATING_INDEX),
      'Bell 412 — PT6 (test, inactive)',
      'an inactive rating referenced by an existing row must still resolve to its real display name, never a bare id',
    );
  });

  // ── Fase 2 — scoring redesign (qualification dominates, mandatory acts
  //    as a ceiling, absent data stays neutral) ─────────────────────────

  await test('Fase 2 — T1 (exact rating) awards the full habilitation weight (45)', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.breakdown.habilitation, 45, 'T1 must award the full habilitation weight');
    assert.equal(result.level, 'exact');
  });

  await test('Fase 2 — T2 (same family, different engine) awards a partial habilitation weight', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-v2500' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.ok(
      result.breakdown.habilitation > 0 && result.breakdown.habilitation < 45,
      `T2 must award a partial habilitation weight strictly between 0 and 45, got ${result.breakdown.habilitation}`,
    );
    assert.ok(result.clarifications.some((c) => c.includes('Same family, different engine')));
  });

  await test('Fase 5.3 — T3 is GONE: a habilitation with no rating id awards zero, never approximate credit', () => {
    // This replaces the two former T3 tests ("legacy code match scores below
    // T2" and "T3 is family-based since migration 022"). The tier had one
    // possible input — the legacy aircraftTypeCode column — which migration
    // 029 drops. A row that names no catalog rating is now indistinguishable
    // from no evidence at all, and must never produce the 0.29 credit or the
    // "Approximate match without engine data" clarification T3 used to emit.
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const technician = makeTechnician({ licenses: [makeLicense('B1.1')], habilitations: [makeHab('B1.1')] });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);

    assert.equal(result.breakdown.habilitation, 0, 'a rating-less habilitation must award zero habilitation credit');
    assert.ok(
      !result.clarifications.some((c) => c.includes('Approximate match without engine data')),
      'the T3 clarification must never be emitted again',
    );
  });

  await test('Fase 2 — T4 (no match at all) awards zero habilitation', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const technician = makeTechnician({ licenses: [makeLicense('B1.1')], habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-b777-ge90' })] });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.breakdown.habilitation, 0);
  });

  // Fase 9: el tope de cero cualificación vive en `offerMatchExplain.ts` y no
  // se exporta. 39 es su valor, y es la ÚNICA constante copiada a mano del
  // test de abajo — está ahí precisamente para poder comprobar CUÁL DE LAS DOS
  // cosas limita el resultado.
  const ZERO_QUALIFICATION_CAP = 39;

  await test('Fase 2 — regression: verificado + contrato + ubicación NUNCA fabrican un Partial sin cualificación', () => {
    // La versión anterior de este test asertaba `total <= 39` sobre un fixture
    // cuyo máximo alcanzable era 35: estaba en verde por aritmética, no porque
    // el tope funcionara. El "previously 55/100" de su nombre era el fósil —
    // cuando esos pesos sumaban 55 la aserción sí discriminaba, y al bajar a 35
    // se quedó muda sin que nadie se enterara.
    const offer = makeOffer({
      contractType: 'permanent',
      minYearsExperience: 1,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });

    // EL PERFIL ENTERO A FAVOR, incluida la ubicación —que por defecto no
    // coincide—. Sin eso el par no llega a su techo y la aserción vuelve a
    // sobrarle holgura. Los años no se declaran: la oferta pide un mínimo, y
    // que un dato ausente no bloquee lo fija su propio test.
    const perfilAFavor = {
      verificationStatus: 'verified' as const,
      availability: { immediately: true, contractTypes: ['permanent' as const] },
      locationCountryCode: offer.locationCountryCode,
    };
    const sinCualificacion = makeTechnician({ ...perfilAFavor, licenses: [], habilitations: [] });
    // El MISMO par salvo por lo único que este test discute.
    const conCualificacion = makeTechnician({
      ...perfilAFavor,
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });

    const sin = calculateOfferTechnicianMatch(offer, sinCualificacion, RATING_INDEX);
    const con = calculateOfferTechnicianMatch(offer, conCualificacion, RATING_INDEX);

    // Contra el TECHO ALCANZABLE, no contra el 39. Los tres componentes que no
    // son cualificación salen de la tabla de pesos de ESTA oferta, así que un
    // reajuste los mueve aquí también. El `min` es lo que hace hablar al test:
    // hoy manda el techo (35) y el tope no llega a morder — eso es un HECHO
    // sobre los pesos actuales, no una casualidad tapada; el día que el techo
    // vuelva a superar 39, quien manda pasa a ser el tope y esta misma línea
    // empieza a medirlo.
    const pesos = getMatchScoreWeights(offer);
    const techoSinCualificacion = pesos.verified + pesos.contractFit + pesos.location;
    assert.equal(
      sin.total,
      Math.min(techoSinCualificacion, ZERO_QUALIFICATION_CAP),
      `sin cualificación el par no puede pasar del menor entre su techo (${techoSinCualificacion}) y el tope (${ZERO_QUALIFICATION_CAP})`,
    );

    // Y la afirmación del nombre, que es de banda y no de número: por bien que
    // esté el perfil, sin cualificación no se entra en Partial.
    assert.notEqual(sin.label, 'Partial match');
    assert.notEqual(sin.label, 'Strong match');
    assert.notEqual(sin.label, 'Excellent match');

    // La que de verdad muerde y no depende de ningún peso: tener lo que la
    // oferta pide vale MÁS que tener el resto del perfil impecable. Es la regla
    // que abrió la Fase 8, y sobrevive a cualquier reajuste.
    assert.ok(
      sin.total < con.total,
      `el perfil entero a favor sin cualificación (${sin.total}) debe quedar por debajo del mismo par cualificado (${con.total})`,
    );
  });

  await test('Fase 2 — regression: an offer with no qualification requirement never reaches Excellent from profile alone', () => {
    const offer = makeOffer({ contractType: 'permanent', minYearsExperience: 1 });
    const technician = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.breakdown.habilitation, 0, 'habilitation must not be awarded when the offer has no qualification requirement');
    assert.equal(result.breakdown.license, 0);
    assert.notEqual(result.label, 'Excellent match');
    assert.ok(result.total <= 75, `expected the no-requirements ceiling (75), got ${result.total}`);
  });

  await test('Fase 2 — an exact rating with a weak profile outranks a correct license without the rating even with a perfect profile', () => {
    const offer = makeOffer({
      contractType: 'permanent',
      minYearsExperience: 5,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });

    const weakProfileExactRating = makeTechnician({
      verificationStatus: 'pending',
      availability: { immediately: false, contractTypes: ['short_term'] },
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const perfectProfileNoRating = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
      licenses: [makeLicense('B1.1')], // holds the right category...
      habilitations: [], // ...but no rating for it at all
    });

    const resultA = calculateOfferTechnicianMatch(offer, weakProfileExactRating, RATING_INDEX);
    const resultB = calculateOfferTechnicianMatch(offer, perfectProfileNoRating, RATING_INDEX);

    assert.ok(
      resultA.total > resultB.total,
      `exact rating + weak profile (${resultA.total}) must outrank correct license without rating + perfect profile (${resultB.total})`,
    );
    assert.equal(resultA.level, 'exact');
  });

  await test('Fase 2 — una aeronave exigida y no cumplida nunca deja pasar de 59, ni con el resto del perfil al máximo', () => {
    const offer = makeOffer({
      contractType: 'permanent',
      minYearsExperience: 1,
      requiresAllAircraft: true,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const technician = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-v2500' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.ok(result.missingRequirements.length > 0);
    assert.ok(result.total <= 59, `expected the mandatory cap (59), got ${result.total}`);
  });

  await test('Fase 2 — a rating endorsed with no declared experience still scores a full T1 match (absent data is neutral)', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })], // experienceYears/isCurrent left undefined
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.breakdown.habilitation, 45, 'undefined experienceYears/isCurrent must not reduce the T1 score');
    assert.equal(result.level, 'exact');
    assert.equal(result.missingRequirements.length, 0);
  });

  await test('Fase 2 — getMatchLabel boundaries include the renamed "Weak match" tier', () => {
    assert.equal(getMatchLabel(0), 'Weak match');
    assert.equal(getMatchLabel(39), 'Weak match');
    assert.equal(getMatchLabel(40), 'Partial match');
    assert.equal(getMatchLabel(59), 'Partial match');
    assert.equal(getMatchLabel(60), 'Strong match');
    assert.equal(getMatchLabel(80), 'Excellent match');
  });

  // ── Fase 5.3 — broad-only match no longer scores like an exact one ────
  // Before this change evaluateLegacyBroadMatch's outcome awarded FULL
  // habilitation + license credit (35 + 20), identical to a confirmed
  // exact rating. The existing Case 5* tests only ever asserted
  // `level === 'legacy'`, never the score — which is exactly why this bug
  // survived: the branch had zero score coverage. These tests pin it.

  await test('Fase 5.3 — CHECKPOINT 2 band regression: an exact mandatory match still reaches Excellent (unchanged by the broad-branch rework)', () => {
    const offer = makeOffer({
      contractType: 'permanent',
      minYearsExperience: 1,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const technician = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.level, 'exact');
    assert.equal(result.missingRequirements.length, 0);
    assert.equal(result.breakdown.habilitation, 45, 'exact match keeps the full habilitation weight');
    assert.ok(result.total >= 80, `exact match must stay in the Excellent band, got ${result.total}`);
    assert.equal(result.label, 'Excellent match');
  });

  // Fase 5 (2026-08-04) — the sibling test that asserted the
  // 'legacy_aircraft_confirmed' tier scored 26 (round(45 * 0.57)) is gone with
  // that tier: it could only ever be reached through requiredAircraftTypes.
  // Fase 9: la mención a BROAD_ONLY_CAP que había aquí se cae con el propio
  // tope, retirado en la tanda E. La fracción 0,29 sigue en el código y hoy
  // multiplica a cero — ver el test siguiente.

  await test('Fase 9 — una oferta que sólo pide licencia paga el bloque de cualificación ENTERO en la licencia', () => {
    // Mismo sujeto que el test de Fase 5 que sustituye —cómo reparte una
    // oferta que sólo pide licencia—, otro reparto. Aquél se llamaba "at the
    // category fraction" y esperaba 13 de 45: la aeronave que la oferta NUNCA
    // pidió descontaba 32 puntos. Con LICENSE_ONLY_WEIGHTS no hay fracción que
    // aplicar porque no hay eje de aeronave que puntuar.
    const licenseOnlyOffer = makeOffer({ licenseCode: 'B1.1' });
    const technician = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const licenseOnly = calculateOfferTechnicianMatch(licenseOnlyOffer, technician, RATING_INDEX);
    assert.equal(licenseOnly.level, 'legacy');
    assert.equal(licenseOnly.breakdown.habilitation, 0, 'sin aeronave nombrada no hay eje que puntuar NI que descontar');
    assert.equal(licenseOnly.breakdown.license, 65, 'los 45 de habilitación, íntegros');
    assert.ok(
      licenseOnly.clarifications.includes('Category-only match — no specific aircraft requirement to verify.'),
      'la aclaración se mantiene: ya no explica un recorte, dice qué se ha comprobado y qué no',
    );
  });

  // Fase 9 — AQUÍ VIVÍA 'Fase 5 — holding the category alone stays far below a
  // confirmed exact rating for the same weight', y se BORRA por el mismo
  // criterio que el de abajo: su aserción quedó en `45 > 0 * 3`, trivialmente
  // cierta desde que la rama de sólo-licencia paga 0 en habilitación. Una
  // aserción que ya no puede fallar ocupa el sitio de la cobertura sin darla.
  //
  // Su propiedad —tener la categoría sin el rating nunca alcanza al match
  // exacto cuando la oferta nombra la aeronave— sigue fijada, y con un fixture
  // que la dice mejor: la MISMA oferta y el MISMO técnico salvo por el rating.
  // El 39 lo fija el test de la trampa del `zeroOnRequestedAxis`; el 100, el
  // primer escalón de la escalera. Comparar dos ofertas DISTINTAS, como hacía
  // este test, nunca fue la forma de decirlo.

  // Fase 9 — AQUÍ VIVÍA 'Fase 5.3 — a perfect broad-only match is capped below
  // Excellent (BROAD_ONLY_CAP), and says why', y se BORRA sin sustituto.
  //
  // Su invariante dejó de existir en la tanda E, cuando se retiró
  // BROAD_ONLY_CAP por inalcanzable. Desde entonces no comprobaba ningún tope:
  // pasaba porque el 68 que producía el reparto viejo era menor que 79 por
  // casualidad aritmética. Un test cuya invariante ya no existe parece
  // cobertura sin serlo, que es peor que no tenerlo.
  //
  // Lo que su fixture demuestra AHORA —el candidato perfecto en una oferta de
  // sólo licencia llega a 100 y se lee "Excellent"— lo cubren los tests de la
  // escalera de la Fase 9, y allí es la afirmación principal, no un efecto
  // colateral.

  await test('Fase 5.3 — applyScoreCeilings: most restrictive ceiling always wins, in any combination', () => {
    // `hasBlocker` joined this object when BLOCKER_CAP was added — the flags
    // param is deliberately all-required (a forgotten flag would silently
    // mean "no cap", and the ladder is most-restrictive-wins). Only the
    // fixture gained the field; every expectation below is unchanged.
    // Fase 6 tanda E: `isBroadOnlyMatch` (BROAD_ONLY_CAP, 79) se retiró por
    // INALCANZABLE — el máximo de su rama era 68, así que su Math.min nunca
    // recortó nada. En aquel momento la escalera bajó a tres peldaños; el
    // techo blando por tipo de perfil la amplía ahora con una señal distinta.
    const none = {
      hasIncompleteAircraftSet: false,
      isZeroQualification: false,
      hasProfileTypeMismatch: false,
      hasBlocker: false,
    };
    assert.equal(applyScoreCeilings(100, none), 100, 'no ceiling applies to a confirmed exact match');
    assert.equal(applyScoreCeilings(100, { ...none, hasIncompleteAircraftSet: true }), 59);
    assert.equal(applyScoreCeilings(100, { ...none, isZeroQualification: true }), 39);
    assert.equal(applyScoreCeilings(100, { ...none, hasProfileTypeMismatch: true }), 19);
    assert.equal(applyScoreCeilings(100, { ...none, hasBlocker: true }), 19);
    // Overlaps — the stricter one wins regardless of declaration order.
    assert.equal(applyScoreCeilings(100, { ...none, hasIncompleteAircraftSet: true, isZeroQualification: true }), 39);
    assert.equal(
      applyScoreCeilings(100, {
        hasIncompleteAircraftSet: true,
        isZeroQualification: true,
        hasProfileTypeMismatch: true,
        hasBlocker: true,
      }),
      19,
      'the two lowest caps win over both qualification ceilings',
    );
    // A ceiling never RAISES a score that was already below it.
    assert.equal(applyScoreCeilings(20, { ...none, hasIncompleteAircraftSet: true, isZeroQualification: true }), 20);
    assert.equal(applyScoreCeilings(5, { ...none, hasBlocker: true }), 5);
  });

  await test('Fase 5.3 — real overlap: a broad-only offer the technician cannot satisfy hits the stricter ceiling, not BROAD_ONLY_CAP', () => {
    const offer = makeOffer({
      contractType: 'permanent',
      minYearsExperience: 1,
      licenseCode: 'B1.1',
    });
    const technician = makeTechnician({
      // Fase 5: the fixture used to hold B1.1 and fail on a separate aircraft
      // requirement. With the aircraft half gone, holding B1.1 would now be a
      // category match — so the technician holds a DIFFERENT category, which
      // is what "cannot satisfy" has to mean for a license-only offer.
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
      licenses: [makeLicense('B2')],
      habilitations: [],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.breakdown.habilitation, 0);
    assert.ok(result.total <= 39, `zero qualification must win over the broad ceiling, got ${result.total}`);
    assert.equal(result.label, 'Weak match');
  });

  // The needs_review labeling test that lived here is gone with T3 and with
  // the column itself (migration 029). It asserted that a flagged legacy row
  // scored identically to an unflagged one and only differed in its
  // clarification text — neither row shape can exist anymore.

  // ── Fase 3 — vigencia (expired / not-current degradation) ────────────
  // Fixed reference date so expired-vs-future fixtures are deterministic
  // regardless of when the suite runs.
  const NOW = new Date(2026, 5, 15); // 2026-06-15

  await test('Vigencia — absent issuedAt/expiresAt/isCurrent is neutral: full T1 score, no notice', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const tech = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const result = calculateOfferTechnicianMatch(offer, tech, buildAircraftRatingIndex(FIXTURES), NOW);
    assert.equal(result.breakdown.habilitation, 45);
    assert.deepEqual(result.vigenciaNotices, []);
    assert.equal(result.missingRequirements.length, 0);
  });

  await test('Vigencia — SIN certificación, un rating caducado degrada y nunca excluye', () => {
    // Fase 6 tanda E: éste era el comportamiento ÚNICO. Ahora es el de las
    // ofertas que no exigen certificar: para trabajar de ayudante el papel
    // vencido no borra la experiencia.
    const offer = makeOffer({
      requiresCertification: false,
      licenseCode: undefined,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const tech = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56', expiresAt: '2026-03-01' })],
    });
    const result = calculateOfferTechnicianMatch(offer, tech, buildAircraftRatingIndex(FIXTURES), NOW);
    assert.ok(result.breakdown.habilitation > 0, `expected a slight cut, not exclusion, got ${result.breakdown.habilitation}`);
    assert.ok(result.breakdown.habilitation < 65, 'y sí un recorte: la escala sin licencia es 65');
    assert.equal(result.level, 'exact', 'still tier exact — degraded, never excluded');
    assert.equal(result.missingRequirements.length, 0, 'a degraded exact match never becomes missingRequirements');
    assert.equal(result.vigenciaNotices.length, 1);
    assert.equal(result.vigenciaNotices[0].label, 'Expired');
    assert.ok(result.vigenciaNotices[0].detail.includes('2026-03'));
  });

  await test('Vigencia — CON certificación, un rating caducado NO vale: cae al cap de 39', () => {
    // Criterio de la tanda E. Legalmente no puede firmar ese trabajo, así que
    // cuenta como no tener la cualificación — no como tenerla un poco peor.
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const tech = makeTechnician({
      verificationStatus: 'verified',
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56', expiresAt: '2026-03-01' })],
    });
    const result = calculateOfferTechnicianMatch(offer, tech, buildAircraftRatingIndex(FIXTURES), NOW);
    assert.equal(result.breakdown.habilitation, 0, 'caducado cuenta como no tenerlo');
    assert.ok(result.total <= 39, `esperaba ZERO_QUALIFICATION_CAP, got ${result.total}`);
    assert.ok(
      result.missingRequirements.some((m) => m.includes('expired')),
      'el motivo se nombra, y dice "caducado", no "te falta" — es accionable: renovar',
    );
    assert.equal(result.vigenciaNotices.length, 1, 'el aviso de vigencia se mantiene');
  });

  await test('Vigencia — CON certificación, isCurrent=false degrada pero NO excluye', () => {
    // La caducidad es un hecho registral; "no current" es una autodeclaración
    // en un campo opcional. Excluir por ella castigaría la honestidad.
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const tech = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56', isCurrent: false })],
    });
    const result = calculateOfferTechnicianMatch(offer, tech, buildAircraftRatingIndex(FIXTURES), NOW);
    assert.ok(result.breakdown.habilitation > 0, 'no excluye');
    assert.ok(result.breakdown.habilitation < 45, 'pero degrada');
    assert.equal(result.level, 'exact');
    assert.equal(result.missingRequirements.length, 0);
  });

  await test('Vigencia — precedence: an expired date wins even when isCurrent is explicitly true', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const tech = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56', expiresAt: '2026-03-01', isCurrent: true })],
    });
    const result = calculateOfferTechnicianMatch(offer, tech, buildAircraftRatingIndex(FIXTURES), NOW);
    assert.equal(result.vigenciaNotices.length, 1, 'exactly one notice — never two contradictory ones');
    assert.equal(result.vigenciaNotices[0].label, 'Expired', 'expired date wins over isCurrent=true');
  });

  await test('Vigencia — inverse case: a future/absent expiry with isCurrent=false is a distinct "Not current" notice', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const tech = makeTechnician({
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56', expiresAt: '2027-01-01', isCurrent: false })],
    });
    const result = calculateOfferTechnicianMatch(offer, tech, buildAircraftRatingIndex(FIXTURES), NOW);
    assert.equal(result.vigenciaNotices.length, 1);
    assert.equal(result.vigenciaNotices[0].label, 'Not current');
  });

  await test('Vigencia — an expired license affects a rating with no vigencia issues of its own, with one combined notice', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const tech = makeTechnician({
      licenses: [{ ...makeLicense('B1.1'), expiresAt: '2026-01-01' }],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const result = calculateOfferTechnicianMatch(offer, tech, buildAircraftRatingIndex(FIXTURES), NOW);
    assert.equal(result.vigenciaNotices.length, 1);
    assert.equal(result.vigenciaNotices[0].label, 'Expired');
    assert.ok(result.vigenciaNotices[0].detail.startsWith('License B1.1 expired 2026-01'));
    assert.ok(result.vigenciaNotices[0].detail.includes('all its ratings affected'));
  });

  await test('Vigencia — license AND rating both expired produce exactly one combined notice, not two', () => {
    const offer = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const tech = makeTechnician({
      licenses: [{ ...makeLicense('B1.1'), expiresAt: '2026-01-01' }],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56', expiresAt: '2026-02-01' })],
    });
    const result = calculateOfferTechnicianMatch(offer, tech, buildAircraftRatingIndex(FIXTURES), NOW);
    assert.equal(result.vigenciaNotices.length, 1, 'one combined notice, not one per source');
    assert.ok(result.vigenciaNotices[0].detail.startsWith('License B1.1 expired'), 'license-level message takes precedence');
  });

  // ── Mapper ───────────────────────────────────────────────────────────

  await test('Mapper — mapAircraftTypeRatingRow converts a Supabase snake_case row to the domain shape', () => {
    const row: AircraftTypeRatingRow = {
      id: 'fx-row-1',
      manufacturer: 'Airbus',
      aircraft_family: 'A320',
      engine_manufacturer: null,
      engine_family: null,
      easa_endorsement: 'A320 GENERIC',
      display_name: 'Airbus A320 (generic)',
      commercial_aliases: null,
      aircraft_category: 'commercial_airplane',
      easa_group: null,
      source_revision: null,
      priority: 42,
      is_active: true,
    };
    const mapped = mapAircraftTypeRatingRow(row);
    assert.equal(mapped.id, 'fx-row-1');
    assert.equal(mapped.aircraftFamily, 'A320');
    assert.equal(mapped.engineManufacturer, undefined, 'null engine_manufacturer must map to undefined, not null');
    assert.equal(mapped.engineFamily, undefined);
    assert.deepEqual(mapped.commercialAliases, [], 'null commercial_aliases must map to an empty array, not null');
    assert.equal(mapped.easaGroup, undefined);
    assert.equal(mapped.sourceRevision, undefined);
    assert.equal(mapped.priority, 42);
    assert.equal(mapped.isActive, true);
  });

  // ── Sort ─────────────────────────────────────────────────────────────

  await test('Sort — sortAircraftTypeRatings orders by priority descending', () => {
    const shuffled = [...FIXTURES].reverse();
    const sorted = sortAircraftTypeRatings(shuffled);
    const expectedIds = [...FIXTURES].sort((a, b) => b.priority - a.priority).map((r) => r.id);
    assert.deepEqual(sorted.map((r) => r.id), expectedIds);
  });

  await test('Sort — ties on priority break by manufacturer, then family, then engine', () => {
    const tied = [
      makeRating({ id: 'fx-tie-b', manufacturer: 'Bravo', aircraftFamily: 'F2', engineFamily: 'E1', priority: 50 }),
      makeRating({ id: 'fx-tie-a2', manufacturer: 'Alpha', aircraftFamily: 'F2', engineFamily: 'E1', priority: 50 }),
      makeRating({ id: 'fx-tie-a1', manufacturer: 'Alpha', aircraftFamily: 'F1', engineFamily: 'E2', priority: 50 }),
    ];
    const sorted = sortAircraftTypeRatings(tied);
    assert.deepEqual(sorted.map((r) => r.id), ['fx-tie-a1', 'fx-tie-a2', 'fx-tie-b'], 'expected Alpha/F1 < Alpha/F2 < Bravo/F2');
  });

  // ── Search ───────────────────────────────────────────────────────────

  await test('Search — filterAircraftTypeRatings finds an alias match (A320neo)', () => {
    const results = filterAircraftTypeRatings(FIXTURES, 'A320neo');
    assert.ok(results.some((r) => r.id === 'fx-a320neo-leap1a'));
    assert.ok(
      results.every(
        (r) => r.commercialAliases.some((a) => a.toLowerCase().includes('a320neo')) || r.displayName.toLowerCase().includes('a320neo'),
      ),
    );
  });

  await test('Search — is case-insensitive and tolerates surrounding whitespace', () => {
    const a = filterAircraftTypeRatings(FIXTURES, 'A320neo');
    const b = filterAircraftTypeRatings(FIXTURES, '  a320NEO  ');
    assert.deepEqual(b.map((r) => r.id), a.map((r) => r.id));
  });

  await test('Search — is a pure text filter; it does not exclude inactive rows on its own', () => {
    const results = filterAircraftTypeRatings(FIXTURES, 'PT6');
    const ids = results.map((r) => r.id);
    assert.ok(ids.includes('fx-aw139-pt6'));
    assert.ok(
      ids.includes('fx-bell412-pt6-inactive'),
      'excluding inactive rows for NEW selections is the repository/UI layer\'s job (getAircraftTypeRatings filters is_active=true before the picker ever calls this), not this function\'s',
    );
  });

  await test('Search — matches by commercial nickname (Dreamliner)', () => {
    const results = filterAircraftTypeRatings(FIXTURES, 'Dreamliner');
    assert.equal(results.length, 1);
    assert.equal(results[0].aircraftFamily, '787');
  });

  // ── Views (Fase 3b — getFamilies/getByProductType/searchRatings) ─────

  await test('Views — getFamilies groups same manufacturer+family ratings together, sorted by priority', () => {
    const groups = getFamilies(FIXTURES);
    const a320 = groups.find((g) => g.key === 'Airbus::A318/A319/A320/A321');
    assert.ok(a320, 'expected an A320 family group');
    assert.equal(a320!.ratings.length, 2);
    assert.deepEqual(a320!.ratings.map((r) => r.id), ['fx-a320-cfm56', 'fx-a320-v2500'], 'higher-priority CFM56 (100) before V2500 (90)');
  });

  await test('Views — getFamilies never merges the same family string across different manufacturers', () => {
    const crossManufacturer: AircraftTypeRatingCatalog[] = [
      { ...FIXTURES[0], id: 'fx-fake-a', manufacturer: 'MakerA', aircraftFamily: 'Shared100' },
      { ...FIXTURES[0], id: 'fx-fake-b', manufacturer: 'MakerB', aircraftFamily: 'Shared100' },
    ];
    const groups = getFamilies(crossManufacturer);
    assert.equal(groups.length, 2, 'same family string, different manufacturer -> two distinct groups');
  });

  await test('Views — getFamilies orders groups by each group\'s best (highest-priority) member', () => {
    const groups = getFamilies(FIXTURES);
    const keys = groups.map((g) => g.key);
    assert.ok(keys.indexOf('Airbus::A318/A319/A320/A321') < keys.indexOf('Leonardo::AW139'), 'priority 100 group before priority 70 group');
  });

  await test('Views — getByProductType(Aeroplane) returns only airplane ratings, excludes helicopters', () => {
    const results = getByProductType(FIXTURES, 'Aeroplane');
    assert.equal(results.length, 5);
    assert.ok(results.every((r) => r.aircraftCategory !== 'helicopter'));
  });

  await test('Views — getByProductType(Helicopter) includes inactive ratings (facet, not an active filter)', () => {
    const results = getByProductType(FIXTURES, 'Helicopter');
    assert.equal(results.length, 2);
    assert.ok(results.some((r) => r.id === 'fx-bell412-pt6-inactive'), 'inactive helicopter still matches the facet — isActive filtering is a separate concern');
  });

  await test('Views — a rating with productType unset matches no facet, never guessed into one', () => {
    const withUnset: AircraftTypeRatingCatalog[] = [
      ...FIXTURES,
      makeRating({ id: 'fx-unset-product-type', manufacturer: 'Unknown', aircraftFamily: 'Unknown', aircraftCategory: 'general_aviation' }),
    ];
    assert.ok(!getByProductType(withUnset, 'Aeroplane').some((r) => r.id === 'fx-unset-product-type'));
    assert.ok(!getByProductType(withUnset, 'Helicopter').some((r) => r.id === 'fx-unset-product-type'));
  });

  await test('Views — searchRatings is the centralized search entry point (delegates to filterAircraftTypeRatings)', () => {
    assert.deepEqual(searchRatings(FIXTURES, 'CFM56'), filterAircraftTypeRatings(FIXTURES, 'CFM56'));
    assert.equal(searchRatings(FIXTURES, 'CFM56')[0].id, 'fx-a320-cfm56');
  });

  // ── resolveAircraftCategoryForFamilyKeys (Fase 5.3 — replaces the
  // deleted constants/aircraftTypes.ts's inferAircraftCategory() for
  // app/technician/offers/index.tsx's Airplane/Helicopter filter, now that
  // offer.requiredAircraftTypes stores family keys, migration 022) ──────

  await test('resolveAircraftCategoryForFamilyKeys — empty list is null, never a guessed category', () => {
    assert.equal(resolveAircraftCategoryForFamilyKeys(FIXTURES, []), null);
  });

  await test('resolveAircraftCategoryForFamilyKeys — a single Aeroplane family key resolves to "airplane"', () => {
    const key = getAircraftFamilyKey({ manufacturer: 'Airbus', aircraftFamily: 'A318/A319/A320/A321' });
    assert.equal(resolveAircraftCategoryForFamilyKeys(FIXTURES, [key]), 'airplane');
  });

  await test('resolveAircraftCategoryForFamilyKeys — a single Helicopter family key resolves to "helicopter"', () => {
    const key = getAircraftFamilyKey({ manufacturer: 'Leonardo', aircraftFamily: 'AW139' });
    assert.equal(resolveAircraftCategoryForFamilyKeys(FIXTURES, [key]), 'helicopter');
  });

  await test('resolveAircraftCategoryForFamilyKeys — mixing an Aeroplane and a Helicopter family key resolves to "mixed"', () => {
    const airplaneKey = getAircraftFamilyKey({ manufacturer: 'Boeing', aircraftFamily: '777' });
    const helicopterKey = getAircraftFamilyKey({ manufacturer: 'Leonardo', aircraftFamily: 'AW139' });
    assert.equal(resolveAircraftCategoryForFamilyKeys(FIXTURES, [airplaneKey, helicopterKey]), 'mixed');
  });

  await test('resolveAircraftCategoryForFamilyKeys — a family key not in the loaded catalog is never guessed into a category', () => {
    assert.equal(resolveAircraftCategoryForFamilyKeys(FIXTURES, ['Nonexistent::Family']), null);
  });

  await test('resolveAircraftCategoryForFamilyKeys — regression: the real live offer 922c1206\'s 3 helicopter family keys all resolve to "helicopter" (verified against rotoaxismatch-dev 2026-07-27)', () => {
    const ratings = [
      makeRating({ id: 'fx-as350', manufacturer: 'Airbus Helicopters', aircraftFamily: 'Eurocopter AS 350', productType: 'Helicopter', displayName: 'Eurocopter AS 350', commercialAliases: ['AS350'] }),
      makeRating({ id: 'fx-ec135', manufacturer: 'Airbus Helicopters', aircraftFamily: 'Eurocopter EC 135', productType: 'Helicopter', displayName: 'Eurocopter EC 135', commercialAliases: ['EC135'] }),
      makeRating({ id: 'fx-s76c', manufacturer: 'Sikorsky', aircraftFamily: 'Sikorsky S-76C', productType: 'Helicopter', displayName: 'Sikorsky S-76C', commercialAliases: ['S-76C'] }),
    ];
    const familyKeys = [
      'Airbus Helicopters::Eurocopter AS 350',
      'Airbus Helicopters::Eurocopter EC 135',
      'Sikorsky::Sikorsky S-76C',
    ];
    assert.equal(resolveAircraftCategoryForFamilyKeys(ratings, familyKeys), 'helicopter');
  });

  // ── getAircraftFamilyKey (migration 022) ─────────────────────────────
  // The three resolveLegacyCodeToFamilyKeys tests that lived here went with
  // the function itself (Fase 5.3) — nothing resolves a bare aircraft code
  // to a family anymore.

  await test('getAircraftFamilyKey matches the key getFamilies() groups by — never allowed to drift apart', () => {
    const groups = getFamilies(FIXTURES);
    const a320Group = groups.find((g) => g.aircraftFamily === 'A318/A319/A320/A321')!;
    assert.equal(getAircraftFamilyKey(FIXTURES.find((r) => r.id === 'fx-a320-cfm56')!), a320Group.key);
  });

  // ── License category -> productType pre-filter (Fase 3b.4) ───────────
  // Lado TÉCNICO: qué aeronaves puede colgar el técnico de cada licencia.
  // El lado oferta es otra tabla y se prueba más abajo.

  await test('Category product type — A1/A2/B1.1/B1.2/B3 map to Aeroplane', () => {
    for (const code of ['A1', 'A2', 'B1.1', 'B1.2', 'B3'] as const) {
      assert.equal(getLicenseRatingProductType(code), 'Aeroplane', `expected ${code} -> Aeroplane`);
    }
  });

  await test('Category product type — A3/A4/B1.3/B1.4 map to Helicopter', () => {
    for (const code of ['A3', 'A4', 'B1.3', 'B1.4'] as const) {
      assert.equal(getLicenseRatingProductType(code), 'Helicopter', `expected ${code} -> Helicopter`);
    }
  });

  await test('Category product type — B2/B2L/C cover both, never pre-filtered', () => {
    for (const code of ['B2', 'B2L', 'C'] as const) {
      assert.equal(getLicenseRatingProductType(code), undefined, `expected ${code} -> no pre-filter`);
    }
  });

  // Corrección 2026-08-14: la L salió del grupo "cubren ambos". Cubre
  // veleros, motoveleros, globos y dirigibles — nada de rotorcraft — y los
  // únicos con filas en el catálogo son los 3 dirigibles de gas. Antes
  // devolvía undefined y se podía colgar un A320neo de una L.
  await test('Category product type — L maps to Gas Airship only, never to aeroplanes or helicopters', () => {
    assert.equal(getLicenseRatingProductType('L'), 'Gas Airship');
    assert.notEqual(getLicenseRatingProductType('L'), 'Aeroplane');
    assert.notEqual(getLicenseRatingProductType('L'), 'Helicopter');
  });

  // ── isLicenseCompatibleWithProductType (lado OFERTA, migración 047) ───
  // Segunda pregunta, tabla propia: qué licencias puede pedir una oferta de
  // cada producto. Coincide con la de arriba en A/B1, y diverge en la L.

  await test('Offer-side licence filter — a category with its own product only fits that product', () => {
    for (const code of ['A1', 'A2', 'B1.1', 'B1.2', 'B3'] as const) {
      assert.equal(isLicenseCompatibleWithProductType(code, 'Aeroplane'), true, `${code} + Aeroplane`);
      assert.equal(isLicenseCompatibleWithProductType(code, 'Helicopter'), false, `${code} + Helicopter`);
    }
    for (const code of ['A3', 'A4', 'B1.3', 'B1.4'] as const) {
      assert.equal(isLicenseCompatibleWithProductType(code, 'Helicopter'), true, `${code} + Helicopter`);
      assert.equal(isLicenseCompatibleWithProductType(code, 'Aeroplane'), false, `${code} + Aeroplane`);
    }
  });

  await test('Offer-side licence filter — B2/B2L/C can be asked for in either product', () => {
    for (const code of ['B2', 'B2L', 'C'] as const) {
      assert.equal(isLicenseCompatibleWithProductType(code, 'Aeroplane'), true, `${code} + Aeroplane`);
      assert.equal(isLicenseCompatibleWithProductType(code, 'Helicopter'), true, `${code} + Helicopter`);
    }
  });

  // El caso que obligó a separar las dos tablas. En el lado técnico la L es
  // 'Gas Airship'; aquí sigue apareciendo en ofertas de aviones (una empresa
  // con flota de ligeros puede pedir L y describir la aeronave en el texto:
  // la rama de sólo licencia soporta ofertas sin habilitaciones) y desaparece
  // de las de helicópteros, donde la norma sí la excluye.
  await test('Offer-side licence filter — L stays askable in aeroplane offers and disappears from helicopter ones', () => {
    assert.equal(isLicenseCompatibleWithProductType('L', 'Aeroplane'), true);
    assert.equal(isLicenseCompatibleWithProductType('L', 'Helicopter'), false);
  });

  await test('Offer-side licence filter — is NOT derived from the technician-side table (the L proves they are two questions)', () => {
    // Si alguien vuelve a fusionarlas, la L se cae de las ofertas de aviones
    // (su producto propio, 'Gas Airship', no es un producto de oferta) y este
    // test lo detecta. No es redundante con el de arriba: fija la RAZÓN.
    assert.equal(getLicenseRatingProductType('L'), 'Gas Airship');
    assert.equal(isLicenseCompatibleWithProductType('L', 'Aeroplane'), true);
  });

  // ── isUnusualCombination (Fase 3b screen 2) ───────────────────────────

  await test('isUnusualCombination — flags a helicopter rating declared under an aeroplane-only license (B1.1 + H145)', () => {
    assert.equal(isUnusualCombination('B1.1', 'Helicopter'), true);
  });

  await test('isUnusualCombination — flags an aeroplane rating declared under a helicopter-only license (B1.3 + A320)', () => {
    assert.equal(isUnusualCombination('B1.3', 'Aeroplane'), true);
  });

  await test('isUnusualCombination — never flags a matching combination', () => {
    assert.equal(isUnusualCombination('B1.1', 'Aeroplane'), false);
    assert.equal(isUnusualCombination('B1.3', 'Helicopter'), false);
  });

  await test('isUnusualCombination — never flags B2/B2L/C, which cover both product types', () => {
    for (const code of ['B2', 'B2L', 'C'] as const) {
      assert.equal(isUnusualCombination(code, 'Aeroplane'), false);
      assert.equal(isUnusualCombination(code, 'Helicopter'), false);
    }
  });

  // La L salió de ese grupo con la corrección del 2026-08-14. Verificado en
  // rotoaxismatch-dev ese mismo día: technician_habilitations no tiene ni una
  // fila con license_code = 'L', así que empezar a marcarlas no toca ningún
  // dato existente.
  await test('isUnusualCombination — flags anything but an airship declared under an L', () => {
    assert.equal(isUnusualCombination('L', 'Aeroplane'), true);
    assert.equal(isUnusualCombination('L', 'Helicopter'), true);
    assert.equal(isUnusualCombination('L', 'Gas Airship'), false);
  });

  await test('isUnusualCombination — never guesses when the rating\'s productType is unpopulated', () => {
    assert.equal(isUnusualCombination('B1.1', undefined), false);
  });

  // ── Cache ────────────────────────────────────────────────────────────

  await test('Cache — serves the cached result within the TTL without refetching', async () => {
    let calls = 0;
    let clock = 0;
    const cache = createAircraftTypeRatingsCache({
      fetchActive: async () => {
        calls += 1;
        return FIXTURES.filter((f) => f.isActive);
      },
      fetchByIds: async (ids) => FIXTURES.filter((f) => ids.includes(f.id)),
      ttlMs: 1000,
      now: () => clock,
    });
    await cache.getActiveRatings();
    await cache.getActiveRatings();
    assert.equal(calls, 1, 'a second call within the TTL must not refetch');
  });

  await test('Cache — refetches once the TTL has expired', async () => {
    let calls = 0;
    let clock = 0;
    const cache = createAircraftTypeRatingsCache({
      fetchActive: async () => {
        calls += 1;
        return FIXTURES.filter((f) => f.isActive);
      },
      fetchByIds: async () => [],
      ttlMs: 1000,
      now: () => clock,
    });
    await cache.getActiveRatings();
    clock += 1001;
    await cache.getActiveRatings();
    assert.equal(calls, 2, 'a call after TTL expiry must refetch');
  });

  await test('Cache — invalidate() forces the next call to refetch even within the TTL', async () => {
    let calls = 0;
    const clock = 0;
    const cache = createAircraftTypeRatingsCache({
      fetchActive: async () => {
        calls += 1;
        return FIXTURES.filter((f) => f.isActive);
      },
      fetchByIds: async () => [],
      ttlMs: 10_000,
      now: () => clock,
    });
    await cache.getActiveRatings();
    cache.invalidate();
    await cache.getActiveRatings();
    assert.equal(calls, 2, 'invalidate() must force a refetch on the next call');
  });

  await test('Cache — a failed background refresh keeps serving the last good catalog', async () => {
    let attempt = 0;
    let clock = 0;
    const cache = createAircraftTypeRatingsCache({
      fetchActive: async () => {
        attempt += 1;
        if (attempt === 1) return FIXTURES.filter((f) => f.isActive);
        throw new Error('network down');
      },
      fetchByIds: async () => [],
      ttlMs: 1000,
      now: () => clock,
    });
    const first = await cache.getActiveRatings();
    assert.ok(first.length > 0);
    clock += 1001;
    const second = await cache.getActiveRatings();
    assert.deepEqual(second.map((r) => r.id), first.map((r) => r.id), 'must keep serving the previous catalog when a refresh fails');
    assert.equal(cache.getState().status, 'success', 'status must stay success, not flip to error, when stale data exists');
    assert.ok(cache.getState().error, 'the failure must still be recorded on state.error');
  });

  await test("Cache — a failed fetch with no previous data rejects and leaves status 'error'", async () => {
    const cache = createAircraftTypeRatingsCache({
      fetchActive: async () => {
        throw new Error('network down');
      },
      fetchByIds: async () => [],
    });
    await assert.rejects(() => cache.getActiveRatings());
    assert.equal(cache.getState().status, 'error');
  });

  await test('Cache — retrying after an error (with no previous data) can succeed', async () => {
    let attempt = 0;
    const cache = createAircraftTypeRatingsCache({
      fetchActive: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('network down');
        return FIXTURES.filter((f) => f.isActive);
      },
      fetchByIds: async () => [],
    });
    await assert.rejects(() => cache.getActiveRatings());
    const retried = await cache.getActiveRatings();
    assert.ok(retried.length > 0);
    assert.equal(cache.getState().status, 'success');
  });

  await test('Cache — fetchActive resolving to zero rows is status \'success\' with an empty array (the hook derives the UI "empty" state from this)', async () => {
    const cache = createAircraftTypeRatingsCache({
      fetchActive: async () => [],
      fetchByIds: async () => [],
    });
    const result = await cache.getActiveRatings();
    assert.deepEqual(result, []);
    assert.equal(cache.getState().status, 'success');
  });

  await test('Cache — concurrent calls while a fetch is in flight share a single fetchActive request', async () => {
    let calls = 0;
    let resolveFetch: (v: AircraftTypeRatingCatalog[]) => void = () => {};
    const cache = createAircraftTypeRatingsCache({
      fetchActive: () => {
        calls += 1;
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      },
      fetchByIds: async () => [],
    });
    const p1 = cache.getActiveRatings();
    const p2 = cache.getActiveRatings();
    resolveFetch(FIXTURES.filter((f) => f.isActive));
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(calls, 1, 'expected exactly one fetchActive call for two concurrent requests');
    assert.equal(r1.length, r2.length);
  });

  await test('Cache getRatingsByIds — includes inactive ratings so existing references still resolve', async () => {
    const cache = createAircraftTypeRatingsCache({
      fetchActive: async () => [],
      fetchByIds: async (ids) => FIXTURES.filter((f) => ids.includes(f.id)),
    });
    const result = await cache.getRatingsByIds(['fx-aw139-pt6', 'fx-bell412-pt6-inactive']);
    const byId = new Map(result.map((r) => [r.id, r]));
    assert.ok(byId.has('fx-bell412-pt6-inactive'), 'an inactive rating id must still resolve via getRatingsByIds');
    assert.equal(byId.get('fx-bell412-pt6-inactive')?.isActive, false);
    assert.equal(byId.get('fx-bell412-pt6-inactive')?.displayName, 'Bell 412 — PT6 (test, inactive)');
  });

  await test('Cache getRatingsByIds — batches missing ids into a single fetchByIds call, never one request per id', async () => {
    const fetchByIdsCalls: string[][] = [];
    const cache = createAircraftTypeRatingsCache({
      fetchActive: async () => [],
      fetchByIds: async (ids) => {
        fetchByIdsCalls.push([...ids]);
        return FIXTURES.filter((f) => ids.includes(f.id));
      },
    });
    const ids = ['fx-a320-cfm56', 'fx-a320-v2500', 'fx-a320neo-leap1a'];
    const first = await cache.getRatingsByIds(ids);
    assert.equal(first.length, 3);
    assert.equal(fetchByIdsCalls.length, 1, 'expected exactly one fetchByIds call for three unknown ids');
    assert.deepEqual([...fetchByIdsCalls[0]].sort(), [...ids].sort());

    const idsAgain = ['fx-a320-cfm56', 'fx-a320-v2500', 'fx-b777-ge90'];
    const second = await cache.getRatingsByIds(idsAgain);
    assert.equal(second.length, 3);
    assert.equal(fetchByIdsCalls.length, 2, 'expected exactly one more fetchByIds call for the single newly-seen id');
    assert.deepEqual(fetchByIdsCalls[1], ['fx-b777-ge90']);
  });

  // ── Backfill plan ────────────────────────────────────────────────────
  // The five tests that lived here went with src/utils/aircraftRatingBackfillPlan.ts
  // and scripts/backfillLegacyAircraftRatings.ts (Fase 5.3, 2026-07-28).
  // They covered resolving a legacy aircraft code to a rating — mapped /
  // ambiguous / no_match / collision_avoided. With the aircraft_types
  // catalog retired outright there are no legacy codes left to resolve, so
  // the planner, the script and its npm entry are all gone.

  // ── License update plan ─────────────────────────────────────────────
  // Regression coverage for the profile save bug: deleting a
  // technician_licenses row that technician_habilitations still
  // references violates fk_technician_habilitations_license. These tests
  // pin the invariant that closes it — an existing license/habilitation
  // pair is never lost, whether or not the technician also deselects the
  // license in the same save.

  await test('License update plan — a license the technician keeps is never touched, regardless of dependents', () => {
    const plan = planLicenseRemoval([], ['B1.1']);
    assert.deepEqual(plan, { deletes: [], blocked: [] });
  });

  await test('License update plan — a deselected license with no dependent habilitations is safe to delete', () => {
    const plan = planLicenseRemoval(['A1'], []);
    assert.deepEqual(plan, { deletes: ['A1'], blocked: [] });
  });

  await test('License update plan — a deselected license with a dependent habilitation is blocked, not deleted', () => {
    const plan = planLicenseRemoval(['B1.1'], ['B1.1']);
    assert.deepEqual(plan, { deletes: [], blocked: ['B1.1'] });
  });

  await test('License update plan — a mixed batch splits correctly between safe deletes and blocked codes', () => {
    const plan = planLicenseRemoval(['A1', 'B1.1', 'C1'], ['B1.1']);
    assert.deepEqual(plan.deletes.sort(), ['A1', 'C1']);
    assert.deepEqual(plan.blocked, ['B1.1']);
  });

  // ── Validity date order ──────────────────────────────────────────────

  await test('Validity date order — an unset issuedAt or expiresAt is always valid (neutral)', () => {
    assert.equal(isValidDateOrder(undefined, undefined), true);
    assert.equal(isValidDateOrder('2024-01-01', undefined), true);
    assert.equal(isValidDateOrder(undefined, '2024-01-01'), true);
  });

  await test('Validity date order — expiresAt after issuedAt is valid', () => {
    assert.equal(isValidDateOrder('2024-01-01', '2025-01-01'), true);
  });

  await test('Validity date order — expiresAt equal to issuedAt is invalid', () => {
    assert.equal(isValidDateOrder('2024-01-01', '2024-01-01'), false);
  });

  await test('Validity date order — expiresAt before issuedAt is invalid', () => {
    assert.equal(isValidDateOrder('2025-01-01', '2024-01-01'), false);
  });

  // ── Offer relation state machine ──────────────────────────────────────
  // Governs offer_requests (direct offers) AND offer_applications (both
  // tables share the same offer_request_status enum and the same DB
  // trigger, handle_offer_relation_status_transition/
  // assert_offer_relation_transition). Zero coverage before this pass,
  // despite backing every accept/reject/withdraw/reapply decision in both
  // flows — added here rather than only exercised manually in the app.

  await test('isActiveOfferRelationStatus — pending and accepted are active, everything terminal is not', () => {
    assert.equal(isActiveOfferRelationStatus('pending'), true);
    assert.equal(isActiveOfferRelationStatus('accepted'), true);
    assert.equal(isActiveOfferRelationStatus('rejected'), false);
    assert.equal(isActiveOfferRelationStatus('expired'), false);
    assert.equal(isActiveOfferRelationStatus('withdrawn'), false);
  });

  await test('assertOfferRelationTransition — same-status no-op never throws', () => {
    assert.doesNotThrow(() => assertOfferRelationTransition('pending', 'pending', 'application'));
    assert.doesNotThrow(() => assertOfferRelationTransition('accepted', 'accepted', 'application'));
  });

  await test('assertOfferRelationTransition — pending can move to any terminal or accepted state', () => {
    assert.doesNotThrow(() => assertOfferRelationTransition('pending', 'accepted', 'application'));
    assert.doesNotThrow(() => assertOfferRelationTransition('pending', 'rejected', 'application'));
    assert.doesNotThrow(() => assertOfferRelationTransition('pending', 'expired', 'application'));
    assert.doesNotThrow(() => assertOfferRelationTransition('pending', 'withdrawn', 'application'));
  });

  await test('assertOfferRelationTransition — terminal statuses never transition anywhere else (one-shot by design)', () => {
    assert.throws(() => assertOfferRelationTransition('accepted', 'rejected', 'application'));
    assert.throws(() => assertOfferRelationTransition('rejected', 'pending', 'application'));
    assert.throws(() => assertOfferRelationTransition('expired', 'accepted', 'application'));
  });

  await test('assertOfferRelationTransition — withdrawn -> pending SI se permite: retirarse no veta (2026-07-28)', () => {
    // Retirarse (el tecnico se echa atras) y ser rechazado (la empresa dice
    // no) son cosas distintas. Que la primera vetara de por vida era un
    // efecto colateral de H6, no una decision.
    assert.doesNotThrow(() => assertOfferRelationTransition('withdrawn', 'pending', 'application'));
  });

  await test('assertOfferRelationTransition — withdrawn NO puede saltar directamente a accepted ni a otro terminal', () => {
    // Reactivar devuelve la fila a 'pending' y desde ahi el flujo normal
    // decide. Nunca un atajo a aceptada.
    assert.throws(() => assertOfferRelationTransition('withdrawn', 'accepted', 'application'));
    assert.throws(() => assertOfferRelationTransition('withdrawn', 'rejected', 'application'));
    assert.throws(() => assertOfferRelationTransition('withdrawn', 'expired', 'application'));
  });

  await test('assertOfferRelationTransition — withdrawn->pending es SOLO para aplicaciones, nunca para ofertas directas', () => {
    // offer_applications tiene UNIQUE TOTAL (technician_id, offer_id): reactivar
    // es la unica via de volver a aplicar. offer_requests tiene un unico PARCIAL
    // sobre estados activos, asi que la empresa crea una fila nueva — reactivar
    // ahi seria maquinaria inalcanzable y chocaria con ese indice.
    assert.doesNotThrow(() => assertOfferRelationTransition('withdrawn', 'pending', 'application'));
    assert.throws(
      () => assertOfferRelationTransition('withdrawn', 'pending', 'direct_offer'),
      /send a new one instead/,
      'una oferta directa retirada NO se reactiva',
    );
  });

  await test('evaluateApplicationConflict — una aplicacion retirada NO bloquea: permite reactivar', () => {
    assert.equal(evaluateApplicationConflict(null, { status: 'withdrawn' }), null);
  });

  await test('evaluateApplicationConflict — rejected SIGUE bloqueando (asimetria deliberada)', () => {
    const msg = evaluateApplicationConflict(null, { status: 'rejected' });
    assert.ok(msg && msg.includes('decided'), `rejected debe bloquear con mensaje propio, got ${msg}`);
    assert.ok(evaluateApplicationConflict(null, { status: 'expired' }), 'expired tambien bloquea');
  });

  await test('evaluateApplicationConflict — una oferta directa activa bloquea la reactivacion de una retirada', () => {
    // El orden de las comprobaciones importa: si la empresa mando una oferta
    // directa DESPUES de la retirada, volver a aplicar sigue bloqueado.
    const msg = evaluateApplicationConflict({ status: 'pending' }, { status: 'withdrawn' });
    assert.ok(msg && msg.includes('direct offer'), `la oferta directa activa debe ganar, got ${msg}`);
  });

  await test('shouldUnlockAcceptedRelation — true only for accepted', () => {
    assert.equal(shouldUnlockAcceptedRelation('accepted'), true);
    assert.equal(shouldUnlockAcceptedRelation('pending'), false);
    assert.equal(shouldUnlockAcceptedRelation('rejected'), false);
    assert.equal(shouldUnlockAcceptedRelation('withdrawn'), false);
    assert.equal(shouldUnlockAcceptedRelation('expired'), false);
  });

  await test('getStatusActivityType — direct offer and application accept/reject map to distinct activity types; other statuses are silent', () => {
    assert.equal(getStatusActivityType('direct_offer', 'accepted'), 'direct_offer_accepted');
    assert.equal(getStatusActivityType('direct_offer', 'rejected'), 'direct_offer_rejected');
    assert.equal(getStatusActivityType('direct_offer', 'pending'), null);
    assert.equal(getStatusActivityType('application', 'accepted'), 'application_accepted');
    assert.equal(getStatusActivityType('application', 'rejected'), 'application_rejected');
    assert.equal(getStatusActivityType('application', 'withdrawn'), null);
  });

  // ── Direct offer creation guard (offerRequestRepository.create) ───────

  await test('evaluateDirectOfferConflict — nothing existing, nothing blocks', () => {
    assert.equal(evaluateDirectOfferConflict([], [], 'offer-1'), null);
  });

  await test('evaluateDirectOfferConflict — an active request for the same offer blocks', () => {
    const result = evaluateDirectOfferConflict(
      [{ status: 'pending', offerId: 'offer-1' }],
      [],
      'offer-1',
    );
    assert.equal(result, 'An active direct offer already exists for this technician.');
  });

  await test('evaluateDirectOfferConflict — an active request for a DIFFERENT offer never cross-blocks', () => {
    const result = evaluateDirectOfferConflict(
      [{ status: 'pending', offerId: 'offer-other' }],
      [],
      'offer-1',
    );
    assert.equal(result, null);
  });

  await test('evaluateDirectOfferConflict — a terminal (withdrawn) request for the same offer never blocks a resend', () => {
    const result = evaluateDirectOfferConflict(
      [{ status: 'withdrawn', offerId: 'offer-1' }],
      [],
      'offer-1',
    );
    assert.equal(result, null);
  });

  await test('evaluateDirectOfferConflict — an active application for the same offer blocks (only checked when offerId is set)', () => {
    const result = evaluateDirectOfferConflict([], [{ status: 'pending' }], 'offer-1');
    assert.equal(result, 'This technician already has an active application for this offer.');
  });

  await test('evaluateDirectOfferConflict — open-ended direct offer (no offerId) only conflicts with another open-ended active request', () => {
    assert.equal(
      evaluateDirectOfferConflict([{ status: 'pending', offerId: undefined }], [], undefined),
      'An active direct offer already exists for this technician.',
    );
    assert.equal(
      evaluateDirectOfferConflict([{ status: 'pending', offerId: 'offer-1' }], [], undefined),
      null,
    );
  });

  // ── Application creation guard (offerApplicationRepository.create) ────
  // Regression coverage for a real gap found while auditing this flow: the
  // repository checked for a conflicting direct offer before inserting,
  // but never checked its OWN table — offer_applications has
  // UNIQUE(technician_id, offer_id), so a second attempt (including a
  // reapply after withdrawal/rejection, which the state machine above
  // never allows) fell through to a raw Postgres unique-violation error
  // instead of a friendly message. evaluateApplicationConflict backs the
  // fix.

  await test('evaluateApplicationConflict — nothing existing, nothing blocks', () => {
    assert.equal(evaluateApplicationConflict(undefined, null), null);
  });

  await test('evaluateApplicationConflict — an active direct offer for this role blocks, before even checking applications', () => {
    const result = evaluateApplicationConflict({ status: 'pending' }, null);
    assert.equal(result, 'You already have a direct offer for this role. Review it from Direct Offers.');
  });

  await test('evaluateApplicationConflict — a terminal direct offer never blocks applying', () => {
    const result = evaluateApplicationConflict({ status: 'rejected' }, null);
    assert.equal(result, null);
  });

  await test('evaluateApplicationConflict — a pending or accepted application of your own blocks as "active"', () => {
    assert.equal(
      evaluateApplicationConflict(undefined, { status: 'pending' }),
      'You already have an active application for this offer.',
    );
    assert.equal(
      evaluateApplicationConflict(undefined, { status: 'accepted' }),
      'You already have an active application for this offer.',
    );
  });

  await test('evaluateApplicationConflict — rejected bloquea reapply; withdrawn ya NO (cambio 2026-07-28)', () => {
    // Este test afirmaba que withdrawn Y rejected bloqueaban por igual. Era
    // el efecto colateral de H6 que se corrigio: retirarse no veta.
    const withdrawn = evaluateApplicationConflict(undefined, { status: 'withdrawn' });
    const rejected = evaluateApplicationConflict(undefined, { status: 'rejected' });
    assert.equal(withdrawn, null, 'una retirada permite volver a aplicar (reactiva la fila)');
    assert.equal(rejected, 'You already applied to this offer previously — re-applying is not available once an application has been decided.');
  });

  // ── Fase 4 scaffolding: canHold() / HabilitationScope ─────────────────
  // NOT wired to any form, matching path, or UI — see
  // docs/MISSION_PART66.md. Tests only, so the three dimensions (aircraft
  // class, propulsion, EASA group) are locked in before anything ever
  // consumes this.

  await test('getCompatiblePropulsion — turbine categories', () => {
    assert.equal(getCompatiblePropulsion('A1'), 'turbine');
    assert.equal(getCompatiblePropulsion('A3'), 'turbine');
    assert.equal(getCompatiblePropulsion('B1.1'), 'turbine');
    assert.equal(getCompatiblePropulsion('B1.3'), 'turbine');
  });

  await test('getCompatiblePropulsion — piston categories, including B3 (not covered by the class-only Fase 3b mapping)', () => {
    assert.equal(getCompatiblePropulsion('A2'), 'piston');
    assert.equal(getCompatiblePropulsion('A4'), 'piston');
    assert.equal(getCompatiblePropulsion('B1.2'), 'piston');
    assert.equal(getCompatiblePropulsion('B1.4'), 'piston');
    assert.equal(getCompatiblePropulsion('B3'), 'piston');
  });

  await test('getCompatiblePropulsion — B2/B2L/L/C have no propulsion restriction', () => {
    assert.equal(getCompatiblePropulsion('B2'), undefined);
    assert.equal(getCompatiblePropulsion('B2L'), undefined);
    assert.equal(getCompatiblePropulsion('L'), undefined);
    assert.equal(getCompatiblePropulsion('C'), undefined);
  });

  await test('canHold — exact_rating: matching class and propulsion holds', () => {
    const scope: HabilitationScope = {
      kind: 'exact_rating',
      aircraftTypeRatingId: 'fx-a320-cfm56',
      aircraftClass: 'Aeroplane',
      propulsion: 'turbine',
    };
    assert.equal(canHold('B1.1', scope), true);
  });

  await test('canHold — aircraft class mismatch fails regardless of propulsion', () => {
    const scope: HabilitationScope = {
      kind: 'exact_rating',
      aircraftTypeRatingId: 'fx-aw139',
      aircraftClass: 'Helicopter',
      propulsion: 'turbine',
    };
    assert.equal(canHold('B1.1', scope), false); // B1.1 is Aeroplane-only
  });

  await test('canHold — an unknown (undefined) scope class is never guessed as a match when the license is class-restricted', () => {
    const scope: HabilitationScope = { kind: 'exact_rating', aircraftTypeRatingId: 'fx-unknown', propulsion: 'turbine' };
    assert.equal(canHold('B1.1', scope), false);
  });

  await test('canHold — propulsion mismatch fails even when class matches', () => {
    const scope: HabilitationScope = {
      kind: 'exact_rating',
      aircraftTypeRatingId: 'fx-a320-v2500',
      aircraftClass: 'Aeroplane',
      propulsion: 'piston',
    };
    assert.equal(canHold('B1.1', scope), false); // B1.1 is turbine-only
  });

  await test('canHold — an unknown (undefined) scope propulsion is never guessed as a match when the license is propulsion-restricted', () => {
    const scope: HabilitationScope = { kind: 'exact_rating', aircraftTypeRatingId: 'fx-unknown', aircraftClass: 'Aeroplane' };
    assert.equal(canHold('B1.1', scope), false);
  });

  await test('canHold — B3 requires BOTH Aeroplane class and piston propulsion (not just class, unlike the Fase 3b mapping alone)', () => {
    const matching: HabilitationScope = {
      kind: 'exact_rating', aircraftTypeRatingId: 'fx-c172', aircraftClass: 'Aeroplane', propulsion: 'piston',
    };
    const wrongPropulsion: HabilitationScope = {
      kind: 'exact_rating', aircraftTypeRatingId: 'fx-tbm', aircraftClass: 'Aeroplane', propulsion: 'turbine',
    };
    assert.equal(canHold('B3', matching), true);
    assert.equal(canHold('B3', wrongPropulsion), false);
  });

  await test('canHold — B2/B2L/C hold any class and any propulsion, never pre-filtered', () => {
    const helicopterPiston: HabilitationScope = {
      kind: 'exact_rating', aircraftTypeRatingId: 'fx-r44', aircraftClass: 'Helicopter', propulsion: 'piston',
    };
    const aeroplaneTurbine: HabilitationScope = {
      kind: 'exact_rating', aircraftTypeRatingId: 'fx-a320', aircraftClass: 'Aeroplane', propulsion: 'turbine',
    };
    const unknownBoth: HabilitationScope = { kind: 'exact_rating', aircraftTypeRatingId: 'fx-unknown' };
    for (const license of ['B2', 'B2L', 'C'] as const) {
      assert.equal(canHold(license, helicopterPiston), true, `${license} + helicopter/piston`);
      assert.equal(canHold(license, aeroplaneTurbine), true, `${license} + aeroplane/turbine`);
      assert.equal(canHold(license, unknownBoth), true, `${license} + unknown/unknown`);
    }
  });

  // La L salió de ese grupo el 2026-08-14: es airship-only, no "cubre todo".
  // canHold() reusa la tabla del lado técnico, así que dice lo mismo que el
  // pre-filtro del selector de habilitaciones — que era el motivo de reusarla.
  // Sigue sin restricción de propulsión (la categoría no está acotada por ella).
  await test('canHold — L holds airships only, never aeroplanes or helicopters', () => {
    const airshipPiston: HabilitationScope = {
      kind: 'exact_rating', aircraftTypeRatingId: 'fx-lz-n07', aircraftClass: 'Gas Airship', propulsion: 'piston',
    };
    const airshipTurbine: HabilitationScope = {
      kind: 'exact_rating', aircraftTypeRatingId: 'fx-skyship', aircraftClass: 'Gas Airship', propulsion: 'turbine',
    };
    const aeroplaneTurbine: HabilitationScope = {
      kind: 'exact_rating', aircraftTypeRatingId: 'fx-a320', aircraftClass: 'Aeroplane', propulsion: 'turbine',
    };
    const helicopterPiston: HabilitationScope = {
      kind: 'exact_rating', aircraftTypeRatingId: 'fx-r44', aircraftClass: 'Helicopter', propulsion: 'piston',
    };
    assert.equal(canHold('L', airshipPiston), true);
    assert.equal(canHold('L', airshipTurbine), true);
    assert.equal(canHold('L', aeroplaneTurbine), false);
    assert.equal(canHold('L', helicopterPiston), false);
  });

  await test('canHold — L never guesses a class it cannot confirm (unpopulated scope)', () => {
    // Misma regla "never guess" que las demás categorías con producto propio:
    // una scope sin aircraftClass no se asume compatible. Para B2/B2L/C sí lo
    // era, porque allí la licencia no impone nada sobre esa dimensión.
    const unknownBoth: HabilitationScope = { kind: 'exact_rating', aircraftTypeRatingId: 'fx-unknown' };
    assert.equal(canHold('L', unknownBoth), false);
  });

  await test('canHold — exact_rating always demonstrates its own qualification, regardless of EASA group (never consults ALLOWED_KINDS_BY_GROUP)', () => {
    const scope: HabilitationScope = {
      kind: 'exact_rating', aircraftTypeRatingId: 'fx-a320-cfm56', aircraftClass: 'Aeroplane', propulsion: 'turbine',
    };
    assert.equal(canHold('B1.1', scope), true);
  });

  await test('canHold — Group 1: only exact_rating is a valid substitute, no subgroup/full-group scope ever qualifies', () => {
    const base = { aircraftClass: 'Aeroplane' as const, propulsion: 'turbine' as const, easaGroup: '1' as const };
    assert.equal(canHold('B1.1', { kind: 'manufacturer_subgroup', manufacturer: 'Airbus', ...base }), false);
    assert.equal(canHold('B1.1', { kind: 'full_subgroup', ...base }), false);
    assert.equal(canHold('B1.1', { kind: 'full_group', ...base }), false);
  });

  await test('canHold — Groups 2a/2b/2c: manufacturer_subgroup and full_subgroup both qualify', () => {
    const propsAndClass = { aircraftClass: 'Aeroplane' as const, propulsion: 'turbine' as const };
    for (const easaGroup of ['2a', '2b', '2c'] as const) {
      assert.equal(canHold('B1.1', { kind: 'manufacturer_subgroup', manufacturer: 'Airbus', easaGroup, ...propsAndClass }), true, `manufacturer_subgroup/${easaGroup}`);
      assert.equal(canHold('B1.1', { kind: 'full_subgroup', easaGroup, ...propsAndClass }), true, `full_subgroup/${easaGroup}`);
      // full_group is NOT a valid substitute for a 2x subgroup per the mission brief
      assert.equal(canHold('B1.1', { kind: 'full_group', easaGroup, ...propsAndClass }), false, `full_group/${easaGroup} should not qualify`);
    }
  });

  await test('canHold — Group 3: full_group qualifies, subgroup-level scopes do not (the brief pairs group 3 with "full group", not "subgroup")', () => {
    const base = { aircraftClass: 'Aeroplane' as const, propulsion: 'piston' as const, easaGroup: '3' as const };
    assert.equal(canHold('B1.2', { kind: 'full_group', ...base }), true);
    assert.equal(canHold('B1.2', { kind: 'manufacturer_subgroup', manufacturer: 'Cessna', ...base }), false);
    assert.equal(canHold('B1.2', { kind: 'full_subgroup', ...base }), false);
  });

  await test('canHold — group validity is checked independently of class/propulsion: a valid group scope with the wrong class still fails', () => {
    const scope: HabilitationScope = {
      kind: 'full_group', easaGroup: '3', aircraftClass: 'Helicopter', propulsion: 'piston',
    };
    assert.equal(canHold('B1.2', scope), false); // B1.2 is Aeroplane-only — group being valid doesn't rescue a class mismatch
  });

  // ── Contract fit (antes "Availability") — B3, 2026-07-29 ──────────────
  await test('Contract fit — contract_types VACIO significa "abierto a cualquiera" y puntua COMPLETO', () => {
    const offer = makeOffer({ contractType: 'permanent' });
    const technician = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: [] },
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    const weights = getMatchScoreWeights(offer);
    assert.equal(result.breakdown.contractFit, weights.contractFit,
      'no declarar tipos de contrato es un campo OPCIONAL vacio: nunca debe penalizar');
  });

  await test('Contract fit — declarar tipos y que NINGUNO coincida es el unico caso que puntua cero', () => {
    const offer = makeOffer({ contractType: 'permanent' });
    const technician = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['short_term'] },
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.breakdown.contractFit, 0);
  });

  await test('Contract fit — declarar un tipo que SI coincide puntua completo', () => {
    const offer = makeOffer({ contractType: 'permanent' });
    const technician = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['short_term', 'permanent'] },
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);
    assert.equal(result.breakdown.contractFit, getMatchScoreWeights(offer).contractFit);
  });

  await test('Contract fit — la DISPONIBILIDAD no puntua: immediately no mueve el score', () => {
    const offer = makeOffer({ contractType: 'permanent' });
    const base = { verificationStatus: 'verified' as const, licenses: [], habilitations: [] };
    const abierto = makeTechnician({ ...base, availability: { immediately: true, contractTypes: ['permanent'] } });
    const cerrado = makeTechnician({ ...base, availability: { immediately: false, contractTypes: ['permanent'] } });
    const a = calculateOfferTechnicianMatch(offer, abierto, RATING_INDEX);
    const b = calculateOfferTechnicianMatch(offer, cerrado, RATING_INDEX);
    assert.equal(a.total, b.total,
      'la disponibilidad es filtro y etiqueta, nunca puntos: un estado binario no debe mover un ranking');
  });

  await test('Contract fit — Option A es NEUTRAL en bandas: no declarar puntua igual que declarar y coincidir', () => {
    // El invariante que importa, afirmado sin depender de que el catalogo de
    // localizaciones resuelva estas fixtures: la regla del conjunto vacio no
    // puede mover ninguna banda documentada, porque todas se midieron con
    // "perfil perfecto" — que ya incluia esta fila al maximo. Lo unico que
    // cambia es quien ANTES sacaba cero por no rellenar un campo opcional.
    const offer = makeOffer({
      contractType: 'permanent',
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const base = {
      verificationStatus: 'verified' as const,
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    };
    const sinDeclarar = calculateOfferTechnicianMatch(
      offer, makeTechnician({ ...base, availability: { immediately: true, contractTypes: [] } }), RATING_INDEX);
    const declarado = calculateOfferTechnicianMatch(
      offer, makeTechnician({ ...base, availability: { immediately: true, contractTypes: ['permanent'] } }), RATING_INDEX);
    assert.equal(sinDeclarar.total, declarado.total, 'la banda superior no debe depender de un campo opcional');
    assert.equal(sinDeclarar.label, declarado.label);
    assert.equal(sinDeclarar.label, 'Excellent match');
  });

  // ── Profile-type soft cap + hard blockers ────────────────────────────
  // A type mismatch is deliberately not a blocker: it ranks very low while
  // remaining selectable. Declared experience below the minimum remains a
  // real blocker. Both rules live in the pure scorer in both directions.

  const EXACT_A320 = {
    licenses: [makeLicense('B1.1')],
    habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-a320-cfm56' })],
  };

  await test('Tipo de perfil — si coincide, se confirma sin sumar puntos ni bloquear', () => {
    const offer = makeOffer({
      technicianType: 'mechanic',
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const technician = makeTechnician({ technicianTypes: ['mechanic'], ...EXACT_A320 });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);

    assert.deepEqual(result.blockers, [], 'un tipo coincidente nunca bloquea');
    assert.ok(
      result.matches.includes('Technician type: Mechanic'),
      'el tipo confirmado se explica con la etiqueta del catálogo',
    );
  });

  await test('Tipo de perfil — Mechanic frente a Sheet Metal Worker sigue siendo elegible pero nunca supera 19%', () => {
    const offer = makeOffer({
      technicianType: 'sheet_metal_worker',
      requiresCertification: false,
      licenseCode: undefined,
      requiredHabilitations: [],
      locationCountryCode: 'US',
    });
    const mechanic = makeTechnician({
      technicianTypes: ['mechanic'],
      verificationStatus: 'verified',
      locationCountryCode: 'ES',
      availability: { immediately: true, contractTypes: ['permanent'] },
    });

    const result = calculateOfferTechnicianMatch(offer, mechanic, RATING_INDEX);

    assert.equal(result.breakdown.verified, 30);
    assert.equal(result.breakdown.contractFit, 30);
    assert.equal(result.breakdown.location, 0);
    assert.equal(
      Object.values(result.breakdown).reduce((sum, value) => sum + value, 0),
      60,
      'reproduce exactamente el 60% de la captura: verificado + contrato',
    );
    assert.deepEqual(result.blockers, [], 'un tipo distinto no impide seleccionar ni solicitar la oferta');
    assert.equal(result.profileTypeMismatch, true, 'el desajuste conserva una señal estructurada propia');
    assert.ok(
      result.clarifications.some((text) => text.includes('Sheet Metal Worker') && text.includes('Mechanic')),
      `la explicación debe nombrar ambos tipos, recibido: ${result.clarifications.join(' | ')}`,
    );
    assert.equal(result.total, 19, 'el techo blando debe impedir un match plausible para otro oficio');
    assert.equal(result.label, 'Weak match');
  });

  await test('Tipo de perfil — todo par tiene coincidencia o explicación de desajuste, nunca silencio', () => {
    const technician = makeTechnician({ technicianTypes: ['mechanic'] });
    const met = calculateOfferTechnicianMatch(makeOffer({ technicianType: 'mechanic' }), technician, RATING_INDEX);
    const unmet = calculateOfferTechnicianMatch(makeOffer({ technicianType: 'avionic' }), technician, RATING_INDEX);

    assert.deepEqual(met.blockers, []);
    assert.equal(met.profileTypeMismatch, false);
    assert.ok(met.matches.some((match) => match.startsWith('Technician type:')));
    assert.deepEqual(unmet.blockers, [], 'Mechanic frente a Avionics sigue siendo seleccionable');
    assert.equal(unmet.profileTypeMismatch, true);
    assert.ok(unmet.clarifications.some((text) => text.startsWith('Profile type differs')));
    assert.ok(!unmet.matches.some((match) => match.startsWith('Technician type:')));
  });

  // ── Fase 6 tanda E: el interruptor elige la FUENTE DE EVIDENCIA ───────
  //
  // El test que había aquí (tanda C) fijaba que el booleano NO movía el score.
  // Eso era cierto hasta la E y deja de serlo aquí, a propósito: conectar el
  // interruptor al scorer es la tanda entera.
  await test('Certificación — solo experiencia y cero licencias: con certificación cae al cap de 39', () => {
    // Criterio de verificación de la tanda. La experiencia declarada NO
    // rescata a quien no puede firmar, por mucha que sea.
    const offer = makeOffer({
      contractType: 'permanent',
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const soloExperiencia = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
      licenses: [],
      habilitations: [],
      aircraftExperience: [makeAircraftExperience('fx-a320-cfm56', 15)],
    });

    const result = calculateOfferTechnicianMatch(offer, soloExperiencia, RATING_INDEX);
    assert.equal(result.breakdown.habilitation, 0, 'la experiencia no puntúa cuando hay que certificar');
    assert.ok(result.total <= 39, `esperaba ZERO_QUALIFICATION_CAP, got ${result.total}`);
  });

  await test('Certificación — el MISMO técnico puntúa por su experiencia si la oferta no exige certificar', () => {
    const offer = makeOffer({
      contractType: 'permanent',
      requiresCertification: false,
      licenseCode: undefined,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const soloExperiencia = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
      licenses: [],
      habilitations: [],
      aircraftExperience: [makeAircraftExperience('fx-a320-cfm56', 15)],
    });

    const result = calculateOfferTechnicianMatch(offer, soloExperiencia, RATING_INDEX);
    assert.equal(result.level, 'exact');
    assert.equal(result.breakdown.habilitation, 65, 'los 20 de licencia van íntegros a habilitación');
    assert.equal(result.breakdown.license, 0, 'no hay licencia que puntuar');
    // 95 y no 100 porque los fixtures de oferta y técnico están en ciudades
    // distintas, así que el componente de ubicación (5) no puntúa. Lo que
    // importa es que NADA se recorta: el total es la suma cruda.
    const suma = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    assert.equal(result.total, suma, 'ningún cap se aplica');
    assert.equal(result.total, 95);
  });

  await test('Certificación — la licencia cuenta como experiencia, nunca al revés', () => {
    // Un B1.1 con rating de A320 y CERO experiencia declarada puntúa completo
    // en una oferta de ayudante en A320: la habilitación ya demuestra que ha
    // estado en ese avión. Al revés no — lo fija el test de más arriba.
    const ayudante = makeOffer({
      contractType: 'permanent',
      requiresCertification: false,
      licenseCode: undefined,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const conLicenciaSinExperienciaDeclarada = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
      ...EXACT_A320,
      aircraftExperience: [],
    });

    const result = calculateOfferTechnicianMatch(ayudante, conLicenciaSinExperienciaDeclarada, RATING_INDEX);
    assert.equal(result.level, 'exact');
    assert.equal(result.breakdown.habilitation, 65);
  });

  await test('Años — con habilitación Y experiencia sobre el mismo rating, manda la habilitación', () => {
    // La ambigüedad que la tanda B dejó abierta. Gana la fuente COMPROBABLE:
    // la habilitación está ligada a una licencia, tiene vigencia y se
    // verifica; la experiencia es autodeclarada.
    //
    // El editor de perfil ya no deja crear este estado (no ofrece aeronaves
    // donde el técnico tiene habilitación), así que esto sólo aplica a datos
    // anteriores — pero el scorer no puede depender de que la UI lo evite.
    const ayudante = makeOffer({
      requiresCertification: false,
      licenseCode: undefined,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const ambosDatos = makeTechnician({
      ...EXACT_A320, // habilitación B1.1 sobre fx-a320-cfm56, sin años
      aircraftExperience: [makeAircraftExperience('fx-a320-cfm56', 30)],
    });

    const result = calculateOfferTechnicianMatch(ayudante, ambosDatos, RATING_INDEX);
    assert.equal(result.level, 'exact');
    assert.ok(
      result.matches.some((m) => m.includes('Worked on') && !m.includes('30 years')),
      'la línea sale de la habilitación, no de los 30 años autodeclarados',
    );
  });

  await test('Sobrecualificado no penaliza — un B1.1 en una oferta de ayudante puntúa completo', () => {
    const ayudante = makeOffer({
      contractType: 'permanent',
      requiresCertification: false,
      licenseCode: undefined,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const sobrecualificado = makeTechnician({
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
      ...EXACT_A320,
      aircraftExperience: [makeAircraftExperience('fx-a320-cfm56', 20)],
    });
    const result = calculateOfferTechnicianMatch(ayudante, sobrecualificado, RATING_INDEX);
    const suma = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    assert.equal(result.total, suma, 'tener de más nunca resta: eso lo valora la empresa, no el algoritmo');
    assert.equal(result.total, 95, 'mismo 95 que sin sobrecualificación: la experiencia extra no suma ni resta');
  });

  // ── Fase 9: la escalera de exigencia es MONÓTONA ──────────────────────
  //
  // El hallazgo que abrió la fase: mismo técnico, mismo puesto, cuatro
  // versiones de la oferta de más exigente a menos, medidas 100 / 68 / 100 /
  // 75. Cumplir el 100% de lo que una oferta pedía puntuaba por DEBAJO de una
  // oferta que no pedía nada, y las dos salen seguidas en la lista del técnico
  // con su porcentaje al lado.
  //
  // El técnico "perfecto" de esta sección lo es en los cinco ejes a la vez
  // (verificado, licencia + rating, contrato, mismo país, tipo de perfil): sin
  // eso, un 100 no puede salir de ninguna rama y la escalera no se puede medir.
  const PERFECTO_A320: Partial<TechnicianWithRelations> = {
    verificationStatus: 'verified',
    availability: { immediately: true, contractTypes: ['permanent'] },
    locationCountryCode: 'XX', // el mismo país que makeOffer(), que por defecto no coincide
    ...EXACT_A320,
  };

  await test('Fase 9 — la escalera de exigencia es monótona: 100 / 100 / 100 / 75', () => {
    const tecnico = makeTechnician(PERFECTO_A320);
    const escalera = [
      { pide: 'licencia + aeronave', offer: makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] }), esperado: 100 },
      { pide: 'sólo licencia', offer: makeOffer(), esperado: 100 },
      {
        pide: 'sólo aeronave',
        offer: makeOffer({ requiresCertification: false, licenseCode: undefined, requiredHabilitations: [makeHabReq('fx-a320-cfm56')] }),
        esperado: 100,
      },
      { pide: 'nada', offer: makeOffer({ requiresCertification: false, licenseCode: undefined }), esperado: 75 },
    ];

    const totales = escalera.map(({ offer }) => calculateOfferTechnicianMatch(offer, tecnico, RATING_INDEX).total);
    assert.deepEqual(totales, escalera.map((e) => e.esperado), `escalera medida: ${totales.join(' / ')}`);

    // Y la PROPIEDAD, no sólo los cuatro números: bajar la exigencia nunca
    // sube el porcentaje, y la única bajada está en el último escalón.
    for (let i = 1; i < totales.length; i += 1) {
      assert.ok(totales[i] <= totales[i - 1], `la escalera sube en el escalón ${i}: ${totales.join(' / ')}`);
    }
    assert.equal(new Set(totales.slice(0, 3)).size, 1, 'las tres ramas que piden algo topan igual');
  });

  await test('Fase 9 — candidato perfecto en oferta de sólo licencia: 100, y el bloque entero lo paga la licencia', () => {
    const result = calculateOfferTechnicianMatch(makeOffer(), makeTechnician(PERFECTO_A320), RATING_INDEX);
    assert.equal(result.breakdown.license, 65, 'los 45 de habilitación van ÍNTEGROS a licencia');
    assert.equal(result.breakdown.habilitation, 0, 'la oferta no nombró aeronave: no hay eje de aeronave que puntuar');
    const suma = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    assert.equal(result.total, suma, 'ningún cap se aplica');
    assert.equal(result.total, 100);
    assert.equal(result.label, 'Excellent match');
  });

  await test('Fase 9 — el mismo candidato en otro país: 95, y la diferencia es EXACTAMENTE la ubicación', () => {
    const offer = makeOffer();
    const dentro = calculateOfferTechnicianMatch(offer, makeTechnician(PERFECTO_A320), RATING_INDEX);
    const fuera = calculateOfferTechnicianMatch(
      offer, makeTechnician({ ...PERFECTO_A320, locationCountryCode: 'ZZ' }), RATING_INDEX,
    );
    assert.equal(fuera.total, 95);
    assert.equal(dentro.total - fuera.total, getMatchScoreWeights(offer).location, 'nada más del scorer se movió');
  });

  await test('Fase 9 — quien NO tiene la licencia pedida sigue en 35, con su missingRequirements intacto', () => {
    // El otro extremo de la misma rama: subirle el techo al que cumple no
    // puede subirle ni un punto al que no cumple. 15 verificado + 15 contrato
    // + 5 país, con los dos topes (39 y 59) por encima sin llegar a morder.
    const offer = makeOffer({ licenseCode: 'B1.1' });
    const sinLicencia = makeTechnician({ ...PERFECTO_A320, licenses: [makeLicense('B2')], habilitations: [] });

    const result = calculateOfferTechnicianMatch(offer, sinLicencia, RATING_INDEX);
    assert.equal(result.breakdown.license, 0);
    assert.equal(result.total, 35);
    assert.equal(result.label, 'Weak match');
    assert.deepEqual(result.missingRequirements, ['Required license: B1.1']);
  });

  await test('Fase 9 — LA TRAMPA: el tope de cero cualificación pregunta por el eje QUE LA OFERTA PIDE', () => {
    // Con LICENSE_ONLY_WEIGHTS el peso de habilitación es 0, así que un
    // `habilitation === 0` pelado se cumpliría SIEMPRE en esta rama y el tope
    // de 39 caería sobre todo el mundo, candidato perfecto incluido: 100 → 39,
    // peor que el 68 que la fase venía a arreglar. Este test existe para que
    // nadie vuelva a escribirlo así.
    const soloLicencia = calculateOfferTechnicianMatch(makeOffer(), makeTechnician(PERFECTO_A320), RATING_INDEX);
    assert.equal(soloLicencia.breakdown.habilitation, 0, 'la premisa de la trampa: la fila vale 0');
    assert.equal(soloLicencia.total, 100, 'y aun así no se topa en 39: el eje que la oferta pidió está cumplido');

    // Y la regla que el tope EXISTE para defender, intacta: en una oferta que
    // sí nombra aeronave, tener la licencia sin el rating sigue topado en 39.
    const conAeronave = makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const licenciaSinRating = makeTechnician({
      ...PERFECTO_A320,
      licenses: [makeLicense('B1.1')],
      habilitations: [makeHab('B1.1', { aircraftTypeRatingId: 'fx-b777-ge90' })], // otro fabricante: ni T1 ni T2
    });

    const result = calculateOfferTechnicianMatch(conAeronave, licenciaSinRating, RATING_INDEX);
    assert.equal(result.breakdown.habilitation, 0, 'no tiene el rating pedido ni uno de la misma familia');
    assert.equal(result.breakdown.license, 20, 'la licencia sí puntúa: la oferta la pidió');
    assert.ok(result.total <= 39, `esperaba ZERO_QUALIFICATION_CAP, got ${result.total}`);
  });

  await test('Fase 9 — las cuatro tablas de pesos: el bloque de cualificación vale siempre 65, y sólo la rama sin requisitos baja a 75', () => {
    const suma = (w: ReturnType<typeof getMatchScoreWeights>) =>
      w.verified + w.habilitation + w.license + w.contractFit + w.location;

    const licenciaYAeronave = getMatchScoreWeights(makeOffer({ requiredHabilitations: [makeHabReq('fx-a320-cfm56')] }));
    const soloLicencia = getMatchScoreWeights(makeOffer());
    const soloAeronave = getMatchScoreWeights(
      makeOffer({ requiresCertification: false, licenseCode: undefined, requiredHabilitations: [makeHabReq('fx-a320-cfm56')] }),
    );
    const nada = getMatchScoreWeights(makeOffer({ requiresCertification: false, licenseCode: undefined }));

    assert.equal(licenciaYAeronave.habilitation + licenciaYAeronave.license, 65, '45 + 20');
    assert.equal(soloLicencia.habilitation + soloLicencia.license, 65, '0 + 65');
    assert.equal(soloAeronave.habilitation + soloAeronave.license, 65, '65 + 0');
    assert.equal(nada.habilitation + nada.license, 0, 'sin requisitos no hay bloque de cualificación que repartir');

    assert.equal(suma(licenciaYAeronave), 100);
    assert.equal(suma(soloLicencia), 100);
    assert.equal(suma(soloAeronave), 100);
    assert.equal(suma(nada), 75, 'el único descenso legítimo de la escalera');

    // Estos ceros son los denominadores que pinta la UI (BreakdownRow /
    // BreakdownItem, `max={weights.habilitation}`): las cuatro pantallas
    // guardan `max > 0`, así que la fila sale "0/0" apagada — exactamente lo
    // que ya hacen hoy habilitación y licencia en las ofertas sin requisitos.
    assert.equal(soloLicencia.habilitation, 0);
    assert.equal(soloAeronave.license, 0);
  });

  // ── Fase 6 tanda D: "basta con una" vs "hacen falta todas" ────────────
  await test('requiresAllAircraft=false — cubrir UNA de tres puntúa completo y sin cap', () => {
    // Criterio de verificación de la tanda. Coincide EXACTAMENTE con lo que
    // hoy hacían tres filas `preferred`: bestTier manda, la habilitación
    // puntúa entera y no hay techo. Frente a tres filas `mandatory` esto SUBE
    // el resultado, y es deliberado — "tres obligatorias" nunca significó lo
    // que la empresa creía, porque el scorer ya se quedaba con la mejor.
    const offer = makeOffer({
      contractType: 'permanent',
      requiresAllAircraft: false,
      requiredHabilitations: [
        makeHabReq('fx-a320-cfm56'),
        makeHabReq('fx-b737-cfm56'),
        makeHabReq('fx-b787-genx'),
      ],
    });
    const technician = makeTechnician({ verificationStatus: 'verified', ...EXACT_A320 });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);

    assert.deepEqual(result.missingRequirements, [], 'sin exigir todas, lo no cubierto no es un incumplimiento');
    assert.equal(result.level, 'exact');
    assert.equal(result.breakdown.habilitation, 45, 'la habilitación puntúa entera: bestTier sigue mandando');
    assert.ok(result.total > 59, `sin cap: ${result.total} debería superar el techo que sí aplica con requiresAll`);
  });

  await test('requiresAllAircraft=true — la misma pareja cae al cap de 59', () => {
    // El mismo par que el test de arriba, cambiando SOLO el booleano. Es la
    // prueba de que requiresAllAircraft ocupa exactamente el sitio que dejó
    // `mandatory`: mismo valor de cap, misma posición en la escalera.
    const base = {
      contractType: 'permanent' as const,
      requiredHabilitations: [
        makeHabReq('fx-a320-cfm56'),
        makeHabReq('fx-b737-cfm56'),
        makeHabReq('fx-b787-genx'),
      ],
    };
    const technician = makeTechnician({ verificationStatus: 'verified', ...EXACT_A320 });

    const bastaUna = calculateOfferTechnicianMatch(makeOffer({ ...base, requiresAllAircraft: false }), technician, RATING_INDEX);
    const todas = calculateOfferTechnicianMatch(makeOffer({ ...base, requiresAllAircraft: true }), technician, RATING_INDEX);

    assert.equal(todas.missingRequirements.length, 2, 'las dos aeronaves no cubiertas se nombran');
    assert.ok(todas.total <= 59, `esperaba el cap de 59, got ${todas.total}`);
    assert.deepEqual(
      todas.breakdown,
      bastaUna.breakdown,
      'el DESGLOSE no cambia: el booleano pone un techo, no reparte puntos distintos',
    );
  });

  await test('Una licencia por oferta — cada aeronave se cruza con ELLA, sin ambigüedad', () => {
    // La invariante de misma fila sigue viva del lado del técnico: tener B2 en
    // el AW139 no satisface una oferta de B1.3 sobre el AW139. Lo que cambia
    // es que ya no hay DOS licencias en la oferta entre las que confundirse.
    const offer = makeOffer({
      licenseCode: 'B1.3',
      requiredHabilitations: [makeHabReq('fx-aw139-pt6')],
    });
    const otraLicencia = makeTechnician({
      verificationStatus: 'verified',
      licenses: [makeLicense('B2')],
      habilitations: [makeHab('B2', { aircraftTypeRatingId: 'fx-aw139-pt6' })],
    });
    const laDeLaOferta = makeTechnician({
      verificationStatus: 'verified',
      licenses: [makeLicense('B1.3')],
      habilitations: [makeHab('B1.3', { aircraftTypeRatingId: 'fx-aw139-pt6' })],
    });

    assert.notEqual(
      calculateOfferTechnicianMatch(offer, otraLicencia, RATING_INDEX).level,
      'exact',
      'la misma aeronave bajo otra licencia no cumple la oferta',
    );
    assert.equal(calculateOfferTechnicianMatch(offer, laDeLaOferta, RATING_INDEX).level, 'exact');
  });

  // ── Fase 6 tanda B: la experiencia declarada NO puntúa (todavía) ──────
  //
  // Criterio de verificación de la tanda, escrito como test: "al desplegar B,
  // ningún score debe moverse". Que el scorer la mire es la Tanda E, y
  // depende del interruptor de certificación que llega en la C.
  await test('Experiencia sin licencia — declararla no mueve NI UN PUNTO del score', () => {
    const offer = makeOffer({
      contractType: 'permanent',
      technicianType: 'mechanic',
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const base = { technicianTypes: ['mechanic' as const], verificationStatus: 'verified' as const, ...EXACT_A320 };

    const sinExperiencia = makeTechnician(base);
    const conExperiencia = makeTechnician({
      ...base,
      aircraftExperience: [
        makeAircraftExperience('fx-a320-cfm56', 15),
        makeAircraftExperience('fx-b737-cfm56', 8),
        makeAircraftExperience('fx-ec135-arrius'),
      ],
    });

    const a = calculateOfferTechnicianMatch(offer, sinExperiencia, RATING_INDEX);
    const b = calculateOfferTechnicianMatch(offer, conExperiencia, RATING_INDEX);

    assert.equal(a.total, b.total, 'el total no puede moverse');
    assert.deepEqual(a.breakdown, b.breakdown, 'ni un solo componente del desglose');
    assert.deepEqual(a.matches, b.matches, 'ni aparecer como línea de match');
    assert.deepEqual(a.blockers, b.blockers, 'ni como blocker');
    assert.equal(a.label, b.label);
  });

  await test('Experiencia sin licencia — un perfil SIN NINGUNA licencia sigue puntuando como hoy', () => {
    // El caso que motiva la tanda: 15 años de A320 y cero licencias. Puede
    // DECLARARLO (eso es lo nuevo), pero frente a una oferta que exige
    // certificar sigue cayendo en ZERO_QUALIFICATION_CAP exactamente igual
    // que antes de existir la tabla. Si este número se mueve, la tanda B ha
    // tocado el scorer sin querer.
    const offer = makeOffer({
      technicianType: 'mechanic',
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const sinNada = makeTechnician({ technicianTypes: ['mechanic'], verificationStatus: 'verified' });
    const soloExperiencia = makeTechnician({
      technicianTypes: ['mechanic'],
      verificationStatus: 'verified',
      aircraftExperience: [makeAircraftExperience('fx-a320-cfm56', 15)],
    });

    const a = calculateOfferTechnicianMatch(offer, sinNada, RATING_INDEX);
    const b = calculateOfferTechnicianMatch(offer, soloExperiencia, RATING_INDEX);
    assert.equal(a.total, b.total, 'declarar experiencia no rescata a quien no tiene la licencia');
    assert.ok(b.total <= 39, `ZERO_QUALIFICATION_CAP debe seguir aplicando, got ${b.total}`);
  });

  await test('Experiencia sin licencia — el modelo admite la regla de la Tanda E sin duplicar filas', () => {
    // NO se implementa aquí: sólo se comprueba que el modelo la PERMITE.
    // "Tener licencia en una aeronave cuenta también como experiencia en
    // ella, nunca al revés" se resuelve como unión de conjuntos sobre el
    // MISMO aircraft_type_rating_id, sin copiar ninguna fila a la otra tabla.
    const tecnico = makeTechnician({
      ...EXACT_A320, // habilitación B1.1 sobre fx-a320-cfm56
      aircraftExperience: [makeAircraftExperience('fx-b737-cfm56', 8)],
    });

    const union = new Set([
      ...tecnico.habilitations.map((h) => h.aircraftTypeRatingId),
      ...tecnico.aircraftExperience.map((e) => e.aircraftTypeRatingId),
    ]);
    assert.deepEqual([...union].sort(), ['fx-a320-cfm56', 'fx-b737-cfm56']);
    assert.equal(
      tecnico.aircraftExperience.length,
      1,
      'la habilitación NO se copia a la tabla de experiencia: la unión se calcula en lectura, no se persiste',
    );
  });

  // ── Fase 6 tanda A: varios tipos por técnico ──────────────────────────
  //
  await test('Tipos múltiples — basta con que uno de los tipos del técnico coincida con la oferta', () => {
    const technician = makeTechnician({ technicianTypes: ['avionic', 'mechanic'], ...EXACT_A320 });

    for (const technicianType of ['avionic', 'mechanic'] as const) {
      const result = calculateOfferTechnicianMatch(
        makeOffer({ technicianType, requiredHabilitations: [makeHabReq('fx-a320-cfm56')] }),
        technician,
        RATING_INDEX,
      );
      assert.deepEqual(result.blockers, [], `el perfil incluye ${technicianType} y debe ser elegible`);
    }

    const unrelated = calculateOfferTechnicianMatch(
      makeOffer({ technicianType: 'painter', requiredHabilitations: [makeHabReq('fx-a320-cfm56')] }),
      technician,
      RATING_INDEX,
    );
    assert.deepEqual(unrelated.blockers, [], 'un tipo ajeno sigue siendo seleccionable');
    assert.equal(unrelated.profileTypeMismatch, true, 'tener varios tipos no equivale a encajar con cualquier oferta');
    assert.ok(unrelated.total <= 19, `el desajuste debe quedar en la banda baja, recibido: ${unrelated.total}`);
  });

  await test('Tipos múltiples — el score de un perfil de UN SOLO tipo no cambia respecto a hoy', () => {
    // El criterio de verificación de la tanda, escrito como test: añadir un
    // segundo tipo IRRELEVANTE para la oferta no puede mover ni un punto.
    const base = {
      contractType: 'permanent' as const,
      technicianType: 'mechanic' as const,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    };
    const single = makeTechnician({ technicianTypes: ['mechanic'], verificationStatus: 'verified', ...EXACT_A320 });
    const withExtra = makeTechnician({
      technicianTypes: ['mechanic', 'painter'],
      verificationStatus: 'verified',
      ...EXACT_A320,
    });

    const a = calculateOfferTechnicianMatch(makeOffer(base), single, RATING_INDEX);
    const b = calculateOfferTechnicianMatch(makeOffer(base), withExtra, RATING_INDEX);
    assert.equal(a.total, b.total, 'un tipo extra irrelevante no puede mover el total');
    assert.deepEqual(a.breakdown, b.breakdown, 'ni el desglose');
    // La línea de match nombra SOLO lo que casa, no la lista entera.
    assert.deepEqual(a.matches, b.matches, 'la línea de match nombra sólo el tipo pedido, no los que sobran');
  });

  await test('Blockers — Case 4: fewer declared years than the offer minimum is a blocker (and exactly the minimum is not)', () => {
    const offer = makeOffer({ minYearsExperience: 5, requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });

    const below = calculateOfferTechnicianMatch(makeOffer({ ...offer }), makeTechnician({ yearsExperience: 2, ...EXACT_A320 }), RATING_INDEX);
    assert.equal(below.blockers.length, 1, 'a declared 2 against a required 5 must block');
    assert.ok(below.blockers[0].includes('5') && below.blockers[0].includes('2'), `blocker must state both numbers, got: ${below.blockers[0]}`);
    assert.ok(below.total <= 19, `BLOCKER_CAP must apply, got ${below.total}`);
    assert.equal(below.breakdown.habilitation, 45, 'experience still does not touch the breakdown — it blocks or it says nothing');

    const atMinimum = calculateOfferTechnicianMatch(offer, makeTechnician({ yearsExperience: 5, ...EXACT_A320 }), RATING_INDEX);
    assert.deepEqual(atMinimum.blockers, [], 'meeting the minimum exactly is meeting it — the comparison is strict "<"');
  });

  await test('Blockers — Case 5: NOT declaring years is never a blocker, however high the offer minimum (absent data never penalizes)', () => {
    const offer = makeOffer({ minYearsExperience: 5, requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    // yearsExperience left undefined — "not declared", deliberately distinct
    // from a declared 0. Same product rule the server-side prefilter encodes
    // as `years_experience.is.null OR >= N` (applyMinYearsFilter).
    const technician = makeTechnician({ verificationStatus: 'verified', ...EXACT_A320 });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);

    assert.deepEqual(result.blockers, [], 'an undeclared optional field must never disqualify');
    assert.equal(result.label, 'Excellent match', 'and it must not cap the score either');

    // A DECLARED 0 is a different fact and does block — the distinction is
    // the whole reason yearsExperience is nullable rather than defaulted.
    const declaredZero = calculateOfferTechnicianMatch(offer, makeTechnician({ yearsExperience: 0, ...EXACT_A320 }), RATING_INDEX);
    assert.equal(declaredZero.blockers.length, 1, 'a declared 0 is data, not absence of data');
  });

  await test('Blockers — Case 6: minYearsExperience = 0 means the offer sets no minimum, so nothing is evaluated', () => {
    const offer = makeOffer({ minYearsExperience: 0, requiredHabilitations: [makeHabReq('fx-a320-cfm56')] });
    const undeclared = calculateOfferTechnicianMatch(offer, makeTechnician({ ...EXACT_A320 }), RATING_INDEX);
    assert.deepEqual(undeclared.blockers, []);
    const declaredZero = calculateOfferTechnicianMatch(offer, makeTechnician({ yearsExperience: 0, ...EXACT_A320 }), RATING_INDEX);
    assert.deepEqual(declaredZero.blockers, [], 'no minimum to fall below — 0 < 0 is false');
  });

  await test('Blockers — Case 7: a blocker plus zero qualification lands on the tightest ceiling (19), not the qualification one (39)', () => {
    const offer = makeOffer({
      contractType: 'permanent',
      // Fase 6 tanda E: el blocker ya no puede ser el tipo de perfil. El
      // único que queda es el de años declarados por debajo del mínimo.
      minYearsExperience: 5,
      // `requiresAllAircraft` para que las DOS vías de cap se disparen a la
      // vez, que es lo que este test comprueba: la del blocker y la de la
      // aeronave no cumplida son independientes y gana la más restrictiva.
      requiresAllAircraft: true,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const technician = makeTechnician({
      yearsExperience: 2,
      verificationStatus: 'verified',
      availability: { immediately: true, contractTypes: ['permanent'] },
      licenses: [],
      habilitations: [],
    });
    const result = calculateOfferTechnicianMatch(offer, technician, RATING_INDEX);

    assert.equal(result.breakdown.habilitation, 0);
    assert.ok(result.blockers.length > 0);
    assert.ok(result.missingRequirements.length > 0, 'both mechanisms fire at once here — they are independent');
    // The raw sum is verified(15) + contractFit(15) = 30 at least, so
    // ZERO_QUALIFICATION_CAP (39) alone would not have reduced it at all.
    // Landing on 19 proves the blocker rung is what applied.
    assert.equal(result.total, 19, `expected BLOCKER_CAP to win over every qualification ceiling, got ${result.total}`);
    assert.equal(result.label, 'Weak match');
  });

  await test('Blockers — Case 8: the same pair evaluated in both directions yields identical blockers', () => {
    // Both matchingV2.ts wrappers (getTechnicianMatchesForOffer, company →
    // technicians; getOfferMatchesForTechnician, technician → offers) call
    // this same pure function — the wrappers are not imported here because
    // they pull in the Supabase repositories, which this standalone runner
    // deliberately has no connection for. The invariant under test is
    // exactly why both rules were implemented in the pure function instead
    // of in a wrapper: a rule added to one wrapper would apply to one
    // direction and to none of the ~12 direct call sites in app/.
    const offer = makeOffer({
      minYearsExperience: 5,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const technician = makeTechnician({ yearsExperience: 2, ...EXACT_A320 });

    // Company side: one offer scored against a list of technicians.
    const companyDirection = [technician].map((t) => calculateOfferTechnicianMatch(offer, t, RATING_INDEX))[0];
    // Technician side: one technician scored against a list of offers.
    const technicianDirection = [offer].map((o) => calculateOfferTechnicianMatch(o, technician, RATING_INDEX))[0];

    assert.deepEqual(companyDirection.blockers, technicianDirection.blockers);
    assert.equal(companyDirection.total, technicianDirection.total);
    // Fase 6 tanda E: queda UNA sola regla de blocker (los años declarados);
    // el tipo de perfil dejo de descalificar.
    assert.equal(companyDirection.blockers.length, 1);
  });

  await test('Blockers — order: a blocked pair sinks to the bottom of the existing total-descending sort, with no special-casing', () => {
    // Verifies the claim BLOCKER_CAP relies on (matchingV2.ts sorts by
    // `b.score.total - a.score.total` and was deliberately NOT changed): at
    // 19, a blocked pair ranks below every unblocked one — including a
    // technician with zero qualification, whose own ceiling is 39.
    const offer = makeOffer({
      contractType: 'permanent',
      minYearsExperience: 5,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const blockedButPerfectlyQualified = makeTechnician({
      id: 'tech-blocked',
      yearsExperience: 2, // por debajo del minimo de la oferta
      verificationStatus: 'verified',
      ...EXACT_A320,
    });
    const eligibleButUnqualified = makeTechnician({
      id: 'tech-unqualified',
      verificationStatus: 'verified',
      licenses: [],
      habilitations: [],
    });

    const ranked = [blockedButPerfectlyQualified, eligibleButUnqualified]
      .map((t) => calculateOfferTechnicianMatch(offer, t, RATING_INDEX))
      .sort((a, b) => b.total - a.total); // the exact sort matchingV2.ts uses

    assert.equal(ranked[ranked.length - 1].technicianId, 'tech-blocked', 'the blocked pair must rank last on score alone');
    assert.ok(
      ranked[0].total > ranked[1].total,
      `an eligible-but-unqualified technician (${ranked[0].total}) must outrank a blocked one (${ranked[1].total})`,
    );
  });

  // ── Licensed vs non-licensed profiles ────────────────────────────────
  // EASA Part-66 licences and type ratings only exist for the types that
  // certify work. `requiresLicense` in the technician type catalog is the
  // single switch; these tests pin what reads it.

  await test('Licensed types — requiresLicense drives the split, per catalog row', () => {
    assert.equal(isLicensedTechnicianType('mechanic'), true);
    assert.equal(isLicensedTechnicianType('avionic'), true);
    assert.equal(isLicensedTechnicianType('pilot'), true, 'inactive in the pickers, but still a licensed type');
    assert.equal(isLicensedTechnicianType('sheet_metal_worker'), false);
    assert.equal(isLicensedTechnicianType('painter'), false);
    assert.equal(isLicensedTechnicianType('composite'), false);
  });

  await test('Licensed types — an unknown code is treated as licensed, never as a reason to hide a qualification section', () => {
    assert.equal(isLicensedTechnicianType('not_in_the_catalog'), true);
  });

  // Fase 6 tanda C: `offerTargetsLicensedProfiles` se quedó SIN NINGÚN
  // CONSUMIDOR — la pregunta que respondía la contesta ahora
  // `offers.requires_certification`. La función (y con ella
  // isLicensedTechnicianType y TechnicianTypeCatalog.requiresLicense) no se
  // borra aquí: queda anotada para el barrido de exports muertos. Estos dos
  // tests se conservan hasta entonces para que quien haga el barrido vea qué
  // hacía exactamente antes de retirarla.
  await test('Licensed types [SIN CONSUMIDORES] — an offer with no declared type does not restrict the Part-66 axis', () => {
    assert.equal(offerTargetsLicensedProfiles({ requiredTechnicianTypes: [] }), true);
  });

  await test('Licensed types [SIN CONSUMIDORES] — an offer for non-licensed trades has no Part-66 axis; one licensed type is enough to keep it', () => {
    assert.equal(offerTargetsLicensedProfiles({ requiredTechnicianTypes: ['painter', 'composite'] }), false);
    assert.equal(offerTargetsLicensedProfiles({ requiredTechnicianTypes: ['mechanic'] }), true);
    assert.equal(
      offerTargetsLicensedProfiles({ requiredTechnicianTypes: ['painter', 'mechanic'] }),
      true,
      'a mixed row (only possible from data predating the rule) must keep its requirements visible, not hide them',
    );
  });

  // Los cinco tests de `planOfferTechnicianTypeToggle` vivían aquí. Se van con
  // el módulo (Fase 6 tanda C): impedían mezclar tipos licenciados y no
  // licenciados en una oferta, y con UN SOLO tipo por oferta no queda nada que
  // planificar — la mezcla es inexpresable, no ilegal.

  await test('Copy — una oferta que no exige certificar lee "General compatibility", nunca una etiqueta técnica', () => {
    // Fase 6 tanda C: lo decide el INTERRUPTOR, no el tipo de perfil. Antes un
    // "painter" salía en esta rama por ser un oficio sin licencia; ahora sale
    // porque la oferta declara que no hace falta certificar — que es lo que la
    // fase entera persigue.
    // Fase 9: `licenseCode: undefined` va declarado aquí, no heredado. Sin él
    // la oferta salía con la licencia por defecto puesta y `requiresCertification`
    // en false — una fila que la 053 prohíbe, y que el scorer mandaba a
    // NO_CERTIFICATION_WEIGHTS (escala 100) porque elige rama por si HAY
    // licencia. El test decía "no exige certificar" y medía la rama de las que
    // sí piden algo.
    const offer = makeOffer({ technicianType: 'painter', requiresCertification: false, licenseCode: undefined });
    const score = calculateOfferTechnicianMatch(
      offer,
      makeTechnician({ technicianTypes: ['painter'], verificationStatus: 'verified' }),
      RATING_INDEX,
    );
    assert.equal(
      getMatchDisplayLabel(offer, score),
      GENERAL_COMPATIBILITY_LABEL,
      'nothing about the technician\'s qualification was confirmed, because there was nothing to confirm',
    );
    // The scoring itself is untouched — la oferta cae en NO_REQUIREMENTS_WEIGHTS
    // (verificado 30 / contrato 30 / ubicación 15, sin bloque de cualificación),
    // que es lo que hace de esto un cambio de copy y nada más.
    assert.equal(score.breakdown.habilitation, 0);
    assert.equal(score.breakdown.license, 0);
    assert.ok(score.total <= 75, `the no-requirements ceiling still applies, got ${score.total}`);
  });

  await test('Copy — a licensed offer keeps its real band label', () => {
    const offer = makeOffer({
      technicianType: 'mechanic',
      requiredHabilitations: [makeHabReq('fx-a320-cfm56')],
    });
    const score = calculateOfferTechnicianMatch(
      offer,
      makeTechnician({ technicianTypes: ['mechanic'], verificationStatus: 'verified', ...EXACT_A320 }),
      RATING_INDEX,
    );
    assert.equal(getMatchDisplayLabel(offer, score), score.label);
    assert.equal(score.label, 'Excellent match');
    // An offer that names no type at all is unchanged too.
    assert.equal(getMatchDisplayLabel(makeOffer({}), score), score.label);
  });

  // ── Years of experience: required at signup, never erasable ──────────

  await test('Years — signup with no years declared is rejected client-side', () => {
    assert.ok(validateSignupYearsExperience(''), 'an empty field must be rejected');
    assert.ok(validateSignupYearsExperience('   '), 'whitespace is still empty');
    assert.equal(parseYearsExperience(''), null, 'and it never parses into a number');
  });

  await test('Years — signup with 0 years is ACCEPTED: 0 is a declaration, not a blank', () => {
    assert.equal(validateSignupYearsExperience('0'), null);
    assert.equal(parseYearsExperience('0'), 0, 'must be the number 0, never null — null would mean "not declared"');
  });

  await test('Years — saving the profile with the years field emptied is rejected', () => {
    assert.ok(validateProfileYearsExperience(''), 'a technician must not be able to erase it back to "not declared"');
    assert.equal(validateProfileYearsExperience('0'), null, 'but 0 is still a valid answer here too');
    assert.equal(validateProfileYearsExperience('8'), null);
  });

  await test('Years — the accepted range matches chk_technician_years_experience_range (0..70)', () => {
    assert.equal(parseYearsExperience('70'), 70);
    assert.equal(parseYearsExperience('71'), null);
    assert.equal(parseYearsExperience('99'), null);
    assert.equal(parseYearsExperience('-1'), null);
    assert.equal(parseYearsExperience('8 years'), null, 'a typo is not a declaration');
    assert.equal(parseYearsExperience('4.5'), null, 'the column is an integer');
    assert.equal(parseYearsExperience('  5  '), 5, 'surrounding whitespace is tolerated');
  });

  // ── La licencia decide el oficio (2026-08-13) ─────────────────────────
  //
  // AQUÍ VIVÍAN LOS CINCO TESTS DE `findOrphanedLicenses`, que comprobaban a
  // qué licencias dejaba huérfanas quitar un tipo de perfil. Se van con la
  // función: ya no puede darse el caso que la motivaba. Un tipo implicado por
  // una licencia declarada no se puede desmarcar, así que ninguna licencia
  // puede quedar sin su tipo, y quitar la licencia se lleva el tipo sin
  // preguntar nada.
  //
  // Lo que aquellos tests protegían —que la `C` no tiene rama y que A1–A4,
  // B3 y L sí— lo protegen ahora los dos primeros de aquí abajo, sobre la
  // función que heredó el mapa.

  await test('Implicados — B1.x/A/B3/L implican mecánico y B2/B2L aviónico', () => {
    assert.deepEqual(typesImpliedByLicenses(['B1.1']), ['mechanic']);
    assert.deepEqual(typesImpliedByLicenses(['B2']), ['avionic']);
    assert.deepEqual(typesImpliedByLicenses(['B2L']), ['avionic']);
    // A1–A4 van con su B1 correspondiente, B3 es mecánico de pistón, y L
    // (light aircraft) es trabajo de célula y motor.
    for (const code of ['A1', 'A2', 'A3', 'A4', 'B1.2', 'B1.3', 'B1.4', 'B3', 'L']) {
      assert.deepEqual(typesImpliedByLicenses([code]), ['mechanic'], `${code} es rama mecánica`);
    }
    // Las dos ramas a la vez son un estado perfectamente válido.
    assert.deepEqual(typesImpliedByLicenses(['B1.1', 'B2']), ['mechanic', 'avionic']);
  });

  await test('Implicados — la C NO implica oficio, y sin licencias no se implica nada', () => {
    // C es supervisión de mantenimiento base: la sostienen tanto perfiles B1
    // como B2, así que de ella no se puede deducir el oficio. Si alguien se
    // la asigna a una rama "para completar el mapa", este test se cae — que
    // es el punto.
    assert.deepEqual(typesImpliedByLicenses(['C']), []);
    assert.deepEqual(typesImpliedByLicenses([]), []);
    // Y no estorba a las que sí implican.
    assert.deepEqual(typesImpliedByLicenses(['C', 'B2']), ['avionic']);
  });

  await test('Implicados — el orden no depende del orden de las licencias recibidas', () => {
    // El resultado se compara y se guarda: dos llamadas con las mismas
    // licencias en distinto orden tienen que coincidir exactamente.
    assert.deepEqual(typesImpliedByLicenses(['B2', 'B1.1']), typesImpliedByLicenses(['B1.1', 'B2']));
  });

  await test('Casilla implicada — añadir una licencia marca su tipo, y no toca los demás', () => {
    // Un pintor que declara una B1.1 pasa a ser pintor Y mecánico: el tipo
    // manual no se pierde, y el implicado se marca solo.
    assert.deepEqual(typesAfterLicenseChange(['painter'], [], ['B1.1']), ['painter', 'mechanic']);
    // Volver a marcar algo ya implicado no duplica nada.
    assert.deepEqual(typesAfterLicenseChange(['mechanic'], ['B1.1'], ['B1.1', 'B1.2']), ['mechanic']);
  });

  await test('Casilla implicada — quitar la ÚLTIMA licencia de una rama desmarca su tipo, y sólo el suyo', () => {
    // B1.1 + B2 -> se quita la B2: 'avionic' se va, 'mechanic' se queda
    // (sigue implicado por la B1.1) y el tipo manual no se toca. Los
    // implicados salen detrás de los manuales porque se reponen al final; el
    // orden no lo lee nadie (el selector pinta por catálogo y
    // replaceProfileTypes compara por pertenencia), pero se fija aquí para
    // que un cambio de orden sea una decisión y no un efecto colateral.
    assert.deepEqual(
      typesAfterLicenseChange(['mechanic', 'avionic', 'painter'], ['B1.1', 'B2'], ['B1.1']),
      ['painter', 'mechanic'],
    );
    // Pero mientras quede otra licencia de la MISMA rama, el tipo no se cae.
    assert.deepEqual(
      typesAfterLicenseChange(['mechanic'], ['B1.1', 'B1.2'], ['B1.2']),
      ['mechanic'],
    );
  });

  await test('Casilla implicada — quitar la última licencia a secas puede dejar la lista vacía, y eso lo corta el mínimo de uno', () => {
    // Estado de FORMULARIO válido y momentáneo: quien impide guardarlo es la
    // pantalla y replaceProfileTypes, no esta función.
    assert.deepEqual(typesAfterLicenseChange(['mechanic'], ['B1.1'], []), []);
    // Con un tipo manual detrás no llega a darse.
    assert.deepEqual(typesAfterLicenseChange(['mechanic', 'composite'], ['B1.1'], []), ['composite']);
  });

  await test('Casilla implicada — la C no marca ni desmarca nada', () => {
    assert.deepEqual(typesAfterLicenseChange(['painter'], [], ['C']), ['painter']);
    assert.deepEqual(typesAfterLicenseChange(['mechanic'], ['B1.1', 'C'], ['B1.1']), ['mechanic']);
  });

  await test('Oferta — las licencias seleccionables son las de la rama del oficio MÁS la C', () => {
    // La C entra aquí y NO en el mapa de implicados, a propósito: no dice
    // oficio, pero un puesto de mantenimiento base lo puede ocupar tanto un
    // B1 como un B2, así que ofrecerla nunca contradice al tipo declarado.
    assert.deepEqual(licensesSelectableForOfferType('avionic'), ['B2', 'B2L', 'C']);
    assert.deepEqual(licensesSelectableForOfferType('mechanic'), [
      'A1', 'A2', 'A3', 'A4', 'B1.1', 'B1.2', 'B1.3', 'B1.4', 'B3', 'L', 'C',
    ]);
    // El caso vivo que motivó la tanda: una oferta de aviónico pedía B1.2.
    assert.ok(!licensesSelectableForOfferType('avionic').includes('B1.2'));
    assert.ok(!licensesSelectableForOfferType('mechanic').includes('B2'));
  });

  await test('Oferta — los oficios sin licencia no pueden pedir ninguna', () => {
    for (const code of ['sheet_metal_worker', 'painter', 'composite']) {
      assert.deepEqual(licensesSelectableForOfferType(code), [], `${code} no tiene eje Part-66`);
    }
  });

  await test('Oferta — un tipo licenciado SIN rama declarada no restringe, en vez de quedarse sin ninguna', () => {
    // `pilot` está en el catálogo como licenciado pero no tiene rama en
    // LICENSES_BY_TECHNICIAN_TYPE (está inactivo en los selectores). Devolver
    // [] dejaría un puesto licenciado sin ninguna licencia que pedir; la
    // dirección segura es no restringir, la misma que toma
    // isLicensedTechnicianType con un código desconocido.
    assert.deepEqual(licensesSelectableForOfferType('pilot'), LICENSE_CODES);
    assert.deepEqual(licensesSelectableForOfferType('not_in_the_catalog'), LICENSE_CODES);
  });

  // ── Localización por PAÍS (Fase 7 F2c) ───────────────────────────────────
  //
  // ⚠ ANTES DE F2c ESTE EJE NO TENÍA NI UN TEST. `makeOffer` y
  // `makeTechnician` usan localizaciones distintas, así que los puntos de
  // localización NUNCA se otorgaban en toda la suite. El cambio a país no
  // movió ningún test existente, y eso no era tranquilizador: significaba que
  // el componente podía haber estado roto —siempre 0, o siempre el máximo—
  // sin que 157 tests dijeran nada.
  //
  // La lección, para quien escriba fixtures aquí: los valores por defecto de
  // un fixture deciden qué ramas se ejercen. Si TODOS difieren en un eje, ese
  // eje sólo prueba su rama negativa. Al añadir un caso nuevo, haz que alguno
  // COINCIDA a propósito — es la única forma de que la rama positiva exista.

  await test('Localización — mismo país suma los puntos enteros', () => {
    const offer = makeOffer({ locationCountryCode: 'ES' });
    const fuera = calculateOfferTechnicianMatch(offer, makeTechnician({ locationCountryCode: 'FR' }), RATING_INDEX);
    const dentro = calculateOfferTechnicianMatch(offer, makeTechnician({ locationCountryCode: 'ES' }), RATING_INDEX);

    const peso = getMatchScoreWeights(offer).location;
    assert.equal(fuera.breakdown.location, 0);
    assert.equal(dentro.breakdown.location, peso);
  });

  await test('Localización — la CIUDAD no puntúa: Alicante y Bilbao empatan', () => {
    // La consecuencia asumida del criterio "sólo el país". Dos técnicos del
    // mismo país y distinta ciudad son indistinguibles para el scorer, vengan
    // sus ciudades del directorio o escritas a mano.
    const offer = makeOffer({ locationCountryCode: 'ES', locationCityName: 'Madrid' });

    const alicante = calculateOfferTechnicianMatch(
      offer,
      makeTechnician({ locationCountryCode: 'ES', locationCityName: 'Alicante', locationCityLat: 38.34, locationCityLng: -0.48 }),
      RATING_INDEX,
    );
    const bilbao = calculateOfferTechnicianMatch(
      offer,
      makeTechnician({ locationCountryCode: 'ES', locationCityName: 'Bilbao' }),
      RATING_INDEX,
    );

    assert.equal(alicante.breakdown.location, bilbao.breakdown.location);
    assert.equal(alicante.total, bilbao.total);
  });

  await test('Localización — otro país saca exactamente los puntos de localización menos', () => {
    const offer = makeOffer({ locationCountryCode: 'ES' });
    const dentro = calculateOfferTechnicianMatch(offer, makeTechnician({ locationCountryCode: 'ES' }), RATING_INDEX);
    const fuera = calculateOfferTechnicianMatch(offer, makeTechnician({ locationCountryCode: 'PT' }), RATING_INDEX);

    // La diferencia es EXACTAMENTE el peso de localización: nada más del
    // scorer puede haberse movido por cambiar de país.
    assert.equal(dentro.total - fuera.total, getMatchScoreWeights(offer).location);
  });

  // El test 'el aeropuerto ya no influye' vivía aquí y se retira en F2d: su
  // sujeto ya no existe. `locationCityId` salió de Offer y de
  // TechnicianWithRelations al quedarse sin lectores, así que el compilador
  // impide ahora lo que ese test comprobaba en ejecución — una garantía más
  // fuerte, no una menos.

  // ══════════════════════════════════════════════════════════════════════
  // FASE 10 — AUTORIDADES DE LICENCIA Y EJE DE MOTORES
  // Red escrita ANTES de tocar el scorer (2026-09-15); en verde desde el
  // paso 4 (2026-09-16).
  //
  // Los 185 tests de arriba usan sólo fixtures EASA y seguirían en verde con
  // cualquier implementación de las autoridades o de los motores. Ésta es la
  // sección que los cubre.
  //
  // Reglas de esta sección, para quien la toque:
  //
  //  1. Todo entra por import con nombre. `pendiente(módulo, 'nombre')` —el
  //     lector por string que permitía escribir la red antes que el código—
  //     se retiró al implementarse la fase: con las firmas reales, el
  //     compilador comprueba además CÓMO se llaman, no sólo que existan.
  //
  //  2. Ningún test puede estar en verde por casualidad. Varios pasarían con
  //     un scorer que ignorase la autoridad y los motores ("los años no mueven
  //     el score" es trivialmente cierto si el motor no puntúa). Esos llevan
  //     DELANTE una comparación de contraste. No la quites porque "sobra": es
  //     lo que impide que el test mienta.
  //
  //  3. Si un técnico tiene el mismo código en dos autoridades, sus
  //     habilitaciones van con makeHabOn(licencia). makeTechnician lanza si
  //     tiene que adivinar.
  // ══════════════════════════════════════════════════════════════════════

  const puntuar = (
    offer: OfferWithRequirements,
    technician: TechnicianWithRelations,
    opts: { ratingIndex?: AircraftRatingIndex; engineIndex?: EngineIndex; now?: Date } = {},
  ): MatchScore =>
    calculateOfferTechnicianMatch(
      offer,
      technician,
      opts.ratingIndex ?? RATING_INDEX_MOTORES,
      opts.now ?? NOW,
      opts.engineIndex ?? ENGINE_INDEX,
    );

  // El filtro de elegibilidad con los mismos catálogos que `puntuar`. Desde el
  // paso 5b los necesita: la vía (b) resuelve el motor de un type rating y su
  // familia.
  const elegible = (
    offer: OfferWithRequirements,
    technician: TechnicianWithRelations,
    opts: { ratingIndex?: AircraftRatingIndex; engineIndex?: EngineIndex } = {},
  ): boolean =>
    isTechnicianEligibleForOffer(offer, technician, opts.ratingIndex ?? RATING_INDEX_MOTORES, opts.engineIndex ?? ENGINE_INDEX);

  // Todo a favor salvo la cualificación: verificado, contrato y mismo país que
  // makeOffer(). Sin esto un 100 no sale de ninguna rama.
  const PERFIL_A_FAVOR: TechnicianOverrides = {
    verificationStatus: 'verified',
    availability: { immediately: true, contractTypes: ['permanent'] },
    locationCountryCode: 'XX',
  };
  const PERFIL_MOTOR: TechnicianOverrides = { ...PERFIL_A_FAVOR, technicianTypes: ['engine_technician'] };
  const PART66_AUTHORITIES = ['EASA', 'UK_CAA', 'CASA', 'GCAA'] as const;
  // Sesión 2: lo que era la casilla marcada en una oferta EASA B1.1 — todas las
  // otras Part-66 que emiten B1.1. Es exactamente lo que la 088 escribe al
  // migrar una oferta con accepts_equivalent = true.
  const EQUIVALENTES_EASA_B11: AuthorityCode[] = ['UK_CAA', 'CASA', 'GCAA'];
  const sumaPesos = (w: ReturnType<typeof getMatchScoreWeights>) => Object.values(w).reduce((a, b) => a + b, 0);
  const sumaDesglose = (s: MatchScore) => Object.values(s.breakdown).reduce((a, b) => a + b, 0);

  // Técnico con UNA licencia y el A320 colgando de ella.
  const conA320Bajo = (authority: AuthorityCode, extra: Partial<TechnicianLicense> = {}, id?: string) => {
    const lic = makeLicense('B1.1', { authority, ...extra });
    return makeTechnician({
      ...PERFIL_A_FAVOR,
      ...(id ? { id } : {}),
      licenses: [lic],
      habilitations: [makeHabOn(lic, { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
  };
  const ofertaA320 = (licenseAuthority: AuthorityCode, extra: OfferOverrides = {}) =>
    makeOffer({ licenseAuthority, requiredHabilitations: [makeHabReq('fx-a320-cfm56')], ...extra });

  // ── Identidad de licencia ─────────────────────────────────────────────

  await test('H2 — una equivalente con fecha más lejana no desplaza la exacta vigente', () => {
    const easa = makeLicense('B1.1', { authority: 'EASA', expiresAt: '2028-01-01' });
    const uk = makeLicense('B1.1', { authority: 'UK_CAA', expiresAt: '2030-01-01' });
    const oferta = makeOffer({ licenseAuthority: 'EASA', acceptedAuthorities: EQUIVALENTES_EASA_B11 });
    const before = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [easa] });
    assert.equal(puntuar(oferta, before).total, 100);
    assert.equal(puntuar(oferta, { ...before, licenses: [easa, uk] }).total, 100);
  });

  await test('H2 — el rating caducado de otra credencial no baja 100 a 39', () => {
    const easa = makeLicense('B1.1', { authority: 'EASA', expiresAt: '2028-01-01' });
    const uk = makeLicense('B1.1', { authority: 'UK_CAA', expiresAt: '2030-01-01' });
    const oferta = ofertaA320('EASA', { acceptedAuthorities: EQUIVALENTES_EASA_B11 });
    const before = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [easa], habilitations: [makeHabOn(easa, { aircraftTypeRatingId: 'fx-a320-cfm56' })] });
    assert.equal(puntuar(oferta, before).total, 100);
    assert.equal(puntuar(oferta, { ...before, licenses: [easa, uk], habilitations: [...before.habilitations,
      makeHabOn(uk, { aircraftTypeRatingId: 'fx-a320-cfm56', expiresAt: '2020-01-01' })] }).total, 100);
  });

  await test('H2 — propiedad: añadir una credencial no reduce la puntuación de una oferta con licencia', () => {
    const candidates: { license: TechnicianLicense; habs: TechnicianHabilitation[] }[] = [];
    for (const authority of ['EASA', 'UK_CAA'] as const) for (const expired of [false, true])
      for (const state of ['current', 'expired', 'not_current']) for (const subset of [0, 1, 2, 3]) {
        const license = makeLicense('B1.1', { id: `property-${candidates.length}`, authority,
          expiresAt: expired ? '2020-01-01' : authority === 'EASA' ? '2028-01-01' : '2030-01-01' });
        const habs = ['fx-a320-cfm56', 'fx-b777-ge90'].flatMap((id, i) => (subset & (1 << i)) ? [makeHabOn(license, {
          aircraftTypeRatingId: id, expiresAt: state === 'expired' ? '2020-01-01' : undefined, isCurrent: state !== 'not_current',
        })] : []);
        candidates.push({ license, habs });
      }
    let checked = 0;
    for (const requiresAllAircraft of [false, true]) for (const count of [0, 1, 2]) {
      const offer = makeOffer({ licenseAuthority: 'EASA', acceptedAuthorities: EQUIVALENTES_EASA_B11, requiresAllAircraft,
        requiredHabilitations: ['fx-a320-cfm56', 'fx-b777-ge90'].slice(0, count).map((id) => makeHabReq(id)) });
      for (const a of candidates) for (const b of candidates) {
        if (a.license.authority === b.license.authority) continue; // real unique authority/category pairs
        const before = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [a.license], habilitations: a.habs });
        const after = { ...before, licenses: [a.license, b.license], habilitations: [...a.habs, ...b.habs] };
        const oldScore = puntuar(offer, before).total;
        const newScore = puntuar(offer, after).total;
        assert.ok(newScore >= oldScore, `${a.license.id} + ${b.license.id}, all=${requiresAllAircraft}, aircraft=${count}: ${oldScore} -> ${newScore}`);
        assert.equal(puntuar(offer, { ...after, licenses: [...after.licenses].reverse() }).total, newScore);
        checked++;
      }
    }
    assert.ok(checked > 5000);
  });

  await test('Fase 10 · Identidad — dos B1.1 (EASA y UK CAA) no mezclan habilitaciones ni caducidades', () => {
    // Habilitaciones: el A320 cuelga de la UK. Una oferta EASA sin
    // equivalencias no puede verlo, aunque el código sea el mismo.
    const easa = makeLicense('B1.1', { id: 'lic-easa-b11', authority: 'EASA' });
    const uk = makeLicense('B1.1', { id: 'lic-uk-b11', authority: 'UK_CAA' });
    const tecnico = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [easa, uk],
      habilitations: [
        makeHabOn(easa, { aircraftTypeRatingId: 'fx-b777-ge90' }),
        makeHabOn(uk, { aircraftTypeRatingId: 'fx-a320-cfm56' }),
      ],
    });
    const enEasa = puntuar(ofertaA320('EASA'), tecnico);
    assert.notEqual(enEasa.level, 'exact', 'el A320 cuelga de la B1.1 UK CAA, no de la EASA que pide la oferta');
    assert.equal(enEasa.breakdown.habilitation, 0);
    assert.equal(puntuar(ofertaA320('UK_CAA'), tecnico).level, 'exact', 'la misma fila sí vale para su autoridad');

    // Caducidades: la UK caducada va PRIMERO en la lista, que es la que
    // encontraría una búsqueda por código. La EASA vigente no se entera.
    const ukCaducada = makeLicense('B1.1', { id: 'lic-uk-b11-cad', authority: 'UK_CAA', expiresAt: '2026-01-01' });
    const easaVigente = makeLicense('B1.1', { id: 'lic-easa-b11-vig', authority: 'EASA' });
    const tecnico2 = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [ukCaducada, easaVigente],
      habilitations: [
        makeHabOn(ukCaducada, { aircraftTypeRatingId: 'fx-a320-cfm56' }),
        makeHabOn(easaVigente, { aircraftTypeRatingId: 'fx-a320-cfm56' }),
      ],
    });
    const r = puntuar(ofertaA320('EASA'), tecnico2);
    assert.equal(r.level, 'exact', 'la caducidad de la UK CAA no toca a la EASA');
    assert.deepEqual(r.vigenciaNotices, [], 'ni aviso de vigencia: la licencia caducada no es la que pide la oferta');
    assert.equal(r.total, 100);
  });

  await test('Fase 10 · Identidad — borrar una licencia no afecta a la del mismo código en otra autoridad', () => {
    const planPorId = planLicenseRemovalById;
    const easa = makeLicense('B1.1', { id: 'lic-easa-b11', authority: 'EASA' });
    const uk = makeLicense('B1.1', { id: 'lic-uk-b11', authority: 'UK_CAA' });
    const habs = [makeHabOn(uk, { aircraftTypeRatingId: 'fx-a320-cfm56' })];

    assert.deepEqual(planPorId([easa.id], habs), { deletes: [easa.id], blocked: [] }, 'la EASA no tiene nada colgando: se borra');
    assert.deepEqual(planPorId([uk.id], habs), { deletes: [], blocked: [uk.id] }, 'la UK sí: se bloquea');

    // Por qué hace falta la versión por id: la de código no distingue las dos
    // y bloquea la EASA por una habilitación que es de la UK.
    assert.deepEqual(planLicenseRemoval(['B1.1'], habs.map((h) => h.licenseCode)), { deletes: [], blocked: ['B1.1'] });
  });

  await test('Fase 10 · Identidad — una EASA caducada no arrastra a una UK CAA vigente', () => {
    const easaCaducada = makeLicense('B1.1', { id: 'lic-easa-cad', authority: 'EASA', expiresAt: '2026-01-01' });
    const ukVigente = makeLicense('B1.1', { id: 'lic-uk-vig', authority: 'UK_CAA' });
    const habs = [
      makeHabOn(easaCaducada, { aircraftTypeRatingId: 'fx-a320-cfm56' }),
      makeHabOn(ukVigente, { aircraftTypeRatingId: 'fx-a320-cfm56' }),
    ];
    const oferta = ofertaA320('UK_CAA');

    // La caducada PRIMERO: es la que encontraría `licenses.find(código)`.
    const r = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [easaCaducada, ukVigente], habilitations: habs }));
    assert.equal(r.level, 'exact', 'la EASA caducada no puede tumbar la oferta UK CAA');
    assert.deepEqual(r.missingRequirements, []);
    assert.deepEqual(r.vigenciaNotices, []);
    assert.equal(r.total, 100);

    // Y no depende del orden en que lleguen las licencias.
    const alReves = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [ukVigente, easaCaducada], habilitations: [...habs].reverse() }));
    assert.equal(alReves.total, r.total);
  });

  await test('Fase 10 · Identidad — varias licencias dan UN solo resultado por oferta y no suman dos veces', () => {

    // Tres B1.1 con el A320 y la casilla de equivalencias marcada: las tres
    // son elegibles a la vez, que es el caso con más tentación de sumar.
    const licencias = PART66_AUTHORITIES.filter((a) => a !== 'GCAA').map((authority) => makeLicense('B1.1', { authority }));
    const tecnico = makeTechnician({
      ...PERFIL_A_FAVOR,
      id: 'tech-tres-licencias',
      licenses: licencias,
      habilitations: licencias.map((l) => makeHabOn(l, { aircraftTypeRatingId: 'fx-a320-cfm56' })),
    });
    const oferta = ofertaA320('EASA', { id: 'offer-a320-equiv', acceptedAuthorities: EQUIVALENTES_EASA_B11 });
    const pesos = getMatchScoreWeights(oferta);

    const porOferta = rankTechniciansForOffer(oferta, [tecnico], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW);
    assert.equal(porOferta.length, 1, 'un técnico, un resultado');
    const r = porOferta[0];
    assert.equal(r.breakdown.habilitation, pesos.habilitation, 'la habilitación no se cobra una vez por licencia');
    assert.equal(r.breakdown.license, pesos.license, 'ni la licencia');
    assert.equal(r.total, 100);
    assert.equal(new Set(r.matches).size, r.matches.length, 'ninguna línea de match repetida');

    // Una consulta que haga join con las licencias devuelve el técnico una vez
    // por fila. Eso no puede convertirse en tres resultados.
    assert.equal(rankTechniciansForOffer(oferta, [tecnico, tecnico, tecnico], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).length, 1);
    assert.equal(rankOffersForTechnician(tecnico, [oferta], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).length, 1);
  });

  await test('Fase 10 · Identidad — requiresAllAircraft no combina habilitaciones de dos licencias distintas', () => {
    // Con equivalencias marcadas, a propósito: es cuando la EASA (A320) y la
    // UK (B777) parecerían sumar juntas las dos aeronaves. Ninguna de las dos
    // licencias las tiene todas.
    const oferta = makeOffer({
      licenseAuthority: 'EASA',
      acceptedAuthorities: EQUIVALENTES_EASA_B11,
      requiresAllAircraft: true,
      requiredHabilitations: [makeHabReq('fx-a320-cfm56'), makeHabReq('fx-b777-ge90')],
    });
    const easa = makeLicense('B1.1', { authority: 'EASA' });
    const uk = makeLicense('B1.1', { authority: 'UK_CAA' });
    const repartido = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [easa, uk],
      habilitations: [
        makeHabOn(easa, { aircraftTypeRatingId: 'fx-a320-cfm56' }),
        makeHabOn(uk, { aircraftTypeRatingId: 'fx-b777-ge90' }),
      ],
    });
    const r = puntuar(oferta, repartido);
    assert.notEqual(r.level, 'exact', 'A320 bajo EASA + B777 bajo UK no es "tiene las dos"');
    assert.ok(r.missingRequirements.length > 0, 'la aeronave que falta en cada licencia se nombra');
    assert.ok(r.total <= 59, `esperaba INCOMPLETE_AIRCRAFT_SET_CAP, got ${r.total}`);

    // Control: las dos bajo la MISMA licencia sí cumplen.
    const juntas = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [easa],
      habilitations: [makeHabOn(easa, { aircraftTypeRatingId: 'fx-a320-cfm56' }), makeHabOn(easa, { aircraftTypeRatingId: 'fx-b777-ge90' })],
    });
    assert.equal(puntuar(oferta, juntas).level, 'exact');
  });

  // ── Equivalencias ─────────────────────────────────────────────────────

  await test('Fase 10 · Equivalencias — apagada: sólo cruza la autoridad exacta', () => {
    const oferta = ofertaA320('EASA', { acceptedAuthorities: [] });
    assert.equal(puntuar(oferta, conA320Bajo('EASA')).total, 100, 'control: la autoridad exacta cumple');

    for (const authority of ['UK_CAA', 'CASA', 'GCAA'] as const) {
      const r = puntuar(oferta, conA320Bajo(authority));
      assert.notEqual(r.level, 'exact', `${authority} B1.1 no cumple una oferta EASA sin equivalencias`);
      assert.equal(r.breakdown.habilitation, 0, authority);
      assert.equal(r.breakdown.license, 0, authority);
      assert.ok(r.total <= ZERO_QUALIFICATION_CAP, `${authority}: esperaba el tope de 39, got ${r.total}`);
    }
  });

  await test('Fase 10 · Equivalencias — encendida: cruza el mismo código en otras autoridades Part-66', () => {
    for (const authority of ['UK_CAA', 'CASA', 'GCAA'] as const) {
      const tecnico = conA320Bajo(authority);
      const apagada = puntuar(ofertaA320('EASA', { acceptedAuthorities: [] }), tecnico);
      const encendida = puntuar(ofertaA320('EASA', { acceptedAuthorities: EQUIVALENTES_EASA_B11 }), tecnico);
      // Contraste primero: hoy las dos puntúan igual porque la autoridad no
      // existe para el scorer.
      assert.ok(encendida.total > apagada.total, `${authority}: la casilla tiene que notarse (${encendida.total} vs ${apagada.total})`);
      assert.ok(encendida.total > ZERO_QUALIFICATION_CAP, `${authority}: el equivalente cuenta como cualificación, got ${encendida.total}`);
      assert.deepEqual(encendida.missingRequirements, [], authority);
    }

    // Ensancha la AUTORIDAD, no el código: una B2 UK con el A320 no cumple una
    // B1.1 EASA por tener la casilla marcada.
    const ukB2 = makeLicense('B2', { authority: 'UK_CAA' });
    const r = puntuar(
      ofertaA320('EASA', { acceptedAuthorities: EQUIVALENTES_EASA_B11 }),
      makeTechnician({ ...PERFIL_A_FAVOR, licenses: [ukB2], habilitations: [makeHabOn(ukB2, { aircraftTypeRatingId: 'fx-a320-cfm56' })] }),
    );
    assert.equal(r.breakdown.habilitation, 0);
    assert.equal(r.breakdown.license, 0);
  });

  await test('Fase 10 · Equivalencias — el exacto puntúa por encima del equivalente, a igualdad de todo lo demás', () => {
    const conCasilla = ofertaA320('EASA', { acceptedAuthorities: EQUIVALENTES_EASA_B11 });
    const exacto = puntuar(conCasilla, conA320Bajo('EASA'));
    const equivalente = puntuar(conCasilla, conA320Bajo('UK_CAA'));
    const noAceptado = puntuar(ofertaA320('EASA', { acceptedAuthorities: [] }), conA320Bajo('UK_CAA'));

    assert.ok(exacto.total > equivalente.total, `exacto (${exacto.total}) > equivalente (${equivalente.total})`);
    assert.ok(equivalente.total > noAceptado.total, `equivalente (${equivalente.total}) > no aceptado (${noAceptado.total})`);
    assert.equal(exacto.total, 100, 'marcar la casilla no le quita nada al exacto');
  });

  await test('Fase 10 · Equivalencias — una exacta caducada no bloquea una equivalente vigente', () => {
    const oferta = ofertaA320('EASA', { acceptedAuthorities: EQUIVALENTES_EASA_B11 });
    const easaCaducada = makeLicense('B1.1', { authority: 'EASA', expiresAt: '2026-01-01' });
    const ukVigente = makeLicense('B1.1', { authority: 'UK_CAA' });
    const mixto = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [easaCaducada, ukVigente],
      habilitations: [
        makeHabOn(easaCaducada, { aircraftTypeRatingId: 'fx-a320-cfm56' }),
        makeHabOn(ukVigente, { aircraftTypeRatingId: 'fx-a320-cfm56' }),
      ],
    });
    const soloUk = conA320Bajo('UK_CAA');

    const r = puntuar(oferta, mixto);
    const referencia = puntuar(oferta, soloUk);
    assert.ok(r.total > ZERO_QUALIFICATION_CAP, `la UK vigente tiene que valer, got ${r.total}`);
    assert.equal(r.total, referencia.total, 'puntúa exactamente como si sólo tuviera la UK vigente');
    assert.deepEqual(r.breakdown, referencia.breakdown);
    assert.ok(!r.missingRequirements.some((m) => m.includes('expired')), 'el requisito está cumplido: no se lista como caducado');
  });

  await test('Fase 10 · Equivalencias — FAA nunca cruza por equivalencia con ningún código Part-66', () => {
    assert.deepEqual(equivalentAuthorities('FAA'), [], 'FAA no tiene equivalentes');
    for (const authority of PART66_AUTHORITIES) {
      assert.ok(!equivalentAuthorities(authority).includes('FAA'), `${authority} no lista a FAA`);
      assert.ok(!equivalentAuthorities(authority).includes(authority), `${authority} no se lista a sí misma: son las OTRAS`);
    }
    assert.deepEqual([...equivalentAuthorities('EASA')].sort(), ['CASA', 'GCAA', 'UK_CAA']);

    // Y en el scorer, en las dos direcciones, con todas las aceptadas marcadas.
    const faaAyP = makeLicense('A&P', { authority: 'FAA' });
    const enPart66 = puntuar(makeOffer({ licenseAuthority: 'EASA', acceptedAuthorities: EQUIVALENTES_EASA_B11 }), makeTechnician({ ...PERFIL_A_FAVOR, licenses: [faaAyP] }));
    assert.equal(enPart66.breakdown.license, 0, 'un A&P no cumple una B1.1 EASA');

    // Sesión 2: una oferta FAA no puede aceptar a nadie (088), y aunque la
    // lista llegara al scorer, una A1 EASA no cumpliría una A FAA.
    assert.deepEqual(equivalentAuthoritiesForLicense('FAA', 'A'), [], 'ningún chip para una licencia FAA');
    assert.throws(() => makeOffer({ licenseCode: 'A', licenseAuthority: 'FAA', acceptedAuthorities: ['EASA'] }), /cannot be accepted as equivalent/);
    assert.equal(
      licenseSatisfiesRequirement({ authority: 'EASA', licenseCode: 'A1' }, { authority: 'FAA', licenseCode: 'A' }, ['EASA']),
      null,
      'una A1 EASA no cumple una A FAA',
    );
    assert.equal(
      licenseSatisfiesRequirement({ authority: 'FAA', licenseCode: 'A&P' }, { authority: 'EASA', licenseCode: 'B1.1' }, ['FAA']),
      null,
      'ni una lista con la FAA dentro la hace equivalente',
    );
  });

  // ── Sesión 2: equivalencias por autoridad ─────────────────────────────

  await test('Sesión 2 · Equivalencias — EASA que acepta UK CAA: 87 a un UK CAA, 35 a un GCAA; lista vacía sólo acepta EASA', () => {
    const aceptaUk = ofertaA320('EASA', { acceptedAuthorities: ['UK_CAA'] });
    assert.equal(puntuar(aceptaUk, conA320Bajo('EASA')).total, 100, 'la exacta sigue valiendo 100');
    assert.equal(puntuar(aceptaUk, conA320Bajo('UK_CAA')).total, 87, 'equivalente aceptada');
    assert.equal(puntuar(aceptaUk, conA320Bajo('GCAA')).total, 35, 'GCAA no está en la lista');
    assert.equal(puntuar(aceptaUk, conA320Bajo('CASA')).total, 35, 'CASA tampoco');

    // Lo mismo sin aeronaves (sólo licencia): 87 y 35.
    const soloLicencia = makeOffer({ licenseAuthority: 'EASA', acceptedAuthorities: ['UK_CAA'] });
    const conB11 = (authority: AuthorityCode) => makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('B1.1', { authority })] });
    assert.equal(puntuar(soloLicencia, conB11('UK_CAA')).total, 87);
    assert.equal(puntuar(soloLicencia, conB11('GCAA')).total, 35);

    const vacia = ofertaA320('EASA', { acceptedAuthorities: [] });
    assert.equal(puntuar(vacia, conA320Bajo('EASA')).total, 100);
    for (const authority of ['UK_CAA', 'CASA', 'GCAA'] as const) {
      assert.equal(puntuar(vacia, conA320Bajo(authority)).total, 35, `${authority} con la lista vacía`);
    }
  });

  await test('Sesión 2 · Equivalencias — los chips son las otras Part-66 que emiten la categoría, y la lista se limpia al cambiar la licencia', () => {
    assert.deepEqual(equivalentAuthoritiesForLicense('EASA', 'B1.1'), ['UK_CAA', 'CASA', 'GCAA']);
    assert.deepEqual(equivalentAuthoritiesForLicense('EASA', 'B2L'), ['UK_CAA'], 'CASA y GCAA no emiten B2L');
    assert.deepEqual(equivalentAuthoritiesForLicense('UK_CAA', 'B3'), ['EASA', 'GCAA'], 'CASA no emite B3');
    assert.deepEqual(equivalentAuthoritiesForLicense('FAA', 'A&P'), []);
    assert.deepEqual(equivalentAuthoritiesForLicense('EASA', undefined), []);

    // "Se limpian las que ya no apliquen": la nueva exigida sale, y la que no
    // emite el código nuevo también.
    assert.deepEqual(retainApplicableAuthorities(['UK_CAA', 'CASA'], 'UK_CAA', 'B1.1'), ['CASA']);
    assert.deepEqual(retainApplicableAuthorities(['UK_CAA', 'CASA'], 'EASA', 'B3'), ['UK_CAA']);
    assert.deepEqual(retainApplicableAuthorities(['UK_CAA'], 'FAA', 'A&P'), []);

    // El espejo de forma rechaza lo mismo que la 088.
    const forma = { offerKind: 'aircraft' as const, requiresCertification: true, licenseCode: 'B1.1' as const, licenseAuthority: 'EASA' as const,
      requiredEngineId: undefined, onlyUnlicensed: false, requiredHabilitations: [] as unknown[] };
    assert.deepEqual(offerShapeViolations({ ...forma, acceptedAuthorities: ['UK_CAA', 'CASA'] }), []);
    assert.ok(offerShapeViolations({ ...forma, acceptedAuthorities: ['EASA'] }).length > 0, 'la exigida no se acepta a sí misma');
    assert.ok(offerShapeViolations({ ...forma, acceptedAuthorities: ['FAA'] }).length > 0, 'la FAA nunca');
    assert.ok(offerShapeViolations({ ...forma, acceptedAuthorities: ['UK_CAA', 'UK_CAA'] }).length > 0, 'repetidas');
    assert.ok(offerShapeViolations({ ...forma, licenseCode: 'B2L', acceptedAuthorities: ['CASA'] }).length > 0, 'CASA no emite B2L');
  });

  // ── FAA ───────────────────────────────────────────────────────────────

  await test('H8 — B1.x cubre A.x solo bajo la misma autoridad y en la dirección correcta', () => {
    for (const authority of PART66_AUTHORITIES) for (const i of [1, 2, 3, 4] as const) {
      assert.equal(licenseCodeSatisfies(`B1.${i}`, `A${i}`), true);
      assert.equal(licenseCodeSatisfies(`A${i}`, `B1.${i}`), false);
      const offer = makeOffer({ licenseAuthority: authority, licenseCode: `A${i}` });
      const technician = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense(`B1.${i}`, { authority })] });
      assert.equal(puntuar(offer, technician).total, 100);
      for (const other of PART66_AUTHORITIES.filter((a) => a !== authority)) {
        assert.equal(licenseSatisfiesRequirement({ authority: other, licenseCode: `B1.${i}` }, { authority, licenseCode: `A${i}` }, [other]), null);
      }
      for (const j of [1, 2, 3, 4].filter((n) => n !== i)) assert.equal(licenseCodeSatisfies(`B1.${i}`, `A${j}`), false);
    }
  });

  await test('H8 — FAA A y P en filas separadas equivalen a A&P sin mezclar autoridades', () => {
    const a = makeLicense('A', { authority: 'FAA', expiresAt: '2020-01-01' });
    const p = makeLicense('P', { authority: 'FAA' });
    for (const code of ['A', 'P', 'A&P']) {
      const offer = makeOffer({ licenseAuthority: 'FAA', licenseCode: code });
      const separate = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [a, p] });
      assert.equal(puntuar(offer, separate).total, 100);
      assert.equal(puntuar(offer, { ...separate, licenses: [p, a] }).total, 100);
      assert.equal(separate.licenses.length, 2, 'normalizar para matching no muta el perfil');
    }
    const offer = makeOffer({ licenseAuthority: 'FAA', licenseCode: 'A&P' });
    assert.ok(puntuar(offer, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [a] })).total < 100);
    assert.ok(puntuar(offer, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [p] })).total < 100);
    assert.ok(puntuar(offer, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [a, { ...p, authority: 'EASA' }] })).total < 100);
  });

  await test('Fase 10 · FAA — A&P satisface una oferta que pide A, una que pide P y una que pide A&P', () => {
    const tecnico = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('A&P', { authority: 'FAA' })] });
    for (const code of ['A', 'P', 'A&P']) {
      const oferta = makeOffer({ licenseCode: code, licenseAuthority: 'FAA' });
      const r = puntuar(oferta, tecnico);
      assert.equal(r.breakdown.license, getMatchScoreWeights(oferta).license, `A&P frente a ${code}`);
      assert.deepEqual(r.missingRequirements, [], `A&P frente a ${code}`);
      assert.equal(r.total, 100, `A&P frente a ${code}`);
    }
  });

  await test('Fase 10 · FAA — un A no satisface una oferta que pide A&P', () => {
    // Precondición, y no adorno: sin el catálogo FAA la negativa de abajo pasa
    // por casualidad ('A' !== 'A&P' como texto) y el test no probaría nada.
    assert.equal(isValidAuthorityLicense('FAA', 'A'), true);
    assert.equal(isValidAuthorityLicense('FAA', 'A&P'), true);

    const r = puntuar(
      makeOffer({ licenseCode: 'A&P', licenseAuthority: 'FAA' }),
      makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('A', { authority: 'FAA' })] }),
    );
    assert.equal(r.breakdown.license, 0);
    assert.ok(r.missingRequirements.some((m) => m.includes('A&P')), `falta A&P, got ${JSON.stringify(r.missingRequirements)}`);
    assert.ok(r.total <= ZERO_QUALIFICATION_CAP, `got ${r.total}`);
  });

  await test('Fase 10 · FAA — una licencia FAA sin fecha de caducidad NO se trata como caducada', () => {
    assert.equal(authorityLicenseCanExpire('FAA'), false, '14 CFR 65: el certificado no expira');
    for (const authority of ['EASA', 'UK_CAA', 'GCAA']) assert.equal(authorityLicenseCanExpire(authority), true, authority);

    // Por la rama FAA de verdad (A&P frente a A) y con el reloj muy adelante:
    // nada puede leerse como caducado.
    const oferta = makeOffer({ licenseCode: 'A', licenseAuthority: 'FAA' });
    const tecnico = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('A&P', { authority: 'FAA' })] });
    const r = puntuar(oferta, tecnico, { now: new Date(2040, 0, 1) });
    assert.deepEqual(r.vigenciaNotices, []);
    assert.deepEqual(r.missingRequirements, []);
    assert.equal(r.total, 100);
  });

  await test('H7 — CASA y FAA ignoran caducidades históricas; EASA, UK y GCAA las conservan', () => {
    for (const authority of ['CASA', 'FAA', 'EASA', 'UK_CAA', 'GCAA'] as AuthorityCode[]) {
      const code = authority === 'FAA' ? 'A&P' : 'B1.1';
      const perpetual = authority === 'CASA' || authority === 'FAA';
      assert.equal(authorityLicenseCanExpire(authority), !perpetual);
      for (const withRating of authority === 'FAA' ? [false] : [false, true]) {
        const offer = makeOffer({ licenseAuthority: authority, licenseCode: code,
          requiredHabilitations: withRating ? [makeHabReq('fx-a320-cfm56')] : [] });
        const license = makeLicense(code, { authority });
        const tech = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [license],
          habilitations: withRating ? [makeHabOn(license, { aircraftTypeRatingId: 'fx-a320-cfm56' })] : [] });
        const control = puntuar(offer, tech);
        const historical = puntuar(offer, { ...tech, licenses: [{ ...license, expiresAt: '2000-01-01' }] });
        if (perpetual) assert.deepEqual(historical, control, authority);
        else assert.ok(historical.total < control.total, authority);
      }
    }
  });

  await test('Fase 10 · FAA — una oferta FAA no depende de que el catálogo de type ratings esté cargado', () => {
    const tecnico = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('A&P', { authority: 'FAA' })] });
    const sinCatalogo = { ratingIndex: new Map() as AircraftRatingIndex, engineIndex: new Map() as EngineIndex };
    for (const code of ['A&P', 'P']) {
      const r = puntuar(makeOffer({ licenseCode: code, licenseAuthority: 'FAA' }), tecnico, sinCatalogo);
      assert.equal(r.total, 100, `A&P frente a ${code} con el catálogo vacío`);
    }
  });

  // ── Sesión 2: FAA con aeronaves como experiencia ──────────────────────

  const ofertaFaa737 = (extra: OfferOverrides = {}) =>
    makeOffer({ licenseCode: 'A&P', licenseAuthority: 'FAA', requiredHabilitations: [makeHabReq('fx-b737ng-cfm56-7b')], ...extra });

  await test('Sesión 2 · FAA + 737 — quien declara experiencia en el 737 puntúa más, y quien no la tiene sigue dentro', () => {
    const oferta = ofertaFaa737();
    assert.deepEqual(
      getMatchScoreWeights(oferta),
      { verified: 15, habilitation: 25, license: 40, contractFit: 15, location: 5, engine: 0 },
      'licencia 40 + experiencia 25',
    );
    const aYp = () => makeLicense('A&P', { authority: 'FAA' });
    const con737 = makeTechnician({ ...PERFIL_A_FAVOR, id: 'faa-con-737', licenses: [aYp()], aircraftExperience: [makeAircraftExperience('fx-b737ng-cfm56-7b', 6)] });
    const sin737 = makeTechnician({ ...PERFIL_A_FAVOR, id: 'faa-sin-737', licenses: [aYp()], aircraftExperience: [makeAircraftExperience('fx-a320-cfm56', 6)] });

    const r1 = puntuar(oferta, con737);
    const r2 = puntuar(oferta, sin737);
    assert.equal(r1.total, 100);
    assert.equal(r1.level, 'exact');
    assert.equal(r2.total, 75, 'con la licencia y sin el 737: por debajo de Excellent, nunca el tope de 39');
    assert.deepEqual(r2.missingRequirements, [], 'no tener el 737 no es un requisito incumplido');

    // Puntúa, no excluye: los dos son elegibles y los dos salen en la lista.
    assert.equal(elegible(oferta, sin737), true);
    const ranking = rankTechniciansForOffer(oferta, [sin737, con737], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW);
    assert.deepEqual(ranking.map((s) => s.technicianId), ['faa-con-737', 'faa-sin-737']);
  });

  await test('Sesión 2 · FAA + 737 — se compara con la experiencia declarada, no con habilitaciones', () => {
    const oferta = ofertaFaa737();
    const aYp = makeLicense('A&P', { authority: 'FAA' });
    const easa = makeLicense('B1.1', { authority: 'EASA' });
    // El 737NG como type rating EASA, sin declararlo como experiencia.
    const conHabilitacion = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [aYp, easa],
      habilitations: [makeHabOn(easa, { aircraftTypeRatingId: 'fx-b737ng-cfm56-7b' })],
    });
    const r = puntuar(oferta, conHabilitacion);
    assert.equal(r.breakdown.habilitation, 0, 'una habilitación no es experiencia declarada en una oferta FAA');
    assert.equal(r.total, 75);

    // Contraste: la misma habilitación SÍ cuenta en una oferta sin certificar,
    // que une las dos fuentes. Sin esto el test pasaría con un evaluador que no
    // mirase habilitaciones en ninguna rama.
    const sinCertificar = makeOffer({ requiresCertification: false, licenseCode: undefined, requiredHabilitations: [makeHabReq('fx-b737ng-cfm56-7b')] });
    assert.ok(puntuar(sinCertificar, conHabilitacion).breakdown.habilitation > 0);
  });

  await test('Sesión 2 · FAA + 737 — sin la licencia FAA la experiencia no basta; las ofertas Part-66 no cambian', () => {
    const oferta = ofertaFaa737();
    const soloExperiencia = makeTechnician({ ...PERFIL_A_FAVOR, aircraftExperience: [makeAircraftExperience('fx-b737ng-cfm56-7b', 12)] });
    const r = puntuar(oferta, soloExperiencia);
    assert.equal(r.breakdown.license, 0);
    assert.ok(r.breakdown.habilitation > 0, 'la experiencia se ve en el desglose');
    assert.ok(r.total <= ZERO_QUALIFICATION_CAP, `la licencia es el eje pedido: tope de 39, got ${r.total}`);
    assert.equal(r.level, 'not_met');
    assert.deepEqual(r.missingRequirements, ['Required license: A&P']);

    // Part-66: la misma experiencia declarada sigue sin valer en una oferta que
    // certifica con type rating.
    const b11 = makeLicense('B1.1', { authority: 'EASA' });
    const easa737 = makeOffer({ licenseAuthority: 'EASA', requiredHabilitations: [makeHabReq('fx-b737ng-cfm56-7b')] });
    assert.deepEqual(getMatchScoreWeights(easa737), { verified: 15, habilitation: 45, license: 20, contractFit: 15, location: 5, engine: 0 });
    const part66 = puntuar(easa737, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [b11], aircraftExperience: [makeAircraftExperience('fx-b737ng-cfm56-7b', 12)] }));
    assert.equal(part66.breakdown.habilitation, 0);
    assert.ok(part66.total <= ZERO_QUALIFICATION_CAP, `got ${part66.total}`);
  });

  await test('Sesión 2 · Aviónica FAA — una oferta de aviónica puede pedir A o A&P, y los dos puntúan', () => {
    assert.deepEqual(licensesSelectableForOffer({ offerKind: 'aircraft', technicianType: 'avionic' }, 'FAA'), ['A', 'A&P']);
    assert.deepEqual(licensesSelectableForOffer({ offerKind: 'aircraft', technicianType: 'mechanic' }, 'FAA'), ['A', 'P', 'A&P'], 'mecánico no cambia');
    // Pedir no es implicar: tener un A&P sigue haciendo mecánico, no aviónico.
    assert.deepEqual(typesImpliedByLicenses(['A&P']), ['mechanic']);
    assert.deepEqual(typesImpliedByLicenses(['A']), ['mechanic']);

    const avionico = { ...PERFIL_A_FAVOR, technicianTypes: ['avionic'] as TechnicianTypeCode[] };
    for (const code of ['A', 'A&P'] as const) {
      const oferta = makeOffer({ technicianType: 'avionic', licenseCode: code, licenseAuthority: 'FAA' });
      assert.equal(puntuar(oferta, makeTechnician({ ...avionico, licenses: [makeLicense('A&P', { authority: 'FAA' })] })).total, 100, `A&P frente a ${code}`);
      assert.equal(puntuar(oferta, makeTechnician({ ...avionico, licenses: [makeLicense('A', { authority: 'FAA' })] })).total, code === 'A' ? 100 : 35, `A frente a ${code}: la mitad del certificado no cuenta`);
    }
  });

  // ── Recortes por autoridad ────────────────────────────────────────────

  await test('Fase 10 · Recortes — CASA no admite B2L, B3 ni L; GCAA no admite B2L', () => {
    for (const code of ['B2L', 'B3', 'L']) assert.equal(isValidAuthorityLicense('CASA', code), false, `CASA ${code}`);
    assert.equal(isValidAuthorityLicense('GCAA', 'B2L'), false, 'GCAA B2L');

    // Y el recorte no se lleva nada más por delante.
    for (const code of ['B1.1', 'B2', 'C', 'A1']) assert.equal(isValidAuthorityLicense('CASA', code), true, `CASA ${code}`);
    for (const code of ['B3', 'L', 'B2', 'C']) assert.equal(isValidAuthorityLicense('GCAA', code), true, `GCAA ${code}`);
    for (const code of LICENSE_CODES) {
      assert.equal(isValidAuthorityLicense('EASA', code), true, `EASA ${code}`);
      assert.equal(isValidAuthorityLicense('UK_CAA', code), true, `UK_CAA ${code}`);
    }
  });

  await test('Fase 10 · Recortes — una combinación autoridad+código que no existe es inválida', () => {

    assert.equal(isValidAuthorityLicense('FAA', 'B1.1'), false);
    assert.equal(isValidAuthorityLicense('FAA', 'B2'), false, 'FAA sin B2');
    assert.equal(isValidAuthorityLicense('FAA', 'C'), false, 'FAA sin C');
    assert.equal(isValidAuthorityLicense('EASA', 'A&P'), false);
    assert.equal(isValidAuthorityLicense('UK_CAA', 'P'), false);
    assert.equal(isValidAuthorityLicense('EASA', 'B9'), false);
    assert.equal(isValidAuthorityLicense('NOPE', 'B1.1'), false);

    // El predicado y la tabla no pueden divergir: cada par posible se contesta
    // igual en los dos sitios.
    const enTabla = new Set(AUTHORITY_LICENSES.map((r) => `${r.authority}|${r.code}`));
    for (const authority of [...PART66_AUTHORITIES, 'FAA']) {
      for (const code of [...LICENSE_CODES, 'A', 'P', 'A&P']) {
        assert.equal(isValidAuthorityLicense(authority, code), enTabla.has(`${authority}|${code}`), `${authority} ${code}`);
      }
    }
  });

  // ── Ofertas de motores ────────────────────────────────────────────────

  await test('Fase 10 · Motores — el motor exacto NO cae en el tope de "no pide nada" (75)', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const r = puntuar(oferta, makeTechnician({ ...PERFIL_MOTOR, engines: [makeEngineDeclaration('eng-cfm56-7b', 8)] }));
    assert.equal(sumaPesos(getMatchScoreWeights(oferta)), 100, 'una oferta de motor PIDE algo: su escala es 100, no la de 75');
    assert.ok(r.total > 75, `el candidato exacto no puede quedarse en el techo de "no pide nada", got ${r.total}`);
    assert.equal(r.total, 100);
    assert.equal(r.label, 'Excellent match');
  });

  await test('Fase 10 · Motores — el motor exacto NO cae en el tope de cero cualificación (39)', () => {
    // Todo lo demás en contra: sin verificar, otro contrato, otro país. Lo
    // único que tiene es el motor, y con eso tiene que pasar de 39.
    const r = puntuar(
      makeEngineOffer('eng-cfm56-7b'),
      makeTechnician({
        technicianTypes: ['engine_technician'],
        verificationStatus: 'pending',
        availability: { immediately: false, contractTypes: ['short_term'] },
        locationCountryCode: 'ZZ',
        engines: [makeEngineDeclaration('eng-cfm56-7b')],
      }),
    );
    assert.ok(r.total > ZERO_QUALIFICATION_CAP, `tener el motor pedido es cualificación, got ${r.total}`);
    assert.equal(r.total, sumaDesglose(r), 'ningún tope recorta');
    assert.deepEqual(r.missingRequirements, []);
  });

  await test('Fase 10 · Motores — orden: declarado > implícito en type rating > familia > tipo > tipo distinto > sin motores', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const b11 = makeLicense('B1.1');
    // Mismos tipos para los seis (un mecánico sin licencia es un perfil
    // válido), así ni el oficio ni la licencia pueden explicar el orden.
    const escalones: { nombre: string; extra: TechnicianOverrides }[] = [
      { nombre: 'motor declarado (CFM56-7B)', extra: { engines: [makeEngineDeclaration('eng-cfm56-7b')] } },
      {
        nombre: 'motor implícito en un type rating (737NG → CFM56-7B)',
        extra: { licenses: [b11], habilitations: [makeHabOn(b11, { aircraftTypeRatingId: 'fx-b737ng-cfm56-7b' })] },
      },
      { nombre: 'misma familia (CFM56-5B)', extra: { engines: [makeEngineDeclaration('eng-cfm56-5b')] } },
      { nombre: 'mismo tipo de motor (turbofán V2500)', extra: { engines: [makeEngineDeclaration('eng-v2500-a5')] } },
      { nombre: 'tipo distinto (turboeje PT6C)', extra: { engines: [makeEngineDeclaration('eng-pt6c-67c')] } },
      { nombre: 'sin motores', extra: {} },
    ];

    const totales = escalones.map(({ extra }) =>
      puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['mechanic', 'engine_technician'], ...extra })).total,
    );
    for (let i = 1; i < escalones.length; i += 1) {
      assert.ok(
        totales[i] < totales[i - 1],
        `"${escalones[i - 1].nombre}" (${totales[i - 1]}) debe quedar por encima de "${escalones[i].nombre}" (${totales[i]}). Medido: ${totales.join(' / ')}`,
      );
    }
    assert.ok(totales[totales.length - 1] > 0, 'el último escalón puntúa bajo, pero no cero');
  });

  // Paso 5a: "sigue en la lista" porque es engine_technician (PERFIL_MOTOR). Un
  // perfil sin motores y SIN ese oficio no es elegible — ver los tests de
  // elegibilidad de motor al final del fichero.
  await test('Fase 10 · Motores — un engine_technician sin motores puntúa bajo pero NO cero, y sigue en la lista', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const sinMotores = makeTechnician({ ...PERFIL_MOTOR, id: 'tech-sin-motores' });
    const tipoDistinto = makeTechnician({ ...PERFIL_MOTOR, engines: [makeEngineDeclaration('eng-pt6c-67c')] });

    const r = puntuar(oferta, sinMotores);
    assert.equal(r.label, 'Weak match', `sin motores no puede leerse mejor que Weak, got ${r.total} (${r.label})`);
    assert.ok(r.total > 0);
    assert.deepEqual(r.blockers, [], 'bajo, no descalificado');
    assert.ok(r.total < puntuar(oferta, tipoDistinto).total, 'por debajo de quien tiene un motor de otro tipo');

    assert.equal(rankTechniciansForOffer(oferta, [sinMotores], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).length, 1, 'no se filtra fuera');
  });

  await test('Fase 10 · Motores — los años de motor no cambian el score (1 año = 20 años = sin declarar)', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const conAnos = (years?: number) => puntuar(oferta, makeTechnician({ ...PERFIL_MOTOR, engines: [makeEngineDeclaration('eng-cfm56-7b', years)] }));
    const sinMotores = puntuar(oferta, makeTechnician(PERFIL_MOTOR));

    // Contraste primero: si el motor no puntúa, la igualdad de abajo es vacía.
    assert.ok(conAnos(1).total > sinMotores.total, `el motor tiene que puntuar para que esto signifique algo (${conAnos(1).total} vs ${sinMotores.total})`);

    for (const [a, b] of [[conAnos(1), conAnos(20)], [conAnos(1), conAnos(undefined)]]) {
      assert.equal(a.total, b.total);
      assert.deepEqual(a.breakdown, b.breakdown);
      assert.equal(a.label, b.label);
    }
  });

  await test('Fase 10 · Motores — el oficio no cambia el score: un B1.1 y un engine_technician con el mismo motor empatan', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const motor = [makeEngineDeclaration('eng-cfm56-7b')];
    const mecanicoB11 = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['mechanic'], licenses: [makeLicense('B1.1')], engines: motor }));
    const tecnicoMotor = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['engine_technician'], engines: motor }));
    // Sin licencia de por medio, para aislar el oficio del todo.
    const pintor = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['painter'], engines: motor }));

    assert.equal(mecanicoB11.total, tecnicoMotor.total, `B1.1 mecánico ${mecanicoB11.total} vs engine_technician ${tecnicoMotor.total}`);
    assert.deepEqual(mecanicoB11.breakdown, tecnicoMotor.breakdown);
    assert.equal(pintor.total, tecnicoMotor.total, `pintor ${pintor.total} vs engine_technician ${tecnicoMotor.total}`);
    assert.deepEqual(mecanicoB11.blockers, []);
  });

  await test('Fase 10 · Motores — la licencia no suma: un B2 con el motor no supera a uno sin licencia con el mismo motor', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const tipos: TechnicianTypeCode[] = ['avionic', 'engine_technician'];
    const conB2 = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: tipos, licenses: [makeLicense('B2')], engines: [makeEngineDeclaration('eng-cfm56-7b')] }));
    const sinLicencia = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: tipos, engines: [makeEngineDeclaration('eng-cfm56-7b')] }));
    const sinMotores = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: tipos }));

    // Contraste primero: hoy los dos empatan porque NADA puntúa.
    assert.ok(sinLicencia.total > sinMotores.total, `el motor tiene que puntuar (${sinLicencia.total} vs ${sinMotores.total})`);
    assert.ok(!(conB2.total > sinLicencia.total), `la B2 no suma: ${conB2.total} > ${sinLicencia.total}`);
    assert.equal(conB2.total, sinLicencia.total);
    assert.deepEqual(conB2.breakdown, sinLicencia.breakdown);
  });

  // Fixtures compartidos por los dos tests del filtro "sólo sin licencia".
  const motorExacto = [makeEngineDeclaration('eng-cfm56-7b')];
  const ofertaSoloSinLicencia = makeEngineOffer('eng-cfm56-7b', { id: 'offer-motor-solo-sin-licencia', onlyUnlicensed: true });
  const ofertaMotorAbierta = makeEngineOffer('eng-cfm56-7b', { id: 'offer-motor-abierta' });
  const tecnicoConLicencia = makeTechnician({
    ...PERFIL_A_FAVOR,
    id: 'tech-con-licencia',
    technicianTypes: ['avionic', 'engine_technician'],
    licenses: [makeLicense('B2')],
    engines: motorExacto,
  });
  const tecnicoSinLicencia = makeTechnician({ ...PERFIL_MOTOR, id: 'tech-sin-licencia', engines: motorExacto });

  await test('Fase 10 · Motores — con "sólo técnicos sin licencia" marcada, los licenciados quedan fuera', () => {
    const tecnicos = [tecnicoConLicencia, tecnicoSinLicencia];

    assert.equal(elegible(ofertaSoloSinLicencia, tecnicoConLicencia), false);
    assert.equal(elegible(ofertaSoloSinLicencia, tecnicoSinLicencia), true);
    assert.deepEqual(
      rankTechniciansForOffer(ofertaSoloSinLicencia, tecnicos, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).map((s) => s.technicianId),
      ['tech-sin-licencia'],
      'fuera = no aparece, no "aparece abajo"',
    );

    // Desmarcada no filtra a nadie.
    assert.equal(elegible(ofertaMotorAbierta, tecnicoConLicencia), true);
    assert.deepEqual(
      rankTechniciansForOffer(ofertaMotorAbierta, tecnicos, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).map((s) => s.technicianId).sort(),
      ['tech-con-licencia', 'tech-sin-licencia'],
    );
  });

  await test('Fase 10 · Motores — el filtro "sólo sin licencia" se aplica igual en oferta→técnicos y en técnico→ofertas', () => {
    const ofertas = [ofertaSoloSinLicencia, ofertaMotorAbierta];
    const tecnicos = [tecnicoConLicencia, tecnicoSinLicencia];

    for (const oferta of ofertas) {
      for (const tecnico of tecnicos) {
        const desdeOferta = rankTechniciansForOffer(oferta, tecnicos, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).find((s) => s.technicianId === tecnico.id);
        const desdeTecnico = rankOffersForTechnician(tecnico, ofertas, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).find((s) => s.offerId === oferta.id);
        const esperado = elegible(oferta, tecnico);
        assert.equal(Boolean(desdeOferta), esperado, `oferta→técnicos: ${oferta.id} / ${tecnico.id}`);
        assert.equal(Boolean(desdeTecnico), esperado, `técnico→ofertas: ${tecnico.id} / ${oferta.id}`);
        if (desdeOferta && desdeTecnico) assert.equal(desdeOferta.total, desdeTecnico.total, `mismo score en las dos direcciones: ${oferta.id} / ${tecnico.id}`);
      }
    }

    assert.deepEqual(
      rankOffersForTechnician(tecnicoConLicencia, ofertas, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).map((s) => s.offerId),
      ['offer-motor-abierta'],
      'el licenciado ni siquiera ve la oferta "sólo sin licencia"',
    );
  });

  // ── Seeds y catálogo ──────────────────────────────────────────────────

  await test('Fase 10 · Seeds — authority_licenses: 51 filas (13 EASA, 13 UK CAA, 10 CASA, 12 GCAA, 3 FAA)', () => {
    // Espejo en TS de la tabla. Que la tabla de Postgres coincida con esto lo
    // comprueba `npm run validate:authority-licenses`, contra la base viva.
    assert.equal(AUTHORITY_LICENSES.length, 51);

    const porAutoridad: Record<string, number> = {};
    for (const r of AUTHORITY_LICENSES) porAutoridad[r.authority] = (porAutoridad[r.authority] ?? 0) + 1;
    assert.deepEqual(porAutoridad, { EASA: 13, UK_CAA: 13, CASA: 10, GCAA: 12, FAA: 3 });
    assert.equal(new Set(AUTHORITY_LICENSES.map((r) => `${r.authority}|${r.code}`)).size, 51, 'ningún par repetido');

    const codigos = (authority: string) => AUTHORITY_LICENSES.filter((r) => r.authority === authority).map((r) => r.code).sort();
    const part66 = [...LICENSE_CODES].sort();
    assert.deepEqual(codigos('EASA'), part66);
    assert.deepEqual(codigos('UK_CAA'), part66);
    assert.deepEqual(codigos('CASA'), part66.filter((c) => !['B2L', 'B3', 'L'].includes(c)));
    assert.deepEqual(codigos('GCAA'), part66.filter((c) => c !== 'B2L'));
    assert.deepEqual(codigos('FAA'), ['A', 'A&P', 'P']);
  });

  await test('Fase 10 · Catálogo — el escalón "motor implícito en un type rating" no se apoya en filas sucias', () => {
    // Guarda de los propios fixtures: la escalera usa filas limpias, y las
    // sucias llegan como llegan de verdad, sin engineId.
    const porId = new Map(ENGINE_RATING_FIXTURES.map((r) => [r.id, r]));
    assert.ok(porId.get('fx-b737ng-cfm56-7b')?.engineId, 'fila limpia con engineId');
    assert.ok(porId.get('fx-bell407-rr250')?.engineId, 'fila limpia con engineId');
    assert.equal(porId.get('fx-sucia-a109-corp250')?.engineId, undefined);
    assert.equal(porId.get('fx-sucia-falcon7x-pw307')?.engineId, undefined);

    // Los tres técnicos llevan la MISMA licencia; sólo cambia de qué rating
    // cuelga la habilitación.
    const conHabEn = (code: AuthorityLicenseCode, ratingId?: string) => {
      const lic = makeLicense(code);
      return makeTechnician({
        ...PERFIL_A_FAVOR,
        technicianTypes: ['mechanic', 'engine_technician'],
        licenses: [lic],
        habilitations: ratingId ? [makeHabOn(lic, { aircraftTypeRatingId: ratingId })] : [],
      });
    };

    // `Corp 250`: el Model 250 mal partido. Leerlo como M250 por texto sería
    // el falso positivo.
    const ofertaM250 = makeEngineOffer('eng-rr-m250');
    const limpia = puntuar(ofertaM250, conHabEn('B1.3', 'fx-bell407-rr250'));
    const corp250 = puntuar(ofertaM250, conHabEn('B1.3', 'fx-sucia-a109-corp250'));
    const nada = puntuar(ofertaM250, conHabEn('B1.3'));
    assert.ok(limpia.total > corp250.total, `la fila limpia (${limpia.total}) aporta el motor; la sucia (${corp250.total}) no`);
    assert.equal(corp250.total, nada.total, 'la fila Corp 250 puntúa como no tener motores');

    // Modelo escrito en engine_manufacturer.
    const ofertaPw307 = makeEngineOffer('eng-pw307');
    const declarado = puntuar(ofertaPw307, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['mechanic', 'engine_technician'], licenses: [makeLicense('B1.1')], engines: [makeEngineDeclaration('eng-pw307')] }));
    const pw307Sucia = puntuar(ofertaPw307, conHabEn('B1.1', 'fx-sucia-falcon7x-pw307'));
    const nadaPw = puntuar(ofertaPw307, conHabEn('B1.1'));
    assert.ok(declarado.total > pw307Sucia.total, `declarado (${declarado.total}) > fila sucia (${pw307Sucia.total})`);
    assert.equal(pw307Sucia.total, nadaPw.total, 'la fila con el modelo en el fabricante puntúa como no tener motores');
  });

  await test('Fase 10 · Catálogo — un rating enlazado a un motor GENÉRICO da crédito de familia, nunca de motor exacto', () => {
    // Decisión del 2026-09-15 (opción B del seed): los ratings de pistón cuyo
    // texto sólo nombra el fabricante se enlazan a "Lycoming (model not
    // specified)". El escalón "motor implícito" mira is_generic (089): una
    // genérica no dice QUÉ motor es, así que sólo puede decir de qué familia.
    const generica = ENGINE_INDEX.get('eng-lycoming-generica');
    assert.equal(generica?.isGeneric, true, 'guarda del fixture: la genérica llega marcada como genérica');

    const oferta = makeEngineOffer('eng-lycoming-o360');
    // Los cinco con la MISMA licencia y los mismos tipos; sólo cambia de dónde
    // sale el motor.
    const conPerfil = ({ engines = [], habOn }: { engines?: TechnicianEngineExperience[]; habOn?: string }) => {
      const lic = makeLicense('B1.2');
      return puntuar(
        oferta,
        makeTechnician({
          ...PERFIL_A_FAVOR,
          technicianTypes: ['mechanic', 'engine_technician'],
          licenses: [lic],
          habilitations: habOn ? [makeHabOn(lic, { aircraftTypeRatingId: habOn })] : [],
          engines,
        }),
      );
    };

    const declarado = conPerfil({ engines: [makeEngineDeclaration('eng-lycoming-o360')] });
    const implicitoActivo = conPerfil({ habOn: 'fx-pa28-o360-limpia' });
    const implicitoGenerico = conPerfil({ habOn: 'fx-pa28-lycoming-generica' });
    const familiaDeclarada = conPerfil({ engines: [makeEngineDeclaration('eng-lycoming-o320')] });
    const mismoTipo = conPerfil({ engines: [makeEngineDeclaration('eng-continental-io550')] });

    // Contraste primero: hoy los cinco empatan porque el motor no puntúa.
    assert.ok(
      implicitoActivo.total > implicitoGenerico.total,
      `implícito con motor activo (${implicitoActivo.total}) > implícito con genérica (${implicitoGenerico.total})`,
    );
    assert.equal(
      implicitoGenerico.total,
      familiaDeclarada.total,
      `la genérica vale EXACTAMENTE lo que la misma familia (${implicitoGenerico.total} vs ${familiaDeclarada.total})`,
    );
    assert.deepEqual(implicitoGenerico.breakdown, familiaDeclarada.breakdown);
    assert.ok(implicitoGenerico.total < declarado.total, 'nunca llega al motor exacto');
    assert.ok(implicitoGenerico.total > mismoTipo.total, 'pero sí por encima de otro fabricante del mismo tipo');
  });

  await test('Fase 10 · Catálogo (089) — desactivar un modelo concreto no convierte un exacto en familia; lo que niega el exacto es is_generic', () => {
    // Hasta la 089 "inactivo" y "genérico" eran la misma bandera, y retirar un
    // modelo de los selectores rebajaba a familia a quien ya lo tenía. Se
    // prueban las dos direcciones sobre la MISMA fila (CFM56-7B), para que
    // sólo la bandera pueda explicar el cambio.
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const b11 = makeLicense('B1.1');
    const tipos: TechnicianOverrides = { ...PERFIL_A_FAVOR, technicianTypes: ['mechanic'] };
    const declarado = makeTechnician({ ...tipos, engines: [makeEngineDeclaration('eng-cfm56-7b')] });
    // Sin motores declarados ni oficio de motor: entra sólo por la vía (b).
    const implicito = makeTechnician({ ...tipos, licenses: [b11], habilitations: [makeHabOn(b11, { aircraftTypeRatingId: 'fx-b737ng-cfm56-7b' })] });

    const indiceCon = (cambios: Partial<EngineCatalog>) =>
      buildEngineIndex(ENGINE_FIXTURES.map((e) => (e.id === 'eng-cfm56-7b' ? { ...e, ...cambios } : e)));
    const desactivado = indiceCon({ isActive: false });
    const genericoActivo = indiceCon({ isGeneric: true });

    // Control: activo y concreto. ENGINE_WEIGHTS da 65 al motor.
    assert.equal(puntuar(oferta, declarado).breakdown.engine, 65, 'declarado exacto: el peso de motor entero');
    assert.equal(puntuar(oferta, implicito).breakdown.engine, 52, 'implícito exacto: 0,8 del peso');

    // Desactivado: exactamente el mismo resultado, y sigue elegible.
    assert.deepEqual(puntuar(oferta, declarado, { engineIndex: desactivado }), puntuar(oferta, declarado), 'declarado: nada cambia al desactivar el modelo');
    assert.deepEqual(puntuar(oferta, implicito, { engineIndex: desactivado }), puntuar(oferta, implicito), 'implícito: nada cambia al desactivar el modelo');
    assert.equal(elegible(oferta, implicito, { engineIndex: desactivado }), true);

    // Genérico aunque siga activo: los dos bajan a familia (0,55 de 65 = 36),
    // y la vía (b) sigue admitiendo porque la familia también entra.
    assert.equal(puntuar(oferta, declarado, { engineIndex: genericoActivo }).breakdown.engine, 36, 'declarado sobre una genérica: familia');
    assert.equal(puntuar(oferta, implicito, { engineIndex: genericoActivo }).breakdown.engine, 36, 'implícito sobre una genérica: familia');
    assert.equal(elegible(oferta, implicito, { engineIndex: genericoActivo }), true);
  });

  await test('Fase 10 · Catálogo (089) — el selector no ofrece genéricas aunque estén activas, ni modelos desactivados', () => {
    const catalogo = [
      ...ENGINE_FIXTURES,
      makeEngine({ id: 'eng-cfm56-generica', manufacturer: 'CFM International', family: 'CFM56', engineType: 'turbofan', displayName: 'CFM56', isGeneric: true }),
      makeEngine({ id: 'eng-cfm56-retirado', manufacturer: 'CFM International', family: 'CFM56', engineType: 'turbofan', displayName: 'CFM56-9Z', isActive: false }),
    ];
    const ids = searchEngines(catalogo, 'cfm56').map((e) => e.id);
    assert.deepEqual(ids, ['eng-cfm56-5b', 'eng-cfm56-7b'], `sólo las variantes activas: ${ids.join(', ')}`);
    assert.ok(!searchEngines(catalogo, 'lycoming').some((e) => e.isGeneric), 'la genérica inactiva tampoco');
  });

  await test('Fase 10 · Catálogo (090) — CFM56 y V2500 en variantes: rating de una variante = exacto implícito; de varias = familia', () => {
    // La forma del catálogo tras la 090. "CFM56" y "V2500" son las genéricas
    // de su familia (activas). El 737NG cuelga del CFM56-7B (su única serie,
    // TCDS IM.A.120) y el MD-90 del V2500-D5 (IM.A.211); el A320 CFM (-5A o
    // -5B) y el A320 IAE (-A1 o -A5) se quedan en la genérica.
    const cfm56 = makeEngine({ id: 'eng-cfm56-agregada', manufacturer: 'CFM International', family: 'CFM56', engineType: 'turbofan', displayName: 'CFM56', isGeneric: true });
    const v2500 = makeEngine({ id: 'eng-v2500-agregada', manufacturer: 'International Aero Engines', family: 'V2500', engineType: 'turbofan', displayName: 'V2500', isGeneric: true });
    const v2500d5 = makeEngine({ id: 'eng-v2500-d5', manufacturer: 'International Aero Engines', family: 'V2500', engineType: 'turbofan', displayName: 'V2500-D5' });
    const avion = { aircraftCategory: 'commercial_airplane' as const, productType: 'Aeroplane' as const };
    const ratings = [
      makeEngineRating({ id: 'fx-090-a320-cfm', manufacturer: 'Airbus', aircraftFamily: 'Airbus A318/A319/A320/A321', easaEndorsement: 'Airbus A318/A319/A320/A321 (CFM56)', displayName: 'Airbus A320 family — CFM56', engineId: cfm56.id, ...avion }),
      makeEngineRating({ id: 'fx-090-a320-iae', manufacturer: 'Airbus', aircraftFamily: 'Airbus A319/A320/A321', easaEndorsement: 'Airbus A319/A320/A321 (IAE V2500)', displayName: 'Airbus A320 family — V2500', engineId: v2500.id, ...avion }),
      makeEngineRating({ id: 'fx-090-md90', manufacturer: 'McDonnell Douglas', aircraftFamily: 'MD-90', easaEndorsement: 'MD-90 (IAE V2500)', displayName: 'MD-90 — V2500', engineId: v2500d5.id, ...avion }),
    ];
    const opts = {
      engineIndex: buildEngineIndex([...ENGINE_FIXTURES, cfm56, v2500, v2500d5]),
      ratingIndex: buildAircraftRatingIndex([...FIXTURES, ...ENGINE_RATING_FIXTURES, ...ratings]),
    };
    const b11 = makeLicense('B1.1');
    // Mecánico sin oficio de motor ni motores declarados: la B1 es su única vía.
    const b1Con = (ratingId: string) =>
      makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['mechanic'], licenses: [b11], habilitations: [makeHabOn(b11, { aircraftTypeRatingId: ratingId })] });
    const declara = (engineId: string) => makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['mechanic'], engines: [makeEngineDeclaration(engineId)] });

    // Oferta de CFM56-7B, los tres casos pedidos. ENGINE_WEIGHTS: motor 65.
    const oferta7b = makeEngineOffer('eng-cfm56-7b');
    const ng = puntuar(oferta7b, b1Con('fx-b737ng-cfm56-7b'), opts);
    const a320 = puntuar(oferta7b, b1Con('fx-090-a320-cfm'), opts);
    const declarado = puntuar(oferta7b, declara('eng-cfm56-7b'), opts);

    assert.equal(declarado.breakdown.engine, 65, 'declara CFM56-7B: exacto declarado');
    assert.ok(declarado.matches.includes('Engine: CFM56-7B'), declarado.matches.join(' | '));
    assert.equal(ng.breakdown.engine, 52, 'B1 con 737NG: exacto implícito (0,8)');
    assert.ok(ng.matches.some((m) => m.startsWith('Engine: CFM56-7B — from the B1.1')), ng.matches.join(' | '));
    assert.equal(a320.breakdown.engine, 36, 'B1 con A320 CFM: familia (0,55)');
    assert.ok(a320.clarifications.includes('Same engine family, different model: CFM56-7B vs CFM56.'), a320.clarifications.join(' | '));
    assert.ok(declarado.total > ng.total && ng.total > a320.total, `declarado ${declarado.total} > implícito ${ng.total} > familia ${a320.total}`);
    for (const [nombre, t] of [['737NG', b1Con('fx-b737ng-cfm56-7b')], ['A320 CFM', b1Con('fx-090-a320-cfm')]] as const) {
      assert.equal(elegible(oferta7b, t, opts), true, `${nombre}: entra por la vía (b), exacto o familia`);
    }

    // V2500, lo mismo: MD-90 = exacto implícito del -D5, A320 IAE = familia.
    const ofertaD5 = makeEngineOffer(v2500d5.id);
    assert.equal(puntuar(ofertaD5, b1Con('fx-090-md90'), opts).breakdown.engine, 52, 'B1 con MD-90: exacto implícito');
    assert.equal(puntuar(ofertaD5, b1Con('fx-090-a320-iae'), opts).breakdown.engine, 36, 'B1 con A320 IAE: familia');

    // Datos existentes (0 el 2026-09-21): lo que ya apuntaba a la fila
    // agregada no se reasigna y ahora da familia, también contra sí misma.
    const ofertaAgregada = makeEngineOffer(cfm56.id);
    assert.equal(puntuar(ofertaAgregada, declara(cfm56.id), opts).breakdown.engine, 36, 'declaró "CFM56" ante oferta "CFM56": familia');
    assert.equal(puntuar(ofertaAgregada, declara('eng-cfm56-7b'), opts).breakdown.engine, 36, 'declaró CFM56-7B ante oferta "CFM56": familia');
    assert.equal(puntuar(oferta7b, declara(cfm56.id), opts).breakdown.engine, 36, 'declaró "CFM56" ante oferta CFM56-7B: familia');
  });

  // ── Hueco preexistente: caducidad en la rama de sólo licencia ─────────
  //
  // `evaluateLicenseCategoryMatch` no mira expiresAt: una B1.1 caducada saca
  // el 100 en una oferta que sólo pide la B1.1. En la rama con aeronave la
  // misma caducidad cae al tope de 39 desde la tanda E. Este test pide la
  // misma regla aquí.
  await test('Fase 10 · Vigencia — una licencia caducada en oferta de sólo licencia NO puntúa completo', () => {
    const oferta = makeOffer(); // EASA B1.1, sin aeronave, exige certificar
    const vigente = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('B1.1')] }));
    const caducada = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('B1.1', { expiresAt: '2026-01-01' })] }));

    assert.equal(vigente.total, 100, 'control');
    assert.equal(caducada.breakdown.license, 0, 'caducada cuenta como no tenerla, igual que un rating caducado');
    assert.ok(caducada.total <= ZERO_QUALIFICATION_CAP, `got ${caducada.total}`);
    assert.ok(caducada.missingRequirements.some((m) => m.includes('expired')), 'el motivo dice "caducada", no "te falta"');
    assert.equal(caducada.vigenciaNotices.length, 1);
    assert.equal(caducada.vigenciaNotices[0].label, 'Expired');
  });

  // ══════════════════════════════════════════════════════════════════════
  // FASE 10, PASO 5a — el motor conectado al matching real
  //
  // Tres cosas: la elegibilidad de las ofertas de motor (filtro, no puntos),
  // que los envoltorios de matchingV2 den EXACTAMENTE lo mismo que las
  // funciones directas, y la caché del catálogo de motores.
  // ══════════════════════════════════════════════════════════════════════

  await test('Paso 5a · Elegibilidad de motor — B1 con motor declarado aparece; engine_technician sin motores aparece con 3 puntos; B1 sin motores no aparece', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b', { id: 'offer-motor-elegibilidad' });
    const ofertaAeronave = makeOffer({ id: 'offer-aeronave-elegibilidad' });

    const b1ConMotor = makeTechnician({
      ...PERFIL_A_FAVOR,
      id: 'tech-b1-con-motor',
      technicianTypes: ['mechanic'],
      licenses: [makeLicense('B1.1')],
      engines: [makeEngineDeclaration('eng-cfm56-7b')],
    });
    const motorSinMotores = makeTechnician({ ...PERFIL_A_FAVOR, id: 'tech-motor-sin-motores', technicianTypes: ['engine_technician'] });
    const b1SinMotores = makeTechnician({
      ...PERFIL_A_FAVOR,
      id: 'tech-b1-sin-motores',
      technicianTypes: ['mechanic'],
      licenses: [makeLicense('B1.1')],
    });

    // Contraste primero: el B1 sin motores NO queda fuera por nota. Puntuado a
    // mano saca lo mismo que el engine_technician sin motores; lo que lo saca
    // de la lista es el filtro, y eso es lo que este test tiene que probar.
    const b1SinMotoresPuntuado = puntuar(oferta, b1SinMotores);
    assert.ok(b1SinMotoresPuntuado.total > 0, 'el scorer sí lo puntúa');
    assert.equal(b1SinMotoresPuntuado.total, puntuar(oferta, motorSinMotores).total, 'misma nota que el que sí aparece');

    assert.equal(elegible(oferta, b1ConMotor), true);
    assert.equal(elegible(oferta, motorSinMotores), true);
    assert.equal(elegible(oferta, b1SinMotores), false);

    const tecnicos = [b1SinMotores, motorSinMotores, b1ConMotor];
    const ranking = rankTechniciansForOffer(oferta, tecnicos, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW);
    assert.deepEqual(ranking.map((s) => s.technicianId), ['tech-b1-con-motor', 'tech-motor-sin-motores']);

    const sinMotoresEnLista = ranking.find((s) => s.technicianId === 'tech-motor-sin-motores')!;
    assert.equal(sinMotoresEnLista.breakdown.engine, 3, 'engine_technician sin motores: el escalón "none", 3 puntos');
    assert.equal(sinMotoresEnLista.total, puntuar(oferta, motorSinMotores).total, 'el filtro no toca la nota');

    // Técnico→ofertas: el B1 sin motores no ve la de motor, y el filtro no se
    // extiende a las de aeronave.
    const ofertas = [oferta, ofertaAeronave];
    assert.deepEqual(
      rankOffersForTechnician(b1SinMotores, ofertas, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).map((s) => s.offerId),
      ['offer-aeronave-elegibilidad'],
    );
    for (const tecnico of [b1ConMotor, motorSinMotores]) {
      assert.ok(
        rankOffersForTechnician(tecnico, ofertas, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).some((s) => s.offerId === oferta.id),
        `${tecnico.id} ve la oferta de motor`,
      );
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // FASE 10, PASO 5b — el type rating B1 da entrada y puntúa; los demás no
  //
  // Sustituye al test del 5a que fijaba "el motor implícito no hace elegible a
  // nadie". La regla nueva: (a) motor declarado, (b) type rating colgado de
  // una B1 con el motor de la oferta o de su familia, (c) engine_technician.
  // ══════════════════════════════════════════════════════════════════════

  // Un técnico SIN motores declarados y SIN el oficio de motor: todo lo que
  // pueda hacerlo entrar tiene que venir de sus habilitaciones.
  const conRatingsBajo = (id: string, porLicencia: [AuthorityLicenseCode, string][], extra: TechnicianOverrides = {}) => {
    const licencias = new Map<string, TechnicianLicense>();
    for (const [code] of porLicencia) if (!licencias.has(code)) licencias.set(code, makeLicense(code, { id: `lic-${id}-${code}` }));
    return makeTechnician({
      ...PERFIL_A_FAVOR,
      id,
      technicianTypes: ['mechanic'],
      licenses: [...licencias.values()],
      habilitations: porLicencia.map(([code, ratingId]) => makeHabOn(licencias.get(code)!, { aircraftTypeRatingId: ratingId })),
      ...extra,
    });
  };

  await test('Paso 5b · Elegibilidad de motor — B1 con 737NG entra en una oferta de CFM56-7B; B2 con 737NG no entra', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const b1Con737 = conRatingsBajo('tech-b1-737', [['B1.1', 'fx-b737ng-cfm56-7b']]);
    const b2Con737 = conRatingsBajo('tech-b2-737', [['B2', 'fx-b737ng-cfm56-7b']], { technicianTypes: ['avionic'] });

    assert.equal(elegible(oferta, b1Con737), true, 'B1 + 737NG (→ CFM56-7B): vía (b)');
    assert.equal(elegible(oferta, b2Con737), false, 'B2 + 737NG: la aviónica no certifica el motor');

    assert.deepEqual(
      rankTechniciansForOffer(oferta, [b2Con737, b1Con737], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).map((s) => s.technicianId),
      ['tech-b1-737'],
    );
    // Y la otra dirección dice lo mismo.
    assert.equal(rankOffersForTechnician(b1Con737, [oferta], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).length, 1);
    assert.equal(rankOffersForTechnician(b2Con737, [oferta], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW).length, 0);
  });

  await test('Paso 5b · Elegibilidad de motor — B1 y B2 en el mismo type rating entra (lo decide la fila B1)', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const b1yB2 = conRatingsBajo('tech-b1-b2-737', [['B2', 'fx-b737ng-cfm56-7b'], ['B1.1', 'fx-b737ng-cfm56-7b']], {
      technicianTypes: ['mechanic', 'avionic'],
    });
    assert.equal(elegible(oferta, b1yB2), true);
    assert.equal(puntuar(oferta, b1yB2).breakdown.engine, puntuar(oferta, conRatingsBajo('tech-solo-b1', [['B1.1', 'fx-b737ng-cfm56-7b']])).breakdown.engine, 'la fila B2 no suma ni resta');
  });

  await test('Paso 5b · Elegibilidad de motor — la familia vale por type rating B1; un motor sin relación, no; B2 y C nunca', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');

    // Familia: A320 con CFM56-5B bajo una B1.1 frente a una oferta de CFM56-7B.
    assert.equal(elegible(oferta, conRatingsBajo('tech-b1-familia', [['B1.1', 'fx-a320-cfm56-5b-limpia']])), true, 'B1 + familia CFM56');
    // Familia por la genérica inactiva: el PA-28 "Lycoming" bajo B1.2 frente a una O-360.
    assert.equal(elegible(makeEngineOffer('eng-lycoming-o360'), conRatingsBajo('tech-b1-generica', [['B1.2', 'fx-pa28-lycoming-generica']])), true, 'B1 + genérica de la misma familia');
    // La familia necesita el catálogo de motores; sin él, sólo el exacto.
    assert.equal(elegible(oferta, conRatingsBajo('tech-b1-familia-sin-cat', [['B1.1', 'fx-a320-cfm56-5b-limpia']]), { engineIndex: new Map() }), false, 'sin engineIndex la familia no se resuelve');
    assert.equal(elegible(oferta, conRatingsBajo('tech-b1-737-sin-cat', [['B1.1', 'fx-b737ng-cfm56-7b']]), { engineIndex: new Map() }), true, 'el exacto sí, por id');

    // Sin relación: Bell 407 (RR M250) bajo una B1.3.
    assert.equal(elegible(oferta, conRatingsBajo('tech-b1-sin-relacion', [['B1.3', 'fx-bell407-rr250']])), false, 'B1 con un motor sin relación no entra por (b)');
    // Ramas que no certifican el motor, con el motor EXACTO.
    assert.equal(elegible(oferta, conRatingsBajo('tech-c-737', [['C', 'fx-b737ng-cfm56-7b']])), false, 'C + 737NG');
    // Ni oficio de motor ni motor declarado ni rating: fuera.
    assert.equal(elegible(oferta, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['painter'] })), false);
  });

  await test('Paso 5b · Elegibilidad de motor — (a) cualquier motor declarado y (c) engine_technician siguen valiendo; el filtro no toca ofertas de aeronave', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const pintorConTurboeje = makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['painter'], engines: [makeEngineDeclaration('eng-pt6c-67c')] });
    assert.equal(elegible(oferta, pintorConTurboeje), true, '(a) aunque el motor no se parezca y el oficio no sea de motor');
    assert.equal(elegible(oferta, makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['avionic', 'engine_technician'] })), true, '(c) combinado con otros oficios');
    // (c) con un rating B2: entra por el oficio, pero la B2 no puntúa motor.
    const motorConB2 = conRatingsBajo('tech-motor-b2', [['B2', 'fx-b737ng-cfm56-7b']], { technicianTypes: ['engine_technician'] });
    assert.equal(elegible(oferta, motorConB2), true);
    assert.equal(puntuar(oferta, motorConB2).breakdown.engine, 3, 'el motor de un rating B2 no cuenta para puntuar: sigue en "none"');
    assert.equal(elegible(makeOffer(), makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['painter'] })), true);
  });

  await test('Paso 5b · Escalera — declarado > type rating B1 > familia (declarado o B1) > sin relación > engine_technician sin motores (3)', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const escalones: { nombre: string; tecnico: TechnicianWithRelations }[] = [
      { nombre: 'motor exacto declarado', tecnico: makeTechnician({ ...PERFIL_A_FAVOR, id: 'e1', engines: [makeEngineDeclaration('eng-cfm56-7b')] }) },
      { nombre: 'motor exacto por type rating B1', tecnico: conRatingsBajo('e2', [['B1.1', 'fx-b737ng-cfm56-7b']]) },
      { nombre: 'familia declarada', tecnico: makeTechnician({ ...PERFIL_A_FAVOR, id: 'e3', engines: [makeEngineDeclaration('eng-cfm56-5b')] }) },
      { nombre: 'familia por type rating B1', tecnico: conRatingsBajo('e4', [['B1.1', 'fx-a320-cfm56-5b-limpia']]) },
      { nombre: 'motor sin relación declarado (turboeje)', tecnico: makeTechnician({ ...PERFIL_A_FAVOR, id: 'e5', engines: [makeEngineDeclaration('eng-pt6c-67c')] }) },
      { nombre: 'engine_technician sin motores', tecnico: makeTechnician({ ...PERFIL_A_FAVOR, id: 'e6', technicianTypes: ['engine_technician'] }) },
    ];
    const motor = escalones.map(({ tecnico }) => puntuar(oferta, tecnico).breakdown.engine);
    const medido = escalones.map((e, i) => `${e.nombre}=${motor[i]}`).join(' / ');

    assert.ok(motor[0] > motor[1], medido);
    assert.ok(motor[1] > motor[2], medido);
    assert.equal(motor[2], motor[3], `la familia vale lo mismo declarada que por B1: ${medido}`);
    assert.ok(motor[3] > motor[4], medido);
    assert.ok(motor[4] > motor[5], medido);
    assert.equal(motor[5], 3, medido);

    // Y todos entran, así que el ranking sigue exactamente ese orden.
    const ranking = rankTechniciansForOffer(oferta, escalones.map((e) => e.tecnico), RATING_INDEX_MOTORES, ENGINE_INDEX, NOW);
    assert.equal(ranking.length, escalones.length, 'los seis son elegibles');
    assert.deepEqual(ranking.map((s) => s.technicianId).filter((id) => id !== 'e4'), ['e1', 'e2', 'e3', 'e5', 'e6'], 'e3 y e4 empatan y se desempatan por id');
  });

  // ── Forma de la oferta: los CHECK de la 076 y la 077 ──────────────────
  //
  // Esto prueba el ESPEJO en TypeScript. Que Postgres rechace lo mismo lo
  // prueba la propia migración 077 al aplicarse: intenta las filas prohibidas y
  // falla si no las rechazan ESOS constraints (ver su autocomprobación).
  const formaBase = {
    offerKind: 'aircraft' as const,
    requiresCertification: false,
    licenseCode: undefined,
    licenseAuthority: undefined,
    requiredEngineId: undefined,
    onlyUnlicensed: false,
    requiredHabilitations: [] as unknown[],
    acceptedAuthorities: [] as AuthorityCode[],
  };

  await test('Paso 5b · CHECK 077 — oferta de aeronave con motor: rechazada (y el motor sí vale en una de motor)', () => {
    const violaciones = offerShapeViolations({ ...formaBase, requiredEngineId: 'eng-cfm56-7b' });
    assert.ok(violaciones.some((v) => v.includes('Only an engine offer can name an engine')), JSON.stringify(violaciones));
    assert.deepEqual(offerShapeViolations({ ...formaBase, offerKind: 'engine', requiredEngineId: 'eng-cfm56-7b' }), [], 'control: la de motor es válida');
    assert.deepEqual(offerShapeViolations(formaBase), [], 'control: la de aeronave sin motor es válida');
  });

  await test('Paso 5b · CHECK 077 — "sólo sin licencia" con licencia: rechazada, en aeronave y en motor', () => {
    const conLicencia = { ...formaBase, requiresCertification: true, licenseCode: 'B1.1' as const, licenseAuthority: 'EASA' as const };
    assert.deepEqual(offerShapeViolations(conLicencia), [], 'control: licencia sin el filtro es válida');
    assert.ok(offerShapeViolations({ ...conLicencia, onlyUnlicensed: true }).some((v) => v.includes('Only technicians without a licence')));

    // Sin licencia, el filtro vale en las dos clases.
    assert.deepEqual(offerShapeViolations({ ...formaBase, onlyUnlicensed: true }), [], 'aeronave sin licencia + filtro');
    assert.deepEqual(offerShapeViolations({ ...formaBase, offerKind: 'engine', requiredEngineId: 'eng-cfm56-7b', onlyUnlicensed: true }), [], 'motor + filtro');
  });

  await test('Paso 5b · Forma — motor con aeronaves o con licencia que no certifica motor, y autoridad que no emite el código: rechazadas', () => {
    const motor = { ...formaBase, offerKind: 'engine' as const, requiredEngineId: 'eng-cfm56-7b' };
    // Sesión 2 (087): la licencia es opcional en motor, pero sólo B1.x, P o A&P.
    for (const [authority, code] of [['FAA', 'A&P'], ['FAA', 'P'], ['EASA', 'B1.1'], ['UK_CAA', 'B1.3']] as const) {
      assert.deepEqual(offerShapeViolations({ ...motor, requiresCertification: true, licenseCode: code, licenseAuthority: authority }), [], `motor + ${authority} ${code}`);
    }
    for (const [authority, code] of [['EASA', 'B2'], ['EASA', 'C'], ['FAA', 'A']] as const) {
      assert.ok(
        offerShapeViolations({ ...motor, requiresCertification: true, licenseCode: code, licenseAuthority: authority }).some((v) => v.includes('Part-66 B1 licence or an FAA P or A&P')),
        `087: motor + ${authority} ${code}`,
      );
    }
    assert.ok(offerShapeViolations({ ...motor, requiredHabilitations: [{}] }).length > 0, '076: motor con aeronaves');
    assert.ok(offerShapeViolations({ ...motor, requiredEngineId: undefined }).length > 0, '076: motor sin motor');
    const faa = { ...formaBase, requiresCertification: true, licenseCode: 'A&P' as const, licenseAuthority: 'FAA' as const };
    assert.deepEqual(offerShapeViolations(faa), [], 'FAA A&P existe');
    assert.ok(offerShapeViolations({ ...faa, licenseCode: 'B1.1' }).some((v) => v.includes('FAA does not issue a B1.1')));
    assert.ok(offerShapeViolations({ ...faa, licenseAuthority: undefined }).length > 0, '075: licencia sin autoridad');
  });

  // ── Perfil: licencias como credenciales ───────────────────────────────

  await test('Paso 5b · Perfil — quitar la B1.1 EASA no toca la B1.1 UK CAA, ni los códigos, ni el oficio implicado', () => {
    let held = toggleHeldLicense([], 'EASA', 'B1.1');
    held = toggleHeldLicense(held, 'UK_CAA', 'B1.1');
    assert.equal(held.length, 2, 'la misma categoría bajo dos autoridades son dos credenciales');
    assert.deepEqual(heldLicenseCodes(held), ['B1.1'], 'pero un solo código para la implicación de oficio');

    const sinEasa = toggleHeldLicense(held, 'EASA', 'B1.1');
    assert.deepEqual(sinEasa.map((l) => l.authority), ['UK_CAA']);
    assert.ok(holdsLicense(sinEasa, 'UK_CAA', 'B1.1'));
    assert.ok(!holdsLicense(sinEasa, 'EASA', 'B1.1'));
    assert.deepEqual(
      typesAfterLicenseChange(['mechanic'], heldLicenseCodes(held), heldLicenseCodes(sinEasa)),
      ['mechanic'],
      'el oficio sigue implicado por la UK CAA',
    );

    // Las fechas son de cada credencial.
    const conFecha = updateHeldLicenseDates(held, 'UK_CAA', 'B1.1', { expiresAt: '2030-01-01' });
    assert.equal(conFecha.find((l) => l.authority === 'UK_CAA')?.expiresAt, '2030-01-01');
    assert.equal(conFecha.find((l) => l.authority === 'EASA')?.expiresAt, undefined);
  });

  await test('Paso 5b · Perfil — un A&P de la FAA implica mecánico y no admite type ratings', () => {
    assert.deepEqual(typesImpliedByLicenses(['A&P']), ['mechanic']);
    assert.deepEqual(typesImpliedByLicenses(['A']), ['mechanic']);
    assert.deepEqual(typesImpliedByLicenses(['A&P', 'B2']), ['mechanic', 'avionic']);

    const held = sortHeldLicenses([{ authority: 'FAA', code: 'A&P' }, { authority: 'EASA', code: 'B2' }]);
    assert.deepEqual(held.map((l) => l.authority), ['EASA', 'FAA'], 'orden del catálogo de autoridades');
    assert.deepEqual(licensesForHabilitations(held).map((l) => `${l.authority} ${l.code}`), ['EASA B2']);
    assert.deepEqual(licensesForHabilitations([{ authority: 'FAA', code: 'A&P' }]), []);
    assert.equal(heldCountByAuthority(held).FAA, 1);
    assert.equal(heldCountByAuthority(held).UK_CAA, 0);
  });

  // ── Sesión 2: licencia opcional en ofertas de motor ───────────────────

  await test('Sesión 2 · Motor con licencia — FAA P/A&P y Part-66 B1.x se pueden pedir; B2, C y FAA A no', () => {
    const motor = { offerKind: 'engine' as const, technicianType: 'engine_technician' };
    assert.deepEqual(licensesSelectableForOffer(motor, 'FAA'), ['P', 'A&P']);
    for (const authority of PART66_AUTHORITIES) {
      assert.deepEqual(licensesSelectableForOffer(motor, authority), ['B1.1', 'B1.2', 'B1.3', 'B1.4'], authority);
    }
    // Sin licencia sigue siendo válida, y la de aeronave no cambia.
    assert.doesNotThrow(() => makeEngineOffer('eng-cfm56-7b'));
    assert.doesNotThrow(() => makeEngineOffer('eng-cfm56-7b', { requiresCertification: true, licenseCode: 'A&P', licenseAuthority: 'FAA' }));
    assert.doesNotThrow(() => makeEngineOffer('eng-cfm56-7b', { requiresCertification: true, licenseCode: 'B1.1', licenseAuthority: 'EASA' }));
    for (const [authority, code] of [['EASA', 'B2'], ['EASA', 'C'], ['FAA', 'A']] as const) {
      assert.throws(() => makeEngineOffer('eng-cfm56-7b', { requiresCertification: true, licenseCode: code, licenseAuthority: authority }), /Part-66 B1 licence/, `${authority} ${code}`);
    }
  });

  await test('Sesión 2 · Motor con licencia — el motor sigue pesando más; la licencia puntúa y no topa', () => {
    const conLicencia = makeEngineOffer('eng-cfm56-7b', { requiresCertification: true, licenseCode: 'A&P', licenseAuthority: 'FAA' });
    const pesos = getMatchScoreWeights(conLicencia);
    assert.deepEqual(pesos, { verified: 15, habilitation: 0, license: 20, contractFit: 15, location: 5, engine: 45 });
    assert.equal(sumaPesos(pesos), 100);
    assert.ok(pesos.engine > pesos.license, 'el motor es el eje con más peso');
    assert.deepEqual(getMatchScoreWeights(makeEngineOffer('eng-cfm56-7b')).engine, 65, 'sin licencia, igual que antes');

    const aYp = () => makeLicense('A&P', { authority: 'FAA' });
    const todo = puntuar(conLicencia, makeTechnician({ ...PERFIL_MOTOR, licenses: [aYp()], engines: [makeEngineDeclaration('eng-cfm56-7b')] }));
    assert.equal(todo.total, 100, 'motor exacto y licencia');

    const motorSinLicencia = makeTechnician({ ...PERFIL_MOTOR, id: 'motor-sin-licencia', engines: [makeEngineDeclaration('eng-cfm56-7b')] });
    const r = puntuar(conLicencia, motorSinLicencia);
    assert.equal(r.total, 80, 'sin licencia no hay tope: 100 - 20');
    assert.deepEqual(r.missingRequirements, [], 'la licencia de un motor no es un requisito incumplido');
    assert.ok(r.clarifications.some((c) => c.includes('never excludes')), JSON.stringify(r.clarifications));
    assert.equal(elegible(conLicencia, motorSinLicencia), true, 'puntúa, no excluye');

    // Y la licencia no abre la puerta: un A&P sin nada de motor sigue fuera.
    assert.equal(elegible(conLicencia, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [aYp()] })), false);
  });

  await test('Sesión 2 · Motor con licencia — motor exacto sin licencia queda por encima de licencia con motor sin relación', () => {
    for (const [authority, code] of [['FAA', 'A&P'], ['EASA', 'B1.1']] as const) {
      const oferta = makeEngineOffer('eng-cfm56-7b', { requiresCertification: true, licenseCode: code, licenseAuthority: authority });
      const motorExacto = makeTechnician({ ...PERFIL_MOTOR, id: 'a-motor-exacto', engines: [makeEngineDeclaration('eng-cfm56-7b')] });
      const licencia = makeLicense(code, { authority });
      // Los dos "motor sin relación" de la escalera: otro turbofán y un turboeje.
      for (const otro of ['eng-v2500-a5', 'eng-pt6c-67c']) {
        const licenciaYOtroMotor = makeTechnician({ ...PERFIL_MOTOR, id: 'b-licencia', licenses: [licencia], engines: [makeEngineDeclaration(otro)] });
        const a = puntuar(oferta, motorExacto);
        const b = puntuar(oferta, licenciaYOtroMotor);
        assert.ok(b.breakdown.license > 0, `${authority} ${code}: la licencia cuenta (${b.breakdown.license})`);
        assert.ok(a.total > b.total, `${authority} ${code} / ${otro}: motor exacto (${a.total}) > licencia + motor sin relación (${b.total})`);
        const ranking = rankTechniciansForOffer(oferta, [licenciaYOtroMotor, motorExacto], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW);
        assert.deepEqual(ranking.map((s) => s.technicianId), ['a-motor-exacto', 'b-licencia']);
      }
    }
  });

  await test('Paso 5b · Escalera — B1 con 737NG queda por encima de quien declara un motor sin relación', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const b1Con737 = conRatingsBajo('tech-z-b1-737', [['B1.1', 'fx-b737ng-cfm56-7b']]);
    // Id que ordena ANTES, para que el orden no pueda salir del desempate.
    const sinRelacion = makeTechnician({ ...PERFIL_A_FAVOR, id: 'tech-a-sin-relacion', engines: [makeEngineDeclaration('eng-pt6c-67c')] });
    const mismoTipo = makeTechnician({ ...PERFIL_A_FAVOR, id: 'tech-a-mismo-tipo', engines: [makeEngineDeclaration('eng-v2500-a5')] });

    const ranking = rankTechniciansForOffer(oferta, [sinRelacion, mismoTipo, b1Con737], RATING_INDEX_MOTORES, ENGINE_INDEX, NOW);
    assert.equal(ranking[0].technicianId, 'tech-z-b1-737', `ranking: ${ranking.map((s) => `${s.technicianId}=${s.total}`).join(', ')}`);
    assert.ok(ranking[0].total > ranking[1].total);
  });

  await test('Paso 5a · Elegibilidad de motor — los dos filtros se suman: "sólo sin licencia" no rescata a quien no tiene motores', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b', { onlyUnlicensed: true });
    const sinLicenciaNiMotores = makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['painter'] });
    const sinLicenciaConMotor = makeTechnician({ ...PERFIL_A_FAVOR, technicianTypes: ['painter'], engines: [makeEngineDeclaration('eng-cfm56-7b')] });
    const conLicenciaYMotor = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('B1.1')], engines: [makeEngineDeclaration('eng-cfm56-7b')] });

    assert.equal(elegible(oferta, sinLicenciaNiMotores), false, 'cumple "sin licencia" pero no tiene nada de motor');
    assert.equal(elegible(oferta, sinLicenciaConMotor), true);
    assert.equal(elegible(oferta, conLicenciaYMotor), false, 'tiene motor pero tiene licencia');
  });

  // ── Envoltorios (matchingService) ─────────────────────────────────────
  //
  // Un servicio montado con cargadores falsos. La pregunta de estos tests es
  // una sola: ¿pasar por getTechnicianMatchesForOffer / getOfferMatchesForTechnician
  // da lo mismo que llamar a rankTechniciansForOffer / rankOffersForTechnician
  // con los catálogos cargados? Cualquier diferencia es lógica duplicada.

  const b11Servicio = makeLicense('B1.1', { id: 'lic-servicio-b11' });
  const b12Servicio = makeLicense('B1.2', { id: 'lic-servicio-b12' });
  const tecnicosServicio: TechnicianWithRelations[] = [
    // Aeronave: A320 exacto.
    makeTechnician({
      ...PERFIL_A_FAVOR,
      id: 'svc-b11-a320',
      licenses: [b11Servicio],
      habilitations: [makeHabOn(b11Servicio, { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    }),
    // Motor exacto declarado, CON licencia: el que "sólo sin licencia" saca.
    makeTechnician({ ...PERFIL_A_FAVOR, id: 'svc-b2-cfm567b', technicianTypes: ['avionic'], licenses: [makeLicense('B2')], engines: [makeEngineDeclaration('eng-cfm56-7b')] }),
    // Misma familia, sin licencia. Sin engineIndex caería a "tipo distinto":
    // es la prueba de que el envoltorio pasa el catálogo de motores.
    makeTechnician({ ...PERFIL_A_FAVOR, id: 'svc-familia-cfm565b', technicianTypes: ['painter'], engines: [makeEngineDeclaration('eng-cfm56-5b')] }),
    // engine_technician sin motores: elegible, 3 puntos.
    makeTechnician({ ...PERFIL_A_FAVOR, id: 'svc-motor-sin-motores', technicianTypes: ['engine_technician'] }),
    // B1 sin motores: no elegible en ofertas de motor.
    makeTechnician({ ...PERFIL_A_FAVOR, id: 'svc-b1-sin-motores', licenses: [makeLicense('B1.1')] }),
    // Rating colgado de un motor GENÉRICO inactivo: su crédito de familia sólo
    // existe si el envoltorio carga también los inactivos.
    makeTechnician({
      ...PERFIL_A_FAVOR,
      id: 'svc-pa28-generica',
      technicianTypes: ['mechanic', 'engine_technician'],
      licenses: [b12Servicio],
      habilitations: [makeHabOn(b12Servicio, { aircraftTypeRatingId: 'fx-pa28-lycoming-generica' })],
    }),
  ];
  const ofertasServicio: OfferWithRequirements[] = [
    makeOffer({ id: 'svc-offer-a320', minYearsExperience: 3, requiredHabilitations: [makeHabReq('fx-a320-cfm56')] }),
    makeEngineOffer('eng-cfm56-7b', { id: 'svc-offer-cfm567b' }),
    makeEngineOffer('eng-cfm56-7b', { id: 'svc-offer-cfm567b-sin-licencia', onlyUnlicensed: true }),
    makeEngineOffer('eng-lycoming-o360', { id: 'svc-offer-o360' }),
  ];

  // La vista anonimizada, marcada para poder comprobar que cada score vuelve
  // pegado a SU técnico y no al de al lado.
  const previewDe = (t: TechnicianWithRelations) =>
    ({ id: t.id, anonymousCode: `ANON-${t.id}` }) as unknown as SafeTechnicianPreview;

  const montarServicio = (failCatalog?: 'ratings' | 'engines') => {
    const minYearsPedidos: number[] = [];
    const service = createMatchingService({
      getOfferWithRequirements: async (id) => ofertasServicio.find((o) => o.id === id) ?? null,
      getPublishedOffersWithRequirements: async () => ofertasServicio,
      getMatchCandidates: async (minYears) => {
        minYearsPedidos.push(minYears);
        return tecnicosServicio.map((t) => ({ technician: t, preview: previewDe(t) }));
      },
      getTechnicianWithRelations: async (id) => tecnicosServicio.find((t) => t.id === id) ?? null,
      getAircraftTypeRatings: async () => {
        if (failCatalog === 'ratings') throw new Error('ratings unavailable');
        return [...FIXTURES, ...ENGINE_RATING_FIXTURES];
      },
      // El catálogo ENTERO, con la genérica inactiva: es lo que devuelve
      // catalogRepository.getEngines().
      getEngines: async () => {
        if (failCatalog === 'engines') throw new Error('engines unavailable');
        return ENGINE_FIXTURES;
      },
      now: () => NOW,
    });
    return { service, minYearsPedidos };
  };

  await test('H13 — búsqueda falla sin catálogos y nunca publica resultados sin comprobar', async () => {
    const source = tecnicosServicio.map((t) => ({ id: t.id }));
    const offer = ofertasServicio[2]; // motor + sólo sin licencia
    const getTech = async (id: string) => tecnicosServicio.find((t) => t.id === id) ?? null;
    for (const catalog of ['ratings', 'engines'] as const) {
      const { service } = montarServicio(catalog);
      await assert.rejects(loadSearchOfferResults(source, offer, getTech, service.matchPairs), new RegExp(`${catalog} unavailable`));
    }
    assert.deepEqual(visibleSearchResults(source, offer.id, offer, null), [], 'cargando/error: ninguna fila');
    assert.deepEqual(visibleSearchResults(source, offer.id, null, null), [], 'la oferta preseleccionada aún no ha cargado');
    const { service } = montarServicio();
    const snapshot = await loadSearchOfferResults(source, offer, getTech, service.matchPairs);
    const expected = rankTechniciansForOffer(offer, tecnicosServicio, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW);
    assert.deepEqual(visibleSearchResults(source, offer.id, offer, snapshot).map((t) => t.id), expected.map((s) => s.technicianId));
    assert.ok(snapshot.visible.length > 0 && snapshot.visible.length < source.length, 'el reintento recupera solo los elegibles');
    assert.deepEqual(visibleSearchResults([...source], offer.id, offer, snapshot), [], 'otra búsqueda: snapshot antiguo no vale');
    assert.deepEqual(visibleSearchResults(source, offer.id, { ...offer }, snapshot), [], 'otra revisión de oferta no vale');
    assert.equal(visibleSearchResults(source, null, null, null), source, 'búsqueda general sin oferta conserva sus resultados');
    await assert.rejects(loadSearchOfferResults(source, offer, async () => null, service.matchPairs), /qualifications/);
    await assert.rejects(loadSearchOfferResults(source, offer, getTech, async () => []), /Incomplete/);
  });

  await test('Paso 5a · Envoltorios — oferta→técnicos da exactamente lo mismo que rankTechniciansForOffer (aeronave, motor y "sólo sin licencia")', async () => {
    const { service, minYearsPedidos } = montarServicio();

    for (const oferta of ofertasServicio) {
      const resultados = await service.getTechnicianMatchesForOffer(oferta.id);
      const directo = rankTechniciansForOffer(oferta, tecnicosServicio, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW);

      assert.deepEqual(resultados.map((r) => r.score), directo, `${oferta.id}: mismos scores, mismo orden`);
      for (const { technician, score } of resultados) {
        assert.equal(technician.id, score.technicianId, `${oferta.id}: la vista vuelve pegada a su score`);
        assert.equal(technician.anonymousCode, `ANON-${score.technicianId}`);
        const tecnico = tecnicosServicio.find((t) => t.id === score.technicianId)!;
        assert.deepEqual(score, calculateOfferTechnicianMatch(oferta, tecnico, RATING_INDEX_MOTORES, NOW, ENGINE_INDEX), `${oferta.id} / ${tecnico.id}`);
      }
      assert.deepEqual(
        resultados.map((r) => r.score.technicianId).sort(),
        tecnicosServicio.filter((t) => elegible(oferta, t)).map((t) => t.id).sort(),
        `${oferta.id}: aparecen exactamente los elegibles`,
      );
    }

    // Contrastes: sin ellos, un envoltorio que no pasara el catálogo de motores
    // o que no filtrara podría seguir en verde.
    const motor = await service.getTechnicianMatchesForOffer('svc-offer-cfm567b');
    const familia = motor.find((r) => r.score.technicianId === 'svc-familia-cfm565b')!;
    const tecnicoFamilia = tecnicosServicio.find((t) => t.id === 'svc-familia-cfm565b')!;
    const sinCatalogo = calculateOfferTechnicianMatch(ofertasServicio[1], tecnicoFamilia, RATING_INDEX_MOTORES, NOW);
    assert.ok(familia.score.breakdown.engine > sinCatalogo.breakdown.engine, `con engineIndex la familia puntúa (${familia.score.breakdown.engine} vs ${sinCatalogo.breakdown.engine} sin él)`);
    assert.ok(!motor.some((r) => r.score.technicianId === 'svc-b1-sin-motores'), 'el B1 sin motores no aparece');
    assert.equal(motor.find((r) => r.score.technicianId === 'svc-motor-sin-motores')?.score.breakdown.engine, 3);

    const soloSinLicencia = await service.getTechnicianMatchesForOffer('svc-offer-cfm567b-sin-licencia');
    assert.ok(!soloSinLicencia.some((r) => r.score.technicianId === 'svc-b2-cfm567b'), 'el licenciado con el motor exacto queda fuera');
    assert.ok(motor.some((r) => r.score.technicianId === 'svc-b2-cfm567b'), 'y en la oferta abierta sí está');

    const o360 = await service.getTechnicianMatchesForOffer('svc-offer-o360');
    const generica = o360.find((r) => r.score.technicianId === 'svc-pa28-generica')!;
    const tecnicoGenerica = tecnicosServicio.find((t) => t.id === 'svc-pa28-generica')!;
    const soloActivos = calculateOfferTechnicianMatch(
      ofertasServicio[3],
      tecnicoGenerica,
      RATING_INDEX_MOTORES,
      NOW,
      buildEngineIndex(ENGINE_FIXTURES.filter((e) => e.isActive)),
    );
    assert.ok(generica.score.breakdown.engine > soloActivos.breakdown.engine, `la genérica inactiva da crédito de familia (${generica.score.breakdown.engine} vs ${soloActivos.breakdown.engine} con sólo activos)`);

    // El filtro duro de años viaja a la consulta con el valor de la oferta.
    assert.ok(minYearsPedidos.includes(3), `minYearsExperience de la oferta llega al cargador, pidió ${JSON.stringify(minYearsPedidos)}`);
  });

  await test('Paso 5a · Envoltorios — técnico→ofertas da exactamente lo mismo que rankOffersForTechnician, y coincide con la otra dirección', async () => {
    const { service } = montarServicio();

    for (const tecnico of tecnicosServicio) {
      const resultados = await service.getOfferMatchesForTechnician(tecnico.id);
      const directo = rankOffersForTechnician(tecnico, ofertasServicio, RATING_INDEX_MOTORES, ENGINE_INDEX, NOW);
      assert.deepEqual(resultados.map((r) => r.score), directo, `${tecnico.id}: mismos scores, mismo orden`);
      for (const { offer, score } of resultados) assert.equal(offer.id, score.offerId, `${tecnico.id}: la oferta vuelve pegada a su score`);

      // Las dos direcciones, a través de los envoltorios: mismo par, misma
      // visibilidad, mismo score.
      for (const oferta of ofertasServicio) {
        const desdeTecnico = resultados.find((r) => r.offer.id === oferta.id);
        const desdeOferta = (await service.getTechnicianMatchesForOffer(oferta.id)).find((r) => r.technician.id === tecnico.id);
        assert.equal(Boolean(desdeTecnico), Boolean(desdeOferta), `visibilidad ${tecnico.id} / ${oferta.id}`);
        if (desdeTecnico && desdeOferta) assert.deepEqual(desdeTecnico.score, desdeOferta.score, `score ${tecnico.id} / ${oferta.id}`);
      }
    }

    // Contrastes con el filtro activo.
    const b2 = (await service.getOfferMatchesForTechnician('svc-b2-cfm567b')).map((r) => r.offer.id);
    assert.ok(!b2.includes('svc-offer-cfm567b-sin-licencia'), 'el licenciado no ve la oferta "sólo sin licencia"');
    assert.ok(b2.includes('svc-offer-cfm567b'));
    const b1 = (await service.getOfferMatchesForTechnician('svc-b1-sin-motores')).map((r) => r.offer.id);
    assert.deepEqual(b1, ['svc-offer-a320'], 'el B1 sin motores sólo ve la de aeronave');
  });

  await test('Paso 5b · Envoltorios — matchPairs (las pantallas de un par) dice lo mismo que las dos listas, par a par', async () => {
    const { service } = montarServicio();
    const pares = ofertasServicio.flatMap((offer) => tecnicosServicio.map((technician) => ({ offer, technician })));
    const resultados = await service.matchPairs(pares);
    assert.equal(resultados.length, pares.length, 'un resultado por par, en orden');

    for (let i = 0; i < pares.length; i += 1) {
      const { offer, technician } = pares[i];
      const r = resultados[i];
      const enLista = (await service.getTechnicianMatchesForOffer(offer.id)).find((m) => m.technician.id === technician.id);
      assert.equal(r.eligible, Boolean(enLista), `visibilidad ${offer.id} / ${technician.id}`);
      if (r.eligible) {
        assert.deepEqual(r.score, enLista!.score, `score ${offer.id} / ${technician.id}`);
      } else {
        assert.equal('score' in r, false, 'la variante no elegible no lleva score');
      }
    }

    // Los motivos: el B1 sin motores en la de motor, el licenciado en la de sólo sin licencia.
    const motivo = (offerId: string, techId: string) => {
      const i = pares.findIndex((p) => p.offer.id === offerId && p.technician.id === techId);
      const r = resultados[i];
      return r.eligible ? null : r.reason;
    };
    assert.equal(motivo('svc-offer-cfm567b', 'svc-b1-sin-motores'), 'no_engine_experience');
    assert.equal(motivo('svc-offer-cfm567b-sin-licencia', 'svc-b2-cfm567b'), 'licensed_technician');
    assert.equal(motivo('svc-offer-a320', 'svc-b1-sin-motores'), null, 'la de aeronave no filtra');
    assert.deepEqual(await service.matchPairs([]), []);
  });

  await test('Paso 5a · Envoltorios — oferta o técnico inexistentes devuelven lista vacía', async () => {
    const { service } = montarServicio();
    assert.deepEqual(await service.getTechnicianMatchesForOffer('no-existe'), []);
    assert.deepEqual(await service.getOfferMatchesForTechnician('no-existe'), []);
  });

  // ── Caché del catálogo de motores ─────────────────────────────────────

  await test('Paso 5a · Caché de motores — guarda también las inactivas y sirve dentro del TTL sin volver a pedir', async () => {
    let calls = 0;
    let clock = 0;
    const cache = createEnginesCache({
      fetchAll: async () => {
        calls += 1;
        return ENGINE_FIXTURES;
      },
      ttlMs: 1000,
      now: () => clock,
    });
    const primera = await cache.getEngines();
    assert.ok(primera.some((e) => !e.isActive), 'la genérica inactiva viaja con el catálogo');
    assert.equal(primera.length, ENGINE_FIXTURES.length);
    await cache.getEngines();
    assert.equal(calls, 1, 'dentro del TTL no se vuelve a pedir');
    clock = 1001;
    await cache.getEngines();
    assert.equal(calls, 2, 'pasado el TTL, sí');
    cache.invalidate();
    await cache.getEngines();
    assert.equal(calls, 3, 'invalidate() fuerza la siguiente');
  });

  await test('Paso 5a · Caché de motores — un refresco fallido sigue sirviendo el último catálogo; sin catálogo previo, error y reintento', async () => {
    let clock = 0;
    let falla = false;
    const cache = createEnginesCache({
      fetchAll: async () => {
        if (falla) throw new Error('red caída');
        return ENGINE_FIXTURES;
      },
      ttlMs: 1000,
      now: () => clock,
    });
    await cache.getEngines();
    falla = true;
    clock = 5000;
    assert.equal((await cache.getEngines()).length, ENGINE_FIXTURES.length, 'se sigue sirviendo el catálogo bueno');
    assert.equal(cache.getState().status, 'success');
    assert.equal(cache.getState().error?.message, 'red caída', 'con el error anotado');

    const vacia = createEnginesCache({
      fetchAll: async () => {
        if (falla) throw new Error('red caída');
        return ENGINE_FIXTURES;
      },
    });
    await assert.rejects(() => vacia.getEngines(), /red caída/);
    assert.equal(vacia.getState().status, 'error');
    falla = false;
    assert.equal((await vacia.getEngines()).length, ENGINE_FIXTURES.length, 'el siguiente intento se recupera');
  });

  await test('Paso 5a · Caché de motores — las llamadas concurrentes comparten una sola petición', async () => {
    let calls = 0;
    const cache = createEnginesCache({
      fetchAll: async () => {
        calls += 1;
        return ENGINE_FIXTURES;
      },
    });
    await Promise.all([cache.getEngines(), cache.getEngines(), cache.getEngines()]);
    assert.equal(calls, 1);
  });

  // ── Cierre de Fase 10 · el desglose no pinta filas con máximo 0 ─────────
  //
  // Los seis componentes existen siempre en `MatchScore.breakdown`, pero los
  // pesos de la oferta dejan a 0 el máximo de los ejes que esa oferta NO pide.
  // Pintarlos daba "Habilitation 0/0" en una oferta de motor, que se lee como
  // nota baja y no lo es.

  await test('Desglose · una oferta de motor no pinta habilitación (máximo 0) y sí pinta motor', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b');
    const filas = visibleBreakdownRows(getMatchScoreWeights(oferta));
    const claves = filas.map((f) => f.key);
    assert.ok(!claves.includes('habilitation'), 'habilitation tiene máximo 0 en una oferta de motor');
    assert.ok(!claves.includes('license'), 'sin licencia pedida, license también vale 0');
    assert.ok(claves.includes('engine'), 'el eje que la oferta SÍ pide se pinta');
  });

  await test('Desglose · la oferta de motor con licencia recupera la fila de licencia, nunca la de habilitación', () => {
    const oferta = makeEngineOffer('eng-cfm56-7b', { requiresCertification: true, licenseCode: 'B1.1' });
    const claves = visibleBreakdownRows(getMatchScoreWeights(oferta)).map((f) => f.key);
    assert.ok(claves.includes('license'), 'la licencia opcional de la sesión 2 puntúa, luego se pinta');
    assert.ok(claves.includes('engine'));
    assert.ok(!claves.includes('habilitation'), 'una oferta de motor nunca pide type ratings');
  });

  await test('Desglose · una oferta de aeronave no pinta la fila de motor', () => {
    const oferta = makeOffer({ requiredHabilitations: [makeHabReq('rating-a320')] });
    const claves = visibleBreakdownRows(getMatchScoreWeights(oferta)).map((f) => f.key);
    assert.ok(!claves.includes('engine'), 'el eje de motor sólo puntúa en ofertas de motor');
    assert.ok(claves.includes('habilitation'));
    assert.ok(claves.includes('license'));
  });

  await test('Desglose · una oferta sin requisitos de cualificación no pinta ninguno de los tres ejes', () => {
    const oferta = makeOffer({ requiresCertification: false, licenseCode: undefined, requiredHabilitations: [] });
    const claves = visibleBreakdownRows(getMatchScoreWeights(oferta)).map((f) => f.key);
    assert.deepEqual(claves, ['verified', 'contractFit', 'location']);
  });

  await test('Desglose · ninguna fila visible tiene máximo 0, en ninguna forma de oferta', () => {
    const ofertas: OfferWithRequirements[] = [
      makeOffer({ requiredHabilitations: [makeHabReq('rating-a320')] }),
      makeOffer({ requiredHabilitations: [] }),
      makeOffer({ licenseAuthority: 'FAA', licenseCode: 'A&P', requiredHabilitations: [makeHabReq('rating-a320')] }),
      makeOffer({ requiresCertification: false, licenseCode: undefined, requiredHabilitations: [makeHabReq('rating-a320')] }),
      makeOffer({ requiresCertification: false, licenseCode: undefined, requiredHabilitations: [] }),
      makeEngineOffer('eng-cfm56-7b'),
      makeEngineOffer('eng-cfm56-7b', { requiresCertification: true, licenseCode: 'B1.1' }),
    ];
    for (const oferta of ofertas) {
      const pesos = getMatchScoreWeights(oferta);
      const filas = visibleBreakdownRows(pesos);
      assert.ok(filas.length > 0, 'siempre queda algo que pintar');
      for (const fila of filas) {
        assert.ok(fila.max > 0, `${fila.key} no debería pintarse con máximo 0`);
        assert.equal(fila.max, pesos[fila.key], 'el máximo de la fila es el peso real, no un número escrito a mano');
      }
    }
  });

  await test('Desglose · sin pesos no se pinta nada, y cada orden conserva el suyo', () => {
    assert.deepEqual(visibleBreakdownRows(null), [], 'sin oferta no hay denominador que enseñar');
    assert.deepEqual(visibleBreakdownRows(undefined), []);
    const pesos = getMatchScoreWeights(makeOffer({ requiredHabilitations: [makeHabReq('rating-a320')] }));
    assert.deepEqual(
      visibleBreakdownRows(pesos, VERIFIED_FIRST_ORDER).map((f) => f.key),
      ['verified', 'habilitation', 'license', 'contractFit', 'location'],
    );
    assert.deepEqual(
      visibleBreakdownRows(pesos, QUALIFICATION_FIRST_ORDER).map((f) => f.key),
      ['habilitation', 'license', 'verified', 'contractFit', 'location'],
    );
    assert.equal(visibleBreakdownRows(pesos)[1].label, 'Habilitation', 'el rótulo sale del helper, no de la pantalla');
  });

  // ── Cierre de Fase 10 · "no la tienes" vs "no la acepto" ───────────────
  //
  // Con la misma categoría de otra autoridad, el perfil SÍ tiene la licencia:
  // lo que no la acepta es esta oferta. Decirlo cambia quién tiene que hacer
  // algo — la empresa puede marcar esa autoridad en "Also accept licences
  // from:"; el técnico no tiene nada que sacarse.

  const TEXTO_UK_NO_ACEPTADA =
    'The offer asks for EASA B1.1. The profile holds UK CAA B1.1, which this offer doesn\'t accept.';

  await test('Autoridad no aceptada · oferta de aeronave — se nombra la licencia que tiene, no "not present in the profile"', () => {
    const r = puntuar(ofertaA320('EASA', { acceptedAuthorities: [] }), conA320Bajo('UK_CAA'));
    assert.ok(
      r.clarifications.includes(TEXTO_UK_NO_ACEPTADA),
      `falta el aviso de autoridad; clarifications=${JSON.stringify(r.clarifications)}`,
    );
    assert.equal(r.breakdown.license, 0, 'sigue sin puntuar: explicar no es aceptar');
  });

  await test('Autoridad no aceptada · oferta de sólo licencia — el requisito dice cuál tiene y que no se acepta', () => {
    const oferta = makeOffer({ licenseAuthority: 'EASA', licenseCode: 'B1.1', requiredHabilitations: [], acceptedAuthorities: [] });
    const uk = makeLicense('B1.1', { authority: 'UK_CAA' });
    const r = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [uk] }));
    assert.ok(r.missingRequirements.includes(TEXTO_UK_NO_ACEPTADA), JSON.stringify(r.missingRequirements));
    assert.ok(
      !r.missingRequirements.some((m) => m === 'Required license: B1.1'),
      'el texto genérico no se acumula con el específico',
    );
  });

  await test('Autoridad no aceptada · oferta de motor — el aviso conserva la coletilla de que la licencia no excluye', () => {
    const oferta = makeEngineOffer(ENGINE_FIXTURES[0].id, {
      requiresCertification: true, licenseCode: 'B1.1', licenseAuthority: 'EASA', acceptedAuthorities: [],
    });
    const uk = makeLicense('B1.1', { authority: 'UK_CAA' });
    const tecnico = makeTechnician({
      ...PERFIL_MOTOR,
      licenses: [uk],
      engines: [makeEngineDeclaration(ENGINE_FIXTURES[0].id)],
    });
    const r = puntuar(oferta, tecnico);
    const aviso = r.clarifications.find((c) => c.startsWith(TEXTO_UK_NO_ACEPTADA));
    assert.ok(aviso, JSON.stringify(r.clarifications));
    assert.ok(
      aviso.includes('it never excludes'),
      'en una oferta de motor la licencia puntúa y no topa: eso se sigue diciendo',
    );
    assert.ok(
      !r.clarifications.some((c) => c.includes('not present in the profile')),
      'el texto viejo desaparece cuando sí tiene la categoría',
    );
  });

  await test('Autoridad no aceptada · sin ninguna licencia en el perfil se mantiene el texto genérico', () => {
    const oferta = makeOffer({ licenseAuthority: 'EASA', licenseCode: 'B1.1', requiredHabilitations: [], acceptedAuthorities: [] });
    const r = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR }));
    assert.deepEqual(r.missingRequirements, ['Required license: B1.1']);
  });

  await test('Autoridad no aceptada · si la oferta SÍ acepta esa autoridad no hay nada que avisar', () => {
    const r = puntuar(ofertaA320('EASA', { acceptedAuthorities: EQUIVALENTES_EASA_B11 }), conA320Bajo('UK_CAA'));
    assert.ok(
      !r.clarifications.some((c) => c.includes("doesn't accept")),
      JSON.stringify(r.clarifications),
    );
    assert.ok(r.breakdown.license > 0, 'la equivalente aceptada puntúa');
  });

  await test('Autoridad no aceptada · una credencial elegible de otra autoridad aceptada gana al aviso', () => {
    const uk = makeLicense('B1.1', { id: 'lic-uk', authority: 'UK_CAA' });
    const gcaa = makeLicense('B1.1', { id: 'lic-gcaa', authority: 'GCAA' });
    const oferta = ofertaA320('EASA', { acceptedAuthorities: ['GCAA'] });
    const tecnico = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [uk, gcaa],
      habilitations: [makeHabOn(gcaa, { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const r = puntuar(oferta, tecnico);
    assert.ok(
      !r.clarifications.some((c) => c.includes("doesn't accept")),
      'con credencial elegida no hay nada que explicar, aunque sobre una descartada',
    );
  });

  await test('Autoridad no aceptada · la caducidad de la autoridad correcta gana al aviso de autoridad', () => {
    const easaCaducada = makeLicense('B1.1', { id: 'lic-easa', authority: 'EASA', expiresAt: '2026-01-01' });
    const uk = makeLicense('B1.1', { id: 'lic-uk', authority: 'UK_CAA' });
    const oferta = makeOffer({ licenseAuthority: 'EASA', licenseCode: 'B1.1', requiredHabilitations: [], acceptedAuthorities: [] });
    const r = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [easaCaducada, uk] }));
    assert.deepEqual(r.missingRequirements, ['B1.1 — expired'], 'renovar la EASA es la acción, no cambiar de autoridad');
  });

  await test('Autoridad no aceptada · entre varias descartadas se nombra una sola, y la vigente antes que la caducada', () => {
    const ukCaducada = makeLicense('B1.1', { id: 'lic-a-uk', authority: 'UK_CAA', expiresAt: '2026-01-01' });
    const casaVigente = makeLicense('B1.1', { id: 'lic-z-casa', authority: 'CASA' });
    const oferta = makeOffer({ licenseAuthority: 'EASA', licenseCode: 'B1.1', requiredHabilitations: [], acceptedAuthorities: [] });
    const r = puntuar(oferta, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [ukCaducada, casaVigente] }));
    assert.deepEqual(r.missingRequirements, [
      'The offer asks for EASA B1.1. The profile holds CASA (Australia) B1.1, which this offer doesn\'t accept.',
    ]);
  });

  // ── Ajustes finales de Fase 10 · la AERONAVE bajo otra autoridad ────────
  //
  // El aviso de licencia ya distinguía "no la tienes" de "no la acepto"; la
  // línea de la aeronave seguía diciendo "not present in the profile" de un
  // A320 que el perfil sí tiene, colgado de una UK CAA B1.1.

  const A320 = getAircraftTypeRatingLabel('fx-a320-cfm56', RATING_INDEX_MOTORES);
  const TEXTO_A320_BAJO_UK = `the profile holds ${A320} under UK CAA B1.1, which this offer doesn't accept`;

  await test('Aeronave bajo autoridad no aceptada · "basta con una" — nombra la credencial, no "not present in the profile"', () => {
    const r = puntuar(ofertaA320('EASA', { acceptedAuthorities: [] }), conA320Bajo('UK_CAA'));
    assert.ok(
      r.clarifications.includes(`The offer also lists B1.1 + ${A320}; ${TEXTO_A320_BAJO_UK}`),
      JSON.stringify(r.clarifications),
    );
    assert.ok(!r.clarifications.some((c) => c.includes('not present in the profile')), JSON.stringify(r.clarifications));
  });

  await test('Aeronave bajo autoridad no aceptada · "todas" — el requisito incumplido lo dice, y el techo no se mueve', () => {
    const oferta = ofertaA320('EASA', { acceptedAuthorities: [], requiresAllAircraft: true });
    const r = puntuar(oferta, conA320Bajo('UK_CAA'));
    assert.deepEqual(r.missingRequirements, [`B1.1 + ${A320} — ${TEXTO_A320_BAJO_UK}`]);
    // Contraste: la misma UK CAA B1.1 SIN el A320 puntúa igual. El texto
    // explica; no convierte el rating descartado en evidencia.
    const sinRating = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('B1.1', { authority: 'UK_CAA' })] });
    const contraste = puntuar(oferta, sinRating);
    assert.deepEqual(contraste.missingRequirements, [`B1.1 + ${A320}`], 'sin el rating el texto de siempre');
    assert.equal(r.total, contraste.total);
    assert.deepEqual(r.breakdown, contraste.breakdown);
  });

  await test('Aeronave bajo autoridad no aceptada · también con otra credencial elegida que no lleva ese rating', () => {
    const easa = makeLicense('B1.1', { id: 'lic-easa', authority: 'EASA' });
    const uk = makeLicense('B1.1', { id: 'lic-uk', authority: 'UK_CAA' });
    const tecnico = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [easa, uk],
      habilitations: [makeHabOn(uk, { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const r = puntuar(ofertaA320('EASA', { acceptedAuthorities: [] }), tecnico);
    assert.ok(r.breakdown.license > 0, 'la EASA B1.1 sí cuenta como licencia');
    assert.ok(
      r.clarifications.includes(`The offer also lists B1.1 + ${A320}; ${TEXTO_A320_BAJO_UK}`),
      JSON.stringify(r.clarifications),
    );
  });

  await test('Aeronave bajo autoridad no aceptada · sin el rating en ninguna licencia se queda el texto de siempre', () => {
    const tecnico = makeTechnician({ ...PERFIL_A_FAVOR, licenses: [makeLicense('B1.1', { authority: 'UK_CAA' })] });
    const r = puntuar(ofertaA320('EASA', { acceptedAuthorities: [] }), tecnico);
    assert.ok(
      r.clarifications.includes(`The offer also lists B1.1 + ${A320}; not present in the profile`),
      JSON.stringify(r.clarifications),
    );
  });

  // ── Ajustes finales de Fase 10 · el recorte por equivalencia, dicho ──────

  const TEXTO_EQUIVALENTE_UK =
    'Accepted via equivalent authority: the profile holds UK CAA B1.1; the offer asks for EASA B1.1.';

  await test('Autoridad equivalente · oferta de aeronave — el 87 lleva la línea que lo explica', () => {
    const r = puntuar(ofertaA320('EASA', { acceptedAuthorities: EQUIVALENTES_EASA_B11 }), conA320Bajo('UK_CAA'));
    assert.equal(r.total, 87);
    assert.equal(r.authorityEquivalence, TEXTO_EQUIVALENTE_UK);
  });

  await test('Autoridad equivalente · con la autoridad exacta no hay línea (y el campo ni existe)', () => {
    const r = puntuar(ofertaA320('EASA', { acceptedAuthorities: EQUIVALENTES_EASA_B11 }), conA320Bajo('EASA'));
    assert.equal(r.total, 100);
    assert.ok(!('authorityEquivalence' in r), JSON.stringify(r.authorityEquivalence));
  });

  await test('Autoridad equivalente · no aceptada tampoco: no hay recorte que explicar, hay rechazo', () => {
    const r = puntuar(ofertaA320('EASA', { acceptedAuthorities: [] }), conA320Bajo('UK_CAA'));
    assert.equal(r.authorityEquivalence, undefined);
  });

  await test('Autoridad equivalente · oferta de sólo licencia y oferta de motor con licencia', () => {
    const uk = makeLicense('B1.1', { authority: 'UK_CAA' });
    const soloLicencia = makeOffer({ licenseAuthority: 'EASA', licenseCode: 'B1.1', requiredHabilitations: [], acceptedAuthorities: EQUIVALENTES_EASA_B11 });
    assert.equal(puntuar(soloLicencia, makeTechnician({ ...PERFIL_A_FAVOR, licenses: [uk] })).authorityEquivalence, TEXTO_EQUIVALENTE_UK);

    const motor = makeEngineOffer(ENGINE_FIXTURES[0].id, {
      requiresCertification: true, licenseCode: 'B1.1', licenseAuthority: 'EASA', acceptedAuthorities: EQUIVALENTES_EASA_B11,
    });
    const tecnico = makeTechnician({ ...PERFIL_MOTOR, licenses: [uk], engines: [makeEngineDeclaration(ENGINE_FIXTURES[0].id)] });
    assert.equal(puntuar(motor, tecnico).authorityEquivalence, TEXTO_EQUIVALENTE_UK);
  });

  await test('Autoridad equivalente · las credenciales se nombran con la etiqueta de su autoridad', () => {
    const casa = makeLicense('B1.1', { authority: 'CASA' });
    const oferta = ofertaA320('UK_CAA', { acceptedAuthorities: ['CASA'] });
    const tecnico = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [casa],
      habilitations: [makeHabOn(casa, { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    assert.equal(
      puntuar(oferta, tecnico).authorityEquivalence,
      'Accepted via equivalent authority: the profile holds CASA (Australia) B1.1; the offer asks for UK CAA B1.1.',
    );
  });

  await test('Aeronave bajo autoridad no aceptada · un rating bajo otro CÓDIGO no es cosa de autoridad', () => {
    const b2 = makeLicense('B2', { authority: 'UK_CAA' });
    const tecnico = makeTechnician({
      ...PERFIL_A_FAVOR,
      licenses: [b2],
      habilitations: [makeHabOn(b2, { aircraftTypeRatingId: 'fx-a320-cfm56' })],
    });
    const r = puntuar(ofertaA320('EASA', { acceptedAuthorities: [] }), tecnico);
    assert.ok(
      r.clarifications.includes(`The offer also lists B1.1 + ${A320}; not present in the profile`),
      JSON.stringify(r.clarifications),
    );
  });

}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
  });
