import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Text, TextInput, Toggle } from '../ui';
import { colors } from '../../theme';
import { SALARY_CURRENCIES, SALARY_PERIODS } from '../../types/offerSalary';
import { formatOfferSalary, salaryFromForm, salaryFormError, SalaryFormValue } from '../../utils/offerSalary';
import { WIZARD_OPTION_BORDER, WizardChipRow, WizardError, WizardNote, wizardInputStyles } from './OfferWizardParts';

// Rediseño, fase 4 (maqueta W-Post4, respuesta 14): el interruptor muestra u
// oculta los campos. Apagado, `enabled` es false y salaryFromForm devuelve
// null: no se guarda salario, igual que antes cuando no se añadía.
export function OfferSalarySection({ value, onChange, error }: {
  value: SalaryFormValue;
  onChange: (value: SalaryFormValue) => void;
  error?: string;
}) {
  const preview = value.enabled && !salaryFormError(value) ? formatOfferSalary(salaryFromForm(value)) : null;
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.title}>
            Remuneration <Text style={styles.optional}>(optional)</Text>
          </Text>
          <Text style={styles.helper}>All amounts are gross, before taxes. You can publish without adding remuneration.</Text>
        </View>
        <Toggle
          accessibilityLabel="Add gross remuneration"
          value={value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
        />
      </View>
      {value.enabled && (
        <>
          <View style={wizardInputStyles.field}>
            <Text style={styles.label}>Gross amount</Text>
            <TextInput
              accessibilityLabel="Gross amount"
              accessibilityHint="Use a dot or comma for decimals, without thousands separators"
              style={[wizardInputStyles.input, error && wizardInputStyles.inputError]}
              value={value.amount}
              onChangeText={(amount) => onChange({ ...value, amount })}
              keyboardType="decimal-pad"
              placeholder="e.g. 3500 or 35.50"
              placeholderTextColor={colors.placeholder}
              maxLength={24}
            />
            <WizardNote>Use a dot or comma for decimals, without thousands separators.</WizardNote>
          </View>
          <View style={wizardInputStyles.field}>
            <Text style={styles.label}>Currency</Text>
            <WizardChipRow>
              {SALARY_CURRENCIES.map((currency) => (
                <Chip key={currency} label={currency} selected={currency === value.currency}
                  onPress={() => onChange({ ...value, currency })} />
              ))}
              <Chip label="Other" selected={value.currency === 'other'}
                onPress={() => onChange({ ...value, currency: 'other' })} />
            </WizardChipRow>
            {value.currency === 'other' && (
              <View style={wizardInputStyles.field}>
                <Text style={styles.label}>Currency code</Text>
                <TextInput
                  accessibilityLabel="Currency code"
                  accessibilityHint="Enter a three-letter code, for example JPY or MXN"
                  style={wizardInputStyles.input}
                  value={value.customCurrency}
                  onChangeText={(customCurrency) => onChange({ ...value, customCurrency })}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="e.g. JPY or MXN"
                  placeholderTextColor={colors.placeholder}
                  maxLength={12}
                />
                <WizardNote>Enter the three-letter currency code. It can differ from the offer country's currency.</WizardNote>
              </View>
            )}
          </View>
          <View style={wizardInputStyles.field}>
            <Text style={styles.label}>Amount per</Text>
            <WizardChipRow>
              {SALARY_PERIODS.map((period) => (
                <Chip key={period.code} label={period.label} selected={period.code === value.period}
                  onPress={() => onChange({ ...value, period: period.code })} />
              ))}
            </WizardChipRow>
          </View>
          {preview ? <Text style={styles.preview}>{preview}</Text> : null}
          <WizardError>{error}</WizardError>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: WIZARD_OPTION_BORDER,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  optional: { fontSize: 14.5, fontWeight: '600', color: colors.textMuted },
  helper: { fontSize: 12.5, lineHeight: 17, color: colors.textSecondary },
  label: { fontSize: 12.5, fontWeight: '800', color: colors.textSecondary },
  preview: { fontSize: 14, fontWeight: '800', color: colors.success },
});
