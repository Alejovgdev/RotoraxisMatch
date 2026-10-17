import { LicenseCode } from '../types/catalog';
import { AircraftClass, EasaGroup, HabilitationScope, PropulsionType } from '../types/habilitationScope';
import { getLicenseRatingProductType } from './licenseCategoryProductType';

// Fase 4 (docs/MISSION_PART66.md) — scaffolding. canHold() is still NOT
// wired to any form, matching path, or UI: only scripts/testMatching.ts calls
// it. getCompatiblePropulsion() is the exception: since H3 (Fase 10, paso 5d)
// the app uses it through src/utils/individualTypeRatingScope.ts, which
// checks the scope of profile habilitations (mirror of migration 083).

// Generalizes getLicenseRatingProductType() (Fase 3b) as canHold()'s
// aircraft-class dimension — imported, never re-implemented, so there is
// exactly one place that knows which license categories are
// class-restricted (never a second definition that could drift from it).
//
// Es la tabla del LADO TÉCNICO la que se reusa aquí, y esa es la correcta:
// canHold() pregunta qué privilegios tiene el técnico, no qué ofertas
// pueden pedir su licencia (getOfferProductTypeRestriction, la otra tabla
// desde la corrección de la L — ver la cabecera de
// licenseCategoryProductType.ts).
//
// Sin cast: AircraftClass se deriva del mismo productType del catálogo y
// por tanto incluye 'Gas Airship'. Hasta el 2026-08-14 aquí había un
// `as AircraftClass` con un comentario que afirmaba que ninguna categoría
// Part-66 mapea a dirigibles. La L sí lo hace — por eso los 3 dirigibles
// están en el catálogo — así que el cast habría etiquetado 'Gas Airship'
// como un tipo que no lo contenía. Se corrigió aunque esto siga siendo
// andamiaje sin cablear, precisamente por serlo: nadie lo ejecuta todavía,
// y para cuando alguien lo cablee la contradicción ya no tendría autor.
function getCompatibleAircraftClass(licenseCode: LicenseCode): AircraftClass | undefined {
  return getLicenseRatingProductType(licenseCode);
}

// New dimension (turbine/piston) — nothing before Fase 4 needed it, so
// there was no existing mapping to reuse here, unlike the class dimension
// above. Derived directly from the authoritative category labels
// (src/constants/licenses.ts), not guessed:
//   A1/B1.1/A3/B1.3  -> turbine  ("Turbine-powered ...")
//   A2/B1.2/A4/B1.4  -> piston   ("Piston-powered ...")
//   B3               -> piston  ("Piston-engine non-pressurised aeroplanes")
//   B2/B2L/L/C       -> undefined (no propulsion restriction by category
//                       definition — Avionics/Limited Avionics/Light
//                       Aircraft/Base Maintenance are not propulsion-scoped)
//
// TODO(open regulatory question, see mission brief "Duda regulatoria
// abierta"): EASA AMC 66.A.45 may record some B2 endorsements without an
// engine designation. B2 already maps to `undefined` here — no propulsion
// check ever applies to it either way — so this mapping itself doesn't
// change if that question resolves; flagged per the brief's instruction
// to document the TODO wherever it's relevant, not because it alters
// anything here.
function getCompatiblePropulsion(licenseCode: LicenseCode): PropulsionType | undefined {
  switch (licenseCode) {
    case 'A1':
    case 'A3':
    case 'B1.1':
    case 'B1.3':
      return 'turbine';
    case 'A2':
    case 'A4':
    case 'B1.2':
    case 'B1.4':
    case 'B3':
      return 'piston';
    default:
      return undefined;
  }
}

// A license-side restriction of `undefined` means the category imposes no
// rule on this dimension — always satisfied. Otherwise the scope's own
// value must be explicitly known AND match; an unpopulated scope value is
// never assumed to match just because we don't know it doesn't — same
// "never guess" rule isUnusualCombination() already follows, applied here
// toward the safe (false) side rather than the permissive one, since
// canHold() answers a legal-privilege question, not a soft UI hint.
function dimensionSatisfied<T>(licenseAllows: T | undefined, scopeValue: T | undefined): boolean {
  if (licenseAllows === undefined) return true;
  if (scopeValue === undefined) return false;
  return licenseAllows === scopeValue;
}

// Which HabilitationScope kinds are a legitimate way to demonstrate a
// qualification within a given EASA group — from the mission brief:
// Group 1 = individual rating mandatory, no subgroup/group substitute;
// 2a/2b/2c = individual OR subgroup; 3 = individual OR full group (no
// subgroup granularity for group 3 — the brief pairs it with "full group"
// specifically, not "subgroup"). exact_rating always demonstrates its own
// qualification regardless of which group it belongs to, so it never goes
// through this table (see canHold() below) — it has no easaGroup field at all.
const ALLOWED_KINDS_BY_GROUP: Record<EasaGroup, Array<HabilitationScope['kind']>> = {
  '1': [],
  '2a': ['manufacturer_subgroup', 'full_subgroup'],
  '2b': ['manufacturer_subgroup', 'full_subgroup'],
  '2c': ['manufacturer_subgroup', 'full_subgroup'],
  '3': ['full_group'],
};

/**
 * Does a technician holding `licenseCode` have the privileges `scope`
 * claims? Checks three independent dimensions — aircraft class
 * (Aeroplane/Helicopter), propulsion (turbine/piston), and, for
 * group-based scopes, whether that scope's granularity is a legitimate
 * substitute for an individual rating within its EASA group. ALL three
 * must pass.
 *
 * Pure — no catalog/DB access. Callers resolve aircraftClass/propulsion
 * from the real catalog (or from their own domain knowledge of a group/
 * subgroup) before constructing a HabilitationScope; this function never
 * looks anything up itself.
 *
 * NOT wired to production yet (Fase 4) — no form, matching path, or UI
 * calls this today.
 */
export function canHold(licenseCode: LicenseCode, scope: HabilitationScope): boolean {
  const classOk = dimensionSatisfied(getCompatibleAircraftClass(licenseCode), scope.aircraftClass);
  const propulsionOk = dimensionSatisfied(getCompatiblePropulsion(licenseCode), scope.propulsion);
  if (!classOk || !propulsionOk) return false;

  if (scope.kind === 'exact_rating') return true;
  return ALLOWED_KINDS_BY_GROUP[scope.easaGroup].includes(scope.kind);
}

// Exported for direct unit testing alongside getLicenseRatingProductType()
// (see scripts/testMatching.ts). getCompatiblePropulsion() also has a
// production caller, src/utils/individualTypeRatingScope.ts (H3).
export { getCompatibleAircraftClass, getCompatiblePropulsion };
