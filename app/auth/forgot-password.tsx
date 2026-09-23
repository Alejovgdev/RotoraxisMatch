import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
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
          showsVerticalScrollIndicator={false}
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
                placeholderTextColor={colors.textMuted}
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
  safe: { flex: 1, backgroundColor: colors.navy },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    justifyContent: 'center',
  },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  backText: { color: colors.cyanLight, fontSize: 14, fontWeight: '500' },
  header: { alignItems: 'center', paddingVertical: spacing.xl },
  logoIcon: { fontSize: 40, marginBottom: spacing.md },
  title: { fontSize: 28, fontWeight: '700', color: colors.white },
  subtitle: {
    fontSize: 13,
    color: colors.cyanLight,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4,
  },
  form: {
    backgroundColor: colors.navyLight,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.cyanLight, marginBottom: 6 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    color: colors.white,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  errorText: { color: colors.error, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  btn: { marginTop: spacing.lg },
  successCard: {
    backgroundColor: colors.navyLight,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    gap: spacing.md,
  },
  successIcon: { fontSize: 40 },
  successText: {
    fontSize: 14,
    color: colors.cyanLight,
    textAlign: 'center',
    lineHeight: 21,
  },
});
