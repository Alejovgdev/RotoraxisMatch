// Adonde vuelve el enlace del correo de confirmación (EXPO_PUBLIC_APP_URL +
// /auth/confirm). Supabase ya ha confirmado el email antes de redirigir aquí;
// esta pantalla inicia la sesión con los tokens del enlace, para que la ficha de
// técnico o empresa se cree en ese momento (AuthContext), y lo cuenta.
//
// El enlace abre siempre la web: quien se registró en la app del móvil confirma
// en el navegador y vuelve a la app a iniciar sesión.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { CircleCheck, Mail, MailCheck, TriangleAlert } from 'lucide-react-native';
import { Button } from '../../src/components/Button';
import { AuthStatusLayout, AuthStatusText } from '../../src/components/auth/AuthStatusLayout';
import { useAuth } from '../../src/auth/AuthContext';
import {
  completeEmailConfirmation,
  type EmailConfirmationResult,
} from '../../src/auth/emailConfirmation';
import { CONFIRM_EMAIL_PATH, NETWORK_ERROR_TEXT } from '../../src/auth/emailConfirmationRules';
import { roleHomeRoute } from '../../src/utils/backNavigation';
import { colors } from '../../src/theme';

type ScreenState = { status: 'checking' } | EmailConfirmationResult;

async function currentUrl(): Promise<string> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.href;
  return (await Linking.getInitialURL()) ?? '';
}

/** Quita los tokens de la barra de direcciones en cuanto se han leído. */
function cleanUrl(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.history.replaceState(null, '', CONFIRM_EMAIL_PATH);
}

export default function ConfirmEmailScreen() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'checking' });
  // Una sola vez aunque el efecto se monte dos veces (modo estricto): la
  // segunda vuelta ya no encontraría los tokens en la URL.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      let result: EmailConfirmationResult;
      try {
        const url = await currentUrl();
        cleanUrl();
        result = await completeEmailConfirmation(url);
      } catch {
        result = { status: 'failed', message: NETWORK_ERROR_TEXT };
      }
      setState(result);
    })();
  }, []);

  function goToSignIn() {
    router.replace('/auth/login' as any);
  }

  function handleContinue() {
    // Sin perfil todavía, la raíz espera a que llegue y redirige por rol.
    router.replace((profile ? roleHomeRoute(profile.role, profile.status) : '/') as any);
  }

  if (state.status === 'checking') {
    return (
      <AuthStatusLayout icon={MailCheck} tone="info" title="Confirming your email">
        <ActivityIndicator color={colors.primary} />
      </AuthStatusLayout>
    );
  }

  if (state.status === 'confirmed') {
    return (
      <AuthStatusLayout
        icon={CircleCheck}
        tone="success"
        title="Email confirmed"
        actions={
          <Button label="Continue" onPress={handleContinue} loading={authLoading} size="lg" fullWidth />
        }
      >
        <AuthStatusText>
          {profile?.status === 'active'
            ? 'Your account is ready to use.'
            : 'Your account is now waiting for our identity check. This usually takes 1–2 business days.'}
        </AuthStatusText>
        <AuthStatusText tone="muted">
          Signed up in the mobile app? Go back to the app and sign in.
        </AuthStatusText>
      </AuthStatusLayout>
    );
  }

  if (state.status === 'failed') {
    return (
      <AuthStatusLayout
        icon={TriangleAlert}
        tone="attention"
        title="This link didn't work"
        actions={<Button label="Sign in" onPress={goToSignIn} size="lg" fullWidth />}
      >
        <AuthStatusText>{state.message}</AuthStatusText>
        <AuthStatusText tone="muted">
          If your email isn&apos;t confirmed yet, sign in and we&apos;ll offer to send a new link.
        </AuthStatusText>
      </AuthStatusLayout>
    );
  }

  return (
    <AuthStatusLayout
      icon={Mail}
      tone="info"
      title="Confirm your email"
      actions={<Button label="Sign in" onPress={goToSignIn} size="lg" fullWidth />}
    >
      <AuthStatusText>
        Open the confirmation link we sent to your email address. If you already did, sign in.
      </AuthStatusText>
    </AuthStatusLayout>
  );
}
