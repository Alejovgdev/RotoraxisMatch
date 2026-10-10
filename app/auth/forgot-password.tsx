import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TextInput } from '../../src/components/ui/Text';
import { useDesktopScrollbar } from '../../src/components/ui/useDesktopScrollbar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { supabase } from '../../src/lib/supabase';
import { APP_PUBLIC_URL } from '../../src/lib/appUrl';
import { Button } from '../../src/components/Button';
import { colors, spacing } from '../../src/theme';

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export default function ForgotPasswordScreen() {
  // Escritorio: barra de desplazamiento visible (fase 8).
  const desktopScrollbar = useDesktopScrollbar();
  const router = useRouter();
  const goBack = useGoBack();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${APP_PUBLIC_URL}/auth/set-password` },
    );

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setSent(true);
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
            <Text style={styles.backText}>← Back to sign in</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.logoIcon}>✈</Text>
            <Text style={styles.title}>Forgot password</Text>
            <Text style={styles.subtitle}>
              Enter your email and we&apos;ll send you a link to reset your password.
            </Text>
          </View>

          {sent ? (
            <View style={styles.successCard}>
              <Text style={styles.successIcon}>✉</Text>
              <Text style={styles.successText}>
                If an account exists with this email, you will receive a password reset link.
              </Text>
              <Button
                label="Back to sign in"
                onPress={() => router.replace('/auth/login' as any)}
                fullWidth
                size="lg"
                style={styles.btn}
              />
            </View>
          ) : (
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
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                editable={!loading}
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Button
                label="Send reset link"
                onPress={handleSubmit}
                loading={loading}
                fullWidth
                size="lg"
                style={styles.btn}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    justifyContent: 'center',
  },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  backText: { color: colors.primary, fontSize: 14, fontWeight: '500' },
  header: { alignItems: 'center', paddingVertical: spacing.xl },
  logoIcon: { fontSize: 40, marginBottom: spacing.md },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4,
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
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
  errorText: { color: colors.error, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  btn: { marginTop: spacing.lg },
  successCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: 'center',
    gap: spacing.md,
  },
  successIcon: { fontSize: 40 },
  successText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
});
