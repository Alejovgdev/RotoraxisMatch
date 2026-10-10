// Las conversaciones del Inbox del técnico (rediseño, fase 5B), cargadas al
// enfocar la pantalla como antes. Lo comparten la pestaña Inbox y, en
// escritorio, la pantalla de un chat, que pinta la lista al lado. Mismo patrón
// que src/state/useCompanyInbox.ts.
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadTechnicianInbox, type TechnicianInboxEntry } from './technicianInbox';

export function useTechnicianInbox(technicianId: string | undefined) {
  const [entries, setEntries] = useState<TechnicianInboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio; la pantalla cae en su estado vacio en vez de colgarse.
    if (!technicianId) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setError(false);
    try {
      const next = await loadTechnicianInbox(technicianId);
      if (id === requestId.current) setEntries(next);
    } catch {
      if (id === requestId.current) setError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [technicianId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  return { entries, loading, error, reload: load };
}
