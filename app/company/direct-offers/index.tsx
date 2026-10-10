import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { isUnlocked } from '../../../src/types/privacy';
import { companyTechnicianName, companyTechnicianPhoto } from '../../../src/utils/companyTechnicianIdentity';
import { Search } from 'lucide-react-native';
import { colors } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { Avatar, Text } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import {
  AvatarDot,
  DesktopTitle,
  EmptyBlock,
  FilterChipRow,
  PageBar,
  PageBody,
  PageSubtitle,
  PillButton,
  RowList,
  StatusPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { useCompanySession } from '../../../src/state/SessionContext';
import { supabase } from '../../../src/lib/supabase';
import type { OfferRequestStatus } from '../../../src/types/enums';
import { relativeTime } from '../../../src/utils/companyHome';
import {
  directOfferStatusLook,
  isFinishedRelation,
  matchesRelationFilter,
  relationFilterCounts,
  type RelationFilter,
} from '../../../src/utils/companyStatus';

// Ofertas directas enviadas (rediseño, fase 3; maquetas W-Direct y
// W-D-Direct). La carga, el orden (lo nuevo primero) y el marcado como leído
// son los de antes; cambia el aspecto.

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
  photoPath?: string | null;
  chatRoomId: string | null;
};

const FILTER_LABELS: Record<RelationFilter, string> = {
  all: 'All',
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Declined',
};

export default function DirectOffersScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const wide = useIsWide();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;

  const [rows, setRows] = useState<DirectOfferRow[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RelationFilter>('all');

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
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
    const views = await Promise.all(techIds.map((id) => technicianRepositoryV2.getViewForCompany(id, companyId)));
    const techMap = new Map(techIds.map((id, i) => [id, views[i]]));

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
      const tech = techMap.get(r.technician_id);
      const identityRevealed = Boolean(tech && isUnlocked(tech));
      const displayName = identityRevealed ? companyTechnicianName(tech!) : null;
      return {
        id: r.id,
        technicianId: r.technician_id,
        offerId: r.offer_id ?? null,
        status: r.status as OfferRequestStatus,
        identityRevealed,
        message: r.message ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        offerTitle: r.offer_id ? (offersMap[r.offer_id] ?? null) : null,
        anonymousCode: tech?.anonymousCode ?? null,
        displayName,
        photoPath: companyTechnicianPhoto(tech ?? null),
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

  const filtered = rows.filter((r) => matchesRelationFilter(r.status, statusFilter));
  const counts = relationFilterCounts(rows.map((r) => r.status));
  const unreadCount = rows.filter((r) => unreadIds.has(r.id)).length;
  const subtitle = `Offers you sent directly to technicians${unreadCount > 0 ? ` · ${unreadCount} new` : ''}`;
  const findMore = () => router.navigate('/company/search' as any);

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="company" />
      </>
    );
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      {!wide ? (
        <>
          <PageBar title="Direct offers" large onBack={goBack} />
          <PageSubtitle>{subtitle}</PageSubtitle>
        </>
      ) : null}
      <PageBody
        wide={wide}
        gap={wide ? 18 : 12}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {wide ? (
          <DesktopTitle
            title="Direct offers"
            subtitle={subtitle}
            right={<PillButton label="Find more technicians" icon={Search} variant="accent" size="md" onPress={findMore} />}
          />
        ) : null}

        <FilterChipRow
          wide={wide}
          options={(['all', 'pending', 'accepted', 'rejected'] as RelationFilter[]).map((key) => ({
            key,
            label: FILTER_LABELS[key],
            count: counts[key],
          }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />

        {filtered.length === 0 ? (
          <EmptyBlock
            title={statusFilter === 'all' ? 'No direct offers sent yet' : `No ${FILTER_LABELS[statusFilter].toLowerCase()} offers`}
            text={
              statusFilter === 'all'
                ? 'Send direct offers from the Search Technicians screen by selecting an offer and tapping a technician card.'
                : `No offers with status "${FILTER_LABELS[statusFilter].toLowerCase()}" found.`
            }
          />
        ) : (
          <RowList wide={wide}>
            {filtered.map((row) => (
              <DirectOfferRowView
                key={row.id}
                row={row}
                wide={wide}
                isUnread={unreadIds.has(row.id)}
                onPress={() => router.push(`/company/direct-offers/${row.id}` as any)}
                onViewProfile={row.identityRevealed ? () => router.push(`/company/technician/${row.technicianId}` as any) : undefined}
                onOpenChat={row.chatRoomId ? () => router.push(`/company/chats/${row.chatRoomId}` as any) : undefined}
              />
            ))}
          </RowList>
        )}

        {!wide ? (
          <View style={styles.findMore}>
            <PillButton label="Find more technicians" icon={Search} variant="accent" size="md" onPress={findMore} />
          </View>
        ) : null}
      </PageBody>
    </CompanyScreen>
  );
}

function DirectOfferRowView({
  row,
  wide,
  isUnread,
  onPress,
  onViewProfile,
  onOpenChat,
}: {
  row: DirectOfferRow;
  wide: boolean;
  isUnread: boolean;
  onPress: () => void;
  onViewProfile?: () => void;
  onOpenChat?: () => void;
}) {
  const status = directOfferStatusLook(row.status);
  const techLabel = row.displayName ?? row.anonymousCode ?? '—';
  const faded = isFinishedRelation(row.status);
  const note = row.identityRevealed
    ? 'Identity revealed · Contact details available'
    : `Sent ${relativeTime(row.createdAt)}${row.status !== 'pending' ? ` · updated ${relativeTime(row.updatedAt)}` : ''}`;

  // La fila son DOS pulsables, uno al lado del otro y nunca uno dentro de
  // otro (en web serían <button> dentro de <button>): la zona principal abre
  // la oferta directa y "View profile" / "Open chat" van aparte.
  return (
    <View style={wide ? styles.rowWide : styles.row}>
      <Pressable
        onPress={onPress}
        style={({ pressed, hovered }: any) => [wide ? styles.mainWide : styles.main, (pressed || hovered) && styles.mainPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${techLabel}. ${row.offerTitle ?? 'Direct offer'}. ${status.label}${isUnread ? '. New' : ''}`}
      >
        <View style={[styles.avatar, faded && styles.faded]}>
          {/* El nombre (y la foto, fase 7) sólo con la identidad revelada. */}
          <Avatar kind="person" size={wide ? 48 : 52} photoPath={row.photoPath} anonymous={!row.displayName} name={row.displayName} />
          {isUnread ? <AvatarDot size={wide ? 12 : 13} /> : null}
        </View>

        <View style={wide ? styles.copyWide : styles.copy}>
          <Text style={styles.name} numberOfLines={1}>{techLabel}</Text>
          {row.offerTitle ? <Text style={styles.offer} numberOfLines={1}>{row.offerTitle}</Text> : null}
          {!wide ? <Text style={[styles.note, row.identityRevealed && styles.noteRevealed]}>{note}</Text> : null}
        </View>

        {wide ? <Text style={[styles.noteWide, row.identityRevealed && styles.noteRevealed]}>{note}</Text> : null}

        <View style={styles.status}>
          <StatusPill label={status.label} tone={status.tone} large={wide} />
        </View>
      </Pressable>

      {onViewProfile || onOpenChat ? (
        <View style={wide ? styles.actionsWide : styles.actions}>
          {onViewProfile ? <PillButton label="View profile" variant="outline" size="sm" onPress={onViewProfile} /> : null}
          {onOpenChat ? <PillButton label="Open chat" size="sm" onPress={onOpenChat} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 13,
    gap: 8,
  },
  rowWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    borderRadius: 12,
  },
  mainWide: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 18,
    rowGap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  mainPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  status: {
    flexShrink: 0,
  },
  avatar: {
    flexShrink: 0,
  },
  faded: {
    opacity: 0.6,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  copyWide: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 0,
    gap: 1,
  },
  // Móvil: las acciones debajo, alineadas con el texto (avatar 52 + hueco 14).
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingLeft: 66,
  },
  actionsWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  name: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  offer: {
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  note: {
    fontSize: 12.5,
    color: colors.textMuted,
  },
  noteWide: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 280,
    fontSize: 13.5,
    color: colors.textMuted,
  },
  noteRevealed: {
    fontWeight: '800',
    color: colors.success,
  },
  findMore: {
    marginTop: 6,
  },
});
