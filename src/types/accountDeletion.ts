import { CompanyMemberRole } from './enums';

/**
 * Qué pasaría con la empresa al borrar la cuenta de uno de sus miembros
 * (`company_account_deletion_impact`, migración 105). La misma regla que aplica
 * la base al borrar: las invitaciones pendientes (cuentas que nunca han
 * entrado) no cuentan como miembros.
 */
export interface CompanyDeletionImpact {
  companyId: string;
  companyName: string;
  memberRole: CompanyMemberRole;
  /** Otros miembros que han entrado alguna vez. */
  otherMembers: number;
  /** De ellos, admins. */
  otherAdmins: number;
  /** Otros miembros que nunca han entrado: se cancelan si la empresa se borra. */
  pendingInvitations: number;
  offers: number;
  applications: number;
  directOffers: number;
  chats: number;
  /** No queda nadie más que haya entrado: la empresa se borra con la cuenta. */
  deletesCompany: boolean;
  /** Único admin con otros miembros que sí han entrado: tiene que nombrar otro antes. */
  mustAssignAdmin: boolean;
}
