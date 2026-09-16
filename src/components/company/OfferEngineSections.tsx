import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { CompanyCard, CompanyCheckRow, CompanyChip, companyUi } from './CompanyUI';
import { EnginePicker } from '../EnginePicker';
import { OfferKind } from '../../types/offer';

// Las tres secciones que la Fase 10 (paso 5b) añade al formulario de oferta,
// compartidas por crear y editar. Las reglas de cuándo se enseñan y qué limpia
// cada cambio NO viven aquí: están en src/utils/offerFormRules.ts.

export function OfferKindSection({ value, onChange }: { value: OfferKind; onChange: (next: OfferKind) => void }) {
  return (
    <CompanyCard style={styles.card}>
      <Text style={styles.title}>What does this offer ask for?</Text>
      <Text style={styles.subtitle}>
        {value === 'engine'
          ? 'An engine — nothing else. No licence and no aircraft type ratings: technicians are matched on the engines they have worked on.'
          : 'A licence and/or aircraft type ratings, the usual way.'}
      </Text>
      <View style={styles.chipRow}>
        <CompanyChip label="Aircraft & licence" selected={value === 'aircraft'} onPress={() => onChange('aircraft')} />
        <CompanyChip label="Engine" selected={value === 'engine'} onPress={() => onChange('engine')} />
      </View>
    </CompanyCard>
  );
}

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
        One engine per offer. Technicians rank by how close their experience is: the exact engine declared, the
        same engine from a B1 type rating, the same family, then any other engine.
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
