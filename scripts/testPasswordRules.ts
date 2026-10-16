// Standalone tests — sin Supabase real. La contraseña al crearla o cambiarla:
//
//   - la regla pura (mínimo de 8 y repetición) y sus textos;
//   - que TODA pantalla que crea o cambia una contraseña (`auth.signUp`,
//     `auth.updateUser({ password })`) pasa por `newPasswordError`, y que nadie
//     escribe su propio mínimo a mano. Una pantalla nueva que se lo salte falla
//     aquí.
//
// Run via: npm run test:password-rules
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_PLACEHOLDER,
  PASSWORD_TOO_SHORT_TEXT,
  PASSWORDS_DO_NOT_MATCH_TEXT,
  newPasswordError,
} from '../src/auth/passwordRules';

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

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

const APP_SOURCES = [...sourceFiles('app'), ...sourceFiles('src')];
const SETS_PASSWORD = /auth\.signUp\(|auth\.updateUser\(\s*\{[^}]*\bpassword\b/;

test('el mínimo es 8 y el mensaje lo dice', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(PASSWORD_TOO_SHORT_TEXT, 'Password must be at least 8 characters.');
  assert.equal(PASSWORD_PLACEHOLDER, 'Min 8 characters');
});

test('7 caracteres no valen; 8 sí', () => {
  assert.equal(newPasswordError('', ''), PASSWORD_TOO_SHORT_TEXT);
  assert.equal(newPasswordError('1234567', '1234567'), PASSWORD_TOO_SHORT_TEXT);
  assert.equal(newPasswordError('12345678', '12345678'), null);
  assert.equal(newPasswordError('a long passphrase', 'a long passphrase'), null);
});

test('primero la longitud, después la repetición', () => {
  assert.equal(newPasswordError('1234567', 'otra'), PASSWORD_TOO_SHORT_TEXT);
  assert.equal(newPasswordError('12345678', '12345679'), PASSWORDS_DO_NOT_MATCH_TEXT);
});

test('toda pantalla que crea o cambia una contraseña usa la regla', () => {
  const setters = APP_SOURCES.filter((file) => SETS_PASSWORD.test(read(file)));
  // Si esta lista cambia, la búsqueda sigue viendo las tres de hoy.
  for (const known of ['app/auth/signup/technician.tsx', 'app/auth/signup/company.tsx', 'app/auth/set-password.tsx']) {
    assert.ok(setters.includes(known), `${known}: ya no crea ni cambia contraseñas, o la búsqueda no la ve`);
  }
  for (const file of setters) {
    const source = read(file);
    assert.match(source, /from '[./]+\/src\/auth\/passwordRules'/, `${file}: no importa passwordRules`);
    assert.match(source, /newPasswordError\(password, confirmPassword\)/, `${file}: no valida con newPasswordError`);
    assert.match(source, /placeholder=\{PASSWORD_PLACEHOLDER\}/, `${file}: la pista no sale de la regla`);
  }
});

test('nadie escribe su propio mínimo', () => {
  for (const file of APP_SOURCES) {
    if (file === 'src/auth/passwordRules.ts') continue;
    const source = read(file);
    assert.doesNotMatch(source, /password\.length\s*[<>]=?\s*\d/i, `${file}: mínimo escrito a mano`);
    assert.doesNotMatch(source, /Password must be at least \d+|placeholder="Min \d+ characters"/i, `${file}: texto del mínimo escrito a mano`);
  }
});

test('un rechazo del servidor al cambiarla sale con el texto de authErrorText', () => {
  assert.match(read('app/auth/set-password.tsx'), /if \(updateError\) throw new Error\(authErrorText\(updateError\)\)/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
