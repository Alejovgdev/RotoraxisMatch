import React from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft } from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { colors, spacing } from '../../theme';

export const companyUi = {
  page: '#E4EBF2',
  surface: '#FFFFFF',
  surfaceSoft: '#EEF3F8',
  border: '#B8C8D9',
  borderSoft: '#D0DCE8',
  text: '#0B1520',
  textSoft: '#2E4057',
  textMuted: '#5E7592',
  accent: '#0369A1',
  accentSoft: '#BAE0F5',
  blue: '#1D4ED8',
  blueSoft: '#DBEAFE',
  green: '#065F46',
  greenSoft: '#C6F0E1',
  amber: '#92400E',
  amberSoft: '#FDE9B0',
  red: '#B91C1C',
  redSoft: '#FECACA',
  navy: '#0B1520',
};

export const companyShadow = Platform.select<ViewStyle>({
  web: { boxShadow: '0px 14px 34px rgba(15, 23, 42, 0.07)' } as ViewStyle,
  default: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
});

export type CompanyTone = 'success' | 'warning' | 'error' | 'info' | 'muted' | 'navy' | 'cyan';

const TONES: Record<CompanyTone, { bg: string; text: string; border: string }> = {
  success: { bg: companyUi.greenSoft, text: companyUi.green, border: '#BBF7D0' },
  warning: { bg: companyUi.amberSoft, text: companyUi.amber, border: '#FDE68A' },
  error: { bg: companyUi.redSoft, text: companyUi.red, border: '#FECACA' },
  info: { bg: companyUi.blueSoft, text: companyUi.blue, border: '#BFDBFE' },
  muted: { bg: companyUi.surfaceSoft, text: companyUi.textSoft, border: companyUi.borderSoft },
  navy: { bg: '#EEF2FF', text: '#1E3A5F', border: '#C7D2FE' },
  cyan: { bg: companyUi.accentSoft, text: companyUi.accent, border: '#BAE6FD' },
};

export function CompanyScreen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={companyStyles.safe}>
      <StatusBar style="dark" />
      {children}
    </SafeAreaView>
  );
}

export function CompanyCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[companyStyles.card, style]}>{children}</View>;
}

export function CompanyPageHeader({
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
    <View style={companyStyles.pageHeader}>
      <View style={companyStyles.pageHeaderRow}>
        {onBack ? <InlineBackButton label={backLabel} onPress={onBack} /> : null}
        <View style={companyStyles.pageTitleBlock}>
          {eyebrow ? <Text style={companyStyles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={companyStyles.pageTitle}>{title}</Text>
          {subtitle ? <Text style={companyStyles.pageSub}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={companyStyles.pageRight}>{right}</View> : null}
      </View>
    </View>
  );
}

export function InlineBackButton({ label = 'Back', onPress }: { label?: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={companyStyles.backButton}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <ArrowLeft color={companyUi.text} size={19} strokeWidth={2.4} />
    </TouchableOpacity>
  );
}

export function CompanyBadge({
  label,
  tone = 'muted',
  small = false,
}: {
  label: string;
  tone?: CompanyTone;
  small?: boolean;
}) {
  const t = TONES[tone];
  return (
    <View style={[companyStyles.badge, { backgroundColor: t.bg, borderColor: t.border }, small && companyStyles.badgeSmall]}>
      <Text style={[companyStyles.badgeText, { color: t.text }, small && companyStyles.badgeTextSmall]}>{label}</Text>
    </View>
  );
}

export function CompanyChip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View style={[companyStyles.chip, selected && companyStyles.chipSelected]}>
      <Text style={[companyStyles.chipText, selected && companyStyles.chipTextSelected]}>{label}</Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={{ top: 6, bottom: 6, left: 3, right: 3 }}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {body}
    </TouchableOpacity>
  );
}

export function EmptyPanel({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <CompanyCard style={companyStyles.emptyPanel}>
      <View style={companyStyles.emptyMark} />
      <Text style={companyStyles.emptyTitle}>{title}</Text>
      <Text style={companyStyles.emptySub}>{subtitle}</Text>
    </CompanyCard>
  );
}

export function ActivityDot() {
  return <View style={companyStyles.activityDot} />;
}

export function InitialAvatar({
  label,
  size = 42,
  color = companyUi.navy,
}: {
  label: string;
  size?: number;
  color?: string;
}) {
  const initial = label.trim().charAt(0).toUpperCase() || 'C';
  return (
    <View style={[companyStyles.avatar, { width: size, height: size, borderRadius: Math.round(size * 0.34), backgroundColor: color }]}>
      <Text style={companyStyles.avatarText}>{initial}</Text>
    </View>
  );
}

export function IconBox({
  icon: Icon,
  color = companyUi.accent,
  backgroundColor = companyUi.accentSoft,
  size = 20,
}: {
  icon: React.ComponentType<LucideProps>;
  color?: string;
  backgroundColor?: string;
  size?: number;
}) {
  return (
    <View style={[companyStyles.iconBox, { backgroundColor }]}>
      <Icon color={color} size={size} strokeWidth={2} />
    </View>
  );
}

// A labelled checkbox row. Same look as the "needs ALL of these aircraft" box in
// TypeRatingRequirementsEditor, extracted when the offer form grew two more
// (equivalent authorities, only technicians without a licence).
export function CompanyCheckRow({
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
    <TouchableOpacity
      style={checkRowStyles.row}
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      activeOpacity={0.75}
    >
      <View style={[checkRowStyles.box, checked && checkRowStyles.boxOn]}>
        {checked ? <Text style={checkRowStyles.mark}>✓</Text> : null}
      </View>
      <View style={checkRowStyles.copy}>
        <Text style={checkRowStyles.label}>{label}</Text>
        {helper ? <Text style={checkRowStyles.helper}>{helper}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const checkRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs },
  box: {
    width: 18,
    height: 18,
    marginTop: 1,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: companyUi.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: companyUi.accent, backgroundColor: companyUi.accentSoft },
  mark: { fontSize: 12, lineHeight: 14, fontWeight: '700', color: companyUi.accent },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: companyUi.textSoft },
  helper: { fontSize: 11, lineHeight: 15, fontWeight: '500', color: companyUi.textMuted },
});

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={companyStyles.infoRow}>
      <Text style={companyStyles.infoLabel}>{label}</Text>
      <Text style={companyStyles.infoValue}>{value}</Text>
    </View>
  );
}

export const companyStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: companyUi.page,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  contentWide: {
    maxWidth: 900,
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
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
    color: '#0891B2',
    marginBottom: 2,
  },
  pageTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  pageSub: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: companyUi.textSoft,
    marginTop: 4,
  },
  pageRight: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...(companyShadow ?? {}),
  },
  card: {
    backgroundColor: companyUi.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: companyUi.border,
    padding: spacing.md,
    ...(companyShadow ?? {}),
  },
  badge: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
  },
  badgeTextSmall: {
    fontSize: 11,
    lineHeight: 14,
  },
  chip: {
    borderWidth: 1,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surface,
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipSelected: {
    backgroundColor: companyUi.accent,
    borderColor: companyUi.accent,
  },
  chipText: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '600',
    color: companyUi.textSoft,
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
    backgroundColor: companyUi.accent,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: companyUi.text,
    marginBottom: 5,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: companyUi.textSoft,
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
    backgroundColor: companyUi.red,
    zIndex: 2,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  infoLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: companyUi.textMuted,
  },
  infoValue: {
    flex: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: companyUi.text,
    textAlign: 'right',
  },
});
