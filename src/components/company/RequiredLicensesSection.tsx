import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { CompanyCard, CompanyCheckRow, CompanyChip, companyUi } from './CompanyUI';
import { AuthorityCode, AuthorityLicenseCode } from '../../types/catalog';
import { AUTHORITIES, authorityLabel, credentialLabel } from '../../constants/licenses';
import {
  OfferRequirementsForm,
  selectableAuthorities,
  selectableLicenses,
  showsAcceptsEquivalent,
} from '../../utils/offerFormRules';

interface Props {
  // El formulario entero y no campo a campo: qué autoridades y licencias hay
  // depende de oficio, producto y autoridad a la vez, y eso lo decide
  // offerFormRules (lo mismo que acepta offerRepository).
  form: OfferRequirementsForm;
  onChangeAuthority: (next: AuthorityCode) => void;
  onChangeLicense: (next: AuthorityLicenseCode) => void;
  onChangeAcceptsEquivalent: (next: boolean) => void;
  authorityError?: string;
  licenseError?: string;
}

// Fase 6 tanda D — UNA licencia por oferta.
//
// Fase 10, paso 5b — y su AUTORIDAD. Primero la autoridad, luego la licencia:
// con cinco autoridades "B1.1" no identifica nada, y qué códigos existen
// depende de quién los emite (CASA sin B2L/B3/L, GCAA sin B2L, FAA sólo A, P y
// A&P). Nada viene elegido de fábrica: el EASA por defecto que rellenaba el
// repositorio se retiró con este selector.
export function RequiredLicensesSection({
  form,
  onChangeAuthority,
  onChangeLicense,
  onChangeAcceptsEquivalent,
  authorityError,
  licenseError,
}: Props) {
  const authorities = selectableAuthorities(form, AUTHORITIES.map((a) => a.code));
  const licenses = selectableLicenses(form);
  const authority = form.licenseAuthority;

  return (
    <CompanyCard style={styles.card}>
      <Text style={styles.title}>Licence</Text>
      <Text style={styles.subtitle}>
        One per offer. Every aircraft you add below is required under this licence — two licences would be two
        different jobs.
      </Text>

      <Text style={styles.fieldLabel}>Issuing authority</Text>
      <View style={styles.chipRow}>
        {authorities.map((code) => (
          <CompanyChip key={code} label={authorityLabel(code)} selected={authority === code} onPress={() => onChangeAuthority(code)} />
        ))}
      </View>
      {authorityError ? <Text style={styles.error}>{authorityError}</Text> : null}

      {authority ? (
        <>
          <Text style={styles.fieldLabel}>{authorityLabel(authority)} licence</Text>
          <View style={styles.chipRow}>
            {licenses.map((code) => (
              <CompanyChip key={code} label={code} selected={form.licenseCode === code} onPress={() => onChangeLicense(code)} />
            ))}
          </View>
          {licenseError ? (
            <Text style={styles.error}>{licenseError}</Text>
          ) : !form.licenseCode ? (
            <Text style={styles.inlineHint}>Pick the licence this role certifies under.</Text>
          ) : null}
          {authority === 'FAA' ? (
            <Text style={styles.note}>FAA certificates carry no aircraft type ratings, so an FAA offer cannot require aircraft.</Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.inlineHint}>Pick the authority first — the licences it issues appear here.</Text>
      )}

      {showsAcceptsEquivalent(form) ? (
        <CompanyCheckRow
          label={`Also accept the same licence from another Part-66 authority`}
          helper={
            form.licenseCode
              ? `A ${form.licenseCode} from UK CAA, CASA or UAE GCAA counts, ranked just below an exact ${credentialLabel(authority, form.licenseCode)}. FAA never counts as equivalent.`
              : 'The same category from UK CAA, CASA or UAE GCAA counts, ranked just below an exact match. FAA never counts as equivalent.'
          }
          checked={form.acceptsEquivalent}
          onChange={onChangeAcceptsEquivalent}
        />
      ) : null}
    </CompanyCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: companyUi.text },
  subtitle: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: companyUi.textSoft },
  fieldLabel: { marginTop: spacing.xs, fontSize: 12, lineHeight: 16, fontWeight: '700', color: companyUi.textSoft },
  inlineHint: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    fontStyle: 'italic',
    color: companyUi.amber,
  },
  note: { fontSize: 11, lineHeight: 15, fontWeight: '500', color: companyUi.textMuted },
  error: { fontSize: 11, lineHeight: 16, fontWeight: '600', color: companyUi.red },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
