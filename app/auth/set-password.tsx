import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
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
import { supabase } from '../../src/lib/supabase';
import { Button } from '../../src/components/Button';
import { colors, spacing } from '../../src/theme';
import type { AppRole, UserStatus } from '../../src/types/enums';

type ProfileRouteData = {
  role: AppRole;
  status: UserStatus;
};

type AuthUrlParams = {
  accessToken?: string;
  refreshToken?: string;
  code?: string;
  tokenHash?: string;
  type?: string;
  errorDescription?: string;
};

function routeForProfile(profile: ProfileRouteData): string {
  if (profile.status !== 'active') return '/auth/pending-verification';
  if (profile.role === 'admin') return '/admin';
  if (profile.role === 'company_user') return '/company';
  return '/technician';
}

async function getCurrentUrl(): Promise<string> {
  if (typeof window !== 'undefined') return window.location.href;
  return (await Linking.getInitialURL()) ?? '';
}

function readAuthParams(url: string): AuthUrlParams {
  if (!url) return {};

  try {
    const parsed = new URL(url);
    const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const hashParams = new URLSearchParams(hash);
    const searchParams = parsed.searchParams;
    const get = (key: string) => hashParams.get(key) ?? searchParams.get(key) ?? undefined;

    return {
      accessToken: get('access_token'),
      refreshToken: get('refresh_token'),
      code: get('code'),
      tokenHash: get('token_hash'),
      type: get('type'),
      errorDescription: get('error_description'),
    };
  } catch {
    return {};
  }
}

function cleanUrl() {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', '/auth/set-password');
}

export default function SetPasswordScreen() {
  // Escritorio: barra de desplazamiento visible (fase 8).
  const desktopScrollbar = useDesktopScrollbar();
  const router = useRouter();
  const [preparing, setPreparing] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function prepareSession() {
      setPreparing(true);
      setError(null);

      try {
        const url = await getCurrentUrl();
        const params = readAuthParams(url);

        if (params.errorDescription) {
          throw new Error(params.errorDescription.replace(/\+/g, ' '));
        }

        if (params.accessToken && params.refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: params.accessToken,
            refresh_token: params.refreshToken,
          });
          if (setSessionError) throw new Error(setSessionError.message);
          cleanUrl();
        } else if (params.code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
          if (exchangeError) throw new Error(exchangeError.message);
          cleanUrl();
        } else if (params.tokenHash) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: params.tokenHash,
            type: params.type === 'recovery' ? 'recovery' : 'invite',
          });
          if (verifyError) throw new Error(verifyError.message);
          cleanUrl();
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw new Error(sessionError.message);
        if (!sessionData.session) {
          throw new Error('Open the invitation email link again to set your password.');
        }

        if (active) setSessionReady(true);
      } catch (sessionError) {
        if (active) {
          setSessionReady(false);
          setError(sessionError instanceof Error ? sessionError.message : 'Could not prepare invitation session.');
        }
      } finally {
        if (active) setPreparing(false);
      }
    }

    prepareSession();
    return () => {
      active = false;
    };
  }, []);

  async function destinationAfterPassword(): Promise<string> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return '/auth/login';

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (profileError || !profile) return '/auth/login';
    return routeForProfile(profile as ProfileRouteData);
  }

  async function handleSavePassword() {
    if (!sessionReady) {
      setError('Open the invitation email link again to set your password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);

      const destination = await destinationAfterPassword();
      router.replace(destination as any);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update password.');
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={desktopScrollbar}
        >
          <TouchableOpacity onPress={() => router.replace('/auth/login' as any)} style={styles.back}>
            <Text style={styles.backText}>Back to sign in</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.title}>Set your password</Text>
            <Text style={styles.subtitle}>
              Create your own password to access Aviation Job Talent from the sign-in screen.
            </Text>
          </View>

          <View style={styles.form}>
            {preparing ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.cyan} />
                <Text style={styles.loadingText}>Preparing invitation session...</Text>
              </View>
            ) : (
              <>
                <Text style={styles.label}>New password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="Min 8 characters"
                  placeholderTextColor={colors.placeholder}
                  autoComplete="new-password"
                  editable={sessionReady && !saving}
                />

                <Text style={[styles.label, styles.confirmLabel]}>Confirm password</Text>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  placeholder="Repeat password"
                  placeholderTextColor={colors.placeholder}
                  autoComplete="new-password"
                  returnKeyType="done"
                  onSubmitEditing={handleSavePassword}
                  editable={sessionReady && !saving}
                />

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <Button
                  label="Save password"
                  onPress={handleSavePassword}
                  loading={saving}
                  disabled={!sessionReady}
                  fullWidth
                  size="lg"
                  style={styles.button}
                />
              </>
            )}
          </View>
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
  keyboard: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    justifyContent: 'center',
  },
  back: {
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
  },
  backText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    paddingVertical: spacing.xl,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  loadingRow: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  confirmLabel: {
    marginTop: spacing.md,
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
    lineHeight: 18,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.lg,
  },
});
