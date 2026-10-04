// Las licencias del perfil del técnico, identificadas por CREDENCIAL (Fase 10,
// paso 5b).
//
// Hasta este paso el perfil las guardaba como una lista de códigos: "B1.1" era
// una licencia. Desde la 073 un técnico puede tener una B1.1 EASA y una B1.1
// UK CAA a la vez, y con códigos a secas la pantalla no podía ni enseñarlas ni
// quitar una sin la otra. Aquí la clave es (autoridad, código), lo mismo que
// el UNIQUE de technician_licenses.
//
// Puro, con tests en scripts/testMatching.ts: el perfil es la única pantalla
// que lo usa, pero las reglas —qué implica oficio, de qué credencial puede
// colgar una habilitación— no son decisiones de pantalla.
import { AuthorityCode, AuthorityLicenseCode } from '../types/catalog';
import { AUTHORITIES, FAA_SIGN_OFF_LICENSE_CODES, typesLockedByLicenses } from '../constants/licenses';
import { licenseAllowsIndividualTypeRatings } from './individualTypeRatingScope';

export interface HeldLicense {
  authority: AuthorityCode;
  code: AuthorityLicenseCode;
  issuedAt?: string;
  expiresAt?: string;
}

export function credentialKey(authority: string, code: string): string {
  return `${authority}|${code}`;
}

export function holdsLicense(held: readonly HeldLicense[], authority: string, code: string): boolean {
  return held.some((l) => l.authority === authority && l.code === code);
}

/** Añade o quita UNA credencial. Quitar la B1.1 EASA no toca la B1.1 UK CAA. */
export function toggleHeldLicense(held: readonly HeldLicense[], authority: AuthorityCode, code: AuthorityLicenseCode): HeldLicense[] {
  return holdsLicense(held, authority, code)
    ? held.filter((l) => !(l.authority === authority && l.code === code))
    : [...held, { authority, code }];
}

export function updateHeldLicenseDates(
  held: readonly HeldLicense[],
  authority: string,
  code: string,
  patch: Pick<HeldLicense, 'issuedAt' | 'expiresAt'>,
): HeldLicense[] {
  return held.map((l) => (l.authority === authority && l.code === code ? { ...l, ...patch } : l));
}

/**
 * Los CÓDIGOS que sostienen las credenciales, sin repetir. Es lo que pregunta
 * la implicación de oficio (typesImpliedByLicenses): una B1.1 implica mecánico
 * la emita quien la emita.
 */
export function heldLicenseCodes(held: readonly HeldLicense[]): AuthorityLicenseCode[] {
  return [...new Set(held.map((l) => l.code))];
}

/**
 * Las credenciales de las que puede colgar una habilitación: las de una
 * autoridad y categoría que emiten ratings individuales: B1.x, B2 y C.
 * A, B2L, B3, L y los certificados FAA no se ofrecen.
 */
export function licensesForHabilitations(held: readonly HeldLicense[]): HeldLicense[] {
  return held.filter((l) => licenseAllowsIndividualTypeRatings(l.authority, l.code));
}

/**
 * ¿Puede marcar aeronaves como firmadas? Con FAA A o A&P (094). Se pregunta por
 * las licencias que el perfil tiene AHORA, guardadas o no: el guardado escribe
 * las licencias antes que la experiencia.
 */
export function canSignOffAircraft(held: readonly Pick<HeldLicense, 'authority' | 'code'>[]): boolean {
  return held.some((l) => l.authority === 'FAA' && (FAA_SIGN_OFF_LICENSE_CODES as readonly string[]).includes(l.code));
}

/**
 * La etiqueta del check de firma, o null si no puede firmar. Nombra el
 * certificado bajo el que firma: la A sola, "A"; la A&P, o la A y la P en filas
 * separadas (que el matching ya trata como A&P, H8), "A&P".
 */
export function signOffLabel(held: readonly Pick<HeldLicense, 'authority' | 'code'>[]): string | null {
  if (!canSignOffAircraft(held)) return null;
  const faa = held.filter((l) => l.authority === 'FAA').map((l) => l.code);
  return `Signed off under my FAA ${faa.includes('A&P') || faa.includes('P') ? 'A&P' : 'A'}`;
}

/**
 * La nota que va debajo del selector de tipos de perfil cuando el técnico
 * tiene FAA A o A&P (o la A y la P en filas separadas, que incluyen la A), o
 * null. Esas licencias marcan Mechanic pero no lo bloquean
 * (typesLockedByLicenses, 2026-10-02), y la nota general del selector no lo
 * dice. Sólo sale si Mechanic se puede desmarcar de verdad: si otra licencia
 * lo bloquea (una B1.1), la nota diría algo falso. Describe lo que se puede
 * hacer, sin empujar a hacerlo.
 */
export function faaMechanicTypeNote(held: readonly Pick<HeldLicense, 'authority' | 'code'>[]): string | null {
  const holdsFaaAirframe = held.some((l) => l.authority === 'FAA' && (l.code === 'A' || l.code === 'A&P'));
  const mechanicLocked = typesLockedByLicenses(held.map((l) => l.code)).includes('mechanic');
  return holdsFaaAirframe && !mechanicLocked
    ? 'An FAA A or A&P ticks Mechanic, but you can untick it if you only do avionics.'
    : null;
}

/**
 * La experiencia tras un cambio de licencias: sin FAA A ni A&P, ninguna
 * aeronave queda firmada — lo mismo que hará la base al guardar. Devuelve la
 * misma lista si no hay nada que quitar.
 */
export function aircraftExperienceAfterLicenseChange<T extends { signed?: boolean }>(
  rows: T[],
  held: readonly Pick<HeldLicense, 'authority' | 'code'>[],
): T[] {
  if (canSignOffAircraft(held) || !rows.some((r) => r.signed)) return rows;
  return rows.map((r) => ({ ...r, signed: false }));
}

/** Cuántas credenciales tiene bajo cada autoridad, para el selector. */
export function heldCountByAuthority(held: readonly HeldLicense[]): Record<AuthorityCode, number> {
  const counts = Object.fromEntries(AUTHORITIES.map((a) => [a.code, 0])) as Record<AuthorityCode, number>;
  for (const l of held) counts[l.authority] = (counts[l.authority] ?? 0) + 1;
  return counts;
}

/** Orden estable de pintado: por autoridad (orden del catálogo) y luego por código. */
export function sortHeldLicenses(held: readonly HeldLicense[]): HeldLicense[] {
  const order = new Map(AUTHORITIES.map((a) => [a.code, a.sortOrder]));
  return [...held].sort(
    (a, b) => (order.get(a.authority) ?? 99) - (order.get(b.authority) ?? 99) || a.code.localeCompare(b.code),
  );
}
