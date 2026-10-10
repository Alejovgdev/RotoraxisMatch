// Comprobación estática: ningún botón dentro de otro botón.
//
// En web, react-native-web pinta como <button> todo lo que lleva
// role="button" (Pressable, TouchableOpacity, PillButton, Chip…), y HTML no
// admite un <button> dentro de otro: React avisa ("<button> cannot be a
// descendant of <button>") y el navegador rompe el árbol. En el rediseño una
// fila entera pulsable llevaba dentro "View profile"; esto avisa si vuelve a
// pasar.
//
// Cómo decide, sin ejecutar nada (TypeScript compiler API):
//   1. Qué es un botón: Pressable / Touchable* con role o accessibilityRole
//      "button" literal, y los componentes del proyecto que pintan uno en
//      cualquier punto de su JSX (se deduce siguiendo los imports, también los
//      re-exports de un index.ts). Los que sólo lo son con onPress (StatTile,
//      ListRow, CompanyChip) cuentan cuando se les pasa onPress.
//   2. Dentro de cada botón recorre sus hijos y sus props con JSX, las
//      funciones que devuelven JSX (render props) y las constantes locales de
//      la misma función usadas como {nombre}. Si encuentra otro botón, falla.
//
// Run via: npm run check:nested-buttons (también forma parte de npm test).
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
// Por defecto, toda la app. La autoprueba (--self-test) apunta a los ejemplos
// de scripts/fixtures/nested-buttons/.
const SCAN_DIRS = (process.env.NESTED_BUTTONS_SCAN || 'app,src').split(',');

if (process.argv.includes('--self-test')) {
  const { spawnSync } = require('node:child_process');
  const run = (dir) => spawnSync(process.execPath, [__filename], {
    env: { ...process.env, NESTED_BUTTONS_SCAN: dir },
    encoding: 'utf8',
  });
  const bad = run('scripts/fixtures/nested-buttons/bad');
  const good = run('scripts/fixtures/nested-buttons/good');
  // Una línea por caso: "  fichero:línea — <X> dentro de <Y>".
  const badCount = (bad.stderr.match(/^ {2}\S.* — <.+> dentro de <.+>$/gm) || []).length;
  // bad.tsx tiene SEIS casos (ver el fichero); good.tsx, ninguno.
  if (bad.status !== 1 || badCount !== 6) {
    console.error(`FAIL — la autoprueba no detecta los 6 casos de bad.tsx (encontró ${badCount}):`);
    console.error(bad.stdout + bad.stderr);
    process.exit(1);
  }
  if (good.status !== 0) {
    console.error('FAIL — la autoprueba da avisos falsos en good.tsx:');
    console.error(good.stdout + good.stderr);
    process.exit(1);
  }
  console.log('PASS — autoprueba: detecta los 6 botones anidados de ejemplo y ninguno en el ejemplo correcto');
  process.exit(0);
}
const HOST_TOUCHABLES = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback']);
// Componentes que sólo pintan un botón si reciben onPress.
const BUTTON_ONLY_WITH_ONPRESS = new Set(['StatTile', 'ListRow', 'CompanyChip']);

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => listFiles(path.join(ROOT, d)));
const sources = new Map(files.map((f) => [f, ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)]));

function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}.native.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

function tagName(node) {
  const name = node.tagName;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) return name.name.text;
  return null;
}

function attribute(node, attrName) {
  for (const prop of node.attributes.properties) {
    if (ts.isJsxAttribute(prop) && prop.name.getText() === attrName) return prop;
  }
  return null;
}

function literalAttr(node, attrName) {
  const attr = attribute(node, attrName);
  if (!attr || !attr.initializer) return null;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression && ts.isStringLiteral(attr.initializer.expression)) {
    return attr.initializer.expression.text;
  }
  return null;
}

function openingOf(node) {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

// ── 1. Qué componentes pintan un botón ───────────────────────────────────

// Por fichero: nombre local -> { file, exported name } de cada import.
function importsOf(file) {
  const map = new Map();
  for (const stmt of sources.get(file).statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const target = resolveModule(file, stmt.moduleSpecifier.text);
    if (!target) continue;
    const bindings = stmt.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        map.set(el.name.text, { file: target, name: (el.propertyName ?? el.name).text });
      }
    }
  }
  return map;
}

// Los componentes declarados en un fichero (function X / const X = (...) =>).
function componentsOf(file) {
  const out = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) out.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text) && node.initializer) {
      let init = node.initializer;
      if (ts.isCallExpression(init) && init.arguments.length > 0) init = init.arguments[init.arguments.length - 1];
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) out.set(node.name.text, init);
    }
    ts.forEachChild(node, visit);
  };
  visit(sources.get(file));
  return out;
}

// Re-exports: `export { X } from './X'`.
function reExportsOf(file) {
  const map = new Map();
  for (const stmt of sources.get(file).statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue;
    const target = resolveModule(file, stmt.moduleSpecifier.text);
    if (!target) continue;
    for (const el of stmt.exportClause.elements) map.set(el.name.text, { file: target, name: (el.propertyName ?? el.name).text });
  }
  return map;
}

const componentCache = new Map(); // file -> Map(name -> fn node)
const importCache = new Map();
const reExportCache = new Map();
const cached = (cache, fn, file) => { if (!cache.has(file)) cache.set(file, fn(file)); return cache.get(file); };

/** Dónde está definido el componente `name` usado en `file`. */
function resolveComponent(file, name, depth = 0) {
  if (depth > 6) return null;
  const local = cached(componentCache, componentsOf, file).get(name);
  if (local) return { file, name, node: local };
  const imported = cached(importCache, importsOf, file).get(name);
  if (imported) return resolveExported(imported.file, imported.name, depth + 1);
  return null;
}

function resolveExported(file, name, depth) {
  const local = cached(componentCache, componentsOf, file).get(name);
  if (local) return { file, name, node: local };
  const re = cached(reExportCache, reExportsOf, file).get(name);
  if (re) return resolveExported(re.file, re.name, depth + 1);
  return null;
}

const rendersButtonCache = new Map(); // `${file}#${name}` -> boolean

/** ¿Pinta este componente un botón en algún punto de su JSX? */
function componentRendersButton(def) {
  const key = `${def.file}#${def.name}`;
  if (rendersButtonCache.has(key)) return rendersButtonCache.get(key);
  rendersButtonCache.set(key, false); // corta ciclos
  let found = false;
  const visit = (node) => {
    if (found) return;
    const opening = openingOf(node);
    if (opening && isButtonElement(def.file, opening)) { found = true; return; }
    ts.forEachChild(node, visit);
  };
  visit(def.node);
  rendersButtonCache.set(key, found);
  return found;
}

/** ¿Es este elemento JSX un botón (o algo que pinta uno)? */
function isButtonElement(file, opening) {
  const name = tagName(opening);
  if (!name || !/^[A-Z]/.test(name)) return false;
  if (HOST_TOUCHABLES.has(name)) {
    const role = literalAttr(opening, 'accessibilityRole') ?? literalAttr(opening, 'role');
    return role === 'button';
  }
  if (BUTTON_ONLY_WITH_ONPRESS.has(name) && !attribute(opening, 'onPress')) return false;
  const def = resolveComponent(file, name);
  return Boolean(def && componentRendersButton(def));
}

// ── 2. Botones dentro de botones ─────────────────────────────────────────

function enclosingFunction(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}

/** La constante local `name` declarada en la función que contiene a `from`. */
function localInitializer(from, name) {
  let fn = enclosingFunction(from);
  while (fn) {
    let found = null;
    const visit = (node) => {
      if (found) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
        found = node.initializer;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body ?? fn);
    if (found) return found;
    fn = enclosingFunction(fn);
  }
  return null;
}

/** Un identificador que se LEE como valor (no `obj.nombre`, ni un atributo, ni una etiqueta). */
function isValueReference(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isJsxAttribute(parent) && parent.name === node) return false;
  if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && parent.tagName === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) || ts.isBindingElement(parent)) return false;
  return true;
}

const violations = [];

function findNestedButton(file, root, outerName, seen) {
  const report = (node, inner) => {
    const sf = sources.get(file);
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push(`${path.relative(ROOT, file)}:${line + 1} — <${inner}> dentro de <${outerName}>`);
  };
  const visit = (node) => {
    const opening = openingOf(node);
    if (opening && isButtonElement(file, opening)) {
      report(node, tagName(opening));
      return;
    }
    // Una constante local usada dentro del botón, esté donde esté
    // ({acciones}, {wide ? acciones : null}, {a ?? b}…): se mira su valor.
    if (ts.isIdentifier(node) && isValueReference(node)) {
      const id = node.text;
      if (!seen.has(id)) {
        const init = localInitializer(node, id);
        if (init) {
          seen.add(id);
          visit(init);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  // Hijos y props del botón (lo que va en sus props se pinta dentro de él).
  if (ts.isJsxElement(root)) {
    for (const child of root.children) visit(child);
    for (const prop of root.openingElement.attributes.properties) visit(prop);
  } else {
    for (const prop of root.attributes.properties) visit(prop);
  }
}

for (const [file, sf] of sources) {
  if (!file.endsWith('.tsx')) continue;
  const visit = (node) => {
    const opening = openingOf(node);
    if (opening && isButtonElement(file, opening)) {
      const name = tagName(opening);
      // Un componente que pinta un botón cuenta como botón, pero sus props
      // sólo se revisan si es un botón "de verdad" (host o PillButton/Chip…
      // cuyo JSX raíz es el botón). Para no dar falsos avisos con
      // contenedores (BottomSheet con un footer de botones), sólo se miran
      // los hijos de los touchables host y los props/hijos de componentes
      // cuya raíz renderizada es un botón.
      if (HOST_TOUCHABLES.has(name) || componentRootIsButton(file, name)) {
        findNestedButton(file, node, name, new Set());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** ¿El JSX que devuelve el componente tiene un botón como elemento raíz? */
function componentRootIsButton(file, name) {
  if (BUTTON_ONLY_WITH_ONPRESS.has(name)) return true;
  const def = resolveComponent(file, name);
  if (!def) return false;
  let rootIsButton = false;
  const visitReturn = (node) => {
    if (rootIsButton) return;
    if (ts.isReturnStatement(node) && node.expression) checkRoot(node.expression);
    // No entrar en funciones anidadas: sus return no son el del componente.
    if (node !== def.node && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return;
    ts.forEachChild(node, visitReturn);
  };
  const checkRoot = (expr) => {
    let e = expr;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isConditionalExpression(e)) { checkRoot(e.whenTrue); checkRoot(e.whenFalse); return; }
    const opening = openingOf(e);
    if (opening && isButtonElement(def.file, opening) && (HOST_TOUCHABLES.has(tagName(opening)) || componentRootIsButton(def.file, tagName(opening)))) {
      rootIsButton = true;
    }
  };
  if (ts.isArrowFunction(def.node) && !ts.isBlock(def.node.body)) checkRoot(def.node.body);
  else visitReturn(def.node);
  return rootIsButton;
}

if (violations.length > 0) {
  console.error(`FAIL — ${violations.length} botón(es) dentro de otro botón (en web, <button> dentro de <button>):`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`PASS — ningún botón dentro de otro botón (${sources.size} ficheros revisados)`);
