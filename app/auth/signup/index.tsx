import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { colors, spacing } from '../../../src/theme';

interface RoleCard {
  role: 'technician' | 'company';
  icon: string;
  title: string;
  subtitle: string;
  accent: string;
  route: string;
}

const ROLES: RoleCard[] = [
  {
    role: 'technician',
    icon: '🔧',
    title: 'I am an Aviation Technician',
    subtitle: 'Mechanic, avionics tech, engineer or inspector seeking opportunities.',
    accent: colors.technician,
    route: '/auth/signup/technician',
  },
  {
    role: 'company',
    icon: '🏢',
    title: 'I represent a Company',
    subtitle: 'MRO, airline, operator, or recruiter looking for certified talent.',
    accent: colors.company,
    route: '/auth/signup/company',
  },
];

export default function SignupScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={goBack} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.logoIcon}>✈</Text>
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>
            Choose how you will use Aviation Job Talent.
          </Text>
        </View>

        <View style={styles.roles}>
          {ROLES.map((r) => (
            <TouchableOpacity
              key={r.role}
              style={[styles.card, { borderColor: r.accent + '40' }]}
              onPress={() => router.push(r.route as any)}
              activeOpacity={0.82}
            >
              <View style={[styles.cardIcon, { backgroundColor: r.accent + '20' }]}>
                <Text style={styles.cardIconText}>{r.icon}</Text>
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{r.title}</Text>
                <Text style={styles.cardSubtitle}>{r.subtitle}</Text>
              </View>
              <Text style={[styles.arrow, { color: r.accent }]}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.loginRow}>
          <Text style={styles.loginNote}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.replace('/auth/login' as any)}>
            <Text style={styles.loginLink}>Sign in</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footerNote}>
          All accounts require verification before full access.{'\n'}
          Admin accounts are created by the platform team only.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  scroll: { flexGrow: 1, padding: spacing.lg },
  scrollWide: {
    paddingHorizontal: spacing.xxxl,
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  backText: { color: colors.cyanLight, fontSize: 14, fontWeight: '500' },
  header: { alignItems: 'center', paddingVertical: spacing.xxl },
  logoIcon: { fontSize: 40, marginBottom: spacing.md },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.white,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 15,
    color: colors.cyanLight,
    textAlign: 'center',
    lineHeight: 22,
  },
  roles: { gap: spacing.md, marginBottom: spacing.xl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.navyLight,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardIconText: { fontSize: 24 },
  cardContent: { flex: 1 },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
    marginBottom: 3,
  },
  cardSubtitle: { fontSize: 12, color: colors.cyanLight, lineHeight: 17 },
  arrow: { fontSize: 26, fontWeight: '300', flexShrink: 0 },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  loginNote: { color: colors.textMuted, fontSize: 13 },
  loginLink: { color: colors.cyan, fontSize: 13, fontWeight: '600' },
  footerNote: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
