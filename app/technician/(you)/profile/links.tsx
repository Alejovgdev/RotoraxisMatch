import React, { useState } from 'react';
import { useGoBack } from '../../../../src/state/useGoBack';
import { TextInput } from '../../../../src/components/ui';
import {
  FormField,
  FormNote,
  ProfileLoadGate,
  ProfileScreenFrame,
  SaveFooter,
  profileFormStyles,
} from '../../../../src/components/technician/ProfileParts';
import { useOwnTechnicianProfile } from '../../../../src/state/useOwnTechnicianProfile';
import { SOCIAL_FIELDS, saveTechnicianProfile } from '../../../../src/usecases/technicianProfile';
import { colors } from '../../../../src/theme';
import type { EditableTechnicianProfile } from '../../../../src/types/technicianProfileEdit';

// Professional links (rediseño, fase 6A): LinkedIn, Instagram y web personal,
// la sección del mismo nombre del formulario de antes. Opcionales; un enlace
// mal escrito no se guarda (la validación de hoy). Se teclean en crudo y se
// normalizan una sola vez, al guardar. "Save" escribe sólo los enlaces y
// conserva las claves que la pantalla no enseña.
export default function ProfessionalLinksScreen() {
  const goBack = useGoBack();
  const state = useOwnTechnicianProfile();
  return (
    <ProfileLoadGate state={state} title="Professional links" onBack={goBack}>
      {(profile) => <ProfessionalLinksForm profile={profile} onBack={goBack} />}
    </ProfileLoadGate>
  );
}

function ProfessionalLinksForm({ profile, onBack }: { profile: EditableTechnicianProfile; onBack: () => void }) {
  const [inputs, setInputs] = useState<Record<string, string>>(profile.socialInputs);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cambiar de apartado en escritorio descartándolos: vuelve a lo guardado.
  function discard() {
    setInputs(profile.socialInputs);
    setDirty(false);
    setError(null);
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveTechnicianProfile(profile.id, { socialLinks: inputs });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onBack();
  }

  return (
    <ProfileScreenFrame
      title="Professional links"
      unsaved={dirty}
      onDiscard={discard}
      subtitle="Optional. Private until a company accepts."
      onBack={onBack}
      footer={<SaveFooter onSave={save} saving={saving} disabled={!dirty} error={error} />}
    >
      {/* El aviso va ARRIBA, antes del primer campo: el técnico tiene que saber
          quién verá esto ANTES de escribirlo. */}
      <FormNote>
        These links stay private. A company can only see them after it accepts your application, or after you accept a
        direct offer from it.
      </FormNote>
      {SOCIAL_FIELDS.map((field) => (
        <FormField key={field.key} label={field.label} optional>
          <TextInput
            style={profileFormStyles.input}
            value={inputs[field.key] ?? ''}
            onChangeText={(v) => {
              setInputs((prev) => ({ ...prev, [field.key]: v }));
              setDirty(true);
              setError(null);
            }}
            placeholder={field.placeholder}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel={field.label}
          />
        </FormField>
      ))}
    </ProfileScreenFrame>
  );
}
