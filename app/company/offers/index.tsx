import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, RefreshControl } from 'react-native';
import type { ViewStyle } from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { Plus, Users } from 'lucide-react-native';
import { colors } from '../../../src/theme';
import { fonts } from '../../../src/theme/fonts';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { Text } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import {
  CARD_BORDER,
  DesktopTitle,
  EmptyBlock,
  FilterChipRow,
  OfferTileSquare,
  PageBar,
  PageBody,
  PillButton,
  RowList,
  StatusPill,
  useCardGrid,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { formatOfferSalary } from '../../../src/utils/offerSalary';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { OfferWithRequirements } from '../../../src/types/offer';
import { useCompanySession, useSession } from '../../../src/state/SessionContext';
import { canManageOffers } from '../../../src/utils/companyPermissionsV2';
import { offerMetaLine, offerTile, relativeTime } from '../../../src/utils/companyHome';
import {
  matchesOfferListFilter,
  offerListFilterCounts,
  offerStatusLook,
  type OfferListFilter,
} from '../../../src/utils/companyStatus';
import { COMPANY_POST_OFFER_ROUTE } from '../../../src/utils/companyNavigation';

// "Your offers" (rediseño, fase 3; maquetas C-Offers y W-D-Offers). Todas las
// ofertas de la empresa — publicadas, borradores, cerradas y caducadas —, a
// donde lleva "See all" de la Home (respuesta 13). Editar, publicar, cerrar y
// borrar viven en la página de cada oferta.

type OfferCounts = {
  applications: number;
  /** Candidaturas pendientes: "N new" (respuesta 16, "new" es pendiente). */
  pending: number;
  directOffers: number;
};

const FILTER_LABELS: Record<OfferListFilter, string> = {
  all: 'All',
  published: 'Published',
  draft: 'Drafts',
  closed: 'Closed',
};

function whenLine(offer: OfferWithRequirements): string {
  return `${offer.status === 'draft' ? 'Created' : 'Published'} ${relativeTime(offer.createdAt)}`;
}

function countsLine(counts: OfferCounts): string {
  const apps = `${counts.applications} application${counts.applications === 1 ? '' : 's'}`;
  const direct = `${counts.directOffers} direct offer${counts.directOffers === 1 ? '' : 's'}`;
  return `${apps} · ${direct}`;
}

function detailLine(offer: OfferWithRequirements): string {
  return [
    formatOfferSalary(offer.salary),
    offer.minYearsExperience > 0 ? `${offer.minYearsExperience}+ yrs` : null,
  ].filter(Boolean).join(' · ');
}

function metaLine(offer: OfferWithRequirements): string {
  const base = offerMetaLine(offer);
  return offer.locationBaseAirport ? `${base} · ${offer.locationBaseAirport}` : base;
}

/** Ancho mínimo y separación de las tarjetas de escritorio. */
const OFFER_CARD_MIN_WIDTH = 260;
const OFFER_CARD_GAP = 16;

export default function OffersListScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const wide = useIsWide();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;
  const { sessionLoading } = useSession();
  const canManage = canManageOffers(companyMemberRole);

  const [offers, setOffers] = useState<OfferWithRequirements[]>([]);
  const [counts, setCounts] = useState<Record<string, OfferCounts>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<OfferListFilter>('all');
  // Escritorio: todas las tarjetas del mismo ancho, también las de la última fila (fase 8).
  const grid = useCardGrid(OFFER_CARD_MIN_WIDTH, OFFER_CARD_GAP);

  // companyId hydrates asynchronously in SessionContext, independently of
  // the auth guard CompanyLayout already waits for — a screen that reads
  // companyId as soon as it mounts (e.g. right after router.replace() from
  // another screen, before that fetch resolves) can otherwise call
  // getForCompany('') and crash on the Postgres UUID cast.
  const load = useCallback(async () => {
    if (!companyId) return;
    const [allOffers, apps, requests] = await Promise.all([
      offerRepository.getAllWithRequirements(),
      offerApplicationRepository.getForCompany(companyId),
      offerRequestRepository.getForCompany(companyId),
    ]);

    const companyOffers = allOffers
      .filter((offer) => offer.companyId === companyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const nextCounts: Record<string, OfferCounts> = {};
    companyOffers.forEach((offer) => {
      const forOffer = apps.filter((app) => app.offerId === offer.id);
      nextCounts[offer.id] = {
        applications: forOffer.length,
        pending: forOffer.filter((app) => app.status === 'pending').length,
        directOffers: requests.filter((req) => req.offerId === offer.id).length,
      };
    });

    setOffers(companyOffers);
    setCounts(nextCounts);
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      if (!companyId) return;
      let active = true;
      setLoading(true);
      load().finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [load, companyId]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading || sessionLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="company" />
      </>
    );
  }

  const filterCounts = offerListFilterCounts(offers.map((o) => o.status));
  const filtered = offers.filter((o) => matchesOfferListFilter(o.status, filter));
  const postOffer = () => router.push(COMPANY_POST_OFFER_ROUTE as any);
  const open = (id: string) => router.push(`/company/offers/${id}` as any);
  const emptyCounts: OfferCounts = { applications: 0, pending: 0, directOffers: 0 };

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      {!wide ? (
        <PageBar
          title="Your offers"
          large
          onBack={goBack}
          right={canManage ? <PillButton label="New" icon={Plus} size="sm" onPress={postOffer} /> : undefined}
        />
      ) : null}
      <PageBody
        wide={wide}
        maxWidth={1240}
        gap={wide ? 18 : 12}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {wide ? (
          <DesktopTitle
            title="Your offers"
            right={canManage ? <PillButton label="New offer" icon={Plus} size="md" onPress={postOffer} /> : undefined}
          />
        ) : null}

        {offers.length > 0 ? (
          <FilterChipRow
            wide={wide}
            options={(['all', 'published', 'draft', 'closed'] as OfferListFilter[]).map((key) => ({
              key,
              label: FILTER_LABELS[key],
              count: filterCounts[key],
            }))}
            value={filter}
            onChange={setFilter}
          />
        ) : null}

        {offers.length === 0 ? (
          <EmptyBlock
            title="No offers yet"
            text="Create your first job offer to start matching with technicians."
            action={canManage ? <PillButton label="Create offer" size="md" onPress={postOffer} /> : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyBlock title="No offers in this category" text="Try switching to All to see every offer." />
        ) : wide ? (
          <View style={styles.grid} onLayout={grid.onLayout}>
            {filtered.map((offer) => (
              <OfferCard key={offer.id} offer={offer} counts={counts[offer.id] ?? emptyCounts} style={grid.itemStyle} onPress={() => open(offer.id)} />
            ))}
          </View>
        ) : (
          <RowList wide={false}>
            {filtered.map((offer) => (
              <OfferRow key={offer.id} offer={offer} counts={counts[offer.id] ?? emptyCounts} onPress={() => open(offer.id)} />
            ))}
          </RowList>
        )}
      </PageBody>
    </CompanyScreen>
  );
}

function isInactive(offer: OfferWithRequirements): boolean {
  return offer.status === 'closed' || offer.status === 'expired' || offer.status === 'archived';
}

function NewChip({ count }: { count: number }) {
  return <StatusPill label={`${count} new`} tone="warning" />;
}

function OfferRow({ offer, counts, onPress }: { offer: OfferWithRequirements; counts: OfferCounts; onPress: () => void }) {
  const status = offerStatusLook(offer.status);
  const details = detailLine(offer);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [styles.row, isInactive(offer) && styles.inactive, (pressed || hovered) && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${offer.title}. ${status.label}${counts.pending > 0 ? `. ${counts.pending} new` : ''}`}
    >
      <OfferTileSquare offer={offer} size={52} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>{offer.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{metaLine(offer)}</Text>
        <View style={styles.statusLine}>
          <StatusPill label={status.label} tone={status.tone} />
          <Text style={styles.when} numberOfLines={1}>{whenLine(offer)}</Text>
        </View>
        <Text style={styles.when} numberOfLines={1}>{[countsLine(counts), details].filter(Boolean).join(' · ')}</Text>
      </View>
      {counts.pending > 0 ? <NewChip count={counts.pending} /> : null}
    </Pressable>
  );
}

function OfferCard({ offer, counts, style, onPress }: { offer: OfferWithRequirements; counts: OfferCounts; style?: ViewStyle; onPress: () => void }) {
  const status = offerStatusLook(offer.status);
  const tile = offerTile(offer);
  const details = detailLine(offer);
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered }: any) => [styles.card, style, isInactive(offer) && styles.inactive, hovered && styles.cardHover]}
      accessibilityRole="button"
      accessibilityLabel={`${offer.title}. ${status.label}${counts.pending > 0 ? `. ${counts.pending} new` : ''}`}
    >
      <View style={[styles.cardTop, { backgroundColor: tile.bg }]}>
        <View style={styles.cardTopChips}>
          <StatusPill label={status.label} tone={status.tone} />
          {counts.pending > 0 ? <NewChip count={counts.pending} /> : null}
        </View>
        <Text style={[styles.cardCode, { color: tile.fg }]} numberOfLines={1}>{tile.code}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{offer.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{metaLine(offer)}</Text>
        {details ? <Text style={styles.meta} numberOfLines={1}>{details}</Text> : null}
        <Text style={styles.when}>{whenLine(offer)}</Text>
        <View style={styles.cardCounts}>
          <Users color={counts.applications > 0 ? '#33465A' : colors.textMuted} size={15} strokeWidth={2} />
          <Text style={[styles.when, counts.applications > 0 && styles.countsActive]}>{countsLine(counts)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  pressed: {
    backgroundColor: colors.surfaceSoft,
  },
  inactive: {
    opacity: 0.75,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  when: {
    flexShrink: 1,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  card: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 260,
    minWidth: 260,
    maxWidth: 400,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardHover: {
    borderColor: colors.border,
  },
  cardTop: {
    height: 96,
    paddingVertical: 14,
    paddingHorizontal: 16,
    justifyContent: 'flex-end',
  },
  cardTopChips: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardCode: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 36,
  },
  cardBody: {
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 3,
  },
  cardTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  cardCounts: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  countsActive: {
    color: '#33465A',
    fontWeight: '700',
  },
});
