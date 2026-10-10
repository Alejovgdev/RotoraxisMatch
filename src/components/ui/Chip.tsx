// Chips del rediseño, con los valores de las maquetas (WFilters, W-Post2, T-Lic).
//
//   - Chip 'filter': píldora; elegido = relleno azul marino y texto blanco.
//   - Chip 'option': categoría de licencia; elegido = fondo azul suave y borde
//     de 2 px en el color de acción.
//   - RemovableChip: lo ya añadido (una aeronave, un motor), con su ✕.
//   - StatusChip: etiqueta de estado no pulsable, con los tonos comunes.
//
// Lo que necesita algo antes se muestra en gris, no se oculta (documento,
// sección 1 "Wizards"): `disabled` lo pinta así y no responde.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Text } from './Text';
import { colors } from '../../theme';
import { HOVER_BG, radius, TOUCH_TARGET, UI_TONES, type UiTone } from '../../theme/ui';

export function Chip({
  label,
  count,
  selected = false,
  onPress,
  disabled = false,
  variant = 'filter',
}: {
  label: string;
  /** Número a la derecha, más tenue (filtros de estado: "Pending 3"). */
  count?: number;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  variant?: 'filter' | 'option';
}) {
  const option = variant === 'option';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      hitSlop={option ? 1 : 2}
      accessibilityRole="button"
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
      accessibilityState={{ selected, disabled }}
      style={({ hovered }: any) => [
        option ? styles.option : styles.filter,
        hovered && !selected && !disabled && onPress && styles.hover,
        selected && (option ? styles.optionSelected : styles.filterSelected),
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          option ? styles.optionText : styles.filterText,
          selected && (option ? styles.optionTextSelected : styles.filterTextSelected),
          disabled && styles.disabledText,
        ]}
        numberOfLines={1}
      >
        {label}
        {count != null ? <Text style={styles.count}>{`  ${count}`}</Text> : null}
      </Text>
    </Pressable>
  );
}

export function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Pressable
      onPress={onRemove}
      hitSlop={4}
      style={({ hovered }: any) => [styles.removable, hovered && styles.removableHover]}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label}`}
    >
      <Text style={styles.removableText} numberOfLines={1}>{label}</Text>
      <X color={colors.white} size={14} strokeWidth={2.6} />
    </Pressable>
  );
}

export function StatusChip({ label, tone = 'muted' }: { label: string; tone?: UiTone }) {
  const t = UI_TONES[tone];
  return (
    <View style={[styles.status, { backgroundColor: t.bg }]}>
      <Text style={[styles.statusText, { color: t.text }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  filter: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSelected: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  filterText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.text,
  },
  filterTextSelected: {
    color: colors.white,
  },
  count: {
    opacity: 0.7,
  },
  option: {
    minWidth: 54,
    minHeight: TOUCH_TARGET - 2,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    // El borde de 2 px no debe mover el texto respecto al de 1 px.
    paddingHorizontal: 9,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  optionTextSelected: {
    color: colors.info,
  },
  hover: {
    backgroundColor: HOVER_BG,
    borderColor: colors.textMuted,
  },
  disabled: {
    backgroundColor: colors.disabled,
    borderColor: colors.borderLight,
  },
  disabledText: {
    color: colors.disabledText,
  },
  removable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.navy,
    alignSelf: 'flex-start',
  },
  removableHover: {
    backgroundColor: colors.navyLight,
  },
  removableText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.white,
  },
  status: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 12.5,
    fontWeight: '800',
  },
});
