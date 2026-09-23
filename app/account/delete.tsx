import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/auth/AuthContext';
import { colors, spacing } from '../../src/theme';
import {
  DELETION_COMMENT_MAX_LENGTH,
  DELETION_REASON_CODES,
  DeletionReasonCode,
  deletionReasonLabel,
} from '../../src/constants/deletionReasons';

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { profile, signOut } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Encuesta de salida, OPCIONAL. No participa en `confirmed`: el botón de
  // borrar no depende de ella en ningún momento. Poner una pregunta entre
  // alguien y el ejercicio de su derecho de supresión sería obstruirlo.
  const [reason, setReason] = useState<DeletionReasonCode | null>(null);
  const [comment, setComment] = useState('');

  const isTechnician = profile?.role === 'technician';
  const confirmed = confirmText.trim().toUpperCase() === CONFIRM_WORD;

  async function handleDelete() {
    if (!confirmed) return;
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('Your session has expired. Please sign in again.');
        setLoading(false);
        return;
      }

      // Call via supabase.functions.invoke for clean URL resolution.
      // El motivo viaja en el cuerpo y lo escribe la Edge Function con
      // service_role: el cliente no puede insertar en account_deletion_feedback
      // (sin política de INSERT, y sin GRANT desde la migración 043).
      const trimmedComment = comment.trim();
      const { error: fnError } = await supabase.functions.invoke('delete-account', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: reason
          ? { reason, ...(trimmedComment ? { comment: trimmedComment } : {}) }
          : {},
      });

      if (fnError) {
        const msg = typeof fnError === 'object' && 'message' in fnError
          ? (fnError as any).message
          : 'Account deletion failed. Please try again.';
        setError(msg);
        setLoading(false);
        return;
      }

      setDone(true);
      await signOut();
      setTimeout(() => router.replace('/' as any), 1500);
    } catch (e: any) {
      setError(e?.message ?? 'An unexpected error occurred.');
      setLoading(false);
    }
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.doneWrap}>
          <Text style={styles.doneIcon}>✓</Text>
          <Text style={styles.doneTitle}>Account deleted</Text>
          <Text style={styles.doneSub}>Your account, direct identifiers and uploaded files have been removed. Redirecting…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity onPress={goBack} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>⚠</Text>
          </View>
          <Text style={styles.title}>Delete account</Text>
          <Text style={styles.subtitle}>
            This action is permanent and cannot be undone.
          </Text>
        </View>

        {/* What happens to the account data */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What happens to your data</Text>
          {isTechnician ? (
            <>
              <BulletItem text="Your direct profile identifiers and personal contact information" />
              <BulletItem text="All uploaded documents (licenses, medicals, IDs) — files removed from storage" />
              <BulletItem text="Cover notes on applications" />
              <BulletItem text="Chat messages you sent (replaced with [Message deleted])" />
              <BulletItem text="Your authentication credentials" />
              <BulletItem text="A limited professional and marketplace record remains linked by an internal account identifier, as described in the Privacy Policy" />
            </>
          ) : (
            <>
              <BulletItem text="Your company membership and profile information" />
              <BulletItem text="Chat messages you sent (replaced with [Message deleted])" />
              <BulletItem text="Your authentication credentials" />
              <BulletItem text="A limited deleted-account record retains the internal account identifier" />
              <BulletItem text="The company profile, offers and marketplace history can remain for other members and platform integrity" />
            </>
          )}
        </View>

        {/* Last-admin warning for company */}
        {!isTechnician && (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>
              If you are the only administrator of your company, you must assign another administrator before deleting your account.
            </Text>
          </View>
        )}

        {/* Exit survey — optional, never a gate. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Before you go</Text>
          <Text style={styles.surveyIntro}>
            Why are you leaving? This is optional — you can delete your account without answering.
            The stored row has no account ID, but your role, the day and any details you write could
            still make the answer indirectly identifiable. Please do not include personal details.
          </Text>
          {DELETION_REASON_CODES.map((code) => (
            <ReasonOption
              key={code}
              label={deletionReasonLabel(code, profile?.role)}
              selected={reason === code}
              // Segundo toque sobre la opción marcada la desmarca: sin esto, un
              // toque accidental no se puede deshacer y la única salida es
              // mandar un motivo que no es el tuyo.
              onPress={() => setReason((prev) => (prev === code ? null : code))}
            />
          ))}
          {reason ? (
            <TextInput
              style={styles.commentInput}
              value={comment}
              onChangeText={setComment}
              // Aviso explícito: la fila no lleva identidad, pero nada impide
              // que alguien escriba la suya en el texto libre. Pedirlo aquí es
              // más barato y más honesto que intentar detectarlo después.
              placeholder="Anything else? (optional — please don't include personal details)"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              maxLength={DELETION_COMMENT_MAX_LENGTH}
              textAlignVertical="top"
            />
          ) : null}
        </View>

        {/* Confirmation */}
        <View style={styles.card}>
          <Text style={styles.confirmLabel}>
            Type <Text style={styles.confirmWord}>{CONFIRM_WORD}</Text> to confirm
          </Text>
          <TextInput
            style={[
              styles.input,
              confirmed && styles.inputConfirmed,
            ]}
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder="Type DELETE"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}

        <TouchableOpacity
          style={[
            styles.deleteBtn,
            (!confirmed || loading) && styles.deleteBtnDisabled,
          ]}
          onPress={handleDelete}
          disabled={!confirmed || loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.deleteBtnText}>Permanently delete my account</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footerNote}>
          Need help instead?{' '}
          <Text
            style={styles.footerLink}
            onPress={() => router.push('/support' as any)}
          >
            Contact support
          </Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ReasonOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.reasonRow, selected && styles.reasonRowSelected]}
      onPress={onPress}
      activeOpacity={0.78}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function BulletItem({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  scrollWide: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  backText: { color: colors.cyanLight, fontSize: 14, fontWeight: '500' },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(239,68,68,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  icon: { fontSize: 30 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.white,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    color: colors.error,
    textAlign: 'center',
    lineHeight: 20,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.navyLight,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.cyanLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  bulletDot: { color: colors.error, fontSize: 14, marginTop: 1, width: 14 },
  bulletText: { flex: 1, fontSize: 13, color: colors.cyanLight, lineHeight: 19 },
  warningCard: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    marginBottom: spacing.md,
  },
  warningText: {
    fontSize: 13,
    color: colors.warning,
    lineHeight: 19,
    fontWeight: '500',
  },
  surveyIntro: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  reasonRowSelected: {
    borderColor: colors.cyan,
    backgroundColor: 'rgba(6,182,212,0.12)',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.cyan,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.cyan,
  },
  reasonText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.cyanLight,
    fontWeight: '500',
  },
  reasonTextSelected: {
    color: colors.white,
    fontWeight: '600',
  },
  commentInput: {
    marginTop: spacing.xs,
    minHeight: 76,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    color: colors.white,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  confirmLabel: {
    fontSize: 13,
    color: colors.cyanLight,
    marginBottom: spacing.xs,
  },
  confirmWord: {
    fontWeight: '700',
    color: colors.error,
    fontFamily: 'monospace' as any,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    letterSpacing: 2,
  },
  inputConfirmed: {
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.sm,
    lineHeight: 19,
  },
  deleteBtn: {
    backgroundColor: colors.error,
    borderRadius: 14,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginBottom: spacing.md,
  },
  deleteBtnDisabled: { opacity: 0.4 },
  deleteBtnText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  footerNote: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  footerLink: { color: colors.cyan, fontWeight: '600' },
  doneWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  doneIcon: { fontSize: 48, color: colors.success, marginBottom: spacing.md },
  doneTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.white,
    marginBottom: spacing.sm,
  },
  doneSub: { fontSize: 14, color: colors.cyanLight, textAlign: 'center' },
});
