// Cargar y guardar el perfil del técnico (rediseño, fase 6A; respuesta 29 de la
// revisión y decisión T4 de docs/UI_REDESIGN.md).
//
// Era `handleSave` de app/technician/(tabs)/profile.tsx: un formulario entero
// con un solo "Save Changes" que lo reescribía todo. El perfil se parte ahora en
// You, My work y pantallas pequeñas, y cada una guarda SÓLO lo suyo pasando por
// `saveTechnicianProfile`, con un grupo de cambios:
//
//   personal      nombre, teléfono y años             (Personal details)
//   location      país y ciudad                       (Location)
//   availability  Open to offers / Unavailable        (You, al tocar)
//   contractTypes tipos de contrato                   (Contract types)
//   socialLinks   LinkedIn, Instagram, web            (Professional links)
//   types         tipos de perfil                     (My work, al tocar)
//   work          licencias, habilitaciones, aeronaves y motores (My work)
//
// Y los asistentes del "+" (fase 6B), que AÑADEN una cosa y no tocan el resto:
//
//   newLicences            licencias nuevas (y los tipos que añaden)
//   newHabilitation        un type rating
//   newAircraftExperience  una aeronave
//   newEngine              un motor
//
// Un asistente escribe su lista y nada más: añadir una licencia no reescribe
// las que ya hay ni retira ninguna; añadir un motor no toca las licencias.
// Cada uno recibe el perfil RECIÉN LEÍDO (el asistente lo vuelve a pedir justo
// antes de guardar), porque las habilitaciones, las aeronaves y los motores se
// guardan reemplazando su lista entera.
//
// Las validaciones son las de hoy, cada una sobre el grupo que protege (la de
// años cuando se guardan los años, la de enlaces cuando se guardan los
// enlaces…), y todas corren ANTES de la primera escritura. Lo que el guardado
// de hoy hacía en orden —tipos antes que licencias, licencias antes que
// habilitaciones, quitar licencias al final— sigue igual dentro de `work`.
//
// Nunca se pisa un dato con otro viejo: sólo se escriben las columnas del
// grupo, y las dos columnas JSON (`availability`, que lleva disponibilidad Y
// contratos; `social_links`, con claves que la pantalla no enseña) se releen
// justo antes de escribir para conservar lo que el grupo no toca.
//
// Nunca lanza: devuelve el error que la pantalla enseña.
import { technicianRepositoryV2 } from '../repositories/v2/technicianRepositoryV2';
import { catalogRepository } from '../repositories/v2/catalogRepository';
import { AircraftRatingIndex, getAircraftTypeRatingLabel } from '../constants/aircraftTypeRatings';
import { EngineIndex } from '../constants/engines';
import { authorityLicenseCanExpire, credentialLabel, isValidAuthorityLicense, typesLockedByLicenses } from '../constants/licenses';
import { blockingHabilitationIssues, isHabilitationScopeRejection, profileHabilitationIssues } from '../utils/profileHabilitationValidation';
import { HeldLicense, canSignOffAircraft, heldLicenseCodes, holdsLicense, sortHeldLicenses } from '../utils/profileLicenses';
import { engineRemovalWarning, showsEngineExperience, typeChangeDropsEngines } from '../utils/profileEngines';
import { licenseAllowsIndividualTypeRatings } from '../utils/individualTypeRatingScope';
import { typesAfterAddingLicences } from '../utils/technicianWork';
import { isValidDateOrder } from '../utils/validityDates';
import { isValidUrl, normalizeUrl } from '../utils/urlValidation';
import { validateProfileYearsExperience } from '../utils/yearsExperienceValidation';
import { locationValueFromPersisted, persistedLocationFromValue } from '../utils/locationBridge';
import type { AircraftTypeRatingCatalog, ContractTypeCode } from '../types/catalog';
import type { LocationValue } from '../types/location';
import type { AvailabilityStatus, SocialLinks, TechnicianWithRelations } from '../types/technician';
import type {
  AircraftExperienceRow,
  EditableTechnicianProfile,
  EngineExperienceRow,
  HabilitationRow,
  OwnProfileColumnsPatch,
} from '../types/technicianProfileEdit';

// Las tres claves que la UI ofrece sobre technician_profiles.social_links. El
// tipo SocialLinks admite más por index signature: una clave desconocida que
// llegue de la base se conserva al guardar en vez de borrarse por no tener
// campo en pantalla.
export const SOCIAL_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/your-profile' },
  { key: 'instagram', label: 'Instagram', placeholder: 'instagram.com/your-handle' },
  { key: 'website', label: 'Personal website', placeholder: 'your-portfolio.com' },
];

const SESSION_EXPIRED = 'Could not save your profile — your session may have expired. Sign in again and retry.';

/** Lo que el caso de uso necesita de la base. Por defecto, el repositorio. */
export type TechnicianProfileStore = Pick<
  typeof technicianRepositoryV2,
  | 'getOwnJsonColumns'
  | 'updateOwnProfile'
  | 'replaceProfileTypes'
  | 'upsertLicenses'
  | 'replaceHabilitations'
  | 'replaceAircraftExperience'
  | 'replaceEngineExperience'
  | 'removeUnreferencedLicenses'
  | 'describeHabilitationScopeRejection'
>;

/** My work: lo que antes guardaba la mitad de abajo del formulario. */
export interface WorkChanges {
  /** Los tipos tras aplicar las licencias (typesAfterLicenseChange). */
  types: string[];
  licenses: HeldLicense[];
  habilitations: HabilitationRow[];
  /** Sin tocarlas, no se reescriben (ni se bloquea por un catálogo caído). */
  habDirty: boolean;
  aircraftExperience: AircraftExperienceRow[];
  experienceDirty: boolean;
  engines: EngineExperienceRow[];
  enginesDirty: boolean;
  /** Para los mensajes y la comprobación de habilitaciones. */
  ratingsById: AircraftRatingIndex;
  engineIndex: EngineIndex;
}

/** Asistente de licencia: las nuevas, con sus fechas, y lo que ya tiene. */
export interface NewLicencesChange {
  licenses: HeldLicense[];
  profile: Pick<EditableTechnicianProfile, 'technicianTypes' | 'licenses'>;
}

/** Asistente de type rating: el nuevo, colgado de una credencial que ya tiene. */
export interface NewHabilitationChange {
  habilitation: HabilitationRow;
  profile: Pick<EditableTechnicianProfile, 'licenses' | 'habilitations'>;
  ratingsById: AircraftRatingIndex;
  engineIndex: EngineIndex;
}

/** Asistente de experiencia en aeronaves. */
export interface NewAircraftExperienceChange {
  row: AircraftExperienceRow;
  profile: Pick<EditableTechnicianProfile, 'licenses' | 'habilitations' | 'aircraftExperience'>;
  ratingsById: AircraftRatingIndex;
}

/** Asistente de motor. */
export interface NewEngineChange {
  row: EngineExperienceRow;
  profile: Pick<EditableTechnicianProfile, 'technicianTypes' | 'engines'>;
}

export interface TechnicianProfileChanges {
  personal?: { fullName: string; phone: string; yearsInput: string };
  location?: LocationValue;
  availability?: AvailabilityStatus;
  contractTypes?: ContractTypeCode[];
  /** Los tres campos en crudo, por clave de SOCIAL_FIELDS. */
  socialLinks?: Record<string, string>;
  /**
   * Tipos de perfil sueltos (al tocarlos). `licenseCodes` son las licencias
   * GUARDADAS: replaceProfileTypes exige los tipos que bloquean.
   */
  types?: { codes: string[]; licenseCodes: readonly string[] };
  work?: WorkChanges;
  newLicences?: NewLicencesChange;
  newHabilitation?: NewHabilitationChange;
  newAircraftExperience?: NewAircraftExperienceChange;
  newEngine?: NewEngineChange;
}

export type SaveTechnicianProfileResult =
  | { ok: true; licenseRemovalWarning: string | null }
  | { ok: false; error: string };

/**
 * Lo que impide guardar unas habilitaciones (083). `habDirty` decide qué
 * cuenta: si el guardado no reescribe las habilitaciones, una que no se puede
 * VERIFICAR —catálogo de motores o de aeronaves sin cargar— no se manda a la
 * base y no puede ser rechazada. Un problema determinable (credencial quitada,
 * combinación incompatible) bloquea siempre.
 */
function habilitationBlockingMessage(
  habilitations: readonly HabilitationRow[],
  licenses: readonly HeldLicense[],
  ratingsById: AircraftRatingIndex,
  engineIndex: EngineIndex,
  habDirty: boolean,
): string | null {
  const blocking = blockingHabilitationIssues(profileHabilitationIssues([...habilitations], [...licenses], ratingsById, engineIndex), habDirty);
  if (blocking.length === 0) return null;
  const unverifiable = blocking.some((issue) => issue.unverifiable);
  return [
    ...blocking.map((issue) => issue.message),
    ...(unverifiable
      ? ['Your type ratings could not be checked, so they were not saved. Retry the catalog above, or undo your type-rating changes to save the rest of the profile.']
      : []),
  ].join('\n');
}

/**
 * Sólo una fecha de caducidad explícita igual o anterior a la de emisión es
 * un error; las fechas ausentes son neutras. En las licencias, sólo donde la
 * autoridad las hace caducar (no FAA ni CASA).
 */
function dateOrderErrors(
  licenses: readonly HeldLicense[],
  habilitations: readonly HabilitationRow[],
  ratingsById: AircraftRatingIndex,
): string[] {
  const errors: string[] = [];
  licenses.forEach((license) => {
    if (authorityLicenseCanExpire(license.authority) && !isValidDateOrder(license.issuedAt, license.expiresAt)) {
      errors.push(`${credentialLabel(license.authority, license.code)}: expiry date must be after the issue date.`);
    }
  });
  habilitations.forEach((h) => {
    if (!isValidDateOrder(h.issuedAt, h.expiresAt)) {
      errors.push(
        `${credentialLabel(h.authority, h.licenseCode)} + ${getAircraftTypeRatingLabel(h.aircraftTypeRatingId, ratingsById)}: expiry date must be after the issue date.`,
      );
    }
  });
  return errors;
}

/** Los años de un motor: vacío (no declarado) o un entero de 0 a 70, como el editor de hoy. */
function engineYearsInvalid(years: number | undefined): boolean {
  return years !== undefined && (!Number.isInteger(years) || years < 0 || years > 70);
}

/**
 * Las validaciones de hoy, en el orden de hoy, sobre los grupos presentes.
 * null = se puede guardar. No escribe nada.
 */
export function technicianProfileChangesError(changes: TechnicianProfileChanges): string | null {
  const types = changes.work?.types ?? changes.types?.codes;
  if (types && types.length === 0) return 'Select at least one profile type.';

  // Los años son OBLIGATORIOS desde que el alta los pide (migración 044): sin
  // esto, un técnico podía vaciar la casilla y volver a "no declarado". '' y
  // '0' no son lo mismo: esto rechaza SÓLO la cadena vacía (y lo que no es un
  // número de 0 a 70).
  if (changes.personal) {
    const yearsError = validateProfileYearsExperience(changes.personal.yearsInput);
    if (yearsError) return yearsError;
  }

  const work = changes.work;
  if (work) {
    // Antes de escribir nada, incluida una credencial quitada que todavía
    // sostiene un rating. Nunca se mueven ni borran ratings por su cuenta.
    const blocking = habilitationBlockingMessage(work.habilitations, work.licenses, work.ratingsById, work.engineIndex, work.habDirty);
    if (blocking) return blocking;
    const dateErrors = dateOrderErrors(work.licenses, work.habilitations, work.ratingsById);
    if (dateErrors.length > 0) return dateErrors.join(' ');
  }

  const newLicences = changes.newLicences;
  if (newLicences) {
    if (newLicences.licenses.length === 0) return 'Pick at least one licence.';
    for (const l of newLicences.licenses) {
      if (!isValidAuthorityLicense(l.authority, l.code)) return `${credentialLabel(l.authority, l.code)} is not a licence that authority issues.`;
      // "✓ Added": lo que ya está en el perfil no se añade otra vez.
      if (holdsLicense(newLicences.profile.licenses, l.authority, l.code)) return `${credentialLabel(l.authority, l.code)} is already on your profile.`;
    }
    const dateErrors = dateOrderErrors(newLicences.licenses, [], new Map());
    if (dateErrors.length > 0) return dateErrors.join(' ');
  }

  const newHab = changes.newHabilitation;
  if (newHab) {
    const h = newHab.habilitation;
    const credential = credentialLabel(h.authority, h.licenseCode);
    if (!holdsLicense(newHab.profile.licenses, h.authority, h.licenseCode)) return `Add the ${credential} licence first.`;
    if (!licenseAllowsIndividualTypeRatings(h.authority, h.licenseCode)) {
      return 'Individual type ratings require a B1, B2 or C licence. Aircraft experience can be declared separately.';
    }
    if (newHab.profile.habilitations.some((x) => x.authority === h.authority && x.licenseCode === h.licenseCode && x.aircraftTypeRatingId === h.aircraftTypeRatingId)) {
      return `${getAircraftTypeRatingLabel(h.aircraftTypeRatingId, newHab.ratingsById)} is already on your ${credential}.`;
    }
    // La lista entera se reescribe: las comprobaciones de hoy sobre todas.
    const all = [...newHab.profile.habilitations, h];
    const blocking = habilitationBlockingMessage(all, newHab.profile.licenses, newHab.ratingsById, newHab.engineIndex, true);
    if (blocking) return blocking;
    const dateErrors = dateOrderErrors([], all, newHab.ratingsById);
    if (dateErrors.length > 0) return dateErrors.join(' ');
  }

  const newAircraft = changes.newAircraftExperience;
  if (newAircraft) {
    const id = newAircraft.row.aircraftTypeRatingId;
    const label = getAircraftTypeRatingLabel(id, newAircraft.ratingsById);
    // La UNIQUE (technician_id, aircraft_type_rating_id) lo rechazaría.
    if (newAircraft.profile.aircraftExperience.some((e) => e.aircraftTypeRatingId === id)) return `${label} is already in your aircraft experience.`;
    // Una habilitación ya demuestra experiencia en esa aeronave (Tanda E).
    if (newAircraft.profile.habilitations.some((h) => h.aircraftTypeRatingId === id)) {
      return 'You already hold a type rating on this aircraft, which already proves you have worked on it.';
    }
    // 094: la base rechaza la firma sin FAA A o A&P.
    if (newAircraft.row.signed && !canSignOffAircraft(newAircraft.profile.licenses)) return 'Sign-off needs an FAA A or A&P licence.';
  }

  const newEngine = changes.newEngine;
  if (newEngine) {
    // 091: sólo un Engine Technician declara motores; la base rechaza el resto.
    if (!showsEngineExperience(newEngine.profile.technicianTypes)) return 'Only Engine Technician profiles can declare engines.';
    if (newEngine.profile.engines.some((e) => e.engineId === newEngine.row.engineId)) return 'This engine is already in your engine experience.';
    if (engineYearsInvalid(newEngine.row.years)) return 'Enter a number of years between 0 and 70.';
  }

  // Un enlace vacío es válido (opcional) y simplemente no se guarda.
  if (changes.socialLinks) {
    const inputs = changes.socialLinks;
    const socialErrors = SOCIAL_FIELDS.filter((f) => !isValidUrl(inputs[f.key] ?? '')).map(
      (f) => `${f.label}: enter a valid link (e.g. ${f.placeholder}).`,
    );
    if (socialErrors.length > 0) return socialErrors.join(' ');
  }

  return null;
}

/** Las columnas de technician_profiles de los grupos presentes, y sólo ésas. */
async function profileColumnsPatch(
  technicianId: string,
  changes: TechnicianProfileChanges,
  store: TechnicianProfileStore,
): Promise<OwnProfileColumnsPatch> {
  const patch: OwnProfileColumnsPatch = {};

  if (changes.personal) {
    const nameParts = changes.personal.fullName.trim().split(/\s+/);
    const firstName = nameParts[0] ?? '';
    patch.firstName = firstName;
    patch.lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName;
    patch.phone = changes.personal.phone || null;
    const trimmedYears = changes.personal.yearsInput.trim();
    patch.yearsExperience = trimmedYears === '' ? null : Math.max(0, Math.min(70, parseInt(trimmedYears, 10) || 0));
  }

  // Lanza sin país (NOT NULL): lo enseña la pantalla, como hasta ahora.
  if (changes.location) patch.location = persistedLocationFromValue(changes.location);

  const touchesAvailability = changes.availability !== undefined || changes.contractTypes !== undefined;
  if (touchesAvailability || changes.socialLinks) {
    // Releídas AHORA, no cuando la pantalla cargó: lo que este grupo no toca
    // se conserva tal y como está en la base.
    const current = await store.getOwnJsonColumns(technicianId);
    if (!current) throw new Error(SESSION_EXPIRED);

    if (touchesAvailability) {
      patch.availability = {
        // El booleano ES el modelo; `status` es sólo su etiqueta.
        immediately: changes.availability !== undefined
          ? changes.availability === 'open_to_offers'
          : Boolean(current.availability.immediately),
        contractTypes: changes.contractTypes ?? current.availability.contractTypes,
      };
    }

    if (changes.socialLinks) {
      // La forma normalizada y SIN claves vacías; las claves sin campo en
      // pantalla se devuelven intactas. Objeto vacío -> NULL.
      const inputs = changes.socialLinks;
      const knownKeys = SOCIAL_FIELDS.map((f) => f.key);
      const toSave: SocialLinks = Object.fromEntries(
        Object.entries(current.socialLinks ?? {}).filter(([k]) => !knownKeys.includes(k)),
      );
      SOCIAL_FIELDS.forEach((f) => {
        const normalized = normalizeUrl(inputs[f.key] ?? '');
        if (normalized !== '') toSave[f.key] = normalized;
      });
      patch.socialLinks = Object.keys(toSave).length > 0 ? toSave : null;
    }
  }

  return patch;
}

function habilitationEntries(habilitations: readonly HabilitationRow[]) {
  return habilitations.map((h) => ({
    authority: h.authority,
    licenseCode: h.licenseCode,
    aircraftTypeRatingId: h.aircraftTypeRatingId,
    experienceYears: h.experienceYears,
    issuedAt: h.issuedAt,
    expiresAt: h.expiresAt,
    isCurrent: h.isCurrent,
  }));
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Las licencias nuevas y nada más: ni se reescriben las que ya tiene ni se
 * retira ninguna. Si añaden un tipo de perfil, los tipos van primero (como en
 * el guardado de My work) contra las licencias que habrá DESPUÉS.
 */
async function saveNewLicences(technicianId: string, change: NewLicencesChange, store: TechnicianProfileStore): Promise<void> {
  const after = [...change.profile.licenses, ...change.licenses];
  const types = typesAfterAddingLicences(change.profile.technicianTypes, change.profile.licenses, change.licenses);
  if (!sameSet(types, change.profile.technicianTypes)) {
    await store.replaceProfileTypes(technicianId, types, heldLicenseCodes(after));
  }
  await store.upsertLicenses(
    technicianId,
    change.licenses.map((license) => ({
      authority: license.authority,
      code: license.code,
      issuedAt: license.issuedAt,
      // La FAA y CASA no caducan como documento: no se guarda una caducidad.
      expiresAt: authorityLicenseCanExpire(license.authority) ? license.expiresAt : undefined,
    })),
  );
}

async function saveWork(technicianId: string, work: WorkChanges, store: TechnicianProfileStore): Promise<string | null> {
  // 1) Tipos. Las licencias que se pasan son las que van a QUEDAR, no las de
  // la base: este paso corre antes de escribirlas, y si el guardado las
  // reduce, los tipos que bloquean son los de las que quedan.
  await store.replaceProfileTypes(technicianId, work.types, heldLicenseCodes(work.licenses));

  // 2) Licencias primero, en su sitio (nunca borrar y reinsertar): una
  // licencia nueva tiene que existir antes de que una habilitación cuelgue
  // de ella. Cada credencial con SU autoridad.
  await store.upsertLicenses(
    technicianId,
    work.licenses.map((license) => ({
      authority: license.authority,
      code: license.code,
      issuedAt: license.issuedAt,
      expiresAt: license.expiresAt,
    })),
  );

  // 3) Habilitaciones, la lista entera y sin filtrar por las licencias que
  // siguen marcadas: una licencia quitada que aún sostiene una habilitación
  // simplemente no se podrá retirar en el paso 5.
  if (work.habDirty) {
    await store.replaceHabilitations(technicianId, habilitationEntries(work.habilitations));
  }

  // 4) Experiencia en aeronaves: sin FK hacia licencias. 094: las licencias ya
  // están escritas, así que una FAA A/A&P añadida aquí mismo ya deja firmar.
  if (work.experienceDirty) {
    await store.replaceAircraftExperience(
      technicianId,
      work.aircraftExperience.map((e) => ({ aircraftTypeRatingId: e.aircraftTypeRatingId, years: e.years, signed: e.signed })),
    );
  }

  // 4b) Motores: desde la 091 dependen del paso 1 (sólo un Engine Technician
  // los tiene).
  if (work.enginesDirty) {
    await store.replaceEngineExperience(
      technicianId,
      work.engines.map((e) => ({ engineId: e.engineId, years: e.years })),
    );
  }

  // 5) Ahora sí, quitar las licencias desmarcadas, por credencial.
  const { blocked } = await store.removeUnreferencedLicenses(
    technicianId,
    work.licenses.map((license) => ({ authority: license.authority, code: license.code })),
  );
  if (blocked.length === 0) return null;
  return `Saved — but could not remove ${blocked.join(', ')}: the technician still has habilitations declared under ${
    blocked.length > 1 ? 'them' : 'it'
  }. Remove those habilitations first if the license should come off the profile.`;
}

/**
 * Guarda los grupos presentes en `changes` y nada más. Primero valida todo;
 * después escribe la fila del perfil (si hay columnas), los tipos sueltos y
 * My work, en ese orden.
 */
export async function saveTechnicianProfile(
  technicianId: string,
  changes: TechnicianProfileChanges,
  store: TechnicianProfileStore = technicianRepositoryV2,
): Promise<SaveTechnicianProfileResult> {
  const invalid = technicianProfileChangesError(changes);
  if (invalid) return { ok: false, error: invalid };

  try {
    const patch = await profileColumnsPatch(technicianId, changes, store);
    if (Object.keys(patch).length > 0) {
      const updated = await store.updateOwnProfile(technicianId, patch);
      if (!updated) throw new Error(SESSION_EXPIRED);
    }

    if (changes.types) {
      // Diferencial y con los añadidos antes que los borrados (ver el
      // repositorio): un fallo a mitad nunca deja al técnico sin tipos.
      await store.replaceProfileTypes(technicianId, changes.types.codes, changes.types.licenseCodes);
    }

    const licenseRemovalWarning = changes.work ? await saveWork(technicianId, changes.work, store) : null;

    if (changes.newLicences) await saveNewLicences(technicianId, changes.newLicences, store);
    if (changes.newHabilitation) {
      const { habilitation, profile } = changes.newHabilitation;
      // Lista entera (la RPC reemplaza): las de antes, tal cual, más la nueva.
      await store.replaceHabilitations(technicianId, habilitationEntries([...profile.habilitations, habilitation]));
    }
    if (changes.newAircraftExperience) {
      const { row, profile } = changes.newAircraftExperience;
      await store.replaceAircraftExperience(
        technicianId,
        [...profile.aircraftExperience, row].map((e) => ({ aircraftTypeRatingId: e.aircraftTypeRatingId, years: e.years, signed: e.signed })),
      );
    }
    if (changes.newEngine) {
      const { row, profile } = changes.newEngine;
      await store.replaceEngineExperience(technicianId, [...profile.engines, row].map((e) => ({ engineId: e.engineId, years: e.years })));
    }

    return { ok: true, licenseRemovalWarning };
  } catch (err: any) {
    // 083: la base rechaza una credencial o un rating fuera de su alcance. Se
    // explica por habilitación, con su nombre; nunca se reintenta.
    const checked = changes.work?.habilitations
      ?? (changes.newHabilitation ? [...changes.newHabilitation.profile.habilitations, changes.newHabilitation.habilitation] : null);
    if (checked && isHabilitationScopeRejection(err)) {
      try {
        return { ok: false, error: await store.describeHabilitationScopeRejection(checked) };
      } catch {
        // El diagnóstico ya tiene su propio texto de reserva; si aun así
        // falla, queda el mensaje de la base.
      }
    }
    return { ok: false, error: err?.message ?? 'Save failed. Please try again.' };
  }
}

export type ProfileTypesChange =
  | { status: 'cancelled' }
  | { status: 'saved'; enginesRemoved: boolean }
  | { status: 'error'; error: string };

/** La misma forma que useConfirmDialog().confirm y confirmAction. */
export type ConfirmFn = (options: { title: string; message?: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;

/**
 * Tocar un tipo de perfil en My work: se guarda al momento (respuesta 25).
 *
 * Sesión 4 (091): quitar Engine Technician teniendo motores pregunta antes,
 * con el aviso de siempre. Cancelar no escribe nada. Confirmar guarda los
 * tipos y la base borra los motores en la misma operación. Cuentan también los
 * motores añadidos y aún no guardados (`engineCount`): se pierden igual.
 */
export async function changeProfileTypes(
  technicianId: string,
  input: { current: readonly string[]; next: string[]; licenseCodes: readonly string[]; engineCount: number },
  confirm: ConfirmFn,
  options: { store?: TechnicianProfileStore; /** Justo antes de escribir (tras confirmar). */ onSaving?: () => void } = {},
): Promise<ProfileTypesChange> {
  const dropsEngines = typeChangeDropsEngines(input.current, input.next, input.engineCount);
  if (dropsEngines) {
    const confirmed = await confirm({ ...engineRemovalWarning(input.engineCount), destructive: true });
    if (!confirmed) return { status: 'cancelled' };
  }
  options.onSaving?.();
  const result = await saveTechnicianProfile(
    technicianId,
    { types: { codes: input.next, licenseCodes: input.licenseCodes } },
    options.store ?? technicianRepositoryV2,
  );
  if (!result.ok) return { status: 'error', error: result.error };
  return { status: 'saved', enginesRemoved: dropsEngines };
}

// ── Carga ───────────────────────────────────────────────────────────────────

/**
 * De la fila y sus relaciones a lo que editan las pantallas. Puro.
 *
 * Lanza si una habilitación apunta a una licencia que no llegó: la autoridad
 * sale de la licencia a la que APUNTA la fila (technician_license_id), nunca
 * del código —con dos B1.1 el código no dice de cuál es—.
 */
export function editableProfileFromTechnician(tech: TechnicianWithRelations): EditableTechnicianProfile {
  const licenses = sortHeldLicenses(
    tech.licenses.map((l) => ({ authority: l.authority, code: l.licenseCode, issuedAt: l.issuedAt, expiresAt: l.expiresAt })),
  );
  const authorityByLicenseId = new Map(tech.licenses.map((l) => [l.id, l.authority]));
  // Una fila sin rating no nombra ninguna aeronave y no hay nada que pintar.
  const habilitations: HabilitationRow[] = tech.habilitations
    .filter((h) => h.aircraftTypeRatingId)
    .map((h) => {
      const authority = authorityByLicenseId.get(h.technicianLicenseId);
      if (!authority) {
        throw new Error('A type rating on your profile points at a licence that could not be loaded. Reload and try again.');
      }
      return {
        id: h.id,
        authority,
        licenseCode: h.licenseCode,
        aircraftTypeRatingId: h.aircraftTypeRatingId as string,
        experienceYears: h.experienceYears,
        issuedAt: h.issuedAt,
        expiresAt: h.expiresAt,
        isCurrent: h.isCurrent,
      };
    });
  const byCreation = <T extends { createdAt: string }>(rows: readonly T[]) =>
    [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Los tipos que bloquean las licencias se AÑADEN a los de la tabla: una fila
  // anterior a la invariante puede tener una B1.1 sin Mechanic, y enseñarla
  // así contradiría la regla que el guardado impone. Es una reparación del
  // estado inicial; por sí sola no escribe nada. Sólo los que BLOQUEAN: la
  // Mechanic que marca una FAA A o A&P se puede quitar.
  const technicianTypes = [...new Set([...tech.technicianTypes, ...typesLockedByLicenses(heldLicenseCodes(licenses))])];

  const social = (tech.socialLinks ?? {}) as SocialLinks;
  return {
    id: tech.id,
    anonymousCode: tech.anonymousCode,
    photoPath: tech.photoPath ?? null,
    fullName: `${tech.firstName ?? ''} ${tech.lastName ?? ''}`.trim(),
    email: tech.email,
    phone: tech.phone ?? '',
    verificationStatus: tech.verificationStatus,
    // El nombre del país sale del código hasta que la pantalla resuelve el
    // del catálogo vivo.
    location: locationValueFromPersisted(tech, tech.locationCountryCode ?? ''),
    availability: {
      status: tech.availability.immediately ? 'open_to_offers' : 'unavailable',
      contractTypes: tech.availability.contractTypes ?? [],
    },
    // '' cuando la columna es NULL: "no declarado" y "0 años" son distintos.
    yearsInput: tech.yearsExperience == null ? '' : String(tech.yearsExperience),
    socialInputs: Object.fromEntries(SOCIAL_FIELDS.map((f) => [f.key, social[f.key] ?? ''])),
    technicianTypes,
    licenses,
    habilitations,
    aircraftExperience: byCreation(tech.aircraftExperience).map((e) => ({
      id: e.id,
      aircraftTypeRatingId: e.aircraftTypeRatingId,
      years: e.years,
      signed: e.signed === true,
    })),
    engines: byCreation(tech.engines).map((e) => ({ id: e.id, engineId: e.engineId, years: e.years })),
  };
}

/**
 * El perfil propio y los ratings que nombra (activos e inactivos: una
 * habilitación puede apuntar a un rating desactivado, y sin él se pintaría un
 * UUID). null = el técnico no tiene fila de perfil.
 */
export async function loadEditableTechnicianProfile(
  technicianId: string,
): Promise<{ profile: EditableTechnicianProfile; ratings: AircraftTypeRatingCatalog[] } | null> {
  const tech = await technicianRepositoryV2.getOwnWithRelations(technicianId);
  if (!tech) return null;
  const profile = editableProfileFromTechnician(tech);
  const ratings = await catalogRepository.getAircraftTypeRatingsByIds([
    ...profile.habilitations.map((h) => h.aircraftTypeRatingId),
    ...profile.aircraftExperience.map((e) => e.aircraftTypeRatingId),
  ]);
  return { profile, ratings };
}
