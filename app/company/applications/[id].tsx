import React, { useState, useCallback, useMemo, useRef } from 'react';
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
  Modal,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  BriefcaseBusiness,
  CheckCircle,
  ClipboardCheck,
  Download,
  FileCheck,
  Lock,
  MessageCircle,
  Unlock,
  UserRound,
  XCircle,
} from 'lucide-react-native';
import { getDocumentSignedUrl, openDocumentPreWindow, openDocumentUrl } from '../../../src/lib/documentStorage';
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
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { getMatchScoreWeights, getMatchDisplayLabel, ineligibilityReasonText, matchPair, PairMatch } from '../../../src/utils/matchingV2';
import { visibleBreakdownRows } from '../../../src/utils/matchBreakdownRows';
import { isUnlocked, TechnicianView } from '../../../src/types/privacy';
import { useCompanySession } from '../../../src/state/SessionContext';
import { canReviewApplications } from '../../../src/utils/companyPermissionsV2';
import { OfferApplication } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';
import { MatchScore } from '../../../src/types/matching';
import { Document } from '../../../src/types/document';
import { ChatRoom } from '../../../src/types/chat';
import { technicianTypeLabels } from '../../../src/constants/technicianTypes';
import { credentialLabel } from '../../../src/constants/licenses';
import { notify, confirmAction } from '../../../src/utils/platformAlert';
import { ViewTechnicianProfileButton } from '../../../src/components/company/ViewTechnicianProfileButton';

const DOC_TYPE_LABELS: Record<string, string> = {
  license: 'License',
  medical: 'Medical',
  id: 'ID',
  training: 'Training',
  resume: 'Resume',
  other: 'Other',
};

function scoreColor(total: number): string {
  if (total >= 80) return companyUi.green;
  if (total >= 60) return companyUi.blue;
  if (total >= 40) return companyUi.amber;
  return companyUi.textMuted;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusInfo(status: string): { label: string; tone: 'success' | 'warning' | 'error' | 'muted' } {
  if (status === 'pending') return { label: 'Pending review', tone: 'warning' };
  if (status === 'accepted') return { label: 'Accepted', tone: 'success' };
  if (status === 'rejected') return { label: 'Rejected', tone: 'error' };
  if (status === 'withdrawn') return { label: 'Withdrawn', tone: 'muted' };
  if (status === 'expired') return { label: 'Expired', tone: 'muted' };
  return { label: status, tone: 'muted' };
}

export default function ApplicationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;

  const [app, setApp] = useState<OfferApplication | null>(null);
  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  const [techView, setTechView] = useState<TechnicianView | null>(null);
  // Paso 5b: el par entero, no sólo el score. Un par que el filtro saca llega
  // como { eligible: false } y se pinta como tal, con su motivo.
  const [match, setMatch] = useState<PairMatch | null>(null);
  const score: MatchScore | null = match?.eligible ? match.score : null;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [confirmAction, setConfirmAction] = useState<'accept' | 'reject' | null>(null);
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

  // Real per-offer denominators — never hardcoded (see
  // app/company/offers/[id].tsx / getMatchScoreWeights).
  const weights = useMemo(() => (offer ? getMatchScoreWeights(offer) : null), [offer]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    setRefreshing(false);
  }

  function handleAccept() {
    if (!app || !id) return;
    setActionError(null);
    setConfirmAction('accept');
  }

  function handleReject() {
    if (!app || !id) return;
    setActionError(null);
    setConfirmAction('reject');
  }

  async function handleViewDoc(docId: string, storagePath: string) {
    // Must be called synchronously before any await — iOS Safari blocks window.open() after async gaps.
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

  async function doConfirmAction() {
    if (!id || !confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    setActioning(true);
    setActionError(null);
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

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.blue} role="company" />
      </>
    );
  }

  if (!app || !offer) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.notFound}>
          <EmptyPanel title="Application not found" subtitle="This application is no longer available." />
        </View>
      </CompanyScreen>
    );
  }

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
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[companyStyles.content, isWide && companyStyles.contentWide]}
          showsVerticalScrollIndicator={false}
        >
          <CompanyPageHeader
            eyebrow="Application review"
            title={offer.title}
            subtitle={`Applied ${formatDate(app.createdAt)}`}
            onBack={() => router.back()}
            right={<CompanyBadge label={statusInfo(app.status).label} tone={statusInfo(app.status).tone} />}
          />
          <CompanyCard style={styles.sectionCard}>
            <View style={styles.deletedRow}>
              <IconBox icon={UserRound} color={companyUi.textMuted} backgroundColor={companyUi.surfaceSoft} />
              <View style={styles.deletedCopy}>
                <Text style={styles.deletedTitle}>[Deleted user]</Text>
                <Text style={styles.deletedSub}>
                  This technician&apos;s account has been deleted. The application record is kept for your history, but
                  identity, documents, and messaging are no longer available.
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
  const accent = score ? scoreColor(score.total) : companyUi.textMuted;
  const appStatus = statusInfo(app.status);

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
          eyebrow="Application review"
          title={offer.title}
          subtitle={`Applied ${formatDate(app.createdAt)}`}
          onBack={() => router.back()}
          right={<CompanyBadge label={appStatus.label} tone={appStatus.tone} />}
        />

        <CompanyCard style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <IconBox icon={ClipboardCheck} color={accent} backgroundColor={companyUi.blueSoft} />
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>Application overview</Text>
              <Text style={styles.sectionSub}>Review the fit, privacy state and action status.</Text>
            </View>
          </View>
          {score && offer ? (
            <InlineScore
              score={score.total}
              quality={getMatchDisplayLabel(offer, score)}
              context="match for this offer"
              notEligible={score.blockers.length > 0}
            />
          ) : null}
          {match && !match.eligible ? (
            <InlineScore
              score={0}
              quality=""
              context=""
              notEligible
              notEligibleReason={ineligibilityReasonText(match.reason)}
            />
          ) : null}
          {app.coverNote ? (
            <View style={styles.coverNote}>
              <Text style={styles.coverNoteLabel}>Cover note</Text>
              <Text style={styles.coverNoteText}>{app.coverNote}</Text>
            </View>
          ) : null}
        </CompanyCard>

        <CompanyCard style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <IconBox icon={BriefcaseBusiness} color={companyUi.accent} backgroundColor={companyUi.accentSoft} />
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>Offer summary</Text>
              <Text style={styles.sectionSub}>{offer.locationCity}, {offer.locationCountry}</Text>
            </View>
          </View>
          <InfoRow label="Status" value={offer.status} />
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

        {techView ? (
          <CompanyCard style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <IconBox icon={unlocked ? Unlock : Lock} color={unlocked ? companyUi.green : companyUi.amber} backgroundColor={unlocked ? companyUi.greenSoft : companyUi.amberSoft} />
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>{unlocked ? 'Identity unlocked' : 'Identity locked until accepted'}</Text>
                <Text style={styles.sectionSub}>
                  {unlocked ? 'Private contact details and admin-verified documents are available.' : 'Only privacy-safe technician data is visible before acceptance.'}
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
                    {/* Enlaces profesionales del tecnico. Van DENTRO de la rama
                        `unlocked`, junto al email y el telefono: son campo
                        privado y comparten exactamente su gate. */}
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
              <CompanyBadge label={techView.verificationStatus} tone={techView.verificationStatus === 'verified' ? 'success' : 'warning'} small />
            </View>

            {unlocked ? (
              <ViewTechnicianProfileButton technicianId={techView.id} fullWidth />
            ) : null}

            {techView.licenses.length > 0 ? (
              <View style={styles.chipBlock}>
                <Text style={styles.chipBlockLabel}>Licenses</Text>
                <View style={styles.chipRow}>{techView.licenses.map((l) => <CompanyChip key={`${l.authority}-${l.licenseCode}`} label={credentialLabel(l.authority, l.licenseCode)} />)}</View>
              </View>
            ) : null}
          </CompanyCard>
        ) : null}

        {score ? (
          <CompanyCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Match breakdown</Text>
            {visibleBreakdownRows(weights).map((row) => (
              <BreakdownRow key={row.key} label={row.label} value={score.breakdown[row.key]} max={row.max} />
            ))}
            <MatchExplanation score={score} hideBreakdown displayLabel={offer ? getMatchDisplayLabel(offer, score) : undefined} />
          </CompanyCard>
        ) : null}

        <CompanyCard style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <IconBox icon={FileCheck} color={unlocked ? companyUi.green : companyUi.amber} backgroundColor={unlocked ? companyUi.greenSoft : companyUi.amberSoft} />
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>Documents</Text>
              <Text style={styles.sectionSub}>{unlocked ? 'Admin-verified documents only.' : 'Locked until this application is accepted.'}</Text>
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
                      {doc.expiresAt ? ` - Expires ${formatDate(doc.expiresAt)}` : ''}
                    </Text>
                  </View>
                  <View style={styles.docActions}>
                    <CompanyBadge label={doc.status} tone={doc.status === 'verified' ? 'success' : doc.status === 'pending' ? 'warning' : 'error'} small />
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
                {app.status === 'rejected'
                  ? 'Documents remain locked for rejected applications.'
                  : 'Accept this application to unlock documents and identity.'}
              </Text>
            </View>
          )}
        </CompanyCard>

        {actionError ? (
          <CompanyCard style={styles.errorCard}>
            <Text style={styles.errorText}>{actionError}</Text>
          </CompanyCard>
        ) : null}

        {app.status === 'pending' && canReviewApplications(companyMemberRole) ? (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.rejectButton, actioning && styles.disabled]}
              onPress={handleReject}
              disabled={actioning}
              activeOpacity={0.75}
            >
              {actioning ? <ActivityIndicator color={companyUi.red} size="small" /> : <XCircle color={companyUi.red} size={16} strokeWidth={2} />}
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.acceptButton, actioning && styles.disabled]}
              onPress={handleAccept}
              disabled={actioning}
              activeOpacity={0.75}
            >
              {actioning ? <ActivityIndicator color={colors.white} size="small" /> : <CheckCircle color={colors.white} size={16} strokeWidth={2} />}
              <Text style={styles.acceptButtonText}>Accept application</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {app.status === 'pending' && !canReviewApplications(companyMemberRole) ? (
          <CompanyCard style={styles.noteCard}>
            <Text style={styles.noteText}>Viewer role cannot accept or reject applications.</Text>
          </CompanyCard>
        ) : null}

        {app.status === 'accepted' ? (
          <CompanyCard style={styles.acceptedCard}>
            <View style={styles.sectionHeader}>
              <IconBox icon={CheckCircle} color={companyUi.green} backgroundColor={companyUi.greenSoft} />
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Application accepted</Text>
                <Text style={styles.sectionSub}>Identity unlocked. Admin-verified documents are available. Chat is open for direct coordination.</Text>
              </View>
            </View>
            {chatRoom ? (
              <TouchableOpacity
                style={styles.chatButton}
                onPress={() => router.push(`/company/chats/${chatRoom.id}` as any)}
                activeOpacity={0.75}
              >
                <MessageCircle color={colors.white} size={16} strokeWidth={2} />
                <Text style={styles.acceptButtonText}>Open chat</Text>
              </TouchableOpacity>
            ) : null}
          </CompanyCard>
        ) : null}
      </ScrollView>

      <Modal
        visible={confirmAction !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmAction(null)}
      >
        <View style={modalStyles.overlay}>
          <CompanyCard style={modalStyles.card}>
            <Text style={modalStyles.title}>
              {confirmAction === 'accept' ? 'Accept application?' : 'Reject application?'}
            </Text>
            <Text style={modalStyles.body}>
              {confirmAction === 'accept'
                ? 'This will unlock the technician identity and admin-verified documents, then open chat access.'
                : 'The technician will remain locked and no chat will be created.'}
            </Text>
            <TouchableOpacity
              style={[modalStyles.confirmButton, confirmAction === 'reject' && modalStyles.destructiveButton]}
              onPress={doConfirmAction}
              activeOpacity={0.75}
            >
              <Text style={modalStyles.confirmText}>
                {confirmAction === 'accept' ? 'Confirm accept' : 'Confirm reject'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={modalStyles.cancelButton}
              onPress={() => setConfirmAction(null)}
              activeOpacity={0.75}
            >
              <Text style={modalStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </CompanyCard>
        </View>
      </Modal>
    </CompanyScreen>
  );
}

function BreakdownRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <View style={styles.breakdownRow}>
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
  sectionCard: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  sectionCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.text,
  },
  sectionSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  coverNote: {
    borderLeftWidth: 3,
    borderLeftColor: companyUi.border,
    paddingLeft: spacing.sm,
  },
  coverNoteLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: companyUi.textMuted,
    marginBottom: 4,
  },
  coverNoteText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  textLink: {
    minHeight: 34,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  textLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: companyUi.accent,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: companyUi.text,
  },
  profileSub: {
    marginTop: 2,
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  breakdownRow: {
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
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
  },
  docInfo: {
    flex: 1,
    minWidth: 0,
  },
  docActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  viewDocBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: companyUi.accent + '44',
    backgroundColor: companyUi.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: companyUi.text,
  },
  docMeta: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    color: companyUi.textMuted,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  lockedPanel: {
    minHeight: 68,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: companyUi.amberSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  lockedText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: companyUi.amber,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rejectButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: companyUi.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  acceptButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: companyUi.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  chatButton: {
    minHeight: 44,
    borderRadius: 15,
    backgroundColor: companyUi.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  disabled: {
    opacity: 0.6,
  },
  rejectButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: companyUi.red,
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
  acceptedCard: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  noteCard: {
    marginBottom: spacing.md,
    backgroundColor: companyUi.amberSoft,
    borderColor: '#FDE68A',
  },
  noteText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: companyUi.amber,
    textAlign: 'center',
  },
  errorCard: {
    marginBottom: spacing.md,
    backgroundColor: companyUi.redSoft,
    borderColor: '#FECACA',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: companyUi.red,
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
  card: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.md,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: companyUi.text,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  confirmButton: {
    minHeight: 44,
    borderRadius: 15,
    backgroundColor: companyUi.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveButton: {
    backgroundColor: companyUi.red,
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
  cancelButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: companyUi.textMuted,
  },
});
