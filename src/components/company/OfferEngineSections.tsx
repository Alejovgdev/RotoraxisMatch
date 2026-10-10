import React from 'react';
import { StyleSheet, View } from 'react-native';
import { EnginePicker } from '../EnginePicker';
import { TextInput } from '../ui';
import { colors } from '../../theme';
import { WizardCheckCard, WizardError, WizardHeading, WizardLabel, wizardInputStyles } from './OfferWizardParts';

// Las secciones que la Fase 10 (paso 5b) añade al formulario de oferta,
// compartidas por crear y editar. Las reglas de cuándo se enseñan y qué limpia
// cada cambio NO viven aquí: están en src/utils/offerFormRules.ts.
//
// Sesión 4 (091): aquí vivía OfferKindSection, el selector "Aircraft & licence"
// / "Engine". Se retira: la clase sale del tipo de técnico, que se elige en
// "Profile type".
//
// Rediseño, fase 4: el motor es el paso 3 del asistente en una oferta de motor
// (maqueta W-Post3), y "sólo sin licencia" la casilla de W-Post2.

export function OfferEngineSection({
  value,
  onChange,
  notes,
  onChangeNotes,
  error,
  large = false,
  fillAvailableSpace = false,
}: {
  value?: string;
  onChange: (engineId: string) => void;
  notes?: string;
  onChangeNotes: (notes: string) => void;
  error?: string;
  large?: boolean;
  fillAvailableSpace?: boolean;
}) {
  return (
    <View style={[styles.wrap, fillAvailableSpace && styles.fill]}>
      <WizardHeading title="Engine" helper="One engine per offer." large={large} />
      <EnginePicker value={value} onSelect={(engine) => onChange(engine.id)} fillAvailableSpace={fillAvailableSpace} />
      <WizardError>{error}</WizardError>
      <View style={wizardInputStyles.field}>
        <WizardLabel>Note (optional)</WizardLabel>
        <TextInput
          accessibilityLabel="Engine note (optional)"
          style={wizardInputStyles.input}
          placeholder="e.g. Recent overhaul experience on this engine preferred"
          placeholderTextColor={colors.placeholder}
          value={notes ?? ''}
          onChangeText={onChangeNotes}
        />
      </View>
    </View>
  );
}

export function OnlyUnlicensedSection({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <WizardCheckCard
      label="Only technicians without a licence"
      helper="Technicians who declare any licence — valid or expired — will not see this offer and will not appear in its candidate list."
      checked={checked}
      onChange={onChange}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  fill: { flexGrow: 1 },
});
