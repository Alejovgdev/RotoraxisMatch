// Standalone tests — sin Supabase y sin montar un navegador. Ejercitan la regla
// pura de src/utils/backNavigation.ts, la que decide adónde lleva la flecha de
// atrás cuando la pantalla se abrió por recarga o por enlace directo y el
// historial está vacío.
//
// El bug que cierran: `router.back()` sobre una pila de una sola pantalla lanza
// "GO_BACK was not handled by any navigator" y deja el botón muerto. En web es
// lo normal, no el caso raro — pasa al pulsar F5 o al abrir una URL compartida.
//
// Run via: npm run test:back-navigation
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { backDestination, roleHomeRoute } from '../src/utils/backNavigation';
import { AppRole, UserStatus } from '../src/types/enums';

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

const activo = (role: AppRole) => ({ role, status: 'active' as UserStatus });

// ── Con historial no se inventa nada ──────────────────────────────────────

test('Con historial, atrás es atrás — el rol no cambia nada', () => {
  for (const role of ['technician', 'company_user', 'admin'] as AppRole[]) {
    assert.deepEqual(backDestination(true, activo(role)), { kind: 'back' });
  }
  assert.deepEqual(backDestination(true, null), { kind: 'back' }, 'ni siquiera hace falta perfil');
});

// ── Sin historial: la pantalla de inicio del rol ──────────────────────────

test('Sin historial, la empresa va a su panel', () => {
  assert.deepEqual(backDestination(false, activo('company_user')), { kind: 'replace', href: '/company' });
});

test('Sin historial, el técnico va al suyo', () => {
  assert.deepEqual(backDestination(false, activo('technician')), { kind: 'replace', href: '/technician' });
});

test('Sin historial, el admin va al suyo', () => {
  assert.deepEqual(backDestination(false, activo('admin')), { kind: 'replace', href: '/admin' });
});

test('Sin historial y sin perfil resuelto, a la raíz — que ya sabe redirigir por rol', () => {
  assert.deepEqual(backDestination(false, null), { kind: 'replace', href: '/' });
  assert.deepEqual(backDestination(false, undefined), { kind: 'replace', href: '/' });
});

test('Sin historial se REEMPLAZA, nunca se apila', () => {
  const destino = backDestination(false, activo('company_user'));
  assert.equal(destino.kind, 'replace', 'un push dejaría una entrada de vuelta a la pantalla de la que se sale');
});

// ── El estado manda sobre el rol ──────────────────────────────────────────

test('Una cuenta no activa no tiene panel al que volver, sino sala de espera', () => {
  for (const role of ['technician', 'company_user', 'admin'] as AppRole[]) {
    for (const status of ['pending', 'rejected', 'suspended'] as UserStatus[]) {
      assert.deepEqual(
        backDestination(false, { role, status }),
        { kind: 'replace', href: '/auth/pending-verification' },
        `${role} + ${status}`,
      );
    }
  }
});

test('roleHomeRoute es la misma tabla para los tres roles activos', () => {
  assert.equal(roleHomeRoute('technician', 'active'), '/technician');
  assert.equal(roleHomeRoute('company_user', 'active'), '/company');
  assert.equal(roleHomeRoute('admin', 'active'), '/admin');
});

// ── Y que no quede ninguno suelto ─────────────────────────────────────────
//
// La regla sólo sirve si la usan TODOS los botones de atrás: uno que siga
// llamando a `router.back()` conserva el fallo entero en su pantalla. Es el
// mismo patrón que los tests de arquitectura del resto de suites.

test('Arquitectura — ninguna pantalla llama ya a router.back() por su cuenta', () => {
  // La raíz del proyecto, no __dirname: este fichero se ejecuta ya compilado
  // dentro de .tmp-test-back-navigation (mismo patrón que testLocation.ts).
  const root = process.cwd();
  // Los dos ficheros del helper: uno lo llama de verdad, el otro lo nombra en
  // su comentario de cabecera.
  const permitidos = [path.join('src', 'state', 'useGoBack.ts'), path.join('src', 'utils', 'backNavigation.ts')];

  const culpables: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const rel = path.relative(root, full);
      if (permitidos.includes(rel)) continue;
      const source = fs.readFileSync(full, 'utf8');
      source.split(/\r?\n/).forEach((line, i) => {
        if (/\brouter\.back\(\)/.test(line)) culpables.push(`${rel.split(path.sep).join('/')}:${i + 1}`);
      });
    }
  };
  walk(path.join(root, 'app'));
  walk(path.join(root, 'src'));

  assert.deepEqual(
    culpables,
    [],
    `router.back() directo (usa useGoBack()): ${culpables.join(', ')}`,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
