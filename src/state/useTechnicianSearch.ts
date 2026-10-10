/**
 * useTechnicianSearch — company search hook.
 *
 * Privacy contract:
 *   Results are SafeTechnicianView[] (V1 compat). The `fullName` field is set ONLY
 *   when canRevealIdentity() returns true (i.e. an accepted offer record exists for
 *   the companyId + technicianId pair). Before acceptance, fullName is undefined and
 *   the card shows anonymousCode + "Identity locked" badge.
 *
 * Filtros (rediseño, fase 3B): el hook ya no guarda filtros propios. Los filtros
 * los comparten la búsqueda y el mapa (src/state/TechnicianFiltersContext.tsx);
 * la pantalla traduce los aplicados a una consulta (toTechnicianSearchQuery) y
 * se la pasa a `search()`. Lo demás —privacidad, cancelación de búsquedas
 * viejas, error visible— es lo de antes.
 *
 * Future Supabase: the internal search + privacy gate will be replaced by a single
 *   call to search_technicians_public(filters) RPC. The RPC returns rows from
 *   technician_public_view — private columns are NULL until offer_accepted_between().
 *   This hook's return type stays SafeTechnicianView[] (mapped from the RPC response).
 */
import { useState, useCallback, useRef } from 'react';
import { SafeTechnicianView } from '../types';
import type { TechnicianSearchQuery } from '../utils/technicianSearchFilterMatch';
import { technicianRepositoryV2 } from '../repositories/v2/technicianRepositoryV2';
import { offerRequestRepository } from '../repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../repositories/v2/offerApplicationRepository';
import { catalogRepository } from '../repositories/v2/catalogRepository';
import { buildAircraftRatingIndex } from '../constants/aircraftTypeRatings';
import { canRevealIdentity } from '../utils/privacyV2';
import { isUnlocked } from '../types/privacy';
import {
  v2SafePreviewToSafeView,
  v2UnlockedViewToSafeView,
} from '../utils/v2CompatAdapters';
import { useCompanySession } from './SessionContext';

interface UseTechnicianSearchReturn {
  results: SafeTechnicianView[];
  loading: boolean;
  hasSearched: boolean;
  error: string | null;
  /** Vacía los resultados y cancela la búsqueda en vuelo (los filtros se han vaciado). */
  clearResults: () => void;
  /** Sin consulta, todos los técnicos (como pulsar "Search" sin filtros antes). */
  search: (query?: TechnicianSearchQuery) => Promise<void>;
}

export function useTechnicianSearch(): UseTechnicianSearchReturn {
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const [results, setResults] = useState<SafeTechnicianView[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const clearResults = useCallback(() => {
    requestId.current++;
    setError(null);
    setLoading(false);
    setResults([]);
    setHasSearched(false);
  }, []);

  const search = useCallback(
    async (query: TechnicianSearchQuery = {}) => {
      const currentRequest = ++requestId.current;
      setError(null);
      setResults([]);
      // Fase 5.4 — sin sesión de empresa resuelta no se busca: el gate de
      // privacidad depende del par companyId+technicianId, y con un id vacío
      // no habría gate que aplicar.
      if (!companyId) {
        setResults([]);
        setHasSearched(true);
        setLoading(false);
        return;
      }

      setLoading(true);
      setHasSearched(true);

      try {
        // Load previews, the acceptance records and the ratings catalog in parallel
        const [previews, offerRequests, offerApplications, ratings] = await Promise.all([
          technicianRepositoryV2.search(query),
          offerRequestRepository.getForCompany(companyId),
          offerApplicationRepository.getForCompany(companyId),
          catalogRepository.getAircraftTypeRatings(),
        ]);
        const ratingIndex = buildAircraftRatingIndex(ratings);

        // Apply privacy gate per technician result
        const views: SafeTechnicianView[] = await Promise.all(
          previews.map(async (preview) => {
            const accepted = canRevealIdentity({
              companyId,
              technicianId: preview.id,
              offerRequests,
              offerApplications,
            });

            if (!accepted) return v2SafePreviewToSafeView(preview, ratingIndex);

            // Same protected view and unlock check as the full company profile.
            const view = await technicianRepositoryV2.getViewForCompany(preview.id, companyId);
            if (!view || !isUnlocked(view)) return v2SafePreviewToSafeView(preview, ratingIndex);
            return v2UnlockedViewToSafeView(view, ratingIndex);
          }),
        );

        if (requestId.current === currentRequest) setResults(views);
      } catch {
        if (requestId.current !== currentRequest) return;
        setResults([]);
        setError('We could not load the search catalogs or technician data. Please retry.');
      } finally {
        if (requestId.current === currentRequest) setLoading(false);
      }
    },
    [companyId],
  );

  return { results, loading, hasSearched, error, clearResults, search };
}
