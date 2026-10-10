import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { BriefcaseBusiness, Check, ChevronDown, Lock, Map as MapIcon, Send, SlidersHorizontal } from 'lucide-react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Avatar, AvatarFrame, BottomSheet, Text, TextInput } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import {
  ButtonRow,
  CARD_BORDER,
  EmptyBlock,
  ErrorBlock,
  OfferTileSquare,
  PillButton,
  SegmentedControl,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { matchScoreColor } from '../../../src/components/company/MatchBreakdownBars';
import {
  TechnicianFiltersPanel,
  TechnicianFiltersSheet,
  technicianFilterSummary,
  useTechnicianFilterCatalogs,
} from '../../../src/components/company/TechnicianFiltersPanel';
import { useTechnicianSearch } from '../../../src/state/useTechnicianSearch';
import { useCompanyContacts } from '../../../src/state/useCompanyContacts';
import { contactOfferMismatch, visibleContactResults } from '../../../src/utils/companyTechnicianRelations';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { ChatRoom } from '../../../src/types/chat';
import { relativeTime } from '../../../src/utils/companyHome';
import { useTechnicianFilters } from '../../../src/state/TechnicianFiltersContext';
import { useCompanySession } from '../../../src/state/SessionContext';
import { canSendDirectOffers } from '../../../src/utils/companyPermissionsV2';
import { isOfferOpenForTechnicians, offerRepository } from '../../../src/repositories/v2/offerRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { matchPairs } from '../../../src/utils/matchingV2';
import { loadSearchOfferResults, visibleSearchResults, SearchOfferResults } from '../../../src/utils/searchOfferResults';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { AircraftRatingIndex } from '../../../src/constants/aircraftTypeRatings';
import { resolveTypeRatingLabels, resolveTechnicianProductTypes } from '../../../src/utils/v2CompatAdapters';
import { credentialLabel } from '../../../src/constants/licenses';
import { technicianTypeLabels } from '../../../src/constants/technicianTypes';
import { EMPTY_TECHNICIAN_FILTERS, activeFilterCount, toTechnicianSearchQuery } from '../../../src/utils/technicianFilters';
import { OfferWithRequirements } from '../../../src/types/offer';
import { SafeTechnicianView } from '../../../src/types';
import { MatchScore } from '../../../src/types/matching';
import { SafeTechnicianPreview } from '../../../src/types/privacy';
import { OfferApplication, OfferRequest } from '../../../src/types/offerRequest';
import { OfferRelationKind } from '../../../src/utils/offerRelationStateMachine';
import { AircraftTypeRatingCatalog } from '../../../src/types/catalog';
import { notify } from '../../../src/utils/platformAlert';
import { formatLocation } from '../../../src/utils/formatLocation';
import { colors } from '../../../src/theme';
import { floatingShadow, mobileGridColumns, UI_TONES } from '../../../src/theme/ui';

// Búsqueda de técnicos (rediseño, fase 3B; maquetas W-Search y W-D-Search;
// respuestas 11 y 23 de la revisión).
//   - Filtros COMPARTIDOS con el mapa (src/state/TechnicianFiltersContext.tsx):
//     se aplican al pulsar "Show technicians" y se conservan al pasar al mapa,
//     abrir un técnico o enviar una oferta y volver.
//   - El % sólo aparece con una oferta elegida arriba, y sólo entonces cada
//     tarjeta ofrece "Send offer", ahora con un mensaje opcional.
//   - All technicians conserva la búsqueda y elegibilidad actuales.
//     Your contacts carga al entrar, aplica los mismos filtros y conserva los
//     no elegibles con un aviso, sin permitir enviarles esta oferta.

// Relacion existente entre este tecnico y la oferta seleccionada, venga por
// donde venga. Deliberadamente minima: solo lo que la tarjeta necesita para
// decidir si puede enviar y que etiqueta poner.
type OfferRelationSummary = { kind: OfferRelationKind; status: OfferRequest['status'] };

type PreviewMap = Record<string, SafeTechnicianPreview>;

const CARD_MIN_WIDTH = 220;
const CARD_GAP = 14;
const FILTER_COLUMN = 320;

// Binaria desde 2026-07-29. `status` es la etiqueta del booleano persistido,
// así que no hace falta ningún fallback: si no viene, se lee `immediately`.
function isOpenToOffers(tech: SafeTechnicianView): boolean {
  return tech.availability.status
    ? tech.availability.status === 'open_to_offers'
    : Boolean(tech.availability.immediately);
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

function relationTone(relation: OfferRelationSummary) {
  if (relation.status === 'accepted') return UI_TONES.success;
  if (relation.status === 'pending') return relation.kind === 'application' ? UI_TONES.warning : UI_TONES.waiting;
  return UI_TONES.closed;
}

export default function TechnicianSearchScreen() {
  const router = useRouter();
  const wide = useIsWide();
  const { width } = useWindowDimensions();
  const { results, loading: allLoading, hasSearched, error: sourceError, clearResults, search } = useTechnicianSearch();
  // Aquí el catálogo de ratings ya sólo pinta etiquetas de las tarjetas. La
  // puntuación la hace matchPairs, que espera a sus catálogos (ratings y
  // motores) por su cuenta, así que ya no hay índice vacío que vigilar.
  const { ratingIndex } = useAircraftTypeRatingsCatalog();
  const { familyLabel, engineLabel } = useTechnicianFilterCatalogs();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;
  const canSendRole = canSendDirectOffers(companyMemberRole);
  const { offerId: preselectedOfferId } = useLocalSearchParams<{ offerId?: string }>();

  // Filtros: los aplicados son los compartidos; el panel edita un borrador.
  const { applied, version, apply, searchTab, setSearchTab } = useTechnicianFilters();
  const showingContacts = searchTab === 'contacts';
  const appliedQuery = useMemo(() => toTechnicianSearchQuery(applied), [applied]);
  const queryRef = useRef(appliedQuery);
  queryRef.current = appliedQuery;
  const [draft, setDraft] = useState(applied);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Escritorio: el ancho real de la lista, ya sin la barra de desplazamiento
  // (visible en escritorio, fase 8), para que las tarjetas quepan en su fila.
  const [listWidth, setListWidth] = useState(0);
  useEffect(() => { setDraft(applied); }, [applied]);

  const [offers, setOffers] = useState<OfferWithRequirements[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(preselectedOfferId ?? null);
  const [offerPickerOpen, setOfferPickerOpen] = useState(false);
  const [previews, setPreviews] = useState<PreviewMap>({});
  const [offerResults, setOfferResults] = useState<SearchOfferResults<SafeTechnicianView> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [offerRequests, setOfferRequests] = useState<OfferRequest[]>([]);
  const [offerApplications, setOfferApplications] = useState<OfferApplication[]>([]);
  const [sendingTechId, setSendingTechId] = useState<string | null>(null);
  const [sendTarget, setSendTarget] = useState<SafeTechnicianView | null>(null);
  const [sendMessage, setSendMessage] = useState('');
  const [relationsReady, setRelationsReady] = useState(false);
  const [relationsError, setRelationsError] = useState<string | null>(null);
  const relationRequest = useRef(0);
  const contacts = useCompanyContacts(companyId, offerRequests, offerApplications, relationsReady, appliedQuery, retryAttempt);
  const activeResults = showingContacts ? contacts.results : results;
  const activeContactPreviews = showingContacts ? contacts.previews : null;
  const loading = showingContacts ? contacts.loading && !relationsError : allLoading;
  const [chatChoices, setChatChoices] = useState<ChatRoom[] | null>(null);
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);

  async function openContactChat(technicianId: string) {
    if (!companyId) return;
    setOpeningChatId(technicianId);
    try {
      const rooms = (await chatRepository.getRoomsForCompany(companyId))
        .filter((room) => room.companyId === companyId && room.technicianId === technicianId);
      if (rooms.length === 1) router.push(`/company/chats/${rooms[0].id}` as never);
      else if (rooms.length > 1) setChatChoices(rooms);
      else notify('Chat unavailable', 'No conversation is available for this contact. Please refresh and try again.');
    } catch {
      notify('Could not open chat', 'Please try again.');
    } finally {
      setOpeningChatId(null);
    }
  }

  const loadOfferRequests = useCallback(async () => {
    // Guard de CARGA, mudo a proposito (ver nota en map.tsx).
    if (!companyId) return;
    const request = ++relationRequest.current;
    setRelationsReady(false);
    setRelationsError(null);
    try {
      const [reqs, apps] = await Promise.all([
        offerRequestRepository.getForCompany(companyId),
        offerApplicationRepository.getForCompany(companyId),
      ]);
      if (request !== relationRequest.current) return;
      setOfferRequests(reqs);
      setOfferApplications(apps);
      setRelationsReady(true);
    } catch (error) {
      if (request === relationRequest.current) setRelationsError('Your contacts could not be loaded. Please retry.');
      throw error;
    }
  }, [companyId]);

  // Al volver a la pantalla (de un técnico, del mapa…) se refresca lo que ya
  // se había buscado, como antes, con los filtros aplicados.
  const hasSearchedRef = useRef(hasSearched);
  hasSearchedRef.current = hasSearched;
  const firstFocus = useRef(true);
  // La lista de ofertas también se recarga al volver: una oferta recién
  // creada tiene que salir en el selector (y quedar elegida si se llega con
  // ?offerId desde "Find technicians for it"). La primera carga la hace el
  // efecto de abajo; aquí sólo las siguientes, sin quitar la lista que se ve.
  const [offersRefresh, setOffersRefresh] = useState(0);
  const offersRefreshSilently = useRef(false);
  useFocusEffect(
    useCallback(() => {
      const refocus = !firstFocus.current;
      if (refocus && hasSearchedRef.current) search(queryRef.current);
      if (refocus) {
        offersRefreshSilently.current = true;
        setOffersRefresh((n) => n + 1);
      }
      firstFocus.current = false;
      void loadOfferRequests().catch(() => {});
      return () => { relationRequest.current++; };
    }, [search, loadOfferRequests]),
  );

  // "Show technicians" (aquí o en el mapa) busca; si los filtros se vacían al
  // salir a otra sección, los resultados se van con ellos.
  const lastVersion = useRef(0);
  useEffect(() => {
    const previous = lastVersion.current;
    lastVersion.current = version;
    if (version > 0 && version !== previous) {
      search(queryRef.current);
    } else if (version === 0 && previous > 0) {
      clearResults();
      setOfferResults(null);
      setPreviewError(null);
      setPreviews({});
    }
  }, [version, search, clearResults]);

  // La oferta que llega por la URL se aplica una vez por cada oferta distinta:
  // con la pantalla ya abierta, "Find technicians for it" trae otra.
  const appliedOfferParam = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (preselectedOfferId && preselectedOfferId !== appliedOfferParam.current) {
      appliedOfferParam.current = preselectedOfferId;
      setSelectedOfferId(preselectedOfferId);
      search(queryRef.current);
    }
  }, [preselectedOfferId, search]);

  // Recargando al volver, la oferta elegida puede no estar aún en la lista
  // vieja: mientras tanto no se avisa de que "no está disponible".
  const [offersRefreshing, setOffersRefreshing] = useState(false);
  useEffect(() => {
    let active = true;
    const silent = offersRefreshSilently.current;
    offersRefreshSilently.current = false;
    if (silent) setOffersRefreshing(true);
    else setOffersLoading(true);
    setOffersError(null);
    offerRepository.getAllWithRequirements().then((all) => {
      if (!active) return;
      setOffers(all.filter((offer) => offer.companyId === companyId && isOfferOpenForTechnicians(offer)));
      setOffersLoading(false);
      setOffersRefreshing(false);
    }).catch(() => {
      if (!active) return;
      setOffersLoading(false);
      setOffersRefreshing(false);
      setOffersError('Offers could not be loaded. Please retry.');
    });
    return () => {
      active = false;
    };
  }, [companyId, retryAttempt, offersRefresh]);

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.id === selectedOfferId) ?? null,
    [offers, selectedOfferId],
  );

  useEffect(() => {
    let active = true;

    setOfferResults(null);
    setPreviewError(null);

    async function loadPreviewData() {
      if (!activeResults.length) {
        setPreviews({});
        return;
      }

      const previewEntries = await Promise.all(
        activeResults.map(async (tech) => {
          const preview = activeContactPreviews ? activeContactPreviews[tech.id] : await technicianRepositoryV2.getSafeView(tech.id);
          return [tech.id, preview] as const;
        }),
      );

      const nextPreviews: PreviewMap = {};
      previewEntries.forEach(([id, preview]) => {
        if (preview) nextPreviews[id] = preview;
      });

      const matched = selectedOffer ? await loadSearchOfferResults(
        activeResults, selectedOffer, (id) => technicianRepositoryV2.getWithRelations(id), matchPairs,
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
  }, [activeResults, selectedOffer, retryAttempt, activeContactPreviews]);

  const searchError = (showingContacts ? relationsError ?? contacts.error : sourceError) ?? previewError ?? (selectedOfferId ? offersError
    ?? (!offersLoading && !offersRefreshing && !selectedOffer ? 'The selected offer is unavailable. Select another offer or retry.' : null) : null);
  const matchingReady = offerResults?.source === activeResults && offerResults.offer === selectedOffer;
  const orderedResults = searchError ? [] : showingContacts
    ? visibleContactResults(activeResults, selectedOfferId, selectedOffer, offerResults)
    : visibleSearchResults(results, selectedOfferId, selectedOffer, offerResults);
  const matchingLoading = Boolean(selectedOfferId && !searchError &&
    (offersLoading || !selectedOffer || (activeResults.length > 0 && !matchingReady)));
  const scores = matchingReady ? offerResults.scores : {};

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

  async function handleSendOffer() {
    const techId = sendTarget?.id;
    if (!techId || !selectedOfferId || !companyId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    setSendingTechId(techId);
    try {
      await offerRequestRepository.create({
        companyId,
        technicianId: techId,
        offerId: selectedOfferId,
        message: sendMessage.trim() || undefined,
      });
      await loadOfferRequests();
      setSendTarget(null);
      setSendMessage('');
    } catch (err: any) {
      notify('Error', err?.message ?? 'Failed to send the direct offer. Please try again.');
    } finally {
      setSendingTechId(null);
    }
  }

  function openFilters() {
    setDraft(applied);
    setFiltersOpen(true);
  }

  function showTechnicians() {
    apply(draft);
    setFiltersOpen(false);
  }

  function retrySearch() {
    setRetryAttempt((n) => n + 1);
    if (showingContacts) void loadOfferRequests().catch(() => {});
    else void search(queryRef.current);
  }

  const toMap = () => router.push('/company/map' as never);
  const summary = technicianFilterSummary(applied, familyLabel, engineLabel);
  const filterCount = activeFilterCount(applied);

  const offerSelector = (
    <OfferSelector offer={selectedOffer} selectedId={selectedOfferId} wide={wide} onPress={() => setOfferPickerOpen(true)} />
  );

  const resultTabs = (
    <SegmentedControl
      options={[{ value: 'all', label: 'All technicians' }, { value: 'contacts', label: `Your contacts (${relationsError || contacts.error ? '—' : contacts.loading ? '…' : contacts.count})` }] as const}
      value={searchTab}
      onChange={setSearchTab}
      accessibilityLabel="Technician results"
    />
  );

  const resultsHeader = (showingContacts || hasSearched) && !loading && !matchingLoading && !searchError ? (
    <View style={styles.resultHeader}>
      <Text style={styles.resultTitle}>
        {orderedResults.length} {orderedResults.length === 1 ? 'result' : 'results'}
      </Text>
      <Text style={styles.resultSub}>
        {selectedOffer
          ? `Match shown for "${selectedOffer.title}".${canSendRole ? ' Send a direct offer from any card.' : ''}`
          : 'Select an offer above to calculate match scores and send direct offers.'}
      </Text>
    </View>
  ) : null;

  const emptyState = searchError ? (
    <View accessibilityRole="alert">
      <ErrorBlock text={searchError} onRetry={retrySearch} />
    </View>
  ) : matchingLoading || loading ? (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.resultSub}>{matchingLoading ? 'Checking offer eligibility…' : 'Loading technicians…'}</Text>
    </View>
  ) : showingContacts && contacts.count === 0 ? (
    <EmptyBlock title="No contacts yet." text="When an application or direct offer is accepted, the technician appears here." />
  ) : showingContacts || hasSearched ? (
    <EmptyBlock title="No technicians found" text="Adjust the filters or reset them to broaden the search." />
  ) : (
    <EmptyBlock
      title="Start with search criteria"
      text="Choose filters and tap Show technicians. Results appear here as privacy-safe technician cards."
      action={<PillButton label="Show technicians" size="md" onPress={() => apply(applied)} />}
    />
  );

  // Ancho fijo por tarjeta: la última de una fila impar no se estira.
  const contentWidth = Math.min(width, 1240) - 64;
  const gridWidth = listWidth > 0 ? listWidth : contentWidth - FILTER_COLUMN - 28;
  // Móvil: 2 columnas en teléfono y 3 en tablet (fase 8).
  const columns = wide ? Math.max(1, Math.floor((gridWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP))) : mobileGridColumns(width);
  const cellWidth = wide
    ? Math.floor((gridWidth - (columns - 1) * CARD_GAP) / columns)
    : Math.floor((width - 24 - (columns - 1) * 10) / columns);

  const renderCard = ({ item }: { item: SafeTechnicianView }) => (
    <View style={[wide ? styles.cellWide : styles.cell, { width: cellWidth }]}>
      <TechnicianResultCard
        technician={item}
        preview={showingContacts ? contacts.previews[item.id] : previews[item.id]}
        selectedOffer={selectedOffer}
        score={scores[item.id]}
        existingRelation={getExistingRelation(item.id)}
        onSendOffer={() => { setSendMessage(''); setSendTarget(item); }}
        onViewProfile={() => router.push(`/company/technician/${item.id}` as never)}
        onOpenChat={showingContacts ? () => openContactChat(item.id) : undefined}
        openingChat={openingChatId === item.id}
        offerMismatch={showingContacts && selectedOffer && matchingReady ? contactOfferMismatch(scores[item.id]) : null}
        sendingThis={sendingTechId === item.id}
        canSendRole={canSendRole}
        ratingIndex={ratingIndex}
        wide={wide}
      />
    </View>
  );

  const sheets = (
    <>
      <BottomSheet visible={chatChoices !== null} onClose={() => setChatChoices(null)} title="Open chat" subtitle="Choose a conversation with this technician.">
        <View style={styles.field}>
          {chatChoices?.map((room) => (
            <PillButton key={room.id} label={`${room.offerApplicationId ? 'Application' : 'Direct offer'} · ${relativeTime(room.createdAt)}`} variant="outline" size="md"
              onPress={() => { setChatChoices(null); router.push(`/company/chats/${room.id}` as never); }} />
          ))}
        </View>
      </BottomSheet>
      <OfferPickerSheet
        visible={offerPickerOpen}
        offers={offers}
        selectedId={selectedOfferId}
        loading={offersLoading}
        error={offersError}
        onRetry={() => setRetryAttempt((n) => n + 1)}
        onPick={(id) => { setSelectedOfferId(id); setOfferPickerOpen(false); }}
        onClose={() => setOfferPickerOpen(false)}
      />
      <BottomSheet
        visible={sendTarget !== null}
        onClose={() => setSendTarget(null)}
        dismissible={sendingTechId === null}
        title="Send direct offer"
        subtitle={sendTarget && selectedOffer
          ? `To ${sendTarget.fullName ?? sendTarget.anonymousCode} · ${selectedOffer.title}`
          : undefined}
        footer={(
          <ButtonRow>
            <PillButton label="Cancel" variant="outline" size="md" onPress={() => setSendTarget(null)} disabled={sendingTechId !== null} grow={1} />
            <PillButton label="Send offer" icon={Send} size="md" onPress={handleSendOffer} loading={sendingTechId !== null} grow={1} />
          </ButtonRow>
        )}
      >
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Personal message (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Add a note to the technician..."
            placeholderTextColor={colors.placeholder}
            value={sendMessage}
            onChangeText={setSendMessage}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>
      </BottomSheet>
    </>
  );

  if (wide) {
    return (
      <CompanyScreen>
        <View style={styles.wideShell}>
          <View style={styles.wideHead}>
            <View style={styles.wideTitleRow}>
              <Text style={styles.wideTitle} accessibilityRole="header">Search technicians</Text>
              <SegmentedControl
                fill={false}
                options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }] as const}
                value="list"
                onChange={(v) => { if (v === 'map') toMap(); }}
                accessibilityLabel="List or map"
              />
            </View>
            <View style={styles.wideOffer}>{offerSelector}</View>
          </View>
          <View style={styles.wideBody}>
            <View style={styles.filterColumn}>
              <View style={styles.filterColumnHead}>
                <Text style={styles.filterColumnTitle}>Filters</Text>
                <Pressable onPress={() => setDraft(EMPTY_TECHNICIAN_FILTERS)} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.link}>Clear</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.filterScroll} contentContainerStyle={styles.filterScrollContent} keyboardShouldPersistTaps="handled">
                <TechnicianFiltersPanel value={draft} onChange={setDraft} />
              </ScrollView>
              <View style={styles.filterColumnFoot}>
                <PillButton label="Show technicians" size="md" onPress={() => apply(draft)} />
              </View>
            </View>
            <FlatList
              key={`cols-${columns}`}
              style={styles.flex}
              data={orderedResults}
              keyExtractor={(item) => item.id}
              numColumns={columns}
              columnWrapperStyle={columns > 1 ? styles.wideRow : undefined}
              contentContainerStyle={styles.wideList}
              ListHeaderComponent={(
                <View style={styles.head} onLayout={(e) => setListWidth(Math.floor(e.nativeEvent.layout.width))}>
                  {resultTabs}{resultsHeader}
                </View>
              )}
              ListEmptyComponent={emptyState}
              renderItem={renderCard}
              showsVerticalScrollIndicator
            />
          </View>
        </View>
        {sheets}
      </CompanyScreen>
    );
  }

  return (
    <CompanyScreen>
      <FlatList
        key={`cols-${columns}`}
        data={orderedResults}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">Search technicians</Text>
            {offerSelector}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips} style={styles.filterChipsScroll}>
              <Pressable
                onPress={openFilters}
                style={({ pressed, hovered }: any) => [styles.filterButton, (pressed || hovered) && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} active` : 'Filters'}
              >
                <SlidersHorizontal color={colors.text} size={17} strokeWidth={2} />
                <Text style={styles.filterButtonText}>{filterCount > 0 ? `Filters · ${filterCount}` : 'Filters'}</Text>
              </Pressable>
              {summary.map((label, i) => (
                <Pressable key={`${label}-${i}`} onPress={openFilters} style={styles.summaryChip} accessibilityRole="button" accessibilityLabel={`Filter: ${label}. Edit filters`}>
                  <Text style={styles.summaryChipText} numberOfLines={1}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {resultTabs}
            {resultsHeader}
          </View>
        )}
        ListEmptyComponent={emptyState}
        renderItem={renderCard}
      />
      <Pressable
        onPress={toMap}
        style={[styles.mapButton, floatingShadow]}
        accessibilityRole="button"
        accessibilityLabel="Show on map"
      >
        <MapIcon color={colors.white} size={18} strokeWidth={2} />
        <Text style={styles.mapButtonText}>Map</Text>
      </Pressable>
      <TechnicianFiltersSheet
        visible={filtersOpen}
        value={draft}
        onChange={setDraft}
        onClose={() => setFiltersOpen(false)}
        onApply={showTechnicians}
      />
      {sheets}
    </CompanyScreen>
  );
}

function OfferSelector({
  offer,
  selectedId,
  wide,
  onPress,
}: {
  offer: OfferWithRequirements | null;
  selectedId: string | null;
  wide: boolean;
  onPress: () => void;
}) {
  const chosen = Boolean(selectedId);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        styles.offerSelector,
        chosen ? styles.offerSelectorOn : styles.offerSelectorOff,
        wide && styles.offerSelectorWide,
        (pressed || hovered) && styles.offerSelectorPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={offer ? `Match calculated against ${offer.title}. Change offer` : 'Select an offer to calculate match'}
    >
      <View style={styles.offerIcon}>
        <BriefcaseBusiness color={colors.primary} size={19} strokeWidth={2} />
      </View>
      <View style={styles.offerCopy}>
        <Text style={styles.offerKicker}>{chosen ? 'Match calculated against' : 'No offer selected'}</Text>
        <Text style={styles.offerTitle} numberOfLines={1}>
          {offer?.title ?? (chosen ? 'Loading offer…' : 'Select an offer to calculate match')}
        </Text>
      </View>
      <ChevronDown color={colors.text} size={20} strokeWidth={2.2} />
    </Pressable>
  );
}

function OfferPickerSheet({
  visible,
  offers,
  selectedId,
  loading,
  error,
  onRetry,
  onPick,
  onClose,
}: {
  visible: boolean;
  offers: OfferWithRequirements[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const rows: { id: string | null; title: string; offer?: OfferWithRequirements }[] = [
    { id: null, title: 'No offer selected' },
    ...offers.map((offer) => ({ id: offer.id, title: offer.title, offer })),
  ];
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Calculate match against"
      subtitle="Only your published offers. You need one to send direct offers."
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : error ? (
        <ErrorBlock text={error} onRetry={onRetry} />
      ) : (
        <View>
          {rows.map((row) => {
            const on = row.id === selectedId;
            return (
              <Pressable
                key={row.id ?? 'none'}
                onPress={() => onPick(row.id)}
                style={({ pressed, hovered }: any) => [styles.pickRow, (pressed || hovered) && styles.pressed]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                {row.offer ? <OfferTileSquare offer={row.offer} size={40} /> : <View style={styles.pickNone} />}
                <Text style={[styles.pickTitle, on && styles.pickTitleOn]} numberOfLines={2}>{row.title}</Text>
                {on ? <Check color={colors.primary} size={20} strokeWidth={2.6} /> : null}
              </Pressable>
            );
          })}
          {offers.length === 0 ? (
            <Text style={styles.pickHint}>
              No published offers found. Create and publish an offer to send direct offers to technicians.
            </Text>
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}

/**
 * Tarjeta de resultado (maquetas W-Search y W-D-Search).
 *
 * Identity privacy: `fullName` is only present when canRevealIdentity() is true
 * (accepted offer_request or offer_application for this company+technician pair).
 * Sin él, la tarjeta es anónima: código y avatar genérico, nada que identifique.
 *
 * Send offer logic (la de siempre):
 * - sin oferta elegida → no hay botón (la cabecera de resultados lo explica)
 * - oferta elegida + sin relacion previa → "Send offer"
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
  onViewProfile,
  onOpenChat,
  openingChat,
  offerMismatch,
  sendingThis,
  canSendRole,
  ratingIndex,
  wide,
}: {
  technician: SafeTechnicianView;
  preview?: SafeTechnicianPreview;
  selectedOffer: OfferWithRequirements | null;
  score?: MatchScore;
  existingRelation: OfferRelationSummary | undefined;
  onSendOffer: () => void;
  onViewProfile: () => void;
  onOpenChat?: () => void;
  openingChat: boolean;
  offerMismatch: string | null;
  sendingThis: boolean;
  canSendRole: boolean;
  ratingIndex: AircraftRatingIndex;
  wide: boolean;
}) {
  const unlocked = Boolean(technician.fullName);
  const displayName = technician.fullName ?? technician.anonymousCode;
  // Fase 6 tanda A: varios tipos por técnico, en una línea y en el orden del
  // catálogo. 'Technician' como último recurso, igual que antes.
  const technicianTypesText = technicianTypeLabels(preview?.technicianTypes ?? [], 'Technician');
  // Paso 5b: con autoridad ("EASA B1.1", "FAA A&P") cuando hay preview.
  const licences = preview?.licenses?.length
    ? preview.licenses.map((license) => credentialLabel(license.authority, license.licenseCode))
    : technician.licenseCategories;
  const ratings = preview?.habilitations?.length ? resolveTypeRatingLabels(preview.habilitations, ratingIndex) : [];
  const productTypes = preview?.habilitations?.length ? resolveTechnicianProductTypes(preview.habilitations, ratingIndex) : new Set<NonNullable<AircraftTypeRatingCatalog['productType']>>();
  const aircraftCat = productTypes.size > 1 ? 'Mixed' : productTypes.size === 1
    ? ([...productTypes][0] === 'Helicopter' ? 'Helicopter' : [...productTypes][0] === 'Aeroplane' ? 'Airplane' : null)
    : null;
  const open = isOpenToOffers(technician);
  const canSend = canSendRole && selectedOffer !== null && !existingRelation && !offerMismatch;
  const licenceLine = licences.length === 0
    ? 'No licenses listed'
    : licences.length <= 2 ? licences.join(' · ') : `${licences.slice(0, 2).join(' · ')} +${licences.length - 2}`;
  const ratingLine = ratings.length === 0
    ? 'No type ratings listed'
    : ratings.length === 1 ? ratings[0] : `${ratings.length} type ratings`;
  const blocked = Boolean(score && score.blockers.length > 0);
  const tone = existingRelation ? relationTone(existingRelation) : null;

  return (
    <View style={styles.card}>
      {/* La franja gris sólo con iniciales o el icono genérico; con foto, la foto sola (fase 8, H). */}
      <AvatarFrame
        image={{ photoPath: unlocked ? technician.photoPath : null, anonymous: !unlocked }}
        style={[styles.cardTop, wide && styles.cardTopWide]}
      >
        {selectedOffer && score ? (
          <View style={styles.scorePill}>
            <Text style={[styles.scoreText, { color: blocked ? colors.error : matchScoreColor(score.total) }]}>
              {blocked && !onOpenChat ? 'Not eligible' : `${score.total}%`}
            </Text>
          </View>
        ) : null}
        {technician.verificationStatus === 'verified' ? (
          <View style={styles.verified} accessibilityLabel="Verified">
            <Check color={colors.success} size={13} strokeWidth={3.2} />
          </View>
        ) : null}
        {/* El avatar genérico mientras la identidad está oculta (respuesta 4). */}
        <Avatar kind="person" size={wide ? 64 : 60} photoPath={unlocked ? technician.photoPath : null} anonymous={!unlocked} name={unlocked ? displayName : null} />
      </AvatarFrame>
      <View style={styles.cardBody}>
        <View style={styles.nameRow}>
          {!unlocked ? <Lock color={colors.textMuted} size={12} strokeWidth={2.4} /> : null}
          <Text style={styles.cardName} numberOfLines={1}>{displayName}</Text>
        </View>
        <Text style={styles.cardType} numberOfLines={1}>{technicianTypesText}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{formatLocation(technician.city, technician.country)}</Text>
        <Text style={styles.cardLicence} numberOfLines={2}>{licenceLine}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {[ratingLine, aircraftCat].filter(Boolean).join(' · ')}
        </Text>
        <View style={styles.availRow}>
          <View style={[styles.availDot, { backgroundColor: open ? '#1F9D62' : '#A7B1BC' }]} />
          <Text style={[styles.availText, { color: open ? colors.success : colors.textMuted }]} numberOfLines={1}>
            {open ? 'Open to offers' : 'Unavailable'}
            {technician.yearsExperience != null ? <Text style={styles.cardMeta}>{` · ${technician.yearsExperience} yrs`}</Text> : null}
          </Text>
        </View>

        <View style={styles.cardActions}>
          {offerMismatch ? (
            <View style={[styles.tag, { backgroundColor: UI_TONES.closed.bg }]}>
              <Text style={[styles.tagText, { color: UI_TONES.closed.text }]}>{offerMismatch}</Text>
            </View>
          ) : null}
          {canSend ? (
            <PillButton label="Send offer" variant="accent" size="sm" onPress={onSendOffer} loading={sendingThis} />
          ) : existingRelation && tone ? (
            <View style={[styles.tag, { backgroundColor: tone.bg }]}>
              <Text style={[styles.tagText, { color: tone.text }]} numberOfLines={1}>{relationBadgeLabel(existingRelation)}</Text>
            </View>
          ) : null}
          {unlocked ? <PillButton label="View profile" variant="outline" size="sm" onPress={onViewProfile} /> : null}
          {unlocked && onOpenChat ? <PillButton label="Open chat" variant="outline" size="sm" onPress={onOpenChat} loading={openingChat} /> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { backgroundColor: colors.surfaceSoft },

  list: {
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 96,
  },
  row: {
    gap: 10,
  },
  cell: {
    marginBottom: 10,
  },
  head: {
    paddingHorizontal: 4,
    gap: 10,
    marginBottom: 6,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
  },
  filterChipsScroll: {
    flexGrow: 0,
    marginHorizontal: -16,
  },
  filterChips: {
    gap: 8,
    paddingHorizontal: 16,
  },
  filterButton: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  summaryChip: {
    height: 44,
    maxWidth: 220,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: colors.navy,
    justifyContent: 'center',
  },
  summaryChipText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.white,
  },
  resultHeader: {
    gap: 2,
    paddingVertical: 4,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  resultSub: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  loading: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
  },
  mapButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 16,
    height: 46,
    paddingHorizontal: 20,
    borderRadius: 23,
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapButtonText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.white,
  },

  offerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 16,
  },
  offerSelectorOn: {
    borderWidth: 1,
    borderColor: '#BFDDEF',
    backgroundColor: colors.primarySoft,
  },
  offerSelectorOff: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#B8C8D9',
    backgroundColor: colors.surface,
  },
  offerSelectorWide: {
    maxWidth: 560,
  },
  offerSelectorPressed: {
    opacity: 0.9,
  },
  offerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE5EC',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  offerKicker: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  offerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  pickNone: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#B8C8D9',
  },
  pickTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  pickTitleOn: {
    fontWeight: '800',
  },
  pickHint: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },

  card: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardTop: {
    height: 96,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTopWide: {
    height: 110,
  },
  scorePill: {
    position: 'absolute',
    top: 8,
    left: 8,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    zIndex: 1,
  },
  scoreText: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  verified: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  cardBody: {
    paddingTop: 10,
    paddingHorizontal: 11,
    paddingBottom: 11,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardName: {
    flexShrink: 1,
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.text,
  },
  cardType: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#33465A',
  },
  cardLicence: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#33465A',
  },
  cardMeta: {
    fontSize: 12.5,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  availDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  availText: {
    flexShrink: 1,
    fontSize: 12.5,
    fontWeight: '700',
  },
  cardActions: {
    marginTop: 6,
    gap: 6,
  },
  tag: {
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: {
    fontSize: 13,
    fontWeight: '800',
  },

  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  input: {
    minHeight: 104,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },

  wideShell: {
    flex: 1,
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 26,
  },
  wideHead: {
    gap: 16,
    marginBottom: 18,
  },
  wideTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  wideTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
  },
  wideOffer: {
    alignSelf: 'stretch',
  },
  wideBody: {
    flex: 1,
    flexDirection: 'row',
    gap: 28,
  },
  filterColumn: {
    width: FILTER_COLUMN,
    marginBottom: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
  },
  filterColumnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 6,
  },
  filterColumnTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  link: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  filterScroll: {
    flex: 1,
  },
  filterScrollContent: {
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  filterColumnFoot: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  wideList: {
    paddingBottom: 48,
    gap: CARD_GAP,
  },
  wideRow: {
    gap: CARD_GAP,
  },
  cellWide: {
    minWidth: 0,
  },
});
