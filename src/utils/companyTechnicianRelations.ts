import type { OfferApplication, OfferInboxRecord, OfferRequest } from '../types/offerRequest';
import { isUnlocked, type TechnicianView, type UnlockedTechnicianView } from '../types/privacy';
import type { AircraftRatingIndex } from '../constants/aircraftTypeRatings';
import type { MatchScore } from '../types/matching';
import type { OfferWithRequirements } from '../types/offer';
import type { SearchOfferResults } from './searchOfferResults';
import { canRevealIdentity } from './privacyV2';
import { matchesTechnicianSearch, type TechnicianSearchQuery } from './technicianSearchFilterMatch';

/** The existing acceptance gate, followed by the same protected view as the profile. */
export async function loadCompanyContacts(
  companyId: string,
  offerRequests: OfferRequest[],
  offerApplications: OfferApplication[],
  getView: (id: string, companyId: string) => Promise<TechnicianView | null>,
): Promise<UnlockedTechnicianView[]> {
  const ids = [...new Set([...offerApplications, ...offerRequests]
    .filter((row) => row.companyId === companyId).map((row) => row.technicianId))]
    .filter((technicianId) => canRevealIdentity({ companyId, technicianId, offerRequests, offerApplications }));
  const views = await Promise.all(ids.map((id) => getView(id, companyId)));
  // A deleted/inactive technician or a now-locked view cannot become a contact.
  return views.filter((view): view is UnlockedTechnicianView => view !== null && isUnlocked(view));
}

export function filterCompanyContacts(
  contacts: readonly UnlockedTechnicianView[], query: TechnicianSearchQuery, ratingIndex: AircraftRatingIndex,
): UnlockedTechnicianView[] {
  return contacts.filter((contact) => matchesTechnicianSearch(contact, query, ratingIndex));
}

/** Called only after the existing matching batch has completed successfully. */
export function contactOfferMismatch(score: MatchScore | undefined): string | null {
  return !score || score.blockers.length > 0 ? "Doesn't meet this offer" : null;
}

/** Keep every filtered contact, but never use a different offer's matching snapshot. */
export function visibleContactResults<T extends { id: string }>(
  source: T[], selectedOfferId: string | null, offer: OfferWithRequirements | null, snapshot: SearchOfferResults<T> | null,
): T[] {
  if (!selectedOfferId) return source;
  if (offer?.id !== selectedOfferId || snapshot?.offer !== offer || snapshot?.source !== source) return [];
  return [...snapshot.visible, ...source.filter((row) => !snapshot.scores[row.id])];
}

/** Pending first; within each group, newest creation first, irrespective of kind/status. */
export function companyTechnicianRelations(
  companyId: string, technicianId: string,
  applications: readonly OfferApplication[], requests: readonly OfferRequest[],
): OfferInboxRecord[] {
  return [...applications, ...requests]
    .filter((row) => row.companyId === companyId && row.technicianId === technicianId)
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending')
      || Date.parse(b.createdAt) - Date.parse(a.createdAt)
      || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

export function companyRelationPath(row: OfferInboxRecord): string {
  return `/company/${row.kind === 'application' ? 'applications' : 'direct-offers'}/${row.id}`;
}
