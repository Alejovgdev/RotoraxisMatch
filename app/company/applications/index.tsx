import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { ClipboardCheck, Clock, UserRound } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { MatchBadge } from '../../../src/components/MatchBadge';
import {
  ActivityDot,
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
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { matchPairs, PairMatch } from '../../../src/utils/matchingV2';
import { getSafeTechnicianPreview } from '../../../src/utils/privacyV2';
import { useCompanySession } from '../../../src/state/SessionContext';
import { OfferApplication } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';
import { TechnicianWithRelations } from '../../../src/types/technician';
import { SafeTechnicianPreview } from '../../../src/types/privacy';
import { technicianTypeLabels } from '../../../src/constants/technicianTypes';
import { ViewTechnicianProfileButton } from '../../../src/components/company/ViewTechnicianProfileButton';

type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected';

type AppEntry = {
  app: OfferApplication;
  offer: OfferWithRequirements | null;
  tech: TechnicianWithRelations | null;
  safePreview: SafeTechnicianPreview | null;
  // null = sin puntuar (técnico borrado, oferta desaparecida o catálogos sin
  // cargar). Un par que el filtro saca llega como { eligible: false }: la
  // candidatura existe y se enseña, sin porcentaje.
  match: PairMatch | null;
};

function scoreColor(total: number): string {
  if (total >= 80) return companyUi.green;
  if (total >= 60) return companyUi.blue;
  if (total >= 40) return companyUi.amber;
  return companyUi.textMuted;
}

function statusInfo(status: string): { label: string; tone: 'success' | 'warning' | 'error' | 'muted' } {
  switch (status) {
    case 'pending': return { label: 'Needs review', tone: 'warning' };
    case 'accepted': return { label: 'Accepted', tone: 'success' };
    case 'rejected': return { label: 'Closed', tone: 'error' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'muted' };
    case 'expired': return { label: 'Expired', tone: 'muted' };
    default: return { label: status, tone: 'muted' };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ApplicationsListScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;

  const [entries, setEntries] = useState<AppEntry[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = useCallback(async (signal: { active: boolean }) => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!companyId) return;

    const apps = await offerApplicationRepository.getForCompany(companyId);

    const allOffers = await offerRepository.getAllWithRequirements();
    const offersMap: Record<string, OfferWithRequirements> = {};
    allOffers.forEach((o) => { offersMap[o.id] = o; });

    const uniqueTechIds = [...new Set(apps.map((a) => a.technicianId))];
    const techResults = await Promise.all(uniqueTechIds.map((id) => technicianRepositoryV2.getWithRelations(id)));
    const techsMap: Record<string, TechnicianWithRelations> = {};
    uniqueTechIds.forEach((id, i) => { if (techResults[i]) techsMap[id] = techResults[i]!; });

    // Paso 5b: los pares se puntúan en el servicio, con los dos catálogos y el
    // filtro de elegibilidad — nunca con calculateOfferTechnicianMatch a pelo.
    // El servicio ESPERA a sus catálogos, así que aquí ya no hay índice vacío
    // que vigilar. Si no cargan, la lista sale sin porcentajes: un score
    // erróneo es peor que ningún score, y perder las candidaturas, peor aún.
    const scorable = apps.filter((app) => offersMap[app.offerId] && techsMap[app.technicianId]);
    const pairResults = await matchPairs(
      scorable.map((app) => ({ offer: offersMap[app.offerId], technician: techsMap[app.technicianId] })),
    ).catch(() => null);
    const matchByAppId = new Map(scorable.map((app, i) => [app.id, pairResults?.[i] ?? null]));

    const built: AppEntry[] = apps.map((app) => {
      const offer = offersMap[app.offerId] ?? null;
      const tech = techsMap[app.technicianId] ?? null;
      return {
        app,
        offer,
        tech,
        safePreview: tech ? getSafeTechnicianPreview(tech) : null,
        match: matchByAppId.get(app.id) ?? null,
      };
    });

    const ids = await activityRepository.getUnreadEntityIds(
      'company',
      companyId,
      ['application_received'],
    );

    built.sort((a, b) => {
      const aUnread = ids.has(a.app.id) ? 0 : 1;
      const bUnread = ids.has(b.app.id) ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      const order = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired'];
      const ai = order.indexOf(a.app.status);
      const bi = order.indexOf(b.app.status);
      if (ai !== bi) return ai - bi;
      return new Date(b.app.createdAt).getTime() - new Date(a.app.createdAt).getTime();
    });

    if (!signal.active) return;
    setUnreadIds(ids);
    setEntries(built);
  }, [companyId]);

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

  const filtered = statusFilter === 'all'
    ? entries
    : entries.filter((e) => e.app.status === statusFilter);

  const pendingCount = entries.filter((e) => e.app.status === 'pending').length;

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.blue} role="company" />
      </>
    );
  }

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
          eyebrow="Candidate review"
          title="Applications"
          subtitle={`${entries.length} total - ${pendingCount} pending review`}
          onBack={goBack}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
        >
          {(['all', 'pending', 'accepted', 'rejected'] as StatusFilter[]).map((f) => (
            <CompanyChip
              key={f}
              label={`${f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}${f === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}`}
              selected={statusFilter === f}
              onPress={() => setStatusFilter(f)}
            />
          ))}
        </ScrollView>

        {filtered.length === 0 ? (
          <EmptyPanel
            title={entries.length === 0 ? 'No applications yet' : 'No applications in this category'}
            subtitle={entries.length === 0
              ? 'When technicians apply to your offers, their applications will appear here.'
              : 'Try switching to All to see every application.'}
          />
        ) : null}

        {filtered.map(({ app, offer, tech, safePreview, match }) => {
          const status = statusInfo(app.status);
          const score = match?.eligible ? match.score : null;
          const accent = score ? scoreColor(score.total) : companyUi.textMuted;
          const isUnread = unreadIds.has(app.id);
          // A technician account deleted after applying resolves to null
          // here (technician_public_view excludes non-active profiles,
          // migration 024) — the application itself is real history and
          // stays in the list, just visibly deactivated with no live
          // technician data to show.
          const isDeletedTechnician = !tech;

          return (
            <TouchableOpacity
              key={app.id}
              onPress={() => router.push(`/company/applications/${app.id}` as any)}
              activeOpacity={0.75}
            >
              <CompanyCard style={[styles.card, { borderLeftColor: accent }, isUnread && styles.cardUnread, isDeletedTechnician && styles.cardDeactivated]}>
                {isUnread ? <ActivityDot /> : null}
                <View style={styles.cardTop}>
                  <IconBox icon={ClipboardCheck} color={accent} backgroundColor={score && score.total >= 60 ? companyUi.blueSoft : companyUi.surfaceSoft} />
                  <View style={styles.cardTitleBlock}>
                    <Text style={styles.offerTitle} numberOfLines={2}>{offer?.title ?? 'Unknown offer'}</Text>
                    {safePreview ? (
                      <Text style={styles.applicantLine} numberOfLines={1}>
                        {safePreview.anonymousCode} - {technicianTypeLabels(safePreview.technicianTypes)}
                      </Text>
                    ) : isDeletedTechnician ? (
                      <Text style={styles.deletedLine} numberOfLines={1}>[Deleted user]</Text>
                    ) : null}
                  </View>
                  {score ? <MatchBadge score={score.total} context="match for this offer" notEligible={score.blockers.length > 0} /> : null}
                  {match && !match.eligible ? <MatchBadge score={0} context="for this offer" notEligible /> : null}
                </View>

                {safePreview ? (
                  <View style={styles.previewRow}>
                    <CompanyBadge label={`${safePreview.city}, ${safePreview.country}`} tone="muted" small />
                    <CompanyBadge label={safePreview.verificationStatus} tone={safePreview.verificationStatus === 'verified' ? 'success' : 'warning'} small />
                  </View>
                ) : null}

                {app.coverNote ? (
                  <View style={styles.coverNote}>
                    <Text style={styles.coverNoteText} numberOfLines={2}>{app.coverNote}</Text>
                  </View>
                ) : null}

                <View style={styles.cardBottom}>
                  <CompanyBadge label={status.label} tone={status.tone} small />
                  <View style={styles.dateWrap}>
                    <Clock color={companyUi.textMuted} size={13} strokeWidth={2} />
                    <Text style={styles.dateText}>{formatDate(app.createdAt)}</Text>
                  </View>
                  {isDeletedTechnician ? (
                    <View style={[styles.reviewButton, styles.reviewButtonDeactivated]}>
                      <Text style={styles.reviewButtonTextDeactivated}>View</Text>
                    </View>
                  ) : (
                    <View style={styles.reviewButton}>
                      <UserRound color={colors.white} size={14} strokeWidth={2} />
                      <Text style={styles.reviewButtonText}>Review</Text>
                    </View>
                  )}
                </View>
                {app.status === 'accepted' && !isDeletedTechnician ? (
                  <ViewTechnicianProfileButton technicianId={app.technicianId} fullWidth />
                ) : null}
              </CompanyCard>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </CompanyScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  filterRow: {
    marginBottom: spacing.md,
    flexGrow: 0,
  },
  filterContent: {
    gap: spacing.xs,
    paddingRight: spacing.lg,
  },
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 4,
  },
  cardUnread: {
    borderColor: '#FECACA',
  },
  cardDeactivated: {
    opacity: 0.6,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  offerTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.text,
  },
  applicantLine: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: companyUi.textSoft,
  },
  deletedLine: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    fontStyle: 'italic',
    color: companyUi.textMuted,
  },
  previewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  coverNote: {
    borderLeftWidth: 3,
    borderLeftColor: companyUi.border,
    paddingLeft: spacing.sm,
  },
  coverNoteText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
  },
  dateWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: companyUi.textMuted,
  },
  reviewButton: {
    minHeight: 34,
    borderRadius: 13,
    paddingHorizontal: spacing.sm,
    backgroundColor: companyUi.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  reviewButtonDeactivated: {
    backgroundColor: companyUi.surfaceSoft,
    borderWidth: 1,
    borderColor: companyUi.borderSoft,
  },
  reviewButtonTextDeactivated: {
    fontSize: 12,
    fontWeight: '700',
    color: companyUi.textMuted,
  },
  reviewButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.white,
  },
});
