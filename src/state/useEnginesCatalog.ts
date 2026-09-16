import { useCallback, useEffect, useMemo, useState } from 'react';
import { catalogRepository } from '../repositories/v2/catalogRepository';
import { EngineCatalog } from '../types/catalog';
import { EngineIndex, buildEngineIndex } from '../constants/engines';

export type EnginesLoadState = 'loading' | 'success' | 'empty' | 'error';

interface UseEnginesCatalogReturn {
  /** El catálogo ENTERO, inactivos incluidos. Un selector filtra `isActive`. */
  engines: EngineCatalog[];
  engineIndex: EngineIndex;
  state: EnginesLoadState;
  error: Error | null;
  retry: () => void;
}

// Entrada compartida al catálogo de motores (Fase 10, paso 5a), gemela de
// useAircraftTypeRatingsCatalog: respaldada por la caché de módulo de
// catalogRepository, así que montarla en varias pantallas a la vez hace una
// sola petición. Nunca cae a un catálogo hardcodeado: un fallo es un estado
// 'error' explícito con retry().
//
// Sin lectores todavía: la pondrán el editor de motores del perfil y el
// formulario de oferta de motor (paso 5b).
export function useEnginesCatalog(): UseEnginesCatalogReturn {
  const [engines, setEngines] = useState<EngineCatalog[]>([]);
  const [state, setState] = useState<EnginesLoadState>('loading');
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev === 'success' ? prev : 'loading'));

    catalogRepository
      .getEngines(attempt > 0 ? { forceRefresh: true } : undefined)
      .then((data) => {
        if (cancelled) return;
        setEngines(data);
        setError(null);
        setState(data.length === 0 ? 'empty' : 'success');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Referencia estable mientras `engines` no cambie: se puede poner en un
  // array de dependencias sin provocar un bucle de recargas.
  const engineIndex = useMemo(() => buildEngineIndex(engines), [engines]);

  return { engines, engineIndex, state, error, retry };
}
