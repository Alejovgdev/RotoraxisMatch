// Cabecera de los asistentes (maquetas WPostHeader y TStepHeader): flecha de
// atrás (o cerrar en el primer paso), "Step N of M" y una barra de segmentos.
//
// `total` es el número de pasos que APLICAN a este recorrido, no un número fijo
// (respuesta 14 de la revisión: "Step N of M" variable). Con `label` se
// sustituye el texto, p. ej. "Review" en la revisión final.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronLeft, X } from 'lucide-react-native';
import { Text } from './Text';
import { colors } from '../../theme';
import { HOVER_BG, mobileColumn, radius, TOUCH_TARGET } from '../../theme/ui';

const SEGMENT_OFF = '#E3E9EF';

export function StepHeader({
  step,
  total,
  onBack,
  backIcon = 'back',
  title,
  label,
}: {
  /** 1-based. Un `step` mayor que `total` pinta todos los segmentos llenos. */
  step: number;
  total: number;
  onBack: () => void;
  /** 'close' en el primer paso de un flujo que se abre desde una pestaña. */
  backIcon?: 'back' | 'close';
  /** Nombre del flujo ("Add licence"), si se muestra. */
  title?: string;
  label?: string;
}) {
  const shown = label ?? `Step ${Math.min(step, total)} of ${total}`;
  const segments = Array.from({ length: Math.max(total, 1) }, (_, i) => i < step);
  // En un tablet, la cabecera va en la misma columna que el paso (fase 8).
  return (
    <View style={styles.outer}>
      <View style={[mobileColumn, styles.wrap]}>
        <View style={styles.row}>
          <Pressable
            onPress={onBack}
            style={({ hovered }: any) => [styles.back, hovered && styles.backHover]}
            accessibilityRole="button"
            accessibilityLabel={backIcon === 'close' ? 'Close' : 'Back'}
            hitSlop={4}
          >
            {backIcon === 'close'
              ? <X color={colors.text} size={24} strokeWidth={2.2} />
              : <ChevronLeft color={colors.text} size={26} strokeWidth={2.2} />}
          </Pressable>
          {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : <View style={styles.spacer} />}
          <Text style={styles.label} accessibilityRole="text">{shown}</Text>
        </View>
        <View style={styles.segments} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {segments.map((on, i) => (
            <View key={i} style={[styles.segment, { backgroundColor: on ? colors.primary : SEGMENT_OFF }]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    backgroundColor: colors.surface,
  },
  backHover: {
    backgroundColor: HOVER_BG,
  },
  wrap: {
    paddingTop: 8,
    paddingRight: 20,
    paddingLeft: 4,
    paddingBottom: 6,
    gap: 6,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  spacer: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  segments: {
    flexDirection: 'row',
    gap: 6,
    paddingLeft: 16,
  },
  segment: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
});
