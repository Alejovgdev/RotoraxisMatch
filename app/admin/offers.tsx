import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import {
  BriefcaseBusiness,
  Building2,
  CheckCircle,
  Clock,
  FileText,
  MapPin,
  XCircle,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { useAdminDashboard } from '../../src/state/useAdminDashboard';
import type { OfferWithRequirements } from '../../src/types/offer';
import type { OfferStatus } from '../../src/types/enums';
import { technicianTypeLabel } from '../../src/constants/technicianTypes';
import { useEnginesCatalog } from '../../src/state/useEnginesCatalog';
import { ONLY_UNLICENSED_TEXT, offerCertificationText, offerEngineText, offerLicenseDetailText } from '../../src/utils/offerRequirementsText';
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
import { formatLocation } from '../../src/utils/formatLocation';

type StatusFilter = 'all' | OfferStatus;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Draft' },
  { key: 'closed', label: 'Closed' },
  { key: 'expired', label: 'Expired' },
  { key: 'archived', label: 'Archived' },
];

const STATUS_LABELS: Record<OfferStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  closed: 'Closed',
  expired: 'Expired',
  archived: 'Archived',
};

const CONTRACT_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  long_term: 'Long-term',
  short_term: 'Short-term',
};

type OfferAction = {
  status: OfferStatus;
  label: string;
  color: string;
  icon: React.ComponentType<LucideProps>;
};

const NEXT_ACTIONS: Record<OfferStatus, OfferAction[]> = {
  draft: [
    { status: 'published', label: 'Publish', color: adminUi.green, icon: CheckCircle },
    { status: 'expired', label: 'Expire', color: adminUi.red, icon: XCircle },
  ],
  published: [
    { status: 'closed', label: 'Close', color: adminUi.amber, icon: Clock },
    { status: 'expired', label: 'Expire', color: adminUi.red, icon: XCircle },
  ],
  closed: [
    { status: 'published', label: 'Reopen', color: adminUi.green, icon: CheckCircle },
    { status: 'expired', label: 'Expire', color: adminUi.red, icon: XCircle },
  ],
  expired: [],
  // Terminal, same as expired — see docs/OFFER_DELETE_SOFT_DELETE_PROPOSAL.md.
  // A company archives an offer (instead of a blocked hard delete) when it
  // has real applications/direct offers attached; there's no "reopen" path
  // back out of that for MVP.
  archived: [],
};

function statusTone(status: OfferStatus): AdminTone {
  if (status === 'published') return 'success';
  if (status === 'draft') return 'warning';
  if (status === 'closed') return 'navy';
  if (status === 'archived') return 'muted';
  return 'error';
}

function filterOffers(offers: OfferWithRequirements[], status: StatusFilter): OfferWithRequirements[] {
  const result = status === 'all' ? offers : offers.filter((offer) => offer.status === status);
  const order: Record<OfferStatus, number> = { published: 0, draft: 1, closed: 2, expired: 3, archived: 4 };
  return [...result].sort((a, b) => {
    const statusOrder = order[a.status] - order[b.status];
    if (statusOrder !== 0) return statusOrder;
    return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
  });
}

function contractLabel(code: string): string {
  return CONTRACT_LABELS[code] ?? code.replace(/_/g, ' ');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date pending';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AdminOffersScreen() {
  const goBack = useGoBack();
  const { offers, loading, refresh, updateOfferStatus, companyMap } = useAdminDashboard();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const filtered = useMemo(() => filterOffers(offers, statusFilter), [offers, statusFilter]);
  const publishedCount = offers.filter((offer) => offer.status === 'published').length;

  async function handleAction(id: string, status: OfferStatus) {
    await updateOfferStatus(id, status);
  }

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
          eyebrow="Marketplace"
          title="Offer moderation"
          subtitle="Review visibility, contract details and requirement fit across published and draft offers."
          onBack={goBack}
        />

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
                {filtered.length} offer{filtered.length !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.resultSub}>
                {publishedCount} published on the marketplace
              </Text>
            </View>
            <AdminIconBox icon={BriefcaseBusiness} size={17} color={adminUi.accent} backgroundColor={adminUi.accentSoft} />
          </View>
        }
        ListEmptyComponent={
          <AdminEmptyPanel
            title="No offers found"
            subtitle="Adjust the offer status filter to widen the moderation list."
          />
        }
        renderItem={({ item }) => (
          <OfferCard
            offer={item}
            companyName={companyMap[item.companyId]?.companyName ?? item.companyId}
            onAction={handleAction}
          />
        )}
      />
    </AdminScreen>
  );
}

function OfferCard({
  offer,
  companyName,
  onAction,
}: {
  offer: OfferWithRequirements;
  companyName: string;
  onAction: (offerId: string, status: OfferStatus) => Promise<void>;
}) {
  const [loadingStatus, setLoadingStatus] = useState<OfferStatus | null>(null);
  const nextActions = NEXT_ACTIONS[offer.status];
  // Paso 5b: el motor de una oferta de motor, para el nombre.
  const { engineIndex } = useEnginesCatalog();
  const engine = offerEngineText(offer, engineIndex);
  const requirementChips = [
    ...(engine ? ['Engine offer', `Engine: ${engine}`] : [technicianTypeLabel(offer.technicianType)]),
    // El moderador necesita ver el interruptor SIEMPRE, en los dos sentidos:
    // aquí se revisa si la oferta es coherente, y "exige licencia" es tan
    // revisable como "no la exige".
    offerCertificationText(offer),
    ...(offer.licenseCode ? [offerLicenseDetailText(offer)!] : []),
    ...(offer.onlyUnlicensed ? [ONLY_UNLICENSED_TEXT] : []),
    // Fase 6 tanda D: si la oferta exige TODAS las aeronaves, el moderador
    // tiene que verlo — es lo que separa "pido tres" de "me vale una".
    ...(offer.requiresAllAircraft ? ['All listed aircraft'] : []),
    `${offer.minYearsExperience}+ years`,
  ];

  async function handlePress(status: OfferStatus) {
    setLoadingStatus(status);
    try {
      await onAction(offer.id, status);
    } finally {
      setLoadingStatus(null);
    }
  }

  return (
    <AdminCard style={styles.offerCard}>
      <View style={styles.cardHeader}>
        <View style={styles.titleBlock}>
          <View style={styles.badgeRow}>
            <AdminBadge label={STATUS_LABELS[offer.status]} tone={statusTone(offer.status)} small />
            <AdminBadge label={contractLabel(offer.contractType)} tone="cyan" small />
          </View>
          <Text style={styles.cardTitle}>{offer.title}</Text>
        </View>
        <AdminIconBox
          icon={BriefcaseBusiness}
          color={offer.status === 'published' ? adminUi.green : adminUi.accent}
          backgroundColor={offer.status === 'published' ? adminUi.greenSoft : adminUi.accentSoft}
          size={19}
        />
      </View>

      <View style={styles.metaGrid}>
        <InfoPill icon={Building2} label={companyName} />
        <InfoPill icon={MapPin} label={formatLocation(offer.locationCity, offer.locationCountry)} />
        <InfoPill icon={FileText} label={`Created ${formatDate(offer.createdAt)}`} />
      </View>

      <View style={styles.requirementBlock}>
        <Text style={styles.requirementLabel}>Requirements</Text>
        <View style={styles.chipRow}>
          {requirementChips.map((chip) => (
            <AdminBadge key={chip} label={chip} tone="muted" small />
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        {nextActions.length > 0 ? (
          nextActions.map((action) => (
            <OfferActionButton
              key={action.status}
              action={action}
              loading={loadingStatus === action.status}
              disabled={loadingStatus !== null}
              onPress={() => handlePress(action.status)}
            />
          ))
        ) : (
          <Text style={styles.noActionHint}>No moderation actions available for this status.</Text>
        )}
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

function OfferActionButton({
  action,
  loading,
  disabled,
  onPress,
}: {
  action: OfferAction;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = action.icon;
  return (
    <TouchableOpacity
      style={[
        styles.actionBtn,
        { borderColor: action.color + '55', backgroundColor: action.color + '0F' },
        disabled && styles.actionBtnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.78}
    >
      {loading ? (
        <ActivityIndicator size="small" color={action.color} />
      ) : (
        <>
          <Icon size={15} color={action.color} strokeWidth={2.2} />
          <Text style={[styles.actionBtnText, { color: action.color }]}>{action.label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
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
  offerCard: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: adminUi.text,
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
  requirementBlock: {
    gap: spacing.xs,
  },
  requirementLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: adminUi.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: adminUi.borderSoft,
  },
  actionBtn: {
    flexGrow: 1,
    flexBasis: 112,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  actionBtnDisabled: {
    opacity: 0.55,
  },
  actionBtnText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  noActionHint: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: adminUi.textMuted,
  },
});
