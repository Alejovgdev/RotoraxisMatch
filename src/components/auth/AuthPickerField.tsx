import React, { useMemo, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Text, TextInput } from '../ui/Text';
import { focusRingWithin } from '../ui/webFocusRing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme';

export interface PickerOption {
  value: string;
  label: string;
  subtitle?: string;
}

interface AuthPickerFieldProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  loading?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  modalTitle?: string;
}

export function AuthPickerField({
  label,
  placeholder = 'Select...',
  value,
  onChange,
  options,
  loading = false,
  searchable = false,
  searchPlaceholder = 'Search...',
  modalTitle,
}: AuthPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.subtitle?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query, searchable]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function select(opt: PickerOption) {
    onChange(opt.value);
    close();
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.cyan} style={{ marginRight: spacing.sm }} />
        ) : null}
        <Text
          style={selected ? styles.triggerValue : styles.triggerPlaceholder}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
        presentationStyle="pageSheet"
        transparent={Platform.OS === 'web'}
        onRequestClose={close}
      >
        <SafeAreaView style={styles.modalBg}>
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{modalTitle ?? label}</Text>
              <TouchableOpacity onPress={close} hitSlop={12} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Search */}
            {searchable ? (
              <View style={styles.searchRow} {...focusRingWithin}>
                <Text style={styles.searchIcon}>⌕</Text>
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={searchPlaceholder}
                  placeholderTextColor={colors.placeholder}
                  autoFocus
                  autoCorrect={false}
                />
              </View>
            ) : null}

            {/* List */}
            <FlatList
              data={filtered}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <TouchableOpacity
                    style={[styles.item, isSelected && styles.itemSelected]}
                    onPress={() => select(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.itemContent}>
                      <Text
                        style={[styles.itemLabel, isSelected && styles.itemLabelSelected]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>
                      {item.subtitle ? (
                        <Text style={styles.itemSubtitle} numberOfLines={1}>
                          {item.subtitle}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No results found.</Text>
              }
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const sheetBg = '#FFFFFF';
const sheetSurface = '#F3F6F9';
const sheetBorder = '#E6ECF1';

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  triggerValue: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  triggerPlaceholder: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 15,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 16,
  },
  modalBg: {
    flex: 1,
    backgroundColor: Platform.OS === 'web' ? colors.overlay : sheetBg,
    ...(Platform.OS === 'web'
      ? { alignItems: 'center', justifyContent: 'center', padding: spacing.lg }
      : {}),
  },
  sheet: {
    flex: 1,
    backgroundColor: sheetBg,
    ...(Platform.OS === 'web'
      ? ({
          width: '100%',
          maxWidth: 520,
          maxHeight: 600,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: sheetBorder,
          overflow: 'hidden',
        } as any)
      : {}),
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: sheetBorder,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: sheetSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: sheetBorder,
    backgroundColor: sheetSurface,
  },
  searchIcon: {
    color: colors.textMuted,
    fontSize: 17,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: sheetSurface,
  },
  itemSelected: {
    backgroundColor: 'rgba(11, 106, 158, 0.14)',
    borderWidth: 1,
    borderColor: colors.cyan,
  },
  itemContent: { flex: 1, minWidth: 0, gap: 2 },
  itemLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  itemLabelSelected: {
    color: colors.cyan,
    fontWeight: '700',
  },
  itemSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  checkmark: {
    color: colors.cyan,
    fontSize: 16,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 14,
    paddingVertical: spacing.xl,
  },
});
