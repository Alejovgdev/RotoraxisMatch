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
import { MessageCircle, Send } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import {
  ActivityDot,
  CompanyBadge,
  CompanyCard,
  CompanyChip,
  CompanyPageHeader,
  CompanyScreen,
  EmptyPanel,
  InitialAvatar,
  companyStyles,
  companyUi,
} from '../../../src/components/company/CompanyUI';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { useCompanySession } from '../../../src/state/SessionContext';
import { supabase } from '../../../src/lib/supabase';
import type { OfferRequestStatus } from '../../../src/types/enums';
import { ViewTechnicianProfileButton } from '../../../src/components/company/ViewTechnicianProfileButton';

type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected';

type DirectOfferRow = {
  id: string;
  technicianId: string;
  offerId: string | null;
  status: OfferRequestStatus;
  identityRevealed: boolean;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  offerTitle: string | null;
  anonymousCode: string | null;
  displayName: string | null;
  chatRoomId: string | null;
};

function statusInfo(status: OfferRequestStatus): {
  label: string;
  tone: 'success' | 'warning' | 'error' | 'muted';
} {
  switch (status) {
    case 'pending':   return { label: 'Awaiting response', tone: 'warning' };
    case 'accepted':  return { label: 'Accepted', tone: 'success' };
    case 'rejected':  return { label: 'Declined', tone: 'error' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'muted' };
    case 'expired':   return { label: 'Expired', tone: 'muted' };
    default:          return { label: status, tone: 'muted' };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function DirectOffersScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;

  const [rows, setRows] = useState<DirectOfferRow[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!companyId) return;

    if (!companyId) return;

    // 1. Fetch offer_requests for this company
    const { data: requests, error } = await supabase
      .from('offer_requests')
      .select('id, technician_id, offer_id, status, identity_revealed, message, created_at, updated_at')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false });

    if (error || !requests?.length) {
      setRows([]);
      setUnreadIds(new Set());
      return;
    }

    // 2. Fetch offer titles (batch)
    const offerIds = [...new Set(requests.map((r) => r.offer_id).filter(Boolean))] as string[];
    const offersMap: Record<string, string> = {};
    if (offerIds.length) {
      const { data: offersData } = await supabase
        .from('offers')
        .select('id, title')
        .in('id', offerIds);
      (offersData ?? []).forEach((o: any) => { offersMap[o.id] = o.title; });
    }

    // 3. Fetch technician info via technician_public_view (respects privacy gate)
    const techIds = [...new Set(requests.map((r) => r.technician_id))] as string[];
    const techMap: Record<string, { anonymousCode: string; firstName?: string; lastName?: string }> = {};
    if (techIds.length) {
      const { data: techData } = await supabase
        .from('technician_public_view')
        .select('id, anonymous_code, first_name, last_name')
        .in('id', techIds);
      (techData ?? []).forEach((t: any) => {
        techMap[t.id] = {
          anonymousCode: t.anonymous_code,
          firstName: t.first_name ?? undefined,
          lastName: t.last_name ?? undefined,
        };
      });
    }

    // 4. Fetch chat rooms for accepted offers
    const chatMap: Record<string, string> = {};
    const { data: chatRooms } = await supabase
      .from('chat_rooms')
      .select('id, offer_request_id')
      .eq('company_id', companyId)
      .not('offer_request_id', 'is', null);
    (chatRooms ?? []).forEach((cr: any) => {
      if (cr.offer_request_id) chatMap[cr.offer_request_id] = cr.id;
    });

    // 5. Get unread IDs (direct_offer_accepted + direct_offer_rejected events)
    const unread = await activityRepository.getUnreadEntityIds(
      'company',
      companyId,
      ['direct_offer_accepted', 'direct_offer_rejected'],
    );

    // 6. Build rows
    const built: DirectOfferRow[] = requests.map((r: any) => {
      const tech = techMap[r.technician_id];
      const displayName =
        r.identity_revealed && tech?.firstName
          ? `${tech.firstName} ${tech.lastName ?? ''}`.trim()
          : null;
      return {
        id: r.id,
        technicianId: r.technician_id,
        offerId: r.offer_id ?? null,
        status: r.status as OfferRequestStatus,
        identityRevealed: Boolean(r.identity_revealed),
        message: r.message ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        offerTitle: r.offer_id ? (offersMap[r.offer_id] ?? null) : null,
        anonymousCode: tech?.anonymousCode ?? null,
        displayName,
        chatRoomId: chatMap[r.id] ?? null,
      };
    });

    // Unread-first, then by updatedAt desc
    built.sort((a, b) => {
      const aUnread = unread.has(a.id) ? 0 : 1;
      const bUnread = unread.has(b.id) ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    setRows(built);
    setUnreadIds(unread);

    // Mark all unread direct-offer response events as read
    unread.forEach((entityId) => {
      activityRepository.markRead('company', companyId, entityId);
    });
  }, [companyId]);

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
    ? rows
    : rows.filter((r) => r.status === statusFilter);

  const pendingCount   = rows.filter((r) => r.status === 'pending').length;
  const acceptedCount  = rows.filter((r) => r.status === 'accepted').length;
  const unreadCount    = rows.filter((r) => unreadIds.has(r.id)).length;

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
          eyebrow="Talent outreach"
          title="Sent Direct Offers"
          subtitle="Offers you have sent directly to technicians."
          onBack={goBack}
        />

        {/* Summary metrics */}
        <CompanyCard style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <SummaryPill value={rows.length}   label="Sent"     color={companyUi.accent} />
            <SummaryPill value={pendingCount}  label="Pending"  color={companyUi.amber} />
            <SummaryPill value={acceptedCount} label="Accepted" color={companyUi.green} />
            {unreadCount > 0 ? (
              <SummaryPill value={unreadCount} label="New" color={companyUi.red} />
            ) : null}
          </View>
        </CompanyCard>

        {/* Status filter */}
        <View style={styles.filterRow}>
          {(['all', 'pending', 'accepted', 'rejected'] as StatusFilter[]).map((f) => (
            <CompanyChip
              key={f}
              label={f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              selected={statusFilter === f}
              onPress={() => setStatusFilter(f)}
            />
          ))}
        </View>

        {/* List */}
        {filtered.length === 0 ? (
          <EmptyPanel
            title={statusFilter === 'all' ? 'No direct offers sent yet' : `No ${statusFilter} offers`}
            subtitle={
              statusFilter === 'all'
                ? 'Send direct offers from the Search Technicians screen by selecting an offer and tapping a technician card.'
                : `No offers with status "${statusFilter}" found.`
            }
          />
        ) : (
          <View style={styles.list}>
            {filtered.map((row) => (
              <DirectOfferCard
                key={row.id}
                row={row}
                isUnread={unreadIds.has(row.id)}
                onPress={() => router.push(`/company/direct-offers/${row.id}` as any)}
                onOpenChat={
                  row.chatRoomId
                    ? () => router.push(`/company/chats/${row.chatRoomId}` as any)
                    : undefined
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </CompanyScreen>
  );
}

function DirectOfferCard({
  row,
  isUnread,
  onPress,
  onOpenChat,
}: {
  row: DirectOfferRow;
  isUnread: boolean;
  onPress: () => void;
  onOpenChat?: () => void;
}) {
  const { label, tone } = statusInfo(row.status);
  const techLabel = row.displayName ?? row.anonymousCode ?? '—';
  const avatarLabel = row.displayName ?? row.anonymousCode ?? '?';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88}>
      <CompanyCard style={[styles.card, isUnread && styles.cardUnread]}>
        {isUnread ? <ActivityDot /> : null}

        <View style={styles.cardTop}>
          <InitialAvatar label={avatarLabel} size={42} color={companyUi.accent} />
          <View style={styles.cardInfo}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.techName} numberOfLines={1}>{techLabel}</Text>
              <CompanyBadge label={label} tone={tone} small />
            </View>
            {row.offerTitle ? (
              <Text style={styles.offerTitle} numberOfLines={1}>{row.offerTitle}</Text>
            ) : null}
            <Text style={styles.dateMeta}>
              Sent {formatDate(row.createdAt)}
              {row.status !== 'pending' ? ` · Updated ${formatDate(row.updatedAt)}` : ''}
            </Text>
          </View>
        </View>

        {row.identityRevealed ? (
          <View style={styles.revealedBanner}>
            <Text style={styles.revealedText}>Identity revealed · Contact details available</Text>
          </View>
        ) : null}

        {row.identityRevealed || onOpenChat ? (
          <View style={styles.cardActions}>
            {row.identityRevealed ? (
              <ViewTechnicianProfileButton technicianId={row.technicianId} style={styles.cardAction} />
            ) : null}
            {onOpenChat ? (
              <TouchableOpacity
                style={[styles.chatButton, styles.cardAction]}
                onPress={(e) => { e.stopPropagation?.(); onOpenChat(); }}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Open chat"
              >
                <MessageCircle color={companyUi.surface} size={15} strokeWidth={2.2} />
                <Text style={styles.chatButtonText}>Open chat</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </CompanyCard>
    </TouchableOpacity>
  );
}

function SummaryPill({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <View style={styles.summaryPill}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  summaryCard: { gap: spacing.sm },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  summaryPill: {
    flex: 1,
    borderWidth: 1,
    borderColor: companyUi.borderSoft,
    backgroundColor: companyUi.surfaceSoft,
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: companyUi.textSoft,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    gap: spacing.sm,
    position: 'relative',
  },
  cardUnread: {
    borderColor: '#BAE6FD',
    backgroundColor: '#F0F9FF',
  },
  cardTop: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  techName: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.text,
  },
  offerTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: companyUi.accent,
  },
  dateMeta: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    color: companyUi.textMuted,
  },
  revealedBanner: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: companyUi.greenSoft,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  revealedText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: companyUi.green,
  },
  chatButton: {
    minHeight: 44,
    borderRadius: 13,
    backgroundColor: companyUi.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cardAction: {
    flex: 1,
    minWidth: 132,
  },
  chatButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: companyUi.surface,
  },
});
