import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { CompanyCard, CompanyChip, companyUi } from './CompanyUI';
import { AuthorityCode, AuthorityLicenseCode, LicenseCode } from '../../types/catalog';
import { AUTHORITIES, authorityLabel } from '../../constants/licenses';
import {
  OfferRequirementsForm,
  acceptableAuthorities,
  acceptableLicenseCodes,
  acceptedAuthoritiesNote,
  selectableAuthorities,
  selectableLicenses,
  showsAcceptedAuthorities,
} from '../../utils/offerFormRules';

interface Props {
  // El formulario entero y no campo a campo: qué autoridades y licencias hay
  // depende de oficio, producto y autoridad a la vez, y eso lo decide
  // offerFormRules (lo mismo que acepta offerRepository).
  form: OfferRequirementsForm;
  onChangeAuthority: (next: AuthorityCode) => void;
  onChangeLicense: (next: AuthorityLicenseCode) => void;
  // Sesión 2: marca o desmarca una autoridad aceptada (toggleAcceptedAuthority).
  onToggleAcceptedAuthority: (authority: AuthorityCode) => void;
  // 096: elige la categoría Part-66 que acepta una oferta FAA (selectAcceptedLicenseCode).
  onSelectAcceptedLicenseCode: (code: LicenseCode) => void;
  authorityError?: string;
  licenseError?: string;
  // 096: autoridades aceptadas sin categoría, o al revés.
  acceptedError?: string;
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
  onToggleAcceptedAuthority,
  onSelectAcceptedLicenseCode,
  authorityError,
  licenseError,
  acceptedError,
}: Props) {
  const authorities = selectableAuthorities(form, AUTHORITIES.map((a) => a.code));
  const licenses = selectableLicenses(form);
  const authority = form.licenseAuthority;

  return (
    <CompanyCard style={styles.card}>
      <Text style={styles.title}>Licence</Text>
      <Text style={styles.subtitle}>
        {form.offerKind === 'engine'
          ? 'Optional, one per offer, and only a licence that certifies engine work: a Part-66 B1 or an FAA P or A&P.'
          : 'One per offer. Every aircraft you add below is required under this licence — two licences would be two different jobs.'}
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
          {/* Punto 2 de los ajustes: una oferta de motor no lleva aeronaves
              (dos triggers de la 076 lo impiden), asi que esta nota solo aplica
              a las ofertas de aeronave con autoridad FAA. */}
          {authority === 'FAA' && form.offerKind !== 'engine' ? (
            <Text style={styles.note}>
              FAA certificates carry no aircraft type ratings. Any aircraft you add below count if the technician holds
              a type rating on them, from any authority, or has declared experience on them, signed off or not: they
              raise the score, and nobody is excluded for lacking them.
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.inlineHint}>Pick the authority first — the licences it issues appear here.</Text>
      )}

      {/* Sesión 2: sustituye a la casilla "Considerar otras autoridades". Las
          otras Part-66 que emiten esta categoría y, desde la parte 3, la FAA
          si la categoría tiene equivalente FAA (no la C). 096: en una oferta
          FAA, las Part-66 que emiten la categoría elegida, y debajo la
          categoría, una sola. */}
      {showsAcceptedAuthorities(form) && authority && form.licenseCode ? (
        <>
          <Text style={styles.fieldLabel}>Also accept licences from:</Text>
          <View style={styles.chipRow}>
            {acceptableAuthorities(form).map((code) => (
              <CompanyChip
                key={code}
                label={authorityLabel(code)}
                selected={form.acceptedAuthorities.includes(code)}
                onPress={() => onToggleAcceptedAuthority(code)}
              />
            ))}
          </View>
          {authority === 'FAA' ? (
            <>
              <Text style={styles.fieldLabel}>Licence category:</Text>
              <View style={styles.chipRow}>
                {acceptableLicenseCodes(form).map((code) => (
                  <CompanyChip
                    key={code}
                    label={code}
                    selected={form.acceptedLicenseCode === code}
                    onPress={() => onSelectAcceptedLicenseCode(code)}
                  />
                ))}
              </View>
            </>
          ) : null}
          {acceptedError ? <Text style={styles.error}>{acceptedError}</Text> : null}
          <Text style={styles.note}>
            {[acceptedAuthoritiesNote(form), 'This is a search preference, not legal recognition.'].filter(Boolean).join(' ')}
          </Text>
        </>
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
