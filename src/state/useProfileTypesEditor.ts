// "What you do": tocar un tipo de perfil lo guarda al momento (respuesta 25),
// en My work y en el "+" (fases 6A y 6B). Es la misma acción en las dos
// pantallas, así que vive aquí una sola vez:
//
//   - la regla de siempre (toggleProfileType): el tipo que bloquea una licencia
//     y el último no se quitan, y se explica por qué;
//   - quitar Engine Technician teniendo motores avisa antes (changeProfileTypes);
//   - el chip tocado enseña que se está guardando, sólo después de confirmar.
import { useCallback, useState } from 'react';
import { notify } from '../utils/platformAlert';
import { toggleProfileType } from '../utils/profileTypes';
import { changeProfileTypes, type ConfirmFn } from '../usecases/technicianProfile';

export function useProfileTypesEditor({
  technicianId,
  types,
  lockedTypes,
  licenseCodes,
  engineCount,
  labelOf,
  confirm,
  onSaved,
}: {
  technicianId: string;
  /** Los tipos que se ven ahora. */
  types: string[];
  /** Los que bloquean las licencias. */
  lockedTypes: string[];
  /** Las licencias GUARDADAS: replaceProfileTypes exige los tipos que bloquean. */
  licenseCodes: readonly string[];
  /** Los motores que se perderían (guardados o no). */
  engineCount: number;
  labelOf: (code: string) => string;
  confirm: ConfirmFn;
  /** Guardado: los tipos nuevos y si la base se ha llevado los motores. */
  onSaved: (next: string[], enginesRemoved: boolean) => void;
}): { savingCode: string | null; error: string | null; toggle: (code: string) => Promise<void> } {
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async (code: string) => {
    if (savingCode) return;
    const result = toggleProfileType(types, code, lockedTypes, labelOf);
    if (result.kind === 'notice') {
      notify(result.title, result.message);
      return;
    }
    setError(null);
    const change = await changeProfileTypes(
      technicianId,
      { current: types, next: result.next, licenseCodes, engineCount },
      confirm,
      { onSaving: () => setSavingCode(code) },
    );
    setSavingCode(null);
    if (change.status === 'cancelled') return;
    if (change.status === 'error') {
      setError(change.error);
      return;
    }
    onSaved(result.next, change.enginesRemoved);
  }, [savingCode, types, lockedTypes, labelOf, technicianId, licenseCodes, engineCount, confirm, onSaved]);

  return { savingCode, error, toggle };
}
