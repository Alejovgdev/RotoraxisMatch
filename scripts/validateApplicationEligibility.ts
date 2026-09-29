// Comprueba que la elegibilidad de una oferta dice LO MISMO en TypeScript y en
// Postgres (Fase 10, paso 5c).
//
// ── Por qué existe ────────────────────────────────────────────────────
// La regla vive en dos sitios, y no por descuido: isTechnicianEligibleForOffer
// (src/utils/offerMatchExplain.ts) filtra las listas y las pantallas en el
// cliente, y el trigger de la migración 080 impide en la base que un técnico no
// elegible aplique. Postgres no puede ejecutar TypeScript (no hay plv8), así
// que el enforcer es SQL: public.offer_eligibility_reason, un núcleo que recibe
// HECHOS y no filas precisamente para poder probarlo así.
//
// Este script ejecuta las dos implementaciones sobre la misma matriz de casos,
// con el catálogo VIVO (ratings, motores y categorías de licencia reales), y
// falla si dan un motivo distinto en cualquiera. Mismo patrón que
// validate:state-machine.
//
// Reparto:
//   npm run test:matching                    -> la regla TS, offline
//   npm run validate:application-eligibility -> este: TS <-> base
//   la autocomprobación de la migración 080  -> el trigger sobre filas reales
//
// Run: npm run validate:application-eligibility
//
// Ensayo de una migración que cambia el núcleo, ANTES de aplicarla:
//   npm run validate:application-eligibility -- --rehearse=supabase/migrations/NNN_x.sql
// Aplica la migración y evalúa todos los casos en UNA transacción que termina
// en ROLLBACK, por la Management API (necesita SUPABASE_TEST_ACCESS_TOKEN o el
// SUPABASE_ACCESS_TOKEN del .env, igual que los runners de test:db). Sin la
// opción, pregunta al núcleo instalado por RPC con la clave publicable.
import { createClient } from '@supabase/supabase-js';
import { loadEnvFile } from './lib/loadEnv';
import { queryWithRehearsedMigration, rehearseArgument, sqlText } from './lib/rehearseMigration';
import { technicianIneligibilityReason, IneligibilityReason } from '../src/utils/offerMatchExplain';
import { AircraftTypeRatingRow, buildAircraftRatingIndex, mapAircraftTypeRatingRow } from '../src/constants/aircraftTypeRatings';
import { EngineRow, buildEngineIndex, mapEngineRow } from '../src/constants/engines';
import { OfferWithRequirements } from '../src/types/offer';
import { TechnicianWithRelations } from '../src/types/technician';
import { AircraftTypeRatingCatalog, EngineCatalog } from '../src/types/catalog';

loadEnvFile();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (checked process.env and .env).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const RATING_COLUMNS =
  'id, manufacturer, aircraft_family, engine_manufacturer, engine_family, easa_endorsement, display_name, commercial_aliases, aircraft_category, easa_group, engine_id, source_revision, priority, is_active, product_type';

async function loadActiveRatings(): Promise<AircraftTypeRatingCatalog[]> {
  const rows: AircraftTypeRatingRow[] = [];
  for (let page = 0; page < 20; page += 1) {
    const from = page * 500;
    const { data, error } = await supabase
      .from('aircraft_type_ratings')
      .select(RATING_COLUMNS)
      .eq('is_active', true)
      .order('id')
      .range(from, from + 499);
    if (error) throw new Error(`aircraft_type_ratings: ${error.message}`);
    rows.push(...((data ?? []) as unknown as AircraftTypeRatingRow[]));
    if ((data ?? []).length < 500) break;
  }
  return rows.map(mapAircraftTypeRatingRow);
}

async function loadEngines(): Promise<EngineCatalog[]> {
  const { data, error } = await supabase.from('engines').select('id, manufacturer, family, engine_type, display_name, is_active, is_generic').order('id');
  if (error) throw new Error(`engines: ${error.message}`);
  return ((data ?? []) as unknown as EngineRow[]).map(mapEngineRow);
}

interface Case {
  name: string;
  offerKind: 'aircraft' | 'engine';
  requiredEngineId?: string;
  onlyUnlicensed: boolean;
  licenseCount: number;
  /**
   * Sólo los ve TS. Desde la 091 el núcleo no recibe motores declarados (la vía
   * (a) se retiró), y la dimensión se conserva para probar que TS tampoco los
   * mira: con o sin motores, los dos lados tienen que decir lo mismo.
   */
  declaredEngineIds: string[];
  typeCodes: string[];
  habilitations: { licenseCode: string; ratingId: string }[];
}

const rehearseFile = rehearseArgument();

const sqlArray = (items: string[], type: 'text' | 'uuid') => `ARRAY[${items.map(sqlText).join(',')}]::${type}[]`;

/** Todos los casos contra el núcleo de `migrationFile`, en una transacción que se deshace. */
async function rehearsedReasons(cases: Case[], migrationFile: string): Promise<(string | null)[]> {
  const rows = cases.map((c, i) =>
    `(${i}, ${sqlText(c.offerKind)}, ${c.requiredEngineId ? `${sqlText(c.requiredEngineId)}::uuid` : 'NULL::uuid'}, ${c.onlyUnlicensed}, ${c.licenseCount}, ` +
    `${sqlArray(c.typeCodes, 'text')}, ${sqlArray(c.habilitations.map((h) => h.licenseCode), 'text')}, ${sqlArray(c.habilitations.map((h) => h.ratingId), 'uuid')})`,
  );
  const result = await queryWithRehearsedMigration<{ reasons: (string | null)[] }>(
    SUPABASE_URL as string,
    migrationFile,
    `SELECT coalesce(jsonb_agg(public.offer_eligibility_reason(c.kind, c.engine, c.only_unlicensed, c.licenses, c.types, c.codes, c.ratings) ORDER BY c.i), '[]') AS reasons
FROM (VALUES ${rows.join(',\n')}) AS c(i, kind, engine, only_unlicensed, licenses, types, codes, ratings)`,
  );
  const reasons = result[0]?.reasons;
  if (!Array.isArray(reasons) || reasons.length !== cases.length) throw new Error(`ensayo de ${migrationFile}: respuesta incompleta`);
  return reasons;
}

async function main() {
  const [ratings, engines] = await Promise.all([loadActiveRatings(), loadEngines()]);
  const ratingIndex = buildAircraftRatingIndex(ratings);
  const engineIndex = buildEngineIndex(engines);
  const errors: string[] = [];

  // ── Fixtures elegidos del catálogo real ─────────────────────────────
  const ratingsByEngine = new Map<string, AircraftTypeRatingCatalog[]>();
  for (const r of ratings) {
    if (!r.engineId) continue;
    ratingsByEngine.set(r.engineId, [...(ratingsByEngine.get(r.engineId) ?? []), r]);
  }
  // Lo que una oferta puede pedir: activo y no genérico (lo que ofrece el selector).
  const requestable = (e: EngineCatalog) => e.isActive && !e.isGeneric;
  const activeWithRatings = engines.filter((e) => requestable(e) && ratingsByEngine.has(e.id));
  // E: motor pedible con ratings y con un HERMANO de familia pedible que también tenga ratings.
  const required = activeWithRatings.find((e) => activeWithRatings.some((f) => f.id !== e.id && f.family === e.family));
  const sibling = required && activeWithRatings.find((f) => f.id !== required.id && f.family === required.family);
  const unrelated = required && activeWithRatings.find((u) => u.family !== required.family);
  // Genérico por `isGeneric` (089), no por `isActive`: son banderas distintas.
  const generic = engines.find((e) => e.isGeneric && ratingsByEngine.has(e.id) && engines.some((a) => requestable(a) && a.family === e.family));
  const genericFamilyEngine = generic && engines.find((a) => requestable(a) && a.family === generic.family);
  const noEngineRating = ratings.find((r) => !r.engineId);

  if (!required || !sibling || !unrelated || !generic || !genericFamilyEngine) {
    console.log('\nRESULT: FAIL — el catálogo vivo no tiene los motores que la matriz necesita (familia con dos motores, motor sin relación, genérico con familia).');
    process.exitCode = 1;
    return;
  }
  const ratingOf = (engineId: string) => ratingsByEngine.get(engineId)![0].id;
  const R = {
    exact: ratingOf(required.id),
    family: ratingOf(sibling.id),
    unrelated: ratingOf(unrelated.id),
    generic: ratingOf(generic.id),
    noEngine: noEngineRating?.id,
  };
  console.log(
    `Fixtures: pedido=${required.displayName} (${required.family}), familia=${sibling.displayName}, sin relación=${unrelated.displayName}, genérico=${generic.displayName}`,
  );

  // ── Matriz ──────────────────────────────────────────────────────────
  const habilitationSets: { name: string; habs: Case['habilitations'] }[] = [
    { name: 'sin habilitaciones', habs: [] },
    { name: 'B1.1 + motor exacto', habs: [{ licenseCode: 'B1.1', ratingId: R.exact }] },
    { name: 'B2 + motor exacto', habs: [{ licenseCode: 'B2', ratingId: R.exact }] },
    { name: 'C + motor exacto', habs: [{ licenseCode: 'C', ratingId: R.exact }] },
    { name: 'B2 y B1.1 + motor exacto', habs: [{ licenseCode: 'B2', ratingId: R.exact }, { licenseCode: 'B1.1', ratingId: R.exact }] },
    { name: 'B1.3 + misma familia', habs: [{ licenseCode: 'B1.3', ratingId: R.family }] },
    { name: 'B1.1 + motor sin relación', habs: [{ licenseCode: 'B1.1', ratingId: R.unrelated }] },
    ...(R.noEngine ? [{ name: 'B1.1 + rating sin motor', habs: [{ licenseCode: 'B1.1', ratingId: R.noEngine }] }] : []),
  ];
  const offers: { name: string; kind: Case['offerKind']; engine?: string }[] = [
    { name: 'aeronave', kind: 'aircraft' },
    { name: 'motor', kind: 'engine', engine: required.id },
  ];
  const cases: Case[] = [];
  for (const offer of offers) {
    for (const onlyUnlicensed of [false, true]) {
      for (const licenseCount of [0, 1]) {
        for (const declared of [[], [unrelated.id]]) {
          for (const typeCodes of [['mechanic'], ['engine_technician'], ['painter', 'engine_technician']]) {
            for (const set of habilitationSets) {
              cases.push({
                name: `${offer.name} | sólo sin licencia=${onlyUnlicensed} | licencias=${licenseCount} | motores=${declared.length} | ${typeCodes.join('+')} | ${set.name}`,
                offerKind: offer.kind,
                requiredEngineId: offer.engine,
                onlyUnlicensed,
                licenseCount,
                declaredEngineIds: declared,
                typeCodes,
                habilitations: set.habs,
              });
            }
          }
        }
      }
    }
  }
  // Genérico (isGeneric): B1.2 sobre un rating colgado de una fila sin modelo.
  for (const typeCodes of [['mechanic'], ['avionic']]) {
    cases.push({
      name: `motor de la familia del genérico | ${typeCodes.join('+')} | B1.2 + rating genérico`,
      offerKind: 'engine',
      requiredEngineId: genericFamilyEngine.id,
      onlyUnlicensed: false,
      licenseCount: 1,
      declaredEngineIds: [],
      typeCodes,
      habilitations: [{ licenseCode: 'B1.2', ratingId: R.generic }],
    });
  }

  function tsReason(c: Case): IneligibilityReason | null {
    const offer = { offerKind: c.offerKind, requiredEngineId: c.requiredEngineId, onlyUnlicensed: c.onlyUnlicensed } as OfferWithRequirements;
    const technician = {
      licenses: Array.from({ length: c.licenseCount }, (_, i) => ({ id: `lic-${i}`, authority: 'EASA', licenseCode: 'B1.1' })),
      engines: c.declaredEngineIds.map((engineId) => ({ id: `eng-${engineId}`, engineId })),
      technicianTypes: c.typeCodes,
      habilitations: c.habilitations.map((h, i) => ({ id: `hab-${i}`, licenseCode: h.licenseCode, aircraftTypeRatingId: h.ratingId })),
    } as unknown as TechnicianWithRelations;
    return technicianIneligibilityReason(offer, technician, ratingIndex, engineIndex);
  }

  async function sqlReason(c: Case): Promise<string | null> {
    const { data, error } = await supabase.rpc('offer_eligibility_reason', {
      p_offer_kind: c.offerKind,
      p_required_engine_id: c.requiredEngineId ?? null,
      p_only_unlicensed: c.onlyUnlicensed,
      p_license_count: c.licenseCount,
      p_type_codes: c.typeCodes,
      p_habilitation_license_codes: c.habilitations.map((h) => h.licenseCode),
      p_habilitation_rating_ids: c.habilitations.map((h) => h.ratingId),
    });
    // Un RPC que no responde NO es "elegible": sería el falso verde que esto
    // existe para impedir.
    if (error) throw new Error(`offer_eligibility_reason no responde (${error.code}): ${error.message}`);
    return (data as string | null) ?? null;
  }

  let sqlReasons: (string | null)[];
  if (rehearseFile) {
    console.log(`Ensayo: el núcleo de ${rehearseFile}, dentro de BEGIN … ROLLBACK.`);
    sqlReasons = await rehearsedReasons(cases, rehearseFile);
  } else {
    sqlReasons = [];
    for (let i = 0; i < cases.length; i += 20) sqlReasons.push(...(await Promise.all(cases.slice(i, i + 20).map(sqlReason))));
  }

  const outcomes = { eligible: 0, no_engine_experience: 0, licensed_technician: 0 };
  cases.forEach((c, i) => {
    const ts = tsReason(c);
    outcomes[(ts ?? 'eligible') as keyof typeof outcomes] += 1;
    if (ts !== sqlReasons[i]) errors.push(`${c.name}: TS=${ts ?? 'elegible'} SQL=${sqlReasons[i] ?? 'elegible'}`);
  });

  // Los casos que el paso 5b fijó, dichos explícitamente para que no dependan
  // de leer la matriz. Deben dar lo mismo en los dos lados (ya comprobado
  // arriba) Y dar ESTO.
  const expect = (name: string, c: Omit<Case, 'name'>, reason: IneligibilityReason | null) => {
    const ts = tsReason({ name, ...c });
    if (ts !== reason) errors.push(`Esperado en "${name}": ${reason ?? 'elegible'}, TS dice ${ts ?? 'elegible'}`);
  };
  const motor = { offerKind: 'engine' as const, requiredEngineId: required.id, onlyUnlicensed: false, declaredEngineIds: [] };
  expect('B1 con type rating del motor pedido entra', { ...motor, licenseCount: 1, typeCodes: ['mechanic'], habilitations: [{ licenseCode: 'B1.1', ratingId: R.exact }] }, null);
  expect('B2 con el mismo type rating no entra', { ...motor, licenseCount: 1, typeCodes: ['avionic'], habilitations: [{ licenseCode: 'B2', ratingId: R.exact }] }, 'no_engine_experience');
  expect('engine_technician sin motores entra', { ...motor, licenseCount: 0, typeCodes: ['engine_technician'], habilitations: [] }, null);
  expect('B1 sin motores ni ratings no entra', { ...motor, licenseCount: 1, typeCodes: ['mechanic'], habilitations: [] }, 'no_engine_experience');
  // 091: la vía (a) ya no existe. Un motor declarado sin el tipo no da entrada.
  expect('motor declarado sin engine_technician no entra', { ...motor, licenseCount: 0, declaredEngineIds: [required.id], typeCodes: ['mechanic'], habilitations: [] }, 'no_engine_experience');

  // Una matriz que sólo produjera un resultado no probaría nada.
  if (Object.values(outcomes).some((n) => n === 0)) {
    errors.push(`La matriz no cubre los tres resultados: ${JSON.stringify(outcomes)}`);
  }

  console.log('\n=== APPLICATION ELIGIBILITY: TS <-> SQL ===');
  console.log(`Casos: ${cases.length} · elegibles ${outcomes.eligible} · no_engine_experience ${outcomes.no_engine_experience} · licensed_technician ${outcomes.licensed_technician}`);
  console.log(`Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log('\n--- Errors ---');
    errors.slice(0, 50).forEach((e) => console.log('  ERROR: ' + e));
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
