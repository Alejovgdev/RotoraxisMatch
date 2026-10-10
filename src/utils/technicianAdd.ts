// Reglas puras del "+" del técnico y sus asistentes (rediseño, fase 6B;
// maquetas T-Add, T-Lic, T-LicDates, T-LicDone, T-Rat, T-RatDetails, T-Done,
// T-Eng; T2, T5, T6 y respuestas 26 y 27).
//
// Nada aquí decide algo nuevo. Qué licencias existen, qué tipos marcan, qué
// caduca y qué aeronaves cubre cada licencia lo dicen src/constants/licenses.ts,
// src/utils/profileLicenses.ts y src/utils/individualTypeRatingScope.ts; esto
// sólo lo ordena para las pantallas: qué opción sale en gris y por qué, qué sale
// como "✓ Added", qué tipos añade una licencia. Con pruebas en
// scripts/testTechnicianAdd.ts.
import {
  AUTHORITY_LICENSES,
  authorityLicenseCanExpire,
  credentialLabel,
  typesLockedByLicenses,
} from '../constants/licenses';
import { technicianTypeLabel } from '../constants/technicianTypes';
import { searchRatings } from '../constants/aircraftTypeRatingViews';
import { EngineIndex, searchEngines } from '../constants/engines';
import { individualTypeRatingScopeError } from './individualTypeRatingScope';
import {
  HeldLicense,
  faaMechanicTypeNote,
  heldLicenseCodes,
  holdsLicense,
  licensesForHabilitations,
  sortHeldLicenses,
  toggleHeldLicense,
} from './profileLicenses';
import { showsEngineExperience } from './profileEngines';
import { joinWithAnd, licencesLockingType, typesAfterAddingLicences } from './technicianWork';
import {
  TECHNICIAN_ADD_ROUTES,
  technicianDocumentsUploadHref,
} from './technicianNavigation';
import type { AircraftTypeRatingCatalog, AuthorityCode, AuthorityLicenseCode, EngineCatalog } from '../types/catalog';
import type { EditableTechnicianProfile, HabilitationRow } from '../types/technicianProfileEdit';

// ── El "+" (T-Add) ──────────────────────────────────────────────────────────

export type AddOptionKey = 'licence' | 'typeRating' | 'aircraft' | 'engine' | 'document';

export interface AddOption {
  key: AddOptionKey;
  /** El texto del cuadrado ("B1", "A320"…), como en la maqueta. */
  tile: string;
  title: string;
  hint: string;
  href: string;
  /** Lo que falta para poder usarla (documento, sección 1: en gris, no oculta). */
  disabledReason: string | null;
}

/**
 * Las cinco opciones del "+", en el orden de T-Add, con la que necesita algo
 * antes en gris y lo que le falta (T2):
 *   - Type rating: sin licencia, "Add a licence first"; con licencias pero
 *     ninguna que admita ratings individuales (B1.x, B2, C), lo dice.
 *   - Engine experience: sin Engine Technician, "Tick Engine Technician above"
 *     (091: el tipo tiene que existir antes).
 */
export function addMenuOptions(profile: Pick<EditableTechnicianProfile, 'licenses' | 'technicianTypes'>): AddOption[] {
  const typeRatingBlocked = profile.licenses.length === 0
    ? 'Add a licence first'
    : licensesForHabilitations(profile.licenses).length === 0
      ? 'Needs a B1, B2 or C licence'
      : null;
  return [
    { key: 'licence', tile: 'B1', title: 'Licence', hint: 'EASA, UK CAA, CASA, UAE GCAA or FAA', href: TECHNICIAN_ADD_ROUTES.licence, disabledReason: null },
    { key: 'typeRating', tile: 'A320', title: 'Type rating', hint: 'Aircraft and engine on one of your licences', href: TECHNICIAN_ADD_ROUTES.typeRating, disabledReason: typeRatingBlocked },
    { key: 'aircraft', tile: 'XP', title: 'Aircraft experience', hint: 'Aircraft you have worked on', href: TECHNICIAN_ADD_ROUTES.aircraft, disabledReason: null },
    {
      key: 'engine',
      tile: 'ENG',
      title: 'Engine experience',
      hint: 'Engines you have worked on',
      href: TECHNICIAN_ADD_ROUTES.engine,
      disabledReason: showsEngineExperience(profile.technicianTypes) ? null : 'Tick Engine Technician above',
    },
    { key: 'document', tile: 'PDF', title: 'Document', hint: 'Licence or certificate to verify you', href: technicianDocumentsUploadHref(), disabledReason: null },
  ];
}

// ── Asistente de licencia (T-Lic, T-LicDates, T-LicDone) ────────────────────

export interface LicenceChoice {
  authority: AuthorityCode;
  code: AuthorityLicenseCode;
  /** Ya está en el perfil: "✓ Added", lleva a My work y no se vuelve a añadir. */
  added: boolean;
  picked: boolean;
}

/** Las categorías que emite una autoridad (authority_licenses), marcadas. */
export function licenceChoices(
  authority: AuthorityCode,
  held: readonly Pick<HeldLicense, 'authority' | 'code'>[],
  picked: readonly Pick<HeldLicense, 'authority' | 'code'>[],
): LicenceChoice[] {
  return AUTHORITY_LICENSES.filter((row) => row.authority === authority).map((row) => ({
    authority: row.authority,
    code: row.code,
    added: holdsLicense(held as HeldLicense[], row.authority, row.code),
    picked: holdsLicense(picked as HeldLicense[], row.authority, row.code),
  }));
}

/**
 * Marcar o desmarcar una categoría en el paso 1. Lo que ya está en el perfil
 * no se puede marcar: nunca se ofrece dos veces.
 */
export function togglePickedLicence(
  picked: readonly HeldLicense[],
  held: readonly Pick<HeldLicense, 'authority' | 'code'>[],
  authority: AuthorityCode,
  code: AuthorityLicenseCode,
): HeldLicense[] {
  if (holdsLicense(held as HeldLicense[], authority, code)) return [...picked];
  return sortHeldLicenses(toggleHeldLicense(picked, authority, code));
}

/** Los tipos de perfil que las licencias elegidas AÑADEN (T5). */
export function typesAddedByLicences(
  types: readonly string[],
  held: readonly Pick<HeldLicense, 'authority' | 'code'>[],
  picked: readonly Pick<HeldLicense, 'authority' | 'code'>[],
): string[] {
  return typesAfterAddingLicences(types, held, picked).filter((t) => !types.includes(t));
}

/** "Adds Avionics Technician to what you do" (paso 1), o null si no añaden nada. */
export function licenceAddsNote(
  types: readonly string[],
  held: readonly Pick<HeldLicense, 'authority' | 'code'>[],
  picked: readonly Pick<HeldLicense, 'authority' | 'code'>[],
): string | null {
  const added = typesAddedByLicences(types, held, picked);
  return added.length > 0 ? `Adds ${joinWithAnd(added.map(technicianTypeLabel))} to what you do` : null;
}

/** "a", "a or b", "a, b or c". */
function joinWithOr(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/**
 * La pantalla final (T-LicDone), por cada tipo añadido:
 *   - Si una licencia lo BLOQUEA: "It stays while you hold the B2." (con
 *     varias, "the B1.1 or B1.3": basta una).
 *   - Si no (la FAA A o A&P marcan Mechanic sin bloquearlo), el texto de hoy
 *     (respuesta 27, faaMechanicTypeNote).
 */
export function licenceTypeNotices(
  types: readonly string[],
  held: readonly HeldLicense[],
  picked: readonly HeldLicense[],
): { type: string; title: string; text: string | null }[] {
  const after = [...held, ...picked];
  const locked = typesLockedByLicenses(heldLicenseCodes(after));
  return typesAddedByLicences(types, held, picked).map((type) => {
    const title = `${technicianTypeLabel(type)} added to what you do`;
    if (!locked.includes(type)) return { type, title, text: faaMechanicTypeNote(after) };
    const lockers = licencesLockingType(after, type);
    const sameAuthority = lockers.every((l) => l.authority === lockers[0]?.authority);
    const names = lockers.map((l) => (sameAuthority ? l.code : credentialLabel(l.authority, l.code)));
    return { type, title, text: `It stays while you hold the ${joinWithOr(names)}.` };
  });
}

/**
 * "Expires" sólo para las autoridades cuyas licencias caducan hoy: no la FAA
 * ni CASA (respuesta 26). Un bloque por categoría elegida.
 */
export function licenceDateBlocks(picked: readonly HeldLicense[]): { license: HeldLicense; showsExpiry: boolean }[] {
  return picked.map((license) => ({ license, showsExpiry: authorityLicenseCanExpire(license.authority) }));
}

// ── Asistente de type rating (T-Rat, T-RatDetails, T-Done) ──────────────────

/** Las credenciales de las que puede colgar un type rating (B1.x, B2, C). */
export function typeRatingLicenceOptions(held: readonly HeldLicense[]): HeldLicense[] {
  return sortHeldLicenses(licensesForHabilitations(held));
}

export function licenceParam(licence: Pick<HeldLicense, 'authority' | 'code'>): string {
  return `${licence.authority}:${licence.code}`;
}

/** La licencia de "?licence=EASA:B1.1", si es una de las elegibles. */
export function licenceFromParam(param: string | undefined, options: readonly HeldLicense[]): HeldLicense | null {
  if (!param) return null;
  return options.find((l) => licenceParam(l) === param) ?? null;
}

/** Una fila de una lista de los asistentes. `added`: ya está en el perfil. */
export interface CatalogRow<T> {
  item: T;
  added: boolean;
  /** Por qué está (sólo cuando no es obvio). */
  addedNote?: string;
}

/**
 * Las aeronaves que se pueden colgar de `licence`: sólo las que esa
 * credencial cubre (individualTypeRatingScope, el mismo filtro que la base
 * aplica en la 083), buscadas igual que en el buscador de siempre. Las que ya
 * tiene en ESA credencial salen como "✓ Added".
 */
export function typeRatingRows(
  ratings: readonly AircraftTypeRatingCatalog[],
  query: string,
  licence: Pick<HeldLicense, 'authority' | 'code'>,
  habilitations: readonly HabilitationRow[],
  engineIndex: EngineIndex,
  maxResults = 25,
): CatalogRow<AircraftTypeRatingCatalog>[] {
  const allowed = ratings.filter((r) => !individualTypeRatingScopeError(licence.authority, licence.code, r, engineIndex));
  return searchRatings(allowed, query).slice(0, maxResults).map((rating) => ({
    item: rating,
    added: habilitations.some(
      (h) => h.authority === licence.authority && h.licenseCode === licence.code && h.aircraftTypeRatingId === rating.id,
    ),
  }));
}

/**
 * Las aeronaves para la experiencia: el catálogo entero (la persona puede
 * haber trabajado en aviones y helicópteros). "✓ Added" si ya está en su
 * experiencia, o si tiene un type rating en ella: una habilitación ya demuestra
 * la experiencia (Tanda E), y declararla otra vez no se permite hoy.
 */
export function aircraftExperienceRows(
  ratings: readonly AircraftTypeRatingCatalog[],
  query: string,
  profile: Pick<EditableTechnicianProfile, 'aircraftExperience' | 'habilitations'>,
  maxResults = 25,
): CatalogRow<AircraftTypeRatingCatalog>[] {
  return searchRatings([...ratings], query).slice(0, maxResults).map((rating) => {
    if (profile.aircraftExperience.some((e) => e.aircraftTypeRatingId === rating.id)) {
      return { item: rating, added: true, addedNote: 'In your aircraft experience' };
    }
    const habilitation = profile.habilitations.find((h) => h.aircraftTypeRatingId === rating.id);
    if (habilitation) {
      return { item: rating, added: true, addedNote: `Type rating on your ${credentialLabel(habilitation.authority, habilitation.licenseCode)}` };
    }
    return { item: rating, added: false };
  });
}

/** Los motores (activos y con modelo: searchEngines), con los ya declarados como "✓ Added". */
export function engineRows(
  engines: readonly EngineCatalog[],
  query: string,
  declared: readonly { engineId: string }[],
  maxResults = 20,
): CatalogRow<EngineCatalog>[] {
  return searchEngines([...engines], query).slice(0, maxResults).map((engine) => ({
    item: engine,
    added: declared.some((e) => e.engineId === engine.id),
  }));
}

/** Años opcionales: '' = no declarado; si no, un entero de 0 a 70 (como hoy en motores). */
export function parseOptionalYears(raw: string): { years: number | undefined; invalid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === '') return { years: undefined, invalid: false };
  const value = Number(trimmed);
  return { years: value, invalid: !Number.isInteger(value) || value < 0 || value > 70 };
}
