import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { supabase } from '../../../src/lib/supabase';
import { useCompanyTypes } from '../../../src/auth/useCatalogOptions';
import { AuthPickerField, PickerOption } from '../../../src/components/auth/AuthPickerField';
import { CountryCityPicker } from '../../../src/components/CountryCityPicker';
import { EMPTY_LOCATION, LocationValue } from '../../../src/types/location';
import { persistedLocationFromValue } from '../../../src/utils/locationBridge';
import { Button } from '../../../src/components/Button';
import { colors, spacing } from '../../../src/theme';
import { LEGAL_CONSENT_VERSION } from '../../../src/constants/legal';

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export default function CompanySignupScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { options: companyTypes, loading: typesLoading } = useCompanyTypes();

  const [companyName, setCompanyName] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [location, setLocation] = useState<LocationValue>(EMPTY_LOCATION);

  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const companyTypeOptions: PickerOption[] = companyTypes.map((t) => ({
    value: t.code,
    label: t.label,
  }));

  function validate(): string | null {
    if (!companyName.trim()) return 'Company name is required.';
    if (!companyType) return 'Select a company type.';
    if (!isValidEmail(email)) return 'Enter a valid email address.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password !== confirmPassword) return 'Passwords do not match.';
    // Sólo el país es obligatorio; la ciudad es opcional.
    if (!location.country) return 'Select your country.';
    if (!tosAccepted) return 'You must agree to the Terms of Service and acknowledge the Privacy Policy to continue.';
    return null;
  }

  async function handleSubmit() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setLoading(true);

    // Una sola conversión para los dos caminos de alta (RPC inmediato y
    // metadata para después de confirmar el email), así no pueden divergir.
    const persisted = persistedLocationFromValue(location);
    const signupLocationMetadata = {
      location_country_code: persisted.locationCountryCode,
      location_city_name: persisted.locationCityName ?? null,
      location_city_lat: persisted.locationCityLat ?? null,
      location_city_lng: persisted.locationCityLng ?? null,
      location_city_geoname_id: persisted.locationCityGeonameId ?? null,
    };
    const legalAcceptedAt = new Date().toISOString();

    // Step 1: Create auth user — trigger auto-creates profiles row
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          role: 'company_user',
          company_name: companyName.trim(),
          company_type: companyType,
          // Fase 7 F2c: país y ciudad, no un aeropuerto.
          ...signupLocationMetadata,
          tos_accepted_at: legalAcceptedAt,
          tos_version: LEGAL_CONSENT_VERSION,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Step 2: Create company + company_member via SECURITY DEFINER RPC
    if (data.session) {
      const { error: rpcError } = await supabase.rpc('signup_company', {
        p_company_name: companyName.trim(),
        p_company_type: companyType,
        p_location_country_code: persisted.locationCountryCode,
        p_location_city_name: persisted.locationCityName ?? null,
        p_location_city_lat: persisted.locationCityLat ?? null,
        p_location_city_lng: persisted.locationCityLng ?? null,
        p_location_city_geoname_id: persisted.locationCityGeonameId ?? null,
      });

      if (rpcError) {
        setError(
          'Account created but company setup failed. Error: ' + rpcError.message
        );
        setLoading(false);
        return;
      }

      // Record ToS consent. ignoreDuplicates: true — user_consents has no
      // UPDATE policy while the account is active (append-only audit trail,
      // migration 015); a retried
      // signup for the same user_id/version must skip the conflicting row
      // rather than take the default upsert's ON CONFLICT DO UPDATE path,
      // which RLS would reject.
      const { error: consentError } = await supabase.from('user_consents').upsert(
        {
          user_id: data.user!.id,
          consent_type: 'tos_privacy',
          consent_version: LEGAL_CONSENT_VERSION,
          accepted_at: legalAcceptedAt,
        },
        { onConflict: 'user_id,consent_type,consent_version', ignoreDuplicates: true },
      );
      if (consentError) console.error('Failed to record ToS consent:', consentError);
    }

    router.replace('/auth/pending-verification' as any);
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
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.title}>Company account</Text>
            <Text style={styles.subtitle}>
              Register your organisation. All fields are required.{'\n'}
              Your account will be verified before full access is granted.
            </Text>
          </View>

          <View style={styles.form}>
            {/* Company name */}
            <FormField label="Company name">
              <TextInput
                style={styles.input}
                value={companyName}
                onChangeText={setCompanyName}
                placeholder="Acme Aviation MRO"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </FormField>

            {/* Company type */}
            <AuthPickerField
              label="Company type"
              placeholder="Select company type..."
              value={companyType}
              onChange={setCompanyType}
              options={companyTypeOptions}
              loading={typesLoading}
              modalTitle="Select company type"
            />

            {/* Fase 7 F2c: país obligatorio, ciudad opcional. */}
            <CountryCityPicker value={location} onChange={setLocation} />

            {/* Email */}
            <FormField label="Contact email">
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="hr@company.com"
                placeholderTextColor={colors.textMuted}
                autoComplete="email"
                returnKeyType="next"
              />
            </FormField>

            {/* Password */}
            <FormField label="Password">
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="Min 8 characters"
                placeholderTextColor={colors.textMuted}
                returnKeyType="next"
              />
            </FormField>

            <FormField label="Confirm password">
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                placeholder="Repeat password"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </FormField>
          </View>

          {/* ToS + Privacy consent checkbox */}
          <View style={styles.consentRow}>
            <TouchableOpacity
            onPress={() => setTosAccepted((v) => !v)}
            activeOpacity={0.75}
            hitSlop={11}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: tosAccepted }}
            accessibilityLabel="Agree to the Terms of Service and acknowledge the Privacy Policy"
            >
              <View style={[styles.checkbox, tosAccepted && styles.checkboxChecked]}>
                {tosAccepted ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
            </TouchableOpacity>
            <Text style={styles.consentText}>
              I agree to the{' '}
              <Text
                style={styles.consentLink}
                onPress={(e) => { e.stopPropagation(); router.push('/terms-of-service' as any); }}
                accessibilityRole="link"
              >
                Terms of Service
              </Text>
              {' '}and acknowledge that I have read the{' '}
              <Text
                style={styles.consentLink}
                onPress={(e) => { e.stopPropagation(); router.push('/privacy-policy' as any); }}
                accessibilityRole="link"
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Button
            label="Create company account"
            onPress={handleSubmit}
            loading={loading}
            fullWidth
            size="lg"
            style={styles.btn}
          />

          <Text style={styles.footerNote}>
            You will be registered as the account administrator.{'\n'}
            Additional team members can be invited after verification.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  backText: { color: colors.cyanLight, fontSize: 14, fontWeight: '500' },
  header: { marginBottom: spacing.lg },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.white,
    marginBottom: spacing.sm,
  },
  subtitle: { fontSize: 13, color: colors.cyanLight, lineHeight: 19 },
  form: {
    backgroundColor: colors.navyLight,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  fieldWrap: { gap: 6 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.cyanLight,
    marginBottom: 2,
  },
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
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkboxChecked: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyan + '33',
  },
  checkmark: { fontSize: 13, color: colors.cyan, fontWeight: '700', lineHeight: 16 },
  consentText: { flex: 1, fontSize: 13, color: colors.cyanLight, lineHeight: 20 },
  consentLink: { color: colors.cyan, fontWeight: '600', textDecorationLine: 'underline' as const },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  btn: { marginBottom: spacing.md },
  footerNote: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
});
