import { supabase } from '../../lib/supabase';
import { OfferRequest } from '../../types/offerRequest';
import { OfferRequestStatus } from '../../types/enums';
import { evaluateDirectOfferConflict } from '../../utils/offerRelationStateMachine';
import { isOfferOpenForTechnicians, offerRepository } from './offerRepository';
import { technicianRepositoryV2 } from './technicianRepositoryV2';
import { mapOfferApplicationRow, mapOfferRequestRow, throwIfError } from './supabaseMappers';

const SELECT_FIELDS = 'id, company_id, technician_id, offer_id, status, identity_revealed, documents_unlocked, message, created_at, updated_at';

export const offerRequestRepository = {
  async getAll(): Promise<OfferRequest[]> {
    const { data, error } = await supabase
      .from('offer_requests')
      .select(SELECT_FIELDS)
      .order('updated_at', { ascending: false });
    throwIfError(error);
    return ((data ?? []) as any[]).map(mapOfferRequestRow);
  },

  async getById(id: string): Promise<OfferRequest | null> {
    const { data, error } = await supabase
      .from('offer_requests')
      .select(SELECT_FIELDS)
      .eq('id', id)
      .maybeSingle();
    throwIfError(error);
    return data ? mapOfferRequestRow(data as any) : null;
  },

  async getForTechnician(technicianId: string): Promise<OfferRequest[]> {
    const { data, error } = await supabase
      .from('offer_requests')
      .select(SELECT_FIELDS)
      .eq('technician_id', technicianId)
      .order('updated_at', { ascending: false });
    throwIfError(error);
    return ((data ?? []) as any[]).map(mapOfferRequestRow);
  },

  /**
   * Ofertas directas pendientes del técnico (las que esperan su respuesta),
   * sólo el número: las mismas filas que la lista cuenta como "pending", con la
   * consulta `head` que hacía la Home vieja. La usan el círculo Direct offers
   * de la Home y su sección de escritorio (fase 5B).
   */
  async countPendingForTechnician(technicianId: string): Promise<number> {
    const { count, error } = await supabase
      .from('offer_requests')
      .select('id', { count: 'exact', head: true })
      .eq('technician_id', technicianId)
      .eq('status', 'pending');
    throwIfError(error);
    return count ?? 0;
  },

  async getForCompany(companyId: string): Promise<OfferRequest[]> {
    const { data, error } = await supabase
      .from('offer_requests')
      .select(SELECT_FIELDS)
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false });
    throwIfError(error);
    return ((data ?? []) as any[]).map(mapOfferRequestRow);
  },

  async create(data: {
    companyId: string;
    technicianId: string;
    offerId?: string;
    message?: string;
  }): Promise<OfferRequest> {
    // Guard against contacting a technician whose account no longer
    // exists (deleted) or isn't active (blocked/suspended/pending
    // verification) — getById() falls back to technician_public_view,
    // which migration 024 excludes non-active profiles from, so this is
    // the same check search/matching already apply, reused here rather
    // than a second, independent one. Existing historical offer_requests
    // rows are never touched by this — only new ones are blocked.
    const technician = await technicianRepositoryV2.getById(data.technicianId);
    if (!technician) {
      throw new Error('This technician profile is no longer available.');
    }

    if (data.offerId) {
      const offer = await offerRepository.getById(data.offerId);
      if (!isOfferOpenForTechnicians(offer) || offer?.companyId !== data.companyId) {
        throw new Error('Closed or unpublished offers cannot be sent as direct offers.');
      }
    }

    const { data: existingRequests, error: reqError } = await supabase
      .from('offer_requests')
      .select(SELECT_FIELDS)
      .eq('company_id', data.companyId)
      .eq('technician_id', data.technicianId);
    throwIfError(reqError);

    let existingApplications: any[] = [];
    if (data.offerId) {
      const { data: apps, error: appError } = await supabase
        .from('offer_applications')
        .select('id, technician_id, offer_id, company_id, status, identity_revealed, documents_unlocked, cover_note, created_at, updated_at')
        .eq('company_id', data.companyId)
        .eq('technician_id', data.technicianId)
        .eq('offer_id', data.offerId);
      throwIfError(appError);
      existingApplications = apps ?? [];
    }

    const conflict = evaluateDirectOfferConflict(
      ((existingRequests ?? []) as any[]).map(mapOfferRequestRow),
      existingApplications.map(mapOfferApplicationRow),
      data.offerId,
    );
    if (conflict) throw new Error(conflict);

    const { data: inserted, error } = await supabase
      .from('offer_requests')
      .insert({
        company_id: data.companyId,
        technician_id: data.technicianId,
        offer_id: data.offerId ?? null,
        message: data.message ?? null,
      })
      .select(SELECT_FIELDS)
      .single();
    throwIfError(error);
    return mapOfferRequestRow(inserted as any);
  },

  async updateStatus(id: string, status: OfferRequestStatus): Promise<OfferRequest | null> {
    const { data, error } = await supabase
      .from('offer_requests')
      .update({ status })
      .eq('id', id)
      .select(SELECT_FIELDS)
      .maybeSingle();
    throwIfError(error);
    return data ? mapOfferRequestRow(data as any) : null;
  },

  async withdraw(id: string, technicianId: string): Promise<OfferRequest | null> {
    const req = await this.getById(id);
    if (!req || req.technicianId !== technicianId) return null;
    if (req.status !== 'pending') throw new Error('Only pending requests can be withdrawn.');
    return this.updateStatus(id, 'withdrawn');
  },
};
