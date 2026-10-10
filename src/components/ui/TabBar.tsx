// Barra inferior del rediseño (maquetas WTabBar y TTabBar): cinco huecos, con
// un botón redondo "+" en medio que abre un flujo de creación y NO es una
// pestaña. Sólo se pinta en las pantallas raíz de cada pestaña (respuesta 6 de
// la revisión); en escritorio la sustituye la barra superior.
//
// Es sólo presentación: quién está activo, los contadores y qué hace cada
// toque los decide quien la monta (la navegación de la fase 2).
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
import { Text } from './Text';
import { colors } from '../../theme';
import { floatingShadow, MOBILE_COLUMN, TOUCH_TARGET } from '../../theme/ui';

export interface TabBarItem {
  key: string;
  label: string;
  /** Pinta el icono con el color que toca (activo o no). */
  renderIcon: (color: string) => React.ReactNode;
  active?: boolean;
  /** Contador rojo sobre el icono. 0 o ausente: no se pinta. */
  badge?: number;
  onPress: () => void;
}

export interface TabBarAction {
  label: string;
  onPress: () => void;
  /**
   * Gris y sin acción (p. ej. un Viewer no puede publicar ofertas, respuesta 7).
   * Al tocarlo se muestra `disabledNote` unos segundos.
   */
  disabled?: boolean;
  disabledNote?: string;
}

const NOTE_MS = 2600;

export function TabBar({ items, action }: { items: TabBarItem[]; action: TabBarAction }) {
  const insets = useSafeAreaInsets();
  const [noteVisible, setNoteVisible] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  function pressAction() {
    if (!action.disabled) {
      action.onPress();
      return;
    }
    if (!action.disabledNote) return;
    setNoteVisible(true);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNoteVisible(false), NOTE_MS);
  }

  const middle = Math.floor(items.length / 2);
  const slots: React.ReactNode[] = items.map((item) => <TabButton key={item.key} item={item} />);
  slots.splice(
    middle,
    0,
    <Pressable
      key="__action"
      onPress={pressAction}
      style={styles.slot}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled: !!action.disabled }}
    >
      <View style={[styles.actionCircle, action.disabled ? styles.actionCircleDisabled : floatingShadow]}>
        <Plus color={colors.white} size={26} strokeWidth={2.4} />
      </View>
      <Text style={[styles.label, styles.actionLabel, action.disabled && styles.labelDisabled]} numberOfLines={1}>
        {action.label}
      </Text>
    </Pressable>,
  );

  return (
    // En un tablet los cinco huecos van en la columna de móvil, no repartidos a
    // todo el ancho (fase 8); el fondo y la línea sí ocupan todo.
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      <View style={styles.row}>
        {noteVisible && action.disabledNote ? (
          <View style={styles.note} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={styles.noteText}>{action.disabledNote}</Text>
          </View>
        ) : null}
        {slots}
      </View>
    </View>
  );
}

function TabButton({ item }: { item: TabBarItem }) {
  const color = item.active ? colors.text : colors.textMuted;
  const badge = item.badge && item.badge > 0 ? (item.badge > 99 ? '99+' : String(item.badge)) : null;
  return (
    <Pressable
      onPress={item.onPress}
      style={styles.slot}
      accessibilityRole="tab"
      accessibilityLabel={badge ? `${item.label}, ${badge} new` : item.label}
      accessibilityState={{ selected: !!item.active }}
    >
      <View>
        {item.renderIcon(color)}
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.label, { color }, item.active && styles.labelActive]} numberOfLines={1}>
        {item.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  row: {
    width: '100%',
    maxWidth: MOBILE_COLUMN,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  slot: {
    flex: 1,
    minWidth: 0,
    minHeight: TOUCH_TARGET + 4,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  label: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.textMuted,
  },
  labelActive: {
    fontWeight: '800',
  },
  actionLabel: {
    fontWeight: '800',
    color: colors.text,
  },
  labelDisabled: {
    color: colors.disabledText,
  },
  actionCircle: {
    width: 50,
    height: 50,
    marginTop: -20,
    borderRadius: 25,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCircleDisabled: {
    backgroundColor: colors.disabledText,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.notify,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    color: colors.white,
  },
  note: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    width: 220,
    marginLeft: -110,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.navy,
  },
  noteText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.white,
    textAlign: 'center',
  },
});
