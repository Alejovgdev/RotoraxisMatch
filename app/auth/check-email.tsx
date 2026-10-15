// "Check your email": después de registrarse con la confirmación del email
// activada en Supabase, o al intentar entrar sin haberla hecho. Con la
// confirmación desactivada nadie llega aquí: el alta devuelve la sesión y sigue
// a pending-verification como siempre.
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { Text } from '../../src/components/ui/Text';
import { Button } from '../../src/components/Button';
import { AuthStatusLayout, AuthStatusText } from '../../src/components/auth/AuthStatusLayout';
import { resendSignupConfirmation, type ResendResult } from '../../src/auth/emailConfirmation';
import {
  NETWORK_ERROR_TEXT,
  RESEND_COOLDOWN_SECONDS,
  type CheckEmailReason,
} from '../../src/auth/emailConfirmationRules';
import { colors } from '../../src/theme';

export default function CheckEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; reason?: string }>();
  const email = typeof params.email === 'string' ? params.email.trim() : '';
  const reason: CheckEmailReason = params.reason === 'unconfirmed' ? 'unconfirmed' : 'signup';

  // Al llegar desde el alta el correo acaba de salir, y Supabase no deja pedir
  // otro a la misma dirección hasta pasado el minuto: el botón empieza
  // esperando. Desde el login no se ha enviado nada y se puede pedir ya.
  const [cooldownUntil, setCooldownUntil] = useState(() =>
    reason === 'signup' ? Date.now() + RESEND_COOLDOWN_SECONDS * 1000 : 0,
  );
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const waiting = secondsLeft > 0;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  function startCooldown(seconds: number) {
    const start = Date.now();
    setNow(start);
    setCooldownUntil(start + seconds * 1000);
  }

  async function handleResend() {
    if (!email || sending || waiting) return;
    setSending(true);
    setError(null);
    setSent(false);
    let result: ResendResult;
    try {
      result = await resendSignupConfirmation(email);
    } catch {
      result = { ok: false, message: NETWORK_ERROR_TEXT, retryAfterSeconds: null };
    }
    setSending(false);
    if (result.ok) {
      setSent(true);
      startCooldown(RESEND_COOLDOWN_SECONDS);
      return;
    }
    setError(result.message);
    if (result.retryAfterSeconds) startCooldown(result.retryAfterSeconds);
  }

  const emailText = <Text style={styles.email}>{email}</Text>;

  return (
    <AuthStatusLayout
      icon={Mail}
      tone="info"
      title={reason === 'unconfirmed' ? 'Confirm your email first' : 'Check your email'}
      actions={
        <>
          {email ? (
            <Button
              label={waiting ? `Resend email in ${secondsLeft}s` : 'Resend email'}
              onPress={handleResend}
              loading={sending}
              disabled={waiting}
              variant={reason === 'unconfirmed' ? 'primary' : 'outline'}
              size="lg"
              fullWidth
            />
          ) : null}
          <Button
            label="Back to sign in"
            onPress={() => router.replace('/auth/login' as any)}
            variant={reason === 'unconfirmed' && email ? 'outline' : 'primary'}
            size="lg"
            fullWidth
          />
        </>
      }
    >
      {!email ? (
        <AuthStatusText>Open the confirmation link we sent to your email address.</AuthStatusText>
      ) : reason === 'unconfirmed' ? (
        <AuthStatusText>
          Your email isn&apos;t confirmed yet. Open the link we sent to {emailText}, or ask for a new one.
        </AuthStatusText>
      ) : (
        <AuthStatusText>
          We sent a confirmation link to {emailText}. Open it to activate your account.
        </AuthStatusText>
      )}
      <AuthStatusText tone="muted">Can&apos;t find it? Check your spam folder.</AuthStatusText>
      {sent ? <AuthStatusText tone="success">New email sent.</AuthStatusText> : null}
      {error ? <AuthStatusText tone="error">{error}</AuthStatusText> : null}
    </AuthStatusLayout>
  );
}

const styles = StyleSheet.create({
  email: { color: colors.text, fontWeight: '700' },
});
