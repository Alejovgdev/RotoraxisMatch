// Círculo de acceso directo de las Home (maquetas W-Home y T-Home): un círculo
// de color con su icono, el rótulo debajo y, si hay algo pendiente, el contador
// rojo arriba a la derecha.
//
// Es el mismo dibujo que los círculos de la Home de empresa (fase 2, que los
// lleva en su propia pantalla); el técnico lo usa desde aquí (fase 5A).
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { Text } from './Text';
import { colors } from '../../theme';

export function ShortcutCircle({
  label,
  icon: Icon,
  bg,
  fg,
  badge,
  badgeLabel = 'pending',
  onPress,
}: {
  label: string;
  icon: React.ComponentType<LucideProps>;
  bg: string;
  fg: string;
  /** Contador rojo. 0 o ausente: no se pinta. */
  badge?: number;
  /** Qué cuenta el número, para el lector de pantalla ("3 pending", "1 new"). */
  badgeLabel?: string;
  onPress: () => void;
}) {
  const count = badge && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null;
  return (
    <Pressable
      onPress={onPress}
      style={styles.shortcut}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count} ${badgeLabel}` : label}
    >
      <View style={[styles.circle, { backgroundColor: bg }]}>
        <Icon color={fg} size={26} strokeWidth={2} />
        {count ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shortcut: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  circle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.notify,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    color: colors.white,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
});
