import React from 'react';
import {
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { Text } from './ui/Text';
import { colors, spacing } from '../theme';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

// Rediseño: botones en píldora, como en las maquetas. `primary` es la única
// acción (#0B6A9E); `outline` es el secundario blanco con borde gris;
// `secondary` sigue siendo el relleno oscuro.
const containerVariant: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.navy },
  outline: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: { backgroundColor: 'transparent' },
};

const containerSize: Record<Size, ViewStyle> = {
  sm: { paddingHorizontal: spacing.md, paddingVertical: 6, minHeight: 44 },
  md: { paddingHorizontal: spacing.lg, paddingVertical: 12, minHeight: 50 },
  lg: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, minHeight: 52 },
};

const labelColor: Record<Variant, string> = {
  primary: colors.white,
  secondary: colors.white,
  outline: colors.text,
  ghost: colors.primary,
};

const labelSize: Record<Size, number> = {
  sm: 14,
  md: 15.5,
  lg: 16,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      style={[
        styles.base,
        containerVariant[variant],
        containerSize[size],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'secondary' ? colors.white : colors.primary}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.label,
            { color: labelColor[variant], fontSize: labelSize[size] },
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '800',
  },
});
