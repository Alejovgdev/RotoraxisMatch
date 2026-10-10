import { VerificationStatus, CompanyMemberRole } from './enums'; // owned by enums.ts — not re-exported here
import { CompanyTypeCode } from './catalog'; // owned by catalog.ts — not re-exported here
import { PersistedLocation } from './location';

// --- V1-compatible types — intentionally retained until the V2 UI migration ---

/**
 * @deprecated V1 company-type union still required by the Company compatibility
 * shape produced by v2CompanyToV1(). New code should use CompanyTypeCode from
 * catalog.ts. Remove this union together with Company after its dashboard and
 * admin consumers have migrated to CompanyProfile/CompanyProfileView.
 */
export type CompanyType =
  | 'airline'
  | 'mro'
  | 'operator'
  | 'contractor'
  | 'recruiter'
  // V2 values added for forward compat
  | 'MRO'
  | 'recruitment_agency'
  | 'helicopter_operator'
  | 'other';

/**
 * @deprecated V1 display/state shape produced by v2CompanyToV1() and still
 * consumed by the company/technician/admin dashboard hooks, the admin companies
 * screen, and AdminCompanyCard. New code should use CompanyProfile or
 * CompanyProfileView. Remove this interface only after those consumers use the
 * V2 shapes and the adapter is no longer needed.
 */
export interface Company {
  id: string;
  companyName: string;
  logoPath?: string | null;
  country: string;
  city: string;
  website: string;
  companyType: CompanyType;
  verificationStatus: VerificationStatus;
  contactEmail: string;
}

// --- V2 types ---

// Fase 7: ver la nota de TechnicianProfile. Mismo modelo, y también sin
// `locationCityId` desde F2d.
export interface CompanyProfile extends PersistedLocation {
  logoPath?: string | null;
  id: string;
  name: string;
  phone?: string;
  email: string;
  companyType: CompanyTypeCode;
  /**
   * Web pública de la empresa (migración 036). `undefined` = no declarada;
   * en Postgres es NULL, nunca ''. Se persiste ya normalizada, con esquema
   * explícito (src/utils/urlValidation.ts).
   *
   * SIN gate de privacidad, a diferencia de TechnicianProfile.socialLinks:
   * la empresa no es anónima en este producto. Cualquier usuario activo la
   * lee vía la política companies_select_all; sólo el admin de la propia
   * empresa la escribe (companies_update_own).
   */
  website?: string;
  /** ADMIN-ONLY in Supabase — company cannot write this field; set via admin-only RLS policy */
  verificationStatus: VerificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyProfileView extends CompanyProfile {
  country: string;
  city: string;
  baseAirport?: string;
  latitude?: number;
  longitude?: number;
}

export interface CompanyMember {
  id: string;
  companyId: string;
  userId: string;
  role: CompanyMemberRole;
  /** Set by company admin. Fallback display order: displayName → email → 'Unnamed member' */
  displayName?: string;
  /** Populated via profiles JOIN; absent until migration 004 is applied */
  email?: string;
  createdAt: string;
}
