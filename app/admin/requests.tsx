import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import {
  BriefcaseBusiness,
  Building2,
  CheckCircle,
  ClipboardCheck,
  FileCheck,
  Inbox,
  Lock,
  MessageCircle,
  UserRound,
  XCircle,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { useAdminDashboard } from '../../src/state/useAdminDashboard';
import { chatRepository } from '../../src/repositories/v2/chatRepository';
import type { OfferApplication, OfferInboxRecord, OfferRequest } from '../../src/types/offerRequest';
import type { OfferRequestStatus } from '../../src/types/enums';
import {
  AdminBadge,
  AdminCard,
  AdminChip,
  AdminEmptyPanel,
  AdminIconBox,
  AdminPageHeader,
  AdminScreen,
  adminUi,
} from '../../src/components/admin/AdminUI';
import type { AdminTone } from '../../src/components/admin/AdminUI';
import { spacing } from '../../src/theme';

type StatusFilter = 'all' | OfferRequestStatus;
type KindFilter = 'all' | 'direct_offer' | 'application';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'expired', label: 'Expired' },
  { key: 'withdrawn', label: 'Withdrawn' },
];

const KIND_CHIPS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All records' },
  { key: 'direct_offer', label: 'Direct offers' },
  { key: 'application', label: 'Applications' },
];

function statusTone(status: OfferRequestStatus): AdminTone {
  if (status === 'accepted') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'rejected') return 'error';
  return 'muted';
}

function statusLabel(status: OfferRequestStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function filterRecords(
  records: OfferInboxRecord[],
  status: StatusFilter,
  kind: KindFilter,
): OfferInboxRecord[] {
  let result = records;
  if (status !== 'all') result = result.filter((record) => record.status === status);
  if (kind !== 'all') result = result.filter((record) => record.kind === kind);
  const order: Record<OfferRequestStatus, number> = {
    pending: 0,
    accepted: 1,
    rejected: 2,
    expired: 3,
    withdrawn: 4,
  };
  return [...result].sort(
    (a, b) =>
      (order[a.status] ?? 0) - (order[b.status] ?? 0) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date pending';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AdminRequestsScreen() {
  const goBack = useGoBack();
  const {
    offerRequestsV2,
    offerApplicationsV2,
    loading,
    refresh,
    technicianMap,
    companyMap,
    offerTitleMap,
  } = useAdminDashboard();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [chatRecordIds, setChatRecordIds] = useState<Set<string>>(new Set());
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const allRecords: OfferInboxRecord[] = useMemo(
    () => [...offerRequestsV2, ...offerApplicationsV2],
    [offerRequestsV2, offerApplicationsV2],
  );

  useEffect(() => {
    let cancelled = false;
    const companyIds = [...new Set(allRecords.map((record) => record.companyId))];

    if (companyIds.length === 0) {
      setChatRecordIds(new Set());
      return () => {
        cancelled = true;
      };
    }

    Promise.all(companyIds.map((companyId) => chatRepository.getRoomsForCompany(companyId))).then((groups) => {
      if (cancelled) return;
      const next = new Set<string>();
      groups.flat().forEach((room) => {
        if (room.offerRequestId) next.add(room.offerRequestId);
        if (room.offerApplicationId) next.add(room.offerApplicationId);
      });
      setChatRecordIds(next);
    });

    return () => {
      cancelled = true;
    };
  }, [allRecords]);

  const filtered = useMemo(
    () => filterRecords(allRecords, statusFilter, kindFilter),
    [allRecords, statusFilter, kindFilter],
  );

  const pendingCount = allRecords.filter((record) => record.status === 'pending').length;
  const acceptedWithUnlocks = allRecords.filter(
    (record) => record.status === 'accepted' && record.identityRevealed && record.documentsUnlocked,
  ).length;
  const rejectedLocked = allRecords.filter(
    (record) => record.status === 'rejected' && !record.identityRevealed && !record.documentsUnlocked,
  ).length;
  const withChat = allRecords.filter((record) => chatRecordIds.has(record.id)).length;

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={adminUi.accent} role="admin" />
      </>
    );
  }

  return (
    <AdminScreen>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.topContent, isWide && styles.contentWide]}>
        <AdminPageHeader
          eyebrow="Oversight"
          title="Requests & applications"
          subtitle="Audit direct offers and technician applications without changing acceptance, unlock or chat behavior."
          onBack={goBack}
        />

        <AdminCard style={styles.summaryCard}>
          <SummaryGrid
            items={[
              { label: 'Pending', value: pendingCount, tone: pendingCount > 0 ? 'warning' : 'success', icon: Inbox },
              { label: 'Accepted with unlocks', value: acceptedWithUnlocks, tone: 'success', icon: CheckCircle },
              { label: 'Rejected locked', value: rejectedLocked, tone: 'error', icon: Lock },
              { label: 'Chat rooms', value: withChat, tone: 'info', icon: MessageCircle },
            ]}
          />
        </AdminCard>

        <AdminCard style={styles.controls}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {STATUS_TABS.map(({ key, label }) => (
              <AdminChip
                key={key}
                label={label}
                selected={statusFilter === key}
                onPress={() => setStatusFilter(key)}
              />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {KIND_CHIPS.map(({ key, label }) => (
              <AdminChip
                key={key}
                label={label}
                selected={kindFilter === key}
                onPress={() => setKindFilter(key)}
              />
            ))}
          </ScrollView>
        </AdminCard>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, isWide && styles.contentWide]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View>
              <Text style={styles.resultCount}>
                {filtered.length} record{filtered.length !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.resultSub}>
                {offerRequestsV2.length} direct offers - {offerApplicationsV2.length} applications
              </Text>
            </View>
            <AdminIconBox icon={ClipboardCheck} size={17} color={adminUi.accent} backgroundColor={adminUi.accentSoft} />
          </View>
        }
        ListEmptyComponent={
          <AdminEmptyPanel
            title="No records found"
            subtitle="Adjust the status or record type filter to widen the audit list."
          />
        }
        renderItem={({ item }) => (
          <RecordCard
            record={item}
            companyName={companyMap[item.companyId]?.companyName ?? item.companyId}
            technicianCode={technicianMap[item.technicianId]?.anonymousCode ?? item.technicianId}
            technicianName={technicianMap[item.technicianId]?.fullName}
            offerTitle={item.kind === 'direct_offer'
              ? (item.offerId ? offerTitleMap[item.offerId] : undefined)
              : offerTitleMap[item.offerId]}
            chatExists={chatRecordIds.has(item.id)}
          />
        )}
      />
    </AdminScreen>
  );
}

function SummaryGrid({
  items,
}: {
  items: {
    label: string;
    value: number;
    tone: AdminTone;
    icon: React.ComponentType<LucideProps>;
  }[];
}) {
  return (
    <View style={styles.summaryGrid}>
      {items.map((item) => (
        <View key={item.label} style={styles.summaryItem}>
          <AdminIconBox icon={item.icon} size={16} color={toneColor(item.tone)} backgroundColor={toneSoft(item.tone)} />
          <Text style={styles.summaryValue}>{item.value}</Text>
          <Text style={styles.summaryLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function RecordCard({
  record,
  companyName,
  technicianCode,
  technicianName,
  offerTitle,
  chatExists,
}: {
  record: OfferInboxRecord;
  companyName: string;
  technicianCode: string;
  technicianName?: string;
  offerTitle?: string;
  chatExists: boolean;
}) {
  const isDirectOffer = record.kind === 'direct_offer';
  const note = isDirectOffer ? (record as OfferRequest).message : (record as OfferApplication).coverNote;

  return (
    <AdminCard
      style={[
        styles.recordCard,
        record.status === 'pending' && styles.cardPending,
        record.status === 'accepted' && styles.cardAccepted,
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.badgeRow}>
          <AdminBadge
            label={isDirectOffer ? 'Direct offer' : 'Application'}
            tone={isDirectOffer ? 'info' : 'cyan'}
            small
          />
          <AdminBadge label={statusLabel(record.status)} tone={statusTone(record.status)} small />
        </View>
        <AdminIconBox
          icon={isDirectOffer ? Inbox : ClipboardCheck}
          color={isDirectOffer ? adminUi.blue : adminUi.accent}
          backgroundColor={isDirectOffer ? adminUi.blueSoft : adminUi.accentSoft}
          size={19}
        />
      </View>

      <View style={styles.metaGrid}>
        <InfoPill icon={Building2} label={companyName} />
        <InfoPill
          icon={UserRound}
          label={technicianName ? `${technicianName} (${technicianCode})` : technicianCode}
        />
        <InfoPill icon={BriefcaseBusiness} label={offerTitle ?? 'Related offer not linked'} />
      </View>

      {note ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteText} numberOfLines={3}>{note}</Text>
        </View>
      ) : null}

      <View style={styles.auditFooter}>
        <View style={styles.flagRow}>
          <FlagChip label="Identity" active={record.identityRevealed} />
          <FlagChip label="Documents" active={record.documentsUnlocked} icon={FileCheck} />
          <FlagChip label="Chat" active={chatExists} icon={MessageCircle} inactiveLabel="No chat" />
        </View>
        <Text style={styles.footerDate}>{formatDate(record.createdAt)}</Text>
      </View>
    </AdminCard>
  );
}

function InfoPill({
  icon,
  label,
}: {
  icon: React.ComponentType<LucideProps>;
  label: string;
}) {
  return (
    <View style={styles.infoPill}>
      <AdminIconBox icon={icon} size={16} color={adminUi.accent} backgroundColor={adminUi.accentSoft} />
      <Text style={styles.infoText} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function FlagChip({
  label,
  active,
  icon,
  inactiveLabel,
}: {
  label: string;
  active: boolean;
  icon?: React.ComponentType<LucideProps>;
  inactiveLabel?: string;
}) {
  const Icon = icon ?? (active ? CheckCircle : XCircle);
  const color = active ? adminUi.green : adminUi.textMuted;
  return (
    <View style={[styles.flagChip, active ? styles.flagChipOn : styles.flagChipOff]}>
      <Icon size={13} color={color} strokeWidth={2.2} />
      <Text style={[styles.flagText, { color }]}>
        {active ? label : inactiveLabel ?? `${label} locked`}
      </Text>
    </View>
  );
}

function toneColor(tone: AdminTone): string {
  if (tone === 'success') return adminUi.green;
  if (tone === 'warning') return adminUi.amber;
  if (tone === 'error') return adminUi.red;
  if (tone === 'info') return adminUi.blue;
  if (tone === 'cyan') return adminUi.accent;
  if (tone === 'navy') return adminUi.navy;
  return adminUi.textSoft;
}

function toneSoft(tone: AdminTone): string {
  if (tone === 'success') return adminUi.greenSoft;
  if (tone === 'warning') return adminUi.amberSoft;
  if (tone === 'error') return adminUi.redSoft;
  if (tone === 'info') return adminUi.blueSoft;
  if (tone === 'cyan') return adminUi.accentSoft;
  return adminUi.surfaceSoft;
}

const styles = StyleSheet.create({
  topContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  contentWide: {
    maxWidth: 920,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
  },
  summaryCard: {
    marginBottom: spacing.md,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryItem: {
    flexGrow: 1,
    flexBasis: 132,
    padding: spacing.sm,
    borderRadius: 14,
    backgroundColor: adminUi.surfaceSoft,
    borderWidth: 1,
    borderColor: adminUi.borderSoft,
    gap: 4,
  },
  summaryValue: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '700',
    color: adminUi.text,
  },
  summaryLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: adminUi.textSoft,
  },
  controls: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  resultCount: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: adminUi.text,
  },
  resultSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: adminUi.textMuted,
  },
  recordCard: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cardPending: {
    borderColor: '#FDE68A',
    borderLeftWidth: 3,
  },
  cardAccepted: {
    borderColor: '#BBF7D0',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  badgeRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  metaGrid: {
    gap: spacing.sm,
  },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 14,
    backgroundColor: adminUi.surfaceSoft,
    borderWidth: 1,
    borderColor: adminUi.borderSoft,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: adminUi.textSoft,
  },
  noteBox: {
    borderWidth: 1,
    borderColor: adminUi.borderSoft,
    borderRadius: 14,
    backgroundColor: adminUi.surfaceSoft,
    padding: spacing.sm,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    color: adminUi.textSoft,
  },
  auditFooter: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: adminUi.borderSoft,
    paddingTop: spacing.sm,
  },
  flagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  flagChip: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  flagChipOn: {
    backgroundColor: adminUi.greenSoft,
    borderColor: '#BBF7D0',
  },
  flagChipOff: {
    backgroundColor: adminUi.surfaceSoft,
    borderColor: adminUi.borderSoft,
  },
  flagText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  footerDate: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: adminUi.textMuted,
  },
});
