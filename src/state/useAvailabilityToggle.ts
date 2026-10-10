// La disponibilidad de You (Open to offers / Unavailable): se guarda al tocarla
// (respuesta 25). Si falla, vuelve a lo que había y lo dice.
//
// La comparten You en móvil y la cabecera de You en escritorio (fase 8), para
// que las dos guarden exactamente igual. Guarda sólo la disponibilidad, por el
// caso de uso (que relee la columna JSON antes de escribir).
import { useEffect, useState } from 'react';
import { saveTechnicianProfile } from '../usecases/technicianProfile';
import type { AvailabilityStatus } from '../types/technician';
import type { EditableTechnicianProfile } from '../types/technicianProfileEdit';

export function useAvailabilityToggle(
  profile: EditableTechnicianProfile,
  reload: () => Promise<unknown>,
): {
  availability: AvailabilityStatus;
  change: (next: AvailabilityStatus) => Promise<void>;
  saving: boolean;
  error: string | null;
} {
  const [availability, setAvailability] = useState<AvailabilityStatus>(profile.availability.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lo guardado manda: al recargar el perfil, la caja enseña lo de la base.
  useEffect(() => {
    setAvailability(profile.availability.status);
  }, [profile.availability.status]);

  async function change(next: AvailabilityStatus) {
    if (saving) return;
    const previous = availability;
    setAvailability(next);
    setError(null);
    setSaving(true);
    const result = await saveTechnicianProfile(profile.id, { availability: next });
    setSaving(false);
    if (!result.ok) {
      setAvailability(previous);
      setError(result.error);
      return;
    }
    void reload();
  }

  return { availability, change, saving, error };
}
