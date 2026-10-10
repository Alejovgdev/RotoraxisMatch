import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGoBack } from '../../../../src/state/useGoBack';
import { Chip } from '../../../../src/components/ui';
import {
  FormNote,
  ProfileLoadGate,
  ProfileScreenFrame,
  SaveFooter,
} from '../../../../src/components/technician/ProfileParts';
import { useOwnTechnicianProfile } from '../../../../src/state/useOwnTechnicianProfile';
import { saveTechnicianProfile } from '../../../../src/usecases/technicianProfile';
import { CONTRACT_TYPES } from '../../../../src/constants/contractTypes';
import type { ContractTypeCode } from '../../../../src/types/catalog';
import type { EditableTechnicianProfile } from '../../../../src/types/technicianProfileEdit';

// Contract types (rediseño, fase 6A): los tipos de contrato que el técnico
// acepta, los chips "Contract types" del formulario de antes. Ninguno es una
// respuesta válida, como hoy. "Save" cambia sólo los contratos: la
// disponibilidad, que vive en la misma columna, se relee y se conserva.
export default function ContractTypesScreen() {
  const goBack = useGoBack();
  const state = useOwnTechnicianProfile();
  return (
    <ProfileLoadGate state={state} title="Contract types" onBack={goBack}>
      {(profile) => <ContractTypesForm profile={profile} onBack={goBack} />}
    </ProfileLoadGate>
  );
}

function ContractTypesForm({ profile, onBack }: { profile: EditableTechnicianProfile; onBack: () => void }) {
  const [selected, setSelected] = useState<ContractTypeCode[]>(profile.availability.contractTypes);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(code: ContractTypeCode) {
    setSelected((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]));
    setDirty(true);
    setError(null);
  }

  // Cambiar de apartado en escritorio descartándolos: vuelve a lo guardado.
  function discard() {
    setSelected(profile.availability.contractTypes);
    setDirty(false);
    setError(null);
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveTechnicianProfile(profile.id, { contractTypes: selected });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onBack();
  }

  return (
    <ProfileScreenFrame
      title="Contract types"
      unsaved={dirty}
      onDiscard={discard}
      subtitle="The contracts you would take. Pick as many as apply."
      onBack={onBack}
      footer={<SaveFooter onSave={save} saving={saving} disabled={!dirty} error={error} />}
    >
      <View style={styles.chips}>
        {CONTRACT_TYPES.map((ct) => (
          <Chip
            key={ct.code}
            label={ct.label}
            selected={selected.includes(ct.code)}
            onPress={() => toggle(ct.code)}
          />
        ))}
      </View>
      {/* Ninguno marcado = abierto a cualquiera: así lo puntúa el matching. */}
      <FormNote>Leave them all unticked if any contract works for you.</FormNote>
    </ProfileScreenFrame>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
