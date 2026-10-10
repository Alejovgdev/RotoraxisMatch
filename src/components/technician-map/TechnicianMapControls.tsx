// Los controles que flotan sobre el mapa de técnicos de empresa: la cabecera
// (atrás, título, cuántos hay, "Filters" y "List") y la leyenda.
//
// Rediseño, fase 3B (respuesta 22): el mapa se queda como estaba —marcadores,
// colores, agrupación y hojas— y sólo cambian estos controles de alrededor y el
// botón nuevo para volver a la lista. El panel de filtros lo abre quien monta
// el mapa: es el mismo que el de la búsqueda.
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ChevronLeft, List, SlidersHorizontal } from 'lucide-react-native';
import { Text } from '../ui/Text';
import { colors } from '../../theme';
import { TOUCH_TARGET, WIDE_BREAKPOINT } from '../../theme/ui';

/** Ancho de la cabecera del mapa en escritorio. */
const MAP_HEADER_MAX_WIDTH = 560;

// Los mismos colores que pintan los marcadores (TechnicianMapLeafletImpl y el
// WebView de TechnicianMap.native), para que la leyenda explique lo que se ve.
const LEGEND = {
  available: '#10B981',
  unavailable: '#94A3B8',
  group: '#0A1628',
} as const;

export const TECHNICIAN_MAP_AVAILABILITY = [
  { value: 'open_to_offers' as const, label: 'Open to offers', color: LEGEND.available },
  { value: 'unavailable' as const, label: 'Unavailable', color: LEGEND.unavailable },
] as const;

export function TechnicianMapHeader({
  visibleCount,
  filterCount,
  loading,
  onBack,
  onOpenFilters,
  onShowList,
}: {
  visibleCount: number;
  filterCount: number;
  loading: boolean;
  onBack?: () => void;
  onOpenFilters: () => void;
  onShowList?: () => void;
}) {
  // En un teléfono estrecho los dos botones se quedan en icono, como antes
  // "Filters": la cabecera no debe partirse en dos filas y tapar el zoom.
  const { width } = useWindowDimensions();
  const compact = width < 520;
  // Escritorio: la barra superior ya lleva la navegación; sin flecha (fase 8).
  const wide = width >= WIDE_BREAKPOINT;
  const subtitle = filterCount > 0
    ? `${visibleCount} matching technician${visibleCount === 1 ? '' : 's'} · ${filterCount} active filter${filterCount === 1 ? '' : 's'}`
    : `${visibleCount} technician${visibleCount === 1 ? '' : 's'} on the map`;

  return (
    <View style={[styles.header, wide && styles.headerWide]}>
      {onBack && !wide ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={4}
          style={styles.back}
        >
          <ChevronLeft color={colors.text} size={26} strokeWidth={2.2} />
        </Pressable>
      ) : null}

      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">Technician map</Text>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.subtitle} numberOfLines={1}>Loading technicians...</Text>
          </View>
        ) : (
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} active` : 'Filters'}
        onPress={onOpenFilters}
        style={({ pressed, hovered }: any) => [styles.pill, (pressed || hovered) && styles.pillPressed]}
      >
        <SlidersHorizontal color={colors.text} size={17} strokeWidth={2.2} />
        {compact
          ? (filterCount > 0 ? <Text style={styles.pillText}>{filterCount}</Text> : null)
          : <Text style={styles.pillText}>{filterCount > 0 ? `Filters · ${filterCount}` : 'Filters'}</Text>}
      </Pressable>

      {onShowList ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show as list"
          onPress={onShowList}
          style={({ pressed, hovered }: any) => [styles.pill, (pressed || hovered) && styles.pillPressed]}
        >
          <List color={colors.text} size={17} strokeWidth={2.2} />
          {!compact ? <Text style={styles.pillText}>List</Text> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

export function TechnicianMapLegend() {
  return (
    <View style={styles.legend} pointerEvents="none">
      <View style={styles.legendGrid}>
        {TECHNICIAN_MAP_AVAILABILITY.map((item) => (
          <View key={item.value} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.legendItem}>
        <View style={styles.groupDot}>
          <Text style={styles.groupDotText}>2</Text>
        </View>
        <Text style={styles.legendText}>Several technicians</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={styles.precisionDot} />
        <Text style={styles.legendText}>Country-level location</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 1,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pill: {
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
  pillPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 18,
    zIndex: 1001,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    gap: 5,
  },
  legendGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#33465A',
  },
  precisionDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#33465A',
  },
  groupDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LEGEND.group,
  },
  groupDotText: {
    color: colors.white,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '800',
  },
});
