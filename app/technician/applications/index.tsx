import React, { useState, useCallback } from 'react';
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
import { ClipboardCheck, MessageCircle } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import {
  ActivityDot,
  EmptyPanel,
  TechnicianBadge,
  TechnicianCard,
  TechnicianPageHeader,
  TechnicianScreen,
  techStyles,
  techUi,
} from '../../../src/components/technician/TechnicianUI';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { OfferApplication } from '../../../src/types/offerRequest';
import { Offer } from '../../../src/types/offer';
import { CompanyProfileView } from '../../../src/types/company';
import { ChatRoom } from '../../../src/types/chat';

type StatusFilter = 'all' | 'pending' | 'accepted' | 'closed';

type AppEntry = {
  app: OfferApplication;
  offer: Offer | null;
  company: CompanyProfileView | null;
  chatRoom: ChatRoom | null;
};

function appStatusInfo(status: string): { label: string; tone: 'success' | 'warning' | 'error' | 'muted' } {
  switch (status) {
    case 'pending':   return { label: 'Pending review', tone: 'warning' };
    case 'accepted':  return { label: 'Accepted', tone: 'success' };
    case 'rejected':  return { label: 'Not selected', tone: 'error' };
    case 'expired':   return { label: 'Expired', tone: 'muted' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'muted' };
    default:          return { label: status, tone: 'muted' };
  }
}

function offerStatusBadge(status: string): { label: string; tone: 'muted' | 'warning' } | null {
  if (status === 'published') return null; // no badge for normal state
  if (status === 'closed')  return { label: 'Offer closed', tone: 'muted' };
  if (status === 'expired') return { label: 'Offer expired', tone: 'muted' };
  if (status === 'draft')   return { label: 'Offer draft', tone: 'warning' };
  return null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ApplicationHistoryScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [entries, setEntries] = useState<AppEntry[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    const [apps, rooms, unreadEntityIds] = await Promise.all([
      offerApplicationRepository.getForTechnician(technicianId),
      chatRepository.getRoomsForTechnician(technicianId),
      activityRepository.getUnreadEntityIds('technician', technicianId, [
        'application_accepted',
        'application_rejected',
      ]),
    ]);

    const roomByAppId = new Map(
      rooms.filter((r) => r.offerApplicationId).map((r) => [r.offerApplicationId!, r]),
    );

    const uniqueOfferIds = [...new Set(apps.map((a) => a.offerId))];
    const uniqueCompanyIds = [...new Set(apps.map((a) => a.companyId))];

    const [offerResults, companyResults] = await Promise.all([
      Promise.all(uniqueOfferIds.map((id) => offerRepository.getById(id))),
      Promise.all(uniqueCompanyIds.map((id) => companyRepositoryV2.getById(id))),
    ]);

    const offersMap: Record<string, Offer> = {};
    uniqueOfferIds.forEach((id, i) => { if (offerResults[i]) offersMap[id] = offerResults[i]!; });

    const companiesMap: Record<string, CompanyProfileView> = {};
    uniqueCompanyIds.forEach((id, i) => { if (companyResults[i]) companiesMap[id] = companyResults[i]!; });

    const built: AppEntry[] = apps.map((app) => ({
      app,
      offer: offersMap[app.offerId] ?? null,
      company: companiesMap[app.companyId] ?? null,
      chatRoom: roomByAppId.get(app.id) ?? null,
    }));

    built.sort((a, b) => {
      const aUnread = unreadEntityIds.has(a.app.id) ? 0 : 1;
      const bUnread = unreadEntityIds.has(b.app.id) ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      const order = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired'];
      const ai = order.indexOf(a.app.status);
      const bi = order.indexOf(b.app.status);
      if (ai !== bi) return ai - bi;
      return new Date(b.app.createdAt).getTime() - new Date(a.app.createdAt).getTime();
    });

    setEntries(built);
    setUnreadIds(unreadEntityIds);
  }, [technicianId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      load().finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const filtered = statusFilter === 'all'
    ? entries
    : statusFilter === 'closed'
    ? entries.filter((e) => e.app.status === 'rejected' || e.app.status === 'withdrawn' || e.app.status === 'expired')
    : entries.filter((e) => e.app.status === statusFilter);

  const pendingCount = entries.filter((e) => e.app.status === 'pending').length;

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.technician} role="technician" />
      </>
    );
  }

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
          eyebrow="Application history"
          title="My Applications"
          subtitle={`${entries.length} application${entries.length !== 1 ? 's' : ''}${pendingCount > 0 ? ` · ${pendingCount} pending` : ''}`}
          onBack={goBack}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
        >
          {(['all', 'pending', 'accepted', 'closed'] as StatusFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, statusFilter === f && styles.filterChipActive]}
              onPress={() => setStatusFilter(f)}
              activeOpacity={0.75}
            >
              <Text style={[styles.filterChipText, statusFilter === f && styles.filterChipTextActive]}>
                {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : f === 'accepted' ? 'Accepted' : 'Closed'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {filtered.length === 0 && (
          <EmptyPanel
            title={statusFilter === 'all' ? 'No applications yet' : 'No applications in this category'}
            subtitle={statusFilter === 'all'
              ? 'Browse offers and apply to start your application history.'
              : 'Try a different filter.'}
          />
        )}

        {filtered.map(({ app, offer, company, chatRoom }) => {
          const status = appStatusInfo(app.status);
          const offerBadge = offer ? offerStatusBadge(offer.status) : null;
          const unread = unreadIds.has(app.id);

          return (
            <TechnicianCard key={app.id} style={[styles.card, unread && styles.cardUnread]}>
              {unread && <ActivityDot />}

              <View style={styles.cardTop}>
                <View style={styles.cardTitleBlock}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {offer?.title ?? 'Offer unavailable'}
                  </Text>
                  {company ? (
                    <Text style={styles.cardCompany} numberOfLines={1}>{company.name}</Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.badgeRow}>
                <TechnicianBadge label={status.label} tone={status.tone} small />
                {offerBadge ? (
                  <TechnicianBadge label={offerBadge.label} tone={offerBadge.tone} small />
                ) : null}
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaText}>Applied {formatDate(app.createdAt)}</Text>
                {offer ? (
                  <Text style={styles.metaText}>{offer.locationCity}, {offer.locationCountry}</Text>
                ) : null}
              </View>

              <View style={styles.cardFooter}>
                <TouchableOpacity
                  style={styles.viewButton}
                  onPress={() => router.push(`/technician/offers/${app.offerId}` as any)}
                  activeOpacity={0.75}
                >
                  <ClipboardCheck color={techUi.accent} size={14} strokeWidth={2.2} />
                  <Text style={styles.viewButtonText}>View offer</Text>
                </TouchableOpacity>
                {app.status === 'accepted' && chatRoom ? (
                  <TouchableOpacity
                    style={styles.chatButton}
                    onPress={() => router.push(`/technician/chats/${chatRoom.id}` as any)}
                    activeOpacity={0.75}
                  >
                    <MessageCircle color={colors.white} size={14} strokeWidth={2.2} />
                    <Text style={styles.chatButtonText}>Open chat</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </TechnicianCard>
          );
        })}
      </ScrollView>
    </TechnicianScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  filterRow: { marginBottom: spacing.sm },
  filterContent: { gap: spacing.xs, paddingHorizontal: 2, flexDirection: 'row' },
  filterChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: techUi.surfaceSoft,
    borderWidth: 1,
    borderColor: techUi.border,
  },
  filterChipActive: { backgroundColor: techUi.accent, borderColor: techUi.accent },
  filterChipText: { fontSize: 12, fontWeight: '600', color: techUi.textSoft },
  filterChipTextActive: { color: colors.white },
  card: { marginBottom: spacing.sm },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: techUi.accent },
  cardTop: { marginBottom: spacing.xs },
  cardTitleBlock: {},
  cardTitle: { fontSize: 14, fontWeight: '700', color: techUi.text, marginBottom: 2, lineHeight: 20 },
  cardCompany: { fontSize: 12, fontWeight: '500', color: techUi.textSoft },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.sm },
  metaText: { fontSize: 11, color: techUi.textMuted, fontWeight: '500' },
  cardFooter: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: techUi.accentSoft,
    borderWidth: 1,
    borderColor: `${techUi.accent}30`,
  },
  viewButtonText: { fontSize: 12, fontWeight: '700', color: techUi.accent },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: techUi.accent,
  },
  chatButtonText: { fontSize: 12, fontWeight: '700', color: colors.white },
});
