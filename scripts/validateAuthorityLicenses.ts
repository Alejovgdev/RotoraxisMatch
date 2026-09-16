// Valida la tabla REAL `authority_licenses` en Supabase (Fase 10).
//
// Escrito antes que la tabla (Fase 10, paso 1); la tabla llegó en la
// migración 066 (paso 2). Es la mitad en vivo del test "authority_licenses: 51 filas" de
// scripts/testMatching.ts, que cuenta la constante AUTHORITY_LICENSES sin tocar
// la base. Este script comprueba que la tabla dice lo mismo.
//
//   13 EASA · 13 UK CAA · 10 CASA (sin B2L, B3, L) · 12 GCAA (sin B2L) · 3 FAA (A, P, A&P)
//
// Depende de la 066: columnas `authority` y `license_code`, y lectura pública
// (política cat_al_read), así que basta la clave publicable. Si RLS dejara de
// permitir leer, la consulta devolvería 0 filas y el script lo dice en vez de
// dar un PASS vacío.
//
// Run: npm run validate:authority-licenses
import { createClient } from '@supabase/supabase-js';
import { loadEnvFile } from './lib/loadEnv';
import * as licensesModule from '../src/constants/licenses';

loadEnvFile();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (checked process.env and .env).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PART66_CODES = [...licensesModule.LICENSE_CODES].sort();

const EXPECTED: Record<string, string[]> = {
  EASA: PART66_CODES,
  UK_CAA: PART66_CODES,
  CASA: PART66_CODES.filter((c) => !['B2L', 'B3', 'L'].includes(c)),
  GCAA: PART66_CODES.filter((c) => c !== 'B2L'),
  FAA: ['A', 'A&P', 'P'],
};

async function main() {
  const errors: string[] = [];

  const { data, error } = await supabase.from('authority_licenses').select('authority, license_code');
  if (error) {
    console.error(`Could not query authority_licenses: ${error.message}`);
    console.log('\nRESULT: FAIL');
    process.exitCode = 1;
    return;
  }

  const rows = (data ?? []) as { authority: string; license_code: string }[];
  if (rows.length === 0) {
    errors.push('0 filas: o la tabla está vacía o RLS no deja leerla con la clave publicable');
  }

  // 1. Total y reparto por autoridad.
  if (rows.length !== 51) errors.push(`Esperaba 51 filas, hay ${rows.length}`);

  const pairs = rows.map((r) => `${r.authority}|${r.license_code}`);
  const duplicated = pairs.filter((p, i) => pairs.indexOf(p) !== i);
  if (duplicated.length > 0) errors.push(`Pares repetidos: ${[...new Set(duplicated)].join(', ')}`);

  const unknownAuthorities = [...new Set(rows.map((r) => r.authority))].filter((a) => !(a in EXPECTED));
  if (unknownAuthorities.length > 0) errors.push(`Autoridades no previstas: ${unknownAuthorities.join(', ')}`);

  // 2. Códigos exactos por autoridad.
  for (const [authority, expectedCodes] of Object.entries(EXPECTED)) {
    const actual = [...new Set(rows.filter((r) => r.authority === authority).map((r) => r.license_code))].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expectedCodes)) {
      errors.push(`${authority}: esperaba ${expectedCodes.length} [${expectedCodes.join(', ')}], hay ${actual.length} [${actual.join(', ')}]`);
    }
  }

  // 3. La constante TS que usa el código dice lo mismo que la tabla.
  //
  // Mientras la constante no exista es PENDIENTE, no error: la tabla llega con
  // el paso de esquema y la constante con el del código, y este script tiene
  // que poder validar la primera sin esperar a la segunda. Que la constante
  // llegue a existir ya lo exige el test "authority_licenses: 51 filas" de
  // scripts/testMatching.ts; en cuanto exista, la paridad es obligatoria.
  const tsTable = (licensesModule as unknown as Record<string, unknown>).AUTHORITY_LICENSES as
    | { authority: string; code: string }[]
    | undefined;
  if (!tsTable) {
    console.log('PENDIENTE: AUTHORITY_LICENSES aún no existe en src/constants/licenses.ts — paridad TS/tabla sin comprobar.');
  } else {
    const tsPairs = new Set(tsTable.map((r) => `${r.authority}|${r.code}`));
    const dbPairs = new Set(pairs);
    const onlyInDb = [...dbPairs].filter((p) => !tsPairs.has(p));
    const onlyInTs = [...tsPairs].filter((p) => !dbPairs.has(p));
    if (onlyInDb.length > 0) errors.push(`Sólo en la tabla: ${onlyInDb.join(', ')}`);
    if (onlyInTs.length > 0) errors.push(`Sólo en AUTHORITY_LICENSES: ${onlyInTs.join(', ')}`);
  }

  // 4. Paso 5b: la tabla `authorities` y la constante AUTHORITIES, etiquetas y
  // has_type_ratings incluidos. Las etiquetas se pintan en los selectores de
  // autoridad; que la constante diga otra cosa que la tabla es copy duplicado
  // que diverge sin que nadie lo vea.
  const { data: authData, error: authError } = await supabase
    .from('authorities')
    .select('code, label, has_type_ratings, sort_order');
  if (authError) {
    errors.push(`No se pudo leer authorities: ${authError.message}`);
  } else {
    const dbAuth = ((authData ?? []) as { code: string; label: string; has_type_ratings: boolean; sort_order: number }[])
      .map((a) => `${a.code}|${a.label}|${a.has_type_ratings}|${a.sort_order}`)
      .sort();
    const tsAuth = licensesModule.AUTHORITIES.map((a) => `${a.code}|${a.label}|${a.hasTypeRatings}|${a.sortOrder}`).sort();
    if (dbAuth.length === 0) errors.push('authorities: 0 filas (¿RLS?)');
    if (JSON.stringify(dbAuth) !== JSON.stringify(tsAuth)) {
      errors.push(`authorities difiere de AUTHORITIES:\n    tabla: ${dbAuth.join(', ')}\n    TS:    ${tsAuth.join(', ')}`);
    }
  }

  console.log('\n=== AUTHORITY LICENSES VALIDATION ===');
  console.log(`Total rows: ${rows.length}`);
  console.log(`Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\n--- Errors ---');
    errors.forEach((e) => console.log('  ERROR: ' + e));
    console.log('\nRESULT: FAIL');
    process.exitCode = 1;
  } else {
    console.log('\nRESULT: PASS');
  }
}

main().catch((err) => {
  console.error('Validation script crashed:', err);
  process.exit(1);
});
