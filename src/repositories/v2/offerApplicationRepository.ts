import { supabase } from '../../lib/supabase';
import { OfferApplication } from '../../types/offerRequest';
import { OfferRequestStatus } from '../../types/enums';
import { evaluateApplicationConflict, isActiveOfferRelationStatus } from '../../utils/offerRelationStateMachine';
import { isOfferOpenForTechnicians, offerRepository } from './offerRepository';
import { mapOfferApplicationRow, mapOfferRequestRow, throwIfError } from './supabaseMappers';
import { IneligibilityReason, ineligibilityReasonText } from '../../utils/offerMatchExplain';

const SELECT_FIELDS = 'id, technician_id, offer_id, company_id, status, identity_revealed, documents_unlocked, cover_note, created_at, updated_at';

const INELIGIBILITY_REASONS: readonly IneligibilityReason[] = ['no_engine_experience', 'licensed_technician'];

/**
 * Fase 10, paso 5c: la base rechaza una candidatura de un técnico no elegible
 * (trigger enforce_offer_application_eligibility, migración 080) con
 * ERRCODE PT403 y el MOTIVO en `details`, con los mismos códigos que
 * IneligibilityReason. Aquí se traduce al texto de siempre
 * (ineligibilityReasonText) en vez de enseñar el mensaje técnico de Postgres:
 * el copy vive en un solo sitio, en TS.
 *
 * Se mira el motivo y no sólo el código porque es lo que dice QUÉ texto poner;
 * un PT403 con un motivo desconocido cae al error genérico de throwIfError.
 *
 * Sesión 5 (092): la base también lo rechaza al ACEPTAR una candidatura cuyo
 * técnico ya no es elegible (la oferta cambió después). `prefix` dice a quién
 * se le habla: el texto del motivo describe la oferta, no la situación.
 */
export function throwIfIneligible(
  error: { code?: string; details?: string | null } | null | undefined,
  prefix?: string,
): void {
  if (!error) return;
  const reason = error.details as IneligibilityReason;
  if (INELIGIBILITY_REASONS.includes(reason)) {
    const text = ineligibilityReasonText(reason);
    throw new Error(prefix ? `${prefix} ${text}` : text);
  }
}

/** Lo que ve la empresa si la base rechaza aceptar (092). */
export const NO_LONGER_ELIGIBLE_TO_ACCEPT =
  'This technician no longer meets the requirements of this offer, so the application cannot be accepted. You can still reject it.';

export const offerApplicationRepository = {
  async getAll(): Promise<OfferApplication[]> {
    const { data, error } = await supabase
      .from('offer_applications')
      .select(SELECT_FIELDS)
      .order('updated_at', { ascending: false });
    throwIfError(error);
    return ((data ?? []) as any[]).map(mapOfferApplicationRow);
  },

  async getById(id: string): Promise<OfferApplication | null> {
    const { data, error } = await supabase
      .from('offer_applications')
      .select(SELECT_FIELDS)
      .eq('id', id)
      .maybeSingle();
    throwIfError(error);
    return data ? mapOfferApplicationRow(data as any) : null;
  },

  async getForTechnician(technicianId: string): Promise<OfferApplication[]> {
    const { data, error } = await supabase
      .from('offer_applications')
      .select(SELECT_FIELDS)
      .eq('technician_id', technicianId)
      .order('updated_at', { ascending: false });
    throwIfError(error);
    return ((data ?? []) as any[]).map(mapOfferApplicationRow);
  },

  async getForOffer(offerId: string): Promise<OfferApplication[]> {
    const { data, error } = await supabase
      .from('offer_applications')
      .select(SELECT_FIELDS)
      .eq('offer_id', offerId)
      .order('updated_at', { ascending: false });
    throwIfError(error);
    return ((data ?? []) as any[]).map(mapOfferApplicationRow);
  },

  async getForCompany(companyId: string): Promise<OfferApplication[]> {
    const { data, error } = await supabase
      .from('offer_applications')
      .select(SELECT_FIELDS)
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false });
    throwIfError(error);
    return ((data ?? []) as any[]).map(mapOfferApplicationRow);
  },

  async create(data: {
    technicianId: string;
    offerId: string;
    companyId: string;
    coverNote?: string;
  }): Promise<OfferApplication> {
    const offer = await offerRepository.getById(data.offerId);
    if (!isOfferOpenForTechnicians(offer) || offer?.companyId !== data.companyId) {
      throw new Error('This offer is no longer available.');
    }

    const [{ data: existingRequests, error: reqError }, { data: existingApps, error: appError }] = await Promise.all([
      supabase
        .from('offer_requests')
        .select('id, company_id, technician_id, offer_id, status, identity_revealed, documents_unlocked, message, created_at, updated_at')
        .eq('company_id', data.companyId)
        .eq('technician_id', data.technicianId)
        .eq('offer_id', data.offerId),
      // At most one row can ever exist here — UNIQUE(technician_id, offer_id),
      // migration 001 — but not checking it here meant a second attempt (or a
      // reapply after withdrawal/rejection, which the state machine never
      // allows — see evaluateApplicationConflict) fell straight through to a
      // raw Postgres unique-violation error instead of a friendly message.
      supabase
        .from('offer_applications')
        .select(SELECT_FIELDS)
        .eq('technician_id', data.technicianId)
        .eq('offer_id', data.offerId),
    ]);
    throwIfError(reqError);
    throwIfError(appError);
    const activeRequest = ((existingRequests ?? []) as any[])
      .map(mapOfferRequestRow)
      .find((request) => isActiveOfferRelationStatus(request.status));
    const existingApplication = ((existingApps ?? []) as any[]).map(mapOfferApplicationRow)[0] ?? null;
    const conflict = evaluateApplicationConflict(activeRequest, existingApplication);
    if (conflict) throw new Error(conflict);

    // Re-aplicar tras una retirada REACTIVA la fila existente en vez de
    // insertar otra: UNIQUE(technician_id, offer_id) no lo permitiria, y
    // ademas conserva el historial (created_at original, updated_at = fecha
    // de la re-aplicacion). El cover_note SI se reemplaza — el tecnico
    // escribe uno nuevo al volver a aplicar.
    //
    // identity_revealed/documents_unlocked los resetea el trigger de BD
    // (handle_offer_relation_status_transition pone ambos a false en toda
    // transicion que no sea a 'accepted'), asi que no se tocan aqui.
    if (existingApplication?.status === 'withdrawn') {
      const { data: reactivated, error: reactivateError } = await supabase
        .from('offer_applications')
        .update({ status: 'pending', cover_note: data.coverNote ?? null })
        .eq('id', existingApplication.id)
        .select(SELECT_FIELDS)
        .single();
      // Re-aplicar también pasa por la elegibilidad: el trigger de la 080 mira
      // la transición a pending, no sólo el INSERT.
      throwIfIneligible(reactivateError);
      throwIfError(reactivateError);
      return mapOfferApplicationRow(reactivated as any);
    }

    const { data: inserted, error } = await supabase
      .from('offer_applications')
      .insert({
        technician_id: data.technicianId,
        offer_id: data.offerId,
        company_id: data.companyId,
        cover_note: data.coverNote ?? null,
      })
      .select(SELECT_FIELDS)
      .single();
    // La elegibilidad la impone la base (migración 080), no esta función: la
    // pantalla ya quita el botón, pero una llamada que se la salte llega aquí
    // con el rechazo del trigger.
    throwIfIneligible(error);
    throwIfError(error);
    return mapOfferApplicationRow(inserted as any);
  },

  async updateStatus(id: string, status: OfferRequestStatus): Promise<OfferApplication | null> {
    const { data, error } = await supabase
      .from('offer_applications')
      .update({ status })
      .eq('id', id)
      .select(SELECT_FIELDS)
      .maybeSingle();
    // 092: aceptar vuelve a comprobar la elegibilidad en la base.
    if (status === 'accepted') throwIfIneligible(error, NO_LONGER_ELIGIBLE_TO_ACCEPT);
    throwIfError(error);
    return data ? mapOfferApplicationRow(data as any) : null;
  },

  async withdraw(id: string, technicianId: string): Promise<OfferApplication | null> {
    const app = await this.getById(id);
    if (!app || app.technicianId !== technicianId) return null;
    if (app.status !== 'pending') throw new Error('Only pending applications can be withdrawn.');
    return this.updateStatus(id, 'withdrawn');
  },
};
