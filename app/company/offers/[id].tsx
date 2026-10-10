import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, Pressable, Platform, RefreshControl } from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { isUnlocked } from '../../../src/types/privacy';
import { companyTechnicianName, companyTechnicianPhoto } from '../../../src/utils/companyTechnicianIdentity';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  LockKeyhole,
  LockOpen,
  Pencil,
  Send,
  Trash2,
  Upload,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { colors } from '../../../src/theme';
import { formatOfferSalary } from '../../../src/utils/offerSalary';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { Avatar, BottomSheet, Text, TextInput, useConfirmDialog } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import {
  Breadcrumb,
  ButtonRow,
  CARD_BORDER,
  EmptyBlock,
  KeyValueRow,
  LoadingBlock,
  OfferTileSquare,
  OutlineTag,
  PageBar,
  PageBody,
  PillButton,
  RowList,
  Section,
  StatGrid,
  StatTile,
  StatusPill,
  StickyBar,
  TagRow,
  TwoColumns,
  VerificationPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { BreakdownBars, matchScoreColor } from '../../../src/components/company/MatchBreakdownBars';
import { isOfferOpenForTechnicians, offerRepository } from '../../../src/repositories/v2/offerRepository';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { getTechnicianMatchesForOffer, TechnicianMatchResult } from '../../../src/utils/matchingV2';
import { visibleBreakdownRows, type BreakdownRowSpec } from '../../../src/utils/matchBreakdownRows';
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
import { ONLY_UNLICENSED_TEXT, offerCertificationText, offerEngineText, offerLicenseDetailText, requirementWithNote } from '../../../src/utils/offerRequirementsText';
import { offerAircraftAreExperience } from '../../../src/utils/offerShape';
import { notify } from '../../../src/utils/platformAlert';
import { formatLocation } from '../../../src/utils/formatLocation';
import { relativeTime } from '../../../src/utils/companyHome';
import { offerRelationLook, offerStatusLook } from '../../../src/utils/companyStatus';

// Una oferta de la empresa (rediseño, fase 3; maquetas W-Offer y W-D-Offer;
// respuesta 13). Cambia el aspecto; se queda todo lo que hacía:
//   - la lista de técnicos de siempre: candidaturas y ofertas directas
//     primero, luego los mejores, con su % y "Send direct offer";
//   - publicar, cerrar, reabrir y borrar, ahora en el menú "⋯", con las
//     mismas confirmaciones y las mismas condiciones (borrar, sólo cerrada).

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

// iOS no presenta un Modal mientras otro se está cerrando: la acción del menú
// espera a que la hoja termine de irse antes de abrir su confirmación.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 350 : 0;

export default function OfferDetailScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wide = useIsWide();
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
  const { confirm, dialog } = useConfirmDialog();

  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  const [matches, setMatches] = useState<TechnicianMatchResult[]>([]);
  const [existingRequests, setExistingRequests] = useState<OfferRequest[]>([]);
  const [applications, setApplications] = useState<OfferApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
    const confirmed = await confirm({
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
    const { applications: dependentApplications, directOffers } = await offerRepository.getDependentCounts(id);
    const hasDependents = dependentApplications > 0 || directOffers > 0;
    const text = hasDependents
      ? `This offer has ${dependentApplications} application(s) and ${directOffers} direct offer(s) attached, so it can't be permanently deleted. Archive it instead? It will stop being visible to technicians, but every application, direct offer and chat tied to it stays exactly as it is.`
      : 'This action cannot be undone.';
    const confirmLabel = hasDependents ? 'Archive' : 'Delete';

    const confirmed = await confirm({
      title: 'Delete offer?',
      message: text,
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

  const breakdownRows = useMemo(() => visibleBreakdownRows(offer), [offer]);

  // Mismo gate que app/technician/offers/index.tsx: mientras el catalogo
  // carga no se pinta nada, para no enseñar los ratings requeridos como UUID
  // crudo antes de que llegue el catalogo.
  if (loading || sessionLoading || catalogState === 'loading') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="company" />
      </>
    );
  }

  if (!offer) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        {!wide ? <PageBar title="Offer" onBack={goBack} /> : null}
        <PageBody wide={wide}>
          <EmptyBlock title="Offer not found" text="This offer is no longer available." />
        </PageBody>
      </CompanyScreen>
    );
  }

  const selectedTech = selectedTechId ? orderedMatches.find((m) => m.technician.id === selectedTechId) : null;
  const offerCanReceiveDirectOffers = isOfferOpenForTechnicians(offer);
  const canManage = canManageOffers(companyMemberRole);
  const canSend = canSendDirectOffers(companyMemberRole) && offerCanReceiveDirectOffers;
  const status = offerStatusLook(offer.status);
  const location = `${formatLocation(offer.locationCity, offer.locationCountry)}${offer.locationBaseAirport ? ` - ${offer.locationBaseAirport}` : ''}`;
  const editOffer = () => router.push(`/company/offers/edit?id=${offer.id}` as any);

  // ── Menú "⋯": las mismas acciones y condiciones que el bloque "Actions" de antes.
  type MenuItem = { key: string; label: string; icon: React.ComponentType<LucideProps>; destructive?: boolean; run: () => void };
  const menuItems: MenuItem[] = canManage && offer.status !== 'archived'
    ? [
        { key: 'edit', label: 'Edit offer', icon: Pencil, run: editOffer },
        ...(offer.status === 'draft' ? [{ key: 'publish', label: 'Publish', icon: Upload, run: handlePublish }] : []),
        ...(offer.status === 'closed' ? [{ key: 'reopen', label: 'Reopen offer', icon: LockOpen, run: handlePublish }] : []),
        ...(offer.status === 'published' ? [{ key: 'close', label: 'Close offer', icon: LockKeyhole, run: handleClose }] : []),
        ...(offer.status === 'closed' ? [{ key: 'delete', label: 'Delete offer', icon: Trash2, destructive: true, run: handleDelete }] : []),
      ]
    : [];

  function runFromMenu(item: MenuItem) {
    setMenuOpen(false);
    setTimeout(item.run, AFTER_SHEET_MS);
  }

  const menuButton = menuItems.length > 0 ? (
    <Pressable
      onPress={() => setMenuOpen(true)}
      disabled={statusChanging}
      style={({ pressed, hovered }: any) => [wide ? styles.menuButtonWide : styles.menuButton, (pressed || hovered) && styles.menuButtonPressed]}
      accessibilityRole="button"
      accessibilityLabel="More actions"
    >
      <Ellipsis color={colors.text} size={wide ? 22 : 24} strokeWidth={2.6} />
    </Pressable>
  ) : null;

  // Botón principal, a la vista (maqueta): editar; en una cerrada, reabrir; en
  // un borrador, editar y publicar. Lo demás, en el menú.
  const primaryActions = canManage && offer.status !== 'archived' ? (
    offer.status === 'closed'
      ? <PillButton label="Reopen offer" onPress={handlePublish} loading={statusChanging} size={wide ? 'md' : 'lg'} grow={wide ? undefined : 1} />
      : offer.status === 'draft'
        ? (
          <>
            <PillButton label="Edit offer" variant="outline" onPress={editOffer} size={wide ? 'md' : 'lg'} grow={wide ? undefined : 1} />
            <PillButton label="Publish" onPress={handlePublish} loading={statusChanging} size={wide ? 'md' : 'lg'} grow={wide ? undefined : 1} />
          </>
        )
        : <PillButton label="Edit offer" variant="outline" onPress={editOffer} size={wide ? 'md' : 'lg'} grow={wide ? undefined : 1} />
  ) : null;

  const header = (
    <View style={styles.header}>
      <OfferTileSquare offer={offer} size={wide ? 64 : 60} />
      <View style={styles.headerCopy}>
        <Text style={[styles.title, wide && styles.titleWide]} accessibilityRole="header">{offer.title}</Text>
        <View style={styles.statusLine}>
          <StatusPill label={status.label} tone={status.tone} large={wide} />
          <Text style={styles.when}>
            {offer.status === 'draft' ? 'Created' : 'Published'} {relativeTime(offer.createdAt)}
          </Text>
        </View>
      </View>
      {wide ? (
        <View style={styles.headerActions}>
          {primaryActions}
          {menuButton}
        </View>
      ) : null}
    </View>
  );

  const facts = (
    <StatGrid>
      <StatTile label="Contract" value={CONTRACT_LABELS[offer.contractType] ?? offer.contractType} />
      <StatTile label="Remuneration" value={formatOfferSalary(offer.salary) ?? 'Not specified'} />
      <StatTile label="Location" value={location} />
      <StatTile label="Experience" value={`${offer.minYearsExperience} yrs min`} />
      <StatTile label="Aircraft" value={getOfferProductTypeLabel(offer.productType)} />
      <StatTile label="Published" value={formatPublishedDate(offer.createdAt)} />
    </StatGrid>
  );

  const description = offer.description ? (
    <Section title="Description" wide={wide}>
      <Text style={styles.description}>{offer.description}</Text>
    </Section>
  ) : null;

  const requirementRows: { label: string; value: React.ReactNode }[] = [
    // Paso 5b: en una oferta de motor el oficio no puntúa ni filtra; lo que
    // pide es el motor.
    offer.offerKind === 'engine'
      ? { label: 'Engine', value: requirementWithNote(offerEngineText(offer, engineIndex) ?? 'Not specified', offer.requiredEngineNotes) }
      : { label: 'Profile type', value: technicianTypeLabel(offer.technicianType) },
    // Fase 6 tanda C: se dice SIEMPRE, no solo cuando exige licencia. "No
    // licence needed" es información, no ausencia de requisito.
    { label: 'Certified work', value: offerCertificationText(offer) },
    ...(offer.licenseCode ? [{ label: 'Licence', value: offerLicenseDetailText(offer)! }] : []),
    ...(offer.onlyUnlicensed ? [{ label: 'Candidates', value: ONLY_UNLICENSED_TEXT }] : []),
    ...(offer.requiredHabilitations.length > 0
      ? [{
          label: offer.requiresAllAircraft ? 'Aircraft — ALL of these' : 'Aircraft — any one of these',
          value: (
            <AircraftList
              habilitations={offer.requiredHabilitations}
              licenseCode={offerAircraftAreExperience(offer) ? undefined : offer.licenseCode}
              ratingIndex={ratingIndex}
            />
          ),
        }]
      : []),
  ];

  const requirements = (
    <Section title="Requirements" wide={wide} gap={2}>
      <View>
        {requirementRows.map((row, i) => (
          <KeyValueRow key={row.label} label={row.label} value={row.value} last={i === requirementRows.length - 1} />
        ))}
      </View>
      {offer.offerKind === 'aircraft' && !offer.licenseCode && offer.requiredHabilitations.length === 0 ? (
        <Text style={styles.note}>
          {offer.requiresCertification
            ? 'No licence or type rating required beyond the profile type.'
            : 'This job does not need certified work — no licence or type rating applies.'}
        </Text>
      ) : null}
    </Section>
  );

  const technicians = (
    <Section title="Technicians for this offer" wide={wide} gap={4}>
      <Text style={styles.note}>Applications and direct offers first, then the best matches.</Text>
      <View style={styles.techList}>
        {loadingMatches ? (
          <LoadingBlock label="Computing match scores..." />
        ) : matches.length === 0 ? (
          <EmptyBlock title="No technicians found" text="There are no technicians available for this offer yet." />
        ) : (
          <RowList wide={wide}>
            {orderedMatches.map((result) => {
              const techId = result.technician.id;
              const application = applicationByTechnician[techId];
              return (
                <TechnicianRow
                  key={techId}
                  result={result}
                  wide={wide}
                  relation={offerRelationByTechnician[techId]}
                  application={application}
                  directAccepted={acceptedRequestForTech(techId)}
                  directPending={pendingRequestForTech(techId)}
                  canSend={canSend}
                  offerOpen={offerCanReceiveDirectOffers}
                  ratingIndex={ratingIndex}
                  breakdownRows={breakdownRows}
                  onSend={() => { setSelectedTechId(techId); setMessage(''); }}
                  onViewApplication={application ? () => router.push(`/company/applications/${application.id}` as any) : undefined}
                  onViewProfile={() => router.push(`/company/technician/${techId}` as any)}
                />
              );
            })}
          </RowList>
        )}
      </View>
    </Section>
  );

  const menuSheet = (
    <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={wide ? 'Offer actions' : undefined}>
      <View>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const tint = item.destructive ? colors.error : colors.text;
          return (
            <Pressable
              key={item.key}
              onPress={() => runFromMenu(item)}
              style={({ pressed, hovered }: any) => [styles.menuItem, (pressed || hovered) && styles.menuItemPressed]}
              accessibilityRole="menuitem"
            >
              <Icon color={tint} size={20} strokeWidth={2} />
              <Text style={[styles.menuItemText, { color: tint }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );

  const sendSheet = (
    <BottomSheet
      visible={selectedTechId !== null}
      onClose={() => setSelectedTechId(null)}
      dismissible={!sending}
      title="Send direct offer"
      subtitle={selectedTech
        ? `To ${companyTechnicianName(selectedTech.technician)} · ${selectedTech.score.total}% match for this offer`
        : undefined}
      footer={(
        <ButtonRow>
          <PillButton label="Cancel" variant="outline" size="md" onPress={() => setSelectedTechId(null)} disabled={sending} grow={1} />
          <PillButton label="Send offer" icon={Send} size="md" onPress={handleSendOffer} loading={sending} grow={1} />
        </ButtonRow>
      )}
    >
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Personal message (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Add a note to the technician..."
          placeholderTextColor={colors.placeholder}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </View>
    </BottomSheet>
  );

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />;

  if (wide) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <PageBody wide maxWidth={1240} refreshControl={refresh}>
          <Breadcrumb parent="Your offers" onParent={() => router.navigate('/company/offers' as any)} current={offer.title} />
          {header}
          <TwoColumns
            main={technicians}
            aside={(
              <>
                {facts}
                <View style={styles.asideBox}>
                  {description}
                  {requirements}
                </View>
              </>
            )}
          />
        </PageBody>
        {menuSheet}
        {sendSheet}
        {dialog}
      </CompanyScreen>
    );
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageBar title="Offer" onBack={goBack} right={menuButton} />
      <PageBody wide={false} refreshControl={refresh}>
        {header}
        {facts}
        {description}
        {requirements}
        {technicians}
      </PageBody>
      {primaryActions ? <StickyBar><ButtonRow>{primaryActions}</ButtonRow></StickyBar> : null}
      {menuSheet}
      {sendSheet}
      {dialog}
    </CompanyScreen>
  );
}

// Fase 6 tanda D: la exigencia ("todas" o "una cualquiera") se dice UNA vez,
// en el rótulo, y vale para toda la lista.
function AircraftList({
  habilitations,
  licenseCode,
  ratingIndex,
}: {
  habilitations: OfferRequiredHabilitation[];
  licenseCode?: string;
  ratingIndex: AircraftRatingIndex;
}) {
  return (
    <View style={styles.aircraftList}>
      {habilitations.map((req, i) => (
        <Text key={`${req.aircraftTypeRatingId}-${i}`} style={styles.aircraftItem}>
          {licenseCode ? `${licenseCode} + ` : ''}
          {requirementWithNote(getAircraftTypeRatingLabel(req.aircraftTypeRatingId, ratingIndex), req.notes)}
        </Text>
      ))}
    </View>
  );
}

function TechnicianRow({
  result,
  wide,
  relation,
  application,
  directAccepted,
  directPending,
  canSend,
  offerOpen,
  ratingIndex,
  breakdownRows,
  onSend,
  onViewApplication,
  onViewProfile,
}: {
  result: TechnicianMatchResult;
  wide: boolean;
  relation?: OfferRelation;
  application?: OfferRelation;
  directAccepted: boolean;
  directPending: boolean;
  canSend: boolean;
  offerOpen: boolean;
  ratingIndex: AircraftRatingIndex;
  breakdownRows: readonly BreakdownRowSpec[];
  onSend: () => void;
  onViewApplication?: () => void;
  onViewProfile: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { technician, score } = result;
  const unlocked = isUnlocked(technician);
  const name = companyTechnicianName(technician);
  const blocked = score.blockers.length > 0;
  const firstLicence = technician.licenses[0];
  const licences = technician.licenses.slice(0, 4);
  // displayName completo (célula + MOTOR), no `aircraftFamily` suelta. Ésta
  // es la pantalla donde la empresa rankea candidatos contra un type rating
  // que ES célula+motor: mostrar "Airbus A318/A319/A320/A321" sin el motor
  // impedía distinguir CFM56 de V2500. Misma función que usan búsqueda y mapa.
  const aircraft = resolveTypeRatingLabels(technician.habilitations, ratingIndex).slice(0, 4);
  const relationLook = relation ? offerRelationLook(relation.kind, relation.status) : null;

  // Lo de siempre, en el mismo orden: una candidatura se abre; si no, el
  // estado de la oferta directa; si no, enviar; y en una oferta cerrada, por
  // qué no se puede.
  let action: React.ReactNode = null;
  if (application) {
    action = <PillButton label={application.status === 'pending' ? 'Review application' : 'View application'} variant="outline" size="sm" onPress={onViewApplication} />;
  } else if (directAccepted || directPending) {
    action = null; // la etiqueta de la relación ya lo dice
  } else if (canSend) {
    action = <PillButton label={wide ? 'Send direct offer' : 'Send offer'} variant="accent" size="sm" onPress={onSend} />;
  } else if (!offerOpen) {
    action = <Text style={styles.closedNote}>Closed offers cannot be sent privately</Text>;
  }

  return (
    <View style={wide ? styles.techRowWide : styles.techRow}>
      <View style={styles.techTop}>
        <View style={styles.techWho}>
          <Avatar kind="person" size={44} photoPath={companyTechnicianPhoto(technician)} anonymous={!unlocked} name={unlocked ? name : null} />
          <View style={styles.techCopy}>
            <Text style={styles.techName} numberOfLines={1}>{name}</Text>
            <Text style={styles.techLine} numberOfLines={1}>
              <Text style={[styles.techScore, { color: blocked ? colors.error : matchScoreColor(score.total) }]}>
                {blocked ? 'Not eligible' : `${score.total}%`}
              </Text>
              {firstLicence ? ` · ${credentialLabel(firstLicence.authority, firstLicence.licenseCode)}` : ''}
            </Text>
            <Text style={styles.techMeta} numberOfLines={1}>
              {technicianTypeLabels(technician.technicianTypes)} - {formatLocation(technician.city, technician.country)}
            </Text>
          </View>
        </View>
        <View style={styles.techEnd}>
          {relationLook ? <StatusPill label={relationLook.label} tone={relationLook.tone} /> : null}
          {action}
        </View>
      </View>

      <View style={styles.techLinks}>
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          hitSlop={8}
          style={styles.detailsToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${expanded ? 'Hide' : 'Show'} match details for ${name}`}
        >
          <Text style={styles.detailsToggleText}>Match details</Text>
          {expanded
            ? <ChevronUp color={colors.primary} size={16} strokeWidth={2.4} />
            : <ChevronDown color={colors.primary} size={16} strokeWidth={2.4} />}
        </Pressable>
        {unlocked ? (
          <PillButton label="View profile" variant="outline" size="sm" onPress={onViewProfile} />
        ) : null}
      </View>

      {expanded ? (
        <View style={styles.details}>
          <View style={styles.badges}>
            <VerificationPill status={technician.verificationStatus} />
            <StatusPill label={availabilityLabel(technician.availability.status)} tone="info" />
            {technician.baseAirport ? <StatusPill label={technician.baseAirport} tone="muted" /> : null}
          </View>
          {licences.length > 0 ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>Licenses</Text>
              <TagRow>{licences.map((l) => <OutlineTag key={`${l.authority}-${l.licenseCode}`} label={credentialLabel(l.authority, l.licenseCode)} />)}</TagRow>
            </View>
          ) : null}
          {aircraft.length > 0 ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>Type ratings</Text>
              <TagRow>{aircraft.map((a) => <OutlineTag key={a} label={a} />)}</TagRow>
            </View>
          ) : null}
          <BreakdownBars rows={breakdownRows} score={score} />
          <CapReasonPanel score={score} />
          <VigenciaNotices score={score} />
          <AuthorityEquivalenceNote score={score} />
        </View>
      ) : null}
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
        <AlertTriangle color={colors.warning} size={14} strokeWidth={2} />
        <Text style={styles.capTitle}>Score capped ({rawSum}% raw before cap)</Text>
      </View>
      {score.missingRequirements.map((m: string, i: number) => (
        <Text key={`mm-${i}`} style={styles.capLine}>Not met: {m}</Text>
      ))}
      {score.clarifications.map((c, i) => (
        <Text key={`cl-${i}`} style={styles.capClarification}>{c}</Text>
      ))}
    </View>
  );
}

// Fase 3 — vigencia: a slight, non-excluding degradation (never a cap, so
// CapReasonPanel above never catches it — the breakdown bar already reflects
// the reduced number). Shown unconditionally whenever present.
function VigenciaNotices({ score }: { score: MatchScore }) {
  if (score.vigenciaNotices.length === 0) return null;
  return (
    <View style={styles.noticeList}>
      {score.vigenciaNotices.map((n, i) => (
        <View key={i} style={styles.noticeRow}>
          <StatusPill label={n.label} tone="warning" />
          <Text style={styles.noticeDetail}>{n.detail}</Text>
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
    <View style={styles.noticeRow}>
      <StatusPill label="Equivalent" tone="info" />
      <Text style={styles.noticeDetail}>{score.authorityEquivalence}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
  },
  headerCopy: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 200,
    minWidth: 0,
    gap: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    color: colors.text,
  },
  titleWide: {
    fontSize: 26,
    lineHeight: 32,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  when: {
    fontSize: 13,
    color: colors.textMuted,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButtonWide: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButtonPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  menuItemPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '800',
  },
  description: {
    fontSize: 14.5,
    lineHeight: 22,
    color: '#33465A',
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  aircraftList: {
    alignItems: 'flex-end',
    gap: 2,
  },
  aircraftItem: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'right',
  },
  asideBox: {
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    gap: 18,
  },
  techList: {
    marginTop: 6,
  },
  techRow: {
    paddingVertical: 12,
    gap: 8,
  },
  techRowWide: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    gap: 8,
  },
  techTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 8,
  },
  techWho: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 200,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  techCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  techName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.text,
  },
  techLine: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  techScore: {
    fontWeight: '800',
  },
  techMeta: {
    fontSize: 12.5,
    color: colors.textMuted,
  },
  techEnd: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginLeft: 'auto',
  },
  closedNote: {
    fontSize: 12.5,
    color: colors.textMuted,
  },
  techLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 56,
  },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
  },
  detailsToggleText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.primary,
  },
  details: {
    marginLeft: 56,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
    gap: 12,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  detailBlock: {
    gap: 6,
  },
  detailLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  capPanel: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FFF6E2',
    gap: 4,
  },
  capHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  capTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.warning,
  },
  capLine: {
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.warning,
  },
  capClarification: {
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  noticeList: {
    gap: 6,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  noticeDetail: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
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
});
