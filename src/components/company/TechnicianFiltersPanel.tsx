// El panel de filtros de técnicos que comparten la búsqueda y el mapa de
// empresa (rediseño, fase 3B; maquetas W-Filters y WFilters). Un solo panel:
//   - TechnicianFiltersSheet: hoja inferior en móvil y ventana centrada en
//     escritorio (la del mapa), con "Reset" y "Show technicians";
//   - TechnicianFiltersPanel: sólo las secciones, para la columna izquierda de
//     la búsqueda en escritorio.
//
// El panel edita un BORRADOR; nada filtra hasta "Show technicians". Qué
// secciones y opciones salen y qué se limpia al cambiar algo lo deciden las
// funciones puras de src/utils/technicianFilters.ts, con los catálogos del
// repo (ratings y motores) y las reglas de licencia de src/constants/licenses.ts.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { BottomSheet, Chip, RemovableChip, Text, TextInput, Toggle } from '../ui';
import { colors } from '../../theme';
import { TOUCH_TARGET } from '../../theme/ui';
import { CountryCityPicker } from '../CountryCityPicker';
import { useAircraftTypeRatingsCatalog } from '../../state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../state/useEnginesCatalog';
import { TECHNICIAN_TYPES } from '../../constants/technicianTypes';
import { getEngineLabel, searchEngines } from '../../constants/engines';
import { getByProductType, getFamilies, searchRatings } from '../../constants/aircraftTypeRatingViews';
import { authorityLabel, credentialLabel } from '../../constants/licenses';
import {
  AUTHORITY_FILTER_OPTIONS,
  AVAILABILITY_FILTER_OPTIONS,
  EMPTY_TECHNICIAN_FILTERS,
  PRODUCT_FILTER_OPTIONS,
  buildFamilyProductMap,
  isEngineSectionVisible,
  isLicenceSectionVisible,
  licenceCategoryOptions,
  setLicenceAuthority,
  setProductFilter,
  toggleTechnicianType,
  toggleValue,
  type FamilyProductMap,
  type TechnicianFilterState,
} from '../../utils/technicianFilters';
import { technicianTypeLabel } from '../../constants/technicianTypes';
import { PillButton, SegmentedControl, ButtonRow } from './CompanyPage';

const MAX_SUGGESTIONS = 5;

/** Catálogos que necesitan el panel y los resúmenes: familias y motores con su nombre. */
export function useTechnicianFilterCatalogs() {
  const aircraft = useAircraftTypeRatingsCatalog();
  const engines = useEnginesCatalog();
  const families = useMemo(() => getFamilies(aircraft.ratings), [aircraft.ratings]);
  const familyProducts = useMemo<FamilyProductMap>(() => buildFamilyProductMap(aircraft.ratings), [aircraft.ratings]);
  const familyLabel = useMemo(() => {
    const byKey = new Map(families.map((f) => [f.key, f.displayName]));
    // Una clave que el catálogo cargado ya no tiene se enseña tal cual antes
    // que desaparecer (misma regla que resolveFamilyKeyLabels).
    return (key: string) => byKey.get(key) ?? key;
  }, [families]);
  const engineLabel = (id: string) => getEngineLabel(id, engines.engineIndex);
  return { aircraft, engines, familyProducts, familyLabel, engineLabel };
}

/** Las opciones en uso, como etiquetas cortas (los chips junto a "Filters · N"). */
export function technicianFilterSummary(
  state: TechnicianFilterState,
  familyLabel: (key: string) => string,
  engineLabel: (id: string) => string,
): string[] {
  const licenceOn = isLicenceSectionVisible(state.technicianTypes);
  const authority = state.licenseAuthority === 'any' ? undefined : state.licenseAuthority;
  return [
    ...state.technicianTypes.map(technicianTypeLabel),
    ...(state.product !== 'any' ? [PRODUCT_FILTER_OPTIONS.find((p) => p.value === state.product)?.label ?? state.product] : []),
    ...(licenceOn
      ? state.licenseCodes.length > 0
        ? state.licenseCodes.map((code) => credentialLabel(authority, code))
        : authority ? [`${authorityLabel(authority)} licence`] : []
      : []),
    ...state.aircraftFamilyKeys.map(familyLabel),
    ...(isEngineSectionVisible(state.technicianTypes) ? state.engineIds.map(engineLabel) : []),
    ...(state.location.city ? [state.location.city.name] : []),
    ...(state.location.country ? [state.location.country.name] : []),
    ...state.availability.map((a) => AVAILABILITY_FILTER_OPTIONS.find((o) => o.value === a)?.label ?? a),
    ...(state.verifiedOnly ? ['Verified only'] : []),
  ];
}

export function TechnicianFiltersPanel({
  value,
  onChange,
}: {
  value: TechnicianFilterState;
  onChange: (next: TechnicianFilterState) => void;
}) {
  const { aircraft, engines, familyProducts, familyLabel, engineLabel } = useTechnicianFilterCatalogs();
  const [aircraftQuery, setAircraftQuery] = useState('');
  const [engineQuery, setEngineQuery] = useState('');

  const licenceVisible = isLicenceSectionVisible(value.technicianTypes);
  const engineVisible = isEngineSectionVisible(value.technicianTypes);
  const categories = licenceCategoryOptions(value.technicianTypes, value.product, value.licenseAuthority);

  // Las familias que se pueden añadir: del producto elegido, que casen con lo
  // escrito y que no estén ya puestas.
  const familySuggestions = useMemo(() => {
    const pool = value.product === 'any' ? aircraft.ratings : getByProductType(aircraft.ratings, value.product);
    return getFamilies(searchRatings(pool, aircraftQuery))
      .filter((f) => !value.aircraftFamilyKeys.includes(f.key))
      .slice(0, MAX_SUGGESTIONS);
  }, [aircraft.ratings, value.product, aircraftQuery, value.aircraftFamilyKeys]);

  const engineSuggestions = useMemo(
    () => searchEngines(engines.engines, engineQuery)
      .filter((e) => !value.engineIds.includes(e.id))
      .slice(0, MAX_SUGGESTIONS),
    [engines.engines, engineQuery, value.engineIds],
  );

  const aircraftPlaceholder = value.product === 'Helicopter'
    ? 'Search helicopters'
    : value.product === 'Aeroplane' ? 'Search airplanes' : 'Search aircraft';

  return (
    <View style={styles.panel}>
      <Text style={styles.rule}>Any option within a section, and every section you use.</Text>

      <Section title="What they do">
        <View style={styles.chips}>
          {TECHNICIAN_TYPES.filter((t) => t.isActive).map((type) => (
            <Chip
              key={type.code}
              label={type.label}
              selected={value.technicianTypes.includes(type.code)}
              onPress={() => onChange(toggleTechnicianType(value, type.code, familyProducts))}
            />
          ))}
        </View>
      </Section>

      <Section title="Airplanes or helicopters">
        <SegmentedControl
          options={PRODUCT_FILTER_OPTIONS}
          value={value.product}
          onChange={(product) => onChange(setProductFilter(value, product, familyProducts))}
          accessibilityLabel="Airplanes or helicopters"
        />
      </Section>

      {licenceVisible ? (
        <Section title="Licence">
          <View style={styles.chips}>
            {AUTHORITY_FILTER_OPTIONS.map((a) => (
              <Chip
                key={a.value}
                label={a.label}
                selected={value.licenseAuthority === a.value}
                onPress={() => onChange(setLicenceAuthority(value, a.value, familyProducts))}
              />
            ))}
          </View>
          {categories.length > 0 ? (
            <View style={styles.chips}>
              {categories.map((code) => (
                <Chip
                  key={code}
                  variant="option"
                  label={code}
                  selected={value.licenseCodes.includes(code)}
                  onPress={() => onChange({ ...value, licenseCodes: toggleValue(value.licenseCodes, code) })}
                />
              ))}
            </View>
          ) : null}
          <Text style={styles.hint}>Only the categories that fit what they do and the aircraft you picked.</Text>
        </Section>
      ) : (
        <View style={styles.note}>
          <Text style={styles.noteText}>No licence filter: the trades you picked work without a licence.</Text>
        </View>
      )}

      <Section title="Aircraft">
        <SearchAndAdd
          picked={value.aircraftFamilyKeys.map((key) => ({ id: key, label: familyLabel(key) }))}
          onRemove={(key) => onChange({ ...value, aircraftFamilyKeys: value.aircraftFamilyKeys.filter((k) => k !== key) })}
          query={aircraftQuery}
          onQuery={setAircraftQuery}
          placeholder={aircraftPlaceholder}
          searchLabel="Search aircraft"
          state={aircraft.state}
          onRetry={aircraft.retry}
          suggestions={familySuggestions.map((f) => ({ id: f.key, label: f.displayName }))}
          onAdd={(key) => {
            onChange({ ...value, aircraftFamilyKeys: [...value.aircraftFamilyKeys, key] });
            setAircraftQuery('');
          }}
          emptyText="No aircraft found."
        />
      </Section>

      {engineVisible ? (
        <Section title="Engine">
          <SearchAndAdd
            picked={value.engineIds.map((id) => ({ id, label: engineLabel(id) }))}
            onRemove={(id) => onChange({ ...value, engineIds: value.engineIds.filter((e) => e !== id) })}
            query={engineQuery}
            onQuery={setEngineQuery}
            placeholder="Search engine"
            searchLabel="Search engine"
            state={engines.state}
            onRetry={engines.retry}
            suggestions={engineSuggestions.map((e) => ({ id: e.id, label: e.displayName, detail: e.manufacturer }))}
            onAdd={(id) => {
              onChange({ ...value, engineIds: [...value.engineIds, id] });
              setEngineQuery('');
            }}
            emptyText="No engines found."
          />
        </Section>
      ) : null}

      <Section title="Country and city">
        <CountryCityPicker
          value={value.location}
          onChange={(location) => onChange({ ...value, location })}
          countryRequired={false}
          countryPlaceholder="Any country"
          cityPlaceholder="Any city"
        />
      </Section>

      <Section title="Availability">
        <View style={styles.chips}>
          {AVAILABILITY_FILTER_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={value.availability.includes(option.value)}
              onPress={() => onChange({ ...value, availability: toggleValue(value.availability, option.value) })}
            />
          ))}
        </View>
      </Section>

      {/* Sólo el interruptor responde: una fila pulsable alrededor lo
          cambiaría dos veces en web con un solo clic. */}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Verified only</Text>
        <Toggle
          value={value.verifiedOnly}
          onChange={(verifiedOnly) => onChange({ ...value, verifiedOnly })}
          accessibilityLabel="Verified only"
        />
      </View>
    </View>
  );
}

/** El panel en hoja inferior (móvil) o ventana centrada (escritorio), con sus dos botones. */
export function TechnicianFiltersSheet({
  visible,
  value,
  onChange,
  onClose,
  onApply,
}: {
  visible: boolean;
  value: TechnicianFilterState;
  onChange: (next: TechnicianFilterState) => void;
  onClose: () => void;
  onApply: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Filter technicians"
      footer={(
        <ButtonRow>
          <PillButton label="Reset" variant="outline" size="md" onPress={() => onChange(EMPTY_TECHNICIAN_FILTERS)} grow={1} />
          <PillButton label="Show technicians" size="md" onPress={onApply} grow={1.6} />
        </ButtonRow>
      )}
    >
      <TechnicianFiltersPanel value={value} onChange={onChange} />
    </BottomSheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

function SearchAndAdd({
  picked,
  onRemove,
  query,
  onQuery,
  placeholder,
  searchLabel,
  state,
  onRetry,
  suggestions,
  onAdd,
  emptyText,
}: {
  picked: { id: string; label: string }[];
  onRemove: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  searchLabel: string;
  state: 'loading' | 'success' | 'empty' | 'error';
  onRetry: () => void;
  suggestions: { id: string; label: string; detail?: string }[];
  onAdd: (id: string) => void;
  emptyText: string;
}) {
  return (
    <View style={styles.searchBlock}>
      {picked.length > 0 ? (
        <View style={styles.chips}>
          {picked.map((p) => <RemovableChip key={p.id} label={p.label} onRemove={() => onRemove(p.id)} />)}
        </View>
      ) : null}
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={onQuery}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={searchLabel}
      />
      {state === 'loading' ? (
        <View style={styles.stateRow}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.hint}>Loading catalog…</Text>
        </View>
      ) : state === 'error' ? (
        <View style={styles.stateRow}>
          <Text style={styles.error}>Could not load the catalog.</Text>
          <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : suggestions.length === 0 ? (
        <Text style={styles.hint}>{emptyText}</Text>
      ) : (
        <View>
          {suggestions.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => onAdd(s.id)}
              style={({ pressed, hovered }: any) => [styles.suggestion, (pressed || hovered) && styles.suggestionPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Add ${s.label}`}
            >
              <Plus color={colors.primary} size={16} strokeWidth={2.6} />
              <Text style={styles.suggestionText} numberOfLines={1}>{s.label}</Text>
              {s.detail ? <Text style={styles.suggestionDetail} numberOfLines={1}>{s.detail}</Text> : null}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 20,
  },
  rule: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  hint: {
    fontSize: 12.5,
    color: colors.textMuted,
  },
  note: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
  },
  noteText: {
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  searchBlock: {
    gap: 8,
  },
  search: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    fontSize: 14.5,
    color: colors.text,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  error: {
    fontSize: 13,
    color: colors.error,
  },
  retry: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  suggestionPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  suggestionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  suggestionDetail: {
    flexShrink: 0,
    maxWidth: '40%',
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.textMuted,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: TOUCH_TARGET,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
});
