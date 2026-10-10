import React from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Text } from '../../src/components/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { colors, spacing } from '../../src/theme';
import { useAuth } from '../../src/auth/AuthContext';

// Lo que se verifica en esta etapa es la IDENTIDAD, no las cualificaciones
// aeronáuticas. El copy anterior prometía "verify your credentials and
// profile", que era imposible: hasta que un admin aprueba la cuenta el técnico
// no puede completar el perfil ni subir un solo documento, así que no hay
// credenciales que revisar. Corregido 2026-07-29 (hallazgo F2 de la auditoría).
const STEPS = [
  {
    icon: '📋',
    title: 'Account created',
    description: 'Your registration was received.',
  },
  {
    icon: '🔍',
    title: 'Identity check',
    description:
      'Our team is confirming who you are. Nothing about your aviation qualifications is assessed at this stage.',
  },
  {
    icon: '✅',
    title: 'Once approved',
    description:
      "You'll be able to complete your profile, add your licences and type ratings, upload documents for verification, and appear in company searches.",
  },
];

export default function PendingVerificationScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const email = session?.user?.email ?? null;

  async function handleSignOut() {
    await signOut();
    router.replace('/' as any);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, isWide && styles.containerWide]}>
        {/* Icon */}
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>⏳</Text>
        </View>

        <Text style={styles.title}>Verifying your identity</Text>

        {email ? (
          <Text style={styles.emailNote}>
            Registered as{' '}
            <Text style={styles.emailHighlight}>{email}</Text>
          </Text>
        ) : null}

        <Text style={styles.body}>
          We're confirming you're a real person before opening the platform.
          This usually takes 1–2 business days.{'\n\n'}
          We are not reviewing your licences or type ratings yet — that happens
          later, from the documents you'll upload.
        </Text>

        {/* Steps */}
        <View style={styles.steps}>
          {STEPS.map((s, i) => (
            <View key={i} style={styles.step}>
              <View style={[styles.stepIcon, i === 1 && styles.stepIconActive]}>
                <Text style={styles.stepIconText}>{s.icon}</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={[styles.stepTitle, i === 1 && styles.stepTitleActive]}>
                  {s.title}
                </Text>
                <Text style={styles.stepDesc}>{s.description}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            label="Back to home"
            onPress={() => router.replace('/' as any)}
            fullWidth
            size="lg"
          />
          {session ? (
            <Button
              label="Sign out"
              onPress={handleSignOut}
              variant="outline"
              fullWidth
              size="md"
              style={styles.signOutBtn}
            />
          ) : null}
        </View>

        <Text style={styles.footer}>
          Need help? Contact support at{' '}
          <Text style={styles.footerLink}>support@aviationjobtalent.com</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: {
    flex: 1,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  containerWide: {
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(122, 63, 6, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  icon: { fontSize: 36 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emailNote: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  emailHighlight: { color: colors.text, fontWeight: '600' },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.xl,
  },
  steps: {
    width: '100%',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepIconActive: {
    backgroundColor: 'rgba(122, 63, 6, 0.18)',
  },
  stepIconText: { fontSize: 18 },
  stepContent: { flex: 1 },
  stepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  stepTitleActive: { color: colors.warning },
  stepDesc: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  actions: { width: '100%', gap: spacing.sm, marginBottom: spacing.lg },
  signOutBtn: { borderColor: colors.border },
  footer: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  footerLink: { color: colors.cyan },
});
