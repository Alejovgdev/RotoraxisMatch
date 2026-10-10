import React, { useState } from 'react';
import { useGoBack } from '../../../../src/state/useGoBack';
import { TextInput } from '../../../../src/components/ui';
import {
  FormField,
  FormNote,
  ProfileLoadGate,
  ProfileScreenFrame,
  ReadOnlyValue,
  SaveFooter,
  profileFormStyles,
} from '../../../../src/components/technician/ProfileParts';
import { useOwnTechnicianProfile } from '../../../../src/state/useOwnTechnicianProfile';
import { useTechnicianNav } from '../../../../src/state/TechnicianNavContext';
import { saveTechnicianProfile } from '../../../../src/usecases/technicianProfile';
import { colors } from '../../../../src/theme';
import type { EditableTechnicianProfile } from '../../../../src/types/technicianProfileEdit';

// Personal details (rediseño, fase 6A): nombre, email (sólo lectura),
// teléfono y años de experiencia, los campos de "Identity" del formulario de
// antes. "Save" guarda estos campos y ningún otro, con las validaciones de hoy
// (los años son obligatorios; 0 vale). La foto no se cambia aquí: se cambia
// tocando el avatar de la tarjeta de You (fase 8).
export default function PersonalDetailsScreen() {
  const goBack = useGoBack();
  const state = useOwnTechnicianProfile();
  return (
    <ProfileLoadGate state={state} title="Personal details" onBack={goBack}>
      {(profile) => <PersonalDetailsForm profile={profile} onBack={goBack} />}
    </ProfileLoadGate>
  );
}

function PersonalDetailsForm({ profile, onBack }: { profile: EditableTechnicianProfile; onBack: () => void }) {
  const { reloadTechnician } = useTechnicianNav();
  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone);
  // Texto: '' = no declarado, distinto de '0'.
  const [yearsInput, setYearsInput] = useState(profile.yearsInput);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cambiar de apartado en escritorio descartándolos: vuelve a lo guardado.
  function discard() {
    setFullName(profile.fullName);
    setPhone(profile.phone);
    setYearsInput(profile.yearsInput);
    setDirty(false);
    setError(null);
  }

  function edit(apply: () => void) {
    apply();
    setDirty(true);
    setError(null);
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveTechnicianProfile(profile.id, { personal: { fullName, phone, yearsInput } });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // El nombre del avatar de las barras sale del perfil de la navegación.
    reloadTechnician();
    onBack();
  }

  return (
    <ProfileScreenFrame
      title="Personal details"
      unsaved={dirty}
      onDiscard={discard}
      subtitle="Private details remain controlled by privacy rules."
      onBack={onBack}
      footer={<SaveFooter onSave={save} saving={saving} disabled={!dirty} error={error} />}
    >
      <FormField label="Full name">
        <TextInput
          style={profileFormStyles.input}
          value={fullName}
          onChangeText={(v) => edit(() => setFullName(v))}
          placeholder="Full name"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="words"
          accessibilityLabel="Full name"
        />
      </FormField>

      <FormField label="Email" hint="This email cannot be changed from your profile.">
        <ReadOnlyValue value={profile.email} />
      </FormField>

      <FormField label="Phone">
        <TextInput
          style={profileFormStyles.input}
          value={phone}
          onChangeText={(v) => edit(() => setPhone(v))}
          placeholder="+1 555 000 0000"
          placeholderTextColor={colors.placeholder}
          keyboardType="phone-pad"
          accessibilityLabel="Phone"
        />
      </FormField>

      <FormField
        label="Total years of experience"
        hint="Required. Companies filter by minimum years of experience, so a profile with nothing here is hard to place. Entering 0 is a valid answer."
      >
        <TextInput
          style={profileFormStyles.input}
          value={yearsInput}
          onChangeText={(v) => edit(() => setYearsInput(v.replace(/[^0-9]/g, '')))}
          placeholder="e.g. 8 — enter 0 if you have none yet"
          placeholderTextColor={colors.placeholder}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Total years of experience"
        />
      </FormField>

      <FormNote>Your identity is private by default and is only shared with accepted company contacts.</FormNote>
    </ProfileScreenFrame>
  );
}
