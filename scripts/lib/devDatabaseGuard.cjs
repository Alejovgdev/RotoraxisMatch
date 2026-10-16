// Candado de los scripts que ESCRIBEN en la base, aunque sea dentro de
// BEGIN … ROLLBACK: test:db, los test:*:database, los rehearse*.cjs y el modo
// --rehearse de los validadores. Sólo corren contra la base de desarrollo; si
// EXPO_PUBLIC_SUPABASE_URL apunta a cualquier otra, paran antes de leer o
// enviar nada.
//
// Mira las DOS fuentes de la URL, el .env del proyecto y la variable del
// terminal, porque los .cjs prefieren la del .env y los validadores TS la del
// terminal: todas las que existan tienen que ser dev.
//
// `npm run test:dev-db-guard` comprueba que cada script escritor pasa por aquí.
const fs = require('node:fs');
const path = require('node:path');

const DEV_PROJECT_REF = 'rwauwuremzkizeoginza';
const DEV_SUPABASE_URL = `https://${DEV_PROJECT_REF}.supabase.co`;

function projectRef(url) {
  try {
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(new URL(url).hostname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function envFileUrl(root) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(l => l.startsWith('EXPO_PUBLIC_SUPABASE_URL='));
  return line?.slice('EXPO_PUBLIC_SUPABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '');
}

/** El motivo para parar, o null si todas las URLs definidas son la de dev. */
function devDatabaseProblem(sources) {
  const defined = Object.entries(sources).filter(([, url]) => url !== undefined && url !== '');
  const foreign = defined.filter(([, url]) => projectRef(url) !== DEV_PROJECT_REF);
  if (defined.length > 0 && foreign.length === 0) return null;
  const rows = Object.entries(sources).map(([source, url]) => {
    const value = url === undefined || url === '' ? '(sin definir)' : url;
    const mark = foreign.some(([s]) => s === source) ? '   <- NO es dev' : '';
    return `     ${source.padEnd(9)} ${value}${mark}`;
  });
  return [
    `PARADO: ${path.basename(process.argv[1] ?? 'este script')} escribe en la base de datos (aunque sea dentro de BEGIN … ROLLBACK)`,
    `y sólo puede ejecutarse contra la base de desarrollo, ${DEV_PROJECT_REF}.`,
    defined.length === 0 ? '   EXPO_PUBLIC_SUPABASE_URL no está definida:' : '   EXPO_PUBLIC_SUPABASE_URL apunta a otra base:',
    ...rows,
    `   No se ha enviado nada. Haz que apunte a ${DEV_SUPABASE_URL} (en el .env y, si la defines, en el terminal) y vuelve a lanzarlo.`,
  ].join('\n');
}

/**
 * Para el proceso (código 1) si la URL no es la de dev. `extra`: otras URLs que
 * el script vaya a usar, p. ej. `{ script: supabaseUrl }`.
 */
function assertDevDatabase(extra = {}) {
  const problem = devDatabaseProblem({
    '.env': envFileUrl(path.resolve(__dirname, '..', '..')),
    terminal: process.env.EXPO_PUBLIC_SUPABASE_URL,
    ...extra,
  });
  if (problem === null) return;
  console.error(problem);
  process.exit(1);
}

module.exports = { DEV_PROJECT_REF, DEV_SUPABASE_URL, assertDevDatabase, devDatabaseProblem, projectRef };
