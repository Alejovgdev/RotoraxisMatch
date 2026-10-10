// Filas de lista del rediseño (maquetas W-You, W-Team, T-You, T-Quals): un
// grupo con borde redondeado y filas separadas por una línea fina.
//
//   <ListGroup>
//     <ListRow title="Team access" subtitle="2 members" onPress={...} chevron />
//     <ListRow title="Settings" onPress={...} chevron />
//   </ListGroup>
//
// La línea entre filas la pone el grupo, no la fila: así la última nunca la
// lleva, sin que nadie tenga que pasar un `last`.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Text } from './Text';
import { colors } from '../../theme';
import { TOUCH_TARGET } from '../../theme/ui';

export function ListGroup({ children }: { children: React.ReactNode }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {rows.map((row, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <View style={styles.divider} /> : null}
          {row}
        </React.Fragment>
      ))}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  chevron = false,
  disabled = false,
  destructive = false,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  disabled?: boolean;
  /** Texto en el rojo de error (p. ej. "Log out" en algunas maquetas). */
  destructive?: boolean;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.copy}>
        <Text style={[styles.title, destructive && styles.destructive, disabled && styles.disabledText]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, disabled && styles.disabledText]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {chevron ? <ChevronRight color={disabled ? colors.disabledText : colors.textMuted} size={20} strokeWidth={2.2} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : title)}
      accessibilityState={{ disabled }}
      style={({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && !disabled && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    borderWidth: 1,
    borderColor: '#DDE5EC',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: TOUCH_TARGET + 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.surfaceSoft,
  },
  leading: {
    flexShrink: 0,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  trailing: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  destructive: {
    color: colors.error,
  },
  disabledText: {
    color: colors.disabledText,
  },
});
