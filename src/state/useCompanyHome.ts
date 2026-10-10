// Datos de la Home de empresa (rediseño, fase 2; maquetas W-Home y W-D-Home).
//
// Sólo datos que la app ya tenía antes del rediseño:
//   - ofertas publicadas de la empresa;
//   - candidaturas: las pendientes (lo que "Your next hiring action" mandaba
//     revisar) y, por oferta, cuántas hay pendientes y cuántas en total;
//   - miembros del equipo (nombre del que mira y número de miembros);
//   - en escritorio, las conversaciones del Inbox (src/state/companyInbox.ts).
//
// "New" significa pendiente (respuesta 16 de la revisión). Una candidatura
// retirada no cuenta como candidato de la oferta.
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { offerRepository } from '../repositories/v2/offerRepository';
import { offerApplicationRepository } from '../repositories/v2/offerApplicationRepository';
import { companyRepositoryV2 } from '../repositories/v2/companyRepositoryV2';
import { technicianRepositoryV2 } from '../repositories/v2/technicianRepositoryV2';
import { loadCompanyInbox, type CompanyInboxEntry } from './companyInbox';
import { summarizeCompanyHome, type CompanyHomeOffer, type CompanyHomePending } from '../utils/companyHome';
import type { CompanyMember } from '../types/company';

export interface CompanyHomeData {
  offers: CompanyHomeOffer[];
  pending: CompanyHomePending;
  members: CompanyMember[];
  inbox: CompanyInboxEntry[];
}

const EMPTY: CompanyHomeData = {
  offers: [],
  pending: { count: 0, latest: null },
  members: [],
  inbox: [],
};

export function useCompanyHome(companyId: string | undefined, withInbox: boolean) {
  const [data, setData] = useState<CompanyHomeData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inboxLoading, setInboxLoading] = useState(withInbox);
  const [inboxError, setInboxError] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [offers, applications, members] = await Promise.all([
        offerRepository.getForCompany(companyId),
        offerApplicationRepository.getForCompany(companyId),
        companyRepositoryV2.getMembers(companyId),
      ]);
      const summary = summarizeCompanyHome(offers, applications);
      if (summary.pending.latest) {
        summary.pending.latest.technician = await technicianRepositoryV2.getViewForCompany(
          summary.pending.latest.application.technicianId, companyId,
        );
      }
      setData((prev) => ({ ...prev, ...summary, members }));
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your offers.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // El Inbox va aparte: es la consulta más cara (una por conversación) y un
  // fallo suyo no debe tumbar la lista de ofertas.
  const loadInbox = useCallback(async () => {
    if (!companyId || !withInbox) return;
    setInboxError(false);
    try {
      const inbox = await loadCompanyInbox(companyId);
      setData((prev) => ({ ...prev, inbox }));
    } catch {
      setInboxError(true);
    } finally {
      setInboxLoading(false);
    }
  }, [companyId, withInbox]);

  useFocusEffect(
    useCallback(() => {
      load();
      loadInbox();
    }, [load, loadInbox]),
  );

  return { data, loading, error, inboxLoading, inboxError, reload: load, reloadInbox: loadInbox };
}
