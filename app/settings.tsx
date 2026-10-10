import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Text } from '../src/components/ui/Text';
import { useDesktopScrollbar } from '../src/components/ui/useDesktopScrollbar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../src/state/useGoBack';
import Constants from 'expo-constants';
import { colors, spacing } from '../src/theme';
import { useAuth } from '../src/auth/AuthContext';
import { CompanyPageHeader } from '../src/components/company/CompanyUI';
import { AccountShell, useAccountShellRole } from '../src/components/AccountShell';

export default function SettingsScreen() {
  // Escritorio: barra de desplazamiento visible (fase 8).
  const desktopScrollbar = useDesktopScrollbar();
  const router = useRouter();
  const goBack = useGoBack();
  const { profile, signOut } = useAuth();
  const shellRole = useAccountShellRole();

  async function handleSignOut() {
    await signOut();
    router.replace('/' as any);
  }

  const sections = (
    <>
      {profile && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutKey}>Role</Text>
              <Text style={styles.aboutValue}>{profile.role}</Text>
            </View>
            <View style={[styles.aboutRow, styles.aboutRowLast]}>
              <Text style={styles.aboutKey}>Status</Text>
              <Text style={styles.aboutValue}>{profile.status}</Text>
            </View>
            <TouchableOpacity
              onPress={handleSignOut}
              style={[styles.btn, styles.btnDanger]}
              activeOpacity={0.8}
            >
              <Text style={[styles.btnText, styles.btnTextDanger]}>Sign out</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/account/delete' as any)}
              style={[styles.btn, styles.btnDestructive]}
              activeOpacity={0.8}
            >
              <Text style={[styles.btnText, styles.btnTextDestructive]}>Delete account…</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Help</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={[styles.legalRow, styles.legalRowLast]}
            onPress={() => router.push('/support' as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.legalLabel}>Support</Text>
            <Text style={styles.legalArrow}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Legal</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.legalRow}
            onPress={() => router.push('/privacy-policy' as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.legalLabel}>Privacy Policy</Text>
            <Text style={styles.legalArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.legalRow, styles.legalRowLast]}
            onPress={() => router.push('/terms-of-service' as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.legalLabel}>Terms of Service</Text>
            <Text style={styles.legalArrow}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutKey}>App</Text>
            <Text style={styles.aboutValue}>Aviation Job Talent</Text>
          </View>
          <View style={[styles.aboutRow, styles.aboutRowLast]}>
            <Text style={styles.aboutKey}>Version</Text>
            <Text style={styles.aboutValue}>{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          </View>
        </View>
      </View>
    </>
  );

  // Escritorio con sesión de empresa o técnico: dentro del marco del área, con
  // la barra superior y el menú de You (fase 8, decisión B). Sin la flecha:
  // el menú lleva a todas partes.
  if (shellRole) {
    return (
      <AccountShell role={shellRole} active="settings" title="Settings" subtitle="Account, help and legal.">
        {sections}
      </AccountShell>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={desktopScrollbar}
      >
        <CompanyPageHeader
          eyebrow="App"
          title="Settings"
          subtitle="Account, help and legal."
          onBack={goBack}
        />

        {sections}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  btnDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.error,
  },
  btnDestructive: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(180, 35, 24, 0.4)',
    marginTop: spacing.sm,
  },
  btnText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '800',
  },
  btnTextDanger: {
    color: colors.error,
  },
  btnTextDestructive: {
    color: 'rgba(180, 35, 24, 0.8)',
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  legalRowLast: { borderBottomWidth: 0 },
  legalLabel: { fontSize: 14, color: colors.text },
  legalArrow: { fontSize: 18, color: colors.textMuted, lineHeight: 22 },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  aboutRowLast: { borderBottomWidth: 0 },
  aboutKey: { fontSize: 14, color: colors.textSecondary },
  aboutValue: { fontSize: 14, fontWeight: '500', color: colors.text },
});
