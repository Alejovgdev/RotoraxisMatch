import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../src/state/useGoBack';
import { useAuth } from '../src/auth/AuthContext';
import { colors, spacing } from '../src/theme';

export default function PublicDeleteAccountScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { profile } = useAuth();
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

        <Text style={styles.h1}>How to delete your account</Text>
        <Text style={styles.subtitle}>
          You can permanently delete your account, direct identifiers and uploaded documents at any time.
        </Text>

        {/* If the user is logged in, offer direct action */}
        {profile ? (
          <View style={styles.callout}>
            <Text style={styles.calloutText}>
              You are signed in. You can delete your account directly:
            </Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => router.push('/account/delete' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnText}>Go to Delete Account →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.callout}>
            <Text style={styles.calloutText}>
              Sign in on this website, then open Settings → Delete account. You do not need to reinstall the mobile app.
            </Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => router.push('/auth/login' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnText}>Sign in →</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Step-by-step guide</Text>
          <Step n={1} text='Sign in using the button above or open the app and sign in.' />
          <Step n={2} text='Open Settings from your dashboard.' />
          <Step n={3} text='Scroll down to the Account section and tap "Delete account…"' />
          <Step n={4} text='Read the information about what will be deleted.' />
          <Step n={5} text='Type DELETE in the confirmation field and tap "Permanently delete my account".' />
          <Step n={6} text='The app confirms success only after your account credentials and uploaded files have been removed.' />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What is deleted and what can remain</Text>
          <Text style={styles.p}>
            <Text style={styles.bold}>Technicians: </Text>
            Names, contact details, date of birth, uploaded documents, cover notes, message content and authentication credentials are removed. A limited record of professional qualifications, coarse location and marketplace history remains linked by an internal account identifier, as explained in the Privacy Policy.
          </Text>
          <Text style={styles.p}>
            <Text style={styles.bold}>Company users: </Text>
            Your name, contact details, membership, message content and authentication credentials are removed. A limited deleted-account record retains the internal account identifier. The company profile, offers and marketplace history can remain for other members and platform integrity.
          </Text>
          <Text style={styles.p}>
            <Text style={styles.bold}>Only company administrator: </Text>
            The current deletion flow requires you to assign another administrator before deleting your membership. If you cannot do this, contact support for help with the company record and your deletion request.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Can't access the app?</Text>
          <Text style={styles.p}>
            If you cannot sign in or access the app, email our support team and we will process the deletion manually within 30 days:
          </Text>
          <Text style={styles.email}>support@aviationjobtalent.com</Text>
          <Text style={styles.p}>
            Subject: <Text style={styles.bold}>Account deletion request</Text>{'\n'}
            Include the email address associated with your account.
          </Text>
        </View>

        <Text style={styles.legal}>
          This external deletion path complements the deletion option available inside the app.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  scrollWide: {
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start', marginBottom: spacing.sm },
  backText: { color: colors.blue, fontSize: 14, fontWeight: '500' },
  h1: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  callout: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  calloutText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  bold: { fontWeight: '700', color: colors.text },
  btn: {
    backgroundColor: colors.blue,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.white,
    lineHeight: 16,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  p: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  email: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.blue,
    marginVertical: 4,
  },
  legal: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: spacing.md,
  },
});
