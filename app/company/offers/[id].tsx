import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  RefreshControl,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle,
  ClipboardCheck,
  Clock,
  Edit3,
  ListChecks,
  MapPin,
  Plane,
  Send,
  Trash2,
  UserRound,
  XCircle,
} from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { formatOfferSalary } from '../../../src/utils/offerSalary';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { MatchBadge } from '../../../src/components/MatchBadge';
import {
  CompanyBadge,
  CompanyCard,
  CompanyChip,
  CompanyPageHeader,
  CompanyScreen,
  EmptyPanel,
  IconBox,
  companyStyles,
  companyUi,
} from '../../../src/components/company/CompanyUI';
import { isOfferOpenForTechnicians, offerRepository } from '../../../src/repositories/v2/offerRepository';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { getMatchScoreWeights, getTechnicianMatchesForOffer, MatchScoreWeights, TechnicianMatchResult } from '../../../src/utils/matchingV2';
import { visibleBreakdownRows } from '../../../src/utils/matchBreakdownRows';
import { compareOfferCandidates, OFFER_RELATION_STATUS_ORDER } from '../../../src/utils/offerCandidateOrder';
import { OfferRequiredHabilitation, OfferWithRequirements } from '../../../src/types/offer';
import { OfferApplication, OfferRequest } from '../../../src/types/offerRequest';
import { MatchScore } from '../../../src/types/matching';
import { useCompanySession, useSession } from '../../../src/state/SessionContext';
import { canManageOffers, canSendDirectOffers } from '../../../src/utils/companyPermissionsV2';
import { resolveTypeRatingLabels } from '../../../src/utils/v2CompatAdapters';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { AircraftRatingIndex, getAircraftTypeRatingLabel } from '../../../src/constants/aircraftTypeRatings';
import { technicianTypeLabel, technicianTypeLabels } from '../../../src/constants/technicianTypes';
import { getOfferProductTypeLabel } from '../../../src/constants/offerProductTypes';
import { credentialLabel } from '../../../src/constants/licenses';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { ONLY_UNLICENSED_TEXT, offerCertificationText, offerEngineText, offerLicenseDetailText } from '../../../src/utils/offerRequirementsText';
import { offerAircraftAreExperience } from '../../../src/utils/offerShape';
import { notify, confirmAction } from '../../../src/utils/platformAlert';
import { ViewTechnicianProfileButton } from '../../../src/components/company/ViewTechnicianProfileButton';

type Tone = 'success' | 'warning' | 'error' | 'muted' | 'navy' | 'info' | 'cyan';

function statusTone(status: string): Tone {
  if (status === 'published') return 'success';
  if (status === 'draft') return 'warning';
  if (status === 'expired') return 'error';
  if (status === 'closed') return 'navy';
  return 'muted';
}

function scoreColor(total: number): string {
  if (total >= 80) return companyUi.green;
  if (total >= 60) return companyUi.blue;
  if (total >= 40) return companyUi.amber;
  return companyUi.textMuted;
}

const CONTRACT_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  long_term: 'Long-term',
  short_term: 'Short-term',
};

function availabilityLabel(value?: string): string {
  if (value === 'open_to_offers') return 'Open to offers';
  if (value === 'unavailable') return 'Unavailable';
  return 'Availability pending';
}

type OfferRelation = {
  id: string;
  kind: 'application' | 'direct_offer';
  status: OfferApplication['status'];
  createdAt: string;
};

function relationStatusTone(status: string): Tone {
  if (status === 'accepted') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'rejected') return 'error';
  return 'muted';
}

function relationStatusLabel(record: OfferRelation): string {
  const prefix = record.kind === 'application' ? 'Application' : 'Direct offer';
  if (record.status === 'accepted') return `${prefix} accepted`;
  if (record.status === 'pending') return `${prefix} pending`;
  if (record.status === 'rejected') return `${prefix} rejected`;
  if (record.status === 'withdrawn') return `${prefix} withdrawn`;
  if (record.status === 'expired') return `${prefix} expired`;
  return `${prefix} ${record.status}`;
}

function applicationActionLabel(status: OfferApplication['status']): string {
  if (status === 'accepted') return 'Application accepted - View application';
  if (status === 'rejected') return 'Application rejected - View application';
  if (status === 'pending') return 'Application pending - Review application';
  if (status === 'withdrawn') return 'Application withdrawn - View details';
  if (status === 'expired') return 'Application expired - View details';
  return 'View application';
}

function applicationActionColor(status: OfferApplication['status']): string {
  if (status === 'accepted') return companyUi.green;
  if (status === 'rejected') return companyUi.red;
  if (status === 'pending') return companyUi.amber;
  return companyUi.textSoft;
}

function formatPublishedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function shouldPreferRelation(next: OfferRelation, current?: OfferRelation): boolean {
  if (!current) return true;
  const currentOrder = OFFER_RELATION_STATUS_ORDER[current.status] ?? 4;
  const nextOrder = OFFER_RELATION_STATUS_ORDER[next.status] ?? 4;
  if (nextOrder !== currentOrder) return nextOrder < currentOrder;
  return new Date(next.createdAt).getTime() > new Date(current.createdAt).getTime();
}

export default function OfferDetailScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;
  const { sessionLoading } = useSession();
  // El score de esta pantalla lo calcula getTechnicianMatchesForOffer(), que
  // carga y espera su propio catalogo, asi que nunca sale de un indice vacio.
  // El ratingIndex del hook alimenta solo las ETIQUETAS de los ratings
  // (getAircraftTypeRatingLabel / resolveTypeRatingLabels), y esas si caen al
  // fallback y pintan el UUID crudo con el indice a medio cargar — de ahi el
  // gate de abajo.
  const { ratingIndex, state: catalogState } = useAircraftTypeRatingsCatalog();
  // Paso 5b: sólo para el nombre del motor de una oferta de motor.
  const { engineIndex } = useEnginesCatalog();

  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  const [matches, setMatches] = useState<TechnicianMatchResult[]>([]);
  const [existingRequests, setExistingRequests] = useState<OfferRequest[]>([]);
  const [applications, setApplications] = useState<OfferApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);

  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async (signal: { active: boolean }) => {
    // companyId hydrates asynchronously in SessionContext, independently of
    // the auth guard CompanyLayout already waits for — reading it before
    // that fetch resolves (e.g. a fresh page load straight into this
    // screen) would call getForCompany('') and crash on the Postgres UUID
    // cast. Same guard as app/company/offers/index.tsx.
    if (!id || !companyId) return;
    const [o, reqs, apps] = await Promise.all([
      offerRepository.getWithRequirements(id),
      offerRequestRepository.getForCompany(companyId),
      offerApplicationRepository.getForOffer(id),
    ]);
    if (!signal.active) return;
    setOffer(o);
    setExistingRequests(reqs.filter((r) => r.offerId === id));
    setApplications(apps);
  }, [companyId, id]);

  const loadMatches = useCallback(async (signal: { active: boolean }) => {
    if (!id) return;
    setLoadingMatches(true);
    const results = await getTechnicianMatchesForOffer(id);
    if (!signal.active) return;
    setMatches(results);
    setLoadingMatches(false);
  }, [id]);

  // Señal de cancelacion compartida por el efecto de foco y el pull-to-refresh:
  // load()/loadMatches() la comprueban ANTES de cada setState, no solo en el
  // .then/.finally, para que una carga vieja no pise los resultados de la nueva.
  const loadSignal = useRef<{ active: boolean }>({ active: false });

  useFocusEffect(
    useCallback(() => {
      if (!companyId) return;
      const signal = { active: true };
      loadSignal.current = signal;
      setLoading(true);
      load(signal)
        .then(() => { if (signal.active) loadMatches(signal); })
        .finally(() => { if (signal.active) setLoading(false); });
      return () => { signal.active = false; };
    }, [load, loadMatches, companyId]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    await loadMatches(loadSignal.current);
    setRefreshing(false);
  }

  async function handlePublish() {
    if (!offer || !id) return;
    setStatusChanging(true);
    await offerRepository.updateStatus(id, 'published');
    const updated = await offerRepository.getWithRequirements(id);
    setOffer(updated);
    setStatusChanging(false);
  }

  async function closeOffer() {
    if (!id) return;
    setStatusChanging(true);
    await offerRepository.updateStatus(id, 'closed');
    const updated = await offerRepository.getWithRequirements(id);
    setOffer(updated);
    setStatusChanging(false);
  }

  async function handleClose() {
    if (!offer || !id) return;
    // Fase 5.7 — esta pantalla tenía su propia rama `Platform.OS === 'web'`
    // con window.confirm, parcheada solo aquí cuando alguien tropezó con el
    // Alert no-op de react-native-web. confirmAction() lo centraliza para
    // toda la app; no reintroduzcas ramas por plataforma en las pantallas.
    const confirmed = await confirmAction({
      title: 'Close offer?',
      message: 'This offer will no longer be visible to technicians.',
      confirmLabel: 'Close offer',
      destructive: true,
    });
    if (!confirmed) return;
    await closeOffer();
  }

  async function deleteOffer() {
    if (!id) return;
    setStatusChanging(true);
    try {
      const { action } = await offerRepository.delete(id);
      if (action === 'deleted') {
        router.replace('/company/offers' as any);
        return;
      }
      // Archived, not deleted: the offer had existing applications or
      // direct offers, so the row was kept (see
      // docs/OFFER_DELETE_SOFT_DELETE_PROPOSAL.md) — stay on this page and
      // reflect the new status instead of navigating away as if it were
      // gone.
      const updated = await offerRepository.getWithRequirements(id);
      setOffer(updated);
      setStatusChanging(false);
      notify(
        'Offer archived',
        'This offer has existing applications or direct offers attached, so it was archived instead of permanently deleted. It is no longer visible to technicians, but every application, direct offer and chat tied to it is untouched.',
      );
    } catch (e: any) {
      notify('Error', e?.message ?? 'Could not delete the offer.');
      setStatusChanging(false);
    }
  }

  async function handleDelete() {
    if (!offer || !id) return;
    const { applications, directOffers } = await offerRepository.getDependentCounts(id);
    const hasDependents = applications > 0 || directOffers > 0;
    const message = hasDependents
      ? `This offer has ${applications} application(s) and ${directOffers} direct offer(s) attached, so it can't be permanently deleted. Archive it instead? It will stop being visible to technicians, but every application, direct offer and chat tied to it stays exactly as it is.`
      : 'This action cannot be undone.';
    const confirmLabel = hasDependents ? 'Archive' : 'Delete';

    const confirmed = await confirmAction({
      title: 'Delete offer?',
      message,
      confirmLabel,
      destructive: true,
    });
    if (!confirmed) return;
    await deleteOffer();
  }

  async function handleSendOffer() {
    if (!selectedTechId || !id || !companyId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    setSending(true);
    try {
      await offerRequestRepository.create({
        companyId,
        technicianId: selectedTechId,
        offerId: id,
        message: message.trim() || undefined,
      });
      setExistingRequests((prev) => [
        ...prev,
        {
          id: `pending-${selectedTechId}`,
          kind: 'direct_offer',
          companyId,
          technicianId: selectedTechId,
          offerId: id,
          status: 'pending',
          identityRevealed: false,
          documentsUnlocked: false,
          message: message.trim() || undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      setSelectedTechId(null);
      setMessage('');
      notify('Offer sent', 'The technician will be notified of your interest.');
    } catch (e: any) {
      notify('Could not send', e?.message ?? 'An error occurred.');
    } finally {
      setSending(false);
    }
  }

  function pendingRequestForTech(techId: string): boolean {
    return existingRequests.some((r) => r.technicianId === techId && r.status === 'pending');
  }

  function acceptedRequestForTech(techId: string): boolean {
    return existingRequests.some((r) => r.technicianId === techId && r.status === 'accepted');
  }

  const applicationByTechnician = useMemo(() => {
    const entries: Record<string, OfferRelation> = {};
    applications.forEach((application) => {
      const relation: OfferRelation = {
        id: application.id,
        kind: 'application',
        status: application.status,
        createdAt: application.createdAt,
      };
      if (shouldPreferRelation(relation, entries[application.technicianId])) {
        entries[application.technicianId] = relation;
      }
    });
    return entries;
  }, [applications]);

  const directOfferByTechnician = useMemo(() => {
    const entries: Record<string, OfferRelation> = {};
    existingRequests.forEach((request) => {
      const relation: OfferRelation = {
        id: request.id,
        kind: 'direct_offer',
        status: request.status,
        createdAt: request.createdAt,
      };
      if (shouldPreferRelation(relation, entries[request.technicianId])) {
        entries[request.technicianId] = relation;
      }
    });
    return entries;
  }, [existingRequests]);

  const offerRelationByTechnician = useMemo(() => {
    const entries: Record<string, OfferRelation> = { ...directOfferByTechnician };
    Object.entries(applicationByTechnician).forEach(([technicianId, relation]) => {
      entries[technicianId] = relation;
    });
    return entries;
  }, [applicationByTechnician, directOfferByTechnician]);

  const orderedMatches = useMemo(() => {
    const orderEntry = (match: TechnicianMatchResult) => ({
      applicationStatus: applicationByTechnician[match.technician.id]?.status,
      directOfferStatus: directOfferByTechnician[match.technician.id]?.status,
      total: match.score.total,
    });
    return [...matches].sort((a, b) => compareOfferCandidates(orderEntry(a), orderEntry(b)));
  }, [applicationByTechnician, directOfferByTechnician, matches]);

  const weights = useMemo(() => (offer ? getMatchScoreWeights(offer) : null), [offer]);

  // Mismo gate que app/technician/offers/index.tsx: mientras el catalogo
  // carga no se pinta nada, para no enseñar los ratings requeridos como UUID
  // crudo antes de que llegue el catalogo.
  if (loading || sessionLoading || catalogState === 'loading') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.blue} role="company" />
      </>
    );
  }

  if (!offer) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.notFound}>
          <EmptyPanel title="Offer not found" subtitle="This offer is no longer available." />
        </View>
      </CompanyScreen>
    );
  }

  const selectedTech = selectedTechId ? orderedMatches.find((m) => m.technician.id === selectedTechId) : null;
  const offerCanReceiveDirectOffers = isOfferOpenForTechnicians(offer);
  const canManage = canManageOffers(companyMemberRole);
  const canSend = canSendDirectOffers(companyMemberRole) && offerCanReceiveDirectOffers;

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[companyStyles.content, isWide && companyStyles.contentWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <CompanyPageHeader
          eyebrow="Offer detail"
          title={offer.title}
          subtitle={`${offer.locationCity}, ${offer.locationCountry}${offer.locationBaseAirport ? ` - ${offer.locationBaseAirport}` : ''}`}
          onBack={goBack}
          right={<CompanyBadge label={offer.status} tone={statusTone(offer.status)} />}
        />

        <CompanyCard style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <IconBox icon={BriefcaseBusiness} color={statusAccent(offer.status)} backgroundColor={offer.status === 'published' ? companyUi.greenSoft : companyUi.surfaceSoft} />
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryTitle}>Summary</Text>
              <Text style={styles.summaryDescription}>{offer.description}</Text>
            </View>
          </View>

          <View style={styles.metaGrid}>
            <MetaTile label="Aircraft" value={getOfferProductTypeLabel(offer.productType)} icon={Plane} />
            <MetaTile label="Contract" value={CONTRACT_LABELS[offer.contractType] ?? offer.contractType} />
            <MetaTile label="Experience" value={`${offer.minYearsExperience} yrs min`} />
            <MetaTile label="Published" value={formatPublishedDate(offer.createdAt)} icon={CalendarDays} />
          </View>

          <View style={styles.metaTile}>
            <Text style={styles.metaLabel}>Remuneration</Text>
            <Text style={styles.metaValue}>{formatOfferSalary(offer.salary) ?? 'Not specified'}</Text>
          </View>

          <View style={styles.locationLine}>
            <MapPin color={companyUi.textMuted} size={15} strokeWidth={2} />
            <Text style={styles.locationText}>
              {offer.locationCity}, {offer.locationCountry}
              {offer.locationBaseAirport ? ` - ${offer.locationBaseAirport}` : ''}
            </Text>
          </View>
        </CompanyCard>

        <CompanyCard style={styles.sectionCard}>
          <SectionTitle title="Requirements" />
          {/* Paso 5b: en una oferta de motor el oficio no puntúa ni filtra;
              lo que pide es el motor. */}
          {offer.offerKind === 'engine' ? (
            <RequirementRow label="Engine" items={[offerEngineText(offer, engineIndex) ?? 'Not specified']} />
          ) : (
            <RequirementRow label="Profile type" items={[technicianTypeLabel(offer.technicianType)]} />
          )}
          {/* Fase 6 tanda C: se dice SIEMPRE, no solo cuando exige licencia.
              "No licence needed" es información, no ausencia de requisito. */}
          <RequirementRow
            label="Certified work"
            items={[offerCertificationText(offer)]}
          />
          {offer.licenseCode ? <RequirementRow label="Licence" items={[offerLicenseDetailText(offer)!]} /> : null}
          {offer.onlyUnlicensed ? <RequirementRow label="Candidates" items={[ONLY_UNLICENSED_TEXT]} /> : null}
          {offer.requiredHabilitations.length > 0 ? (
            <TypeRatingRequirementsRow
              habilitations={offer.requiredHabilitations}
              licenseCode={offerAircraftAreExperience(offer) ? undefined : offer.licenseCode}
              requiresAll={offer.requiresAllAircraft}
              ratingIndex={ratingIndex}
            />
          ) : null}
          {offer.offerKind === 'aircraft' && !offer.licenseCode && offer.requiredHabilitations.length === 0 ? (
            <Text style={styles.noRequirementsText}>
              {offer.requiresCertification
                ? 'No licence or type rating required beyond the profile type.'
                : 'This job does not need certified work — no licence or type rating applies.'}
            </Text>
          ) : null}
        </CompanyCard>

        {canManage && offer.status !== 'archived' ? (
          <CompanyCard style={styles.sectionCard}>
            <SectionTitle title="Actions" />
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => router.push(`/company/offers/edit?id=${offer.id}` as any)}
                activeOpacity={0.75}
              >
                <Edit3 color={companyUi.textSoft} size={15} strokeWidth={2} />
                <Text style={styles.secondaryButtonText}>Edit offer</Text>
              </TouchableOpacity>
              {offer.status === 'draft' ? (
                <TouchableOpacity
                  style={[styles.primaryButton, statusChanging && styles.btnDisabled]}
                  onPress={handlePublish}
                  disabled={statusChanging}
                  activeOpacity={0.75}
                >
                  {statusChanging ? <ActivityIndicator color={colors.white} size="small" /> : <CheckCircle color={colors.white} size={16} strokeWidth={2} />}
                  <Text style={styles.primaryButtonText}>Publish</Text>
                </TouchableOpacity>
              ) : null}
              {offer.status === 'closed' ? (
                <TouchableOpacity
                  style={[styles.primaryButton, statusChanging && styles.btnDisabled]}
                  onPress={handlePublish}
                  disabled={statusChanging}
                  activeOpacity={0.75}
                >
                  {statusChanging ? <ActivityIndicator color={colors.white} size="small" /> : <CheckCircle color={colors.white} size={16} strokeWidth={2} />}
                  <Text style={styles.primaryButtonText}>Reopen offer</Text>
                </TouchableOpacity>
              ) : null}
              {offer.status === 'published' ? (
                <TouchableOpacity
                  style={[styles.dangerButton, statusChanging && styles.btnDisabled]}
                  onPress={handleClose}
                  disabled={statusChanging}
                  activeOpacity={0.75}
                >
                  {statusChanging ? <ActivityIndicator color={colors.white} size="small" /> : <XCircle color={colors.white} size={16} strokeWidth={2} />}
                  <Text style={styles.primaryButtonText}>Close offer</Text>
                </TouchableOpacity>
              ) : null}
              {offer.status === 'closed' ? (
                <TouchableOpacity
                  style={[styles.deleteButton, statusChanging && styles.btnDisabled]}
                  onPress={handleDelete}
                  disabled={statusChanging}
                  activeOpacity={0.75}
                >
                  {statusChanging ? <ActivityIndicator color={colors.white} size="small" /> : <Trash2 color={colors.white} size={16} strokeWidth={2} />}
                  <Text style={styles.primaryButtonText}>Delete offer</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </CompanyCard>
        ) : null}

        <View style={styles.matchesHeader}>
          <Text style={styles.matchesTitle}>Technician matches</Text>
          <Text style={styles.matchesSub}>Applications and direct offer records appear first: accepted, pending, then rejected.</Text>
        </View>

        {loadingMatches ? (
          <CompanyCard style={styles.loadingPanel}>
            <ActivityIndicator color={companyUi.accent} />
            <Text style={styles.loadingText}>Computing match scores...</Text>
          </CompanyCard>
        ) : null}

        {!loadingMatches && matches.length === 0 ? (
          <EmptyPanel title="No technicians found" subtitle="There are no technicians available for this offer yet." />
        ) : null}

        {!loadingMatches && orderedMatches.map(({ technician, score }) => {
          const isPending = pendingRequestForTech(technician.id);
          const isAccepted = acceptedRequestForTech(technician.id);
          const application = applicationByTechnician[technician.id];
          const relation = offerRelationByTechnician[technician.id];
          const accent = scoreColor(score.total);
          const licenses = technician.licenses.slice(0, 4);
          // displayName completo (célula + MOTOR), no `aircraftFamily` suelta.
          // Ésta es la pantalla donde la empresa rankea candidatos contra un
          // type rating que ES célula+motor: mostrar "Airbus A318/A319/A320/A321"
          // sin el motor impedía distinguir CFM56 de V2500, justo la distinción
          // que el modelo Part-66 existe para preservar. Misma función que usan
          // búsqueda y mapa — una sola definición de la etiqueta.
          const aircraft = resolveTypeRatingLabels(technician.habilitations, ratingIndex).slice(0, 4);

          return (
            <CompanyCard key={technician.id} style={[styles.techCard, { borderLeftColor: accent }]}>
              <View style={styles.techHeader}>
                <IconBox icon={UserRound} color={accent} backgroundColor={score.total >= 60 ? companyUi.blueSoft : companyUi.surfaceSoft} />
                <View style={styles.techInfo}>
                  <Text style={styles.techCode}>{technician.anonymousCode}</Text>
                  <Text style={styles.techMeta}>
                    {technicianTypeLabels(technician.technicianTypes)} - {technician.city}, {technician.country}
                  </Text>
                </View>
                <MatchBadge score={score.total} context="match for this offer" notEligible={score.blockers.length > 0} />
              </View>

              <View style={styles.badgeRow}>
                <CompanyBadge
                  label={technician.verificationStatus === 'verified' ? 'Verified' : technician.verificationStatus}
                  tone={technician.verificationStatus === 'verified' ? 'success' : 'warning'}
                  small
                />
                <CompanyBadge label={availabilityLabel(technician.availability.status)} tone="cyan" small />
                {technician.baseAirport ? <CompanyBadge label={technician.baseAirport} tone="muted" small /> : null}
                {relation ? (
                  <CompanyBadge
                    label={relationStatusLabel(relation)}
                    tone={relationStatusTone(relation.status)}
                    small
                  />
                ) : null}
              </View>

              {licenses.length > 0 ? (
                <View style={styles.chipBlock}>
                  <Text style={styles.chipBlockLabel}>Licenses</Text>
                  <View style={styles.chipRow}>{licenses.map((l) => <CompanyChip key={`${l.authority}-${l.licenseCode}`} label={credentialLabel(l.authority, l.licenseCode)} />)}</View>
                </View>
              ) : null}

              {aircraft.length > 0 ? (
                <View style={styles.chipBlock}>
                  <Text style={styles.chipBlockLabel}>Type ratings</Text>
                  <View style={styles.chipRow}>{aircraft.map((a) => <CompanyChip key={a} label={a} />)}</View>
                </View>
              ) : null}

              <View style={styles.breakdown}>
                {visibleBreakdownRows(weights).map((row) => (
                  <BreakdownItem key={row.key} label={row.label} value={score.breakdown[row.key]} max={row.max} />
                ))}
              </View>

              <CapReasonPanel score={score} />
              <VigenciaNotices score={score} />
              <AuthorityEquivalenceNote score={score} />

              {relation?.status === 'accepted' ? (
                <ViewTechnicianProfileButton technicianId={technician.id} fullWidth />
              ) : null}

              {application ? (
                <TouchableOpacity
                  style={[
                    styles.viewApplicationButton,
                    { backgroundColor: applicationActionColor(application.status) },
                  ]}
                  onPress={() => router.push(`/company/applications/${application.id}` as any)}
                  activeOpacity={0.75}
                >
                  {application.status === 'accepted' ? (
                    <CheckCircle color={colors.white} size={16} strokeWidth={2} />
                  ) : application.status === 'rejected' ? (
                    <XCircle color={colors.white} size={16} strokeWidth={2} />
                  ) : application.status === 'pending' ? (
                    <Clock color={colors.white} size={16} strokeWidth={2} />
                  ) : (
                    <ClipboardCheck color={colors.white} size={16} strokeWidth={2} />
                  )}
                  <Text style={styles.primaryButtonText}>{applicationActionLabel(application.status)}</Text>
                </TouchableOpacity>
              ) : isAccepted ? (
                <View style={styles.stateNotice}>
                  <CheckCircle color={companyUi.green} size={16} strokeWidth={2} />
                  <Text style={[styles.stateNoticeText, { color: companyUi.green }]}>Direct offer accepted</Text>
                </View>
              ) : isPending ? (
                <View style={styles.stateNotice}>
                  <Clock color={companyUi.amber} size={16} strokeWidth={2} />
                  <Text style={[styles.stateNoticeText, { color: companyUi.amber }]}>Direct offer sent - pending</Text>
                </View>
              ) : canSend ? (
                <TouchableOpacity
                  style={styles.sendButton}
                  onPress={() => { setSelectedTechId(technician.id); setMessage(''); }}
                  activeOpacity={0.75}
                >
                  <Send color={colors.white} size={16} strokeWidth={2} />
                  <Text style={styles.primaryButtonText}>Send direct offer</Text>
                </TouchableOpacity>
              ) : !offerCanReceiveDirectOffers ? (
                <View style={styles.stateNotice}>
                  <XCircle color={companyUi.textMuted} size={16} strokeWidth={2} />
                  <Text style={styles.stateNoticeText}>Closed offers cannot be sent privately</Text>
                </View>
              ) : null}
            </CompanyCard>
          );
        })}
      </ScrollView>

      <Modal
        visible={selectedTechId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedTechId(null)}
      >
        <View style={modalStyles.overlay}>
          <CompanyCard style={modalStyles.sheet}>
            <Text style={modalStyles.title}>Send direct offer</Text>
            {selectedTech ? (
              <Text style={modalStyles.techName}>
                {selectedTech.technician.anonymousCode} - {selectedTech.score.total}% match for this offer
              </Text>
            ) : null}
            <Text style={modalStyles.fieldLabel}>Personal message (optional)</Text>
            <TextInput
              style={modalStyles.input}
              placeholder="Add a note to the technician..."
              placeholderTextColor={companyUi.textMuted}
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View style={modalStyles.actions}>
              <TouchableOpacity
                style={[modalStyles.button, modalStyles.cancelButton]}
                onPress={() => setSelectedTechId(null)}
                activeOpacity={0.75}
              >
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.button, modalStyles.confirmButton, sending && styles.btnDisabled]}
                onPress={handleSendOffer}
                disabled={sending}
                activeOpacity={0.75}
              >
                {sending ? <ActivityIndicator color={colors.white} size="small" /> : <Send color={colors.white} size={16} strokeWidth={2} />}
                <Text style={modalStyles.confirmText}>Send offer</Text>
              </TouchableOpacity>
            </View>
          </CompanyCard>
        </View>
      </Modal>
    </CompanyScreen>
  );
}

function statusAccent(status: string): string {
  if (status === 'published') return companyUi.green;
  if (status === 'draft') return companyUi.amber;
  if (status === 'expired') return companyUi.red;
  return companyUi.textMuted;
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function MetaTile({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ color: string; size: number; strokeWidth: number }> }) {
  return (
    <View style={styles.metaTile}>
      {Icon ? (
        <View style={styles.metaLabelRow}>
          <Icon color={companyUi.textMuted} size={11} strokeWidth={2} />
          <Text style={styles.metaLabel}>{label}</Text>
        </View>
      ) : (
        <Text style={styles.metaLabel}>{label}</Text>
      )}
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

// Renders nothing when empty rather than a placeholder "Any" chip — an
// unset broad field isn't a requirement worth stating, and showing "Any"
// reads as if it were deliberately unrestricted. Superseded entirely by
// TypeRatingRequirementsRow once these legacy fields are removed.
function RequirementRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.requirementRow}>
      <View style={styles.requirementLabelRow}>
        <ListChecks color={companyUi.textMuted} size={14} strokeWidth={2} />
        <Text style={styles.requirementLabel}>{label}</Text>
      </View>
      <View style={styles.chipRow}>
        {items.map((item) => <CompanyChip key={item} label={item} />)}
      </View>
    </View>
  );
}

// Fase 6 tanda D: la píldora Mandatory/Preferred por fila desaparece. Era la
// que nadie sabía combinar — tres "obligatorias" significaban en la práctica
// "una cualquiera". Ahora la exigencia se dice UNA vez, arriba, y vale para
// toda la lista.
function TypeRatingRequirementsRow({
  habilitations,
  licenseCode,
  requiresAll,
  ratingIndex,
}: {
  habilitations: OfferRequiredHabilitation[];
  licenseCode?: string;
  requiresAll: boolean;
  ratingIndex: AircraftRatingIndex;
}) {
  return (
    <View style={styles.requirementRow}>
      <View style={styles.requirementLabelRow}>
        <ListChecks color={companyUi.textMuted} size={14} strokeWidth={2} />
        <Text style={styles.requirementLabel}>
          {requiresAll ? 'Aircraft — ALL of these' : 'Aircraft — any one of these'}
        </Text>
      </View>
      <View style={styles.habilitationReqList}>
        {habilitations.map((req, i) => (
          <View key={`${req.aircraftTypeRatingId}-${i}`} style={styles.habilitationReqItem}>
            <Text style={styles.habilitationReqText}>
              {licenseCode ? `${licenseCode} + ` : ''}
              {getAircraftTypeRatingLabel(req.aircraftTypeRatingId, ratingIndex)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Surfaces WHY score.total is lower than the raw breakdown sum — a mandatory
// exact-habilitation requirement not met, and/or the qualification-zero
// ceiling (see MANDATORY_UNMET_CAP / ZERO_QUALIFICATION_CAP in
// offerMatchExplain.ts). Without this, a capped score reads as an unexplained
// discrepancy between the bars above and the badge total.
function CapReasonPanel({ score }: { score: MatchScore }) {
  const rawSum = Object.values(score.breakdown).reduce((sum, v) => sum + v, 0);
  const wasCapped = rawSum > score.total;
  if (!wasCapped) return null;

  return (
    <View style={styles.capPanel}>
      <View style={styles.capHeaderRow}>
        <AlertTriangle color={companyUi.amber} size={14} strokeWidth={2} />
        <Text style={styles.capTitle}>Score capped ({rawSum}% raw before cap)</Text>
      </View>
      {score.missingRequirements.map((m: string, i: number) => (
        <Text key={`mm-${i}`} style={styles.capMissingLine}>Not met: {m}</Text>
      ))}
      {score.clarifications.map((c, i) => (
        <Text key={`cl-${i}`} style={styles.capClarificationLine}>{c}</Text>
      ))}
    </View>
  );
}

// Fase 3 — vigencia: a slight, non-excluding degradation (never a cap, so
// CapReasonPanel above never catches it — the breakdown bar already
// reflects the reduced number). Shown unconditionally whenever present,
// same "always visible" treatment as MatchExplanation's Validity section
// on the other 3 audited screens.
function VigenciaNotices({ score }: { score: MatchScore }) {
  if (score.vigenciaNotices.length === 0) return null;
  return (
    <View style={styles.vigenciaBlock}>
      {score.vigenciaNotices.map((n, i) => (
        <View key={i} style={styles.vigenciaRow}>
          <CompanyBadge label={n.label} tone="warning" small />
          <Text style={styles.vigenciaDetail}>{n.detail}</Text>
        </View>
      ))}
    </View>
  );
}

// Ajustes finales de Fase 10: el recorte por autoridad equivalente (87 en vez
// de 100) tampoco es un techo, así que CapReasonPanel no lo recoge. Siempre
// visible cuando existe, como la vigencia de arriba.
function AuthorityEquivalenceNote({ score }: { score: MatchScore }) {
  if (!score.authorityEquivalence) return null;
  return (
    <View style={styles.vigenciaRow}>
      <CompanyBadge label="Equivalent" tone="info" small />
      <Text style={styles.vigenciaDetail}>{score.authorityEquivalence}</Text>
    </View>
  );
}

function BreakdownItem({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <View style={styles.breakdownItem}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <View style={styles.breakdownTrack}>
        <View style={[styles.breakdownFill, { width: `${pct}%` as any, backgroundColor: value > 0 ? companyUi.accent : companyUi.border }]} />
      </View>
      <Text style={[styles.breakdownValue, { color: value > 0 ? companyUi.green : companyUi.textMuted }]}>
        {value}/{max}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  summaryCard: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  summaryTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.text,
    marginBottom: 4,
  },
  summaryDescription: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  metaGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metaTile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    backgroundColor: companyUi.surfaceSoft,
    borderWidth: 1,
    borderColor: companyUi.borderSoft,
    padding: spacing.sm,
  },
  metaLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: companyUi.textMuted,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: companyUi.text,
  },
  locationLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
  },
  locationText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: companyUi.textSoft,
  },
  sectionCard: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.text,
  },
  requirementRow: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
  },
  requirementLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  requirementLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: companyUi.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  habilitationReqList: {
    gap: spacing.xs,
  },
  habilitationReqItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  habilitationReqText: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: companyUi.text,
  },
  noRequirementsText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    fontStyle: 'italic',
    color: companyUi.textMuted,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    minWidth: 140,
    minHeight: 42,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  primaryButton: {
    flex: 1,
    minWidth: 140,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: companyUi.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dangerButton: {
    flex: 1,
    minWidth: 140,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: companyUi.red,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  deleteButton: {
    flex: 1,
    minWidth: 140,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: companyUi.textMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.white,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  matchesHeader: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  matchesTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: companyUi.text,
  },
  matchesSub: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  loadingPanel: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  techCard: {
    gap: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 4,
  },
  techHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  techInfo: {
    flex: 1,
    minWidth: 0,
  },
  techCode: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.text,
  },
  techMeta: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chipBlock: {
    gap: spacing.xs,
  },
  chipBlockLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: companyUi.textMuted,
  },
  breakdown: {
    backgroundColor: companyUi.surfaceSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: companyUi.borderSoft,
    padding: spacing.sm,
    gap: 4,
  },
  breakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  breakdownLabel: {
    width: 76,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: companyUi.textSoft,
  },
  breakdownTrack: {
    flex: 1,
    height: 6,
    borderRadius: 4,
    backgroundColor: companyUi.borderSoft,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: '100%',
    borderRadius: 4,
  },
  breakdownValue: {
    width: 38,
    textAlign: 'right',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  capPanel: {
    backgroundColor: companyUi.amberSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: spacing.sm,
    gap: 4,
  },
  capHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  capTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: companyUi.amber,
  },
  capMissingLine: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: companyUi.red,
  },
  capClarificationLine: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: companyUi.amber,
  },
  vigenciaBlock: {
    gap: 4,
  },
  vigenciaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  vigenciaDetail: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: companyUi.textSoft,
  },
  stateNotice: {
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: companyUi.surfaceSoft,
    borderWidth: 1,
    borderColor: companyUi.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  stateNoticeText: {
    fontSize: 13,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  sendButton: {
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: companyUi.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  viewApplicationButton: {
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: companyUi.blue,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.44)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    gap: spacing.sm,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: companyUi.text,
  },
  techName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: companyUi.textSoft,
  },
  fieldLabel: {
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  input: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: companyUi.border,
    borderRadius: 16,
    backgroundColor: companyUi.surfaceSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: companyUi.text,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surface,
  },
  confirmButton: {
    backgroundColor: companyUi.accent,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
});
