import React, { useState } from 'react';
import { useGoBack } from '../../../../src/state/useGoBack';
import { CountryCityPicker } from '../../../../src/components/CountryCityPicker';
import {
  ProfileLoadGate,
  ProfileScreenFrame,
  SaveFooter,
} from '../../../../src/components/technician/ProfileParts';
import { useOwnTechnicianProfile } from '../../../../src/state/useOwnTechnicianProfile';
import { useCountryCatalog } from '../../../../src/state/useCountryCatalog';
import { saveTechnicianProfile } from '../../../../src/usecases/technicianProfile';
import { withCountryName } from '../../../../src/utils/technicianWork';
import type { LocationValue } from '../../../../src/types/location';
import type { EditableTechnicianProfile } from '../../../../src/types/technicianProfileEdit';

// Location (rediseño, fase 6A): país y ciudad, la sección "Location" del
// formulario de antes. El país es lo que puntúa; la ciudad sitúa el pin y sólo
// trae coordenadas si sale del directorio. "Save" escribe las cinco columnas
// de localización juntas y nada más.
export default function LocationScreen() {
  const goBack = useGoBack();
  const state = useOwnTechnicianProfile();
  return (
    <ProfileLoadGate state={state} title="Location" onBack={goBack}>
      {(profile) => <LocationForm profile={profile} onBack={goBack} />}
    </ProfileLoadGate>
  );
}

function LocationForm({ profile, onBack }: { profile: EditableTechnicianProfile; onBack: () => void }) {
  const { countries } = useCountryCatalog();
  const [location, setLocation] = useState<LocationValue>(profile.location);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cambiar de apartado en escritorio descartándolos: vuelve a lo guardado.
  function discard() {
    setLocation(profile.location);
    setDirty(false);
    setError(null);
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveTechnicianProfile(profile.id, { location });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onBack();
  }

  return (
    <ProfileScreenFrame
      title="Location"
      unsaved={dirty}
      onDiscard={discard}
      subtitle="Where you are based. The country counts for matching."
      onBack={onBack}
      footer={<SaveFooter onSave={save} saving={saving} disabled={!dirty} error={error} />}
    >
      <CountryCityPicker
        value={withCountryName(location, countries)}
        onChange={(value) => {
          setLocation(value);
          setDirty(true);
          setError(null);
        }}
      />
    </ProfileScreenFrame>
  );
}
