// PRESENTACIÓN — cómo se dicen los requisitos de una oferta (Fase 10, paso 5b).
//
// Cinco pantallas pintan los requisitos de una oferta (detalle de empresa,
// detalle y lista del técnico, oferta directa, moderación). Con la autoridad,
// las equivalencias, el motor y "sólo sin licencia", escribirlo a mano en cada
// una era la forma de que una dijera "B1.1" y otra "EASA B1.1".
import { Offer } from '../types/offer';
import { EngineIndex, getEngineLabel } from '../constants/engines';
import { credentialLabel } from '../constants/licenses';
import { technicianTypeLabel } from '../constants/technicianTypes';

/** "EASA B1.1", "FAA A&P". null si la oferta no pide licencia. */
export function offerLicenseText(offer: Pick<Offer, 'licenseCode' | 'licenseAuthority'>): string | null {
  return offer.licenseCode ? credentialLabel(offer.licenseAuthority, offer.licenseCode) : null;
}

/** "EASA B1.1 — equivalent Part-66 authorities accepted". */
export function offerLicenseDetailText(offer: Pick<Offer, 'licenseCode' | 'licenseAuthority' | 'acceptsEquivalent'>): string | null {
  const license = offerLicenseText(offer);
  if (!license) return null;
  return offer.acceptsEquivalent ? `${license} — equivalent Part-66 authorities accepted` : license;
}

/** El motor pedido, o null si no es oferta de motor. Con el catálogo aún sin cargar, el id. */
export function offerEngineText(offer: Pick<Offer, 'offerKind' | 'requiredEngineId'>, engineIndex: EngineIndex): string | null {
  if (offer.offerKind !== 'engine' || !offer.requiredEngineId) return null;
  return getEngineLabel(offer.requiredEngineId, engineIndex);
}

export const ONLY_UNLICENSED_TEXT = 'Only technicians without a licence';

/**
 * La tira corta de requisitos de una tarjeta, en orden de importancia. En una
 * oferta de motor el oficio no se dice: no puntúa ni filtra, y ponerlo delante
 * del motor contaría algo que la oferta no pide.
 */
export function offerRequirementChips(
  offer: Pick<Offer, 'offerKind' | 'requiredEngineId' | 'technicianType' | 'requiresCertification' | 'licenseCode' | 'licenseAuthority' | 'onlyUnlicensed'>,
  engineIndex: EngineIndex,
): string[] {
  const engine = offerEngineText(offer, engineIndex);
  const license = offerLicenseText(offer);
  return [
    ...(engine ? [`Engine: ${engine}`] : [technicianTypeLabel(offer.technicianType)]),
    ...(offer.requiresCertification ? [] : ['No licence needed']),
    ...(license ? [license] : []),
    ...(offer.onlyUnlicensed ? [ONLY_UNLICENSED_TEXT] : []),
  ];
}
