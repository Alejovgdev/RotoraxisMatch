import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import {
  BriefcaseBusiness,
  Clock,
  Lock,
  MapPin,
  Radar,
  Search,
  Send,
} from 'lucide-react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { MatchBadge } from '../../src/components/MatchBadge';
import {
  CompanyBadge,
  CompanyCard,
  CompanyChip,
  CompanyPageHeader,
  CompanyScreen,
  EmptyPanel,
  IconBox,
  InitialAvatar,
  companyStyles,
  companyUi,
} from '../../src/components/company/CompanyUI';
import { useTechnicianSearch } from '../../src/state/useTechnicianSearch';
import { useCompanySession } from '../../src/state/SessionContext';
import { canSendDirectOffers } from '../../src/utils/companyPermissionsV2';
import { isOfferOpenForTechnicians, offerRepository } from '../../src/repositories/v2/offerRepository';
import { offerRequestRepository } from '../../src/repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../../src/repositories/v2/offerApplicationRepository';
import { technicianRepositoryV2 } from '../../src/repositories/v2/technicianRepositoryV2';
import { matchPairs } from '../../src/utils/matchingV2';
import { loadSearchOfferResults, visibleSearchResults, SearchOfferResults } from '../../src/utils/searchOfferResults';
import { useAircraftTypeRatingsCatalog } from '../../src/state/useAircraftTypeRatingsCatalog';
import { AircraftRatingIndex } from '../../src/constants/aircraftTypeRatings';
import { CollapsibleAircraftFilter } from '../../src/components/CollapsibleAircraftFilter';
import { CountryCityPicker } from '../../src/components/CountryCityPicker';
import { resolveTypeRatingLabels, resolveTechnicianProductTypes } from '../../src/utils/v2CompatAdapters';
import { LICENSE_CATEGORIES, credentialLabel } from '../../src/constants/licenses';
import { TECHNICIAN_TYPES, technicianTypeLabels } from '../../src/constants/technicianTypes';
import { OfferWithRequirements } from '../../src/types/offer';
import { SafeTechnicianView } from '../../src/types';
import { MatchScore } from '../../src/types/matching';
import { SafeTechnicianPreview } from '../../src/types/privacy';
import { OfferApplication, OfferRequest } from '../../src/types/offerRequest';
import { OfferRelationKind } from '../../src/utils/offerRelationStateMachine';

// Relacion existente entre este tecnico y la oferta seleccionada, venga por
// donde venga. Deliberadamente minima: solo lo que la tarjeta necesita para
// decidir si puede enviar y que etiqueta poner.
type OfferRelationSummary = { kind: OfferRelationKind; status: OfferRequest['status'] };
import { AircraftTypeRatingCatalog, TechnicianTypeCode } from '../../src/types/catalog';
import { EMPTY_LOCATION } from '../../src/types/location';
import { notify, confirmAction } from '../../src/utils/platformAlert';
import { ViewTechnicianProfileButton } from '../../src/components/company/ViewTechnicianProfileButton';
import { spacing } from '../../src/theme';

type PreviewMap = Record<string, SafeTechnicianPreview>;

function labelize(value?: string): string {
  if (!value) return 'Not specified';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

// Binaria desde 2026-07-29. `status` es la etiqueta del booleano persistido,
// así que no hace falta ningún fallback: si no viene, se lee `immediately`.
function availabilityLabel(tech: SafeTechnicianView): string {
  const openToOffers = tech.availability.status
    ? tech.availability.status === 'open_to_offers'
    : Boolean(tech.availability.immediately);
  return openToOffers ? 'Open to offers' : 'Unavailable';
}

function verificationTone(status: string) {
  return status === 'verified' ? 'success' : 'warning';
}

function offerRequestBadgeTone(status: string): 'success' | 'warning' | 'muted' {
  if (status === 'accepted') return 'success';
  if (status === 'pending') return 'warning';
  return 'muted';
}

// Fase 5.7 (2026-07-28) — la etiqueta distingue el CAMINO de la relacion.
// Antes solo se miraban las ofertas directas: un tecnico que habia APLICADO
// a la oferta seguia mostrando "Send offer", el envio fallaba en el
// repositorio y (con el Alert no-op de web) el fallo era invisible. Ese era
// el fallo silencioso reportado.
function relationBadgeLabel(relation: OfferRelationSummary): string {
  const noun = relation.kind === 'application' ? 'Application' : 'Offer';
  if (relation.status === 'pending') {
    return relation.kind === 'application' ? 'Applied - pending' : 'Pending response';
  }
  if (relation.status === 'accepted') return `${noun} accepted`;
  return relation.kind === 'application' ? 'Applied previously' : 'Already sent';
}

export default function TechnicianSearchScreen() {
  const goBack = useGoBack();
  const { width } = useWindowDimensions();
  const isWide = width >= 960;
  const { results, filters, loading, hasSearched, error: sourceError, updateFilter, clearFilters, search } =
    useTechnicianSearch();
  // Aquí el catálogo de ratings ya sólo pinta etiquetas de las tarjetas. La
  // puntuación la hace matchPairs, que espera a sus catálogos (ratings y
  // motores) por su cuenta, así que ya no hay índice vacío que vigilar.
  const { ratingIndex } = useAircraftTypeRatingsCatalog();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;
  const canSendRole = canSendDirectOffers(companyMemberRole);
  const { offerId: preselectedOfferId } = useLocalSearchParams<{ offerId?: string }>();

  const [offers, setOffers] = useState<OfferWithRequirements[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(preselectedOfferId ?? null);
  const [previews, setPreviews] = useState<PreviewMap>({});
  const [offerResults, setOfferResults] = useState<SearchOfferResults<SafeTechnicianView> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [offerRequests, setOfferRequests] = useState<OfferRequest[]>([]);
  const [offerApplications, setOfferApplications] = useState<OfferApplication[]>([]);
  const [sendingTechId, setSendingTechId] = useState<string | null>(null);

  const loadOfferRequests = useCallback(async () => {
    // Guard de CARGA, mudo a proposito (ver nota en map.tsx).
    if (!companyId) return;
    const [reqs, apps] = await Promise.all([
      offerRequestRepository.getForCompany(companyId),
      offerApplicationRepository.getForCompany(companyId),
    ]);
    setOfferRequests(reqs);
    setOfferApplications(apps);
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      if (hasSearched) search();
      loadOfferRequests();
    }, [hasSearched, search, loadOfferRequests]),
  );

  const autoSearched = useRef(false);
  useEffect(() => {
    if (preselectedOfferId && !autoSearched.current) {
      autoSearched.current = true;
      setSelectedOfferId(preselectedOfferId);
      search();
    }
  }, [preselectedOfferId, search]);

  useEffect(() => {
    loadOfferRequests();
  }, [loadOfferRequests]);

  useEffect(() => {
    let active = true;
    setOffersLoading(true);
    setOffersError(null);
    offerRepository.getAllWithRequirements().then((all) => {
      if (!active) return;
      setOffers(all.filter((offer) => offer.companyId === companyId && isOfferOpenForTechnicians(offer)));
      setOffersLoading(false);
    }).catch(() => {
      if (!active) return;
      setOffersLoading(false);
      setOffersError('Offers could not be loaded. Please retry.');
    });
    return () => {
      active = false;
    };
  }, [companyId, retryAttempt]);

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.id === selectedOfferId) ?? null,
    [offers, selectedOfferId],
  );

  useEffect(() => {
    let active = true;

    setOfferResults(null);
    setPreviewError(null);

    async function loadPreviewData() {
      if (!results.length) {
        setPreviews({});
        return;
      }

      const previewEntries = await Promise.all(
        results.map(async (tech) => {
          const preview = await technicianRepositoryV2.getSafeView(tech.id);
          return [tech.id, preview] as const;
        }),
      );

      const nextPreviews: PreviewMap = {};
      previewEntries.forEach(([id, preview]) => {
        if (preview) nextPreviews[id] = preview;
      });

      const matched = selectedOffer ? await loadSearchOfferResults(
        results, selectedOffer, (id) => technicianRepositoryV2.getWithRelations(id), matchPairs,
      ) : null;

      if (!active) return;
      setPreviews(nextPreviews);
      setOfferResults(matched);
    }

    loadPreviewData().catch(() => {
      if (!active) return;
      setOfferResults(null);
      setPreviews({});
      setPreviewError('We could not load the catalogs or qualifications needed for this search. Please retry.');
    });
    return () => {
      active = false;
    };
  }, [results, selectedOffer, retryAttempt]);

  const searchError = sourceError ?? previewError ?? (selectedOfferId ? offersError
    ?? (!offersLoading && !selectedOffer ? 'The selected offer is unavailable. Select another offer or retry.' : null) : null);
  const orderedResults = searchError ? [] : visibleSearchResults(results, selectedOfferId, selectedOffer, offerResults);
  const matchingLoading = Boolean(selectedOfferId && !searchError &&
    (offersLoading || !selectedOffer || (results.length > 0 && (offerResults?.source !== results || offerResults.offer !== selectedOffer))));
  const scores = offerResults?.source === results && offerResults.offer === selectedOffer ? offerResults.scores : {};

  async function handleSearch() {
    await search();
  }

  function handleClearFilters() {
    clearFilters();
    setOfferResults(null);
    setPreviewError(null);
    setPreviews({});
  }

  function toggleTechnicianType(type: TechnicianTypeCode) {
    const selected = filters.technicianTypes ?? [];
    const next = selected.includes(type)
      ? selected.filter((value) => value !== type)
      : [...selected, type];
    updateFilter('technicianTypes', next.length > 0 ? next : undefined);
  }

  // Relacion existente con la oferta seleccionada, POR CUALQUIERA DE LOS DOS
  // CAMINOS: oferta directa que mandamos nosotros, o aplicacion que mando el
  // tecnico. Ambas bloquean un envio nuevo (evaluateDirectOfferConflict), asi
  // que ambas tienen que desactivar el boton — si no, la accion falla y el
  // usuario no entiende por que.
  function getExistingRelation(techId: string): OfferRelationSummary | undefined {
    if (!selectedOfferId) return undefined;
    const application = offerApplications.find(
      (a) => a.technicianId === techId && a.offerId === selectedOfferId,
    );
    if (application) return { kind: 'application', status: application.status };
    const request = offerRequests.find(
      (r) => r.technicianId === techId && r.offerId === selectedOfferId,
    );
    return request ? { kind: 'direct_offer', status: request.status } : undefined;
  }

  async function handleSendOffer(techId: string) {
    if (!selectedOfferId || !companyId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    setSendingTechId(techId);
    try {
      await offerRequestRepository.create({
        companyId,
        technicianId: techId,
        offerId: selectedOfferId,
      });
      await loadOfferRequests();
    } catch (err: any) {
      notify('Error', err?.message ?? 'Failed to send the direct offer. Please try again.');
    } finally {
      setSendingTechId(null);
    }
  }

  return (
    <CompanyScreen>
      <FlatList
        data={orderedResults}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[companyStyles.content, isWide && companyStyles.contentWide]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <CompanyPageHeader
              eyebrow="Search"
              title="Search technicians"
              subtitle="Find privacy-safe technician profiles and calculate match quality only against a selected offer."
              onBack={goBack}
            />

            <CompanyCard style={styles.searchPanel}>
              <View style={styles.panelHeader}>
                <IconBox icon={Radar} color={companyUi.accent} backgroundColor={companyUi.accentSoft} />
                <View style={styles.panelCopy}>
                  <Text style={styles.panelTitle}>Search criteria</Text>
                  <Text style={styles.panelSub}>Use a few high-signal filters, then review profiles below.</Text>
                </View>
              </View>

              <CountryCityPicker
                value={filters.location ?? EMPTY_LOCATION}
                onChange={(location) => updateFilter(
                  'location',
                  location.country || location.city ? location : undefined,
                )}
                countryRequired={false}
                countryPlaceholder="Any country"
                cityPlaceholder="Any city"
              />

              <FilterGroup
                label="Trade type"
                helper="Select one or more. Results can match any selected trade."
              >
                <CompanyChip
                  label="Any"
                  selected={!filters.technicianTypes?.length}
                  onPress={() => updateFilter('technicianTypes', undefined)}
                />
                {TECHNICIAN_TYPES.filter((type) => type.isActive).map((type) => (
                  <CompanyChip
                    key={type.code}
                    label={type.label}
                    selected={filters.technicianTypes?.includes(type.code) ?? false}
                    onPress={() => toggleTechnicianType(type.code)}
                  />
                ))}
              </FilterGroup>

              {/* Mismas dos opciones que el mapa, mismo campo y misma función
                  de repositorio — antes esta pantalla ofrecía 2 estados y el
                  mapa 3, sobre el mismo dato (hallazgo I9). Un técnico
                  "Unavailable" NO desaparece: aparece marcado, para que la
                  empresa pueda planificar y decida ella si lo filtra. Mismo
                  criterio que con los años no declarados. */}
              <FilterGroup label="Availability">
                <CompanyChip
                  label="Any"
                  selected={!filters.availabilityStatus}
                  onPress={() => updateFilter('availabilityStatus', undefined)}
                />
                <CompanyChip
                  label="Open to offers"
                  selected={filters.availabilityStatus === 'open_to_offers'}
                  onPress={() => updateFilter('availabilityStatus', 'open_to_offers')}
                />
                <CompanyChip
                  label="Unavailable"
                  selected={filters.availabilityStatus === 'unavailable'}
                  onPress={() => updateFilter('availabilityStatus', 'unavailable')}
                />
              </FilterGroup>

              <FilterGroup label="Verification">
                <CompanyChip
                  label="Any"
                  selected={!filters.verificationStatus}
                  onPress={() => updateFilter('verificationStatus', undefined)}
                />
                <CompanyChip
                  label="Verified only"
                  selected={filters.verificationStatus === 'verified'}
                  onPress={() => updateFilter('verificationStatus', 'verified')}
                />
              </FilterGroup>

              <FilterGroup label="License">
                <CompanyChip
                  label="Any"
                  selected={!filters.licenseCategory}
                  onPress={() => updateFilter('licenseCategory', undefined)}
                />
                {LICENSE_CATEGORIES.map((license) => (
                  <CompanyChip
                    key={license.code}
                    label={license.code}
                    selected={filters.licenseCategory === license.code}
                    onPress={() => updateFilter('licenseCategory', license.code)}
                  />
                ))}
              </FilterGroup>

              <CollapsibleAircraftFilter
                selectedKeys={filters.aircraftFamilyKeys ?? []}
                onChange={(next) => updateFilter('aircraftFamilyKeys', next.length ? next : undefined)}
              />

              <View style={styles.searchActions}>
                <TouchableOpacity
                  style={styles.secondaryAction}
                  onPress={handleClearFilters}
                  activeOpacity={0.75}
                >
                  <Text style={styles.secondaryActionText}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryAction}
                  onPress={handleSearch}
                  activeOpacity={0.75}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color={companyUi.surface} />
                  ) : (
                    <>
                      <Search color={companyUi.surface} size={16} strokeWidth={2} />
                      <Text style={styles.primaryActionText}>Search technicians</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </CompanyCard>

            <CompanyCard style={styles.offerPanel}>
              <View style={styles.panelHeader}>
                <IconBox icon={BriefcaseBusiness} color={companyUi.blue} backgroundColor={companyUi.blueSoft} />
                <View style={styles.panelCopy}>
                  <Text style={styles.panelTitle}>Select offer to send</Text>
                  <Text style={styles.panelSub}>
                    Select a published offer to calculate match scores and send direct offers to technicians.
                  </Text>
                </View>
              </View>
              <View style={styles.chipWrap}>
                <CompanyChip
                  label="No offer selected"
                  selected={!selectedOfferId}
                  onPress={() => setSelectedOfferId(null)}
                />
                {offers.map((offer) => (
                  <CompanyChip
                    key={offer.id}
                    label={offer.title}
                    selected={selectedOfferId === offer.id}
                    onPress={() => setSelectedOfferId(offer.id)}
                  />
                ))}
              </View>
              {offers.length === 0 && (
                <Text style={styles.noOffersHint}>
                  No published offers found. Create and publish an offer to send direct offers to technicians.
                </Text>
              )}
            </CompanyCard>

            {hasSearched && !loading && !matchingLoading && !searchError ? (
              <View style={styles.resultHeader}>
                <Text style={styles.resultTitle}>
                  {orderedResults.length} {orderedResults.length === 1 ? 'result' : 'results'}
                </Text>
                <Text style={styles.resultSub}>
                  {selectedOffer
                    ? `Match shown for "${selectedOffer.title}". Select a technician to send a direct offer.`
                    : 'Select an offer above to calculate match scores and send direct offers.'}
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          searchError ? (
            <CompanyCard>
              <Text accessibilityRole="alert" style={styles.panelSub}>{searchError}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={() => { setRetryAttempt((n) => n + 1); void search(); }} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>Retry search</Text>
              </TouchableOpacity>
            </CompanyCard>
          ) : matchingLoading ? (
            <View><ActivityIndicator /><Text style={styles.panelSub}>Checking offer eligibility?</Text></View>
          ) : !loading ? (
            hasSearched ? (
              <EmptyPanel
                title="No technicians found"
                subtitle="Adjust filters or clear the criteria to broaden the search."
              />
            ) : (
              <EmptyPanel
                title="Start with search criteria"
                subtitle="Search results will appear here as privacy-safe technician cards."
              />
            )
          ) : null
        }
        renderItem={({ item }) => (
          <TechnicianResultCard
            technician={item}
            preview={previews[item.id]}
            selectedOffer={selectedOffer}
            score={scores[item.id]}
            existingRelation={getExistingRelation(item.id)}
            onSendOffer={() => handleSendOffer(item.id)}
            sendingThis={sendingTechId === item.id}
            canSendRole={canSendRole}
            ratingIndex={ratingIndex}
          />
        )}
      />
    </CompanyScreen>
  );
}

function FilterGroup({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      {helper ? <Text style={styles.filterHelper}>{helper}</Text> : null}
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

/**
 * TechnicianResultCard renders a company-safe technician preview card.
 *
 * Identity privacy: `fullName` is only present when canRevealIdentity() is true
 * (accepted offer_request or offer_application for this company+technician pair).
 * The `preview` prop (SafeTechnicianPreview) always stays anonymous.
 *
 * Send offer logic:
 * - No selectedOffer → button disabled, "Select an offer first"
 * - selectedOffer + sin relacion previa → "Send offer" (active)
 * - relacion existente (oferta directa O aplicacion) → etiqueta estatica
 * Duplicate detection is by company_id + technician_id + offer_id.
 */
function TechnicianResultCard({
  technician,
  preview,
  selectedOffer,
  score,
  existingRelation,
  onSendOffer,
  sendingThis,
  canSendRole,
  ratingIndex,
}: {
  technician: SafeTechnicianView;
  preview?: SafeTechnicianPreview;
  selectedOffer: OfferWithRequirements | null;
  score?: MatchScore;
  existingRelation: OfferRelationSummary | undefined;
  onSendOffer: () => void;
  sendingThis: boolean;
  canSendRole: boolean;
  ratingIndex: AircraftRatingIndex;
}) {
  const displayName = technician.fullName ?? technician.anonymousCode;
  // Fase 6 tanda A: varios tipos por técnico, en una línea y en el orden del
  // catálogo. 'Technician' como último recurso, igual que antes.
  const technicianTypesText = technicianTypeLabels(preview?.technicianTypes ?? [], 'Technician');
  // Paso 5b: con autoridad ("EASA B1.1", "FAA A&P") cuando hay preview.
  const licenseChips = preview?.licenses?.length
    ? preview.licenses.map((license) => credentialLabel(license.authority, license.licenseCode))
    : technician.licenseCategories;
  const typeRatingChips = preview?.habilitations?.length ? resolveTypeRatingLabels(preview.habilitations, ratingIndex) : [];
  const productTypes = preview?.habilitations?.length ? resolveTechnicianProductTypes(preview.habilitations, ratingIndex) : new Set<NonNullable<AircraftTypeRatingCatalog['productType']>>();
  const aircraftCat = productTypes.size > 1 ? 'mixed' : productTypes.size === 1 ? [...productTypes][0] : null;

  // Footer button state — role gates the send action entirely
  const canSend = canSendRole && selectedOffer !== null && !existingRelation && !sendingThis;

  return (
    <CompanyCard style={styles.resultCard}>
      <View style={styles.resultTop}>
        <InitialAvatar label={displayName} color={technician.fullName ? companyUi.accent : companyUi.navy} />
        <View style={styles.resultInfo}>
          <View style={styles.resultNameRow}>
            <Text style={styles.techName} numberOfLines={1}>
              {displayName}
            </Text>
            {selectedOffer && existingRelation ? (
              <CompanyBadge
                label={relationBadgeLabel(existingRelation)}
                tone={offerRequestBadgeTone(existingRelation.status)}
                small
              />
            ) : null}
          </View>
          <Text style={styles.techType}>{technicianTypesText}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <MapPin color={companyUi.textMuted} size={13} strokeWidth={2} />
              <Text style={styles.metaText} numberOfLines={1}>
                {technician.city}, {technician.country}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Clock color={companyUi.textMuted} size={13} strokeWidth={2} />
              <Text style={styles.metaText} numberOfLines={1}>
                {availabilityLabel(technician)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.badgeLine}>
        <CompanyBadge
          label={labelize(technician.verificationStatus)}
          tone={verificationTone(technician.verificationStatus)}
          small
        />
        <CompanyBadge label={`${technician.yearsExperience} years experience`} tone="muted" small />
        {aircraftCat === 'Aeroplane' && <CompanyBadge label="Airplane" tone="info" small />}
        {aircraftCat === 'Helicopter' && <CompanyBadge label="Helicopter" tone="info" small />}
        {aircraftCat === 'mixed' && <CompanyBadge label="Mixed" tone="warning" small />}
        {!technician.fullName ? (
          <View style={styles.lockBadge}>
            <Lock color={companyUi.textSoft} size={12} strokeWidth={2} />
            <Text style={styles.lockText}>Identity locked</Text>
          </View>
        ) : (
          <CompanyBadge label="Identity unlocked" tone="success" small />
        )}
      </View>

      <View style={styles.chipBlock}>
        <Text style={styles.smallLabel}>Licenses</Text>
        <View style={styles.chipWrap}>
          {licenseChips.length ? (
            licenseChips.slice(0, 5).map((license) => <CompanyChip key={license} label={license} />)
          ) : (
            <Text style={styles.mutedText}>No licenses listed</Text>
          )}
        </View>
      </View>

      <View style={styles.chipBlock}>
        <Text style={styles.smallLabel}>Type ratings</Text>
        <View style={styles.chipWrap}>
          {typeRatingChips.length ? (
            typeRatingChips.slice(0, 5).map((rating) => <CompanyChip key={rating} label={rating} />)
          ) : (
            <Text style={styles.mutedText}>No type ratings listed</Text>
          )}
        </View>
      </View>

      <View style={styles.resultFooter}>
        <View style={styles.matchArea}>
          {selectedOffer ? (
            score ? (
              <MatchBadge score={score.total} context="for selected offer" notEligible={score.blockers.length > 0} />
            ) : (
              <Text style={styles.matchHint}>Calculating match...</Text>
            )
          ) : (
            <Text style={styles.matchHint}>Select an offer to calculate match.</Text>
          )}
        </View>
        <View style={styles.resultActions}>
          {technician.fullName ? (
            <ViewTechnicianProfileButton technicianId={technician.id} />
          ) : null}
          {canSend ? (
            <TouchableOpacity
              style={styles.requestButton}
              onPress={onSendOffer}
              activeOpacity={0.75}
            >
              {sendingThis ? (
                <ActivityIndicator size="small" color={companyUi.surface} />
              ) : (
                <>
                  <Send color={companyUi.surface} size={15} strokeWidth={2} />
                  <Text style={styles.requestButtonText}>Send offer</Text>
                </>
              )}
            </TouchableOpacity>
          ) : existingRelation ? (
            <View style={styles.requestStatic}>
              <Text style={styles.requestStaticText}>{relationBadgeLabel(existingRelation)}</Text>
            </View>
          ) : canSendRole ? (
            <View style={[styles.requestStatic, styles.requestStaticDimmed]}>
              <Text style={styles.requestStaticText}>Select an offer first</Text>
            </View>
          ) : null}
        </View>
      </View>
    </CompanyCard>
  );
}

const styles = StyleSheet.create({
  headerStack: { gap: 14, marginBottom: 14 },
  searchPanel: { gap: 16 },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  panelCopy: { flex: 1, minWidth: 0 },
  panelTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: companyUi.text,
  },
  panelSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  filterGroup: { gap: 8 },
  filterLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  filterHelper: {
    marginTop: -4,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    color: companyUi.textMuted,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchActions: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryAction: {
    minHeight: 44,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surface,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  primaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 15,
    backgroundColor: companyUi.accent,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: companyUi.surface,
  },
  offerPanel: { gap: 14 },
  noOffersHint: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: companyUi.textMuted,
    fontStyle: 'italic',
  },
  resultHeader: { gap: 2 },
  resultTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: companyUi.text,
  },
  resultSub: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  resultCard: {
    gap: 14,
    marginBottom: 12,
  },
  resultTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  resultInfo: { flex: 1, minWidth: 0 },
  resultNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  techName: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: companyUi.text,
  },
  techType: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: companyUi.textSoft,
  },
  metaRow: {
    marginTop: 9,
    gap: 7,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  badgeLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  lockBadge: {
    borderWidth: 1,
    borderColor: companyUi.borderSoft,
    backgroundColor: companyUi.surfaceSoft,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lockText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  chipBlock: { gap: 7 },
  smallLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: companyUi.textMuted,
  },
  mutedText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: companyUi.textMuted,
  },
  resultFooter: {
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
    paddingTop: 13,
    alignItems: 'stretch',
    gap: 12,
  },
  matchArea: { flex: 1, minWidth: 0 },
  resultActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  matchHint: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: companyUi.textSoft,
  },
  requestButton: {
    minHeight: 40,
    borderRadius: 14,
    backgroundColor: companyUi.accent,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  requestButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: companyUi.surface,
  },
  requestStatic: {
    minHeight: 40,
    borderRadius: 14,
    backgroundColor: companyUi.surfaceSoft,
    borderWidth: 1,
    borderColor: companyUi.borderSoft,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  requestStaticDimmed: {
    opacity: 0.6,
  },
  requestStaticText: {
    fontSize: 13,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
});
