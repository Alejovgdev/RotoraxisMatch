import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Text, TextInput } from '../../../src/components/ui/Text';
import { useDesktopScrollbar } from '../../../src/components/ui/useDesktopScrollbar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { supabase } from '../../../src/lib/supabase';
import { useTechnicianTypes } from '../../../src/auth/useCatalogOptions';
import { AuthPickerField, PickerOption } from '../../../src/components/auth/AuthPickerField';
import { CountryCityPicker } from '../../../src/components/CountryCityPicker';
import { EMPTY_LOCATION, LocationValue } from '../../../src/types/location';
import { persistedLocationFromValue } from '../../../src/utils/locationBridge';
import { TechnicianTypeSelector } from '../../../src/components/TechnicianTypeSelector';
import { Button } from '../../../src/components/Button';
import { parseYearsExperience, validateSignupYearsExperience } from '../../../src/utils/yearsExperienceValidation';
import { colors, spacing } from '../../../src/theme';
import { LEGAL_CONSENT_VERSION } from '../../../src/constants/legal';

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function buildDate(y: string, m: string, d: string): string | null {
  const year = parseInt(y);
  const month = parseInt(m);
  const day = parseInt(d);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  if (year < 1930 || year > 2010) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function TechnicianSignupScreen() {
  // Escritorio: barra de desplazamiento visible (fase 8).
  const desktopScrollbar = useDesktopScrollbar();
  const router = useRouter();
  const goBack = useGoBack();
  const { options: techTypes, loading: typesLoading } = useTechnicianTypes();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [birthDay, setBirthDay] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthYear, setBirthYear] = useState('');
  // Fase 6 tanda A: varios tipos, mínimo uno. El mínimo lo hace cumplir
  // TechnicianTypeSelector para que alta y perfil no puedan discrepar;
  // validate() lo vuelve a comprobar porque el estado inicial es [] y ahí
  // todavía no ha intervenido el componente.
  const [technicianTypes, setTechnicianTypes] = useState<string[]>([]);
  const [yearsExperience, setYearsExperience] = useState('');
  const [location, setLocation] = useState<LocationValue>(EMPTY_LOCATION);

  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate(): string | null {
    if (!firstName.trim()) return 'First name is required.';
    if (!lastName.trim()) return 'Last name is required.';
    if (!isValidEmail(email)) return 'Enter a valid email address.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password !== confirmPassword) return 'Passwords do not match.';
    if (!birthYear || !birthMonth || !birthDay) return 'Date of birth is required.';
    if (!buildDate(birthYear, birthMonth, birthDay)) return 'Enter a valid date of birth.';
    if (technicianTypes.length === 0) return 'Select at least one profile type.';
    const yearsError = validateSignupYearsExperience(yearsExperience);
    if (yearsError) return yearsError;
    // Sólo el país es obligatorio. La ciudad es opcional a propósito: quien
    // no quiera precisar dónde vive no debería quedarse sin poder registrarse.
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

    const birthDate = buildDate(birthYear, birthMonth, birthDay)!;
    // Non-null: validate() above rejected anything parseYearsExperience
    // cannot read, including the empty string.
    const years = parseYearsExperience(yearsExperience)!;

    // Fase 7 F2c. Una sola conversión para los dos caminos de alta (RPC
    // inmediato y metadata para después de confirmar el email), así que no
    // pueden divergir. `persistedLocationFromValue` conserva la distinción de
    // F2a: la ciudad del directorio lleva coordenadas, la escrita a mano no.
    const persisted = persistedLocationFromValue(location);
    const signupLocationMetadata = {
      location_country_code: persisted.locationCountryCode,
      location_city_name: persisted.locationCityName ?? null,
      location_city_lat: persisted.locationCityLat ?? null,
      location_city_lng: persisted.locationCityLng ?? null,
      location_city_geoname_id: persisted.locationCityGeonameId ?? null,
    };
    const legalAcceptedAt = new Date().toISOString();

    // Step 1: Create auth user.
    // All form fields are stored in user_metadata so AuthContext can call
    // signup_technician() automatically after email confirmation if needed.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          role: 'technician',
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          birth_date: birthDate,
          // Ambas claves, a propósito. `technician_types` (plural) es la
          // real; `technician_type` (singular) se sigue escribiendo porque
          // la columna homónima es NOT NULL y porque el metadata de una
          // cuenta ya creada es inmutable desde aquí: si alguien confirma el
          // email con un bundle antiguo, ensureRoleProfile todavía encuentra
          // el campo que espera. Se retira con la columna.
          technician_type: technicianTypes[0],
          technician_types: technicianTypes,
          // Stored as a NUMBER, not the raw input string: ensureRoleProfile
          // forwards this straight to the RPC's integer parameter when the
          // profile is created after email confirmation.
          years_experience: years,
          // Fase 7 F2c: la metadata guarda país y ciudad, no un aeropuerto.
          // `ensureRoleProfile` sabe leer las dos formas — las cuentas
          // pendientes de confirmar de antes del despliegue siguen teniendo
          // la vieja.
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

    // Step 2: If email confirmation is disabled (dev), session exists immediately.
    // Call the RPC now. When confirmation is enabled, session is null here and
    // AuthContext.ensureRoleProfile() will call the RPC after confirmation.
    if (data.session) {
      const { error: rpcError } = await supabase.rpc('signup_technician', {
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_birth_date: birthDate,
        p_technician_type: technicianTypes[0],
        p_technician_types: technicianTypes,
        p_location_country_code: persisted.locationCountryCode,
        p_location_city_name: persisted.locationCityName ?? null,
        p_location_city_lat: persisted.locationCityLat ?? null,
        p_location_city_lng: persisted.locationCityLng ?? null,
        p_location_city_geoname_id: persisted.locationCityGeonameId ?? null,
        p_years_experience: years,
      });

      if (rpcError) {
        setError(
          'Account created but profile setup failed. Error: ' + rpcError.message
        );
        setLoading(false);
        return;
      }

      // Step 3: Record ToS consent. ignoreDuplicates: true — user_consents
      // has no UPDATE policy while the account is active (append-only audit
      // trail, migration 015); a
      // retried signup for the same user_id/version must skip the
      // conflicting row rather than take the default upsert's
      // ON CONFLICT DO UPDATE path, which RLS would reject.
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

    // Step 4: Redirect to pending verification
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
          showsVerticalScrollIndicator={desktopScrollbar}
        >
          <TouchableOpacity onPress={goBack} style={styles.back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.title}>Technician account</Text>
            <Text style={styles.subtitle}>
              All fields are required. Your profile will be reviewed before activation.
            </Text>
          </View>

          <View style={styles.form}>
            {/* Name */}
            <View style={styles.row}>
              <View style={styles.half}>
                <FormField label="First name">
                  <TextInput
                    style={styles.input}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="John"
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </FormField>
              </View>
              <View style={styles.half}>
                <FormField label="Last name">
                  <TextInput
                    style={styles.input}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Smith"
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </FormField>
              </View>
            </View>

            {/* Email */}
            <FormField label="Email">
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
            </FormField>

            {/* Password */}
            <FormField label="Password">
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="Min 8 characters"
                placeholderTextColor={colors.placeholder}
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
                placeholderTextColor={colors.placeholder}
                returnKeyType="next"
              />
            </FormField>

            {/* Date of birth */}
            <Text style={styles.sectionLabel}>Date of birth</Text>
            <View style={styles.dateRow}>
              <View style={styles.dateDay}>
                <FormField label="Day">
                  <TextInput
                    style={styles.input}
                    value={birthDay}
                    onChangeText={setBirthDay}
                    placeholder="DD"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="number-pad"
                    maxLength={2}
                    returnKeyType="next"
                  />
                </FormField>
              </View>
              <View style={styles.dateMonth}>
                <FormField label="Month">
                  <TextInput
                    style={styles.input}
                    value={birthMonth}
                    onChangeText={setBirthMonth}
                    placeholder="MM"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="number-pad"
                    maxLength={2}
                    returnKeyType="next"
                  />
                </FormField>
              </View>
              <View style={styles.dateYear}>
                <FormField label="Year">
                  <TextInput
                    style={styles.input}
                    value={birthYear}
                    onChangeText={setBirthYear}
                    placeholder="YYYY"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="number-pad"
                    maxLength={4}
                    returnKeyType="next"
                  />
                </FormField>
              </View>
            </View>

            {/* Tipos de perfil — varios, mínimo uno. Mismo componente y
                mismo comportamiento que en la pantalla de perfil. */}
            <FormField label="Profile types">
              <TechnicianTypeSelector
                options={techTypes}
                selected={technicianTypes}
                onChange={setTechnicianTypes}
                loading={typesLoading}
                palette={{
                  text: colors.text,
                  muted: colors.textMuted,
                  border: colors.border,
                  surface: 'transparent',
                  accent: colors.cyan,
                  accentText: colors.cyan,
                  accentSurface: colors.primarySoft,
                }}
              />
            </FormField>

            {/* Years of experience — required here, unlike the profile
                screen's optional-looking copy: this is the one moment the
                platform is guaranteed to ask. */}
            <FormField label="Total years of experience">
              <TextInput
                style={styles.input}
                value={yearsExperience}
                onChangeText={(v) => setYearsExperience(v.replace(/[^0-9]/g, ''))}
                placeholder="e.g. 8 — enter 0 if you have none yet"
                placeholderTextColor={colors.placeholder}
                keyboardType="number-pad"
                maxLength={2}
                returnKeyType="next"
              />
            </FormField>

            {/* Fase 7 F2c: país obligatorio, ciudad opcional. Sustituye al
                selector de aeropuerto — la localización dejó de depender de
                que existiera un aeropuerto en el catálogo. */}
            <CountryCityPicker value={location} onChange={setLocation} />
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
            label="Create account"
            onPress={handleSubmit}
            loading={loading}
            fullWidth
            size="lg"
            style={styles.btn}
          />

          <Text style={styles.footerNote}>
            Your profile will be verified before you can access the platform.
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
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  backText: { color: colors.primary, fontSize: 14, fontWeight: '500' },
  header: { marginBottom: spacing.lg },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  form: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: -8,
  },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  dateDay: { width: 72 },
  dateMonth: { width: 72 },
  dateYear: { flex: 1 },
  fieldWrap: { gap: 6 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
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
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkboxChecked: {
    borderColor: colors.cyan,
    backgroundColor: colors.primarySoft,
  },
  checkmark: { fontSize: 13, color: colors.cyan, fontWeight: '700', lineHeight: 16 },
  consentText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
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
