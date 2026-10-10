import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Map as MapIcon, Search } from 'lucide-react-native';
import { Chip, focusRingWithin, Text, TextInput } from '../../../src/components/ui';
import { TechnicianScreen } from '../../../src/components/technician/TechnicianUI';
import { OfferResultCard } from '../../../src/components/technician/OfferCards';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  SegmentedControl,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { getOfferMatchesForTechnician, type OfferMatchResult } from '../../../src/utils/matchingV2';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { CompanyProfileView } from '../../../src/types/company';
import { OfferApplication } from '../../../src/types/offerRequest';
import { offerRequirementChips } from '../../../src/utils/offerRequirementsText';
import {
  EMPTY_OFFER_LIST_FILTERS,
  OFFER_QUICK_CHIPS,
  filterAndSortOffers,
  isQuickChipSelected,
  technicianApplicationLook,
  toggleQuickChip,
  type OfferListFilters,
} from '../../../src/utils/technicianOffers';
import { TECHNICIAN_SECTION_ROUTES } from '../../../src/utils/technicianNavigation';
import { colors } from '../../../src/theme';
import { floatingShadow, mobileGridColumns } from '../../../src/theme/ui';

// Ofertas del técnico (rediseño, fase 5A; maqueta T-Search, sin "My licences":
// respuesta 12).
//   - Los filtros son los de antes con el mismo funcionamiento
//     (src/utils/technicianOffers.ts): texto, aviones o helicópteros y tipo de
//     contrato, aplicados al momento. La maqueta pone un botón en lo alto; aquí
//     va el campo de búsqueda de siempre con ese aspecto, porque la búsqueda
//     por texto ya existía.
//   - El % y "Not eligible" como antes; el orden también (novedades sin leer
//     en la candidatura primero, después por %).
//   - "Map" abre el mapa de ofertas, que se queda como estaba (respuesta 22).

const CARD_MIN_WIDTH = 230;
const CARD_GAP = 14;
const MOBILE_GAP = 10;

export default function BrowseOffersScreen() {
  const router = useRouter();
  const wide = useIsWide();
  const { width } = useWindowDimensions();
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  // Paso 5b: sólo para el nombre del motor en las tarjetas de ofertas de motor.
  const { engineIndex } = useEnginesCatalog();

  const [matches, setMatches] = useState<OfferMatchResult[]>([]);
  const [companyMap, setCompanyMap] = useState<Record<string, CompanyProfileView>>({});
  const [applications, setApplications] = useState<OfferApplication[]>([]);
  const [unreadAppIds, setUnreadAppIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<OfferListFilters>(EMPTY_OFFER_LIST_FILTERS);
  // Escritorio: el ancho real de la lista, ya sin la barra de desplazamiento
  // (visible en escritorio, fase 8), para que las tarjetas quepan en su fila.
  const [listWidth, setListWidth] = useState(0);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio; la pantalla cae en su estado vacio en vez de colgarse.
    if (!technicianId) return;

    const [offerMatches, companies, apps, unreadIds] = await Promise.all([
      getOfferMatchesForTechnician(technicianId),
      companyRepositoryV2.getAll(),
      offerApplicationRepository.getForTechnician(technicianId),
      activityRepository.getUnreadEntityIds('technician', technicianId, [
        'application_accepted',
        'application_rejected',
      ]),
    ]);
    setMatches(offerMatches);
    const map: Record<string, CompanyProfileView> = {};
    companies.forEach((c) => { map[c.id] = c; });
    setCompanyMap(map);
    setApplications(apps);
    setUnreadAppIds(unreadIds);
  }, [technicianId]);

  // Se recarga cada vez que se vuelve a la pestaña, como antes, pero sin tapar
  // la lista con el indicador de carga: sólo la primera vez.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!loaded.current) setLoading(true);
      load()
        .then(() => { if (active) { setError(false); loaded.current = true; } })
        .catch(() => { if (active && !loaded.current) setError(true); })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      setError(false);
      loaded.current = true;
    } catch {
      if (!loaded.current) setError(true);
    }
    setRefreshing(false);
  }

  const appByOffer = useMemo(() => {
    const map = new Map<string, OfferApplication>();
    applications.forEach((a) => map.set(a.offerId, a));
    return map;
  }, [applications]);

  const isOfferUnread = useCallback((offerId: string) => {
    const app = appByOffer.get(offerId);
    return app ? unreadAppIds.has(app.id) : false;
  }, [appByOffer, unreadAppIds]);

  const filtered = useMemo(
    () => filterAndSortOffers(matches, filters, isOfferUnread),
    [matches, filters, isOfferUnread],
  );

  const openMap = () => router.push(TECHNICIAN_SECTION_ROUTES.map as never);

  // Ancho fijo por tarjeta: la última de una fila impar no se estira.
  const contentWidth = listWidth > 0 ? listWidth : Math.min(width, 1240) - 64;
  // Móvil: 2 columnas en teléfono y 3 en tablet (fase 8).
  const columns = wide ? Math.max(2, Math.floor((contentWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP))) : mobileGridColumns(width);
  const cellWidth = wide
    ? Math.floor((contentWidth - (columns - 1) * CARD_GAP) / columns)
    : Math.floor((width - 24 - (columns - 1) * MOBILE_GAP) / columns);

  const searchField = (
    <View style={[styles.searchPill, wide && styles.searchPillWide]} {...focusRingWithin}>
      <Search color={colors.textSecondary} size={20} strokeWidth={2} />
      <TextInput
        style={styles.searchInput}
        placeholder="Search by title, city or country..."
        placeholderTextColor={colors.placeholder}
        value={filters.text}
        onChangeText={(text) => setFilters((f) => ({ ...f, text }))}
        accessibilityLabel="Search offers by title, city or country"
        returnKeyType="search"
      />
    </View>
  );

  const chips = OFFER_QUICK_CHIPS.map((chip) => (
    <Chip
      key={`${chip.group}-${chip.value}`}
      label={chip.label}
      selected={isQuickChipSelected(filters, chip)}
      onPress={() => setFilters((f) => toggleQuickChip(f, chip))}
    />
  ));

  const caption = loading ? null : (
    <Text style={styles.caption}>
      {filtered.length} offer{filtered.length === 1 ? '' : 's'} · best match first
    </Text>
  );

  const emptyState = loading ? (
    <LoadingBlock label="Comparing published offers with your profile..." />
  ) : error ? (
    <ErrorBlock text="Could not load offers." onRetry={handleRefresh} />
  ) : (
    <EmptyBlock
      title="No offers found"
      text={matches.length === 0 ? 'There are no published offers at the moment.' : 'Try adjusting your filters.'}
    />
  );

  const renderCard = ({ item }: { item: OfferMatchResult }) => {
    const app = appByOffer.get(item.offer.id);
    return (
      <View style={[wide ? styles.cellWide : styles.cell, { width: cellWidth }]}>
        <OfferResultCard
          offer={item.offer}
          score={item.score}
          companyName={companyMap[item.offer.companyId]?.name ?? null}
          logoPath={companyMap[item.offer.companyId]?.logoPath}
          requirementLine={offerRequirementChips(item.offer, engineIndex).join(' · ')}
          status={app ? technicianApplicationLook(app.status, 'card') : null}
          unread={isOfferUnread(item.offer.id)}
          onPress={() => router.push(`/technician/offers/${item.offer.id}` as never)}
        />
      </View>
    );
  };

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />;

  if (wide) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.wideShell}>
          <View style={styles.wideHead}>
            <View style={styles.wideTitleRow}>
              <Text style={styles.wideTitle} accessibilityRole="header">Offers</Text>
              <SegmentedControl
                fill={false}
                options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }] as const}
                value="list"
                onChange={(v) => { if (v === 'map') openMap(); }}
                accessibilityLabel="List or map"
              />
            </View>
            {searchField}
            <View style={styles.chipsWrap}>{chips}</View>
            {caption}
          </View>
          <FlatList
            key={`cols-${columns}`}
            style={styles.flex}
            data={loading || error ? [] : filtered}
            keyExtractor={(item) => item.offer.id}
            numColumns={columns}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.wideList}
            ListHeaderComponent={<View onLayout={(e) => setListWidth(Math.floor(e.nativeEvent.layout.width))} />}
            ListEmptyComponent={emptyState}
            renderItem={renderCard}
            refreshControl={refreshControl}
            showsVerticalScrollIndicator
          />
        </View>
      </TechnicianScreen>
    );
  }

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <FlatList
        key={`cols-${columns}`}
        data={loading || error ? [] : filtered}
        keyExtractor={(item) => item.offer.id}
        numColumns={columns}
        columnWrapperStyle={styles.rowMobile}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        ListHeaderComponent={(
          <View style={styles.head}>
            {searchField}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chipsScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {chips}
            </ScrollView>
            {caption}
          </View>
        )}
        ListEmptyComponent={emptyState}
        renderItem={renderCard}
      />
      <Pressable
        onPress={openMap}
        style={[styles.mapButton, floatingShadow]}
        accessibilityRole="button"
        accessibilityLabel="Show offers on map"
      >
        <MapIcon color={colors.white} size={18} strokeWidth={2} />
        <Text style={styles.mapButtonText}>Map</Text>
      </Pressable>
    </TechnicianScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 96,
  },
  row: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  rowMobile: {
    gap: MOBILE_GAP,
  },
  cell: {
    marginBottom: MOBILE_GAP,
  },
  cellWide: {
    minWidth: 0,
  },
  head: {
    paddingHorizontal: 4,
    gap: 10,
    marginBottom: 8,
  },
  searchPill: {
    height: 48,
    paddingLeft: 16,
    paddingRight: 8,
    borderRadius: 24,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchPillWide: {
    maxWidth: 560,
    height: 50,
    borderRadius: 25,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  chipsScroll: {
    flexGrow: 0,
    marginHorizontal: -16,
  },
  chipsScrollContent: {
    gap: 8,
    paddingHorizontal: 16,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  caption: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  mapButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 16,
    height: 46,
    paddingHorizontal: 20,
    borderRadius: 23,
    backgroundColor: colors.navy,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapButtonText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.white,
  },

  wideShell: {
    flex: 1,
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 26,
  },
  wideHead: {
    gap: 14,
    marginBottom: 18,
  },
  wideTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  wideTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
  },
  wideList: {
    paddingBottom: 48,
  },
});
