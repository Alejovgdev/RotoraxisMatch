import { EngineCatalog, EngineType } from '../types/catalog';

// Catálogo de motores (`engines`, migración 067) — TIPOS Y FUNCIONES PURAS,
// NADA MÁS. Las 164 filas viven exclusivamente en Supabase, igual que las de
// `aircraft_type_ratings`: aquí no hay copia ni respaldo horneado, y una carga
// vacía o fallida se cuenta como tal en vez de taparse con datos rancios.
//
// Todo lo de este fichero recibe el índice como argumento. Es lo que permite
// que el scorer siga siendo puro y comprobable sin base de datos.

/**
 * Búsqueda rápida id -> motor, construida una vez por snapshot del catálogo y
 * pasada al scorer, igual que `AircraftRatingIndex`.
 *
 * Un id ausente del índice —catálogo a medio cargar, motor desactivado desde
 * que se guardó la oferta— resuelve a "no se sabe", nunca a una excepción.
 */
export type EngineIndex = Map<string, EngineCatalog>;

export function buildEngineIndex(engines: EngineCatalog[]): EngineIndex {
  return new Map(engines.map((e) => [e.id, e]));
}

/**
 * ¿Son el mismo motor? Por id, y sólo por id.
 *
 * Existe como función con nombre para que el escalón "motor exacto" no se
 * escriba nunca comparando textos: `displayName` y `family` son datos de
 * presentación y de agrupación, no identidad.
 */
export function isSameEngine(idA: string | undefined, idB: string | undefined): boolean {
  return Boolean(idA) && idA === idB;
}

export function getEngineLabel(id: string, engineIndex: EngineIndex): string {
  return engineIndex.get(id)?.displayName ?? id;
}

/**
 * Búsqueda en memoria sobre el catálogo, para los selectores (paso 5b).
 *
 * SÓLO ACTIVOS: las genéricas "<fabricante> (model not specified)" están
 * inactivas para que nadie las declare ni las pida —el matching les da crédito
 * de familia a través de los type ratings, no como elección de nadie—. Cada
 * palabra de la consulta tiene que aparecer en el nombre, la familia, el
 * fabricante o el tipo, en cualquier orden ("cfm 7b", "turboshaft arriel").
 * Orden estable: fabricante, luego nombre.
 */
export function searchEngines(engines: EngineCatalog[], query: string): EngineCatalog[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return engines
    .filter((e) => e.isActive)
    .filter((e) => {
      const haystack = `${e.displayName} ${e.family} ${e.manufacturer} ${e.engineType}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    })
    .sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.displayName.localeCompare(b.displayName));
}

const ENGINE_TYPE_LABELS: Record<EngineType, string> = {
  turbofan: 'Turbofan',
  turbojet: 'Turbojet',
  turboprop: 'Turboprop',
  turboshaft: 'Turboshaft',
  piston: 'Piston',
  apu: 'APU',
};

export function engineTypeLabel(type: EngineType): string {
  return ENGINE_TYPE_LABELS[type] ?? type;
}

/** Una fila de `public.engines` tal como la devuelve PostgREST. */
export interface EngineRow {
  id: string;
  manufacturer: string;
  family: string;
  engine_type: EngineType;
  display_name: string;
  is_active: boolean;
}

export function mapEngineRow(row: EngineRow): EngineCatalog {
  return {
    id: row.id,
    manufacturer: row.manufacturer,
    family: row.family,
    engineType: row.engine_type,
    displayName: row.display_name,
    isActive: row.is_active,
  };
}
