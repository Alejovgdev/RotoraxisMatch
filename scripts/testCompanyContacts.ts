import assert from 'node:assert/strict';
import { loadCompanyContacts, filterCompanyContacts, contactOfferMismatch, visibleContactResults, companyTechnicianRelations, companyRelationPath } from '../src/utils/companyTechnicianRelations';
import { appliedAfterNavigation, applyTechnicianFilters, EMPTY_TECHNICIAN_FILTERS, NO_APPLIED_FILTERS, toTechnicianSearchQuery, type TechnicianFilterState } from '../src/utils/technicianFilters';
import { loadSearchOfferResults, visibleSearchResults } from '../src/utils/searchOfferResults';
import { applicationStatusLook, directOfferStatusLook } from '../src/utils/companyStatus';
import { canSendDirectOffers, canReviewApplications, canSendChatMessages } from '../src/utils/companyPermissionsV2';
import type { OfferApplication, OfferRequest } from '../src/types/offerRequest';
import type { UnlockedTechnicianView } from '../src/types/privacy';
import type { OfferWithRequirements } from '../src/types/offer';
import type { TechnicianWithRelations } from '../src/types/technician';
import type { MatchScore } from '../src/types/matching';

function contact(id: string, extra: Partial<UnlockedTechnicianView> = {}): UnlockedTechnicianView {
  return { id, anonymousCode: id, firstName: 'Ana', lastName: 'García', email: 'test@example.test', documents: [],
    technicianTypes: ['mechanic'], country: 'Spain', city: 'Madrid', locationCountryCode: 'ES', locationCityName: 'Madrid',
    licenses: [{ authority: 'EASA', licenseCode: 'B1.1' }], habilitations: [], aircraftExperience: [], engines: [],
    availability: { immediately: true, status: 'open_to_offers', contractTypes: [] }, verificationStatus: 'verified', ...extra };
}
const app = (id: string, technicianId: string, extra: Partial<OfferApplication> = {}): OfferApplication => ({
  kind: 'application', id, technicianId, companyId: 'company', offerId: 'offer', status: 'accepted',
  identityRevealed: false, documentsUnlocked: false, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', ...extra,
});
const request = (id: string, technicianId: string, extra: Partial<OfferRequest> = {}): OfferRequest => ({
  ...app(id, technicianId), kind: 'direct_offer', ...extra,
});

async function main() {
  const applications = [app('a', 'a'), app('a2', 'a'), app('pending', 'pending', { status: 'pending', identityRevealed: true }),
    app('foreign', 'foreign', { companyId: 'another' }), app('deleted', 'deleted'), app('locked', 'locked')];
  const requests = [request('b', 'b'), request('dup', 'a'), ...(['rejected', 'withdrawn', 'expired'] as const)
    .map((status) => request(status, status, { status, identityRevealed: true }))];
  const called: string[] = [];
  const views = await loadCompanyContacts('company', requests, applications, async (id, company) => {
    assert.equal(company, 'company');
    called.push(id);
    if (id === 'deleted') return null;
    const view = contact(id);
    if (id === 'locked') { const { firstName, lastName, email, documents, ...locked } = view; return locked; }
    return view;
  });
  assert.deepEqual(views.map((row) => row.id), ['a', 'b'], 'both accepted paths, once each; never foreign/pending/finished/deleted/locked');
  assert.deepEqual(called, ['a', 'deleted', 'locked', 'b'], 'only accepted identities are requested');
  assert.deepEqual(await loadCompanyContacts('empty', requests, applications, async () => { throw new Error('must not read'); }), []);
  await assert.rejects(loadCompanyContacts('company', requests, applications, async () => { throw new Error('offline'); }), /offline/);
  console.log('PASS contacts: acceptance gate, company scope, deduplication, protected views and load failure');

  const others = [...views, contact('unavailable', { availability: { immediately: false, status: 'unavailable', contractTypes: [] } }),
    contact('unverified', { verificationStatus: 'pending' }), contact('other-country', { locationCountryCode: 'FR' }),
    contact('avionic', { technicianTypes: ['avionic'], licenses: [{ authority: 'EASA', licenseCode: 'B2' }] })];
  const index = new Map();
  const filters: TechnicianFilterState = { ...EMPTY_TECHNICIAN_FILTERS, technicianTypes: ['mechanic'], verifiedOnly: true,
    availability: ['open_to_offers' as const], licenseAuthority: 'EASA' as const, licenseCodes: ['B1.1'] };
  assert.deepEqual(filterCompanyContacts(others, { ...toTechnicianSearchQuery(filters), countryCode: 'ES' }, index).map((row) => row.id), ['a', 'b']);
  assert.equal(filterCompanyContacts(others, {}, index).length, others.length, 'no initial Show technicians required');
  assert.equal(filterCompanyContacts(others, { technicianTypes: ['mechanic', 'avionic'] }, index).length, others.length, 'OR inside one section');
  assert.equal(filterCompanyContacts(others, { licenseCodes: ['B2'], countryCode: 'FR' }, index).length, 0, 'AND across sections');
  assert.equal(others.length, 6, 'filtering does not change the total contact count');
  console.log('PASS contacts: shared filters, combined criteria, initial results and unfiltered count');

  const offer = { id: 'offer' } as OfferWithRequirements;
  const score = { total: 87, blockers: [] } as unknown as MatchScore;
  const blocked = { ...score, total: 19, blockers: ['expired'] } as unknown as MatchScore;
  const source = [{ id: 'eligible' }, { id: 'ineligible' }, { id: 'blocked' }];
  const snapshot = await loadSearchOfferResults(source, offer, async (id) => ({ id } as TechnicianWithRelations), async () => [
    { eligible: true, score }, { eligible: false, reason: 'licensed_technician' }, { eligible: true, score: blocked },
  ]);
  assert.deepEqual(visibleContactResults(source, offer.id, offer, snapshot).map((row) => row.id), ['eligible', 'blocked', 'ineligible']);
  assert.deepEqual(visibleSearchResults(source, offer.id, offer, snapshot).map((row) => row.id), ['eligible', 'blocked'], 'All technicians keeps its existing exclusion');
  assert.equal(contactOfferMismatch(snapshot.scores.eligible), null);
  assert.equal(contactOfferMismatch(snapshot.scores.ineligible), "Doesn't meet this offer");
  assert.equal(contactOfferMismatch(snapshot.scores.blocked), "Doesn't meet this offer");
  assert.equal(snapshot.scores.ineligible, undefined, 'no invented percentage for ineligible pairs');
  assert.equal(snapshot.scores.eligible.total, 87, 'score is unchanged');
  assert.equal(visibleContactResults(source, null, null, null), source);
  assert.deepEqual(visibleContactResults(source, offer.id, { ...offer }, snapshot), [], 'offer revision invalidates old matching');
  assert.deepEqual(visibleContactResults([...source], offer.id, offer, snapshot), [], 'changed filters invalidate old matching');
  assert.deepEqual(visibleContactResults(source, offer.id, offer, null), [], 'no unvalidated send action while loading');
  console.log('PASS contacts: every contact retained, mismatch label, unchanged scores, stale matching rejected');

  const rows = companyTechnicianRelations('company', 'a', [
    app('accepted', 'a', { createdAt: '2026-10-07T12:00:00Z' }),
    app('old-pending', 'a', { status: 'pending', createdAt: '2026-09-01T12:00:00Z' }),
    app('other-tech', 'b'), app('other-company', 'a', { companyId: 'another' }),
  ], [
    request('new-pending', 'a', { status: 'pending', createdAt: '2026-10-02T12:00:00Z' }),
    request('recent-declined', 'a', { status: 'rejected', createdAt: '2026-10-08T12:00:00Z' }),
    request('unlinked', 'a', { status: 'withdrawn', offerId: undefined, createdAt: '2026-09-01T12:00:00Z' }),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ['new-pending', 'old-pending', 'recent-declined', 'accepted', 'unlinked']);
  assert.equal(companyRelationPath(rows[0]), '/company/direct-offers/new-pending');
  assert.equal(companyRelationPath(rows[1]), '/company/applications/old-pending');
  assert.equal(directOfferStatusLook('rejected').label, 'Declined');
  assert.equal(applicationStatusLook('rejected').label, 'Rejected');
  assert.equal(applicationStatusLook('accepted').tone, 'success');
  assert.equal(canSendDirectOffers('viewer'), false);
  assert.equal(canReviewApplications('viewer'), false);
  assert.equal(canSendChatMessages('viewer'), false);
  console.log('PASS history: pending first, newest within each group, both paths, company/technician scope and existing status/Viewer rules');

  const selected = { ...NO_APPLIED_FILTERS, searchTab: 'contacts' as const };
  for (const route of ['/company/search', '/company/map', '/company/technician/a']) {
    assert.equal(appliedAfterNavigation(selected, route), selected);
  }
  assert.equal(applyTechnicianFilters(selected, filters).searchTab, 'contacts');
  for (const route of ['/company', '/company/chats/a', '/company/applications/a', '/company/offers/offer']) {
    assert.equal(appliedAfterNavigation(selected, route), NO_APPLIED_FILTERS, 'tab resets even before filters have been applied');
  }
  console.log('PASS contacts: tab and filter persistence/reset');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
