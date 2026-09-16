import { AircraftTypeRatingCatalog } from '../types/catalog';

// EASA Part-66 aircraft-engine type rating catalog — TYPES AND PURE
// FUNCTIONS ONLY. The 80-entry catalog itself lives exclusively in
// Supabase (public.aircraft_type_ratings) — see
// src/repositories/v2/catalogRepository.ts for the query and cache, and
// docs/archive/AIRCRAFT_TYPE_RATINGS_SUPABASE_SOURCE_REPORT.md for why the dual
// TypeScript+SQL copy that used to live in this file was removed.
//
// Every function here takes the catalog (or an index built from it) as an
// argument — nothing in this file imports Supabase or holds catalog data of
// its own. There is deliberately no hardcoded fallback catalog: a failed or
// empty load is surfaced as a loading/error/empty state to the UI (see
// useAircraftTypeRatingsCatalog), never silently masked by stale baked-in
// data.

// Fast id -> rating lookup, built once per loaded catalog snapshot and
// threaded through matching/adapters instead of each of them holding (or
// re-fetching) their own copy.
export type AircraftRatingIndex = Map<string, AircraftTypeRatingCatalog>;

export function buildAircraftRatingIndex(ratings: AircraftTypeRatingCatalog[]): AircraftRatingIndex {
  return new Map(ratings.map((r) => [r.id, r]));
}

export function normalizeAircraftRatingSearchText(value: string): string {
  return value.trim().toLowerCase();
}

// '/'-split tokens of the family field, e.g. "A318/A319/A320/A321" ->
// ["a318","a319","a320","a321"]. Deliberately not split on whitespace too —
// that would make e.g. "Bell 206/AB206" and "Bell 407" share the "bell"
// token and falsely report unrelated airframes as related.
function familyTokens(family: string): string[] {
  return family.split('/').map((part) => normalizeAircraftRatingSearchText(part)).filter(Boolean);
}

// Two ratings are "related" (same commercial family, different engine) when
// they share the same manufacturer and at least one aircraft_family token —
// e.g. "Airbus A320 family — CFM56" and "Airbus A320 family — V2500" both
// cover A319/A320/A321. Never true for the same rating id or when either id
// is missing from the index (e.g. a pending catalog request, never a real
// rating).
export function areRatingsRelated(idA: string, idB: string, ratingIndex: AircraftRatingIndex): boolean {
  if (idA === idB) return false;
  const a = ratingIndex.get(idA);
  const b = ratingIndex.get(idB);
  if (!a || !b) return false;
  if (normalizeAircraftRatingSearchText(a.manufacturer) !== normalizeAircraftRatingSearchText(b.manufacturer)) return false;
  const tokensA = new Set(familyTokens(a.aircraftFamily));
  return familyTokens(b.aircraftFamily).some((t) => tokensA.has(t));
}

// Fase 5.3 (2026-07-28) — two functions lived here and are now gone with
// the pre-Part-66 aircraft_types catalog they served:
//   - ratingMatchesLegacyCode(): alias lookup for a bare legacy code. Its
//     only consumer was the backfill planner, deleted with the script.
//   - resolveLegacyCodeToFamilyKeys(): inclusive code -> family resolution,
//     feeding the T3 match tier, the repository/matching broad filters and
//     the legacy label in HabilitationsEditor. All four removed.
// commercialAliases itself stays on the catalog rows — it is what the
// AircraftTypeRatingPicker searches on, which is a live feature.

export function getAircraftTypeRatingLabel(id: string, ratingIndex: AircraftRatingIndex): string {
  return ratingIndex.get(id)?.displayName ?? id;
}

// Stable "<manufacturer>::<aircraftFamily>" identity for a family group —
// the same compound key areRatingsRelated() already treats as "the same
// family" above, and the exact string aircraftTypeRatingViews.ts's
// getFamilies() groups by and the broad/approximate aircraft-type filter
// persists (migration 022) instead of a legacy aircraft_types(code) value.
// Centralized here so the UI grouping and the persisted/matching value can
// never drift apart.
export function getAircraftFamilyKey(rating: Pick<AircraftTypeRatingCatalog, 'manufacturer' | 'aircraftFamily'>): string {
  return `${rating.manufacturer}::${rating.aircraftFamily}`;
}

// ¿Cubre esta habilitación la familia pedida? A través de su rating resuelto,
// y solo así (Fase 5.3: la vía del código de aeronave legacy desapareció con
// el catálogo aircraft_types).
//
// IMPLEMENTACIÓN ÚNICA (2026-07-28): vivía duplicada literalmente en
// offerMatchExplain.ts y technicianRepositoryV2.ts — el filtro amplio del
// scorer y el de búsqueda del repositorio tienen que responder EXACTAMENTE lo
// mismo, o una empresa vería en la búsqueda técnicos que el matching luego
// puntúa a cero, y al revés. Dos copias es la forma de que eso pase sin que
// nadie se entere. Vive aquí porque es una función pura sobre el catálogo,
// que es lo que este fichero contiene por contrato (ver CLAUDE.md).
export function habilitationCoversFamilyKey(
  habilitation: { aircraftTypeRatingId?: string },
  familyKey: string,
  ratingIndex: AircraftRatingIndex,
): boolean {
  if (!habilitation.aircraftTypeRatingId) return false;
  const rating = ratingIndex.get(habilitation.aircraftTypeRatingId);
  return Boolean(rating && getAircraftFamilyKey(rating) === familyKey);
}

function sortComparator(a: AircraftTypeRatingCatalog, b: AircraftTypeRatingCatalog): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.manufacturer !== b.manufacturer) return a.manufacturer.localeCompare(b.manufacturer);
  if (a.aircraftFamily !== b.aircraftFamily) return a.aircraftFamily.localeCompare(b.aircraftFamily);
  return (a.engineFamily ?? '').localeCompare(b.engineFamily ?? '');
}

export function sortAircraftTypeRatings(ratings: AircraftTypeRatingCatalog[]): AircraftTypeRatingCatalog[] {
  return [...ratings].sort(sortComparator);
}

// Search across manufacturer, family, engine, EASA denomination, display
// name and aliases. Ranked by: 1) match quality (exact > starts-with >
// contains) 2) priority 3) manufacturer 4) family 5) engine. Empty/blank
// query returns the given catalog sorted in the same priority order.
//
// Pure — operates on whatever catalog snapshot is passed in (the full
// active list from the repository/hook, or a handful of fixtures in a
// test). Never reads is_active itself: callers are expected to pass an
// already-active-filtered list when "must not offer inactive entries for
// new selections" matters (see catalogRepository.getAircraftTypeRatings()).
export function filterAircraftTypeRatings(ratings: AircraftTypeRatingCatalog[], query: string): AircraftTypeRatingCatalog[] {
  const q = normalizeAircraftRatingSearchText(query);
  if (!q) return sortAircraftTypeRatings(ratings);

  function matchTier(r: AircraftTypeRatingCatalog): number | null {
    const haystacksExact = [r.displayName, r.easaEndorsement, r.manufacturer, r.aircraftFamily, r.engineFamily ?? '', ...r.commercialAliases];
    if (haystacksExact.some((h) => normalizeAircraftRatingSearchText(h) === q)) return 0;
    if (haystacksExact.some((h) => normalizeAircraftRatingSearchText(h).startsWith(q))) return 1;
    if (haystacksExact.some((h) => normalizeAircraftRatingSearchText(h).includes(q))) return 2;
    return null;
  }

  return ratings
    .map((r) => ({ r, tier: matchTier(r) }))
    .filter((entry): entry is { r: AircraftTypeRatingCatalog; tier: number } => entry.tier !== null)
    .sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : sortComparator(a.r, b.r)))
    .map((entry) => entry.r);
}

// Loosely-typed snake_case row shape, matching the Supabase
// aircraft_type_ratings SELECT in catalogRepository.ts. Kept as a plain
// pure function (not colocated with the repository) so it can be unit
// tested without importing src/lib/supabase.ts — see scripts/testMatching.ts.
export interface AircraftTypeRatingRow {
  id: string;
  manufacturer: string;
  aircraft_family: string;
  engine_manufacturer?: string | null;
  engine_family?: string | null;
  easa_endorsement: string;
  display_name: string;
  commercial_aliases?: string[] | null;
  aircraft_category: string;
  easa_group?: string | null;
  // Fase 10 (migración 069). Única fuente del motor implícito: las dos
  // columnas de texto de arriba están sucias y no se leen para eso.
  engine_id?: string | null;
  source_revision?: string | null;
  priority: number;
  is_active: boolean;
  product_type?: string | null;
}

export function mapAircraftTypeRatingRow(row: AircraftTypeRatingRow): AircraftTypeRatingCatalog {
  return {
    id: row.id,
    manufacturer: row.manufacturer,
    aircraftFamily: row.aircraft_family,
    engineManufacturer: row.engine_manufacturer ?? undefined,
    engineFamily: row.engine_family ?? undefined,
    easaEndorsement: row.easa_endorsement,
    displayName: row.display_name,
    commercialAliases: row.commercial_aliases ?? [],
    aircraftCategory: row.aircraft_category as AircraftTypeRatingCatalog['aircraftCategory'],
    easaGroup: row.easa_group ?? undefined,
    engineId: row.engine_id ?? undefined,
    sourceRevision: row.source_revision ?? undefined,
    productType: (row.product_type ?? undefined) as AircraftTypeRatingCatalog['productType'],
    priority: row.priority,
    isActive: row.is_active,
  };
}
