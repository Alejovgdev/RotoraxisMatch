import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { AircraftTypeRatingCatalog } from '../types/catalog';
import { searchRatings, getByProductType } from '../constants/aircraftTypeRatingViews';
import { catalogRepository } from '../repositories/v2/catalogRepository';
import { useAircraftTypeRatingsCatalog } from '../state/useAircraftTypeRatingsCatalog';

// Fase 3b.4 — pre-filters the picker to a productType facet once the
// caller knows a compatible one (e.g. from getLicenseRatingProductType(),
// keyed off whichever license category the surrounding form has selected).
// Help, not a cage: always shown with a discrete hint and a "Show all"
// escape hatch — never a hard block on picking outside the facet.
export interface AircraftTypeRatingPickerCategoryHint {
  productType: NonNullable<AircraftTypeRatingCatalog['productType']>;
  licenseCode: string; // for the hint text, e.g. "compatible with B1.3"
}

/**
 * Migración 047 — un facet productType SIN escotilla de escape, al contrario
 * que `categoryHint`. Existe porque hay un caso donde salirse del facet no es
 * "poco habitual" sino IMPOSIBLE de guardar: en el formulario de oferta, la
 * empresa ya ha declarado aviones o helicópteros y las FK compuestas
 * (orh_matches_offer / orh_matches_rating) rechazan en Postgres cualquier
 * rating del otro producto. Ofrecer un "Show all" ahí sería invitar a elegir
 * algo que el motor va a rechazar al guardar.
 *
 * Regla: `categoryHint` para lo improbable-pero-legal (perfil del técnico),
 * esto para lo imposible. Si ambos llegan, gana éste.
 */
export interface AircraftTypeRatingPickerLockedProductType {
  productType: NonNullable<AircraftTypeRatingCatalog['productType']>;
  reason: string; // por qué está acotado, p. ej. "this offer is for helicopters"
}

interface Props {
  value?: string | null;
  onSelect: (rating: AircraftTypeRatingCatalog) => void;
  placeholder?: string;
  maxResults?: number;
  categoryHint?: AircraftTypeRatingPickerCategoryHint;
  lockedProductType?: AircraftTypeRatingPickerLockedProductType;
  /** Hard scope restriction, applied before text search and the result limit. */
  isRatingAllowed?: (rating: AircraftTypeRatingCatalog) => boolean;
}

// El vocabulario EASA ('Aeroplane') no es el que usa nadie al hablar; en
// pantalla se dice "Airplanes"/"Helicopters". Los valores sin traducción
// propia (p. ej. 'Gas Airship') salen tal cual antes que inventarles una.
function productTypeNoun(productType: NonNullable<AircraftTypeRatingCatalog['productType']>): string {
  if (productType === 'Aeroplane') return 'Airplanes';
  if (productType === 'Helicopter') return 'Helicopters';
  return productType;
}

// Shared aircraft+engine rating search picker — used by the technician
// habilitations form and the company offer requirement form. The catalog is
// loaded from Supabase (public.aircraft_type_ratings) through the shared
// useAircraftTypeRatingsCatalog hook/cache — never a hardcoded list — and
// searched in memory via the views module (searchRatings/getByProductType,
// src/constants/aircraftTypeRatingViews.ts — the single source every screen
// with a rating picker/filter goes through), which is plenty for a few
// hundred rows. No web-only APIs: TextInput/ScrollView/TouchableOpacity/
// ActivityIndicator all work the same on web, iOS and Android.
export function AircraftTypeRatingPicker({ value, onSelect, placeholder, maxResults = 25, categoryHint, lockedProductType, isRatingAllowed }: Props) {
  const { ratings, state, error, retry } = useAircraftTypeRatingsCatalog();
  const [query, setQuery] = useState('');
  // Escape hatch for categoryHint — "Show all" — resets whenever the hint
  // itself changes (a new license category deserves a fresh pre-filter).
  const [hintDismissed, setHintDismissed] = useState(false);
  useEffect(() => {
    setHintDismissed(false);
  }, [categoryHint?.productType, categoryHint?.licenseCode]);

  // The active list from the hook may not include `value` if that rating
  // was deactivated after being selected on an existing profile/offer. Fall
  // back to a direct (still-cached, batched) lookup that does not filter by
  // is_active, so a previously-saved-but-now-inactive rating still resolves
  // to a real label instead of a bare UUID.
  const [inactiveSelected, setInactiveSelected] = useState<AircraftTypeRatingCatalog | null>(null);
  const selectedFromActiveList = value ? ratings.find((r) => r.id === value) ?? null : null;

  useEffect(() => {
    if (!value || selectedFromActiveList) {
      setInactiveSelected(null);
      return;
    }
    let cancelled = false;
    catalogRepository.getAircraftTypeRatingById(value).then((rating) => {
      if (!cancelled) setInactiveSelected(rating);
    });
    return () => {
      cancelled = true;
    };
  }, [value, selectedFromActiveList]);

  const selected = selectedFromActiveList ?? inactiveSelected;

  // El facet duro gana al blando: donde el producto está acotado por la propia
  // oferta no tiene sentido seguir sugiriendo el de la licencia.
  const activeHint = !lockedProductType && categoryHint && !hintDismissed ? categoryHint : null;
  const activeProductType = lockedProductType?.productType ?? activeHint?.productType ?? null;

  // Search results only ever come from the ACTIVE list — an inactive rating
  // can be displayed (above) but never re-selected as a new relationship.
  const results = useMemo(() => {
    const pool = activeProductType ? getByProductType(ratings, activeProductType) : ratings;
    return searchRatings(isRatingAllowed ? pool.filter(isRatingAllowed) : pool, query).slice(0, maxResults);
  }, [ratings, query, maxResults, activeProductType, isRatingAllowed]);

  return (
    <View style={styles.wrap}>
      {selected ? (
        <View style={styles.selectedRow}>
          <View style={styles.selectedTextBlock}>
            <Text style={styles.selectedTitle} numberOfLines={1}>{selected.displayName}</Text>
            <Text style={styles.selectedSubtitle} numberOfLines={1}>{selected.easaEndorsement}</Text>
          </View>
          {!selected.isActive ? (
            <View style={styles.inactiveBadge}>
              <Text style={styles.inactiveBadgeText}>Inactive catalog entry</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {state === 'loading' && (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.statusText}>Loading aircraft ratings…</Text>
        </View>
      )}

      {state === 'error' && (
        <View style={styles.statusRow}>
          <Text style={styles.errorText}>We couldn&apos;t load the aircraft ratings catalog.</Text>
          <TouchableOpacity onPress={retry} style={styles.retryButton} activeOpacity={0.75}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {state === 'error' && error ? <Text style={styles.errorDetail}>{error.message}</Text> : null}

      {state === 'empty' && (
        <Text style={styles.statusText}>No aircraft ratings are available right now.</Text>
      )}

      {(state === 'success' || state === 'empty') && (
        <>
          {lockedProductType ? (
            <View style={styles.hintRow}>
              <Text style={styles.hintText}>
                {productTypeNoun(lockedProductType.productType)} only — {lockedProductType.reason}
              </Text>
            </View>
          ) : activeHint ? (
            <View style={styles.hintRow}>
              <Text style={styles.hintText}>
                Showing only {productTypeNoun(activeHint.productType).toLowerCase()} — compatible with {activeHint.licenseCode}
              </Text>
              <TouchableOpacity onPress={() => setHintDismissed(true)} accessibilityRole="button">
                <Text style={styles.hintAction}>Show all</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder ?? 'Search: A320neo, LEAP, CFM56, H145, Dash 8, Global 6000…'}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={state === 'success'}
          />
          <ScrollView style={styles.results} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {results.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={[styles.resultRow, value === r.id && styles.resultRowSelected]}
                onPress={() => onSelect(r)}
                activeOpacity={0.7}
              >
                <Text style={styles.resultTitle} numberOfLines={1}>{r.displayName}</Text>
                <Text style={styles.resultSubtitle} numberOfLines={1}>{r.easaEndorsement}</Text>
              </TouchableOpacity>
            ))}
            {results.length === 0 ? (
              <Text style={styles.emptyText}>No matches — try a different manufacturer, family, engine or alias.</Text>
            ) : null}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
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
  selectedTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  selectedTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.text,
  },
  selectedSubtitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    color: colors.textMuted,
  },
  inactiveBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.warning + '22',
  },
  inactiveBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  hintText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    fontStyle: 'italic',
    color: colors.textMuted,
  },
  hintAction: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.cyan,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.error,
    flexShrink: 1,
  },
  errorDetail: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  retryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  results: {
    maxHeight: 220,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 12,
  },
  resultRow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  resultRowSelected: {
    backgroundColor: colors.cyan + '14',
  },
  resultTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.text,
  },
  resultSubtitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    color: colors.textMuted,
  },
  emptyText: {
    padding: spacing.sm,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
});
