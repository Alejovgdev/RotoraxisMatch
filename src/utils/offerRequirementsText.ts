// PRESENTACIÓN — cómo se dicen los requisitos de una oferta (Fase 10, paso 5b).
//
// Cinco pantallas pintan los requisitos de una oferta (detalle de empresa,
// detalle y lista del técnico, oferta directa, moderación). Con la autoridad,
// las equivalencias, el motor y "sólo sin licencia", escribirlo a mano en cada
// una era la forma de que una dijera "B1.1" y otra "EASA B1.1".
import { Offer } from '../types/offer';
import { EngineIndex, getEngineLabel } from '../constants/engines';
import { authorityLabel, credentialLabel, faaEquivalentLicenseCodes } from '../constants/licenses';
import { technicianTypeLabel } from '../constants/technicianTypes';

/** "EASA B1.1", "FAA A&P". null si la oferta no pide licencia. */
export function offerLicenseText(offer: Pick<Offer, 'licenseCode' | 'licenseAuthority'>): string | null {
  return offer.licenseCode ? credentialLabel(offer.licenseAuthority, offer.licenseCode) : null;
}

/**
 * "EASA B1.1 — also accepts UK CAA, CASA (Australia)". Sin aceptadas, sólo la
 * credencial. 096: en una oferta FAA las aceptadas van con su categoría, que
 * no es la de la oferta: "FAA A&P — also accepts EASA or UK CAA B2".
 *
 * 2026-10-04: la FAA aceptada en una oferta Part-66 va con los certificados que
 * cuentan por su tabla (faaEquivalentLicenseCodes): "EASA B1.1 — also accepts
 * UK CAA, FAA A&P"; con A1–A4, "FAA A or A&P".
 */
export function offerLicenseDetailText(
  offer: Pick<Offer, 'licenseCode' | 'licenseAuthority' | 'acceptedAuthorities' | 'acceptedLicenseCode'>,
): string | null {
  const license = offerLicenseText(offer);
  if (!license || !offer.licenseCode) return null;
  if (offer.acceptedAuthorities.length === 0) return license;
  if (offer.licenseAuthority === 'FAA' && offer.acceptedLicenseCode) {
    const labels = offer.acceptedAuthorities.map(authorityLabel);
    const authorities = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
    return `${license} — also accepts ${authorities} ${offer.acceptedLicenseCode}`;
  }
  const faaCodes = faaEquivalentLicenseCodes(offer.licenseCode);
  const labels = offer.acceptedAuthorities.map((a) =>
    a === 'FAA' && faaCodes.length > 0 ? credentialLabel(a, faaCodes.join(' or ')) : authorityLabel(a),
  );
  return `${license} — also accepts ${labels.join(', ')}`;
}

/** El motor pedido, o null si no es oferta de motor. Con el catálogo aún sin cargar, el id. */
export function offerEngineText(offer: Pick<Offer, 'offerKind' | 'requiredEngineId'>, engineIndex: EngineIndex): string | null {
  if (offer.offerKind !== 'engine' || !offer.requiredEngineId) return null;
  return getEngineLabel(offer.requiredEngineId, engineIndex);
}

export const ONLY_UNLICENSED_TEXT = 'Only technicians without a licence';

/**
 * La fila "Certified work". En una oferta de motor la licencia es opcional y
 * sólo puntúa (sesión 2): "required" prometería un filtro que no existe.
 */
export function offerCertificationText(offer: Pick<Offer, 'offerKind' | 'requiresCertification'>): string {
  if (!offer.requiresCertification) return 'No licence needed';
  return offer.offerKind === 'engine' ? 'Licence preferred' : 'Licence required';
}

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
