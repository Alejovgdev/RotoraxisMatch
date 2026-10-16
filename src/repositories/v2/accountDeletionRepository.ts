import { supabase } from '../../lib/supabase';
import { CompanyDeletionImpact } from '../../types/accountDeletion';
import { throwIfError } from './supabaseMappers';

export const accountDeletionRepository = {
  /**
   * Qué se llevaría por delante borrar la cuenta del usuario en sesión, o null
   * si no es miembro de ninguna empresa. La función de la base sólo responde
   * por el propio usuario.
   */
  async getCompanyDeletionImpact(): Promise<CompanyDeletionImpact | null> {
    const { data, error } = await supabase.rpc('company_account_deletion_impact');
    throwIfError(error);
    const row = ((data ?? []) as any[])[0];
    if (!row) return null;
    return {
      companyId: row.company_id,
      companyName: row.company_name,
      memberRole: row.member_role,
      otherMembers: row.other_members,
      otherAdmins: row.other_admins,
      pendingInvitations: row.pending_invitations,
      offers: row.offers,
      applications: row.applications,
      directOffers: row.direct_offers,
      chats: row.chats,
      deletesCompany: row.deletes_company === true,
      mustAssignAdmin: row.must_assign_admin === true,
    };
  },
};
