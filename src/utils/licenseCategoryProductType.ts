import { LicenseCode, AuthorityLicenseCode, AircraftTypeRatingCatalog } from '../types/catalog';
import { OfferProductType } from '../types/offer';

// ─────────────────────────────────────────────────────────────────────────
// DOS PREGUNTAS DISTINTAS, DOS TABLAS DISTINTAS
//
// Hasta la corrección de la L (2026-08-14) había una sola tabla aquí y la
// del lado oferta se derivaba de ella, con un comentario que decía "one
// rule, two uses" y avisaba de que dos definiciones separadas podrían
// derivar. La L demostró que no eran dos usos de una regla: eran dos
// preguntas que da la casualidad de que se responden igual para A/B1/B2/C.
//
//   1. ¿Qué aeronaves puede colgar el técnico de esta licencia?
//      -> getLicenseRatingProductType(). Es una propiedad de la licencia:
//         lo que la norma le autoriza a firmar. La L cubre veleros,
//         motoveleros, globos y dirigibles; de rotorcraft, nada.
//
//   2. ¿Puede una oferta de este producto pedir esta licencia?
//      -> getOfferProductTypeRestriction(). Es una decisión de producto
//         sobre qué chips ofrece el formulario de oferta, y las ofertas
//         solo existen en dos productos (aviones/helicópteros).
//
// Para la L las dos respuestas divergen: su producto propio es 'Gas
// Airship' (pregunta 1), y aun así sigue apareciendo en ofertas de aviones
// (pregunta 2) porque una empresa con flota de ligeros puede publicar una
// oferta que pida L y describir la aeronave en el texto — la rama de sólo
// licencia ya soporta ofertas sin habilitaciones, y desde la Fase 9 un
// candidato perfecto ahí llega a 100. De helicópteros desaparece: ahí la
// norma sí la excluye, no es una restricción inventada por nosotros.
//
// ⚠ NO volver a fusionarlas. Si mañana las dos tablas vuelven a coincidir
// fila por fila, eso es una coincidencia sobre el catálogo de ese día, no
// una regla: siguen contestando a preguntas diferentes y la siguiente
// categoría rara las volverá a separar. Duplicar catorce líneas es más
// barato que volver a descubrir esto.
// ─────────────────────────────────────────────────────────────────────────

// ─── Pregunta 1: producto propio de la licencia (lado técnico) ───────────
//
// Fase 3b.4 — pure category -> productType mapping, a preview of canHold()'s
// productType dimension (Fase 4, HabilitationScope). Used to PRE-FILTER the
// rating picker once a license category is known (technician profile) —
// help, not a cage: callers must always offer an escape hatch back to the
// unfiltered catalog, never hard-block a selection outside the hinted facet.
//
// A1/A2/B1.1/B1.2 -> Aeroplane; A3/A4/B1.3/B1.4 -> Helicopter, per the
// mission plan. B3 ("Piston-engine non-pressurised aeroplanes") was not
// listed in either bucket there — it's aeroplane-only by its own
// definition (src/constants/licenses.ts), same shape as A2/B1.2, so it's
// included here on that basis. Flagging this explicitly since it's filling
// a gap the plan didn't address, not just applying it.
//
// L -> Gas Airship (corrección 2026-08-14). La categoría L cubre veleros,
// motoveleros, globos y dirigibles: no hay rotorcraft en ella, y de las
// tres familias, la única con filas en el catálogo de type ratings son los
// 3 dirigibles de gas (Zeppelin LZ N07, Skyship, Aeros). Antes devolvía
// undefined junto a B2/B2L/C, lo que dejaba colgar un A320neo de una L.
//
// B2/B2L/C sí cubren aviones y helicópteros por definición de la propia
// categoría (Avionics / Limited Avionics / Base Maintenance no están
// acotadas por producto) -> undefined, sin pre-filtro.
//
// TODO(open regulatory question, see mission brief): EASA AMC 66.A.45 may
// record some B2 endorsements without an engine designation — not
// special-cased here, matches the same TODO already in offerMatchExplain.ts
// (T1/T2 tiers) and would affect this mapping the same way if resolved.
export function getLicenseRatingProductType(
  licenseCode: LicenseCode,
): NonNullable<AircraftTypeRatingCatalog['productType']> | undefined {
  switch (licenseCode) {
    case 'A1':
    case 'A2':
    case 'B1.1':
    case 'B1.2':
    case 'B3':
      return 'Aeroplane';
    case 'A3':
    case 'A4':
    case 'B1.3':
    case 'B1.4':
      return 'Helicopter';
    case 'L':
      return 'Gas Airship';
    default:
      return undefined;
  }
}

// ─── Pregunta 2: en qué ofertas puede pedirse la licencia (lado oferta) ──
//
// Migración 047. `undefined` = la licencia puede pedirse en ofertas de
// cualquier producto.
//
// El tipo de retorno es OfferProductType, no el productType del catálogo:
// aquí 'Gas Airship' no es representable, y eso es a propósito. Las ofertas
// existen en dos productos (aviones/helicópteros, `offers.product_type`) y
// esta función solo contesta dentro de ese universo, así que la L no puede
// "restringir a dirigibles" ni por accidente — el compilador lo impide.
//
// Coincide con getLicenseRatingProductType() en A1/A2/B1.1/B1.2/B3 ->
// aviones y A3/A4/B1.3/B1.4 -> helicópteros. Diverge en la L: producto
// propio 'Gas Airship' allí, ofertas de AVIONES aquí (ver la cabecera).
//
// Esto NO es el enforcement: quien impide de verdad mezclar productos es la
// base de datos, con las FK compuestas orh_matches_offer / orh_matches_rating
// (migración 047). Esto es la ayuda de UI que evita llegar hasta ese error.
// Paso 5b: acepta también los códigos FAA, que caen en el default: A, P y A&P
// no distinguen aviones de helicópteros, así que no restringen el producto.
export function getOfferProductTypeRestriction(
  licenseCode: AuthorityLicenseCode,
): OfferProductType | undefined {
  switch (licenseCode) {
    case 'A1':
    case 'A2':
    case 'B1.1':
    case 'B1.2':
    case 'B3':
    // La L se pide en ofertas de aviones pese a que su producto propio es
    // 'Gas Airship': una empresa con flota de ligeros puede pedir L y
    // describir la aeronave en el texto de la oferta.
    case 'L':
      return 'Aeroplane';
    case 'A3':
    case 'A4':
    case 'B1.3':
    case 'B1.4':
      return 'Helicopter';
    default:
      return undefined;
  }
}

/**
 * ¿Puede esta categoría de licencia aparecer en una oferta de este producto?
 * La usa el formulario de oferta para decidir qué chips de licencia ofrece,
 * una vez la empresa ha declarado aviones o helicópteros.
 *
 * ⚠ La lista que ofrece el formulario para helicópteros es A3/A4/B1.3/B1.4
 * **más** B2/B2L/C — no la L, que la norma excluye de rotorcraft. Las tres
 * que quedan sí cubren ambos productos por definición de la categoría, y
 * excluirlas sería inventar una restricción que la norma no pone.
 */
export function isLicenseCompatibleWithProductType(
  licenseCode: AuthorityLicenseCode,
  productType: OfferProductType,
): boolean {
  const restriction = getOfferProductTypeRestriction(licenseCode);
  return restriction === undefined || restriction === productType;
}

// Fase 3b screen 2 — flags an ALREADY-DECLARED habilitation row whose rating
// doesn't match its license category's own productType, e.g. a helicopter
// rating declared under B1.1 (aeroplane-only), or an aeroplane declared
// under an L (airship-only).
//
// Lee getLicenseRatingProductType(), la tabla del LADO TÉCNICO, y esa es la
// correcta: la pregunta aquí es qué puede colgar el técnico de su licencia,
// la misma que responde el pre-filtro del picker. Nada que ver con qué
// ofertas pueden pedirla. Antes de separar las dos tablas esta distinción no
// se veía porque había una sola función.
//
// Never guesses: B2/B2L/C (getLicenseRatingProductType returns undefined)
// cover both product types by definition, and a rating whose productType
// hasn't been backfilled (undefined) is never flagged either — same
// "unpopulated means no facet, not a guessed one" rule getByProductType()
// already follows. This is advisory only — existing rows are never hidden,
// blocked from editing, or auto-removed because of it.
//
// Añadir la L aquí no marca ninguna fila existente: verificado en
// rotoaxismatch-dev el 2026-08-14, technician_habilitations no tiene ni una
// fila con license_code = 'L' (7 filas en total: A2 ×2, B1.3 ×1, B2 ×4).
export function isUnusualCombination(
  licenseCode: LicenseCode,
  ratingProductType: AircraftTypeRatingCatalog['productType'] | undefined,
): boolean {
  const expected = getLicenseRatingProductType(licenseCode);
  if (!expected || !ratingProductType) return false;
  return ratingProductType !== expected;
}
