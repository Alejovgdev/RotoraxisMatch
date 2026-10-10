import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { colors } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { ProfileImageEditor } from '../../../src/components/ui/ProfileImageEditor';
import { Chip, Text, TextInput } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import {
  ButtonRow,
  CARD_BORDER,
  ErrorBlock,
  PageBar,
  PageBody,
  PillButton,
  StickyBar,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { AccountLayout, CompanyAccountNav } from '../../../src/components/company/CompanyAccount';
import { useCompanySession } from '../../../src/state/SessionContext';
import { useCompanyNav } from '../../../src/state/CompanyNavContext';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { canManageCompanySettings } from '../../../src/utils/companyPermissionsV2';
import { COMPANY_TYPES } from '../../../src/constants/companyTypes';
import { CountryCityPicker } from '../../../src/components/CountryCityPicker';
import { LocationValue } from '../../../src/types/location';
import { locationValueFromPersisted } from '../../../src/utils/locationBridge';
import type { CompanyProfileView } from '../../../src/types/company';
import type { CompanyTypeCode } from '../../../src/types/catalog';
import { notify } from '../../../src/utils/platformAlert';
import { isValidUrl, normalizeUrl } from '../../../src/utils/urlValidation';

// Datos de la empresa (rediseño, fase 3; maquetas C-EditCompany y
// W-D-EditCompany; respuesta 21). Sólo admin. Es el formulario que antes se
// abría dentro de /company/profile con "Edit", movido a su pantalla: mismos
// campos, mismas validaciones y la misma escritura (companyRepositoryV2.update).
// Phase 7: logo changes save independently, with the same admin gate.

type CompanyForm = {
  name: string;
  companyType: CompanyTypeCode;
  // Fase 7 F2c: pais + ciudad en un solo campo.
  location: LocationValue;
  email: string;
  phone: string;
  website: string;
};

function profileToForm(profile: CompanyProfileView): CompanyForm {
  return {
    name: profile.name,
    companyType: profile.companyType,
    location: locationValueFromPersisted(profile, profile.country),
    email: profile.email,
    phone: profile.phone ?? '',
    website: profile.website ?? '',
  };
}

export default function EditCompanyScreen() {
  const goBack = useGoBack();
  const wide = useIsWide();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;
  const canEditCompany = canManageCompanySettings(companyMemberRole);
  const { reloadCompany, isAdmin } = useCompanyNav();

  const [companyProfile, setCompanyProfile] = useState<CompanyProfileView | null>(null);
  const [form, setForm] = useState<CompanyForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Guard de CARGA, mudo a proposito (ver nota en map.tsx).
    if (!companyId || !canEditCompany) return;
    let active = true;
    companyRepositoryV2.getById(companyId)
      .then((profile) => {
        if (!active) return;
        setCompanyProfile(profile);
        if (profile) setForm(profileToForm(profile));
      })
      .catch(() => { if (active) setCompanyProfile(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
    };
  }, [companyId, canEditCompany]);

  function updateForm(patch: Partial<CompanyForm>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  async function handleSaveCompany() {
    if (!form) return;

    const name = form.name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
    const website = form.website.trim();

    if (!name || !form.location.country || !email) {
      notify('Missing information', 'Company name, country and email are required.');
      return;
    }

    // Se valida en cliente para dar un mensaje legible; el CHECK
    // chk_companies_website_format de la migracion 036 es la red de abajo.
    if (!isValidUrl(website)) {
      notify('Invalid website', 'Enter a valid web address, e.g. your-company.com.');
      return;
    }

    if (!companyId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    setSaving(true);
    try {
      const updated = await companyRepositoryV2.update(companyId, {
        name,
        companyType: form.companyType,
        locationCountryCode: form.location.country?.code,
        locationCityName: form.location.city?.name,
        locationCityLat: form.location.city?.kind === 'directory' ? form.location.city.latitude : undefined,
        locationCityLng: form.location.city?.kind === 'directory' ? form.location.city.longitude : undefined,
        locationCityGeonameId: form.location.city?.kind === 'directory' ? form.location.city.geonameId : undefined,
        email,
        phone: phone || undefined,
        // Normalizada al guardar (le antepone https:// si falta), igual que
        // los enlaces del tecnico. Vacio -> '' -> NULL en el repositorio.
        website: normalizeUrl(website),
      });
      if (updated) {
        setCompanyProfile(updated);
        setForm(profileToForm(updated));
      }
      // El nombre del avatar de las barras de navegación sale de aquí.
      reloadCompany();
      goBack();
    } catch (e: any) {
      notify('Error', e?.message ?? 'Could not update company information.');
    } finally {
      setSaving(false);
    }
  }

  // Sólo un admin edita los datos de la empresa (documento, sección 3,
  // "Company roles"). Por enlace directo, los demás vuelven a You.
  if (!canEditCompany) return <Redirect href="/company/profile" />;

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="company" />
      </>
    );
  }

  const body = !form || !companyProfile ? (
    <ErrorBlock text="Could not load your company profile." />
  ) : (
    <View style={[styles.form, wide && styles.formWide]}>
      <Field label="Company name" wide={wide}>
        <TextInput
          style={styles.input}
          value={form.name}
          onChangeText={(name) => updateForm({ name })}
          placeholderTextColor={colors.placeholder}
          autoCorrect={false}
          accessibilityLabel="Company name"
        />
      </Field>

      <Field label="Company type" wide={wide}>
        <View style={styles.typeChips}>
          {COMPANY_TYPES.map((type) => (
            <Chip
              key={type.code}
              label={type.label}
              selected={form.companyType === type.code}
              onPress={() => updateForm({ companyType: type.code })}
            />
          ))}
        </View>
      </Field>

      {/* Fase 7 F2c: un solo componente para país + ciudad. Cambiar de país
          limpia la ciudad por dentro, así que ya no hay que acordarse aquí. */}
      <View style={[styles.full]}>
        <CountryCityPicker value={form.location} onChange={(location) => updateForm({ location })} />
      </View>

      <Field label="Contact email" wide={wide} hint="This email cannot be changed from the company profile.">
        <View style={styles.readOnly}>
          <Text style={styles.readOnlyText} numberOfLines={1}>{form.email}</Text>
        </View>
      </Field>

      <Field label="Phone" optional wide={wide}>
        <TextInput
          style={styles.input}
          value={form.phone}
          onChangeText={(phone) => updateForm({ phone })}
          keyboardType="phone-pad"
          placeholderTextColor={colors.placeholder}
          autoCorrect={false}
          accessibilityLabel="Phone"
        />
      </Field>

      {/* A diferencia de los enlaces del tecnico, este NO lleva gate: la
          empresa no es anonima. Se le dice aqui para que sea una decision
          informada y no una sorpresa. */}
      <Field
        label="Website"
        full
        wide={wide}
        hint="Optional. Shown to technicians on your offers — it is public, not gated by acceptance."
      >
        <TextInput
          style={styles.input}
          value={form.website}
          onChangeText={(website) => updateForm({ website })}
          keyboardType="url"
          autoCapitalize="none"
          placeholderTextColor={colors.placeholder}
          autoCorrect={false}
          accessibilityLabel="Website"
        />
      </Field>
    </View>
  );

  const logoEditor = companyProfile && companyId ? <ProfileImageEditor kind="company" id={companyId}
    name={form?.name || companyProfile.name} path={companyProfile.logoPath} size={wide ? 52 : 64} disabled={saving}
    onChanged={(logoPath) => { setCompanyProfile(value => value ? { ...value, logoPath } : value); reloadCompany(); }} /> : null;
  const save = <PillButton label="Save" onPress={handleSaveCompany} loading={saving} disabled={!form} size={wide ? 'md' : 'lg'} grow={wide ? undefined : 1} />;

  if (wide) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <PageBody wide>
          <AccountLayout nav={<CompanyAccountNav active="profile" isAdmin={isAdmin} />}>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle} accessibilityRole="header">Company details</Text>
                {logoEditor}
              </View>
              {body}
              <View style={styles.cardFooter}>
                <PillButton label="Cancel" variant="outline" size="md" onPress={goBack} disabled={saving} />
                {save}
              </View>
            </View>
          </AccountLayout>
        </PageBody>
      </CompanyScreen>
    );
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageBar title="Company details" large onBack={goBack} />
      <PageBody wide={false}>
        {logoEditor}
        {body}
      </PageBody>
      <StickyBar><ButtonRow>{save}</ButtonRow></StickyBar>
    </CompanyScreen>
  );
}

function Field({
  label,
  optional = false,
  hint,
  full = false,
  wide,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  /** En escritorio ocupa las dos columnas. */
  full?: boolean;
  wide: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.field, wide && !full && styles.fieldHalf, (full || !wide) && styles.full]}>
      <Text style={styles.label}>
        {label}
        {optional ? <Text style={styles.optional}>  Optional</Text> : null}
      </Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 16,
  },
  formWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 20,
    rowGap: 16,
  },
  full: {
    width: '100%',
  },
  field: {
    gap: 6,
  },
  fieldHalf: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 0,
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  optional: {
    fontWeight: '600',
    color: colors.textMuted,
  },
  hint: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.textMuted,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 15,
    color: colors.text,
  },
  readOnly: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
    justifyContent: 'center',
  },
  readOnlyText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  typeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    padding: 26,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    gap: 18,
  },
  cardHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
});
