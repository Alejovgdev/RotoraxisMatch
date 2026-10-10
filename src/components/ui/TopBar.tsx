// Barra superior de escritorio del rediseño (maqueta WTopBar; sección 1 del
// documento): logo, botón de búsqueda, Inbox, You y la acción principal; debajo,
// las secciones. Sale en TODAS las pantallas del área en escritorio (respuesta 6).
//
// Es sólo presentación, como TabBar: qué está activo, los contadores y qué hace
// cada toque los decide quien la monta (CompanyTopBar, TechnicianTopBar).
//
// La acción principal puede estar desactivada (un Viewer no publica ofertas,
// respuesta 7): se pinta gris y al tocarla se explica por qué unos segundos.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle, Plus, Search } from 'lucide-react-native';
import { Text } from './Text';
import { colors } from '../../theme';
import { fonts } from '../../theme/fonts';
import { floatingShadow } from '../../theme/ui';

const NOTE_MS = 2600;

export interface TopBarSection {
  key: string;
  label: string;
  active: boolean;
  /** Contador ámbar junto al rótulo ("Applications 3"). 0 o ausente: no se pinta. */
  count?: number;
  /** Qué cuenta, para el lector de pantalla: "pending" (por defecto) o "new". */
  countLabel?: string;
  onPress: () => void;
}

export interface TopBarProps {
  onLogoPress: () => void;
  /** El botón gris de búsqueda: abre la búsqueda, sin texto libre (respuesta 6). */
  searchLabel: string;
  onSearch: () => void;
  /** Se está en la búsqueda: el botón se marca, como Inbox o You (fase 8). */
  searchActive?: boolean;
  inbox: { active: boolean; unread: number; onPress: () => void };
  you: { active: boolean; avatar: React.ReactNode; onPress: () => void };
  /** `active`: se está dentro de lo que abre (el "+" del técnico y sus asistentes, fase 8). */
  action: { label: string; onPress: () => void; disabled?: boolean; disabledNote?: string; active?: boolean };
  sections: TopBarSection[];
}

export function TopBar({ onLogoPress, searchLabel, onSearch, searchActive = false, inbox, you, action, sections }: TopBarProps) {
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

  const inboxBadge = inbox.unread > 0 ? (inbox.unread > 99 ? '99+' : String(inbox.unread)) : null;

  return (
    <View style={[styles.topWrap, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onLogoPress} accessibilityRole="link" accessibilityLabel="Aviation Job Talent, home">
          <Text style={styles.logo}>Aviation Job Talent</Text>
        </Pressable>

        <Pressable
          onPress={onSearch}
          style={({ hovered }: any) => [
            styles.searchButton,
            hovered && styles.searchButtonHover,
            searchActive && styles.searchButtonActive,
          ]}
          accessibilityRole="button"
          accessibilityLabel={searchLabel}
          accessibilityState={{ selected: searchActive }}
        >
          <Search color={searchActive ? colors.text : colors.textSecondary} size={20} strokeWidth={searchActive ? 2.4 : 2} />
          <Text style={[styles.searchLabel, searchActive && styles.searchLabelActive]}>{searchLabel}</Text>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            onPress={inbox.onPress}
            style={({ hovered }: any) => [styles.action, (hovered || inbox.active) && styles.actionActive]}
            accessibilityRole="link"
            accessibilityLabel={inboxBadge ? `Inbox, ${inboxBadge} unread` : 'Inbox'}
          >
            <View>
              <MessageCircle color={colors.text} size={22} strokeWidth={2} />
              {inboxBadge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{inboxBadge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.actionLabel, inbox.active && styles.actionLabelActive]}>Inbox</Text>
          </Pressable>

          <Pressable
            onPress={you.onPress}
            style={({ hovered }: any) => [styles.action, (hovered || you.active) && styles.actionActive]}
            accessibilityRole="link"
            accessibilityLabel="You"
          >
            {you.avatar}
            <Text style={[styles.actionLabel, you.active && styles.actionLabelActive]}>You</Text>
          </Pressable>

          <View>
            <Pressable
              onPress={pressAction}
              style={({ hovered }: any) => [
                styles.postButton,
                action.disabled ? styles.postButtonDisabled : floatingShadow,
                !action.disabled && (action.active ? styles.postButtonActive : hovered && styles.postButtonHover),
              ]}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ disabled: !!action.disabled, selected: !!action.active }}
            >
              <Plus color={colors.white} size={18} strokeWidth={2.6} />
              <Text style={styles.postLabel}>{action.label}</Text>
            </Pressable>
            {noteVisible && action.disabledNote ? (
              <View style={styles.note} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Text style={styles.noteText}>{action.disabledNote}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.sections} accessibilityRole="tablist">
        {sections.map((s) => {
          const count = s.count && s.count > 0 ? s.count : null;
          return (
            <Pressable
              key={s.key}
              onPress={s.onPress}
              style={({ hovered }: any) => [styles.section, s.active ? styles.sectionActive : hovered && styles.sectionHover]}
              accessibilityRole="tab"
              accessibilityState={{ selected: s.active }}
              accessibilityLabel={count ? `${s.label}, ${count} ${s.countLabel ?? 'pending'}` : s.label}
            >
              {({ hovered }: any) => (
                <>
                  <Text style={[styles.sectionLabel, s.active ? styles.sectionLabelActive : hovered && styles.sectionLabelHover]}>{s.label}</Text>
                  {count ? (
                    <View style={styles.sectionCount}>
                      <Text style={styles.sectionCountText}>{count > 99 ? '99+' : count}</Text>
                    </View>
                  ) : null}
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topWrap: {
    backgroundColor: colors.surface,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 28,
    rowGap: 14,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    zIndex: 2,
  },
  logo: {
    fontFamily: fonts.logo,
    fontSize: 24,
    letterSpacing: -0.2,
    color: colors.logo,
  },
  searchButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 320,
    maxWidth: 560,
    height: 50,
    paddingHorizontal: 18,
    borderRadius: 25,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchButtonHover: {
    backgroundColor: '#E6EDF3',
  },
  /** En la búsqueda: el mismo gris con un borde, como el campo elegido. */
  searchButtonActive: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 16.5,
  },
  searchLabel: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  searchLabelActive: {
    fontWeight: '700',
    color: colors.text,
  },
  actions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  action: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionActive: {
    backgroundColor: colors.surfaceSoft,
  },
  actionLabel: {
    fontSize: 14.5,
    fontWeight: '700',
    color: colors.text,
  },
  actionLabelActive: {
    fontWeight: '800',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -9,
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
  postButton: {
    height: 46,
    marginLeft: 6,
    paddingLeft: 18,
    paddingRight: 22,
    borderRadius: 23,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  postButtonDisabled: {
    backgroundColor: '#C9D3DD',
  },
  postButtonHover: {
    backgroundColor: colors.primaryPressed,
  },
  /** Dentro de lo que abre el botón: relleno azul marino, el "elegido" de los chips. */
  postButtonActive: {
    backgroundColor: colors.navy,
  },
  postLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.white,
  },
  note: {
    position: 'absolute',
    right: 0,
    top: 54,
    width: 240,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.navy,
    zIndex: 20,
  },
  noteText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.white,
  },
  sections: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 28,
    paddingHorizontal: 32,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  section: {
    height: 50,
    paddingTop: 3,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionActive: {
    borderBottomColor: colors.primary,
  },
  sectionHover: {
    borderBottomColor: colors.border,
  },
  sectionLabel: {
    fontSize: 14.5,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  sectionLabelActive: {
    fontWeight: '800',
    color: colors.text,
  },
  sectionLabelHover: {
    color: colors.text,
  },
  sectionCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCountText: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    color: colors.warning,
  },
});
