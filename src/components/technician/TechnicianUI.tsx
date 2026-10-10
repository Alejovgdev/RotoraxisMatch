import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from '../ui/Text';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft } from 'lucide-react-native';
import { colors, spacing } from '../../theme';
import { appUi, cardShadow, radius, TOUCH_TARGET, UI_TONES, type UiTone } from '../../theme/ui';

// Los mismos tokens que la empresa (src/theme/ui.ts): el documento pide que
// las dos áreas compartan estilo. El nombre se conserva porque lo leen todas
// las pantallas del técnico.
export const techUi = appUi;

export const panelShadow = cardShadow;

type Tone = UiTone;

const TONES = UI_TONES;

export function TechnicianScreen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={techStyles.safe}>
      <StatusBar style="dark" />
      {children}
    </SafeAreaView>
  );
}

export function TechnicianCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[techStyles.card, style]}>{children}</View>;
}

export function TechnicianPageHeader({
  eyebrow,
  title,
  subtitle,
  right,
  onBack,
  backLabel = 'Back',
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <View style={techStyles.pageHeader}>
      <View style={techStyles.pageHeaderRow}>
        {onBack ? <InlineBackButton label={backLabel} onPress={onBack} /> : null}
        <View style={techStyles.pageTitleBlock}>
          {eyebrow ? <Text style={techStyles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={techStyles.pageTitle}>{title}</Text>
          {subtitle ? <Text style={techStyles.pageSub}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={techStyles.pageRight}>{right}</View> : null}
      </View>
    </View>
  );
}

export function InlineBackButton({ label = 'Back', onPress }: { label?: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={techStyles.backButton}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <ArrowLeft color={techUi.text} size={19} strokeWidth={2.4} />
    </TouchableOpacity>
  );
}

export function TechnicianBadge({
  label,
  tone = 'muted',
  small = false,
}: {
  label: string;
  tone?: Tone;
  small?: boolean;
}) {
  const t = TONES[tone];
  return (
    <View style={[techStyles.badge, { backgroundColor: t.bg, borderColor: t.border }, small && techStyles.badgeSmall]}>
      <Text style={[techStyles.badgeText, { color: t.text }, small && techStyles.badgeTextSmall]}>{label}</Text>
    </View>
  );
}

export function TechnicianChip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View style={[techStyles.chip, selected && techStyles.chipSelected]}>
      <Text style={[techStyles.chipText, selected && techStyles.chipTextSelected]}>{label}</Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
      {body}
    </TouchableOpacity>
  );
}

export function EmptyPanel({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <TechnicianCard style={techStyles.emptyPanel}>
      <View style={techStyles.emptyMark} />
      <Text style={techStyles.emptyTitle}>{title}</Text>
      <Text style={techStyles.emptySub}>{subtitle}</Text>
    </TechnicianCard>
  );
}

export function ActivityDot() {
  return <View style={techStyles.activityDot} />;
}

export function InitialAvatar({
  label,
  size = 42,
}: {
  label: string;
  size?: number;
}) {
  const initial = label.trim().charAt(0).toUpperCase() || 'R';
  return (
    <View style={[techStyles.avatar, { width: size, height: size, borderRadius: Math.round(size * 0.28) }]}>
      <Text style={techStyles.avatarText}>{initial}</Text>
    </View>
  );
}

export const techStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: techUi.page,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  contentWide: {
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
  },
  pageHeader: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  pageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: techUi.accent,
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    color: techUi.text,
  },
  pageSub: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: techUi.textSoft,
    marginTop: 4,
  },
  pageRight: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  backButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  card: {
    backgroundColor: techUi.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: techUi.borderSoft,
    padding: spacing.md,
    ...(panelShadow ?? {}),
  },
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  badgeTextSmall: {
    fontSize: 11.5,
    lineHeight: 14,
  },
  chip: {
    borderWidth: 1,
    borderColor: techUi.border,
    backgroundColor: techUi.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: {
    backgroundColor: techUi.navy,
    borderColor: techUi.navy,
  },
  chipText: {
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '800',
    color: techUi.text,
  },
  chipTextSelected: {
    color: colors.white,
  },
  emptyPanel: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyMark: {
    width: 34,
    height: 5,
    borderRadius: 3,
    backgroundColor: techUi.accent,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: techUi.text,
    marginBottom: 5,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: techUi.textSoft,
    textAlign: 'center',
    maxWidth: 320,
  },
  activityDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: techUi.notify,
    zIndex: 2,
  },
  avatar: {
    backgroundColor: techUi.navy,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
});
