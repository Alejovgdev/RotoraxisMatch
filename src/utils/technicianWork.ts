// Reglas puras de You y My work (rediseño, fase 6A; maquetas T-You y T-Quals).
//
// Nada aquí decide algo nuevo: el borrador de licencias aplica las mismas
// funciones que el perfil de antes (typesAfterLicenseChange,
// aircraftExperienceAfterLicenseChange) y los textos describen lo que ya está
// guardado. Con pruebas en scripts/testTechnicianProfile.ts.
import { AuthorityCode, AuthorityLicenseCode } from '../types/catalog';
import {
  FAA_LICENSE_CATEGORIES,
  LICENSE_CATEGORIES,
  authorityLicenseCanExpire,
  credentialLabel,
  typesAfterLicenseChange,
  typesLockedByLicenses,
} from '../constants/licenses';
import { CONTRACT_TYPES } from '../constants/contractTypes';
import { technicianTypeLabel, technicianTypeLabels } from '../constants/technicianTypes';
import {
  HeldLicense,
  aircraftExperienceAfterLicenseChange,
  faaMechanicTypeNote,
  heldLicenseCodes,
  sortHeldLicenses,
  toggleHeldLicense,
} from './profileLicenses';
import type {
  AircraftExperienceRow,
  EditableTechnicianProfile,
  EngineExperienceRow,
  HabilitationRow,
} from '../types/technicianProfileEdit';
import type { DocumentStatus } from '../types/enums';
import type { LocationValue } from '../types/location';

// ── Borrador de My work ─────────────────────────────────────────────────────

/**
 * Lo que My work edita antes de "Save": licencias (con sus fechas),
 * habilitaciones, experiencia en aeronaves y motores. Los tipos van aquí
 * porque las licencias los marcan, pero se guardan solos al tocarlos.
 */
export interface WorkDraft {
  types: string[];
  licenses: HeldLicense[];
  habilitations: HabilitationRow[];
  aircraftExperience: AircraftExperienceRow[];
  engines: EngineExperienceRow[];
  habDirty: boolean;
  experienceDirty: boolean;
  enginesDirty: boolean;
}

export function workDraftFromProfile(profile: EditableTechnicianProfile): WorkDraft {
  return {
    types: profile.technicianTypes,
    licenses: profile.licenses,
    habilitations: profile.habilitations,
    aircraftExperience: profile.aircraftExperience,
    engines: profile.engines,
    habDirty: false,
    experienceDirty: false,
    enginesDirty: false,
  };
}

/**
 * Añadir o quitar UNA credencial, como el perfil de antes: la licencia marca
 * su tipo y la última de una rama se lo lleva (typesAfterLicenseChange), y sin
 * FAA A ni A&P ninguna aeronave queda firmada (094).
 */
export function toggleDraftLicense(draft: WorkDraft, authority: AuthorityCode, code: AuthorityLicenseCode): WorkDraft {
  const licenses = sortHeldLicenses(toggleHeldLicense(draft.licenses, authority, code));
  const types = typesAfterLicenseChange(draft.types, heldLicenseCodes(draft.licenses), heldLicenseCodes(licenses));
  const aircraftExperience = aircraftExperienceAfterLicenseChange(draft.aircraftExperience, licenses);
  return {
    ...draft,
    licenses,
    types,
    aircraftExperience,
    experienceDirty: draft.experienceDirty || aircraftExperience !== draft.aircraftExperience,
  };
}

/**
 * Los tipos tras AÑADIR licencias (asistente de licencia, fase 6B): la misma
 * cuenta que al marcarlas en My work (typesAfterLicenseChange), con las de
 * antes más las nuevas.
 */
export function typesAfterAddingLicences(
  types: readonly string[],
  held: readonly Pick<HeldLicense, 'authority' | 'code'>[],
  added: readonly Pick<HeldLicense, 'authority' | 'code'>[],
): string[] {
  return typesAfterLicenseChange(
    types,
    heldLicenseCodes(held as HeldLicense[]),
    heldLicenseCodes([...held, ...added] as HeldLicense[]),
  );
}

/**
 * Lo que pinta "What you do" (My work y el "+"): qué tipos bloquean las
 * licencias, una línea por candado y la nota de la FAA A o A&P (respuesta 27).
 */
export function whatYouDoFacts(licenses: readonly HeldLicense[]): { locked: string[]; lockLines: string[]; faaNote: string | null } {
  return {
    locked: typesLockedByLicenses(heldLicenseCodes(licenses)),
    lockLines: typeLockLines(licenses),
    faaNote: faaMechanicTypeNote(licenses),
  };
}

function licenceKey(l: Pick<HeldLicense, 'authority' | 'code'>): string {
  return `${l.authority}|${l.code}`;
}

/** ¿Cambiaron las licencias (alguna de más, de menos o con otras fechas)? */
export function licencesChanged(saved: readonly HeldLicense[], draft: readonly HeldLicense[]): boolean {
  if (saved.length !== draft.length) return true;
  const byKey = new Map(saved.map((l) => [licenceKey(l), l]));
  return draft.some((l) => {
    const before = byKey.get(licenceKey(l));
    return !before || (before.issuedAt ?? '') !== (l.issuedAt ?? '') || (before.expiresAt ?? '') !== (l.expiresAt ?? '');
  });
}

/** ¿Hay algo en My work sin guardar? */
export function workDraftDirty(saved: EditableTechnicianProfile, draft: WorkDraft): boolean {
  return licencesChanged(saved.licenses, draft.licenses) || draft.habDirty || draft.experienceDirty || draft.enginesDirty;
}

/**
 * Una huella de lo que My work edita (tipos, licencias con fechas, type
 * ratings, aeronaves y motores), sin ids ni orden. Si cambia por debajo de un
 * borrador sin guardar —un asistente del "+" añadió algo, p. ej. desde la
 * barra superior de escritorio—, guardar ese borrador pisaría lo añadido: My
 * work lo detecta comparando la huella del perfil del que partió con la del
 * perfil recién leído.
 */
export function workSnapshotKey(
  profile: Pick<EditableTechnicianProfile, 'technicianTypes' | 'licenses' | 'habilitations' | 'aircraftExperience' | 'engines'>,
): string {
  const sorted = (items: string[]) => [...items].sort();
  return JSON.stringify([
    sorted(profile.technicianTypes),
    sorted(profile.licenses.map((l) => [l.authority, l.code, l.issuedAt ?? '', l.expiresAt ?? ''].join('|'))),
    sorted(profile.habilitations.map((h) => [
      h.authority, h.licenseCode, h.aircraftTypeRatingId, h.issuedAt ?? '', h.expiresAt ?? '', h.isCurrent === false ? 'old' : 'current', h.experienceYears ?? '',
    ].join('|'))),
    sorted(profile.aircraftExperience.map((e) => [e.aircraftTypeRatingId, e.years ?? '', e.signed ? 'signed' : ''].join('|'))),
    sorted(profile.engines.map((e) => [e.engineId, e.years ?? ''].join('|'))),
  ]);
}

/** Las habilitaciones que cuelgan de una credencial. */
export function habilitationsOfLicence(
  habilitations: readonly HabilitationRow[],
  license: Pick<HeldLicense, 'authority' | 'code'>,
): HabilitationRow[] {
  return habilitations.filter((h) => h.authority === license.authority && h.licenseCode === license.code);
}

/**
 * Las habilitaciones cuya credencial ya no está en el borrador (la licencia se
 * acaba de quitar). Siguen ahí —nunca se borran por su cuenta— y el guardado
 * se para hasta que se quiten o vuelva la licencia.
 */
export function habilitationsWithoutLicence(
  habilitations: readonly HabilitationRow[],
  licenses: readonly Pick<HeldLicense, 'authority' | 'code'>[],
): HabilitationRow[] {
  const held = new Set(licenses.map(licenceKey));
  return habilitations.filter((h) => !held.has(`${h.authority}|${h.licenseCode}`));
}

// ── "What you do": qué licencia pone cada candado ───────────────────────────

/**
 * Las credenciales que BLOQUEAN `type`. Se pregunta por cada una con las
 * mismas reglas de typesLockedByLicenses; las FAA, junto con las otras FAA
 * que tenga: una P sola bloquea Mechanic, pero con una A (o A&P) no.
 */
export function licencesLockingType(licenses: readonly Pick<HeldLicense, 'authority' | 'code'>[], type: string): HeldLicense[] {
  const faaCodes = licenses.filter((l) => l.authority === 'FAA').map((l) => l.code);
  return licenses.filter((l) => {
    const codes = l.authority === 'FAA' ? [...new Set([l.code, ...faaCodes])] : [l.code];
    return typesLockedByLicenses(codes).includes(type);
  }) as HeldLicense[];
}

/** "a", "a and b", "a, b and c". */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Una línea por tipo bloqueado: "Mechanic comes from your EASA B1.1 and EASA B1.3." */
export function typeLockLines(licenses: readonly Pick<HeldLicense, 'authority' | 'code'>[]): string[] {
  return typesLockedByLicenses(heldLicenseCodes(licenses as HeldLicense[])).map((type) => {
    const sources = licencesLockingType(licenses, type).map((l) => credentialLabel(l.authority, l.code));
    return `${technicianTypeLabel(type)} comes from your ${joinWithAnd(sources)}.`;
  });
}

// ── Tarjeta de licencia ─────────────────────────────────────────────────────

const CATEGORY_LABELS = new Map<string, string>(
  [...LICENSE_CATEGORIES, ...FAA_LICENSE_CATEGORIES].map((c) => [
    c.code,
    c.label.split(' — ').slice(1).join(' — ').replace(/ \(FAA\)$/, ''),
  ]),
);

/** "Mechanical: Turbine-powered Aeroplanes", "Airframe and Powerplant". */
export function licenceCategoryText(code: string): string {
  return CATEGORY_LABELS.get(code) ?? code;
}

export function formatProfileDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((part) => parseInt(part, 10));
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Las fechas de una licencia en una línea. "Expires" sólo para las autoridades
 * cuyas licencias caducan (no FAA ni CASA), igual que el formulario.
 */
export function licenceDatesText(license: Pick<HeldLicense, 'authority' | 'issuedAt' | 'expiresAt'>): string {
  const parts: string[] = [];
  if (license.issuedAt) parts.push(`Issued ${formatProfileDate(license.issuedAt)}`);
  if (license.expiresAt && authorityLicenseCanExpire(license.authority)) parts.push(`Expires ${formatProfileDate(license.expiresAt)}`);
  return parts.length > 0 ? parts.join(' · ') : 'no dates added';
}

/** Los colores del cuadrado del código: azul las Part-66, arena la FAA (T-Quals). */
export function licenceTileColors(authority: string): { bg: string; fg: string; header: string } {
  return authority === 'FAA'
    ? { bg: '#F1E9DC', fg: '#5B4528', header: '#F7F1E8' }
    : { bg: '#FFFFFF', fg: '#0B5E8C', header: '#E6F1F8' };
}

// ── You: las líneas de cada fila ────────────────────────────────────────────

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Mechanic · 3 licences · 2 type ratings · 1 aircraft" (T-You). */
export function workSummary(profile: Pick<EditableTechnicianProfile, 'technicianTypes' | 'licenses' | 'habilitations' | 'aircraftExperience' | 'engines'>): string {
  const parts = [
    profile.technicianTypes.length > 0 ? technicianTypeLabels(profile.technicianTypes) : '',
    profile.licenses.length > 0 ? plural(profile.licenses.length, 'licence', 'licences') : '',
    profile.habilitations.length > 0 ? plural(profile.habilitations.length, 'type rating', 'type ratings') : '',
    profile.aircraftExperience.length > 0 ? plural(profile.aircraftExperience.length, 'aircraft', 'aircraft') : '',
    profile.engines.length > 0 ? plural(profile.engines.length, 'engine', 'engines') : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Add your licences and experience';
}

/** "1 verified · 1 under review" (T-You). */
export function documentsSummary(documents: readonly { status: DocumentStatus }[]): string {
  if (documents.length === 0) return 'No documents yet';
  const verified = documents.filter((d) => d.status === 'verified').length;
  const pending = documents.filter((d) => d.status === 'pending').length;
  const attention = documents.filter((d) => d.status === 'rejected' || d.status === 'expired').length;
  const parts = [
    verified > 0 ? `${verified} verified` : '',
    pending > 0 ? `${pending} under review` : '',
    attention > 0 ? `${attention} need attention` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * "Permanent · Long-term · Short-term". Ninguno marcado es "abierto a
 * cualquiera" (así lo puntúa el matching), no "ninguno".
 */
export function contractTypesSummary(codes: readonly string[]): string {
  const labels = CONTRACT_TYPES.filter((c) => codes.includes(c.code)).map((c) => c.label);
  return labels.length > 0 ? labels.join(' · ') : 'Any contract type';
}

/**
 * El perfil se carga con el CÓDIGO del país como nombre (la fila no guarda el
 * nombre, que es copy y cambia). Con el catálogo cargado, se enseña el nombre.
 */
export function withCountryName(location: LocationValue, countries: readonly { code: string; name: string }[]): LocationValue {
  if (!location.country) return location;
  const entry = countries.find((c) => c.code === location.country?.code);
  if (!entry || entry.name === location.country.name) return location;
  return { ...location, country: { code: entry.code, name: entry.name } };
}

/** "ID T3FD8E0D5F · 8 years of experience" (T-You). Sin años declarados, sólo el ID. */
export function youHeaderLine(anonymousCode: string, yearsInput: string): string {
  const years = yearsInput.trim();
  const id = `ID ${anonymousCode}`;
  if (years === '') return id;
  return `${id} · ${years} ${years === '1' ? 'year' : 'years'} of experience`;
}
