import { useEffect, useMemo, useState } from 'react';
import { buildAircraftRatingIndex, type AircraftRatingIndex } from '../constants/aircraftTypeRatings';
import { catalogRepository } from '../repositories/v2/catalogRepository';
import { technicianRepositoryV2 } from '../repositories/v2/technicianRepositoryV2';
import type { OfferApplication, OfferRequest } from '../types/offerRequest';
import type { UnlockedTechnicianView } from '../types/privacy';
import { filterCompanyContacts, loadCompanyContacts } from '../utils/companyTechnicianRelations';
import type { TechnicianSearchQuery } from '../utils/technicianSearchFilterMatch';
import { v2UnlockedViewToSafeView } from '../utils/v2CompatAdapters';

interface Snapshot {
  companyId: string;
  requests: OfferRequest[];
  applications: OfferApplication[];
  contacts: UnlockedTechnicianView[];
  ratingIndex: AircraftRatingIndex;
}

export function useCompanyContacts(
  companyId: string | undefined, requests: OfferRequest[], applications: OfferApplication[],
  relationsReady: boolean, query: TechnicianSearchQuery, retryAttempt: number,
) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setError(null);
    if (!companyId || !relationsReady) return;
    Promise.all([
      loadCompanyContacts(companyId, requests, applications, (id, company) => technicianRepositoryV2.getViewForCompany(id, company)),
      catalogRepository.getAircraftTypeRatings(),
    ]).then(([contacts, ratings]) => {
      if (active) setSnapshot({ companyId, requests, applications, contacts, ratingIndex: buildAircraftRatingIndex(ratings) });
    }).catch(() => {
      if (active) setError('Your contacts could not be loaded. Please retry.');
    });
    return () => { active = false; };
  }, [companyId, requests, applications, relationsReady, retryAttempt]);

  const current = relationsReady && snapshot && snapshot.companyId === companyId
    && snapshot.requests === requests && snapshot.applications === applications ? snapshot : null;
  const filtered = useMemo(() => current ? filterCompanyContacts(current.contacts, query, current.ratingIndex) : [], [current, query]);
  const results = useMemo(() => current ? filtered.map((view) => v2UnlockedViewToSafeView(view, current.ratingIndex)) : [], [current, filtered]);
  const previews = useMemo(() => Object.fromEntries(filtered.map((view) => [view.id, view])), [filtered]);
  return { results, previews, count: current?.contacts.length ?? 0, loading: !current && !error, error };
}
