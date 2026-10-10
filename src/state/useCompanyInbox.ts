// Las conversaciones del Inbox de empresa (rediseño, fase 3), cargadas al
// enfocar la pantalla como antes. Lo comparten la pestaña Inbox y, en
// escritorio, la pantalla de un chat, que pinta la lista al lado.
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadCompanyInbox, type CompanyInboxEntry } from './companyInbox';

export function useCompanyInbox(companyId: string | undefined) {
  const [entries, setEntries] = useState<CompanyInboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio; la pantalla cae en su estado vacio en vez de colgarse.
    if (!companyId) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setError(false);
    try {
      const next = await loadCompanyInbox(companyId);
      if (id === requestId.current) setEntries(next);
    } catch {
      if (id === requestId.current) setError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  return { entries, loading, error, reload: load };
}
