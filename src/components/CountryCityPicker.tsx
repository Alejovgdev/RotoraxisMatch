import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  ScrollView,
  TextInput,
  StyleSheet,
  SafeAreaView,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { ChevronDown, Search, X, MapPin, PenLine } from 'lucide-react-native';
import { spacing } from '../theme';
import { companyUi } from './company/CompanyUI';
import { countryFlag } from '../constants/countries';
import { CitySelection, CountryCatalogEntry, DirectoryCity, LocationValue } from '../types/location';
import { useCountryCatalog } from '../state/useCountryCatalog';
import { useCitySearch } from '../state/useCitySearch';
import { CityDirectory } from '../repositories/v2/cityDirectoryRepository';

// ============================================================
// CountryCityPicker — el selector de localización del modelo nuevo
// ============================================================
// Fase 7, F2a. País obligatorio del catálogo `location_countries`, ciudad
// OPCIONAL que puede venir del directorio (con coordenadas) o escribirse a
// mano (sin ellas).
//
// ⚠ NO SUSTITUYE TODAVÍA A NADA. `LocationPicker.tsx` sigue vivo, intacto y
// es el que usan las 4 pantallas actuales; éste no lo usa nadie aún. El
// cambio de uno por otro es F2b/F2c.
//
// ── Por qué NO se llama LocationPicker ─────────────────────
// Tener dos `LocationPicker` a la vez, uno por aeropuerto y otro por
// país+ciudad, obliga a mirar el import para saber cuál es cuál. El nombre
// dice qué elige: país y ciudad. Cuando F2c retire el de aeropuertos, este
// nombre seguirá siendo el correcto.
//
// ── Duplicación consciente ─────────────────────────────────
// La carcasa del modal (PickerSheet/SearchField) es un calco de la de
// LocationPicker.tsx. Se duplica a propósito: extraerla a un fichero común
// obligaría a EDITAR LocationPicker.tsx, que esta tanda tiene prohibido
// tocar. La duplicación se resuelve sola cuando F2c borre el viejo.
//
// ── Atribución (obligatoria, no decorativa) ────────────────
// Los datos de ciudades son de GeoNames bajo CC BY 4.0, servidos por
// countries.dev. La licencia EXIGE el crédito: está en el pie del panel de
// ciudad, junto a los datos, y en el aviso legal (terms-of-service, sección
// 15). No lo quites al refactorizar.

const GEONAMES_URL = 'https://www.geonames.org/';

interface CountryCityPickerProps {
  value: LocationValue;
  onChange: (value: LocationValue) => void;
  countryLabel?: string;
  cityLabel?: string;
  /** Forms persist a required country; search filters deliberately allow none. */
  countryRequired?: boolean;
  countryPlaceholder?: string;
  cityPlaceholder?: string;
  /** Inyectable para pruebas o storybook; por defecto el directorio real. */
  cityDirectory?: CityDirectory;
}

export function CountryCityPicker({
  value,
  onChange,
  countryLabel = 'Country',
  cityLabel = 'City',
  countryRequired = true,
  countryPlaceholder = 'Select country',
  cityPlaceholder = 'Add a city (optional)',
  cityDirectory,
}: CountryCityPickerProps) {
  return (
    <View style={styles.group}>
      <CountryField
        label={countryLabel}
        value={value.country}
        required={countryRequired}
        placeholder={countryPlaceholder}
        onChange={(country) =>
          // Cambiar de país TIRA la ciudad. 'Valencia' con las coordenadas de
          // España deja de ser cierto en cuanto el país es Venezuela, y una
          // ciudad heredada de otro país es peor que ningún dato.
          onChange({ country, city: null })
        }
      />
      <CityField
        label={cityLabel}
        countryCode={value.country?.code ?? null}
        countryName={value.country?.name ?? null}
        value={value.city}
        placeholder={cityPlaceholder}
        onChange={(city) => onChange({ ...value, city })}
        directory={cityDirectory}
      />
    </View>
  );
}

// ── País ───────────────────────────────────────────────────

function CountryField({
  label,
  value,
  required,
  placeholder,
  onChange,
}: {
  label: string;
  value: LocationValue['country'];
  required: boolean;
  placeholder: string;
  onChange: (country: LocationValue['country']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { countries, state, error, retry } = useCountryCatalog();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    // Se busca por nombre y por código: quien sepa que es 'DE' no debería
    // tener que acordarse de si la lista dice 'Germany' o 'Deutschland'.
    const normalized = stripDiacritics(q);
    return countries.filter(
      (c) => stripDiacritics(c.name.toLowerCase()).includes(normalized) || c.code.toLowerCase().startsWith(q),
    );
  }, [countries, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function select(entry: CountryCatalogEntry) {
    onChange({ code: entry.code, name: entry.name });
    close();
  }

  function renderCountry(entry: CountryCatalogEntry) {
    const selected = entry.code === value?.code;
    return (
      <TouchableOpacity
        key={entry.code}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={[styles.listItem, selected && styles.listItemSelected]}
        onPress={() => select(entry)}
        activeOpacity={0.7}
      >
        <Text style={styles.flag}>{countryFlag(entry.code)}</Text>
        <View style={styles.itemTextBlock}>
          <Text style={[styles.listItemText, selected && styles.listItemTextSelected]}>{entry.name}</Text>
          <Text style={styles.itemSubtext}>{entry.code}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={required ? styles.requiredMark : styles.optionalMark}>
          {required ? 'Required' : 'Optional'}
        </Text>
      </View>

      {/* EL BOTON DE BORRAR ES HERMANO, NO HIJO. En web cada TouchableOpacity
          se pinta como <button>, y un <button> dentro de otro es HTML invalido:
          React lo avisa y el navegador reestructura el DOM por su cuenta, asi
          que el clic de la "X" deja de ser fiable. El recuadro pasa a ser una
          View y dentro van dos hermanos. El chevron SIGUE dentro del touchable
          -no es un boton, es un indicador-, para que pulsar en el lado derecho
          siga abriendo el selector como antes. */}
      <View style={styles.pickerButton}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={value ? `${label}: ${value.name}` : `${label}: ${placeholder}`}
          style={styles.pickerPressable}
          onPress={() => setOpen(true)}
          activeOpacity={0.75}
        >
          <View style={styles.pickerValueRow}>
            {value ? <Text style={styles.flag}>{countryFlag(value.code)}</Text> : null}
            <Text style={value ? styles.pickerValue : styles.pickerPlaceholder} numberOfLines={1}>
              {value?.name ?? placeholder}
            </Text>
          </View>
          {!required && value ? null : <ChevronDown color={companyUi.textMuted} size={16} strokeWidth={2} />}
        </TouchableOpacity>
        {!required && value ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            onPress={() => onChange(null)}
            hitSlop={10}
            activeOpacity={0.7}
          >
            <X color={companyUi.textMuted} size={16} strokeWidth={2} />
          </TouchableOpacity>
        ) : null}
      </View>

      <PickerSheet visible={open} title="Select country" onClose={close}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search countries..." />

        {/* Los cuatro estados del catálogo, cada uno con su mensaje. 'loading'
            NO comparte pantalla con 'empty': mientras carga no se sabe si hay
            países, y decir "no hay" sería inventarse la respuesta. */}
        {state === 'loading' ? (
          <View style={styles.statusBlock}>
            <ActivityIndicator color={companyUi.accent} />
            <Text style={styles.statusText}>Loading countries...</Text>
          </View>
        ) : state === 'error' ? (
          <View style={styles.statusBlock}>
            <Text style={styles.statusText}>Could not load the country list.</Text>
            <Text style={styles.statusHint}>{error?.message ?? 'Unknown error'}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={retry} activeOpacity={0.75}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : state === 'empty' ? (
          <View style={styles.statusBlock}>
            <Text style={styles.statusText}>The country catalog is empty.</Text>
          </View>
        ) : Platform.OS === 'web' ? (
          /* FlatList uses VirtualizedList, whose native scroll metrics are not
             reliable when a DOM overflow container lives inside this modal.
             A web ScrollView keeps the browser as the sole scroll owner. */
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            {filtered.length > 0
              ? filtered.map(renderCountry)
              : <Text style={styles.emptyText}>No countries match "{query.trim()}".</Text>}
          </ScrollView>
        ) : (
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={filtered}
            keyExtractor={(c) => c.code}
            scrollEnabled
            nestedScrollEnabled
            showsVerticalScrollIndicator
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => renderCountry(item)}
            ListEmptyComponent={<Text style={styles.emptyText}>No countries match "{query.trim()}".</Text>}
          />
        )}
      </PickerSheet>
    </View>
  );
}

// ── Ciudad ─────────────────────────────────────────────────

function CityField({
  label,
  countryCode,
  countryName,
  value,
  placeholder,
  onChange,
  directory,
}: {
  label: string;
  countryCode: string | null;
  countryName: string | null;
  value: CitySelection | null;
  placeholder: string;
  onChange: (city: CitySelection | null) => void;
  directory?: CityDirectory;
}) {
  const [open, setOpen] = useState(false);
  const { query, setQuery, cities, state, retry } = useCitySearch(open ? countryCode : null, { directory });

  const disabled = !countryCode;
  const trimmed = query.trim();

  function close() {
    setOpen(false);
  }

  function selectFromDirectory(city: DirectoryCity) {
    onChange({
      kind: 'directory',
      name: city.name,
      geonameId: city.geonameId,
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: city.timezone,
    });
    close();
  }

  function useTypedText() {
    if (!trimmed) return;
    // Texto libre: SIN coordenadas, y el tipo lo hace explícito. No se
    // intenta emparejarlo con ningún resultado ni "mejorarlo" — si el usuario
    // escribió algo que no está en el directorio, esa es su respuesta.
    onChange({ kind: 'manual', name: trimmed });
    close();
  }

  function renderCity(city: DirectoryCity) {
    const selected = value?.kind === 'directory' && value.geonameId === city.geonameId;
    return (
      <TouchableOpacity
        key={city.geonameId}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={[styles.listItem, selected && styles.listItemSelected]}
        onPress={() => selectFromDirectory(city)}
        activeOpacity={0.7}
      >
        <MapPin color={selected ? companyUi.accent : companyUi.textMuted} size={16} strokeWidth={2.2} />
        <View style={styles.itemTextBlock}>
          <Text style={[styles.listItemText, selected && styles.listItemTextSelected]}>{city.name}</Text>
          <Text style={styles.itemSubtext}>
            {city.asciiName !== city.name ? `${city.asciiName} · ` : ''}
            {city.population > 0 ? `${formatPopulation(city.population)} inhabitants` : city.timezone}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  const cityListFooter = (
    <View>
      <CitySearchStatus state={state} hasResults={cities.length > 0} query={trimmed} onRetry={retry} />

      {trimmed ? (
        <TouchableOpacity style={styles.manualRow} onPress={useTypedText} activeOpacity={0.7}>
          <PenLine color={companyUi.textSoft} size={16} strokeWidth={2.2} />
          <View style={styles.itemTextBlock}>
            <Text style={styles.manualTitle}>Use "{trimmed}"</Text>
            <Text style={styles.itemSubtext}>Saved as typed, without map coordinates.</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      <Attribution />
    </View>
  );

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.optionalMark}>Optional</Text>
      </View>

      {/* Mismo montaje que CountryField: la "X" es hermana del touchable y no
          hija, porque en web eran dos <button> anidados. */}
      <View style={[styles.pickerButton, disabled && styles.pickerButtonDisabled]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={value ? `${label}: ${value.name}` : `${label}: ${disabled ? 'select a country first' : placeholder}`}
          accessibilityState={{ disabled }}
          style={styles.pickerPressable}
          onPress={() => !disabled && setOpen(true)}
          activeOpacity={disabled ? 1 : 0.75}
        >
          <View style={styles.pickerValueRow}>
            {value ? (
              value.kind === 'directory' ? (
                <MapPin color={companyUi.accent} size={15} strokeWidth={2.2} />
              ) : (
                <PenLine color={companyUi.textMuted} size={15} strokeWidth={2.2} />
              )
            ) : null}
            <Text style={value && !disabled ? styles.pickerValue : styles.pickerPlaceholder} numberOfLines={1}>
              {disabled ? 'Select a country first' : (value?.name ?? placeholder)}
            </Text>
          </View>
          {value ? null : <ChevronDown color={companyUi.textMuted} size={16} strokeWidth={2} />}
        </TouchableOpacity>
        {value ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            onPress={() => onChange(null)}
            hitSlop={10}
            activeOpacity={0.7}
          >
            <X color={companyUi.textMuted} size={16} strokeWidth={2} />
          </TouchableOpacity>
        ) : null}
      </View>

      <PickerSheet visible={open} title={countryName ? `City in ${countryName}` : 'Select city'} onClose={close}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Type a city name..."
          onSubmitEditing={useTypedText}
          returnKeyType="done"
        />

        {Platform.OS === 'web' ? (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            {cities.map(renderCity)}
            {/* Keep manual entry, status and attribution inside the same
                browser-owned scroll surface as the directory results. */}
            {cityListFooter}
          </ScrollView>
        ) : (
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={cities}
            keyExtractor={(c) => String(c.geonameId)}
            scrollEnabled
            nestedScrollEnabled
            showsVerticalScrollIndicator
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => renderCity(item)}
            ListFooterComponent={cityListFooter}
          />
        )}
      </PickerSheet>
    </View>
  );
}

/**
 * El mensaje bajo la lista. Cada estado dice exactamente lo que se sabe.
 *
 * ⚠ 'searching' NUNCA dice "no encontrada": mientras la respuesta viene de
 * camino no se sabe si hay ciudades, y afirmar que no las hay es sacar una
 * conclusión de un resultado que no ha llegado. Y 'unavailable' tampoco dice
 * "no existe": dice que no pudimos preguntar, que es otra cosa.
 */
function CitySearchStatus({
  state,
  hasResults,
  query,
  onRetry,
}: {
  state: ReturnType<typeof useCitySearch>['state'];
  hasResults: boolean;
  query: string;
  onRetry: () => void;
}) {
  if (state === 'searching') {
    return (
      <View style={styles.inlineStatus}>
        <ActivityIndicator size="small" color={companyUi.textMuted} />
        <Text style={styles.statusHint}>Searching...</Text>
      </View>
    );
  }

  if (state === 'unavailable') {
    return (
      <View style={styles.inlineStatus}>
        <Text style={styles.statusHint}>
          City suggestions are unavailable right now. You can still type the city below.
        </Text>
        <TouchableOpacity onPress={onRetry} hitSlop={8} activeOpacity={0.75}>
          <Text style={styles.retryInline}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (state === 'ready' && !hasResults) {
    return (
      <View style={styles.inlineStatus}>
        <Text style={styles.statusHint}>
          {query ? `No city matches "${query}" in this country.` : 'No cities to suggest for this country.'}
        </Text>
      </View>
    );
  }

  return null;
}

function Attribution() {
  return (
    <TouchableOpacity
      style={styles.attribution}
      onPress={() => Linking.openURL(GEONAMES_URL)}
      activeOpacity={0.7}
      accessibilityRole="link"
    >
      <Text style={styles.attributionText}>
        City data by <Text style={styles.attributionLink}>GeoNames</Text>, licensed under CC BY 4.0.
      </Text>
    </TouchableOpacity>
  );
}

// ── Carcasa compartida (ver "Duplicación consciente" arriba) ─

function PickerSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      presentationStyle="pageSheet"
      transparent={Platform.OS === 'web'}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetPanel}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {title}
            </Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={8} activeOpacity={0.75}>
              <X color={Platform.OS === 'web' ? companyUi.textSoft : sheetTextSoft} size={20} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          {children}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function SearchField({
  value,
  onChangeText,
  placeholder,
  onSubmitEditing,
  returnKeyType,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'search';
}) {
  return (
    <View style={styles.searchRow}>
      <Search color={Platform.OS === 'web' ? companyUi.textSoft : companyUi.textMuted} size={15} strokeWidth={2} />
      <TextInput
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={Platform.OS === 'web' ? companyUi.textMuted : sheetTextSoft}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        autoFocus
        autoCorrect={false}
      />
    </View>
  );
}

// ── Utilidades locales ─────────────────────────────────────

/** El directorio ya busca insensible a acentos; esto iguala el filtro LOCAL de países. */
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function formatPopulation(population: number): string {
  if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1)}M`;
  if (population >= 1_000) return `${Math.round(population / 1_000)}k`;
  return String(population);
}

const sheetBg = '#0f1923';
const sheetSurface = '#1a2535';
const sheetBorder = '#2a3a50';
const sheetText = '#e8edf2';
const sheetTextSoft = '#8a9ab5';
const sheetTextMuted = '#4a5a72';
const sheetAccent = '#3b82f6';

const styles = StyleSheet.create({
  group: {
    gap: spacing.md,
  },
  field: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  fieldLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  requiredMark: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: companyUi.accent,
  },
  optionalMark: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: companyUi.textMuted,
  },
  pickerButton: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: companyUi.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: companyUi.surfaceSoft,
    gap: spacing.sm,
  },
  pickerButtonDisabled: {
    opacity: 0.5,
  },
  // El touchable dentro del recuadro: ocupa todo menos la "X", que vive fuera
  // de el. Reparte igual que lo hacia `pickerButton`, asi que el aspecto no
  // cambia.
  pickerPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pickerValueRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickerValue: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: companyUi.text,
  },
  pickerPlaceholder: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: companyUi.textMuted,
  },
  flag: {
    width: 26,
    fontSize: 18,
  },
  sheet: {
    flex: 1,
    minHeight: 0,
    backgroundColor: Platform.OS === 'web' ? 'rgba(15, 23, 42, 0.46)' : sheetBg,
    ...(Platform.OS === 'web'
      ? {
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.lg,
        }
      : {}),
  },
  sheetPanel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: Platform.OS === 'web' ? companyUi.surface : sheetBg,
    ...(Platform.OS === 'web'
      ? ({
          width: '100%',
          maxWidth: 760,
          maxHeight: 650,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: companyUi.border,
          overflow: 'hidden',
          boxShadow: '0px 24px 70px rgba(15, 23, 42, 0.24)',
        } as any)
      : {}),
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'web' ? 18 : spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Platform.OS === 'web' ? companyUi.borderSoft : sheetBorder,
    backgroundColor: Platform.OS === 'web' ? companyUi.surface : sheetBg,
  },
  sheetTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: Platform.OS === 'web' ? companyUi.text : sheetText,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Platform.OS === 'web' ? companyUi.surfaceSoft : 'transparent',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 11 : Platform.OS === 'web' ? 11 : 8,
    borderWidth: 1,
    borderColor: Platform.OS === 'web' ? companyUi.border : sheetBorder,
    borderRadius: 14,
    backgroundColor: Platform.OS === 'web' ? companyUi.surfaceSoft : sheetSurface,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: Platform.OS === 'web' ? companyUi.text : sheetText,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  list: {
    flex: 1,
    minHeight: 0,
    ...(Platform.OS === 'web'
      ? ({
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
          WebkitOverflowScrolling: 'touch',
          scrollbarGutter: 'stable',
        } as any)
      : {}),
  },
  listContent: {
    paddingBottom: spacing.md,
    ...(Platform.OS === 'web' ? { paddingHorizontal: spacing.md } : {}),
  },
  listItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Platform.OS === 'web' ? companyUi.borderSoft : sheetBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    ...(Platform.OS === 'web'
      ? {
          minHeight: 58,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: companyUi.borderSoft,
          borderRadius: 16,
          backgroundColor: companyUi.surface,
        }
      : {}),
  },
  listItemSelected: {
    backgroundColor: Platform.OS === 'web' ? companyUi.accentSoft : `${sheetAccent}18`,
    borderColor: Platform.OS === 'web' ? companyUi.accent : sheetBorder,
  },
  itemTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  listItemText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: Platform.OS === 'web' ? '700' : '500',
    color: Platform.OS === 'web' ? companyUi.text : sheetText,
  },
  listItemTextSelected: {
    color: Platform.OS === 'web' ? companyUi.accent : sheetAccent,
    fontWeight: '700',
  },
  itemSubtext: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: Platform.OS === 'web' ? companyUi.textMuted : sheetTextMuted,
  },
  manualRow: {
    marginTop: spacing.sm,
    marginHorizontal: Platform.OS === 'web' ? 0 : spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Platform.OS === 'web' ? companyUi.border : sheetBorder,
    borderRadius: 16,
    backgroundColor: Platform.OS === 'web' ? companyUi.surfaceSoft : sheetSurface,
  },
  manualTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: Platform.OS === 'web' ? companyUi.text : sheetText,
  },
  statusBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
    color: Platform.OS === 'web' ? companyUi.textSoft : sheetTextSoft,
  },
  statusHint: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: Platform.OS === 'web' ? companyUi.textMuted : sheetTextMuted,
  },
  inlineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: Platform.OS === 'web' ? companyUi.accentSoft : sheetSurface,
  },
  retryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: Platform.OS === 'web' ? companyUi.accent : sheetAccent,
  },
  retryInline: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    color: Platform.OS === 'web' ? companyUi.accent : sheetAccent,
  },
  emptyText: {
    textAlign: 'center',
    padding: spacing.xl,
    fontSize: 14,
    color: Platform.OS === 'web' ? companyUi.textMuted : sheetTextMuted,
  },
  attribution: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  attributionText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    color: Platform.OS === 'web' ? companyUi.textMuted : sheetTextMuted,
  },
  attributionLink: {
    fontWeight: '700',
    textDecorationLine: 'underline',
    color: Platform.OS === 'web' ? companyUi.accent : sheetAccent,
  },
});
