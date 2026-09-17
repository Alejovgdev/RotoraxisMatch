/**
 * useTechnicianSearch — company search hook.
 *
 * Privacy contract:
 *   Results are SafeTechnicianView[] (V1 compat). The `fullName` field is set ONLY
 *   when canRevealIdentity() returns true (i.e. an accepted offer record exists for
 *   the companyId + technicianId pair). Before acceptance, fullName is undefined and
 *   the card shows anonymousCode + "Identity locked" badge.
 *
 * Future Supabase: the internal search + privacy gate will be replaced by a single
 *   call to search_technicians_public(filters) RPC. The RPC returns rows from
 *   technician_public_view — private columns are NULL until offer_accepted_between().
 *   This hook's return type stays SafeTechnicianView[] (mapped from the RPC response).
 */
import { useState, useCallback, useRef } from 'react';
import { SafeTechnicianView } from '../types';
import type { AvailabilityStatus } from '../types/technician';
import { TechnicianFilters } from '../types/filters';
import { MatchRequest } from '../types/matchRequest';
import { technicianRepositoryV2 } from '../repositories/v2/technicianRepositoryV2';
import { offerRequestRepository } from '../repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../repositories/v2/offerApplicationRepository';
import { documentRepositoryV2 } from '../repositories/v2/documentRepositoryV2';
import { catalogRepository } from '../repositories/v2/catalogRepository';
import { buildAircraftRatingIndex } from '../constants/aircraftTypeRatings';
import { canRevealIdentity } from '../utils/privacyV2';
import { getUnlockedTechnicianView } from '../utils/privacyV2';
import {
  v2SafePreviewToSafeView,
  v2UnlockedViewToSafeView,
} from '../utils/v2CompatAdapters';
import { useCompanySession } from './SessionContext';

interface UseTechnicianSearchReturn {
  results: SafeTechnicianView[];
  filters: TechnicianFilters;
  loading: boolean;
  hasSearched: boolean;
  error: string | null;
  updateFilter: <K extends keyof TechnicianFilters>(key: K, value: TechnicianFilters[K]) => void;
  clearFilters: () => void;
  // matchRequests param kept for signature compat — no longer used internally
  search: (matchRequests?: MatchRequest[]) => Promise<void>;
}

const EMPTY_FILTERS: TechnicianFilters = {};

export function useTechnicianSearch(): UseTechnicianSearchReturn {
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const [results, setResults] = useState<SafeTechnicianView[]>([]);
  const [filters, setFilters] = useState<TechnicianFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const updateFilter = useCallback(
    <K extends keyof TechnicianFilters>(key: K, value: TechnicianFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const clearFilters = useCallback(() => {
    requestId.current++;
    setError(null);
    setLoading(false);
    setFilters(EMPTY_FILTERS);
    setResults([]);
    setHasSearched(false);
  }, []);

  const search = useCallback(
    // _matchRequests is kept for call-site compat but ignored — privacy gate
    // uses V2 offerRequests + offerApplications loaded fresh each search.
    async (_matchRequests: MatchRequest[] = []) => {
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

      // Normalize the screen state into the repository contract. The trade
      // and aircraft dimensions already arrive as arrays; legacy singular
      // filters such as license and availability are wrapped here.
      const v2Filters = {
        technicianTypes: filters.technicianTypes?.length ? filters.technicianTypes : undefined,
        licenseCodes: filters.licenseCategory ? [filters.licenseCategory] : undefined,
        aircraftFamilyKeys: filters.aircraftFamilyKeys?.length ? filters.aircraftFamilyKeys : undefined,
        countryCode: filters.location?.country?.code,
        cityGeonameId: filters.location?.city?.kind === 'directory'
          ? filters.location.city.geonameId
          : undefined,
        // Manual cities have no stable directory id. Legacy string filters
        // remain as a compatibility fallback for older callers.
        country: filters.location?.country ? undefined : filters.country,
        city: filters.location?.city?.kind === 'manual'
          ? filters.location.city.name
          : filters.location
            ? undefined
            : filters.city,
        verificationStatuses: filters.verificationStatus ? [filters.verificationStatus] : undefined,
        availabilityStatuses: filters.availabilityStatus ? [filters.availabilityStatus as AvailabilityStatus] : undefined,
      };

      try {
        // Load previews, the acceptance records and the ratings catalog in parallel
        const [previews, offerRequests, offerApplications, ratings] = await Promise.all([
          technicianRepositoryV2.search(v2Filters),
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

            // Identity unlocked — load full profile + verified documents
            const [withRelations, documents] = await Promise.all([
              technicianRepositoryV2.getWithRelations(preview.id),
              documentRepositoryV2.getVerifiedForTechnician(preview.id),
            ]);
            if (!withRelations) return v2SafePreviewToSafeView(preview, ratingIndex);

            return v2UnlockedViewToSafeView(getUnlockedTechnicianView(withRelations, documents), ratingIndex);
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
    [companyId, filters],
  );

  return { results, filters, loading, hasSearched, error, updateFilter, clearFilters, search };
}
