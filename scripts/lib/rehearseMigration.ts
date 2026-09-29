import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from './loadEnv';

// Ensayo de una migración SIN aplicarla, para los validadores TS <-> SQL
// (`-- --rehearse=supabase/migrations/NNN_x.sql`): aplica la migración y
// ejecuta una consulta en UNA transacción que termina en ROLLBACK, por la
// Management API. Es lo que permite comprobar que un núcleo SQL nuevo dice lo
// mismo que TypeScript antes de llevarlo a producción.
//
// Token: el mismo orden que los runners de test:db
// (scripts/testDatabaseRegressions.cjs): el de test explícito, luego el
// SUPABASE_ACCESS_TOKEN del .env del proyecto, luego el heredado.

export function rehearseArgument(): string | undefined {
  return process.argv.find((a) => a.startsWith('--rehearse='))?.slice('--rehearse='.length);
}

function managementToken(): string | undefined {
  const envPath = path.join(findRepoRoot(__dirname), '.env');
  const fromFile = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='))
        ?.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^['"]|['"]$/g, '')
    : undefined;
  return process.env.SUPABASE_TEST_ACCESS_TOKEN ?? fromFile ?? process.env.SUPABASE_ACCESS_TOKEN;
}

/** Filas de `selectSql`, ejecutada después de `migrationFile` dentro de BEGIN … ROLLBACK. */
export async function queryWithRehearsedMigration<T>(supabaseUrl: string, migrationFile: string, selectSql: string): Promise<T[]> {
  const token = managementToken();
  const host = new URL(supabaseUrl).hostname;
  if (!token || !/^[a-z0-9]+\.supabase\.co$/.test(host)) throw new Error('--rehearse necesita un proyecto alojado y un token de la Management API');
  const migration = fs.readFileSync(path.resolve(findRepoRoot(__dirname), migrationFile), 'utf8');
  const response = await fetch(`https://api.supabase.com/v1/projects/${host.split('.')[0]}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `BEGIN;\n${migration}\n${selectSql};\nROLLBACK;` }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`ensayo de ${migrationFile}: HTTP ${response.status}: ${data.message ?? 'SQL failed'}`);
  if (!Array.isArray(data)) throw new Error(`ensayo de ${migrationFile}: respuesta inesperada`);
  return data as T[];
}

export const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;
