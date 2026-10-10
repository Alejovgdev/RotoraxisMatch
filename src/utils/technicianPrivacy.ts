// Los avisos de identidad que ve el técnico (rediseño, fase 5B). Pura, para
// poder probarla: scripts/testTechnicianRelations.ts.
//
// "Your identity remains private until…" no es cierto cuando esa empresa YA ve
// la identidad del técnico por un contacto anterior aceptado (otra candidatura
// u otra oferta directa con ella). Para saberlo se usa EXACTAMENTE la regla con
// la que la base enseña la identidad a la empresa: `offer_accepted_between`
// (migración 001; technician_public_view la usa para anular nombre, contacto y
// documentos), cuyo espejo en TypeScript es `canRevealIdentity`
// (src/utils/privacyV2.ts): hay una oferta directa o una candidatura ACEPTADA
// entre esa empresa y ese técnico. No es una regla nueva.
//
// Los datos son las candidaturas y ofertas directas del propio técnico, que ya
// lee con offerApplicationRepository/offerRequestRepository.getForTechnician:
// ni consulta nueva ni cambio en la base.
import { canRevealIdentity } from './privacyV2';
import type { OfferApplication, OfferRequest } from '../types/offerRequest';

export const IDENTITY_ALREADY_VISIBLE = 'This company can already see your identity because you connected with them before.';

/** ¿Ve ya esta empresa la identidad del técnico? La regla de la base, sin cambios. */
export function companyCanSeeIdentity(params: {
  companyId: string;
  technicianId: string;
  offerRequests: readonly OfferRequest[];
  offerApplications: readonly OfferApplication[];
}): boolean {
  return canRevealIdentity({
    companyId: params.companyId,
    technicianId: params.technicianId,
    offerRequests: [...params.offerRequests],
    offerApplications: [...params.offerApplications],
  });
}

// ── Página de oferta ────────────────────────────────────────────────────────

/** El aviso de privacidad junto a "Apply" (antes de que esta empresa acepte nada de esta oferta). */
export function offerPrivacyText(identityVisible: boolean): string {
  return identityVisible
    ? IDENTITY_ALREADY_VISIBLE
    : 'Your identity remains private until a company accepts your application.';
}

/** La nota de la hoja de aplicar. */
export function applySheetNote(identityVisible: boolean): string {
  return identityVisible
    ? IDENTITY_ALREADY_VISIBLE
    : 'Do not include your real name or contact details. Your identity will remain anonymous until the company accepts your application.';
}

// ── Ofertas directas ───────────────────────────────────────────────────────

export interface ConfirmTexts {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
}

/**
 * Las confirmaciones de aceptar y rechazar una oferta directa: los textos de
 * antes. Aceptar revela la identidad, así que se confirma SIEMPRE (respuesta
 * 15); si la empresa ya la ve, el texto lo dice en vez de prometer desbloquearla.
 */
export function directOfferConfirm(action: 'accept' | 'reject', identityVisible: boolean): ConfirmTexts {
  if (action === 'accept') {
    return {
      title: 'Accept direct offer?',
      message: identityVisible
        ? `${IDENTITY_ALREADY_VISIBLE} Accepting opens a chat.`
        : 'This will unlock your identity and admin-verified documents for the company and open a chat.',
      confirmLabel: 'Confirm accept',
    };
  }
  return {
    title: 'Reject direct offer?',
    message: identityVisible
      ? `The company will be notified. ${IDENTITY_ALREADY_VISIBLE}`
      : 'The company will be notified. Your identity and documents will remain locked.',
    confirmLabel: 'Confirm reject',
    destructive: true,
  };
}

/** La nota de una oferta directa rechazada. */
export function declinedNote(identityVisible: boolean): string {
  return identityVisible ? IDENTITY_ALREADY_VISIBLE : 'Your identity and documents remain private.';
}
