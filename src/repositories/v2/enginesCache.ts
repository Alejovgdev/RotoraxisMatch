import { EngineCatalog } from '../../types/catalog';

// Caché TTL del catálogo de motores (`public.engines`, migraciones 067/071 y
// 089/090: 174 filas, 17 inactivas, 19 genéricas).
//
// Mismo patrón que aircraftTypeRatingsCache y locationCountriesCache: sin
// ningún import con efectos, para poder testearla con un fetcher falso (ver
// scripts/testMatching.ts). catalogRepository monta la instancia real.
//
// ── GUARDA TODAS LAS FILAS, TAMBIÉN LAS INACTIVAS ─────────────────────────
// Es la diferencia con las otras dos cachés, y no es un descuido. Las 17
// inactivas son las genéricas "<fabricante> (model not specified)", y de ellas
// cuelgan 268 type ratings (medido el 2026-09-16). El matching les da crédito
// de FAMILIA, y para eso necesita leer su `family` en el índice: una caché de
// sólo activas haría que esos 268 ratings puntuaran como "tipo distinto" sin
// ningún error visible. Desde la 089 hay otra razón: un modelo concreto
// desactivado sigue dando motor exacto a quien ya lo tiene, y sólo lo puede
// hacer si está en el índice. Quien pinte un selector filtra al pintar, con
// `searchEngines` (activos y no genéricos).
//
// Sin mapa por id: con el catálogo entero en memoria no hay nada que resolver
// aparte.
//
// Reglas de fallo, las mismas que en ratings:
//   - Un refresco que falla teniendo catálogo previo NO lo borra: se sigue
//     sirviendo el anterior y el error queda anotado.
//   - Sin catálogo previo, el fallo se propaga y el estado queda en 'error'.
//     Nunca se cae a una lista hardcodeada: el catálogo vive en Postgres.
//   - Las llamadas concurrentes comparten la petición en vuelo.

export type EnginesCacheStatus = 'empty' | 'loading' | 'success' | 'error';

export interface EnginesCacheState {
  status: EnginesCacheStatus;
  engines: EngineCatalog[];
  fetchedAt: number | null;
  error: Error | null;
}

export interface EnginesCacheDeps {
  /** TODAS las filas, activas e inactivas. Ver la cabecera. */
  fetchAll: () => Promise<EngineCatalog[]>;
  ttlMs?: number;
  now?: () => number;
}

export interface EnginesCache {
  getEngines(options?: { forceRefresh?: boolean }): Promise<EngineCatalog[]>;
  getState(): EnginesCacheState;
  invalidate(): void;
}

// 15 min, como ratings: el catálogo cambia poco, pero un motor dado de alta
// por un admin debe aparecer sin reiniciar la app.
const DEFAULT_TTL_MS = 15 * 60 * 1000;

export function createEnginesCache(deps: EnginesCacheDeps): EnginesCache {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const now = deps.now ?? (() => Date.now());

  let state: EnginesCacheState = { status: 'empty', engines: [], fetchedAt: null, error: null };
  let inFlight: Promise<EngineCatalog[]> | null = null;

  function isFresh(): boolean {
    return state.status === 'success' && state.fetchedAt !== null && now() - state.fetchedAt < ttlMs;
  }

  function getEngines(options: { forceRefresh?: boolean } = {}): Promise<EngineCatalog[]> {
    if (!options.forceRefresh && isFresh()) return Promise.resolve(state.engines);
    if (inFlight) return inFlight;

    if (state.status === 'empty' || state.status === 'error') state = { ...state, status: 'loading' };

    const hadPreviousData = state.engines.length > 0;

    const promise = deps
      .fetchAll()
      .then((engines) => {
        state = { status: 'success', engines, fetchedAt: now(), error: null };
        inFlight = null;
        return engines;
      })
      .catch((err) => {
        inFlight = null;
        const error = err instanceof Error ? err : new Error(String(err));
        if (hadPreviousData) {
          state = { ...state, status: 'success', error };
          return state.engines;
        }
        state = { status: 'error', engines: [], fetchedAt: null, error };
        throw error;
      });

    inFlight = promise;
    return promise;
  }

  return {
    getEngines,
    getState: () => state,
    invalidate: () => {
      state = { status: 'empty', engines: [], fetchedAt: null, error: null };
    },
  };
}
