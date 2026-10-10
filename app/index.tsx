import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Text } from '../src/components/ui/Text';
import { useDesktopScrollbar } from '../src/components/ui/useDesktopScrollbar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '../src/components/Button';
import { colors, spacing } from '../src/theme';
import { fonts } from '../src/theme/fonts';
import { hasSeenIntro } from '../src/storage/introStorage';
import { useAuth } from '../src/auth/AuthContext';
// La misma tabla que usa la flecha de atrás cuando no hay historial
// (src/utils/backNavigation.ts). Dos copias acabarían mandando al mismo
// usuario a sitios distintos según por dónde entrara.
import { roleHomeRoute } from '../src/utils/backNavigation';

const STATS = [
  { value: '100%', label: 'Privacy First' },
  { value: 'B2B', label: 'Aviation only' },
  { value: 'GDPR', label: 'Compliant' },
];

const VALUE_PROPS = [
  {
    icon: '🔒',
    title: 'Privacy by default',
    description: 'Your identity stays anonymous until you choose to connect.',
  },
  {
    icon: '✅',
    title: 'Verified professionals',
    description: 'Licenses and qualifications independently verified.',
  },
  {
    icon: '🎯',
    title: 'Precision matching',
    description: 'Find talent by license, type rating and location.',
  },
];

export default function HomeScreen() {
  // Escritorio: barra de desplazamiento visible (fase 8).
  const desktopScrollbar = useDesktopScrollbar();
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const [introChecked, setIntroChecked] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (profile) {
      router.replace(roleHomeRoute(profile.role, profile.status) as any);
      return;
    }
    hasSeenIntro().then((seen) => {
      if (!seen) {
        router.replace('/intro' as any);
      } else {
        setIntroChecked(true);
      }
    });
  }, [authLoading, profile]);

  if (authLoading || !introChecked) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.cyan} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        showsVerticalScrollIndicator={desktopScrollbar}
      >
        <View style={styles.hero}>
          <View style={styles.logoWrap}>
            <Text style={styles.logoIcon}>✈</Text>
          </View>
          <Text style={styles.appName}>Aviation Job Talent</Text>
          <Text style={styles.tagline}>
            The professional network for{'\n'}aviation technicians and operators
          </Text>
        </View>

        <View style={styles.statsRow}>
          {STATS.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={styles.statDivider} />}
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        <View style={styles.propsCard}>
          {VALUE_PROPS.map((vp, i) => (
            <ValueProp
              key={vp.title}
              icon={vp.icon}
              title={vp.title}
              description={vp.description}
              last={i === VALUE_PROPS.length - 1}
            />
          ))}
        </View>

        <View style={styles.cta}>
          <Button
            label="Sign in"
            onPress={() => router.push('/auth/login' as any)}
            fullWidth
            size="lg"
          />
          <Button
            label="Create account"
            onPress={() => router.push('/auth/signup' as any)}
            variant="outline"
            fullWidth
            size="md"
            style={styles.secondaryBtn}
          />
        </View>

        <TouchableOpacity
          onPress={() => router.push('/settings' as any)}
          style={styles.settingsLink}
        >
          <Text style={styles.settingsLinkText}>⚙ Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function ValueProp({
  icon,
  title,
  description,
  last = false,
}: {
  icon: string;
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <View style={[vpStyles.row, !last && vpStyles.border]}>
      <View style={vpStyles.iconWrap}>
        <Text style={vpStyles.icon}>{icon}</Text>
      </View>
      <View style={vpStyles.text}>
        <Text style={vpStyles.title}>{title}</Text>
        <Text style={vpStyles.description}>{description}</Text>
      </View>
    </View>
  );
}

const vpStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
  },
  border: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 11,
    backgroundColor: 'rgba(11, 106, 158, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    flexShrink: 0,
  },
  icon: { fontSize: 20 },
  text: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 3,
  },
  description: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
});

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  scrollWide: {
    paddingHorizontal: spacing.xxxl,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    shadowColor: colors.cyan,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  logoIcon: { fontSize: 38 },
  appName: {
    fontFamily: fonts.logo,
    fontSize: 30,
    color: colors.logo,
    marginBottom: spacing.sm,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: spacing.lg,
    paddingVertical: spacing.md,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 28,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  propsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  cta: {
    marginBottom: spacing.lg,
  },
  secondaryBtn: {
    marginTop: spacing.sm,
    borderColor: colors.border,
  },
  settingsLink: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  settingsLinkText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
});
