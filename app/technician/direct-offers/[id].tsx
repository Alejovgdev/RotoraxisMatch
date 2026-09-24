import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  RefreshControl,
  Modal,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { InlineScore } from '../../../src/components/InlineScore';
import { MatchExplanation } from '../../../src/components/MatchExplanation';
import { Button } from '../../../src/components/Button';
import { ExternalLink } from '../../../src/components/ExternalLink';
import {
  EmptyPanel,
  InitialAvatar,
  TechnicianBadge,
  TechnicianCard,
  TechnicianChip,
  TechnicianPageHeader,
  TechnicianScreen,
  techStyles,
  techUi,
} from '../../../src/components/technician/TechnicianUI';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { isOfferOpenForTechnicians, offerRepository } from '../../../src/repositories/v2/offerRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { getMatchDisplayLabel, ineligibilityReasonText, matchPair, PairMatch } from '../../../src/utils/matchingV2';
import { visibleBreakdownRows } from '../../../src/utils/matchBreakdownRows';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { ONLY_UNLICENSED_TEXT, offerCertificationText, offerEngineText, offerLicenseDetailText } from '../../../src/utils/offerRequirementsText';
import { getAircraftTypeRatingLabel } from '../../../src/constants/aircraftTypeRatings';
import { technicianTypeLabel } from '../../../src/constants/technicianTypes';
import { OfferRequest } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';
import { CompanyProfileView } from '../../../src/types/company';
import { MatchScore } from '../../../src/types/matching';
import { ChatRoom } from '../../../src/types/chat';
import { formatLocation } from '../../../src/utils/formatLocation';

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function statusTone(status: string): 'success' | 'warning' | 'error' | 'muted' {
  if (status === 'accepted') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'rejected') return 'error';
  return 'muted';
}

function statusLabel(status: string): string {
  if (status === 'pending') return 'Pending';
  if (status === 'accepted') return 'Accepted';
  if (status === 'rejected') return 'Declined';
  if (status === 'expired') return 'Expired';
  if (status === 'withdrawn') return 'Withdrawn';
  return status;
}

export default function DirectOfferDetailScreen() {
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const router = useRouter();
  const goBack = useGoBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [request, setRequest] = useState<OfferRequest | null>(null);
  const [company, setCompany] = useState<CompanyProfileView | null>(null);
  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  // Paso 5b: el par entero (ver app/company/applications/[id].tsx).
  const [match, setMatch] = useState<PairMatch | null>(null);
  const score: MatchScore | null = match?.eligible ? match.score : null;
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'accept' | 'reject' | null>(null);
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

    const [co, off, techWithRelations] = await Promise.all([
      companyRepositoryV2.getById(req.companyId),
      req.offerId ? offerRepository.getWithRequirements(req.offerId) : Promise.resolve(null),
      technicianRepositoryV2.getWithRelations(technicianId),
    ]);

    if (!signal.active) return;
    setCompany(co);
    setOffer(off);

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

  // Real per-offer rows, labels and denominators — never hardcoded (see
  // src/utils/matchBreakdownRows.ts).
  const breakdownRows = useMemo(() => visibleBreakdownRows(offer), [offer]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    setRefreshing(false);
  }

  function handleAccept() {
    if (!id) return;
    setActionError(null);
    setConfirmAction('accept');
  }

  function handleReject() {
    if (!id) return;
    setActionError(null);
    setConfirmAction('reject');
  }

  async function doConfirmAction() {
    if (!id || !confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    setActioning(true);
    setActionError(null);
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
        <View style={styles.notFound}>
          <EmptyPanel title="Offer not found" subtitle="This direct offer is no longer available." />
        </View>
      </TechnicianScreen>
    );
  }

  const accent = score ? scoreColor(score.total) : colors.technician;
  const isPending = request.status === 'pending';
  const isAccepted = request.status === 'accepted';
  // Only relevant for pending: shows "Offer closed" banner and disables Accept.
  // Accepted/rejected/historical records are not affected by the linked offer's status.
  const linkedOfferUnavailable = isPending && Boolean(request.offerId && !isOfferOpenForTechnicians(offer));
  // Show offer details when active, or when accepted (historical context after offer closes).
  const visibleOffer = offer && (isOfferOpenForTechnicians(offer) || isAccepted) ? offer : null;

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[techStyles.content, isWide && techStyles.contentWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <TechnicianPageHeader
          eyebrow="Direct offer"
          title={visibleOffer?.title ?? 'Direct offer'}
          subtitle={`${company.name} - received ${formatDate(request.createdAt)}`}
          onBack={goBack}
          right={<TechnicianBadge label={statusLabel(request.status)} tone={statusTone(request.status)} />}
        />

        <TechnicianCard style={styles.section}>
          <View style={styles.companyRow}>
            <InitialAvatar label={company.name} size={46} />
            <View style={styles.companyInfo}>
              <Text style={styles.companyName}>{company.name}</Text>
              <Text style={styles.companyType}>
                {company.companyType ? COMPANY_TYPE_LABELS[company.companyType] ?? company.companyType : 'Company'}
              </Text>
              <Text style={styles.companyLocation}>{formatLocation(company.city, company.country)}</Text>
              {company.website ? (
                <ExternalLink url={company.website} color={techUi.accent} />
              ) : null}
            </View>
            <TechnicianBadge
              label={company.verificationStatus}
              tone={company.verificationStatus === 'verified' ? 'success' : 'warning'}
              small
            />
          </View>
        </TechnicianCard>

        {visibleOffer && (
          <TechnicianCard style={styles.section}>
            {score && (
              <InlineScore
                score={score.total}
                quality={getMatchDisplayLabel(visibleOffer, score)}
                context="match with your profile"
                notEligible={score.blockers.length > 0}
              />
            )}
            {match && !match.eligible && (
              <InlineScore score={0} quality="" context="" notEligible notEligibleReason={ineligibilityReasonText(match.reason)} />
            )}
            <Text style={styles.offerTitle}>{visibleOffer.title}</Text>
            <Text style={styles.offerLocation}>
              {formatLocation(visibleOffer.locationCity, visibleOffer.locationCountry)}
              {visibleOffer.locationBaseAirport ? ` - ${visibleOffer.locationBaseAirport}` : ''}
            </Text>
            <Text style={styles.offerDescription}>{visibleOffer.description}</Text>

            <View style={styles.badgeRow}>
              <TechnicianBadge label={CONTRACT_LABELS[visibleOffer.contractType] ?? visibleOffer.contractType} tone="muted" />
              <TechnicianBadge label={`${visibleOffer.minYearsExperience} yrs min`} tone="muted" />
            </View>

            {/* Siempre visible desde la Fase 6 tanda C: el técnico tiene que
                ver si el puesto exige licencia antes de aceptar. */}
            {(
              <View style={styles.reqBlock}>
                {visibleOffer.offerKind === 'engine' ? (
                  <ReqRow label="Engine" items={[offerEngineText(visibleOffer, engineIndex) ?? 'Not specified']} />
                ) : (
                  <ReqRow label="Profile type" items={[technicianTypeLabel(visibleOffer.technicianType)]} />
                )}
                <ReqRow
                  label="Certified work"
                  items={[offerCertificationText(visibleOffer)]}
                />
                {visibleOffer.licenseCode && <ReqRow label="Licence" items={[offerLicenseDetailText(visibleOffer)!]} />}
                {visibleOffer.onlyUnlicensed && <ReqRow label="Candidates" items={[ONLY_UNLICENSED_TEXT]} />}
                {visibleOffer.requiredHabilitations.length > 0 && (
                  <ReqRow
                    label={visibleOffer.requiresAllAircraft ? 'Aircraft — ALL of these' : 'Aircraft — any one of these'}
                    items={visibleOffer.requiredHabilitations.map((h) => getAircraftTypeRatingLabel(h.aircraftTypeRatingId, ratingIndex))}
                  />
                )}
              </View>
            )}

            {score && (
              <View style={styles.breakdownBlock}>
                <Text style={styles.sectionTitle}>Match breakdown</Text>
                {breakdownRows.map((row) => (
                  <BreakdownRow key={row.key} label={row.label} value={score.breakdown[row.key]} max={row.max} accent={accent} />
                ))}
                <MatchExplanation
                  score={score}
                  hideBreakdown
                  displayLabel={visibleOffer ? getMatchDisplayLabel(visibleOffer, score) : undefined}
                />
              </View>
            )}
          </TechnicianCard>
        )}

        {linkedOfferUnavailable && (
          <TechnicianCard style={styles.inactiveNote}>
            <Text style={styles.noteTitle}>Offer closed</Text>
            <Text style={styles.noteSub}>
              This offer is no longer active and cannot be accepted.
            </Text>
          </TechnicianCard>
        )}

        {request.message && (
          <TechnicianCard style={styles.section}>
            <Text style={styles.sectionTitle}>Message from company</Text>
            <Text style={styles.messageText}>"{request.message}"</Text>
          </TechnicianCard>
        )}

        <TechnicianCard style={styles.section}>
          <Text style={styles.sectionTitle}>Status</Text>
          <TechnicianBadge label={statusLabel(request.status)} tone={statusTone(request.status)} />
          <Text style={styles.dateText}>Received {formatDate(request.createdAt)}</Text>
          {request.updatedAt !== request.createdAt && (
            <Text style={styles.dateText}>Updated {formatDate(request.updatedAt)}</Text>
          )}
        </TechnicianCard>

        {actionError && (
          <View style={styles.errorNote}>
            <Text style={styles.errorNoteText}>{actionError}</Text>
          </View>
        )}

        {isPending && !linkedOfferUnavailable && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectBtn, actioning && styles.btnDisabled]}
              onPress={handleReject}
              disabled={actioning}
              activeOpacity={0.75}
            >
              {actioning ? <ActivityIndicator color={techUi.red} size="small" /> : <Text style={styles.rejectBtnText}>Decline</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.acceptBtn, actioning && styles.btnDisabled]}
              onPress={handleAccept}
              disabled={actioning}
              activeOpacity={0.75}
            >
              {actioning ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.acceptBtnText}>Accept offer</Text>}
            </TouchableOpacity>
          </View>
        )}

        {isAccepted && (
          <TechnicianCard style={styles.acceptedNote}>
            <Text style={styles.noteTitle}>Offer accepted</Text>
            <Text style={styles.noteSub}>
              The company can now see your full identity and admin-verified documents. A chat room is available for direct communication.
            </Text>
            {chatRoom && (
              <Button label="Open chat" onPress={() => router.push(`/technician/chats/${chatRoom.id}` as any)} fullWidth />
            )}
          </TechnicianCard>
        )}

        {request.status === 'rejected' && (
          <TechnicianCard style={styles.rejectedNote}>
            <Text style={styles.noteTitle}>Offer declined</Text>
            <Text style={styles.noteSub}>Your identity and documents remain private.</Text>
          </TechnicianCard>
        )}

        {(request.status === 'expired' || request.status === 'withdrawn') && (
          <TechnicianCard style={styles.inactiveNote}>
            <Text style={styles.noteSub}>
              {request.status === 'expired'
                ? 'This offer has expired and is no longer active.'
                : 'This offer was withdrawn by the company.'}
            </Text>
          </TechnicianCard>
        )}
      </ScrollView>

      <Modal visible={confirmAction !== null} transparent animationType="fade" onRequestClose={() => setConfirmAction(null)}>
        <View style={modalStyles.overlay}>
          <TechnicianCard style={modalStyles.card}>
            <Text style={modalStyles.title}>
              {confirmAction === 'accept' ? 'Accept direct offer?' : 'Reject direct offer?'}
            </Text>
            <Text style={modalStyles.body}>
              {confirmAction === 'accept'
                ? 'This will unlock your identity and admin-verified documents for the company and open a chat.'
                : 'The company will be notified. Your identity and documents will remain locked.'}
            </Text>
            <TouchableOpacity
              style={[modalStyles.confirmBtn, confirmAction === 'reject' && modalStyles.confirmBtnDestructive]}
              onPress={doConfirmAction}
              activeOpacity={0.75}
            >
              <Text style={modalStyles.confirmBtnText}>
                {confirmAction === 'accept' ? 'Confirm accept' : 'Confirm reject'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={modalStyles.cancelBtn} onPress={() => setConfirmAction(null)} activeOpacity={0.75}>
              <Text style={modalStyles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
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
  section: { marginBottom: spacing.md },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: techUi.text, marginBottom: spacing.sm },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  companyInfo: { flex: 1, minWidth: 0 },
  companyName: { fontSize: 16, fontWeight: '700', color: techUi.text, marginBottom: 2 },
  companyType: { fontSize: 12, color: techUi.textSoft, marginBottom: 2 },
  companyLocation: { fontSize: 12, color: techUi.textMuted },
  offerTitle: { fontSize: 16, fontWeight: '700', color: techUi.text, marginBottom: 4 },
  offerLocation: { fontSize: 12, color: techUi.textMuted, marginBottom: spacing.sm },
  offerDescription: { fontSize: 13, color: techUi.textSoft, lineHeight: 20, marginBottom: spacing.md },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  reqBlock: { marginTop: spacing.md },
  reqRow: { marginBottom: spacing.sm },
  reqLabel: { fontSize: 12, color: techUi.textSoft, fontWeight: '600', marginBottom: spacing.xs },
  reqPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  breakdownBlock: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: techUi.borderSoft },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  breakdownLabel: { fontSize: 12, color: techUi.textSoft, width: 90 },
  breakdownBarBg: { flex: 1, height: 7, backgroundColor: techUi.borderSoft, borderRadius: 4, overflow: 'hidden' },
  breakdownBarFill: { height: '100%', borderRadius: 4 },
  breakdownScore: { fontSize: 11, fontWeight: '700', width: 38, textAlign: 'right' },
  messageText: { fontSize: 13, color: techUi.textSoft, lineHeight: 20 },
  dateText: { fontSize: 12, color: techUi.textMuted, marginTop: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  acceptBtn: { backgroundColor: techUi.green },
  rejectBtn: { backgroundColor: techUi.surface, borderWidth: 1, borderColor: techUi.red },
  btnDisabled: { opacity: 0.6 },
  acceptBtnText: { fontSize: 14, fontWeight: '700', color: colors.white },
  rejectBtnText: { fontSize: 14, fontWeight: '700', color: techUi.red },
  acceptedNote: { marginBottom: spacing.md, borderColor: '#BBF7D0' },
  rejectedNote: { marginBottom: spacing.md, borderColor: '#FECACA' },
  inactiveNote: { marginBottom: spacing.md },
  noteTitle: { fontSize: 15, fontWeight: '700', color: techUi.text, marginBottom: 5 },
  noteSub: { fontSize: 13, lineHeight: 20, color: techUi.textSoft, marginBottom: spacing.sm },
  errorNote: { backgroundColor: techUi.redSoft, borderRadius: 14, padding: spacing.md, borderWidth: 1, borderColor: '#FECACA', marginBottom: spacing.md },
  errorNoteText: { fontSize: 13, color: techUi.red, lineHeight: 18 },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: { width: '100%', maxWidth: 360 },
  title: { fontSize: 18, fontWeight: '700', color: techUi.text, marginBottom: spacing.sm },
  body: { fontSize: 13, color: techUi.textSoft, lineHeight: 20, marginBottom: spacing.lg },
  confirmBtn: {
    backgroundColor: techUi.green,
    borderRadius: 14,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  confirmBtnDestructive: { backgroundColor: techUi.red },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: colors.white },
  cancelBtn: { paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  cancelBtnText: { fontSize: 14, color: techUi.textMuted, fontWeight: '600' },
});
