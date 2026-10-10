import React, { useState, useCallback, useRef } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { colors } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { ExternalLink } from '../../../src/components/ExternalLink';
import { Avatar, Text, useConfirmDialog } from '../../../src/components/ui';
import { TechnicianScreen } from '../../../src/components/technician/TechnicianUI';
import { OfferAboutRole, OfferChecklistSection, OfferTags } from '../../../src/components/technician/OfferDetailParts';
import { ScoreHeadline } from '../../../src/components/company/MatchBreakdownBars';
import {
  AsideCard,
  Breadcrumb,
  ButtonRow,
  EmptyBlock,
  KeyValueRow,
  NoticeBox,
  PageBar,
  PageBody,
  PillButton,
  QuoteBox,
  Section,
  StatusPill,
  StickyBar,
  TwoColumns,
  VerificationPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { isOfferOpenForTechnicians, offerRepository } from '../../../src/repositories/v2/offerRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { getMatchDisplayLabel, ineligibilityReasonText, matchPair, PairMatch } from '../../../src/utils/matchingV2';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { useTechnicianNav } from '../../../src/state/TechnicianNavContext';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { OfferApplication, OfferRequest } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';
import { CompanyProfileView } from '../../../src/types/company';
import { MatchScore } from '../../../src/types/matching';
import { ChatRoom } from '../../../src/types/chat';
import { formatLocation } from '../../../src/utils/formatLocation';
import { offerPlaceLine } from '../../../src/utils/technicianOffers';
import {
  canRespondToDirectOffer,
  isDirectOfferBlockedByClosedOffer,
  technicianDirectOfferStatusLook,
} from '../../../src/utils/technicianRelations';
import { companyCanSeeIdentity, declinedNote, directOfferConfirm } from '../../../src/utils/technicianPrivacy';
import { isOpenedFromChat } from '../../../src/utils/technicianNavigation';

// Detalle de una oferta directa recibida (rediseño, fase 5B; el patrón de
// C-DirectDetail con lo que el técnico veía antes).
//   - Carga, estados y acciones de antes: "Decline" / "Accept" con las
//     confirmaciones de siempre (aceptar revela la identidad: se confirma
//     siempre, respuesta 15); al aceptar, el chat y "Open chat" como antes.
//   - La oferta se enseña igual que en su página (fase 5A): la checklist con
//     sus avisos en lugar de las barras, y "About the role".
//   - Si esta empresa ya ve la identidad por otro contacto aceptado, los
//     avisos lo dicen (src/utils/technicianPrivacy.ts, la regla de la base).
//   - Abierta desde un chat (?from=chat) no ofrece "Open chat": sería un bucle.

const COMPANY_TYPE_LABELS: Record<string, string> = {
  MRO: 'MRO',
  airline: 'Airline',
  recruitment_agency: 'Recruitment Agency',
  helicopter_operator: 'Helicopter Operator',
  other: 'Other',
};

const ACCEPTED_TEXT = 'The company can now see your full identity and admin-verified documents. A chat room is available for direct communication.';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function DirectOfferDetailScreen() {
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const router = useRouter();
  const goBack = useGoBack();
  const wide = useIsWide();
  const { refreshCounts } = useTechnicianNav();
  const { confirm, dialog } = useConfirmDialog();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const fromChat = isOpenedFromChat(from);

  const [request, setRequest] = useState<OfferRequest | null>(null);
  const [company, setCompany] = useState<CompanyProfileView | null>(null);
  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  // Paso 5b: el par entero (ver app/company/applications/[id].tsx).
  const [match, setMatch] = useState<PairMatch | null>(null);
  const score: MatchScore | null = match?.eligible ? match.score : null;
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  // Todas las relaciones del técnico: deciden si la empresa ya ve su identidad.
  const [allRequests, setAllRequests] = useState<OfferRequest[]>([]);
  const [allApplications, setAllApplications] = useState<OfferApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // El catálogo de ratings aquí sólo pinta las etiquetas de las aeronaves que
  // pide la oferta; el gate de abajo evita pintar un UUID crudo mientras carga.
  // La puntuación la hace matchPair, que espera a sus catálogos por su cuenta.
  const { ratingIndex, state: catalogState } = useAircraftTypeRatingsCatalog();
  // Paso 5b: sólo para el nombre del motor de una oferta de motor.
  const { engineIndex } = useEnginesCatalog();

  const load = useCallback(async (signal: { active: boolean }) => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    if (!id) return;
    const req = await offerRequestRepository.getById(id);
    if (!req) return;
    if (!signal.active) return;
    setRequest(req);

    const [co, off, techWithRelations, reqs, apps] = await Promise.all([
      companyRepositoryV2.getById(req.companyId),
      req.offerId ? offerRepository.getWithRequirements(req.offerId) : Promise.resolve(null),
      technicianRepositoryV2.getWithRelations(technicianId),
      offerRequestRepository.getForTechnician(technicianId),
      offerApplicationRepository.getForTechnician(technicianId),
    ]);

    if (!signal.active) return;
    setCompany(co);
    setOffer(off);
    setAllRequests(reqs);
    setAllApplications(apps);

    // Compute score when offer is active, or when the direct offer is accepted (historical context).
    const offerActive = isOfferOpenForTechnicians(off);
    // Filtro + scorer con los dos catálogos, en el servicio. Si no cargan, no
    // hay bloque de match.
    const pair = off && (offerActive || req.status === 'accepted') && techWithRelations
      ? await matchPair(off, techWithRelations).catch(() => null)
      : null;
    if (!signal.active) return;
    setMatch(pair);

    if (req.status === 'accepted') {
      const rooms = await chatRepository.getRoomsForTechnician(technicianId);
      if (!signal.active) return;
      setChatRoom(rooms.find((r) => r.offerRequestId === id) ?? null);
    } else {
      setChatRoom(null);
    }

    await activityRepository.markRead('technician', technicianId, id);
  }, [id, technicianId]);

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
      load(signal).finally(() => {
        if (signal.active) setLoading(false);
      });
      return () => {
        signal.active = false;
      };
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    setRefreshing(false);
  }

  // La misma regla con la que la base enseña la identidad a la empresa.
  const identityVisible = Boolean(request && technicianId) && companyCanSeeIdentity({
    companyId: request?.companyId ?? '',
    technicianId: technicianId ?? '',
    offerRequests: allRequests,
    offerApplications: allApplications,
  });

  async function respond(action: 'accept' | 'reject') {
    if (!id) return;
    setActionError(null);
    // Las confirmaciones de siempre (respuesta 15).
    const confirmed = await confirm(directOfferConfirm(action, identityVisible));
    if (!confirmed) return;
    setActioning(true);
    try {
      const result = await offerRequestRepository.updateStatus(
        id,
        action === 'accept' ? 'accepted' : 'rejected',
      );
      if (result === null) {
        setActionError('Could not update offer status. Please try again.');
        return;
      }
      await load(loadSignal.current);
      refreshCounts();
    } catch (e: any) {
      setActionError(e?.message ?? 'An error occurred. Please try again.');
    } finally {
      setActioning(false);
    }
  }

  // Mientras el catálogo de ratings carga no se pinta nada, para no enseñar un
  // UUID crudo como nombre de rating en los requisitos de la oferta.
  if (loading || catalogState === 'loading') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.technician} role="technician" />
      </>
    );
  }

  if (!request || !company) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        {!wide ? <PageBar title="Direct offer" onBack={goBack} /> : null}
        <PageBody wide={wide}>
          <EmptyBlock title="Offer not found" text="This direct offer is no longer available." />
        </PageBody>
      </TechnicianScreen>
    );
  }

  const status = technicianDirectOfferStatusLook(request.status);
  const isAccepted = request.status === 'accepted';
  const offerOpen = isOfferOpenForTechnicians(offer);
  // Pendiente con la oferta cerrada: aviso "Offer closed" y sin botones.
  // Aceptadas, rechazadas o históricas no dependen del estado de la oferta.
  const linkedOfferUnavailable = isDirectOfferBlockedByClosedOffer(request, offerOpen);
  const canRespond = canRespondToDirectOffer(request, offerOpen);
  // Show offer details when active, or when accepted (historical context after offer closes).
  const visibleOffer = offer && (offerOpen || isAccepted) ? offer : null;
  const title = visibleOffer?.title ?? 'Direct offer';
  const companyType = company.companyType ? COMPANY_TYPE_LABELS[company.companyType] ?? company.companyType : 'Company';

  const hero = (
    <View style={styles.hero}>
      <Avatar kind="company" size={wide ? 88 : 64} name={company.name} logoPath={company.logoPath} />
      <View style={styles.heroCopy}>
        <Text style={[styles.title, wide && styles.titleWide]} accessibilityRole="header">{title}</Text>
        <Text style={styles.subtitle}>{`${company.name} · received ${formatDate(request.createdAt)}`}</Text>
        <View style={styles.pills}>
          <StatusPill label={status.label} tone={status.tone} large />
        </View>
      </View>
    </View>
  );

  const headline = visibleOffer ? (
    score ? (
      <ScoreHeadline
        total={score.total}
        label={getMatchDisplayLabel(visibleOffer, score)}
        notEligible={score.blockers.length > 0}
        wide={wide}
      />
    ) : match && !match.eligible ? (
      <ScoreHeadline total={0} label="" notEligible reason={ineligibilityReasonText(match.reason)} wide={wide} />
    ) : null
  ) : null;

  const offerBlock = visibleOffer ? (
    <>
      <Section title="The offer" wide={wide}>
        <Text style={styles.place}>{offerPlaceLine(visibleOffer)}</Text>
        <OfferTags offer={visibleOffer} />
      </Section>
      <OfferChecklistSection offer={visibleOffer} score={score} wide={wide} ratingIndex={ratingIndex} engineIndex={engineIndex} />
      <OfferAboutRole offer={visibleOffer} wide={wide} />
    </>
  ) : null;

  const message = request.message ? (
    <Section title="Message from company" wide={wide}>
      <QuoteBox text={request.message} />
    </Section>
  ) : null;

  const companyBlock = (
    <Section title="Company" wide={wide}>
      <View style={styles.companyCard}>
        <Avatar kind="company" size={46} name={company.name} logoPath={company.logoPath} />
        <View style={styles.companyCopy}>
          <Text style={styles.companyName}>{company.name}</Text>
          <Text style={styles.companyMeta}>{companyType}</Text>
          <Text style={styles.companyMeta}>{formatLocation(company.city, company.country)}</Text>
          {company.website ? <ExternalLink url={company.website} color={colors.primary} /> : null}
        </View>
        <VerificationPill status={company.verificationStatus} />
      </View>
    </Section>
  );

  const dates = (
    <View>
      <KeyValueRow label="Received" value={formatDate(request.createdAt)} last={request.updatedAt === request.createdAt} />
      {request.updatedAt !== request.createdAt ? (
        <KeyValueRow label="Updated" value={formatDate(request.updatedAt)} last />
      ) : null}
    </View>
  );

  // Los avisos de estado de antes, con el de identidad corregido.
  const statusNote = linkedOfferUnavailable ? (
    <NoticeBox title="Offer closed">This offer is no longer active and cannot be accepted.</NoticeBox>
  ) : isAccepted ? (
    <NoticeBox tone="success" title="Offer accepted">{ACCEPTED_TEXT}</NoticeBox>
  ) : request.status === 'rejected' ? (
    <NoticeBox title="Offer declined">{declinedNote(identityVisible)}</NoticeBox>
  ) : request.status === 'expired' || request.status === 'withdrawn' ? (
    <NoticeBox>
      {request.status === 'expired'
        ? 'This offer has expired and is no longer active.'
        : 'This offer was withdrawn by the company.'}
    </NoticeBox>
  ) : null;

  const errorNote = actionError ? <NoticeBox tone="error">{actionError}</NoticeBox> : null;

  // Botonera: en móvil fija abajo, en escritorio en la columna lateral.
  let actions: React.ReactNode = null;
  if (canRespond) {
    const decline = <PillButton label="Decline" variant="outline" onPress={() => respond('reject')} disabled={actioning} grow={wide ? undefined : 1} />;
    const accept = <PillButton label="Accept" onPress={() => respond('accept')} loading={actioning} grow={wide ? undefined : 1.5} />;
    actions = wide ? <>{accept}{decline}</> : <ButtonRow>{decline}{accept}</ButtonRow>;
  } else if (isAccepted && chatRoom && !fromChat) {
    actions = <PillButton label="Open chat" onPress={() => router.push(`/technician/chats/${chatRoom.id}` as never)} />;
  }

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />;

  if (wide) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <PageBody wide refreshControl={refresh}>
          <Breadcrumb parent="Direct offers" onParent={() => router.navigate('/technician/direct-offers' as never)} current={title} />
          <TwoColumns
            main={(
              <>
                {hero}
                {message}
                {offerBlock}
                {companyBlock}
              </>
            )}
            aside={(
              <AsideCard>
                {headline}
                {dates}
                {statusNote}
                {errorNote}
                {actions}
              </AsideCard>
            )}
          />
        </PageBody>
        {dialog}
      </TechnicianScreen>
    );
  }

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageBar title="Direct offer" onBack={goBack} />
      <PageBody wide={false} refreshControl={refresh}>
        {hero}
        {statusNote}
        {headline}
        {message}
        {offerBlock}
        {companyBlock}
        {dates}
        {errorNote}
      </PageBody>
      {actions ? <StickyBar>{actions}</StickyBar> : null}
      {dialog}
    </TechnicianScreen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontSize: 21,
    fontWeight: '800',
    color: colors.text,
  },
  titleWide: {
    fontSize: 26,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  place: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  companyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  companyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  companyName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  companyMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
