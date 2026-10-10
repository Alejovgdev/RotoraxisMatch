import React, { useState, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { ChevronLeft, Lock } from 'lucide-react-native';
import { Avatar, AvatarFrame, BottomSheet, Text, TextInput, useConfirmDialog } from '../../../src/components/ui';
import { useGoBack } from '../../../src/state/useGoBack';
import { colors } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { ExternalLink } from '../../../src/components/ExternalLink';
import { TechnicianScreen } from '../../../src/components/technician/TechnicianUI';
import { MatchPill } from '../../../src/components/technician/OfferCards';
import { OfferAboutRole, OfferChecklistSection, OfferTags } from '../../../src/components/technician/OfferDetailParts';
import { ScoreHeadline } from '../../../src/components/company/MatchBreakdownBars';
import {
  AsideCard,
  Breadcrumb,
  ButtonRow,
  CARD_BORDER,
  EmptyBlock,
  NoticeBox,
  PageBar,
  PageBody,
  PillButton,
  StatusPill,
  StickyBar,
  TwoColumns,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { isOfferOpenForTechnicians, offerRepository } from '../../../src/repositories/v2/offerRepository';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { getMatchDisplayLabel, ineligibilityReasonText, matchPair, PairMatch } from '../../../src/utils/matchingV2';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { useTechnicianNav } from '../../../src/state/TechnicianNavContext';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { applySheetNote, companyCanSeeIdentity, offerPrivacyText } from '../../../src/utils/technicianPrivacy';
import { isOpenedFromChat } from '../../../src/utils/technicianNavigation';
import {
  offerPlaceLine,
  technicianApplicationLook,
  technicianDirectOfferLook,
} from '../../../src/utils/technicianOffers';
import { OfferWithRequirements } from '../../../src/types/offer';
import { CompanyProfileView } from '../../../src/types/company';
import { MatchScore } from '../../../src/types/matching';
import { OfferApplication, OfferRequest } from '../../../src/types/offerRequest';
import { ChatRoom } from '../../../src/types/chat';
import { notify } from '../../../src/utils/platformAlert';

// Página de oferta del técnico (rediseño, fase 5A; maqueta T-Offer, T7 y
// respuesta 24 de la revisión).
//   - El % y su etiqueta siguen arriba.
//   - "What they ask vs. your profile" sustituye a las barras y a la tarjeta de
//     requisitos: los mismos criterios que dan puntos hoy, con su estado
//     (src/utils/offerChecklist.ts). Debajo, los avisos de hoy sin repetirla.
//   - Lo que la oferta pide pero no puntúa (tipo de perfil, trabajo
//     certificado, "sólo sin licencia") y la descripción van en "About the role".
//   - Abajo, fijo, el aviso de privacidad y "Apply", con las confirmaciones y
//     los estados de siempre. La carga y las acciones no cambian.
//   - Fase 5B: si esta empresa ya ve la identidad del técnico por un contacto
//     anterior aceptado, el aviso lo dice (src/utils/technicianPrivacy.ts, la
//     misma regla que la base); y abierta desde un chat (?from=chat) no ofrece
//     "Open chat", para que no haya bucle.

function formatPublishedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const COMPANY_TYPE_LABELS: Record<string, string> = {
  MRO: 'MRO',
  airline: 'Airline',
  recruitment_agency: 'Recruitment Agency',
  helicopter_operator: 'Helicopter Operator',
  other: 'Other',
};

const LINKED_TO_DIRECT_OFFER = 'This role is already linked to a direct offer, so a separate application is not needed.';
const ACCEPTED_NOTE = 'Your identity and admin-verified documents are now accessible to the company.';

export default function OfferDetailScreen() {
  const technicianSession = useTechnicianSession();
  const { refreshCounts } = useTechnicianNav();
  const technicianId = technicianSession?.technicianId;
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const fromChat = isOpenedFromChat(from);
  const router = useRouter();
  const goBack = useGoBack();
  const wide = useIsWide();
  const { confirm, dialog } = useConfirmDialog();

  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  const [company, setCompany] = useState<CompanyProfileView | null>(null);
  // Paso 5b: el par entero (ver app/company/applications/[id].tsx).
  const [match, setMatch] = useState<PairMatch | null>(null);
  const score: MatchScore | null = match?.eligible ? match.score : null;
  const [existingApp, setExistingApp] = useState<OfferApplication | null>(null);
  const [existingDirectOffer, setExistingDirectOffer] = useState<OfferRequest | null>(null);
  // Todas las relaciones del técnico (ya se cargaban): deciden si la empresa
  // ya ve su identidad por un contacto anterior aceptado.
  const [allApplications, setAllApplications] = useState<OfferApplication[]>([]);
  const [allDirectOffers, setAllDirectOffers] = useState<OfferRequest[]>([]);
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [loading, setLoading] = useState(true);

  const [applyOpen, setApplyOpen] = useState(false);
  const [coverNote, setCoverNote] = useState('');
  const [applying, setApplying] = useState(false);

  // El catálogo de ratings aquí sólo pinta las etiquetas de las aeronaves que
  // pide la oferta (getAircraftTypeRatingLabel caería al UUID con el índice
  // vacío; de ahí el gate de carga). La puntuación la hace matchPair, que
  // espera a sus catálogos por su cuenta.
  const { ratingIndex, state: catalogState } = useAircraftTypeRatingsCatalog();
  // Paso 5b: sólo para el nombre del motor de una oferta de motor.
  const { engineIndex } = useEnginesCatalog();

  const load = useCallback(async (signal: { active: boolean }) => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    if (!id) return;
    const o = await offerRepository.getWithRequirements(id);
    if (!signal.active) return;
    // Do not abort for closed/expired offers — they may have existing applications that need to be shown as history.
    if (!o) {
      setOffer(null);
      setCompany(null);
      setMatch(null);
      setExistingApp(null);
      setExistingDirectOffer(null);
      setChatRoom(null);
      return;
    }
    setOffer(o);

    const [c, techWithRelations, apps, directOffers] = await Promise.all([
      companyRepositoryV2.getById(o.companyId),
      technicianRepositoryV2.getWithRelations(technicianId),
      offerApplicationRepository.getForTechnician(technicianId),
      offerRequestRepository.getForTechnician(technicianId),
    ]);

    if (!signal.active) return;
    setCompany(c);

    // Filtro + scorer con los dos catálogos, en el servicio. Si no cargan, no
    // hay bloque de match (y no se bloquea la candidatura por eso).
    const pair = techWithRelations ? await matchPair(o, techWithRelations).catch(() => null) : null;
    if (!signal.active) return;
    setMatch(pair);

    const app = apps.find((a) => a.offerId === id) ?? null;
    setAllApplications(apps);
    setAllDirectOffers(directOffers);
    setExistingApp(app);
    setExistingDirectOffer(directOffers.find((request) => request.offerId === id) ?? null);

    if (app) {
      await activityRepository.markRead('technician', technicianId, app.id);
      // El número de Applications (respuestas sin ver) baja ya, no al cambiar de pantalla.
      refreshCounts();
    }

    if (app && app.status === 'accepted') {
      const rooms = await chatRepository.getRoomsForTechnician(technicianId);
      if (!signal.active) return;
      setChatRoom(rooms.find((r) => r.offerApplicationId === app.id) ?? null);
    } else {
      setChatRoom(null);
    }
  }, [id, technicianId, refreshCounts]);

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

  async function handleApply() {
    if (!offer || !technicianId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    setApplying(true);
    try {
      const app = await offerApplicationRepository.create({
        technicianId,
        offerId: offer.id,
        companyId: offer.companyId,
        coverNote: coverNote.trim() || undefined,
      });
      setExistingApp(app);
      setApplyOpen(false);
      setCoverNote('');
      notify('Application sent', 'The company will be notified of your application.');
    } catch (e: any) {
      notify('Could not apply', e?.message ?? 'An error occurred.');
    } finally {
      setApplying(false);
    }
  }

  async function handleWithdraw() {
    // Fase 5.4 — sin sesion resuelta no se ejecuta la accion.
    if (!existingApp || !technicianId) {
      notify('Cannot withdraw yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    const confirmed = await confirm({
      title: 'Withdraw application?',
      message: 'This will cancel your application. This cannot be undone.',
      confirmLabel: 'Withdraw',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await offerApplicationRepository.withdraw(existingApp.id, technicianId);
      await load(loadSignal.current);
    } catch (e: any) {
      notify('Error', e?.message ?? 'Could not withdraw.');
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

  if (!offer) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        {!wide ? <PageBar title="Offer" onBack={goBack} /> : null}
        <PageBody wide={wide}>
          <EmptyBlock title="Offer not found" text="This offer is no longer available." />
        </PageBody>
      </TechnicianScreen>
    );
  }

  const open = isOfferOpenForTechnicians(offer);
  const activeDirectOffer = existingDirectOffer && (existingDirectOffer.status === 'pending' || existingDirectOffer.status === 'accepted');
  // Retirarse NO veta (2026-07-28, migracion 033): una aplicacion retirada
  // se puede REACTIVAR — la misma fila vuelve a 'pending', conservando el
  // historial. rejected/expired siguen siendo definitivos.
  const wasWithdrawn = existingApp?.status === 'withdrawn';
  // One application per technician per offer. Also require offer to be open for discovery (history viewing is allowed).
  // Paso 5b: y que el filtro de la oferta no lo saque. La lista de ofertas ya
  // no se la enseña, pero a esta pantalla se llega también por enlace.
  const filteredOut = Boolean(match && !match.eligible);
  const ineligibleReason = match && !match.eligible ? ineligibilityReasonText(match.reason) : null;
  const canApply = !activeDirectOffer && (!existingApp || wasWithdrawn) && open && !filteredOut;
  // Una retirada NO cuenta como aplicacion activa: si no, la pantalla
  // mostraria su estado en vez del boton de volver a aplicar.
  const activeApp = !!existingApp && !wasWithdrawn;
  const statusLook = activeApp
    ? technicianApplicationLook(existingApp!.status, 'detail')
    : existingDirectOffer
      ? technicianDirectOfferLook(existingDirectOffer.status)
      : null;
  const accepted = activeApp && existingApp!.status === 'accepted';

  const notEligible = Boolean(score && score.blockers.length > 0) || filteredOut;
  // La misma regla con la que la base enseña la identidad a la empresa.
  const identityVisible = Boolean(technicianId) && companyCanSeeIdentity({
    companyId: offer.companyId,
    technicianId: technicianId!,
    offerRequests: allDirectOffers,
    offerApplications: allApplications,
  });
  const displayLabel = score ? getMatchDisplayLabel(offer, score) : undefined;
  const companyName = company?.name ?? null;
  const companyLine = [companyName, offerPlaceLine(offer)].filter(Boolean).join(' · ');

  const banners = (
    <>
      {!open ? (
        <NoticeBox>
          {`${offer.status === 'expired' ? 'This offer has expired.' : 'This offer is closed.'} Viewing as historical record.`}
        </NoticeBox>
      ) : null}
      {ineligibleReason ? <NoticeBox tone="error" title="Not eligible">{ineligibleReason}</NoticeBox> : null}
    </>
  );

  const chips = <OfferTags offer={offer} />;

  const checklist = (
    <OfferChecklistSection offer={offer} score={score} wide={wide} ratingIndex={ratingIndex} engineIndex={engineIndex} />
  );
  const about = <OfferAboutRole offer={offer} wide={wide} />;

  const companyCard = (
    <View style={styles.companyCard}>
      <Avatar kind="company" size={40} name={companyName} logoPath={company?.logoPath} />
      <View style={styles.companyCopy}>
        <Text style={styles.companyName} numberOfLines={2}>
          {[companyName ?? 'Company', company?.companyType ? COMPANY_TYPE_LABELS[company.companyType] ?? company.companyType : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text style={styles.companyMeta}>Published {formatPublishedDate(offer.createdAt)}</Text>
        {company?.website ? <ExternalLink url={company.website} color={colors.primary} /> : null}
      </View>
    </View>
  );

  // Estado y acción: lo de la tarjeta "Application status" y la botonera de
  // antes. En móvil, fijo abajo; en escritorio, en la columna lateral.
  const privacyLine = (
    <View style={styles.privacy}>
      <Lock color={colors.textSecondary} size={13} strokeWidth={2.4} />
      <Text style={styles.privacyText}>
        {activeDirectOffer ? LINKED_TO_DIRECT_OFFER : accepted ? ACCEPTED_NOTE : offerPrivacyText(identityVisible)}
      </Text>
    </View>
  );

  let action: React.ReactNode = null;
  if (activeDirectOffer) {
    action = (
      <PillButton
        label="Review direct offer"
        onPress={() => router.push(`/technician/direct-offers/${existingDirectOffer!.id}` as never)}
      />
    );
  } else if (activeApp) {
    if (existingApp!.status === 'pending') {
      action = <PillButton label="Withdraw application" variant="outline" onPress={handleWithdraw} />;
    } else if (accepted && chatRoom && !fromChat) {
      action = <PillButton label="Open chat" onPress={() => router.push(`/technician/chats/${chatRoom.id}` as never)} />;
    }
  } else if (canApply) {
    action = (
      <PillButton
        label={wasWithdrawn ? 'Apply again' : 'Apply'}
        onPress={() => { setCoverNote(''); setApplyOpen(true); }}
      />
    );
  }

  const status = statusLook ? (
    <View style={styles.statusRow}>
      <StatusPill label={statusLook.label} tone={statusLook.tone} large />
    </View>
  ) : !action ? (
    <Text style={styles.notApplied}>You have not applied to this offer yet.</Text>
  ) : null;

  const applySheet = (
    <BottomSheet
      visible={applyOpen}
      onClose={() => setApplyOpen(false)}
      dismissible={!applying}
      title="Apply to offer"
      subtitle={offer.title}
      footer={(
        <ButtonRow>
          <PillButton label="Cancel" variant="outline" size="md" onPress={() => setApplyOpen(false)} disabled={applying} grow={1} />
          <PillButton label="Send application" size="md" onPress={handleApply} loading={applying} grow={1} />
        </ButtonRow>
      )}
    >
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover note (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Add a short note to the company..."
          placeholderTextColor={colors.placeholder}
          value={coverNote}
          onChangeText={setCoverNote}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </View>
      <Text style={styles.sheetNote}>{applySheetNote(identityVisible)}</Text>
    </BottomSheet>
  );

  if (wide) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <PageBody wide>
          <Breadcrumb parent="Offers" onParent={() => router.navigate('/technician/offers' as never)} current={offer.title} />
          <TwoColumns
            main={(
              <>
                <View style={styles.wideHero}>
                  <Avatar kind="company" size={88} name={companyName} logoPath={company?.logoPath} />
                  <View style={styles.titleBlock}>
                    <Text style={[styles.title, styles.titleWide]} accessibilityRole="header">{offer.title}</Text>
                    <Text style={styles.subtitle}>{companyLine}</Text>
                    {chips}
                  </View>
                </View>
                {banners}
                {checklist}
                {about}
                {companyCard}
              </>
            )}
            aside={(
              <AsideCard>
                {score ? (
                  <ScoreHeadline total={score.total} label={displayLabel ?? ''} notEligible={notEligible} wide />
                ) : filteredOut ? (
                  <ScoreHeadline total={0} label="" notEligible reason={ineligibleReason ?? undefined} wide />
                ) : null}
                {status}
                {privacyLine}
                {action}
              </AsideCard>
            )}
          />
        </PageBody>
        {applySheet}
        {dialog}
      </TechnicianScreen>
    );
  }

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageBody wide={false} contentStyle={styles.mobileBody}>
        {/* La franja azul sólo con iniciales; con logo, el logo solo (fase 8, H). */}
        <AvatarFrame image={{ logoPath: company?.logoPath }} style={styles.hero}>
          <Pressable onPress={goBack} style={styles.heroBack} hitSlop={4} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft color={colors.text} size={26} strokeWidth={2.2} />
          </Pressable>
          <Avatar kind="company" size={104} name={companyName} logoPath={company?.logoPath} />
          {score || filteredOut ? (
            <View style={styles.heroPill}>
              <MatchPill total={score?.total ?? 0} notEligible={notEligible} label={displayLabel} large />
            </View>
          ) : null}
        </AvatarFrame>
        <View style={styles.mobileContent}>
          <View style={styles.titleBlock}>
            <Text style={styles.title} accessibilityRole="header">{offer.title}</Text>
            <Text style={styles.subtitle}>{companyLine}</Text>
            {chips}
          </View>
          {banners}
          {checklist}
          {about}
          {companyCard}
        </View>
      </PageBody>
      <StickyBar>
        {privacyLine}
        {status}
        {action}
      </StickyBar>
      {applySheet}
      {dialog}
    </TechnicianScreen>
  );
}

const styles = StyleSheet.create({
  mobileBody: {
    paddingHorizontal: 0,
    paddingTop: 0,
    gap: 0,
  },
  hero: {
    height: 200,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBack: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  heroPill: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  mobileContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    gap: 18,
  },
  wideHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  titleWide: {
    fontSize: 26,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14.5,
    color: colors.textSecondary,
  },
  companyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
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
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  privacyText: {
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  statusRow: {
    alignItems: 'center',
  },
  notApplied: {
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
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
  sheetNote: {
    marginTop: 10,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
