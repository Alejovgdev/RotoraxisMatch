import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { EngineCatalog } from '../types/catalog';
import { engineTypeLabel, searchEngines } from '../constants/engines';
import { useEnginesCatalog } from '../state/useEnginesCatalog';

interface Props {
  /**
   * Motor elegido. Puede ser una fila inactiva (un motor desactivado después
   * de elegirlo) o genérica (una familia sin modelo, guardada antes de que su
   * fila pasara a genérica): se pinta, no se vuelve a ofrecer.
   */
  value?: string | null;
  onSelect: (engine: EngineCatalog) => void;
  /** Ids que no se ofrecen (los que el técnico ya ha declarado). */
  excludeIds?: readonly string[];
  placeholder?: string;
  maxResults?: number;
}

// Selector de motor del catálogo `engines` (Fase 10, paso 5b). Lo usan el
// formulario de oferta de motor y el editor de motores del perfil. Mismo
// patrón que AircraftTypeRatingPicker: catálogo de Supabase por la caché
// compartida (useEnginesCatalog), estados explícitos de carga y error con
// reintento, búsqueda en memoria sobre 164 filas. Sólo ofrece motores activos
// y no genéricos (searchEngines): una genérica no dice qué modelo es.
export function EnginePicker({ value, onSelect, excludeIds = [], placeholder, maxResults = 20 }: Props) {
  const { engines, engineIndex, state, error, retry } = useEnginesCatalog();
  const [query, setQuery] = useState('');

  const selected = value ? engineIndex.get(value) ?? null : null;
  const results = useMemo(() => {
    const excluded = new Set(excludeIds);
    return searchEngines(engines, query).filter((e) => !excluded.has(e.id)).slice(0, maxResults);
  }, [engines, query, excludeIds, maxResults]);

  return (
    <View style={styles.wrap}>
      {selected ? (
        <View style={styles.selectedRow}>
          <View style={styles.selectedTextBlock}>
            <Text style={styles.selectedTitle} numberOfLines={1}>{selected.displayName}</Text>
            <Text style={styles.selectedSubtitle} numberOfLines={1}>
              {selected.manufacturer} · {selected.family} family · {engineTypeLabel(selected.engineType)}
            </Text>
          </View>
          {selected.isGeneric ? (
            <View style={styles.inactiveBadge}>
              <Text style={styles.inactiveBadgeText}>Model not specified</Text>
            </View>
          ) : !selected.isActive ? (
            <View style={styles.inactiveBadge}>
              <Text style={styles.inactiveBadgeText}>Inactive catalog entry</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {state === 'loading' && (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.statusText}>Loading engines…</Text>
        </View>
      )}

      {state === 'error' && (
        <View style={styles.statusRow}>
          <Text style={styles.errorText}>We couldn&apos;t load the engine catalog.</Text>
          <TouchableOpacity onPress={retry} style={styles.retryButton} activeOpacity={0.75}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {state === 'error' && error ? <Text style={styles.errorDetail}>{error.message}</Text> : null}

      {state === 'empty' && <Text style={styles.statusText}>No engines are available right now.</Text>}

      {state === 'success' && (
        <>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder ?? 'Search: CFM56-7B, LEAP, PT6A, Arriel, turboshaft…'}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ScrollView style={styles.results} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {results.map((e) => (
              <TouchableOpacity
                key={e.id}
                style={[styles.resultRow, value === e.id && styles.resultRowSelected]}
                onPress={() => onSelect(e)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={e.displayName}
              >
                <Text style={styles.resultTitle} numberOfLines={1}>{e.displayName}</Text>
                <Text style={styles.resultSubtitle} numberOfLines={1}>
                  {e.manufacturer} · {engineTypeLabel(e.engineType)}
                </Text>
              </TouchableOpacity>
            ))}
            {results.length === 0 ? (
              <Text style={styles.emptyText}>No matches — try a manufacturer, family or engine type.</Text>
            ) : null}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.cyan + '55',
    backgroundColor: colors.cyan + '14',
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selectedTextBlock: { flex: 1, minWidth: 0, gap: 1 },
  selectedTitle: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.text },
  selectedSubtitle: { fontSize: 11, lineHeight: 15, fontWeight: '500', color: colors.textMuted },
  inactiveBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.warning + '22' },
  inactiveBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400E' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { fontSize: 12, lineHeight: 16, color: colors.textMuted },
  errorText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.error },
  errorDetail: { fontSize: 11, lineHeight: 15, color: colors.textMuted },
  retryButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  retryButtonText: { fontSize: 12, fontWeight: '700', color: colors.text },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.white,
  },
  results: { maxHeight: 220 },
  resultRow: { paddingVertical: 8, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border + '66' },
  resultRowSelected: { backgroundColor: colors.cyan + '14' },
  resultTitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.text },
  resultSubtitle: { fontSize: 11, lineHeight: 15, color: colors.textMuted },
  emptyText: { fontSize: 12, lineHeight: 16, color: colors.textMuted, paddingVertical: spacing.xs },
});
