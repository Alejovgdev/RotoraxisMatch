import { supabase } from '../../lib/supabase';
import { LICENSE_CATEGORIES, LicenseCode } from '../../constants/licenses';
import { CONTRACT_TYPES } from '../../constants/contractTypes';
import { TECHNICIAN_TYPES } from '../../constants/technicianTypes';
import { COMPANY_TYPES } from '../../constants/companyTypes';
import {
  AircraftTypeRatingRow,
  filterAircraftTypeRatings,
  mapAircraftTypeRatingRow,
} from '../../constants/aircraftTypeRatings';
import { createAircraftTypeRatingsCache } from './aircraftTypeRatingsCache';
import { createLocationCountriesCache } from './locationCountriesCache';
import { createEnginesCache } from './enginesCache';
import { EngineRow, mapEngineRow } from '../../constants/engines';
import { ContractTypeCode, TechnicianTypeCode, CompanyTypeCode, AircraftTypeRatingCatalog, EngineCatalog } from '../../types/catalog';
import { CountryCatalogEntry } from '../../types/location';
import { throwIfError } from './supabaseMappers';

// public.aircraft_type_ratings is the ONLY source of truth for this catalog
// — see docs/archive/AIRCRAFT_TYPE_RATINGS_SUPABASE_SOURCE_REPORT.md. There is no
// TypeScript-side copy of the 80 rows anymore and no hardcoded fallback:
// a failed/empty load surfaces as an explicit state (see
// getAircraftTypeRatingsCacheStatus / useAircraftTypeRatingsCatalog), never
// a silent switch to baked-in data.
// product_type (Aeroplane/Helicopter/Gas Airship, the EASA source's own
// top-level classification) was added by migration 020, confirmed applied
// and populated for all 606 rows — see
// docs/archive/AIRCRAFT_TYPE_RATINGS_SUPABASE_SOURCE_REPORT.md and
// docs/archive/EASA_FULL_CATALOG_RECONCILIATION_REPORT.md. Not consumed by any UI
// yet; reserved for a later phase's category faceting.
const AIRCRAFT_TYPE_RATINGS_SELECT = `
  id,
  manufacturer,
  aircraft_family,
  engine_manufacturer,
  engine_family,
  easa_endorsement,
  display_name,
  commercial_aliases,
  aircraft_category,
  easa_group,
  engine_id,
  source_revision,
  priority,
  is_active,
  product_type,
  created_at,
  updated_at
`;

// ── Fase 5.6 (2026-07-28) — paginación completa + aserción dura ────────
//
// PostgREST corta CUALQUIER respuesta en 1000 filas, sin error y sin aviso
// (comprobado empíricamente contra el endpoint real: `Content-Range:
// 0-999/2500`). Este catálogo tiene 606 filas activas — el 61% de ese tope,
// y esta misión lo hizo crecer de 80 a 606.
//
// Un catálogo truncado no es "menos datos": es INSERVIBLE. Produciría
// ratings que un técnico no puede seleccionar en su perfil ni una empresa
// exigir en una oferta, sin ningún error visible. Y como esto alimenta la
// caché TTL compartida, el recorte se propagaría a toda la app durante toda
// la vida útil de la caché.
//
// Por eso aquí NO vale un aviso (a diferencia de search()/getPublicMatchCandidates(),
// donde sí — ver technicianRepositoryV2). Dos garantías:
//   1. Se pagina hasta agotar, nunca una ventana.
//   2. Se compara lo traído contra un `count: 'exact'` y se LANZA si no
//      coinciden — antes de devolver, así que la caché nunca llega a
//      poblarse con un catálogo incompleto (createAircraftTypeRatingsCache
//      solo escribe estado en la promesa resuelta; si esta rechaza, o
//      conserva el catálogo completo anterior o queda en 'error').
const CATALOG_PAGE_SIZE = 500;
// Cota de seguridad: 100 páginas = 50.000 filas, dos órdenes de magnitud por
// encima del catálogo real. Existe para que un bug del servidor no produzca
// un bucle infinito, no como límite funcional.
const CATALOG_MAX_PAGES = 100;

async function fetchActiveAircraftTypeRatings(): Promise<AircraftTypeRatingCatalog[]> {
  const rows: AircraftTypeRatingRow[] = [];
  let expectedTotal: number | null = null;

  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const from = page * CATALOG_PAGE_SIZE;
    const { data, error, count } = await supabase
      .from('aircraft_type_ratings')
      .select(AIRCRAFT_TYPE_RATINGS_SELECT, { count: 'exact' })
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('manufacturer', { ascending: true })
      .order('aircraft_family', { ascending: true })
      .order('engine_family', { ascending: true })
      // Desempate final por clave primaria: sin él, dos filas con la misma
      // tupla de ordenación pueden repetirse o saltarse entre páginas, que es
      // el fallo clásico de paginar por offset sobre un orden no total.
      .order('id', { ascending: true })
      .range(from, from + CATALOG_PAGE_SIZE - 1);
    throwIfError(error);

    if (expectedTotal === null) expectedTotal = count ?? null;
    const batch = (data ?? []) as unknown as AircraftTypeRatingRow[];
    rows.push(...batch);
    if (batch.length < CATALOG_PAGE_SIZE) break;
  }

  // La aserción dura. Falla ruidosamente en vez de servir un catálogo a medias.
  if (expectedTotal !== null && rows.length !== expectedTotal) {
    throw new Error(
      `Aircraft type ratings catalog is incomplete: fetched ${rows.length} of ${expectedTotal} rows. ` +
        'Refusing to populate the catalog cache with a partial catalog — a truncated catalog silently ' +
        'hides ratings from profiles, offers and matching. Check pagination and the PostgREST row limit.',
    );
  }

  return rows.map(mapAircraftTypeRatingRow);
}

// Deliberately does NOT filter on is_active — this is the path that resolves
// display labels for ratings that were deactivated after a technician/offer
// already referenced them. Always a single .in() query, never one request
// per id (see aircraftTypeRatingsCache.getRatingsByIds).
async function fetchAircraftTypeRatingsByIds(ids: string[]): Promise<AircraftTypeRatingCatalog[]> {
  const { data, error } = await supabase
    .from('aircraft_type_ratings')
    .select(AIRCRAFT_TYPE_RATINGS_SELECT)
    .in('id', ids);
  throwIfError(error);
  return ((data ?? []) as unknown as AircraftTypeRatingRow[]).map(mapAircraftTypeRatingRow);
}

// Module-scoped singleton: one cache shared by every screen/hook in the
// running app (technician profile, offer forms, matching, search) so the
// 80-row catalog is fetched once per session (or once per TTL window), not
// once per component.
const aircraftTypeRatingsCache = createAircraftTypeRatingsCache({
  fetchActive: fetchActiveAircraftTypeRatings,
  fetchByIds: fetchAircraftTypeRatingsByIds,
});

// ── location_countries (Fase 7, F2a) ───────────────────────────────────
//
// El catálogo de países que las migraciones 055/056 sembraron: 250 filas,
// 249 activas (UM está desactivado porque su centroide es (0,0)). Sustituirá
// a `location_airports` como fuente de localización, pero AÚN NO: a día de
// hoy ninguna pantalla ni ningún repositorio lee esto. La retirada de
// aeropuertos es F2b/F2c.
//
// Sin paginar, y aquí sí se puede razonar: son 250 filas contra el tope de
// 1000 de PostgREST, y el número no puede crecer solo — lo fija ISO-3166-1 y
// sólo cambia si alguien aplica una migración. No es el caso de
// aircraft_type_ratings, que creció de 80 a 606 durante una misión. Aun así
// se pide `count: 'exact'` y se compara, por el mismo motivo que allí: un
// catálogo truncado en silencio esconde países sin ningún error visible.
const LOCATION_COUNTRIES_SELECT = 'code, name, latitude, longitude';

interface LocationCountryRow {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
}

async function fetchActiveCountries(): Promise<CountryCatalogEntry[]> {
  const { data, error, count } = await supabase
    .from('location_countries')
    .select(LOCATION_COUNTRIES_SELECT, { count: 'exact' })
    .eq('is_active', true)
    .order('name', { ascending: true });
  throwIfError(error);

  const rows = (data ?? []) as unknown as LocationCountryRow[];

  if (count !== null && count !== undefined && rows.length !== count) {
    throw new Error(
      `Country catalog is incomplete: fetched ${rows.length} of ${count} rows. ` +
        'Refusing to populate the catalog cache with a partial list — a truncated country list ' +
        'silently hides countries from every location field.',
    );
  }

  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

const locationCountriesCache = createLocationCountriesCache({ fetchActive: fetchActiveCountries });

// ── engines (Fase 10, paso 5a) ─────────────────────────────────────────
//
// TODAS las filas, activas e inactivas — ver la cabecera de enginesCache.ts:
// de las 17 genéricas inactivas cuelgan 268 type ratings, y el matching
// necesita su `family` para darles crédito de familia.
//
// Sin paginar: 174 filas contra el tope de 1000 de PostgREST, y el catálogo
// sólo crece por migración. Aun así `count: 'exact'` y aserción dura, por el
// mismo motivo que en ratings: un catálogo truncado degrada escalones del
// matching sin ningún error visible.
const ENGINES_SELECT = 'id, manufacturer, family, engine_type, display_name, is_active, is_generic';

async function fetchAllEngines(): Promise<EngineCatalog[]> {
  const { data, error, count } = await supabase
    .from('engines')
    .select(ENGINES_SELECT, { count: 'exact' })
    .order('manufacturer', { ascending: true })
    .order('display_name', { ascending: true })
    .order('id', { ascending: true });
  throwIfError(error);

  const rows = (data ?? []) as unknown as EngineRow[];
  if (count !== null && count !== undefined && rows.length !== count) {
    throw new Error(
      `Engines catalog is incomplete: fetched ${rows.length} of ${count} rows. ` +
        'Refusing to populate the catalog cache with a partial catalog — a truncated catalog silently ' +
        'downgrades engine matching tiers.',
    );
  }
  return rows.map(mapEngineRow);
}

const enginesCache = createEnginesCache({ fetchAll: fetchAllEngines });

// public.aircraft_types (the legacy, coarser 33-row catalog) had a
// getAircraftTypes()/getAircraftType() pair here that queried it directly.
// Removed 2026-07-22 (migration 022): reading that table was never the
// fix — it's still a copy disconnected from the real 606-row
// aircraft_type_ratings catalog, just a database-backed one instead of a
// hardcoded one. The "Required aircraft types" broad filter now derives
// its options from getFamilies() over aircraft_type_ratings (see
// ApproximateFilterSection.tsx). Its TS mirror, constants/aircraftTypes.ts,
// was deleted 2026-07-27 (Fase 5.3, docs/MISSION_PART66.md) — nothing in
// src/ imports it anymore. The table itself, public.aircraft_types, is
// still live (migration 028, its DROP, is a separate checkpoint).

export const catalogRepository = {
  async getLicenseCategories() {
    return [...LICENSE_CATEGORIES];
  },

  async getLicenseCategory(code: LicenseCode) {
    return LICENSE_CATEGORIES.find((l) => l.code === code) ?? null;
  },

  async getContractTypes() {
    return [...CONTRACT_TYPES];
  },

  async getContractType(code: ContractTypeCode) {
    return CONTRACT_TYPES.find((c) => c.code === code) ?? null;
  },

  async getTechnicianTypes() {
    return [...TECHNICIAN_TYPES];
  },

  async getTechnicianType(code: TechnicianTypeCode) {
    return TECHNICIAN_TYPES.find((t) => t.code === code) ?? null;
  },

  async getCompanyTypes() {
    return [...COMPANY_TYPES];
  },

  async getCompanyType(code: CompanyTypeCode) {
    return COMPANY_TYPES.find((c) => c.code === code) ?? null;
  },

  // --- aircraft_type_ratings — Supabase-backed, cached (see aircraftTypeRatingsCache.ts) ---

  /** Active ratings only — the list new selections are made from. */
  async getAircraftTypeRatings(options: { forceRefresh?: boolean } = {}): Promise<AircraftTypeRatingCatalog[]> {
    return aircraftTypeRatingsCache.getActiveRatings(options);
  },

  /** Resolves a single rating by id, active or not (see getAircraftTypeRatingsByIds). */
  async getAircraftTypeRatingById(id: string): Promise<AircraftTypeRatingCatalog | null> {
    const [rating] = await aircraftTypeRatingsCache.getRatingsByIds([id]);
    return rating ?? null;
  },

  /**
   * Resolves many ratings by id in a single query, active or not. Use this
   * (never one getAircraftTypeRatingById call per id) whenever labels for a
   * list of technician/offer habilitations need to be displayed.
   */
  async getAircraftTypeRatingsByIds(ids: string[]): Promise<AircraftTypeRatingCatalog[]> {
    return aircraftTypeRatingsCache.getRatingsByIds(ids);
  },

  /** In-memory search over the cached active catalog — no SQL search needed for 80 rows. */
  async searchAircraftTypeRatings(query: string, options: { forceRefresh?: boolean } = {}): Promise<AircraftTypeRatingCatalog[]> {
    const ratings = await aircraftTypeRatingsCache.getActiveRatings(options);
    return filterAircraftTypeRatings(ratings, query);
  },

  getAircraftTypeRatingsCacheStatus() {
    return aircraftTypeRatingsCache.getState();
  },

  invalidateAircraftTypeRatingsCache(): void {
    aircraftTypeRatingsCache.invalidate();
  },

  // --- location_countries — Supabase-backed, cached (Fase 7 F2a) ---

  /** Países activos, ya ordenados por nombre. Sin lectores en producción todavía. */
  async getCountries(options: { forceRefresh?: boolean } = {}): Promise<CountryCatalogEntry[]> {
    return locationCountriesCache.getActiveCountries(options);
  },

  getCountriesCacheStatus() {
    return locationCountriesCache.getState();
  },

  invalidateCountriesCache(): void {
    locationCountriesCache.invalidate();
  },

  // --- engines — Supabase-backed, cached (Fase 10, paso 5a) ---

  /**
   * El catálogo de motores ENTERO, inactivos incluidos: es lo que necesita
   * `buildEngineIndex` para el matching. Un selector filtra con
   * `searchEngines` (activos y no genéricos).
   */
  async getEngines(options: { forceRefresh?: boolean } = {}): Promise<EngineCatalog[]> {
    return enginesCache.getEngines(options);
  },

  getEnginesCacheStatus() {
    return enginesCache.getState();
  },

  invalidateEnginesCache(): void {
    enginesCache.invalidate();
  },
};
