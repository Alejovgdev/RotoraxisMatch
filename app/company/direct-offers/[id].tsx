import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { Lock, LockOpen, UserRound } from 'lucide-react-native';
import { colors } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { ExternalLink } from '../../../src/components/ExternalLink';
import { MatchExplanation } from '../../../src/components/MatchExplanation';
import { Text, useConfirmDialog } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import {
  AsideCard,
  Breadcrumb,
  ButtonRow,
  EmptyBlock,
  NoticeBox,
  OfferLinkCard,
  PageBar,
  PageBody,
  PersonHero,
  PillButton,
  QuoteBox,
  Section,
  StatGrid,
  StatTile,
  StatusPill,
  StickyBar,
  TwoColumns,
  VerificationPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { BreakdownBars, ScoreHeadline, matchScoreColor } from '../../../src/components/company/MatchBreakdownBars';
import { TechnicianDocumentList } from '../../../src/components/company/TechnicianDocuments';
import { technicianProfileLine } from '../../../src/components/company/TechnicianQualifications';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { getMatchDisplayLabel, ineligibilityReasonText, matchPair, PairMatch } from '../../../src/utils/matchingV2';
import { visibleBreakdownRows } from '../../../src/utils/matchBreakdownRows';
import { isUnlocked, TechnicianView } from '../../../src/types/privacy';
import { getDocumentSignedUrl, openDocumentPreWindow, openDocumentUrl } from '../../../src/lib/documentStorage';
import { useCompanySession } from '../../../src/state/SessionContext';
import { canSendDirectOffers } from '../../../src/utils/companyPermissionsV2';
import { OfferRequest } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';
import { MatchScore } from '../../../src/types/matching';
import { Document } from '../../../src/types/document';
import { ChatRoom } from '../../../src/types/chat';
import { credentialLabel } from '../../../src/constants/licenses';
import { notify } from '../../../src/utils/platformAlert';
import { offerMetaLine } from '../../../src/utils/companyHome';
import { directOfferStatusLook } from '../../../src/utils/companyStatus';

// Oferta directa enviada (rediseño, fase 3; maquetas C-DirectDetail y
// W-D-DirectDetail; respuesta 19). Misma carga y la misma confirmación al
// retirarla; cambia el aspecto.

function formatSent(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

function availabilityLabel(status?: string): string {
  if (status === 'open_to_offers') return 'Open to offers';
  if (status === 'unavailable') return 'Unavailable';
  return 'Not specified';
}

function statusSummary(status: string): string {
  if (status === 'pending') return "Awaiting the technician's response.";
  if (status === 'accepted') return 'Technician accepted. Identity and documents unlocked.';
  if (status === 'rejected') return 'Technician declined this offer.';
  return `Status: ${status}`;
}

export default function DirectOfferDetailScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wide = useIsWide();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;
  const { confirm, dialog } = useConfirmDialog();

  const [req, setReq] = useState<OfferRequest | null>(null);
  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  const [techView, setTechView] = useState<TechnicianView | null>(null);
  // Paso 5b: el par entero (ver app/company/applications/[id].tsx).
  const [match, setMatch] = useState<PairMatch | null>(null);
  const score: MatchScore | null = match?.eligible ? match.score : null;
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);

  const load = useCallback(async (signal: { active: boolean }) => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!companyId) return;

    if (!id) return;
    const request = await offerRequestRepository.getById(id);
    if (!request) return;
    if (!signal.active) return;
    setReq(request);

    const [view, rel] = await Promise.all([
      technicianRepositoryV2.getViewForCompany(request.technicianId, companyId),
      technicianRepositoryV2.getWithRelations(request.technicianId),
    ]);
    if (!signal.active) return;
    setTechView(view);

    let linkedOffer: OfferWithRequirements | null = null;
    if (request.offerId) {
      linkedOffer = await offerRepository.getWithRequirements(request.offerId);
      if (!signal.active) return;
      setOffer(linkedOffer);
      // El servicio espera a los dos catálogos y aplica el filtro; si no
      // cargan, no hay bloque de match.
      const pair = linkedOffer && rel ? await matchPair(linkedOffer, rel).catch(() => null) : null;
      if (!signal.active) return;
      setMatch(pair);
    }

    if (request.status === 'accepted') {
      const rooms = await chatRepository.getRoomsForCompany(companyId);
      if (!signal.active) return;
      setChatRoom(rooms.find((r) => r.offerRequestId === request.id) ?? null);
    } else {
      setChatRoom(null);
    }

    await activityRepository.markRead('company', companyId, id);
  }, [companyId, id]);

  // Señal de cancelacion compartida por el efecto de foco y el refresco. load()
  // la comprueba ANTES de cada setState, no solo en el .finally: si el foco vuelve
  // o se refresca con una carga aun en vuelo, sin esta señal habria dos load()
  // escribiendo y ganaria el que terminase el ultimo, de forma no determinista.
  const loadSignal = useRef<{ active: boolean }>({ active: false });

  useFocusEffect(
    useCallback(() => {
      const signal = { active: true };
      loadSignal.current = signal;
      setLoading(true);
      load(signal).finally(() => { if (signal.active) setLoading(false); });
      return () => { signal.active = false; };
    }, [load]),
  );

  const breakdownRows = useMemo(() => visibleBreakdownRows(offer), [offer]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    setRefreshing(false);
  }

  async function handleWithdraw() {
    if (!req) return;
    const confirmed = await confirm({
      title: 'Withdraw offer?',
      message: 'The technician will no longer be able to respond to this offer.',
      confirmLabel: 'Withdraw',
      destructive: true,
    });
    if (!confirmed) return;
    setWithdrawing(true);
    try {
      await offerRequestRepository.updateStatus(req.id, 'withdrawn');
      await load(loadSignal.current);
    } finally {
      setWithdrawing(false);
    }
  }

  async function handleViewDoc(doc: Document) {
    const win = openDocumentPreWindow();
    setViewingDocId(doc.id);
    const { url, error } = await getDocumentSignedUrl(doc.storagePath, 120, false);
    setViewingDocId(null);
    if (error || !url) {
      win?.close();
      notify('Error', error ?? 'Could not generate download link.');
      return;
    }
    openDocumentUrl(url, win);
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="company" />
      </>
    );
  }

  if (!req) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        {!wide ? <PageBar title="Direct offer" onBack={goBack} /> : null}
        <PageBody wide={wide}>
          <EmptyBlock title="Offer not found" text="This direct offer is no longer available." />
        </PageBody>
      </CompanyScreen>
    );
  }

  const status = directOfferStatusLook(req.status);
  const toList = () => router.navigate('/company/direct-offers' as any);

  // The technician account behind this direct offer was deleted after the
  // fact (technician_public_view excludes non-active profiles, migration
  // 024 — getViewForCompany resolves to null). The request record itself
  // is real historical data and stays visible — never hidden — but there
  // is nothing left to act on: no identity, no documents, no messaging.
  if (!techView) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        {!wide ? <PageBar title="Direct offer" onBack={goBack} /> : null}
        <PageBody wide={wide}>
          {wide ? <Breadcrumb parent="Direct offers" onParent={toList} current="[Deleted user]" /> : null}
          <PersonHero
            name="[Deleted user]"
            anonymous
            wide={wide}
            subtitle={`Sent ${formatSent(req.createdAt)}`}
            chips={<StatusPill label={status.label} tone={status.tone} large={wide} />}
          />
          <NoticeBox icon={UserRound} title="[Deleted user]">
            This technician&apos;s account has been deleted. The direct offer record is kept for your history,
            but identity, documents, and messaging are no longer available.
          </NoticeBox>
        </PageBody>
      </CompanyScreen>
    );
  }

  const unlockedView = isUnlocked(techView) ? techView : null;
  const name = unlockedView ? `${unlockedView.firstName} ${unlockedView.lastName}`.trim() : techView.anonymousCode;
  const openProfile = unlockedView ? () => router.push(`/company/technician/${techView.id}` as any) : undefined;
  const openChat = req.status === 'accepted' && chatRoom ? () => router.push(`/company/chats/${chatRoom.id}` as any) : undefined;
  const canWithdraw = req.status === 'pending' && canSendDirectOffers(companyMemberRole);

  const hero = (
    <PersonHero
      name={name}
      photoPath={unlockedView?.photoPath}
      anonymous={!unlockedView}
      wide={wide}
      subtitle={technicianProfileLine(techView)}
      chips={(
        <>
          <StatusPill label={status.label} tone={status.tone} large={wide} />
          <VerificationPill status={techView.verificationStatus} large={wide} />
        </>
      )}
    />
  );

  const licences = techView.licenses.length > 0
    ? techView.licenses.map((l) => credentialLabel(l.authority, l.licenseCode)).join(', ')
    : 'None listed';
  const matchValue = score
    ? (score.blockers.length > 0 ? 'Not eligible' : `${score.total}%`)
    : match && !match.eligible ? 'Not eligible' : '—';
  const matchColor = score && score.blockers.length === 0 ? matchScoreColor(score.total) : match ? colors.error : undefined;

  const facts = (
    <StatGrid>
      <StatTile label="Licences" value={licences} />
      <StatTile label="Match" value={matchValue} valueColor={matchColor} />
      <StatTile
        label="Availability"
        value={availabilityLabel(techView.availability.status)}
        valueColor={techView.availability.status === 'open_to_offers' ? colors.success : undefined}
      />
      <StatTile label="Sent" value={formatSent(req.createdAt)} />
    </StatGrid>
  );

  const offerLink = offer ? (
    <OfferLinkCard
      offer={offer}
      caption="For your offer"
      meta={`${offerMetaLine(offer)} · ${offer.minYearsExperience} yrs min`}
      trailingLabel={wide ? 'View offer' : undefined}
      onPress={() => router.push(`/company/offers/${offer.id}` as any)}
    />
  ) : null;

  const matchBlock = score || (match && !match.eligible) ? (
    <View style={styles.matchBlock}>
      {score && offer ? (
        <>
          <ScoreHeadline
            total={score.total}
            label={getMatchDisplayLabel(offer, score)}
            notEligible={score.blockers.length > 0}
            wide={wide}
          />
          <BreakdownBars rows={breakdownRows} score={score} />
          <MatchExplanation score={score} hideBreakdown displayLabel={getMatchDisplayLabel(offer, score)} />
        </>
      ) : null}
      {match && !match.eligible ? (
        <ScoreHeadline total={0} label="" notEligible reason={ineligibilityReasonText(match.reason)} wide={wide} />
      ) : null}
    </View>
  ) : null;

  const message = req.message ? (
    <Section title="Your message" wide={wide}>
      <QuoteBox text={req.message} />
    </Section>
  ) : null;

  const identity = unlockedView ? (
    <NoticeBox icon={LockOpen} tone="success" title="Identity unlocked">
      <View style={styles.identity}>
        <Text style={styles.identityNote}>Private contact details and admin-verified documents are available.</Text>
        <Text style={styles.identityValue}>{unlockedView.email}</Text>
        {unlockedView.phone ? <Text style={styles.identityValue}>{unlockedView.phone}</Text> : null}
        {/* Ver la nota gemela en applications/[id].tsx: mismo gate que el
            email y el telefono, misma rama. */}
        {Object.entries(unlockedView.socialLinks ?? {}).map(([key, url]) =>
          url ? <ExternalLink key={key} url={url} color={colors.primary} /> : null,
        )}
        {req.status !== 'accepted' && openProfile ? (
          <View style={styles.identityAction}>
            <PillButton label="View profile" variant="outline" size="sm" onPress={openProfile} />
          </View>
        ) : null}
      </View>
    </NoticeBox>
  ) : (
    <NoticeBox icon={Lock} title="Identity locked until accepted">
      Only privacy-safe technician data is visible before acceptance.
    </NoticeBox>
  );

  const documents = (
    <Section title="Documents" wide={wide}>
      {unlockedView ? (
        <TechnicianDocumentList
          documents={unlockedView.documents}
          viewingId={viewingDocId}
          onView={handleViewDoc}
          emptyText="No documents on file."
        />
      ) : (
        <NoticeBox icon={Lock}>
          {req.status === 'rejected' || req.status === 'withdrawn'
            ? 'Documents are not available for this offer.'
            : 'Documents unlock automatically when the technician accepts.'}
        </NoticeBox>
      )}
    </Section>
  );

  const withdraw = canWithdraw
    ? <PillButton label="Withdraw offer" variant="danger" onPress={handleWithdraw} loading={withdrawing} />
    : null;
  const chat = openChat ? <PillButton label="Open chat" onPress={openChat} grow={wide ? undefined : 1.3} /> : null;
  const profile = req.status === 'accepted' && openProfile
    ? <PillButton label="View profile" variant="outline" onPress={openProfile} grow={wide ? undefined : 1} />
    : null;

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />;

  if (wide) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <PageBody wide refreshControl={refresh}>
          <Breadcrumb parent="Direct offers" onParent={toList} current={name} />
          <TwoColumns
            main={(
              <>
                {hero}
                {offerLink}
                {message}
                {identity}
                {documents}
              </>
            )}
            aside={(
              <AsideCard>
                <StatusPill label={status.label} tone={status.tone} large />
                <Text style={styles.summary}>{statusSummary(req.status)}</Text>
                <AsideFact label="Sent" value={formatSent(req.createdAt)} />
                <AsideFact label="Licences" value={licences} />
                <AsideFact label="Availability" value={availabilityLabel(techView.availability.status)} />
                {matchBlock}
                {withdraw}
                {chat}
                {profile}
              </AsideCard>
            )}
          />
        </PageBody>
        {dialog}
      </CompanyScreen>
    );
  }

  const sticky = withdraw ?? (chat || profile ? <ButtonRow>{profile}{chat}</ButtonRow> : null);

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageBar title="Direct offer" onBack={goBack} />
      <PageBody wide={false} refreshControl={refresh}>
        {hero}
        <Text style={styles.summary}>{statusSummary(req.status)}</Text>
        {facts}
        {offerLink}
        {matchBlock}
        {message}
        {identity}
        {documents}
      </PageBody>
      {sticky ? <StickyBar>{sticky}</StickyBar> : null}
      {dialog}
    </CompanyScreen>
  );
}

function AsideFact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  matchBlock: {
    gap: 12,
  },
  identity: {
    gap: 4,
  },
  identityNote: {
    fontSize: 13.5,
    lineHeight: 19,
    color: '#2D5A45',
  },
  identityAction: {
    marginTop: 6,
    alignItems: 'flex-start',
  },
  identityValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  summary: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  fact: {
    gap: 2,
  },
  factLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  factValue: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
});
