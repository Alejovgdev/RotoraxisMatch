import { OfferWithRequirements } from '../types/offer';
import { MatchScore } from '../types/matching';
import { MatchingService, MatchingServiceDeps } from './matchingService';

export interface SearchOfferResults<T> {
  source: T[];
  offer: OfferWithRequirements;
  scores: Record<string, MatchScore>;
  visible: T[];
}

/** A failed catalog/qualification load rejects the entire offer search. */
export async function loadSearchOfferResults<T extends { id: string }>(
  source: T[], offer: OfferWithRequirements,
  getTechnician: MatchingServiceDeps['getTechnicianWithRelations'],
  matchPairs: MatchingService['matchPairs'],
): Promise<SearchOfferResults<T>> {
  const loaded = await Promise.all(source.map(async (row) => {
    const technician = await getTechnician(row.id);
    if (!technician) throw new Error('Technician qualifications could not be loaded.');
    return technician;
  }));
  const pairs = await matchPairs(loaded.map((technician) => ({ offer, technician })));
  if (pairs.length !== source.length) throw new Error('Incomplete matching results.');
  const scores: Record<string, MatchScore> = {};
  pairs.forEach((pair, i) => { if (pair.eligible) scores[source[i].id] = pair.score; });
  const visible = source.filter((row) => scores[row.id]).map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => {
      const aScore = scores[a.row.id];
      const bScore = scores[b.row.id];
      const blockers = Number(aScore.blockers.length > 0) - Number(bScore.blockers.length > 0);
      return blockers || bScore.total - aScore.total || a.originalIndex - b.originalIndex;
    }).map(({ row }) => row);
  return { source, offer, scores, visible };
}

/** A snapshot belongs to one results array and one offer revision, not just its ID. */
export function visibleSearchResults<T>(
  source: T[], selectedOfferId: string | null, offer: OfferWithRequirements | null,
  snapshot: SearchOfferResults<T> | null,
): T[] {
  if (!selectedOfferId) return source;
  return offer?.id === selectedOfferId && snapshot?.offer === offer && snapshot?.source === source
    ? snapshot.visible : [];
}
