import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { CompanyCard, CompanyCheckRow, companyUi } from './CompanyUI';
import { EnginePicker } from '../EnginePicker';

// Las secciones que la Fase 10 (paso 5b) añade al formulario de oferta,
// compartidas por crear y editar. Las reglas de cuándo se enseñan y qué limpia
// cada cambio NO viven aquí: están en src/utils/offerFormRules.ts.
//
// Sesión 4 (091): aquí vivía OfferKindSection, el selector "Aircraft & licence"
// / "Engine". Se retira: la clase sale del tipo de técnico, que se elige en
// "Profile type".

export function OfferEngineSection({
  value,
  onChange,
  error,
}: {
  value?: string;
  onChange: (engineId: string) => void;
  error?: string;
}) {
  return (
    <CompanyCard style={styles.card}>
      <Text style={styles.title}>Engine</Text>
      <Text style={styles.subtitle}>
        One engine per offer. Engine points reflect the exact engine declared, evidence from a B1 type rating,
        the same family or another engine. The overall ranking also includes the other matching criteria.
        Technicians who are not Engine Technicians only appear through a B1 type rating on this engine or its
        family, and rank low.
      </Text>
      <EnginePicker value={value} onSelect={(engine) => onChange(engine.id)} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </CompanyCard>
  );
}

export function OnlyUnlicensedSection({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <CompanyCard style={styles.card}>
      <CompanyCheckRow
        label="Only technicians without a licence"
        helper="Technicians who declare any licence — valid or expired — will not see this offer and will not appear in its candidate list."
        checked={checked}
        onChange={onChange}
      />
    </CompanyCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: companyUi.text },
  subtitle: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: companyUi.textSoft },
  error: { fontSize: 11, lineHeight: 16, fontWeight: '600', color: companyUi.red },
});
