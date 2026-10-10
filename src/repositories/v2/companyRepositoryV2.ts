import { supabase } from '../../lib/supabase';
import { locationColumns } from '../../utils/locationBridge';
import { PersistedLocation } from '../../types/location';
import { CompanyProfile, CompanyMember, CompanyProfileView } from '../../types/company';
import { CompanyMemberRole } from '../../types/enums';
import { mapCompanyMemberRow, mapCompanyRow, throwIfError } from './supabaseMappers';

export interface CompanyWithMembers extends CompanyProfileView {
  members: CompanyMember[];
}

type CompanyProfilePatch = Partial<Omit<CompanyProfile, 'id' | 'createdAt'>> & {
  country?: string;
  city?: string;
  baseAirport?: string;
  latitude?: number;
  longitude?: number;
};

function companyPatchToDb(patch: CompanyProfilePatch): Record<string, unknown> {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone ?? null } : {}),
    ...(patch.email !== undefined ? { email: patch.email } : {}),
    ...(patch.companyType !== undefined ? { company_type: patch.companyType } : {}),
    // '' -> NULL: la ausencia de web se representa de una sola forma, y el
    // CHECK de la migracion 036 rechaza la cadena vacia de todos modos.
    ...(patch.website !== undefined ? { website: patch.website || null } : {}),
    // Fase 7 F2c: escritura directa, las cinco columnas juntas. Igual que en
    // técnicos, y por el mismo motivo.
    ...(patch.locationCountryCode !== undefined ? locationColumns(patch as PersistedLocation) : {}),
  };
}

export const companyRepositoryV2 = {
  async getAll(): Promise<CompanyProfileView[]> {
    const { data, error } = await supabase
      .from('companies')
      .select(`
        id, name, phone, email, company_type, website, logo_path,
        location_country_code, location_city_name,
        location_city_lat, location_city_lng, location_city_geoname_id,
        verification_status, created_at, updated_at,
        location_countries ( name )
      `)
      .order('created_at', { ascending: false });
    throwIfError(error);
    return ((data ?? []) as any[]).map(mapCompanyRow);
  },

  async getById(id: string): Promise<CompanyProfileView | null> {
    const { data, error } = await supabase
      .from('companies')
      .select(`
        id, name, phone, email, company_type, website, logo_path,
        location_country_code, location_city_name,
        location_city_lat, location_city_lng, location_city_geoname_id,
        verification_status, created_at, updated_at,
        location_countries ( name )
      `)
      .eq('id', id)
      .maybeSingle();
    throwIfError(error);
    return data ? mapCompanyRow(data as any) : null;
  },

  async getMembers(companyId: string): Promise<CompanyMember[]> {
    const { data, error } = await supabase
      .from('company_members')
      .select('id, company_id, user_id, role, display_name, created_at, profiles(email)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });
    throwIfError(error);
    return ((data ?? []) as any[]).map(mapCompanyMemberRow);
  },

  async getMemberByUserId(companyId: string, userId: string): Promise<CompanyMember | null> {
    const { data, error } = await supabase
      .from('company_members')
      .select('id, company_id, user_id, role, display_name, created_at, profiles(email)')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapCompanyMemberRow(data as any) : null;
  },

  async getWithMembers(id: string): Promise<CompanyWithMembers | null> {
    const company = await this.getById(id);
    if (!company) return null;
    const members = await this.getMembers(id);
    return { ...company, members };
  },

  async getCompanyForUser(userId: string): Promise<{ company: CompanyProfileView; member: CompanyMember } | null> {
    const { data: memberRow, error } = await supabase
      .from('company_members')
      .select('id, company_id, user_id, role, display_name, created_at, profiles(email)')
      .eq('user_id', userId)
      .maybeSingle();
    throwIfError(error);
    if (!memberRow) return null;
    const member = mapCompanyMemberRow(memberRow as any);
    const company = await this.getById(member.companyId);
    if (!company) return null;
    return { company, member };
  },

  async addMember(
    _companyId: string,
    email: string,
    role: CompanyMemberRole,
    name?: string,
  ): Promise<CompanyMember> {
    const body: Record<string, unknown> = { email, role };
    if (name?.trim()) body.name = name.trim();
    const { data, error } = await supabase.functions.invoke('invite-company-member', { body });

    if (error) {
      const functionError = error as { message?: string; context?: Response };
      const body = await functionError.context?.json().catch(() => null);
      throw new Error(body?.error ?? functionError.message ?? 'Could not invite company member.');
    }
    if (!data?.member) {
      throw new Error(data?.error ?? 'Could not invite company member.');
    }

    return mapCompanyMemberRow(data.member as any);
  },

  async updateMemberRole(
    companyId: string,
    memberId: string,
    role: CompanyMemberRole,
  ): Promise<CompanyMember> {
    const { error } = await supabase.rpc('update_company_member_role', {
      p_company_id: companyId,
      p_member_id: memberId,
      p_new_role: role,
    });
    throwIfError(error);
    const { data, error: fetchError } = await supabase
      .from('company_members')
      .select('id, company_id, user_id, role, display_name, created_at, profiles(email)')
      .eq('id', memberId)
      .eq('company_id', companyId)
      .maybeSingle();
    throwIfError(fetchError);
    if (!data) throw new Error('Member role could not be updated.');
    return mapCompanyMemberRow(data as any);
  },

  async updateMemberName(
    companyId: string,
    memberId: string,
    displayName: string,
  ): Promise<CompanyMember> {
    const { data, error } = await supabase
      .from('company_members')
      .update({ display_name: displayName.trim() || null })
      .eq('id', memberId)
      .eq('company_id', companyId)
      .select('id, company_id, user_id, role, display_name, created_at, profiles(email)')
      .maybeSingle();
    throwIfError(error);
    if (!data) {
      throw new Error('Member name could not be updated. Check your admin permissions and company membership.');
    }
    return mapCompanyMemberRow(data as any);
  },

  async removeMember(companyId: string, memberId: string): Promise<void> {
    const { error } = await supabase.rpc('remove_company_member', {
      p_company_id: companyId,
      p_member_id: memberId,
    });
    throwIfError(error);
  },

  async update(id: string, patch: CompanyProfilePatch): Promise<CompanyProfileView | null> {
    const { data, error } = await supabase
      .from('companies')
      .update(companyPatchToDb(patch))
      .eq('id', id)
      .select(`
        id, name, phone, email, company_type, website, logo_path,
        location_country_code, location_city_name,
        location_city_lat, location_city_lng, location_city_geoname_id,
        verification_status, created_at, updated_at,
        location_countries ( name )
      `)
      .maybeSingle();
    throwIfError(error);
    // Mismo criterio que offerRepository.update: `companies_update_own` exige
    // my_company_role(id) = 'admin', así que un recruiter o un viewer recibía
    // data null, error null, y la pantalla se quedaba tan tranquila. Actualizar
    // por id nunca tiene un "no pasó nada" legítimo.
    if (!data) {
      throw new Error('Could not save the company profile — only a company admin can change these details.');
    }
    return mapCompanyRow(data as any);
  },
};
