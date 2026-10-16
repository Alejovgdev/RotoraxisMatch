// Lo que la pantalla de borrar cuenta le dice a un miembro de empresa ANTES de
// borrar, a partir de company_account_deletion_impact (migración 105). Puro,
// para poder probarlo sin pantalla (`npm run test:company-account-deletion`).
//
// Los textos van en inglés, como el resto de la app.
import { CompanyDeletionImpact } from '../types/accountDeletion';

export type CompanyDeletionNotice =
  | { kind: 'deletes_company'; title: string; intro: string; items: string[]; footer: string }
  | { kind: 'must_assign_admin'; text: string }
  | { kind: 'company_stays' };

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function companyDeletionNotice(impact: CompanyDeletionImpact | null): CompanyDeletionNotice {
  if (!impact) return { kind: 'company_stays' };

  if (impact.mustAssignAdmin) {
    return {
      kind: 'must_assign_admin',
      text: `You are the only administrator of ${impact.companyName}. Make another member an administrator in Team before deleting your account. Pending invitations don't count as members.`,
    };
  }

  if (impact.deletesCompany) {
    const items = [
      `The company profile and logo`,
      count(impact.offers, 'offer', 'offers'),
      count(impact.applications, 'application from technicians', 'applications from technicians'),
      count(impact.directOffers, 'direct offer sent to technicians', 'direct offers sent to technicians'),
      count(impact.chats, 'chat with technicians, including their messages', 'chats with technicians, including their messages'),
    ];
    if (impact.pendingInvitations > 0) {
      items.push(`${count(impact.pendingInvitations, 'pending invitation', 'pending invitations')} (cancelled)`);
    }
    return {
      kind: 'deletes_company',
      title: `${impact.companyName} will be deleted too`,
      intro: `You are the last member of ${impact.companyName}. Deleting your account also permanently deletes the company and everything in it:`,
      items,
      footer: 'Technicians will no longer see these applications, direct offers or chats. This cannot be undone.',
    };
  }

  return { kind: 'company_stays' };
}

/** El botón de borrar sólo se habilita cuando delete-account no lo va a rechazar (409). */
export function companyAccountCanBeDeleted(impact: CompanyDeletionImpact | null): boolean {
  return !impact?.mustAssignAdmin;
}
