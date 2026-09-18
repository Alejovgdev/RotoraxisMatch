// Las reglas de FORMA de una oferta, en un solo sitio (Fase 10, paso 5b).
//
// Espejo en TypeScript de lo que Postgres ya impone en `offers`, igual que
// `isValidAuthorityLicense` lo es de la FK compuesta: NO es una segunda fuente
// de verdad —la base rechaza lo mismo aunque esto no exista— sino la forma de
// no mandar lo que va a rechazar y de decirlo con un mensaje que una persona
// entienda. Cada regla nombra su restricción:
//
//   chk_offers_license_matches_certification (053)  certificar ⇔ licencia
//   chk_offers_license_authority_pairing     (075)  licencia ⇔ autoridad
//   FK a authority_licenses                  (075)  el par existe
//   chk_offers_engine_kind_shape       (076, 087)  motor ⇒ con motor; licencia
//                                                  opcional, sólo B1.x, P o A&P
//   triggers de la 076                              motor ⇒ sin aeronaves
//   chk_offers_aircraft_without_engine       (077)  aeronave ⇒ sin motor
//   chk_offers_only_unlicensed_without_license (077) "sólo sin licencia" ⇒ no exige licencia
//   chk_offers_accepted_authorities + trigger (088) aceptadas ⊆ otras Part-66 que emiten el código
//
// La usan offerRepository (antes de escribir, sobre el estado RESULTANTE) y los
// fixtures de scripts/testMatching.ts (una oferta de test que la base no
// aceptaría no debe llegar al scorer).
import { OfferWithRequirements } from '../types/offer';
import { AuthorityLicenseCode } from '../types/catalog';
import {
  ENGINE_OFFER_LICENSE_CODES,
  authorityHasTypeRatings,
  authorityLabel,
  credentialLabel,
  equivalentAuthoritiesForLicense,
  isValidAuthorityLicense,
} from '../constants/licenses';

/**
 * ¿Las aeronaves de esta oferta son EXPERIENCIA y no type ratings? (Fase 10, sesión 2)
 *
 * Sí cuando certifica bajo una autoridad que no emite type ratings (hoy sólo la
 * FAA, `authorities.has_type_ratings = false`). Allí no hay habilitación que
 * pedir, así que la aeronave se compara con la experiencia declarada: puntúa y
 * no excluye. La usan el scorer, el formulario, el repositorio y las pantallas
 * que etiquetan "A&P + 737" frente a "737", para que las cuatro digan lo mismo.
 *
 * Sin autoridad (oferta anterior a la 075) no se deduce nada: false.
 */
export function offerAircraftAreExperience(
  offer: Pick<OfferWithRequirements, 'requiresCertification' | 'licenseAuthority'>,
): boolean {
  return offer.requiresCertification && offer.licenseAuthority != null && !authorityHasTypeRatings(offer.licenseAuthority);
}

export type OfferShape = Pick<
  OfferWithRequirements,
  'offerKind' | 'requiresCertification' | 'licenseCode' | 'licenseAuthority' | 'requiredEngineId' | 'onlyUnlicensed' | 'acceptedAuthorities'
> & {
  requiredHabilitations: readonly unknown[];
};

/** Lo que Postgres rechazaría de esta oferta, en inglés de pantalla. Vacío = válida. */
export function offerShapeViolations(offer: OfferShape): string[] {
  const violations: string[] = [];
  const hasLicense = offer.licenseCode !== undefined && offer.licenseCode !== null;
  const hasAuthority = offer.licenseAuthority !== undefined && offer.licenseAuthority !== null;
  const hasEngine = Boolean(offer.requiredEngineId);

  if (offer.requiresCertification !== hasLicense) {
    violations.push(
      offer.requiresCertification
        ? 'An offer that requires a licence must name the licence.'
        : 'An offer that needs no licence cannot name one.',
    );
  }
  if (hasLicense !== hasAuthority) {
    violations.push('A required licence must name its issuing authority, and an authority needs a licence.');
  }
  if (hasLicense && hasAuthority && !isValidAuthorityLicense(offer.licenseAuthority as string, offer.licenseCode as string)) {
    violations.push(`${offer.licenseAuthority} does not issue a ${offer.licenseCode} licence.`);
  }

  if (offer.offerKind === 'engine') {
    // Sesión 2 (087): la licencia es opcional, pero sólo una que certifique el
    // motor. Que la autoridad emita el código lo dice la comprobación de arriba.
    if (hasLicense && !ENGINE_OFFER_LICENSE_CODES.includes(offer.licenseCode as AuthorityLicenseCode)) {
      violations.push('An engine offer can only ask for a Part-66 B1 licence or an FAA P or A&P.');
    }
    if (!hasEngine) violations.push('An engine offer must name the engine.');
    if (offer.requiredHabilitations.length > 0) violations.push('An engine offer cannot require aircraft type ratings.');
  } else if (hasEngine) {
    violations.push('Only an engine offer can name an engine.');
  }

  if (offer.onlyUnlicensed && (hasLicense || offer.requiresCertification)) {
    violations.push('"Only technicians without a licence" cannot be combined with a licence requirement.');
  }

  // Sesión 2 (088): las aceptadas son OTRAS autoridades Part-66 que emiten el
  // mismo código. Ni la exigida, ni la FAA, ni ninguna sin licencia.
  const accepted = offer.acceptedAuthorities;
  if (new Set(accepted).size !== accepted.length) violations.push('An accepted authority is listed twice.');
  const acceptable = equivalentAuthoritiesForLicense(offer.licenseAuthority, offer.licenseCode);
  const outside = accepted.filter((a) => !acceptable.includes(a));
  if (outside.length > 0) {
    violations.push(
      hasLicense
        ? `${outside.map(authorityLabel).join(', ')} cannot be accepted as equivalent to ${credentialLabel(offer.licenseAuthority, offer.licenseCode as string)}.`
        : 'Accepted authorities need a licence to be equivalent to.',
    );
  }

  return violations;
}

export function assertOfferShape(offer: OfferShape): void {
  const violations = offerShapeViolations(offer);
  if (violations.length > 0) throw new Error(violations.join(' '));
}
