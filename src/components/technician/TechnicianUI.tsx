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
import { spacing } from '../../theme';
import { appUi, cardShadow, radius, TOUCH_TARGET } from '../../theme/ui';

// Los mismos tokens que la empresa (src/theme/ui.ts): el documento pide que
// las dos áreas compartan estilo. El nombre se conserva porque lo leen todas
// las pantallas del técnico.
export const techUi = appUi;

export const panelShadow = cardShadow;

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
});
