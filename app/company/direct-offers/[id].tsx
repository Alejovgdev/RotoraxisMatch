import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  RefreshControl,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  CheckCircle,
  Download,
  FileCheck,
  Lock,
  MessageCircle,
  Send,
  Unlock,
  UserRound,
  XCircle,
} from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { InlineScore } from '../../../src/components/InlineScore';
import { ExternalLink } from '../../../src/components/ExternalLink';
import { MatchExplanation } from '../../../src/components/MatchExplanation';
import {
  CompanyBadge,
  CompanyCard,
  CompanyChip,
  CompanyPageHeader,
  CompanyScreen,
  EmptyPanel,
  IconBox,
  InfoRow,
  companyStyles,
  companyUi,
} from '../../../src/components/company/CompanyUI';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { getMatchDisplayLabel, ineligibilityReasonText, matchPair, PairMatch } from '../../../src/utils/matchingV2';
import { isUnlocked, TechnicianView } from '../../../src/types/privacy';
import { getDocumentSignedUrl, openDocumentPreWindow, openDocumentUrl } from '../../../src/lib/documentStorage';
import { useCompanySession } from '../../../src/state/SessionContext';
import { canSendDirectOffers } from '../../../src/utils/companyPermissionsV2';
import { OfferRequest } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';
import { MatchScore } from '../../../src/types/matching';
import { Document } from '../../../src/types/document';
import { ChatRoom } from '../../../src/types/chat';
import { technicianTypeLabels } from '../../../src/constants/technicianTypes';
import { notify, confirmAction } from '../../../src/utils/platformAlert';
import { ViewTechnicianProfileButton } from '../../../src/components/company/ViewTechnicianProfileButton';

const DOC_TYPE_LABELS: Record<string, string> = {
  license:  'License',
  medical:  'Medical',
  id:       'ID',
  training: 'Training',
  resume:   'Resume',
  other:    'Other',
};

function statusInfo(status: string): { label: string; tone: 'success' | 'warning' | 'error' | 'muted' } {
  if (status === 'pending')   return { label: 'Awaiting response', tone: 'warning' };
  if (status === 'accepted')  return { label: 'Accepted', tone: 'success' };
  if (status === 'rejected')  return { label: 'Declined', tone: 'error' };
  if (status === 'withdrawn') return { label: 'Withdrawn', tone: 'muted' };
  if (status === 'expired')   return { label: 'Expired', tone: 'muted' };
  return { label: status, tone: 'muted' };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DirectOfferDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;

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

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    setRefreshing(false);
  }

  async function handleWithdraw() {
    if (!req) return;
    const confirmed = await confirmAction({
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

  async function handleViewDoc(docId: string, storagePath: string) {
    const win = openDocumentPreWindow();
    setViewingDocId(docId);
    const { url, error } = await getDocumentSignedUrl(storagePath, 120, false);
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
        <LoadingScreen color={colors.blue} role="company" />
      </>
    );
  }

  if (!req) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.notFound}>
          <EmptyPanel title="Offer not found" subtitle="This direct offer is no longer available." />
        </View>
      </CompanyScreen>
    );
  }

  // The technician account behind this direct offer was deleted after the
  // fact (technician_public_view excludes non-active profiles, migration
  // 024 — getViewForCompany resolves to null). The request record itself
  // is real historical data and stays visible — never hidden — but there
  // is nothing left to act on: no identity, no documents, no messaging.
  if (!techView) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[companyStyles.content, isWide && companyStyles.contentWide]}
          showsVerticalScrollIndicator={false}
        >
          <CompanyPageHeader
            eyebrow="Direct offer review"
            title="[Deleted user]"
            subtitle={`Sent ${formatDate(req.createdAt)}`}
            onBack={() => router.back()}
            right={<CompanyBadge label={statusInfo(req.status).label} tone={statusInfo(req.status).tone} />}
          />
          <CompanyCard style={styles.sectionCard}>
            <View style={styles.deletedRow}>
              <IconBox icon={UserRound} color={companyUi.textMuted} backgroundColor={companyUi.surfaceSoft} />
              <View style={styles.deletedCopy}>
                <Text style={styles.deletedTitle}>[Deleted user]</Text>
                <Text style={styles.deletedSub}>
                  This technician&apos;s account has been deleted. The direct offer record is kept for your history,
                  but identity, documents, and messaging are no longer available.
                </Text>
              </View>
            </View>
          </CompanyCard>
        </ScrollView>
      </CompanyScreen>
    );
  }

  const unlockedView = techView && isUnlocked(techView) ? techView : null;
  const unlocked = !!unlockedView;
  const reqStatus = statusInfo(req.status);

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
          eyebrow="Direct offer review"
          title={unlockedView ? `${unlockedView.firstName} ${unlockedView.lastName}` : (techView?.anonymousCode ?? '—')}
          subtitle={`Sent ${formatDate(req.createdAt)}`}
          onBack={() => router.back()}
          right={<CompanyBadge label={reqStatus.label} tone={reqStatus.tone} />}
        />

        {/* ── Overview ─────────────────────────────────── */}
        <CompanyCard style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <IconBox icon={Send} color={companyUi.accent} backgroundColor={companyUi.accentSoft} />
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>Direct offer overview</Text>
              <Text style={styles.sectionSub}>
                {req.status === 'pending'
                  ? "Awaiting the technician's response."
                  : req.status === 'accepted'
                  ? 'Technician accepted. Identity and documents unlocked.'
                  : req.status === 'rejected'
                  ? 'Technician declined this offer.'
                  : `Status: ${req.status}`}
              </Text>
            </View>
          </View>
          {score && offer ? (
            <>
              <InlineScore
                score={score.total}
                quality={getMatchDisplayLabel(offer, score)}
                context="match for this offer"
                notEligible={score.blockers.length > 0}
              />
              <MatchExplanation score={score} displayLabel={getMatchDisplayLabel(offer, score)} />
            </>
          ) : null}
          {match && !match.eligible ? (
            <InlineScore score={0} quality="" context="" notEligible notEligibleReason={ineligibilityReasonText(match.reason)} />
          ) : null}
          {req.message ? (
            <View style={styles.messageBlock}>
              <Text style={styles.messageLabel}>Your message</Text>
              <Text style={styles.messageText}>{req.message}</Text>
            </View>
          ) : null}
        </CompanyCard>

        {/* ── Linked offer ─────────────────────────────── */}
        {offer ? (
          <CompanyCard style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <IconBox icon={CheckCircle} color={companyUi.green} backgroundColor={companyUi.greenSoft} />
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>{offer.title}</Text>
                <Text style={styles.sectionSub}>{offer.locationCity}, {offer.locationCountry}</Text>
              </View>
            </View>
            <InfoRow label="Contract" value={offer.contractType} />
            <InfoRow label="Experience" value={`${offer.minYearsExperience} yrs min`} />
            <TouchableOpacity
              style={styles.textLink}
              onPress={() => router.push(`/company/offers/${offer.id}` as any)}
              activeOpacity={0.75}
            >
              <Text style={styles.textLinkText}>View full offer details</Text>
            </TouchableOpacity>
          </CompanyCard>
        ) : null}

        {/* ── Technician identity ───────────────────────── */}
        {techView ? (
          <CompanyCard style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <IconBox
                icon={unlocked ? Unlock : Lock}
                color={unlocked ? companyUi.green : companyUi.amber}
                backgroundColor={unlocked ? companyUi.greenSoft : companyUi.amberSoft}
              />
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>
                  {unlocked ? 'Identity unlocked' : 'Identity locked until accepted'}
                </Text>
                <Text style={styles.sectionSub}>
                  {unlocked
                    ? 'Private contact details and admin-verified documents are available.'
                    : 'Only privacy-safe technician data is visible before acceptance.'}
                </Text>
              </View>
            </View>

            <View style={styles.profileRow}>
              <View style={[styles.profileAvatar, { backgroundColor: unlocked ? companyUi.accent : companyUi.navy }]}>
                <UserRound color={colors.white} size={22} strokeWidth={2} />
              </View>
              <View style={styles.profileInfo}>
                {unlocked ? (
                  <>
                    <Text style={styles.profileName}>{unlockedView.firstName} {unlockedView.lastName}</Text>
                    <Text style={styles.profileSub}>{unlockedView.email}</Text>
                    {unlockedView.phone ? <Text style={styles.profileSub}>{unlockedView.phone}</Text> : null}
                    {/* Ver la nota gemela en applications/[id].tsx: mismo gate
                        que el email y el telefono, misma rama. */}
                    {Object.entries(unlockedView.socialLinks ?? {}).map(([key, url]) =>
                      url ? <ExternalLink key={key} url={url} color={companyUi.accent} /> : null,
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.profileName}>{techView.anonymousCode}</Text>
                    <Text style={styles.profileSub}>Anonymous technician profile</Text>
                  </>
                )}
              </View>
            </View>

            <View style={styles.badgeRow}>
              <CompanyBadge label={technicianTypeLabels(techView.technicianTypes)} tone="cyan" small />
              <CompanyBadge label={`${techView.city}, ${techView.country}`} tone="muted" small />
              <CompanyBadge
                label={techView.verificationStatus}
                tone={techView.verificationStatus === 'verified' ? 'success' : 'warning'}
                small
              />
            </View>

            {unlocked ? (
              <ViewTechnicianProfileButton technicianId={techView.id} fullWidth />
            ) : null}
          </CompanyCard>
        ) : null}

        {/* ── Documents ────────────────────────────────── */}
        <CompanyCard style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <IconBox
              icon={FileCheck}
              color={unlocked ? companyUi.green : companyUi.amber}
              backgroundColor={unlocked ? companyUi.greenSoft : companyUi.amberSoft}
            />
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>Documents</Text>
              <Text style={styles.sectionSub}>
                {unlocked ? 'Admin-verified documents only.' : 'Locked until the technician accepts.'}
              </Text>
            </View>
          </View>

          {unlocked ? (
            unlockedView.documents.length === 0 ? (
              <Text style={styles.emptyText}>No documents on file.</Text>
            ) : (
              unlockedView.documents.map((doc: Document) => (
                <View key={doc.id} style={styles.docRow}>
                  <View style={styles.docInfo}>
                    <Text style={styles.docName}>{doc.fileName}</Text>
                    <Text style={styles.docMeta}>
                      {DOC_TYPE_LABELS[doc.type] ?? doc.type}
                      {doc.expiresAt ? ` · Expires ${formatDate(doc.expiresAt)}` : ''}
                    </Text>
                  </View>
                  <View style={styles.docActions}>
                    <CompanyBadge
                      label={doc.status}
                      tone={doc.status === 'verified' ? 'success' : doc.status === 'pending' ? 'warning' : 'error'}
                      small
                    />
                    {doc.storagePath ? (
                      <TouchableOpacity
                        style={styles.viewDocBtn}
                        onPress={() => handleViewDoc(doc.id, doc.storagePath)}
                        disabled={viewingDocId !== null}
                        activeOpacity={0.75}
                      >
                        {viewingDocId === doc.id ? (
                          <ActivityIndicator size="small" color={companyUi.accent} />
                        ) : (
                          <Download size={15} color={companyUi.accent} strokeWidth={2.2} />
                        )}
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ))
            )
          ) : (
            <View style={styles.lockedPanel}>
              <Lock color={companyUi.amber} size={20} strokeWidth={2} />
              <Text style={styles.lockedText}>
                {req.status === 'rejected' || req.status === 'withdrawn'
                  ? 'Documents are not available for this offer.'
                  : 'Documents unlock automatically when the technician accepts.'}
              </Text>
            </View>
          )}
        </CompanyCard>

        {/* ── Chat ─────────────────────────────────────── */}
        {req.status === 'accepted' && chatRoom ? (
          <TouchableOpacity
            style={styles.chatButton}
            onPress={() => router.push(`/company/chats/${chatRoom.id}` as any)}
            activeOpacity={0.75}
          >
            <MessageCircle color={colors.white} size={16} strokeWidth={2} />
            <Text style={styles.chatButtonText}>Open chat</Text>
          </TouchableOpacity>
        ) : null}

        {/* ── Withdraw (pending only, admin/recruiter only) ── */}
        {req.status === 'pending' && canSendDirectOffers(companyMemberRole) ? (
          <TouchableOpacity
            style={[styles.withdrawButton, withdrawing && styles.disabled]}
            onPress={handleWithdraw}
            disabled={withdrawing}
            activeOpacity={0.75}
          >
            {withdrawing ? (
              <ActivityIndicator color={companyUi.red} size="small" />
            ) : (
              <XCircle color={companyUi.red} size={15} strokeWidth={2} />
            )}
            <Text style={styles.withdrawButtonText}>Withdraw offer</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </CompanyScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  notFound: { flex: 1, justifyContent: 'center', padding: spacing.md },
  sectionCard: { gap: spacing.md, marginBottom: spacing.md },
  deletedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  deletedCopy: { flex: 1, minWidth: 0, gap: 4 },
  deletedTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.textMuted,
  },
  deletedSub: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: companyUi.text },
  sectionSub: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '500', color: companyUi.textSoft },
  messageBlock: { borderLeftWidth: 3, borderLeftColor: companyUi.border, paddingLeft: spacing.sm },
  messageLabel: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: companyUi.textMuted, marginBottom: 4 },
  messageText: { fontSize: 13, lineHeight: 19, fontWeight: '500', color: companyUi.textSoft },
  textLink: { minHeight: 34, alignSelf: 'flex-start', justifyContent: 'center' },
  textLinkText: { fontSize: 13, fontWeight: '700', color: companyUi.accent },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  profileAvatar: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  profileInfo: { flex: 1, minWidth: 0 },
  profileName: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: companyUi.text },
  profileSub: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '500', color: companyUi.textSoft },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
  },
  docInfo: { flex: 1, minWidth: 0 },
  docName: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: companyUi.text },
  docMeta: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '500', color: companyUi.textMuted },
  docActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 0 },
  viewDocBtn: {
    width: 32, height: 32, borderRadius: 10,
    borderWidth: 1, borderColor: companyUi.accent + '44',
    backgroundColor: companyUi.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { fontSize: 13, lineHeight: 19, fontWeight: '500', color: companyUi.textSoft },
  lockedPanel: {
    minHeight: 68, borderRadius: 16, borderWidth: 1,
    borderColor: '#FDE68A', backgroundColor: companyUi.amberSoft,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
  },
  lockedText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: companyUi.amber },
  chatButton: {
    minHeight: 48, borderRadius: 16, backgroundColor: companyUi.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, marginBottom: spacing.md,
  },
  chatButtonText: { fontSize: 14, fontWeight: '700', color: colors.white },
  withdrawButton: {
    minHeight: 44, borderRadius: 16, borderWidth: 1, borderColor: '#FECACA',
    backgroundColor: companyUi.surface,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, marginBottom: spacing.md,
  },
  withdrawButtonText: { fontSize: 14, fontWeight: '700', color: companyUi.red },
  disabled: { opacity: 0.6 },
});
