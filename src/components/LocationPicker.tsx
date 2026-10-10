import React, { useMemo, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  SafeAreaView,
  Platform,
  Image,
} from 'react-native';
import { Text, TextInput } from './ui/Text';
import { focusRingWithin } from './ui/webFocusRing';
import { ChevronDown, Search, X } from 'lucide-react-native';
import { spacing } from '../theme';
import { companyUi } from './company/CompanyUI';
import { COUNTRIES, countryFlag, findCountry } from '../constants/countries';
import { AirportCity, getCitiesForCountry } from '../constants/locationCities';

interface CountryPickerFieldProps {
  label: string;
  value: string;
  onChange: (countryName: string) => void;
}

interface CityPickerFieldProps {
  label: string;
  country: string;
  value: string;
  onChange: (city: string, icao: string, entry: AirportCity) => void;
}

export function CountryPickerField({ label, value, onChange }: CountryPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedCountry = findCountry(value);
  const displayValue = selectedCountry?.name ?? value;

  const filtered = useMemo(() => {
    if (!query.trim()) return COUNTRIES;
    const q = query.toLowerCase();
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function select(name: string) {
    onChange(name);
    close();
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity style={styles.pickerButton} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <View style={styles.pickerValueRow}>
          {selectedCountry ? <CountryMark code={selectedCountry.code} /> : null}
          <Text style={displayValue ? styles.pickerValue : styles.pickerPlaceholder} numberOfLines={1}>
            {displayValue || 'Select country'}
          </Text>
        </View>
        <ChevronDown color={companyUi.textMuted} size={16} strokeWidth={2} />
      </TouchableOpacity>

      <PickerModal visible={open} title="Select country" subtitle="Choose the operating location market." onClose={close}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search countries..."
        />
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={filtered}
          keyExtractor={(c) => c.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.listItem, item.name === displayValue && styles.listItemSelected]}
              onPress={() => select(item.name)}
              activeOpacity={0.7}
            >
              <CountryMark code={item.code} />
              <View style={styles.countryTextBlock}>
                <Text style={[styles.listItemText, item.name === displayValue && styles.listItemTextSelected]}>
                  {item.name}
                </Text>
                <Text style={styles.countryCodeText}>{item.code}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No countries found.</Text>}
        />
      </PickerModal>
    </View>
  );
}

export function CityPickerField({ label, country, value, onChange }: CityPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const cities = useMemo(() => getCitiesForCountry(country), [country]);

  const filtered = useMemo(() => {
    if (!query.trim()) return cities;
    const q = query.toLowerCase();
    return cities.filter(
      (c) =>
        c.city.toLowerCase().includes(q) ||
        c.airport.toLowerCase().includes(q) ||
        c.icao.toLowerCase().includes(q) ||
        c.iata.toLowerCase().includes(q),
    );
  }, [cities, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function select(entry: AirportCity) {
    onChange(entry.city, entry.icao, entry);
    close();
  }

  const disabled = !country;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity
        style={[styles.pickerButton, disabled && styles.pickerButtonDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={disabled ? 1 : 0.75}
      >
        <Text style={value && !disabled ? styles.pickerValue : styles.pickerPlaceholder} numberOfLines={1}>
          {disabled ? 'Select a country first' : value || 'Select city'}
        </Text>
        <ChevronDown color={companyUi.textMuted} size={16} strokeWidth={2} />
      </TouchableOpacity>

      <PickerModal
        visible={open}
        title={`Select city - ${country}`}
        subtitle="Airport city and base code are filled together."
        onClose={close}
      >
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search city or airport..."
        />
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={filtered}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.listItem, item.city === value && styles.listItemSelected]}
              onPress={() => select(item)}
              activeOpacity={0.7}
            >
              <View style={styles.cityRow}>
                <View style={styles.cityInfo}>
                  <Text style={[styles.listItemText, item.city === value && styles.listItemTextSelected]}>
                    {item.city}
                  </Text>
                  <Text style={styles.airportName} numberOfLines={1}>{item.airport}</Text>
                </View>
                <View style={styles.airportCodes}>
                  {item.iata ? (
                    <View style={styles.iataBadge}>
                      <Text style={styles.iataText}>{item.iata}</Text>
                    </View>
                  ) : null}
                  <View style={styles.icaoBadge}>
                    <Text style={styles.icaoText}>{item.icao}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No cities found for this country.</Text>}
        />
      </PickerModal>
    </View>
  );
}

function PickerModal({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
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
            <View style={styles.sheetTitleBlock}>
              <Text style={styles.sheetTitle}>{title}</Text>
              {Platform.OS === 'web' && subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
            </View>
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
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.searchRow} {...focusRingWithin}>
      <Search color={Platform.OS === 'web' ? companyUi.textSoft : companyUi.textMuted} size={15} strokeWidth={2} />
      <TextInput
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={Platform.OS === 'web' ? companyUi.textMuted : sheetTextSoft}
        value={value}
        onChangeText={onChangeText}
        autoFocus
        autoCorrect={false}
      />
    </View>
  );
}

function CountryMark({ code }: { code: string }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (Platform.OS === 'web' && code && !imageFailed) {
    return (
      <View style={styles.flagImageFrame}>
        <Image
          source={{ uri: `https://flagcdn.com/w40/${code.toLowerCase()}.png` }}
          style={styles.flagImage}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
          accessibilityLabel={`${code} flag`}
        />
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={styles.flagCodeFrame}>
        <Text style={styles.flagCode}>{code}</Text>
      </View>
    );
  }

  return <Text style={styles.listItemFlag}>{countryFlag(code)}</Text>;
}

const sheetBg = '#FFFFFF';
const sheetSurface = '#F3F6F9';
const sheetBorder = '#E6ECF1';
const sheetText = '#0E1A2B';
const sheetTextSoft = '#526274';
const sheetTextMuted = '#66768A';
const sheetAccent = '#0B6A9E';

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  pickerButton: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: companyUi.border,
    borderRadius: 999,
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
  sheet: {
    flex: 1,
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
  sheetTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: Platform.OS === 'web' ? companyUi.text : sheetText,
  },
  sheetSubtitle: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
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
  listItemFlag: {
    width: 30,
    fontSize: 20,
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
  countryTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  countryCodeText: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: Platform.OS === 'web' ? companyUi.textMuted : sheetTextMuted,
  },
  flagImageFrame: {
    width: 32,
    height: 24,
    borderRadius: 7,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Platform.OS === 'web' ? companyUi.border : sheetBorder,
    backgroundColor: Platform.OS === 'web' ? companyUi.surfaceSoft : sheetSurface,
  },
  flagImage: {
    width: '100%',
    height: '100%',
  },
  flagCodeFrame: {
    width: 32,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surfaceSoft,
  },
  flagCode: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
    color: companyUi.textSoft,
  },
  cityRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cityInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  airportName: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: Platform.OS === 'web' ? companyUi.textSoft : sheetTextSoft,
  },
  airportCodes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iataBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Platform.OS === 'web' ? companyUi.accentSoft : `${sheetAccent}18`,
  },
  iataText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: Platform.OS === 'web' ? companyUi.accent : sheetAccent,
  },
  icaoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Platform.OS === 'web' ? companyUi.border : sheetBorder,
    backgroundColor: Platform.OS === 'web' ? companyUi.surfaceSoft : sheetSurface,
  },
  icaoText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: Platform.OS === 'web' ? companyUi.textSoft : sheetTextSoft,
  },
  emptyText: {
    textAlign: 'center',
    padding: spacing.xl,
    fontSize: 14,
    color: Platform.OS === 'web' ? companyUi.textMuted : sheetTextMuted,
  },
});
