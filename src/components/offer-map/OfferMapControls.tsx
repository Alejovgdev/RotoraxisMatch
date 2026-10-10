import AsyncStorage from '@react-native-async-storage/async-storage';
import { Avatar } from '../ui/Avatar';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '../ui/Text';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  List,
  MapPin,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react-native';
import { colors, spacing } from '../../theme';
import { CONTRACT_TYPES } from '../../constants/contractTypes';
import { OFFER_PRODUCT_TYPES } from '../../constants/offerProductTypes';
import {
  activeOfferMapFilterCount,
  getOfferMapMatchBand,
  OfferMapFilters,
  OfferMapItem,
  OfferMapMarkerTier,
  OfferMapMatchBand,
} from '../../types/offerMap';
import { buildOfferMapMarkerIcon, type OfferMapMarkerIcon } from '../../utils/offerMapMarkerIcon';
import { offerMapGroupIconOptions } from '../../utils/offerMapMarkerTier';
import { ContractTypeCode } from '../../types/catalog';
import { OfferProductType } from '../../types/offer';
import { techUi } from '../technician/TechnicianUI';
import { MapBottomSheet } from '../map/MapBottomSheet';
import { TOUCH_TARGET, WIDE_BREAKPOINT } from '../../theme/ui';

/** Ancho de la cabecera del mapa en escritorio. */
const MAP_HEADER_MAX_WIDTH = 560;
import { formatOfferSalary } from '../../utils/offerSalary';

export const OFFER_MAP_MATCH_OPTIONS: readonly {
  value: OfferMapMatchBand;
  label: string;
  shortLabel: string;
  color: string;
}[] = [
  { value: 'excellent', label: 'Excellent · 80–100%', shortLabel: '80–100%', color: colors.success },
  { value: 'strong', label: 'Strong · 60–79%', shortLabel: '60–79%', color: colors.blue },
  { value: 'partial', label: 'Partial · 40–59%', shortLabel: '40–59%', color: colors.warning },
  { value: 'weak', label: 'Weak · under 40%', shortLabel: '< 40%', color: colors.textMuted },
];

export function offerMapMarkerColor(offer: Pick<OfferMapItem, 'score' | 'blockers'>): string {
  if (offer.blockers.length > 0) return techUi.red;
  const band = getOfferMapMatchBand(offer.score);
  return OFFER_MAP_MATCH_OPTIONS.find((option) => option.value === band)?.color ?? colors.textMuted;
}

export function offerMapLabelColor(offer: Pick<OfferMapItem, 'score' | 'blockers'>): string {
  if (offer.blockers.length > 0) return techUi.red;
  const band = getOfferMapMatchBand(offer.score);
  if (band === 'excellent') return techUi.green;
  if (band === 'strong') return techUi.blue;
  if (band === 'partial') return techUi.amber;
  return techUi.textSoft;
}

export function offerMapContractLabel(value: string): string {
  return CONTRACT_TYPES.find((option) => option.code === value)?.label ?? value;
}

export function offerMapProductLabel(value: OfferProductType): string {
  return OFFER_PRODUCT_TYPES.find((option) => option.code === value)?.label ?? value;
}

export function offerMapApplicationLabel(value?: string): string | null {
  if (value === 'pending') return 'Application pending';
  if (value === 'accepted') return 'Application accepted';
  if (value === 'rejected') return 'Not selected';
  if (value === 'withdrawn') return 'Application withdrawn';
  if (value === 'expired') return 'Application expired';
  return null;
}

const OFFER_MAP_LEGEND_STORAGE_KEY = 'offer-map-legend-collapsed';
const OFFER_MAP_COMPACT_LEGEND_BREAKPOINT = 768;

export interface OfferMapMarkerGroup {
  key: string;
  latitude: number;
  longitude: number;
  locationPrecision: OfferMapItem['locationPrecision'];
  offers: OfferMapItem[];
}

export function groupOfferMapItems(offers: OfferMapItem[]): OfferMapMarkerGroup[] {
  const groups = new Map<string, OfferMapMarkerGroup>();

  offers.forEach((offer) => {
    const key = `${offer.latitude.toFixed(5)}:${offer.longitude.toFixed(5)}:${offer.locationPrecision}`;
    const existing = groups.get(key);
    if (existing) {
      existing.offers.push(offer);
      return;
    }
    groups.set(key, {
      key,
      latitude: offer.latitude,
      longitude: offer.longitude,
      locationPrecision: offer.locationPrecision,
      offers: [offer],
    });
  });

  return [...groups.values()].map((group) => ({
    ...group,
    offers: group.offers.sort((a, b) => {
      const eligibilityDifference = Number(a.blockers.length > 0) - Number(b.blockers.length > 0);
      return eligibilityDifference || b.score - a.score;
    }),
  }));
}

export function offerMapMarkerAccessibilityLabel(group: OfferMapMarkerGroup): string {
  const representative = group.offers[0];
  if (!representative) return 'Offer map marker';
  if (group.offers.length > 1) {
    return `${group.offers.length} offers at ${representative.location}`;
  }
  const precision = group.locationPrecision === 'country' ? ', country-level location' : '';
  const salary = formatOfferSalary(representative.salary) ?? 'Remuneration not specified';
  return `${offerMapContractLabel(representative.contractType)} offer: ${representative.title}, ${representative.companyName}, ${representative.location}, ${salary}, ${representative.score}% match${precision}`;
}

/**
 * Un solo sitio donde se decide el icono de un grupo, para que el mapa web y
 * el WebView nativo no puedan divergir en forma, color ni nivel.
 */
export function offerMapGroupMarkerIcon(
  group: OfferMapMarkerGroup,
  tier: OfferMapMarkerTier,
): OfferMapMarkerIcon {
  const grouped = group.offers.length > 1;
  const color = grouped ? techUi.navy : offerMapMarkerColor(group.offers[0]);
  return buildOfferMapMarkerIcon(offerMapGroupIconOptions(group, tier, color));
}

// Rediseño, fase 5A (respuesta 22): el mapa de ofertas se queda como estaba
// —marcadores, colores, agrupación, filtros y hojas—. Cambia el aspecto de esta
// cabecera, igual que la del mapa de técnicos de empresa, y se añade "List"
// para volver a la lista de ofertas.
export function OfferMapHeader({
  visibleCount,
  totalCount,
  unmappedCount,
  filters,
  onBack,
  onOpenFilters,
  onShowList,
}: {
  visibleCount: number;
  totalCount: number;
  unmappedCount: number;
  filters: OfferMapFilters;
  onBack?: () => void;
  onOpenFilters: () => void;
  /** El botón para volver a la lista de ofertas. */
  onShowList?: () => void;
}) {
  // En un teléfono estrecho los dos botones se quedan en icono, como antes
  // "Filters": la cabecera no debe partirse en dos filas y tapar el zoom.
  const { width } = useWindowDimensions();
  const compact = width < 520;
  // Escritorio: la barra superior ya lleva la navegación; sin flecha (fase 8).
  const wide = width >= WIDE_BREAKPOINT;
  const filterCount = activeOfferMapFilterCount(filters);
  const subtitle = filterCount > 0
    ? `${visibleCount} of ${totalCount} published offers`
    : `${visibleCount} published offer${visibleCount === 1 ? '' : 's'}`;

  return (
    <View style={[styles.header, wide && styles.headerWide]}>
      {onBack && !wide ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={4}
          style={styles.headerBack}
        >
          <ChevronLeft color={colors.text} size={26} strokeWidth={2.2} />
        </Pressable>
      ) : null}

      <View style={styles.headerCopy}>
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">Offer map</Text>
        <Text style={styles.headerSubtitle} numberOfLines={1}>
          {subtitle}{unmappedCount > 0 ? ` · ${unmappedCount} without a map point` : ''}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} active` : 'Filters'}
        onPress={onOpenFilters}
        style={({ pressed, hovered }: any) => [styles.headerPill, (pressed || hovered) && styles.headerPillPressed]}
      >
        <SlidersHorizontal color={colors.text} size={17} strokeWidth={2.2} />
        {compact
          ? (filterCount > 0 ? <Text style={styles.headerPillText}>{filterCount}</Text> : null)
          : <Text style={styles.headerPillText}>{filterCount > 0 ? `Filters · ${filterCount}` : 'Filters'}</Text>}
      </Pressable>

      {onShowList ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show as list"
          onPress={onShowList}
          style={({ pressed, hovered }: any) => [styles.headerPill, (pressed || hovered) && styles.headerPillPressed]}
        >
          <List color={colors.text} size={17} strokeWidth={2.2} />
          {!compact ? <Text style={styles.headerPillText}>List</Text> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

export function OfferMapLegend() {
  const { width } = useWindowDimensions();
  const compact = width < OFFER_MAP_COMPACT_LEGEND_BREAKPOINT;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(OFFER_MAP_LEGEND_STORAGE_KEY)
      .then((value) => {
        if (active) setCollapsed(value === 'true');
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  function updateCollapsed(next: boolean) {
    setCollapsed(next);
    AsyncStorage.setItem(OFFER_MAP_LEGEND_STORAGE_KEY, String(next)).catch(() => undefined);
  }

  if (compact && collapsed) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Expand map legend"
        accessibilityState={{ expanded: false }}
        activeOpacity={0.78}
        onPress={() => updateCollapsed(false)}
        style={styles.legendCollapsed}
      >
        <Text style={styles.legendCollapsedText}>Legend</Text>
        <ChevronUp color={techUi.textSoft} size={17} strokeWidth={2.3} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.legend}>
      <View style={styles.legendHeader}>
        <Text style={styles.legendTitle}>Legend</Text>
        {compact ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Collapse map legend"
            accessibilityState={{ expanded: true }}
            activeOpacity={0.72}
            onPress={() => updateCollapsed(true)}
            style={styles.legendToggle}
          >
            <ChevronDown color={techUi.textSoft} size={17} strokeWidth={2.3} />
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.legendSectionTitle}>Contract type</Text>
      <Text style={styles.legendText}>Single offers show gross pay when provided. Numbers indicate grouped offers.</Text>
      <View style={styles.legendGrid}>
        <LegendContractItem shape="circle" label="Permanent" />
        <LegendContractItem shape="square" label="Long-term" />
        <LegendContractItem shape="diamond" label="Short-term" />
        <LegendContractItem shape="cluster" label="Grouped" />
      </View>

      <Text style={[styles.legendSectionTitle, styles.legendMatchTitle]}>Match score</Text>
      <View style={styles.legendGrid}>
        {OFFER_MAP_MATCH_OPTIONS.map((option) => (
          <View key={option.value} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: option.color }]} />
            <Text style={styles.legendText}>{option.shortLabel}</Text>
          </View>
        ))}
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendBlocked]} />
          <Text style={styles.legendText}>Not eligible</Text>
        </View>
      </View>
    </View>
  );
}

function LegendContractItem({
  shape,
  label,
}: {
  shape: 'circle' | 'square' | 'diamond' | 'cluster';
  label: string;
}) {
  return (
    <View style={styles.legendItem}>
      {shape === 'cluster' ? (
        <View style={styles.legendClusterShape}>
          <Text style={styles.legendClusterText}>2</Text>
        </View>
      ) : (
        <View style={[
          styles.legendContractShape,
          shape === 'circle' && styles.legendCircleShape,
          shape === 'square' && styles.legendSquareShape,
          shape === 'diamond' && styles.legendDiamondShape,
        ]} />
      )}
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

type ArrayFilterKey = 'contractTypes' | 'productTypes' | 'matchBands';

export function OfferMapFilterSheet({
  visible,
  filters,
  onChange,
  onClose,
}: {
  visible: boolean;
  filters: OfferMapFilters;
  onChange: (filters: OfferMapFilters) => void;
  onClose: () => void;
}) {
  const filterCount = activeOfferMapFilterCount(filters);

  function toggle<T extends string>(key: ArrayFilterKey, value: T) {
    const current = (filters[key] ?? []) as T[];
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
    onChange({ ...filters, [key]: next.length > 0 ? next : undefined });
  }

  return (
    <MapBottomSheet
      closeLabel="Close filters"
      contentContainerStyle={styles.sheetContent}
      footer={(
        <>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.75}
            disabled={filterCount === 0}
            onPress={() => onChange({})}
            style={[styles.resetButton, filterCount === 0 && styles.buttonDisabled]}
          >
            <RotateCcw color={techUi.textSoft} size={17} strokeWidth={2.2} />
            <Text style={styles.resetButtonText}>Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.75}
            onPress={onClose}
            style={styles.doneButton}
          >
            <Text style={styles.doneButtonText}>Show offers</Text>
          </TouchableOpacity>
        </>
      )}
      onClose={onClose}
      subtitle="Match any option within a section and every active section."
      title="Filter offers"
      visible={visible}
    >
      <FilterSection title="Contract type">
        {CONTRACT_TYPES.map((option) => (
          <FilterOption
            key={option.code}
            label={option.label}
            selected={Boolean(filters.contractTypes?.includes(option.code))}
            onPress={() => toggle<ContractTypeCode>('contractTypes', option.code)}
          />
        ))}
      </FilterSection>

      <FilterSection title="Aircraft">
        {OFFER_PRODUCT_TYPES.map((option) => (
          <FilterOption
            key={option.code}
            label={option.label}
            selected={Boolean(filters.productTypes?.includes(option.code))}
            onPress={() => toggle<OfferProductType>('productTypes', option.code)}
          />
        ))}
      </FilterSection>

      <FilterSection title="Match score">
        {OFFER_MAP_MATCH_OPTIONS.map((option) => (
          <FilterOption
            key={option.value}
            label={option.label}
            selected={Boolean(filters.matchBands?.includes(option.value))}
            onPress={() => toggle<OfferMapMatchBand>('matchBands', option.value)}
            dotColor={option.color}
          />
        ))}
      </FilterSection>

      <TouchableOpacity
        accessibilityRole="checkbox"
        accessibilityState={{ checked: Boolean(filters.eligibleOnly) }}
        activeOpacity={0.75}
        onPress={() => onChange({ ...filters, eligibleOnly: !filters.eligibleOnly || undefined })}
        style={[styles.eligibilityOption, filters.eligibleOnly && styles.filterOptionSelected]}
      >
        <View style={styles.eligibilityCopy}>
          <Text style={styles.filterOptionText}>Eligible offers only</Text>
          <Text style={styles.filterOptionHelper}>
            Hide roles blocked by the minimum experience requirement.
          </Text>
        </View>
        <SelectionBox selected={Boolean(filters.eligibleOnly)} />
      </TouchableOpacity>
    </MapBottomSheet>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.filterSection}>
      <Text style={styles.filterSectionTitle}>{title}</Text>
      <View style={styles.filterOptions}>{children}</View>
    </View>
  );
}

function FilterOption({
  label,
  selected,
  onPress,
  dotColor,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  dotColor?: string;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      activeOpacity={0.75}
      onPress={onPress}
      style={[styles.filterOption, selected && styles.filterOptionSelected]}
    >
      <View style={styles.optionLabelRow}>
        {dotColor ? <View style={[styles.optionDot, { backgroundColor: dotColor }]} /> : null}
        <Text style={styles.filterOptionText}>{label}</Text>
      </View>
      <SelectionBox selected={selected} />
    </TouchableOpacity>
  );
}

function SelectionBox({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.selectionBox, selected && styles.selectionBoxSelected]}>
      {selected ? <Check color={colors.white} size={15} strokeWidth={3} /> : null}
    </View>
  );
}

export function OfferMapDetailSheet({
  group,
  onClose,
  onViewOffer,
}: {
  group: OfferMapMarkerGroup | null;
  onClose: () => void;
  onViewOffer: (offerId: string) => void;
}) {
  const representative = group?.offers[0];
  const grouped = (group?.offers.length ?? 0) > 1;

  return (
    <MapBottomSheet
      closeLabel="Close offer details"
      contentContainerStyle={styles.detailSheetContent}
      onClose={onClose}
      subtitle={representative?.location}
      title={grouped ? `${group?.offers.length} offers at this location` : 'Offer details'}
      visible={group !== null}
    >
      {group?.offers.map((offer) => {
        const labelColor = offerMapLabelColor(offer);
        const applicationLabel = offerMapApplicationLabel(offer.applicationStatus);
        return (
          <View key={offer.id} style={styles.offerDetailCard}>
            <Text style={styles.offerDetailTitle}>{offer.title}</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}><Avatar kind="company" size={40} name={offer.companyName} logoPath={offer.logoPath} /><Text style={styles.offerDetailCompany}>{offer.companyName}</Text></View>
            <Text style={offer.salary ? styles.offerDetailSalary : styles.offerDetailMeta}>
              {formatOfferSalary(offer.salary) ?? 'Remuneration not specified'}
            </Text>
            <Text style={styles.offerDetailLocation}>
              {offer.location}
              {offer.locationPrecision === 'country' ? ' · Country-level location' : ''}
            </Text>

            <View style={styles.offerDetailChips}>
              <MapDetailChip label={`${offer.score}% match`} color={labelColor} />
              <MapDetailChip
                label={offer.blockers.length > 0 ? 'Not eligible' : offer.matchLabel}
                color={offer.blockers.length > 0 ? techUi.red : labelColor}
              />
              {applicationLabel ? <MapDetailChip label={applicationLabel} color={techUi.green} /> : null}
            </View>

            <Text style={styles.offerDetailMeta}>
              {offerMapContractLabel(offer.contractType)} · {offerMapProductLabel(offer.productType)}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`View offer ${offer.title}`}
              activeOpacity={0.78}
              onPress={() => {
                onClose();
                onViewOffer(offer.id);
              }}
              style={styles.offerDetailButton}
            >
              <Text style={styles.offerDetailButtonText}>View offer</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </MapBottomSheet>
  );
}

function MapDetailChip({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.mapDetailChip}>
      <Text style={[styles.mapDetailChipText, { color }]}>{label}</Text>
    </View>
  );
}

export function OfferMapStatusOverlay({
  kind,
  title,
  message,
  actionLabel,
  onAction,
}: {
  kind: 'empty' | 'error';
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const Icon = kind === 'error' ? AlertTriangle : MapPin;
  return (
    <View style={styles.statusOverlay}>
      <View style={styles.statusCard}>
        <View style={styles.statusIcon}>
          <Icon color={kind === 'error' ? techUi.red : techUi.accent} size={23} strokeWidth={2.1} />
        </View>
        <Text style={styles.statusTitle}>{title}</Text>
        <Text style={styles.statusMessage}>{message}</Text>
        {actionLabel && onAction ? (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.75}
            onPress={onAction}
            style={styles.statusButton}
          >
            <Text style={styles.statusButtonText}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // La cabecera, con los valores de la del mapa de técnicos de empresa
  // (src/components/technician-map/TechnicianMapControls.tsx).
  /** Escritorio (fase 8): a la izquierda y con ancho máximo, no de borde a borde. */
  headerWide: {
    right: 'auto',
    width: MAP_HEADER_MAX_WIDTH,
    maxWidth: '96%',
    // Sin la flecha, el título no se pega al borde.
    paddingLeft: 16,
  },
  header: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 1002,
    minHeight: 64,
    paddingVertical: 8,
    paddingLeft: 4,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E1E8EE',
    backgroundColor: 'rgba(255,255,255,0.97)',
    shadowColor: '#0E1A2B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  headerBack: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerCopy: { flex: 1, minWidth: 0, paddingLeft: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  headerSubtitle: { marginTop: 1, fontSize: 12.5, color: colors.textSecondary },
  headerPill: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: TOUCH_TARGET / 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  headerPillPressed: { backgroundColor: colors.surfaceSoft },
  headerPillText: { fontSize: 14, fontWeight: '800', color: colors.text },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 18,
    zIndex: 1001,
    width: 228,
    padding: 11,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: techUi.border,
    backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#0E1A2B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 6,
  },
  legendCollapsed: {
    position: 'absolute',
    left: 12,
    bottom: 18,
    zIndex: 1001,
    minWidth: 112,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: techUi.border,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#0E1A2B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  legendCollapsedText: { fontSize: 12, fontWeight: '800', color: techUi.text },
  legendHeader: {
    minHeight: 36,
    marginTop: -5,
    marginRight: -5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legendToggle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendTitle: { fontSize: 12, fontWeight: '800', color: techUi.text },
  legendSectionTitle: { marginBottom: 7, fontSize: 10, fontWeight: '800', color: techUi.textMuted },
  legendMatchTitle: {
    marginTop: 9,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: techUi.borderSoft,
  },
  legendGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
  legendItem: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendBlocked: { backgroundColor: techUi.red },
  legendText: { fontSize: 10, lineHeight: 13, fontWeight: '700', color: techUi.textSoft },
  legendContractShape: { width: 11, height: 11, backgroundColor: techUi.textSoft, flexShrink: 0 },
  legendCircleShape: { borderRadius: 6 },
  legendSquareShape: { borderRadius: 2 },
  legendDiamondShape: { transform: [{ rotate: '45deg' }], borderRadius: 1 },
  legendClusterShape: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: techUi.navy,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  legendClusterText: { color: colors.white, fontSize: 8, lineHeight: 10, fontWeight: '800' },
  sheetContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.lg },
  filterSection: { gap: spacing.sm },
  filterSectionTitle: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: techUi.textSoft },
  filterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterOption: {
    minHeight: 44,
    minWidth: 132,
    flexGrow: 1,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: techUi.borderSoft,
    backgroundColor: techUi.surfaceSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  filterOptionSelected: { borderColor: techUi.accent, backgroundColor: techUi.accentSoft },
  optionLabelRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  optionDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  filterOptionText: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.text },
  selectionBox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: techUi.border,
    backgroundColor: techUi.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  selectionBoxSelected: { borderColor: techUi.accent, backgroundColor: techUi.accent },
  eligibilityOption: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: techUi.borderSoft,
    backgroundColor: techUi.surfaceSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  eligibilityCopy: { flex: 1, minWidth: 0 },
  filterOptionHelper: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '500', color: techUi.textMuted },
  detailSheetContent: { gap: spacing.sm },
  offerDetailCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: techUi.borderSoft,
    backgroundColor: techUi.surfaceSoft,
  },
  offerDetailTitle: { paddingRight: 8, fontSize: 15, lineHeight: 20, fontWeight: '800', color: techUi.text },
  offerDetailCompany: { marginTop: 3, fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.textSoft },
  offerDetailSalary: { marginTop: 8, fontSize: 14, lineHeight: 20, fontWeight: '800', color: techUi.text },
  offerDetailLocation: { marginTop: 8, fontSize: 12, lineHeight: 17, fontWeight: '500', color: techUi.textMuted },
  offerDetailChips: { marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  mapDetailChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 11,
    backgroundColor: techUi.surface,
    borderWidth: 1,
    borderColor: techUi.borderSoft,
  },
  mapDetailChipText: { fontSize: 11, lineHeight: 14, fontWeight: '800' },
  offerDetailMeta: { marginTop: 7, fontSize: 11, lineHeight: 15, fontWeight: '600', color: techUi.textMuted },
  offerDetailButton: {
    minHeight: 48,
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: techUi.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerDetailButtonText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  resetButton: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: techUi.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  resetButtonText: { fontSize: 13, fontWeight: '800', color: techUi.textSoft },
  buttonDisabled: { opacity: 0.42 },
  doneButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: techUi.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  statusOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    pointerEvents: 'box-none',
  },
  statusCard: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.lg,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: techUi.border,
    backgroundColor: 'rgba(255,255,255,0.97)',
    alignItems: 'center',
    shadowColor: '#0E1A2B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: techUi.surfaceSoft,
    marginBottom: spacing.sm,
  },
  statusTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800', color: techUi.text, textAlign: 'center' },
  statusMessage: { marginTop: 5, fontSize: 12, lineHeight: 17, fontWeight: '500', color: techUi.textMuted, textAlign: 'center' },
  statusButton: {
    minHeight: 48,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    backgroundColor: techUi.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusButtonText: { color: colors.white, fontSize: 13, fontWeight: '800' },
});
