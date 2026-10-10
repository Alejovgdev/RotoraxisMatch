import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Chip, Text } from '../ui';
import { colors } from '../../theme';
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
import { WizardChipRow, WizardError, WizardLabel, WizardNote } from './OfferWizardParts';

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
//
// Rediseño, fase 4: va en el paso 2 del asistente (maqueta W-Post2), debajo de
// la pregunta de la licencia. Mismos campos y mismas reglas; cambia el aspecto.
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
    <View style={styles.wrap}>
      <WizardNote>
        {form.offerKind === 'engine'
          ? 'Optional, one per offer, and only a licence that certifies engine work: a Part-66 B1 or an FAA P or A&P.'
          : 'One per offer. Every aircraft you add in the next step is required under this licence — two licences would be two different jobs.'}
      </WizardNote>

      <View style={styles.section}>
        <WizardLabel caps>Issuing authority</WizardLabel>
        <WizardChipRow>
          {authorities.map((code) => (
            <Chip key={code} label={authorityLabel(code)} selected={authority === code} onPress={() => onChangeAuthority(code)} />
          ))}
        </WizardChipRow>
        <WizardError>{authorityError}</WizardError>
      </View>

      {authority ? (
        <View style={styles.section}>
          <WizardLabel caps>{`${authorityLabel(authority)} licence this role certifies under`}</WizardLabel>
          <WizardChipRow>
            {licenses.map((code) => (
              <Chip key={code} variant="option" label={code} selected={form.licenseCode === code} onPress={() => onChangeLicense(code)} />
            ))}
          </WizardChipRow>
          {licenseError ? (
            <WizardError>{licenseError}</WizardError>
          ) : !form.licenseCode ? (
            <WizardNote tone="hint">Pick the licence this role certifies under.</WizardNote>
          ) : null}
          {/* Punto 2 de los ajustes: una oferta de motor no lleva aeronaves
              (dos triggers de la 076 lo impiden), así que esta nota sólo aplica
              a las ofertas de aeronave con autoridad FAA. */}
          {authority === 'FAA' && form.offerKind !== 'engine' ? (
            <WizardNote>
              FAA certificates carry no aircraft type ratings. Any aircraft you add in the next step count if the
              technician holds a type rating on them, from any authority, or has declared experience on them, signed off
              or not: they raise the score, and nobody is excluded for lacking them.
            </WizardNote>
          ) : null}
        </View>
      ) : (
        <WizardNote tone="hint">Pick the authority first — the licences it issues appear here.</WizardNote>
      )}

      {/* Sesión 2: sustituye a la casilla "Considerar otras autoridades". Las
          otras Part-66 que emiten esta categoría y, desde la parte 3, la FAA
          si la categoría tiene equivalente FAA (no la C). 096: en una oferta
          FAA, las Part-66 que emiten la categoría elegida, y debajo la
          categoría, una sola. */}
      {showsAcceptedAuthorities(form) && authority && form.licenseCode ? (
        <View style={styles.section}>
          <WizardLabel caps>Also accept licences from</WizardLabel>
          <WizardChipRow>
            {acceptableAuthorities(form).map((code) => {
              const on = form.acceptedAuthorities.includes(code);
              return (
                <Chip
                  key={code}
                  label={on ? `✓ ${authorityLabel(code)}` : authorityLabel(code)}
                  selected={on}
                  onPress={() => onToggleAcceptedAuthority(code)}
                />
              );
            })}
          </WizardChipRow>
          {authority === 'FAA' ? (
            <View style={styles.categoryBox}>
              <Text style={styles.categoryTitle}>Licence category for the Part-66 authorities</Text>
              <WizardChipRow>
                {acceptableLicenseCodes(form).map((code) => (
                  <Chip
                    key={code}
                    variant="option"
                    label={code}
                    selected={form.acceptedLicenseCode === code}
                    onPress={() => onSelectAcceptedLicenseCode(code)}
                  />
                ))}
              </WizardChipRow>
            </View>
          ) : null}
          <WizardError>{acceptedError}</WizardError>
          <WizardNote>
            {[acceptedAuthoritiesNote(form), 'This is a search preference, not legal recognition.'].filter(Boolean).join(' ')}
          </WizardNote>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  section: { gap: 8 },
  categoryBox: {
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
  },
  categoryTitle: { fontSize: 13.5, fontWeight: '800', color: colors.text },
});
