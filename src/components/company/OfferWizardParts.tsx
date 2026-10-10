// Piezas pequeñas del asistente de oferta (rediseño, fase 4; maquetas W-Post,
// W-Post2…4 y W-D-Post). Sólo presentación: las comparten el asistente y las
// secciones del formulario (licencia, motor, aeronaves, salario).
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { Check } from 'lucide-react-native';
import { Text, Toggle } from '../ui';
import { colors } from '../../theme';
import { radius } from '../../theme/ui';

/** Borde de los campos y tarjetas de opción de las maquetas. */
export const WIZARD_OPTION_BORDER = '#DDE5EC';

/** El título de un paso ("Who are you hiring?") y su línea de ayuda. */
export function WizardHeading({ title, helper, large = false }: { title: string; helper?: string; large?: boolean }) {
  return (
    <View style={styles.heading}>
      <Text style={[styles.title, large && styles.titleLarge]} accessibilityRole="header">{title}</Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

/** Un subtítulo dentro del paso ("Airplanes or helicopters?"). */
export function WizardSubheading({ title, helper }: { title: string; helper?: string }) {
  return (
    <View style={styles.subheading}>
      <Text style={styles.subtitle} accessibilityRole="header">{title}</Text>
      {helper ? <Text style={styles.subhelper}>{helper}</Text> : null}
    </View>
  );
}

/** Rótulo de campo. `caps` es el de las maquetas de licencia ("ISSUING AUTHORITY"). */
export function WizardLabel({ children, caps = false }: { children: React.ReactNode; caps?: boolean }) {
  return <Text style={caps ? styles.capsLabel : styles.label}>{children}</Text>;
}

/** Texto de ayuda pequeño bajo un campo. `tone="hint"` es el aviso ámbar de "falta elegir". */
export function WizardNote({ children, tone = 'muted', style }: { children: React.ReactNode; tone?: 'muted' | 'hint'; style?: StyleProp<TextStyle> }) {
  return <Text style={[tone === 'hint' ? styles.hint : styles.note, style]}>{children}</Text>;
}

export function WizardError({ children }: { children?: string }) {
  if (!children) return null;
  return <Text style={styles.error} accessibilityRole="alert">{children}</Text>;
}

/** Fila de chips que se envuelven. */
export function WizardChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

/** Casilla en tarjeta con borde ("Only technicians without a licence"). */
export function WizardCheckCard({
  label,
  helper,
  checked,
  onChange,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      style={({ pressed, hovered }: any) => [styles.optionCard, (pressed || hovered) && styles.optionCardPressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked ? <Check color={colors.white} size={14} strokeWidth={3.2} /> : null}
      </View>
      <View style={styles.optionCopy}>
        <Text style={styles.optionLabel}>{label}</Text>
        {helper ? <Text style={styles.optionHelper}>{helper}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Interruptor en tarjeta con borde ("needs ALL of these aircraft"). */
export function WizardSwitchCard({
  label,
  helper,
  value,
  onChange,
}: {
  label: string;
  helper?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.optionCard}>
      <View style={styles.optionCopy}>
        <Text style={styles.switchLabel}>{label}</Text>
        {helper ? <Text style={styles.optionHelper}>{helper}</Text> : null}
      </View>
      <Toggle accessibilityLabel={label} value={value} onChange={onChange} />
    </View>
  );
}

export const wizardInputStyles = StyleSheet.create({
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.field,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  textarea: {
    minHeight: 112,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: '#F3C2C2',
    backgroundColor: colors.errorSoft,
  },
  field: {
    gap: 6,
  },
});

const styles = StyleSheet.create({
  heading: {
    gap: 6,
  },
  title: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
  },
  titleLarge: {
    fontSize: 26,
    lineHeight: 31,
  },
  helper: {
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  subheading: {
    gap: 4,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  subhelper: {
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  capsLabel: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.warning,
  },
  error: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.error,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: WIZARD_OPTION_BORDER,
    backgroundColor: colors.surface,
  },
  optionCardPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#B8C4CF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  boxOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  switchLabel: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    color: colors.text,
  },
  optionHelper: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
