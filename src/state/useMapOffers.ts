import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { companyRepositoryV2 } from '../repositories/v2/companyRepositoryV2';
import { offerApplicationRepository } from '../repositories/v2/offerApplicationRepository';
import { getMatchDisplayLabel, getOfferMatchesForTechnician } from '../utils/matchingV2';
import { indexCountriesByCode, resolveMapPin } from '../utils/locationBridge';
import { formatLocation } from '../utils/formatLocation';
import { useCountryCatalog } from './useCountryCatalog';
import { useTechnicianSession } from './SessionContext';
import {
  getOfferMapMatchBand,
  OfferMapFilters,
  OfferMapItem,
} from '../types/offerMap';

interface UseMapOffersReturn {
  offers: OfferMapItem[];
  loading: boolean;
  error: Error | null;
  totalCount: number;
  unmappedCount: number;
  retry: () => void;
}

export function useMapOffers(filters: OfferMapFilters): UseMapOffersReturn {
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const {
    countries,
    state: countryState,
    error: countryError,
    retry: retryCountries,
  } = useCountryCatalog();
  const [allOffers, setAllOffers] = useState<OfferMapItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async (signal: { active: boolean }) => {
    if (countryState === 'loading') return;

    if (!technicianId) {
      setError(new Error('Your technician profile is not available yet.'));
      setLoading(false);
      return;
    }

    if (countryState === 'error' || countryState === 'empty') {
      setError(countryError ?? new Error('Could not load the location catalog.'));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [matches, companies, applications] = await Promise.all([
        getOfferMatchesForTechnician(technicianId),
        companyRepositoryV2.getAll(),
        offerApplicationRepository.getForTechnician(technicianId),
      ]);
      if (!signal.active) return;

      const companiesById = new Map(companies.map((company) => [company.id, company]));
      const applicationsByOfferId = new Map(applications.map((application) => [application.offerId, application]));
      const countriesByCode = indexCountriesByCode(countries);
      let nextUnmappedCount = 0;

      const mapped = matches.flatMap(({ offer, score }): OfferMapItem[] => {
        const pin = resolveMapPin(offer, countriesByCode);
        if (!pin) {
          nextUnmappedCount += 1;
          return [];
        }

        const company = companiesById.get(offer.companyId);
        const application = applicationsByOfferId.get(offer.id);
        const location = formatLocation(offer.locationCity || offer.locationCityName, offer.locationCountry);

        return [{
          id: offer.id,
          title: offer.title,
          companyName: company?.name ?? 'Company',
          logoPath: company?.logoPath ?? null,
          contractType: offer.contractType,
          salary: offer.salary,
          productType: offer.productType,
          location: location || offer.locationCountryCode,
          latitude: pin.latitude,
          longitude: pin.longitude,
          locationPrecision: pin.precision,
          score: score.total,
          matchLabel: getMatchDisplayLabel(offer, score),
          blockers: score.blockers,
          applicationStatus: application?.status,
        }];
      });

      setAllOffers(mapped);
      setTotalCount(matches.length);
      setUnmappedCount(nextUnmappedCount);
    } catch (loadError) {
      if (!signal.active) return;
      setAllOffers([]);
      setTotalCount(0);
      setUnmappedCount(0);
      setError(loadError instanceof Error ? loadError : new Error(String(loadError)));
    } finally {
      if (signal.active) setLoading(false);
    }
  }, [technicianId, countryState, countryError, countries, attempt]);

  useFocusEffect(
    useCallback(() => {
      const signal = { active: true };
      load(signal);
      return () => {
        signal.active = false;
      };
    }, [load]),
  );

  const offers = useMemo(() => allOffers.filter((offer) => {
    if (filters.contractTypes?.length && !filters.contractTypes.includes(offer.contractType)) return false;
    if (filters.productTypes?.length && !filters.productTypes.includes(offer.productType)) return false;
    if (filters.matchBands?.length && !filters.matchBands.includes(getOfferMapMatchBand(offer.score))) return false;
    if (filters.eligibleOnly && offer.blockers.length > 0) return false;
    return true;
  }), [allOffers, filters]);

  const retry = useCallback(() => {
    if (countryState === 'error' || countryState === 'empty') retryCountries();
    setAttempt((value) => value + 1);
  }, [countryState, retryCountries]);

  return { offers, loading, error, totalCount, unmappedCount, retry };
}
