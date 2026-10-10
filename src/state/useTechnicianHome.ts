// Datos de la Home del técnico (rediseño, fase 5A; maqueta T-Home).
//
// Sólo datos que la Home vieja ya cargaba:
//   - las ofertas puntuadas para el técnico (getOfferMatchesForTechnician), que
//     alimentan "Best match for you" y "Offers for you";
//   - sus candidaturas y ofertas directas, para no recomendar una oferta con la
//     que ya hay relación (la regla de "Your next opportunity");
//   - las empresas, para el nombre y el avatar de cada oferta (lo que ya hacía
//     la lista de ofertas);
//   - en escritorio, cuántos documentos tiene y sus conversaciones.
//
// La Home vieja leía Supabase directamente desde la pantalla; aquí todo pasa
// por los repositorios. Se recarga al volver a la pantalla, en silencio: el
// indicador de carga sólo sale la primera vez.
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getOfferMatchesForTechnician, type OfferMatchResult } from '../utils/matchingV2';
import { inboxRepository } from '../repositories/v2/inboxRepository';
import { companyRepositoryV2 } from '../repositories/v2/companyRepositoryV2';
import { documentRepositoryV2 } from '../repositories/v2/documentRepositoryV2';
import { loadTechnicianInbox, type TechnicianInboxEntry } from './technicianInbox';
import type { CompanyProfileView } from '../types/company';

export interface TechnicianHomeData {
  matches: OfferMatchResult[];
  relatedOfferIds: ReadonlySet<string>;
  companies: Record<string, CompanyProfileView>;
  documentCount: number | null;
  inbox: TechnicianInboxEntry[];
}

const EMPTY: TechnicianHomeData = {
  matches: [],
  relatedOfferIds: new Set(),
  companies: {},
  documentCount: null,
  inbox: [],
};

export function useTechnicianHome(technicianId: string | undefined, wide: boolean) {
  const [data, setData] = useState<TechnicianHomeData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(wide);
  const [inboxError, setInboxError] = useState(false);
  const loadId = useRef(0);
  const inboxId = useRef(0);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    if (!technicianId) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    try {
      const [matches, relations, companies] = await Promise.all([
        getOfferMatchesForTechnician(technicianId),
        inboxRepository.getTechnicianInbox(technicianId),
        companyRepositoryV2.getAll(),
      ]);
      if (id !== loadId.current) return;
      const companyMap: Record<string, CompanyProfileView> = {};
      companies.forEach((c) => { companyMap[c.id] = c; });
      setData((prev) => ({
        ...prev,
        matches,
        relatedOfferIds: new Set(
          relations.map((r) => r.offerId).filter((offerId): offerId is string => Boolean(offerId)),
        ),
        companies: companyMap,
      }));
      setFailed(false);
    } catch {
      if (id !== loadId.current) return;
      setFailed(true);
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [technicianId]);

  // Escritorio: documentos y conversaciones, aparte. Son lo más caro (una
  // consulta por conversación) y un fallo suyo no debe tumbar las ofertas.
  const loadAside = useCallback(async () => {
    if (!technicianId || !wide) return;
    const id = ++inboxId.current;
    setInboxError(false);
    documentRepositoryV2.getForTechnician(technicianId)
      .then((docs) => { if (id === inboxId.current) setData((prev) => ({ ...prev, documentCount: docs.length })); })
      .catch(() => {});
    try {
      const inbox = await loadTechnicianInbox(technicianId);
      if (id !== inboxId.current) return;
      setData((prev) => ({ ...prev, inbox }));
    } catch {
      if (id === inboxId.current) setInboxError(true);
    } finally {
      if (id === inboxId.current) setInboxLoading(false);
    }
  }, [technicianId, wide]);

  useFocusEffect(
    useCallback(() => {
      load();
      loadAside();
      // Al salir de la pantalla, lo que aún esté en vuelo ya no escribe.
      return () => {
        loadId.current += 1;
        inboxId.current += 1;
      };
    }, [load, loadAside]),
  );

  return { data, loading, failed, inboxLoading, inboxError, reload: load, reloadAside: loadAside };
}
