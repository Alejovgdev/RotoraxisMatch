import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Text, TextInput } from '../../src/components/ui/Text';
import { useDesktopScrollbar } from '../../src/components/ui/useDesktopScrollbar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { useAuth } from '../../src/auth/AuthContext';
import { Button } from '../../src/components/Button';
import { colors, spacing } from '../../src/theme';
import { fonts } from '../../src/theme/fonts';
import { AppRole } from '../../src/types/enums';

function roleRoute(role: AppRole): string {
  if (role === 'admin') return '/admin';
  if (role === 'company_user') return '/company';
  return '/technician';
}

export default function LoginScreen() {
  // Escritorio: barra de desplazamiento visible (fase 8).
  const desktopScrollbar = useDesktopScrollbar();
  const router = useRouter();
  const goBack = useGoBack();
  const { signIn, profile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Redirect once profile is loaded after sign-in
  useEffect(() => {
    if (!profile) return;
    router.replace(roleRoute(profile.role) as any);
  }, [profile]);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    const { error: signInError } = await signIn(email.trim(), password);
    if (signInError) {
      setError(signInError);
      setLoading(false);
    }
    // On success: keep loading=true until profile redirect fires
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={desktopScrollbar}
        >
          <TouchableOpacity onPress={goBack} style={styles.back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.logoIcon}>✈</Text>
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.subtitle}>Aviation Job Talent</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={colors.placeholder}
              autoComplete="email"
              returnKeyType="next"
            />

            <Text style={[styles.label, { marginTop: spacing.md }]}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={colors.placeholder}
              autoComplete="current-password"
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
            />

            <TouchableOpacity
              onPress={() => router.push('/auth/forgot-password' as any)}
              style={styles.forgotWrap}
            >
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </TouchableOpacity>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Button
              label="Sign in"
              onPress={handleSignIn}
              loading={loading}
              fullWidth
              size="lg"
              style={styles.btn}
            />
          </View>

          <View style={styles.createRow}>
            <Text style={styles.createNote}>Don&apos;t have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/auth/signup' as any)}>
              <Text style={styles.createLink}>Create account</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footerNote}>
            Access depends on your account role and verification status.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  back: {
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
  },
  backText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  logoIcon: {
    fontSize: 40,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontFamily: fonts.logo,
    fontSize: 18,
    color: colors.logo,
    marginTop: 4,
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  btn: {
    marginTop: spacing.lg,
  },
  createRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  createNote: { color: colors.textMuted, fontSize: 13 },
  createLink: { color: colors.cyan, fontSize: 13, fontWeight: '600' },
  forgotWrap: { alignSelf: 'flex-end', paddingVertical: 4 },
  forgotLink: { color: colors.cyan, fontSize: 13, fontWeight: '500' },
  footerNote: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
});
