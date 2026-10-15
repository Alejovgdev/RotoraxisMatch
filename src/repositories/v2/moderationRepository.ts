import { supabase } from '../../lib/supabase';
import { throwIfError } from './supabaseMappers';
import type { ReportReason, ReportTargetType } from '../../utils/moderation';

// Denuncias y bloqueos (migración 100). Todo pasa por funciones de la base: los
// clientes no leen ni escriben content_reports ni contact_blocks.
export const moderationRepository = {
  /** Guarda la denuncia; si esta persona ya denunció lo mismo, devuelve aquella. */
  async reportContent(
    targetType: ReportTargetType,
    targetId: string,
    reason: ReportReason,
  ): Promise<{ reportId: string; alreadyReported: boolean }> {
    const { data, error } = await supabase.rpc('report_content', {
      p_target_type: targetType,
      p_target_id: targetId,
      p_reason: reason,
    });
    throwIfError(error);
    const row = (Array.isArray(data) ? data[0] : data) as { report_id?: string; already_reported?: boolean } | null;
    if (!row?.report_id) throw new Error('The report could not be saved.');
    return { reportId: row.report_id, alreadyReported: Boolean(row.already_reported) };
  },

  /** El técnico pasa (empresa, su id); la empresa, (su id, técnico). Repetir no falla. */
  async blockContact(companyId: string, technicianId: string): Promise<void> {
    const { error } = await supabase.rpc('block_contact', {
      p_company_id: companyId,
      p_technician_id: technicianId,
    });
    throwIfError(error);
  },

  /** Sólo responde true a las partes; a cualquier otro, false. */
  async isContactBlocked(companyId: string, technicianId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('contact_blocked', {
      p_company_id: companyId,
      p_technician_id: technicianId,
    });
    throwIfError(error);
    return data === true;
  },

  /** Aviso por correo a soporte (supabase/functions/notify-report). */
  async notifyReport(reportId: string): Promise<void> {
    const { error } = await supabase.functions.invoke('notify-report', { body: { report_id: reportId } });
    if (error) throw error;
  },
};
