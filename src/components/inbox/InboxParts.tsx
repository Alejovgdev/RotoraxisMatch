// Piezas comunes del Inbox (maquetas W-Inbox y W-D-Inbox), para empresa y
// técnico (fase 5B). Sólo presentación: quién sale, con qué nombre y si es
// anónimo lo decide quien las monta.
//
//   - InboxRow: avatar (con el cuadrado de la oferta en móvil), nombre, hora,
//     oferta · tipo de conversación, último mensaje y punto de no leído.
//   - InboxSplit: escritorio, la lista a la izquierda y la conversación (o el
//     aviso de "elige una") a la derecha.
//
// Salen de src/components/company/CompanyInboxList.tsx sin cambiar el dibujo.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../company/CompanyPage';
import { colors } from '../../theme';
import { fonts } from '../../theme/fonts';
import { offerTile } from '../../utils/companyHome';
import type { ChatRoom } from '../../types/chat';
import type { Offer } from '../../types/offer';

export function formatInboxTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function conversationType(room: Pick<ChatRoom, 'offerRequestId' | 'offerApplicationId'>): string {
  if (room.offerRequestId) return 'Direct offer';
  if (room.offerApplicationId) return 'Application';
  return 'Contact';
}

/** El cuadrado de la oferta sobre la esquina del avatar (móvil). */
export function InboxOfferBadge({ offer, size }: { offer: Pick<Offer, 'offerKind' | 'licenseCode' | 'technicianType'> | null; size: number }) {
  if (!offer) return null;
  const tile = offerTile(offer);
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: tile.bg }]}>
      <Text style={[styles.badgeText, { color: tile.fg, fontSize: tile.code.length <= 2 ? 10 : 8 }]} numberOfLines={1}>
        {tile.code}
      </Text>
    </View>
  );
}

export function InboxRow({
  wide,
  selected = false,
  last = false,
  avatar,
  name,
  line,
  preview,
  time,
  isUnread,
  accessibilityLabel,
  onPress,
}: {
  wide: boolean;
  selected?: boolean;
  last?: boolean;
  /** El avatar ya pintado (y su insignia de oferta en móvil). */
  avatar: React.ReactNode;
  name: string;
  /** "Oferta · Application". */
  line: string;
  preview: string;
  time: string | null;
  isUnread: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        wide ? styles.rowWide : styles.row,
        !wide && !last && styles.rowLine,
        selected && styles.rowSelected,
        (pressed || hovered) && !selected && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.avatar}>{avatar}</View>
      <View style={styles.copy}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {time ? <Text style={[styles.time, isUnread && styles.timeUnread]}>{time}</Text> : null}
        </View>
        <Text style={styles.offer} numberOfLines={1}>{line}</Text>
        <View style={styles.bottom}>
          <Text style={[styles.preview, isUnread && styles.previewUnread]} numberOfLines={1}>{preview}</Text>
          {isUnread ? <View style={styles.unreadDot} accessibilityElementsHidden /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** Las filas de la lista: en escritorio, con un poco de aire entre ellas. */
export function InboxRows({ wide, children }: { wide: boolean; children: React.ReactNode }) {
  return <View style={wide ? styles.listWide : undefined}>{children}</View>;
}

/**
 * Escritorio: la lista a la izquierda y la conversación a la derecha
 * (documento, sección 1; maqueta W-D-Inbox). `list` es la lista ya pintada;
 * `children`, el panel derecho.
 */
export function InboxSplit({
  loading,
  error,
  isEmpty,
  onRetry,
  list,
  children,
}: {
  loading: boolean;
  error: boolean;
  isEmpty: boolean;
  onRetry: () => void;
  list: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.split}>
      <View style={styles.splitList}>
        <ScrollView contentContainerStyle={styles.splitListContent} showsVerticalScrollIndicator>
          <Text style={styles.splitTitle} accessibilityRole="header">Inbox</Text>
          {loading && isEmpty ? (
            <LoadingBlock />
          ) : error ? (
            <ErrorBlock text="Could not load conversations." onRetry={onRetry} />
          ) : isEmpty ? (
            <EmptyBlock title="No chats yet" text="Chat becomes available after an accepted application or accepted direct offer." />
          ) : (
            list
          )}
        </ScrollView>
      </View>
      <View style={styles.splitPane}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  split: {
    flex: 1,
    flexDirection: 'row',
  },
  splitList: {
    width: 380,
    maxWidth: '40%',
    borderRightWidth: 1,
    borderRightColor: colors.borderLight,
  },
  splitListContent: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 6,
  },
  splitTitle: {
    paddingHorizontal: 8,
    marginBottom: 8,
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  splitPane: {
    flex: 1,
    minWidth: 0,
  },
  listWide: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  rowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  rowWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
  },
  rowSelected: {
    backgroundColor: colors.surfaceMuted,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  avatar: {
    flexShrink: 0,
  },
  badge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: fonts.display,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  time: {
    flexShrink: 0,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  timeUnread: {
    fontWeight: '800',
    color: colors.primary,
  },
  offer: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  preview: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
  },
  previewUnread: {
    fontWeight: '800',
    color: colors.text,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.notify,
  },
});
