import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { Lock, LockOpen, UserRound } from 'lucide-react-native';
import { getDocumentSignedUrl, openDocumentPreWindow, openDocumentUrl } from '../../../src/lib/documentStorage';
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
  StatusPill,
  StickyBar,
  TwoColumns,
  VerificationPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { BreakdownBars, ScoreHeadline } from '../../../src/components/company/MatchBreakdownBars';
import { TechnicianQualifications, technicianProfileLine } from '../../../src/components/company/TechnicianQualifications';
import { TechnicianDocumentList } from '../../../src/components/company/TechnicianDocuments';
import { NO_LONGER_ELIGIBLE_TO_ACCEPT, offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { getMatchDisplayLabel, ineligibilityReasonText, matchPair, PairMatch } from '../../../src/utils/matchingV2';
import { visibleBreakdownRows } from '../../../src/utils/matchBreakdownRows';
import { isUnlocked, TechnicianView } from '../../../src/types/privacy';
import { useCompanySession } from '../../../src/state/SessionContext';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { canReviewApplications } from '../../../src/utils/companyPermissionsV2';
import { OfferApplication } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';
import { MatchScore } from '../../../src/types/matching';
import { Document } from '../../../src/types/document';
import { ChatRoom } from '../../../src/types/chat';
import { notify } from '../../../src/utils/platformAlert';
import { offerMetaLine, relativeTime } from '../../../src/utils/companyHome';
import { applicationStatusLook, offerStatusLook } from '../../../src/utils/companyStatus';

// Candidatura (rediseño, fase 3; maquetas W-Candidate y W-D-Candidate, y
// respuesta 17 de la revisión). Cambia el aspecto, no lo que hace: la misma
// carga, las mismas confirmaciones (aceptar revela la identidad) y las mismas
// reglas — un Viewer ve los botones bloqueados y el texto de siempre; un par
// que ya no es elegible no ofrece "Accept".

type Decision = 'accept' | 'reject';

const DECISION_CONFIRM: Record<Decision, { title: string; message: string; confirmLabel: string; destructive?: boolean }> = {
  accept: {
    title: 'Accept application?',
    message: 'This will unlock the technician identity and admin-verified documents, then open chat access.',
    confirmLabel: 'Confirm accept',
  },
  reject: {
    title: 'Reject application?',
    message: 'The technician will remain locked and no chat will be created.',
    confirmLabel: 'Confirm reject',
    destructive: true,
  },
};

export default function ApplicationDetailScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wide = useIsWide();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;
  // Sólo para los nombres de aeronaves y motores de la lista de experiencia.
  const { ratingIndex } = useAircraftTypeRatingsCatalog();
  const { engineIndex } = useEnginesCatalog();
  const { confirm, dialog } = useConfirmDialog();

  const [app, setApp] = useState<OfferApplication | null>(null);
  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  const [techView, setTechView] = useState<TechnicianView | null>(null);
  // Paso 5b: el par entero, no sólo el score. Un par que el filtro saca llega
  // como { eligible: false } y se pinta como tal, con su motivo.
  const [match, setMatch] = useState<PairMatch | null>(null);
  // 092: un par que el filtro saca ya no se puede aceptar (la base lo rechaza).
  const acceptBlocked = Boolean(match && !match.eligible);
  const score: MatchScore | null = match?.eligible ? match.score : null;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);

  const load = useCallback(async (signal: { active: boolean }) => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!companyId) return;

    if (!id) return;
    const application = await offerApplicationRepository.getById(id);
    if (!application) return;
    if (!signal.active) return;
    setApp(application);

    const [o, view, rel] = await Promise.all([
      offerRepository.getWithRequirements(application.offerId),
      technicianRepositoryV2.getViewForCompany(application.technicianId, companyId),
      technicianRepositoryV2.getWithRelations(application.technicianId),
    ]);

    if (!signal.active) return;
    setOffer(o);
    setTechView(view);
    // El servicio espera a los dos catálogos y aplica el filtro. Si no cargan,
    // no hay bloque de match: un score erróneo es peor que ningún score.
    const pair = o && rel ? await matchPair(o, rel).catch(() => null) : null;
    if (!signal.active) return;
    setMatch(pair);

    if (application.status === 'accepted') {
      const rooms = await chatRepository.getRoomsForCompany(companyId);
      if (!signal.active) return;
      setChatRoom(rooms.find((r) => r.offerApplicationId === application.id) ?? null);
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

  // Real per-offer rows, labels and denominators — never hardcoded (see
  // src/utils/matchBreakdownRows.ts).
  const breakdownRows = useMemo(() => visibleBreakdownRows(offer), [offer]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    setRefreshing(false);
  }

  async function handleDecision(action: Decision) {
    if (!app || !id) return;
    setActionError(null);
    const confirmed = await confirm(DECISION_CONFIRM[action]);
    if (!confirmed) return;
    setActioning(true);
    try {
      const result = await offerApplicationRepository.updateStatus(
        id,
        action === 'accept' ? 'accepted' : 'rejected',
      );
      if (result === null) {
        setActionError('Could not update application status. Please try again.');
        return;
      }
      await load(loadSignal.current);
    } catch (e: any) {
      setActionError(e?.message ?? 'An error occurred. Please try again.');
    } finally {
      setActioning(false);
    }
  }

  async function handleViewDoc(doc: Document) {
    // Must be called synchronously before any await — iOS Safari blocks window.open() after async gaps.
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

  if (!app || !offer) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        {!wide ? <PageBar title="Application" onBack={goBack} /> : null}
        <PageBody wide={wide}>
          <EmptyBlock title="Application not found" text="This application is no longer available." />
        </PageBody>
      </CompanyScreen>
    );
  }

  const status = applicationStatusLook(app.status, 'detail');
  const offerLink = (
    <OfferLinkCard
      offer={offer}
      caption={`Applied ${relativeTime(app.createdAt)} to`}
      meta={[
        offerMetaLine(offer),
        `${offer.minYearsExperience} yrs min`,
        offer.status !== 'published' ? offerStatusLook(offer.status).label : null,
      ].filter(Boolean).join(' · ')}
      soft={wide}
      onPress={() => router.push(`/company/offers/${offer.id}` as any)}
    />
  );

  // The technician account behind this application was deleted after the
  // fact (technician_public_view excludes non-active profiles, migration
  // 024 — getViewForCompany resolves to null instead of the usual
  // locked/unlocked preview). The application record itself is real
  // historical data and stays visible — never hidden — but there is
  // nothing left to act on: no identity to reveal, no documents, no one
  // to message. Deliberately a distinct state from "not yet unlocked"
  // (techView === null here means gone, not merely locked).
  if (!techView) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        {!wide ? <PageBar title="Application" onBack={goBack} /> : null}
        <PageBody wide={wide}>
          {wide ? <Breadcrumb parent="Applications" onParent={() => router.navigate('/company/applications' as any)} current="[Deleted user]" /> : null}
          <PersonHero
            name="[Deleted user]"
            anonymous
            wide={wide}
            chips={<StatusPill label={status.label} tone={status.tone} large={wide} />}
          />
          <NoticeBox icon={UserRound} title="[Deleted user]">
            This technician&apos;s account has been deleted. The application record is kept for your history, but
            identity, documents, and messaging are no longer available.
          </NoticeBox>
          {offerLink}
        </PageBody>
      </CompanyScreen>
    );
  }

  const unlockedView = isUnlocked(techView) ? techView : null;
  const name = unlockedView ? `${unlockedView.firstName} ${unlockedView.lastName}`.trim() : techView.anonymousCode;
  const canReview = canReviewApplications(companyMemberRole);
  const pending = app.status === 'pending';
  const openChat = chatRoom ? () => router.push(`/company/chats/${chatRoom.id}` as any) : undefined;
  const openProfile = unlockedView ? () => router.push(`/company/technician/${techView.id}` as any) : undefined;

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

  const identity = unlockedView ? (
    <NoticeBox icon={LockOpen} tone="success" title="Identity unlocked">
      <View style={styles.identity}>
        <Text style={styles.identityNote}>
          Private contact details and admin-verified documents are available. Chat is open for direct coordination.
        </Text>
        <Text style={styles.identityValue}>{unlockedView.email}</Text>
        {unlockedView.phone ? <Text style={styles.identityValue}>{unlockedView.phone}</Text> : null}
        {/* Enlaces profesionales del tecnico. Van DENTRO de la rama
            `unlocked`, junto al email y el telefono: son campo privado y
            comparten exactamente su gate. */}
        {Object.entries(unlockedView.socialLinks ?? {}).map(([key, url]) =>
          url ? <ExternalLink key={key} url={url} color={colors.primary} /> : null,
        )}
        {/* La identidad puede estar desbloqueada por OTRA relación aceptada
            (una oferta directa) con esta candidatura aún pendiente: el perfil
            se abre desde aquí, como antes. */}
        {app.status !== 'accepted' && openProfile ? (
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

  const matchBlock = (
    <View style={styles.matchBlock}>
      {score ? (
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
  );
  const hasMatch = Boolean(score || (match && !match.eligible));

  const coverNote = app.coverNote ? (
    <Section title="Cover note" wide={wide}>
      <QuoteBox text={app.coverNote} />
    </Section>
  ) : null;

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
          {app.status === 'rejected'
            ? 'Documents remain locked for rejected applications.'
            : 'Accept this application to unlock documents and identity.'}
        </NoticeBox>
      )}
    </Section>
  );

  const notices = (
    <>
      {actionError ? <NoticeBox tone="error">{actionError}</NoticeBox> : null}
      {/* Sesión 5 (092): la base rechaza aceptar a quien ya no es elegible
          (la oferta pudo cambiar después de recibir la candidatura). Aquí
          no se ofrece el botón que va a fallar; rechazar sigue abierto. */}
      {pending && canReview && acceptBlocked ? <NoticeBox tone="error">{NO_LONGER_ELIGIBLE_TO_ACCEPT}</NoticeBox> : null}
    </>
  );

  // Botonera: en móvil fija abajo, en escritorio en la columna lateral.
  let actions: React.ReactNode = null;
  if (pending && canReview) {
    const accept = (
      <PillButton
        label="Accept application"
        onPress={() => handleDecision('accept')}
        loading={actioning}
        disabled={acceptBlocked}
        grow={wide ? undefined : 1.5}
      />
    );
    const reject = (
      <PillButton label="Reject" variant="outline" onPress={() => handleDecision('reject')} disabled={actioning} grow={wide ? undefined : 1} />
    );
    actions = wide ? <>{accept}{reject}</> : <ButtonRow>{reject}{accept}</ButtonRow>;
  } else if (pending) {
    // Un Viewer ve los botones, bloqueados, con el texto de siempre.
    const accept = <PillButton label="Accept application" disabled grow={wide ? undefined : 1.5} />;
    const reject = <PillButton label="Reject" variant="outline" disabled grow={wide ? undefined : 1} />;
    actions = (
      <>
        {wide ? <>{accept}{reject}</> : <ButtonRow>{reject}{accept}</ButtonRow>}
        <Text style={styles.viewerNote}>Viewer role cannot accept or reject applications.</Text>
      </>
    );
  } else if (app.status === 'accepted' && (openChat || openProfile)) {
    const chat = openChat ? <PillButton label="Open chat" onPress={openChat} grow={wide ? undefined : 1.3} /> : null;
    const profile = openProfile
      ? <PillButton label={wide ? 'View full profile' : 'View profile'} variant="outline" onPress={openProfile} grow={wide ? undefined : 1} />
      : null;
    actions = wide ? <>{chat}{profile}</> : <ButtonRow>{profile}{chat}</ButtonRow>;
  }

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />;

  if (wide) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <PageBody wide refreshControl={refresh}>
          <Breadcrumb parent="Applications" onParent={() => router.navigate('/company/applications' as any)} current={name} />
          <TwoColumns
            main={(
              <>
                {hero}
                {identity}
                {coverNote}
                <TechnicianQualifications tech={techView} ratingIndex={ratingIndex} engineIndex={engineIndex} variant="combined" wide />
                {documents}
              </>
            )}
            aside={(
              <AsideCard>
                {hasMatch ? matchBlock : null}
                {offerLink}
                {notices}
                {actions}
              </AsideCard>
            )}
          />
        </PageBody>
        {dialog}
      </CompanyScreen>
    );
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageBar title="Application" onBack={goBack} />
      <PageBody wide={false} refreshControl={refresh}>
        {hero}
        {identity}
        {offerLink}
        {hasMatch ? matchBlock : null}
        {coverNote}
        <TechnicianQualifications tech={techView} ratingIndex={ratingIndex} engineIndex={engineIndex} variant="combined" />
        {documents}
        {notices}
      </PageBody>
      {actions ? <StickyBar>{actions}</StickyBar> : null}
      {dialog}
    </CompanyScreen>
  );
}

const styles = StyleSheet.create({
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
  matchBlock: {
    gap: 12,
  },
  viewerNote: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
