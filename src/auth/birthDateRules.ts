// La fecha de nacimiento del alta de técnico: fecha real del calendario y
// edad mínima de 18 años. Un solo sitio para la regla; la pantalla de alta la
// usa y `npm run test:birth-date-rules` comprueba que no se escribe otra.
//
// La base de datos impone lo mismo (migración 104, trigger
// enforce_technician_minimum_age sobre technician_profiles, con el helper
// meets_minimum_technician_age). Las dos cuentan el día de HOY en UTC: si el
// formulario usara la hora local, quien cumple 18 hoy en un huso por delante
// de UTC pasaría aquí y la base lo rechazaría unas horas. Quien nace un 29 de
// febrero cumple los 18 el 1 de marzo en los años no bisiestos, igual en los
// dos lados (`fecha <= hoy - 18 años` en Postgres da lo mismo).
//
// Los textos van en inglés, como el resto de la app.

export const MINIMUM_TECHNICIAN_AGE = 18;
/** Límite inferior que ya tenía el formulario; la base no lo impone. */
export const EARLIEST_BIRTH_YEAR = 1930;

export const BIRTH_DATE_REQUIRED_TEXT = 'Date of birth is required.';
export const BIRTH_DATE_INVALID_TEXT = 'Enter a valid date of birth.';
export const BIRTH_DATE_UNDER_AGE_TEXT = `You must be at least ${MINIMUM_TECHNICIAN_AGE} years old to create a technician account.`;

type DateParts = { year: number; month: number; day: number };

function isoDate({ year, month, day }: DateParts): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseField(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** La fecha del día de hoy en UTC. */
export function utcToday(now: Date = new Date()): DateParts {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

/**
 * La fecha escrita en los tres campos como 'YYYY-MM-DD', o null si no es un día
 * real del calendario (31/02, mes 13…) o es anterior a EARLIEST_BIRTH_YEAR. No
 * mira la edad.
 */
export function buildBirthDate(year: string, month: string, day: string): string | null {
  const y = parseField(year);
  const m = parseField(month);
  const d = parseField(day);
  if (y === null || m === null || d === null) return null;
  if (y < EARLIEST_BIRTH_YEAR || m < 1 || m > 12 || d < 1) return null;
  if (d > daysInMonth(y, m)) return null;
  return isoDate({ year: y, month: m, day: d });
}

/**
 * true si quien nació en `birthDate` ('YYYY-MM-DD') tiene ya 18 años el día
 * `today`. Compara (año, mes, día): mismo resultado que la base.
 */
export function meetsMinimumTechnicianAge(birthDate: string, today: DateParts): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return false;
  const birth = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  let age = today.year - birth.year;
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) age -= 1;
  return age >= MINIMUM_TECHNICIAN_AGE;
}

/** El error de los tres campos de la fecha de nacimiento, o null si se puede enviar. */
export function birthDateError(year: string, month: string, day: string, now: Date = new Date()): string | null {
  if (!year.trim() || !month.trim() || !day.trim()) return BIRTH_DATE_REQUIRED_TEXT;
  const birthDate = buildBirthDate(year, month, day);
  if (!birthDate) return BIRTH_DATE_INVALID_TEXT;
  const today = utcToday(now);
  // Una fecha futura no es "menor de edad": es una fecha mal escrita.
  if (birthDate > isoDate(today)) return BIRTH_DATE_INVALID_TEXT;
  if (!meetsMinimumTechnicianAge(birthDate, today)) return BIRTH_DATE_UNDER_AGE_TEXT;
  return null;
}
