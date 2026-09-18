// Deliberately runs ONLY the two audited rollback suites, never migrations.
// Needs a Management API token for the project in EXPO_PUBLIC_SUPABASE_URL.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fileEnv = fs.existsSync(path.join(root, '.env'))
  ? Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })) : {};
// An explicitly provided test token wins. The project's .env token precedes
// an inherited token, which can belong to another workspace or be expired.
const token = process.env.SUPABASE_TEST_ACCESS_TOKEN ?? fileEnv.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_ACCESS_TOKEN;
const url = fileEnv.EXPO_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
async function main() {
  if (!token || !url) throw new Error('Missing Supabase URL or Management API test token');
  const host = new URL(url).hostname;
  if (!/^[a-z0-9]+\.supabase\.co$/.test(host)) throw new Error('Expected a hosted Supabase project URL');
  const ref = host.split('.')[0];
  for (const [file, expected] of [['testApplicationSecurity.sql', 13], ['testTransactionalWrites.sql', 17]]) {
    const query = fs.readFileSync(path.join(__dirname, file), 'utf8');
    if (!/\bBEGIN;/.test(query) || !/ROLLBACK;\s*$/.test(query)) throw new Error(`Missing rollback wrapper: ${file}`);
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }), signal: AbortSignal.timeout(60000),
    });
    const rows = await response.json();
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}: ${rows.message ?? 'SQL failed'}`);
    if (!Array.isArray(rows) || rows.length !== expected) throw new Error(`${file}: incomplete test results`);
    for (const row of rows) console.log(`${row.passed === true ? 'PASS' : 'FAIL'} ${row.test}`);
    if (rows.some(row => row.passed !== true)) throw new Error(`${file}: regression failed`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
