// Standalone tests — sin Supabase real. La fecha de nacimiento del alta de
// técnico (src/auth/birthDateRules.ts):
//
//   - fecha real del calendario y año mínimo de siempre (1930);
//   - 18 años cumplidos contados con el día de HOY en UTC, como la base;
//   - los mismos casos de frontera que comprueba la autoprueba de la migración
//     104 sobre meets_minimum_technician_age (BOUNDARY_CASES, copiados allí):
//     si uno cambia aquí, cambia allí;
//   - que la pantalla de alta usa la regla y no conserva otra propia.
//
// Run via: npm run test:birth-date-rules
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BIRTH_DATE_INVALID_TEXT,
  BIRTH_DATE_REQUIRED_TEXT,
  BIRTH_DATE_UNDER_AGE_TEXT,
  MINIMUM_TECHNICIAN_AGE,
  birthDateError,
  buildBirthDate,
  meetsMinimumTechnicianAge,
  utcToday,
} from '../src/auth/birthDateRules';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`PASS — ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL — ${name}`);
    console.error(err);
  }
}

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const day = (iso: string) => {
  const [year, month, d] = iso.split('-').map(Number);
  return { year, month, day: d };
};

// [nacimiento, hoy, ¿18 cumplidos?] — mismos casos en la autoprueba de la 104.
const BOUNDARY_CASES: Array<[string, string, boolean]> = [
  ['2008-10-16', '2026-10-16', true],
  ['2008-10-17', '2026-10-16', false],
  ['2008-12-31', '2026-01-01', false],
  ['2007-12-31', '2026-01-01', true],
  ['2008-02-29', '2026-02-28', false],
  ['2008-02-29', '2026-03-01', true],
  ['2010-02-28', '2028-02-29', true],
  ['2010-03-01', '2028-02-29', false],
  ['1900-01-01', '2026-10-16', true],
  ['2026-10-16', '2026-10-16', false],
];

test('la edad mínima es 18 y el mensaje lo dice', () => {
  assert.equal(MINIMUM_TECHNICIAN_AGE, 18);
  assert.equal(BIRTH_DATE_UNDER_AGE_TEXT, 'You must be at least 18 years old to create a technician account.');
});

test('casos de frontera (los mismos que la autoprueba SQL de la 104)', () => {
  for (const [birth, today, expected] of BOUNDARY_CASES) {
    assert.equal(meetsMinimumTechnicianAge(birth, day(today)), expected, `${birth} el ${today}`);
  }
});

test('la autoprueba de la 104 lleva exactamente estos casos', () => {
  const migration = read('supabase/migrations/104_technician_minimum_age.sql');
  for (const [birth, today, expected] of BOUNDARY_CASES) {
    assert.ok(
      migration.includes(`('${birth}', '${today}', ${expected})`),
      `falta ('${birth}', '${today}', ${expected}) en la migración 104`,
    );
  }
  const sqlCases = migration.match(/\('\d{4}-\d{2}-\d{2}', '\d{4}-\d{2}-\d{2}', (true|false)\)/g) ?? [];
  assert.equal(sqlCases.length, BOUNDARY_CASES.length, 'la 104 tiene casos que este test no conoce');
});

test('fecha real del calendario', () => {
  assert.equal(buildBirthDate('1990', '1', '5'), '1990-01-05');
  assert.equal(buildBirthDate('2000', '02', '29'), '2000-02-29');
  assert.equal(buildBirthDate('1999', '02', '29'), null);
  assert.equal(buildBirthDate('1990', '02', '31'), null);
  assert.equal(buildBirthDate('1990', '04', '31'), null);
  assert.equal(buildBirthDate('1990', '13', '01'), null);
  assert.equal(buildBirthDate('1990', '00', '10'), null);
  assert.equal(buildBirthDate('1990', '05', '00'), null);
  assert.equal(buildBirthDate('1929', '12', '31'), null);
  assert.equal(buildBirthDate('1930', '01', '01'), '1930-01-01');
  assert.equal(buildBirthDate('19a0', '01', '01'), null);
  assert.equal(buildBirthDate('1990', '-1', '01'), null);
});

test('el formulario: obligatoria, válida, no futura y 18 años', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  assert.equal(birthDateError('', '10', '16', now), BIRTH_DATE_REQUIRED_TEXT);
  assert.equal(birthDateError('2008', ' ', '16', now), BIRTH_DATE_REQUIRED_TEXT);
  assert.equal(birthDateError('1990', '02', '31', now), BIRTH_DATE_INVALID_TEXT);
  assert.equal(birthDateError('2027', '01', '01', now), BIRTH_DATE_INVALID_TEXT);
  assert.equal(birthDateError('2026', '10', '17', now), BIRTH_DATE_INVALID_TEXT);
  assert.equal(birthDateError('2026', '10', '16', now), BIRTH_DATE_UNDER_AGE_TEXT);
  assert.equal(birthDateError('2010', '01', '01', now), BIRTH_DATE_UNDER_AGE_TEXT);
  assert.equal(birthDateError('2008', '10', '17', now), BIRTH_DATE_UNDER_AGE_TEXT);
  assert.equal(birthDateError('2008', '10', '16', now), null);
  assert.equal(birthDateError('1990', '1', '1', now), null);
});

test('el día de hoy se cuenta en UTC, como en la base', () => {
  // 23:30 del 16 en UTC-5 ya es el 17 en UTC: quien cumple 18 el 17 pasa.
  const lateWest = new Date('2026-10-16T23:30:00-05:00');
  assert.deepEqual(utcToday(lateWest), { year: 2026, month: 10, day: 17 });
  assert.equal(birthDateError('2008', '10', '17', lateWest), null);
  // 01:00 del 16 en UTC+2 todavía es el 15 en UTC: quien cumple 18 el 16 aún no.
  const earlyEast = new Date('2026-10-16T01:00:00+02:00');
  assert.deepEqual(utcToday(earlyEast), { year: 2026, month: 10, day: 15 });
  assert.equal(birthDateError('2008', '10', '16', earlyEast), BIRTH_DATE_UNDER_AGE_TEXT);
});

test('la pantalla de alta usa la regla y no conserva una propia', () => {
  const screen = read('app/auth/signup/technician.tsx');
  assert.match(screen, /birthDateError\(birthYear, birthMonth, birthDay\)/);
  assert.match(screen, /buildBirthDate\(birthYear, birthMonth, birthDay\)/);
  assert.doesNotMatch(screen, /function buildDate\(/);
  assert.doesNotMatch(screen, /year\s*[<>]=?\s*(19|20)\d\d/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
