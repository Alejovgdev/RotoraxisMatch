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
  useWindowDimensions,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { colors, spacing } from '../../../src/theme';
import { formatOfferSalary } from '../../../src/utils/offerSalary';
import { getAircraftTypeRatingLabel } from '../../../src/constants/aircraftTypeRatings';
import { getOfferProductTypeLabel } from '../../../src/constants/offerProductTypes';
import { technicianTypeLabel } from '../../../src/constants/technicianTypes';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { InlineScore } from '../../../src/components/InlineScore';
import { MatchExplanation } from '../../../src/components/MatchExplanation';
import { Button } from '../../../src/components/Button';
import { ExternalLink } from '../../../src/components/ExternalLink';
import {
  EmptyPanel,
  TechnicianBadge,
  TechnicianCard,
  TechnicianChip,
  TechnicianPageHeader,
  TechnicianScreen,
  techStyles,
  techUi,
} from '../../../src/components/technician/TechnicianUI';
import { isOfferOpenForTechnicians, offerRepository } from '../../../src/repositories/v2/offerRepository';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { getMatchScoreWeights, getMatchDisplayLabel, ineligibilityReasonText, matchPair, PairMatch } from '../../../src/utils/matchingV2';
import { visibleBreakdownRows } from '../../../src/utils/matchBreakdownRows';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { ONLY_UNLICENSED_TEXT, offerCertificationText, offerEngineText, offerLicenseDetailText } from '../../../src/utils/offerRequirementsText';
import { OfferWithRequirements } from '../../../src/types/offer';
import { CompanyProfileView } from '../../../src/types/company';
import { MatchScore } from '../../../src/types/matching';
import { OfferApplication, OfferRequest } from '../../../src/types/offerRequest';
import { ChatRoom } from '../../../src/types/chat';
import { notify, confirmAction } from '../../../src/utils/platformAlert';

function formatPublishedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const CONTRACT_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  long_term: 'Long-term',
  short_term: 'Short-term',
};

const COMPANY_TYPE_LABELS: Record<string, string> = {
  MRO: 'MRO',
  airline: 'Airline',
  recruitment_agency: 'Recruitment Agency',
  helicopter_operator: 'Helicopter Operator',
  other: 'Other',
};

function scoreColor(total: number): string {
  if (total >= 80) return colors.success;
  if (total >= 60) return colors.blue;
  if (total >= 40) return colors.warning;
  return colors.textMuted;
}

function appStatusInfo(status: string): { label: string; tone: 'success' | 'warning' | 'error' | 'muted'; color: string } {
  switch (status) {
    case 'pending': return { label: 'Application sent - pending review', tone: 'warning', color: techUi.amber };
    case 'accepted': return { label: 'Accepted', tone: 'success', color: techUi.green };
    case 'rejected': return { label: 'Not selected', tone: 'error', color: techUi.red };
    case 'expired': return { label: 'Offer expired', tone: 'muted', color: techUi.textMuted };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'muted', color: techUi.textMuted };
    default: return { label: status, tone: 'muted', color: techUi.textMuted };
  }
}

function directOfferStatusInfo(status: string): { label: string; tone: 'success' | 'warning' | 'error' | 'muted' } {
  switch (status) {
    case 'pending': return { label: 'Direct offer received - pending response', tone: 'warning' };
    case 'accepted': return { label: 'Direct offer accepted', tone: 'success' };
    case 'rejected': return { label: 'Direct offer rejected', tone: 'error' };
    case 'expired': return { label: 'Direct offer expired', tone: 'muted' };
    case 'withdrawn': return { label: 'Direct offer withdrawn', tone: 'muted' };
    default: return { label: status, tone: 'muted' };
  }
}

export default function OfferDetailScreen() {
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useGoBack();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  const [company, setCompany] = useState<CompanyProfileView | null>(null);
  // Paso 5b: el par entero (ver app/company/applications/[id].tsx).
  const [match, setMatch] = useState<PairMatch | null>(null);
  const score: MatchScore | null = match?.eligible ? match.score : null;
  const [existingApp, setExistingApp] = useState<OfferApplication | null>(null);
  const [existingDirectOffer, setExistingDirectOffer] = useState<OfferRequest | null>(null);
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [loading, setLoading] = useState(true);

  const [modalVisible, setModalVisible] = useState(false);
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
    setExistingApp(app);
    setExistingDirectOffer(directOffers.find((request) => request.offerId === id) ?? null);

    if (app) {
      await activityRepository.markRead('technician', technicianId, app.id);
    }

    if (app && app.status === 'accepted') {
      const rooms = await chatRepository.getRoomsForTechnician(technicianId);
      if (!signal.active) return;
      setChatRoom(rooms.find((r) => r.offerApplicationId === app.id) ?? null);
    } else {
      setChatRoom(null);
    }
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
      load(signal).finally(() => { if (signal.active) setLoading(false); });
      return () => { signal.active = false; };
    }, [load]),
  );

  // Real per-offer denominators — same source the company side uses
  // (app/company/offers/[id].tsx) — never hardcoded, since weights change
  // per offer (qualification-requiring vs. not) and have changed once
  // already (Fase 2 rebalance).
  const weights = useMemo(() => (offer ? getMatchScoreWeights(offer) : null), [offer]);

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
      setModalVisible(false);
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
    const confirmed = await confirmAction({
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
        <View style={styles.notFound}>
          <EmptyPanel title="Offer not found" subtitle="This offer is no longer available." />
        </View>
      </TechnicianScreen>
    );
  }

  const accent = score ? scoreColor(score.total) : colors.technician;
  const activeDirectOffer = existingDirectOffer && (existingDirectOffer.status === 'pending' || existingDirectOffer.status === 'accepted');
  // Retirarse NO veta (2026-07-28, migracion 033): una aplicacion retirada
  // se puede REACTIVAR — la misma fila vuelve a 'pending', conservando el
  // historial. rejected/expired siguen siendo definitivos.
  const wasWithdrawn = existingApp?.status === 'withdrawn';
  // One application per technician per offer. Also require offer to be open for discovery (history viewing is allowed).
  // Paso 5b: y que el filtro de la oferta no lo saque. La lista de ofertas ya
  // no se la enseña, pero a esta pantalla se llega también por enlace.
  const filteredOut = Boolean(match && !match.eligible);
  const canApply = !activeDirectOffer && (!existingApp || wasWithdrawn) && isOfferOpenForTechnicians(offer) && !filteredOut;
  // Una retirada NO cuenta como aplicacion activa: si no, la pantalla
  // mostraria su estado en vez del boton de volver a aplicar.
  const activeApp = !!existingApp && !wasWithdrawn;
  const statusInfo = activeApp ? appStatusInfo(existingApp!.status) : null;
  const directOfferInfo = existingDirectOffer ? directOfferStatusInfo(existingDirectOffer.status) : null;

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[techStyles.content, isWide && techStyles.contentWide]}
        showsVerticalScrollIndicator={false}
      >
        <TechnicianPageHeader
          eyebrow="Offer detail"
          title={offer.title}
          subtitle={company ? `${company.name} - ${offer.locationCity}, ${offer.locationCountry}` : `${offer.locationCity}, ${offer.locationCountry}`}
          onBack={goBack}
        />

        <TechnicianCard style={styles.summaryCard}>
          {!isOfferOpenForTechnicians(offer) && (
            <View style={styles.closedBanner}>
              <Text style={styles.closedBannerText}>
                {offer.status === 'expired' ? 'This offer has expired.' : 'This offer is closed.'}
                {' '}Viewing as historical record.
              </Text>
            </View>
          )}
          {score && (
            <InlineScore
              score={score.total}
              quality={getMatchDisplayLabel(offer, score)}
              context="match with your profile"
              notEligible={score.blockers.length > 0}
            />
          )}
          {match && !match.eligible && (
            <InlineScore score={0} quality="" context="" notEligible notEligibleReason={ineligibilityReasonText(match.reason)} />
          )}
          <View style={styles.badgeRow}>
            <TechnicianBadge label={getOfferProductTypeLabel(offer.productType)} tone="info" />
            <TechnicianBadge label={CONTRACT_LABELS[offer.contractType] ?? offer.contractType} tone="muted" />
            {offer.minYearsExperience > 0 ? (
              <TechnicianBadge label={`${offer.minYearsExperience}+ yrs exp`} tone="muted" />
            ) : null}
          </View>
          {company ? (
            <Text style={styles.companyLine}>
              {company.name}
              {company.companyType ? ` - ${COMPANY_TYPE_LABELS[company.companyType] ?? company.companyType}` : ''}
            </Text>
          ) : null}
          {company?.website ? (
            <ExternalLink url={company.website} color={techUi.accent} />
          ) : null}
          <Text style={styles.location}>
            {offer.locationCity}, {offer.locationCountry}
            {offer.locationBaseAirport ? ` - ${offer.locationBaseAirport}` : ''}
          </Text>
          <Text style={styles.publishedDate}>Published {formatPublishedDate(offer.createdAt)}</Text>
          <Text style={styles.companyLine}>{formatOfferSalary(offer.salary) ?? 'Remuneration not specified'}</Text>
          <Text style={styles.description}>{offer.description}</Text>
        </TechnicianCard>

        {/* La tarjeta se muestra SIEMPRE desde la Fase 6 tanda C: el tipo de
            perfil y el interruptor de certificación existen en toda oferta, y
            el técnico tiene que ver si le exigen licencia ANTES de aplicar. */}
        {(
          <TechnicianCard style={styles.section}>
            <Text style={styles.sectionTitle}>Requirements</Text>
            {offer.offerKind === 'engine' ? (
              <ReqRow label="Engine" items={[offerEngineText(offer, engineIndex) ?? 'Not specified']} />
            ) : (
              <ReqRow label="Profile type" items={[technicianTypeLabel(offer.technicianType)]} />
            )}
            <ReqRow
              label="Certified work"
              items={[offerCertificationText(offer)]}
            />
            {offer.licenseCode && <ReqRow label="Licence" items={[offerLicenseDetailText(offer)!]} />}
            {offer.onlyUnlicensed && <ReqRow label="Candidates" items={[ONLY_UNLICENSED_TEXT]} />}
            {offer.requiredHabilitations.length > 0 && (
              // Fase 6 tanda D: la exigencia se dice UNA vez en la etiqueta,
              // no "(preferred)" por fila. El técnico tiene que saber si le
              // piden todas o le basta con una ANTES de aplicar.
              <ReqRow
                label={offer.requiresAllAircraft ? 'Aircraft — ALL of these' : 'Aircraft — any one of these'}
                items={offer.requiredHabilitations.map((h) => getAircraftTypeRatingLabel(h.aircraftTypeRatingId, ratingIndex))}
              />
            )}
          </TechnicianCard>
        )}

        {score && (
          <TechnicianCard style={styles.section}>
            <Text style={styles.sectionTitle}>Match</Text>
            <Text style={styles.sectionSub}>How your profile scores against this offer's criteria.</Text>
            {visibleBreakdownRows(weights).map((row) => (
              <BreakdownRow key={row.key} label={row.label} value={score.breakdown[row.key]} max={row.max} accent={accent} />
            ))}
            <MatchExplanation score={score} hideBreakdown displayLabel={getMatchDisplayLabel(offer, score)} />
          </TechnicianCard>
        )}

        <TechnicianCard style={styles.section}>
          <Text style={styles.sectionTitle}>Application status</Text>
          {statusInfo ? (
            <TechnicianBadge label={statusInfo.label} tone={statusInfo.tone} />
          ) : directOfferInfo ? (
            <TechnicianBadge label={directOfferInfo.label} tone={directOfferInfo.tone} />
          ) : (
            <Text style={styles.sectionSub}>You have not applied to this offer yet.</Text>
          )}
          <Text style={styles.privacyText}>
            {activeDirectOffer
              ? 'This role is already linked to a direct offer, so a separate application is not needed.'
              : 'Your identity remains private until a company accepts your application.'}
          </Text>
        </TechnicianCard>

        <View style={styles.actions}>
          {activeDirectOffer ? (
            <Button
              label="Review direct offer"
              onPress={() => router.push(`/technician/direct-offers/${existingDirectOffer!.id}` as any)}
              fullWidth
            />
          ) : activeApp ? (
            <>
              {existingApp!.status === 'pending' && (
                <Button label="Withdraw application" variant="outline" onPress={handleWithdraw} fullWidth />
              )}
              {existingApp!.status === 'accepted' && (
                <>
                  <Text style={styles.acceptedNote}>
                    Your identity and admin-verified documents are now accessible to the company.
                  </Text>
                  {chatRoom && (
                    <Button label="Open chat" onPress={() => router.push(`/technician/chats/${chatRoom.id}` as any)} fullWidth />
                  )}
                </>
              )}
            </>
          ) : canApply ? (
            <Button
              label={wasWithdrawn ? 'Apply again' : 'Apply to this offer'}
              onPress={() => { setCoverNote(''); setModalVisible(true); }}
              fullWidth
            />
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={modalStyles.overlay}>
          <TechnicianCard style={modalStyles.sheet}>
            <Text style={modalStyles.title}>Apply to offer</Text>
            <Text style={modalStyles.offerName} numberOfLines={2}>{offer.title}</Text>

            <Text style={modalStyles.fieldLabel}>Cover note (optional)</Text>
            <TextInput
              style={modalStyles.input}
              placeholder="Add a short note to the company..."
              placeholderTextColor={techUi.textMuted}
              value={coverNote}
              onChangeText={setCoverNote}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={modalStyles.privacyNote}>
              Do not include your real name or contact details. Your identity will remain anonymous until the company accepts your application.
            </Text>

            <View style={modalStyles.actions}>
              <TouchableOpacity style={[modalStyles.btn, modalStyles.cancelBtn]} onPress={() => setModalVisible(false)} activeOpacity={0.75}>
                <Text style={modalStyles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.btn, modalStyles.confirmBtn, applying && modalStyles.btnDisabled]}
                onPress={handleApply}
                disabled={applying}
                activeOpacity={0.75}
              >
                {applying ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={modalStyles.confirmBtnText}>Send application</Text>}
              </TouchableOpacity>
            </View>
          </TechnicianCard>
        </View>
      </Modal>
    </TechnicianScreen>
  );
}

function ReqRow({ label, items }: { label: string; items: string[] }) {
  return (
    <View style={styles.reqRow}>
      <Text style={styles.reqLabel}>{label}</Text>
      <View style={styles.reqPills}>
        {items.map((item, i) => <TechnicianChip key={`${item}-${i}`} label={item} />)}
      </View>
    </View>
  );
}

function BreakdownRow({ label, value, max, accent }: { label: string; value: number; max: number; accent: string }) {
  const pct = max > 0 ? value / max : 0;
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <View style={styles.breakdownBarBg}>
        <View style={[styles.breakdownBarFill, { width: `${pct * 100}%` as any, backgroundColor: value > 0 ? accent : techUi.borderSoft }]} />
      </View>
      <Text style={[styles.breakdownScore, { color: value > 0 ? accent : techUi.textMuted }]}>{value}/{max}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  notFound: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  summaryCard: { marginBottom: spacing.md },
  closedBanner: {
    backgroundColor: techUi.surfaceSoft,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: techUi.border,
  },
  closedBannerText: { fontSize: 12, color: techUi.textMuted, fontWeight: '600', lineHeight: 17 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  companyLine: { fontSize: 14, fontWeight: '600', color: techUi.textSoft, marginBottom: 3 },
  location: { fontSize: 12, fontWeight: '500', color: techUi.textMuted, marginBottom: 3 },
  publishedDate: { fontSize: 11, fontWeight: '500', color: techUi.textMuted, marginBottom: spacing.sm },
  description: { fontSize: 13, color: techUi.textSoft, lineHeight: 20 },
  section: { marginBottom: spacing.md },
  sectionTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: techUi.text,
    marginBottom: spacing.sm,
  },
  sectionSub: { fontSize: 12, color: techUi.textSoft, lineHeight: 18, marginBottom: spacing.md },
  reqRow: { marginBottom: spacing.sm },
  reqLabel: { fontSize: 12, color: techUi.textSoft, fontWeight: '600', marginBottom: spacing.xs },
  reqPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  breakdownLabel: { fontSize: 12, color: techUi.textSoft, width: 90 },
  breakdownBarBg: { flex: 1, height: 7, backgroundColor: techUi.borderSoft, borderRadius: 4, overflow: 'hidden' },
  breakdownBarFill: { height: '100%', borderRadius: 4 },
  breakdownScore: { fontSize: 11, fontWeight: '700', width: 38, textAlign: 'right' },
  privacyText: { fontSize: 12, lineHeight: 18, color: techUi.textMuted, marginTop: spacing.sm },
  actions: { marginBottom: spacing.md, gap: spacing.sm },
  acceptedNote: { fontSize: 12, lineHeight: 18, color: techUi.textSoft, textAlign: 'center' },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.42)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
  },
  title: { fontSize: 18, fontWeight: '700', color: techUi.text, marginBottom: spacing.xs },
  offerName: { fontSize: 13, color: techUi.textSoft, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: techUi.textSoft, marginBottom: spacing.xs },
  input: {
    backgroundColor: techUi.surfaceSoft,
    borderWidth: 1,
    borderColor: techUi.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: techUi.text,
    minHeight: 96,
    marginBottom: spacing.sm,
  },
  privacyNote: { fontSize: 11, color: techUi.textMuted, marginBottom: spacing.md, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  cancelBtn: { backgroundColor: techUi.surfaceSoft, borderWidth: 1, borderColor: techUi.border },
  confirmBtn: { backgroundColor: techUi.accent },
  btnDisabled: { opacity: 0.6 },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: techUi.text },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: colors.white },
});
