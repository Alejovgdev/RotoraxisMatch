// Fase 8, decisiones E y G, sin navegador.
//   E: notify() en web va a la ventana de la app (NoticeHost) con el mismo
//      título y texto; sin ella, a window.alert; en nativo, Alert.alert.
//   G: en el chat de escritorio (web, en panel) Enter envía y Mayúsculas+Enter
//      hace salto de línea; en móvil no cambia.
// Run via: npm run test:web-notices (también forma parte de npm test).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadPlatformAlert(os) {
  const calls = { browser: [], native: [] };
  const exportsObject = {};
  const source = read('src/utils/platformAlert.ts');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(compiled, {
    exports: exportsObject,
    window: { alert: (text) => calls.browser.push(text), confirm: () => true },
    require: (name) => {
      assert.equal(name, 'react-native');
      return { Platform: { OS: os }, Alert: { alert: (title, message) => calls.native.push([title, message]) } };
    },
  });
  return { ...exportsObject, calls };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS — ${name}`);
}

test('E — en web, con la ventana de la app montada, el aviso va a ella con el mismo texto y no al navegador', () => {
  const alerts = loadPlatformAlert('web');
  const seen = [];
  // Copia en este contexto: los objetos del vm tienen otro prototipo.
  const unregister = alerts.setWebNoticeHandler((notice) => seen.push({ title: notice.title, message: notice.message }));
  alerts.notify('Application sent', 'The company will be notified of your application.');
  alerts.notify('Error');
  assert.deepEqual(seen, [
    { title: 'Application sent', message: 'The company will be notified of your application.' },
    { title: 'Error', message: undefined },
  ]);
  assert.deepEqual(alerts.calls.browser, []);
  unregister();
  alerts.notify('Offer sent', 'The technician will be notified of your interest.');
  assert.deepEqual(alerts.calls.browser, ['Offer sent\n\nThe technician will be notified of your interest.'], 'sin ventana, la del navegador');
});

test('E — una ventana desmontada no quita a la que la sustituyó', () => {
  const alerts = loadPlatformAlert('web');
  const first = [];
  const second = [];
  const unregisterFirst = alerts.setWebNoticeHandler((n) => first.push(n));
  alerts.setWebNoticeHandler((n) => second.push(n));
  unregisterFirst();
  alerts.notify('Could not send');
  assert.equal(first.length, 0);
  assert.equal(second.length, 1);
});

test('E — en nativo no cambia nada: Alert.alert, aunque haya una ventana registrada', () => {
  const alerts = loadPlatformAlert('ios');
  const seen = [];
  alerts.setWebNoticeHandler((n) => seen.push(n));
  alerts.notify('Application sent', 'Done');
  assert.deepEqual(alerts.calls.native, [['Application sent', 'Done']]);
  assert.deepEqual(seen, []);
});

test('E — la ventana se monta en la raíz, sólo se registra en web y se monta sólo con un aviso (queda encima)', () => {
  assert.match(read('app/_layout.tsx'), /<NoticeHost \/>/);
  const host = read('src/components/ui/NoticeHost.tsx');
  assert.match(host, /if \(Platform\.OS !== 'web'\) return undefined;/);
  assert.match(host, /if \(!current\) return null;/);
  assert.match(read('src/components/ui/ConfirmDialog.tsx'), /export function NoticeDialog/);
});

test('E — "Email unavailable" en Help va por notify(): en web la ventana de la app (Alert.alert no pintaba nada), en nativo Alert.alert', () => {
  const support = read('app/support.tsx');
  assert.match(support, /notify\('Email unavailable', `Please write to \$\{email\}\.`\);/);
  assert.doesNotMatch(support, /Alert\.alert/);
});

test('G — Enter envía sólo en web y en panel (escritorio), con lo mismo que el botón; Mayúsculas+Enter y la composición no envían', () => {
  const chat = read('src/components/chat/ChatView.tsx');
  assert.match(chat, /const enterSends = pane && Platform\.OS === 'web' && composer\?\.kind === 'input';/);
  assert.match(chat, /if \(native\.key !== 'Enter' \|\| native\.shiftKey \|\| event\?\.shiftKey\) return;/);
  assert.match(chat, /if \(native\.isComposing \|\| native\.keyCode === 229\) return;/);
  assert.match(chat, /if \(draft && !composer\.sending\) composer\.onSend\(\);/);
  assert.match(chat, /disabled=\{!draft \|\| composer\.sending\}/, 'el botón tiene la misma condición');
  assert.match(chat, /onKeyPress=\{enterSends \? handleKeyPress : undefined\}/);
});

console.log(`\n${passed} passed, 0 failed`);
