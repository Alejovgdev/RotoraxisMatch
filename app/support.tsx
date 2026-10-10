import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { Text } from '../src/components/ui/Text';
import { useDesktopScrollbar } from '../src/components/ui/useDesktopScrollbar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../src/state/useGoBack';
import { notify } from '../src/utils/platformAlert';
import { AccountShell, useAccountShellRole } from '../src/components/AccountShell';
import { colors, spacing } from '../src/theme';

const SUPPORT_EMAIL = 'support@aviationjobtalent.com';
const PRIVACY_EMAIL = 'management@rotoraxisconsulting.com';

export default function SupportScreen() {
  // Escritorio: barra de desplazamiento visible (fase 8).
  const desktopScrollbar = useDesktopScrollbar();
  const router = useRouter();
  const goBack = useGoBack();
  const shellRole = useAccountShellRole();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  function openEmail(email: string, subject: string) {
    void Linking.openURL(`mailto:${email}?subject=${encodeURIComponent(subject)}`).catch(() => {
      notify('Email unavailable', `Please write to ${email}.`);
    });
  }

  const cards = (
    <>
      <SupportCard
        icon="✈"
        title="General support"
        description="Questions about how the platform works, your account, verification or matches."
        action="Email support"
        onPress={() => openEmail(SUPPORT_EMAIL, 'Support request — Aviation Job Talent')}
      />

      <SupportCard
        icon="🔒"
        title="Privacy and data requests"
        description="Exercise your GDPR rights: access, rectification, erasure, portability."
        action="Email privacy team"
        onPress={() => openEmail(PRIVACY_EMAIL, 'Privacy request — Aviation Job Talent')}
      />

      <SupportCard
        icon="🗑"
        title="Delete my account"
        description="Delete your account, direct identifiers and uploaded documents. The Privacy Policy explains the limited marketplace records that can remain."
        action="Go to delete account"
        onPress={() => router.push('/delete-account' as any)}
      />

      <View style={styles.legalLinks}>
        <Text style={styles.legalTitle}>Legal documents</Text>
        <TouchableOpacity
          style={styles.legalRow}
          onPress={() => router.push('/privacy-policy' as any)}
        >
          <Text style={styles.legalLink}>Privacy Policy</Text>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.legalRow}
          onPress={() => router.push('/terms-of-service' as any)}
        >
          <Text style={styles.legalLink}>Terms of Service</Text>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        Aviation Job Talent · {SUPPORT_EMAIL}
      </Text>
    </>
  );

  // Escritorio con sesión de empresa o técnico: dentro del marco del área, con
  // la barra superior y el menú de You (fase 8, decisión B).
  if (shellRole) {
    return (
      <AccountShell role={shellRole} active="help" title="Support" subtitle="We're here to help. Choose the topic that best fits your question.">
        {cards}
      </AccountShell>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        showsVerticalScrollIndicator={desktopScrollbar}
      >
        <TouchableOpacity onPress={goBack} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.h1}>Support</Text>
        <Text style={styles.subtitle}>
          We're here to help. Choose the topic that best fits your question.
        </Text>

        {cards}
      </ScrollView>
    </SafeAreaView>
  );
}

function SupportCard({
  icon,
  title,
  description,
  action,
  onPress,
}: {
  icon: string;
  title: string;
  description: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardIcon}>{icon}</Text>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDesc}>{description}</Text>
        <TouchableOpacity onPress={onPress} style={styles.cardAction} activeOpacity={0.75}>
          <Text style={styles.cardActionText}>{action} →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  scrollWide: {
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start', marginBottom: spacing.sm },
  backText: { color: colors.blue, fontSize: 14, fontWeight: '500' },
  h1: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
    marginBottom: spacing.xl,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  cardIcon: { fontSize: 24, marginTop: 2 },
  cardBody: { flex: 1 },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  cardDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  cardAction: { alignSelf: 'flex-start' },
  cardActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.blue,
  },
  legalLinks: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
  },
  legalTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  legalLink: { fontSize: 14, color: colors.text },
  arrow: { fontSize: 18, color: colors.textMuted },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
