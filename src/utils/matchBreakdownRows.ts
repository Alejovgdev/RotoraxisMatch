// Qué filas se pintan en un desglose de puntuación, y con qué rótulo.
//
// Cierre de la Fase 10 — LA FILA CON MÁXIMO 0 NO SE PINTA. `getMatchScoreWeights`
// reparte los 65 puntos de cualificación entre los ejes QUE LA OFERTA NOMBRE, así
// que en toda oferta hay al menos un eje que no puede sumar nada: "Habilitation
// 0/0" en una oferta de motor, "Engine 0/0" en una de aeronave, "License 0/0" en
// una que no certifica. Un cero sobre cero no es una nota baja, es una pregunta
// que la oferta no ha hecho, y leerlo como nota es lo que se confundía en
// pantalla.
//
// Vive aquí y no en cada pantalla porque los desgloses son CINCO (búsqueda de
// empresa, candidatura, oferta directa a los dos lados y detalle de oferta del
// técnico) y hasta ahora cada uno repetía la lista de seis filas a mano, con el
// motor como única excepción condicionada. Repetirla una sexta vez era la forma
// de que un eje nuevo saliera en cuatro pantallas y en la quinta no.
import { MatchScore } from '../types/matching';
import { OfferWithRequirements } from '../types/offer';
import { getMatchScoreWeights } from './offerMatchExplain';
import { offerAircraftAreExperience } from './offerShape';

export type BreakdownKey = keyof MatchScore['breakdown'];

export interface BreakdownRowSpec {
  key: BreakdownKey;
  label: string;
  max: number;
}

// El rótulo, en un único sitio. Ajustes finales de Fase 10: en una oferta FAA
// la fila de habilitación mide la aeronave como experiencia —la FAA no emite
// type ratings (`offerAircraftAreExperience`); desde el 2026-10-04 cuenta la
// declarada o un type rating de cualquier autoridad— y se rotula así. En las
// ofertas sin certificar sigue diciendo `Habilitation` aunque allí cuentan las
// dos fuentes: está en los Pendientes de docs/fase-10.md.
const AIRCRAFT_EXPERIENCE_LABEL = 'Aircraft experience';

const BREAKDOWN_LABELS: Record<BreakdownKey, string> = {
  habilitation: 'Habilitation',
  license: 'License',
  engine: 'Engine',
  verified: 'Verified',
  contractFit: 'Contract fit',
  location: 'Location',
};

/** Las cuatro pantallas con barras empiezan por "Verified". */
export const VERIFIED_FIRST_ORDER: readonly BreakdownKey[] = [
  'verified',
  'habilitation',
  'license',
  'engine',
  'contractFit',
  'location',
];

/** MatchExplanation empieza por la cualificación, que es la que domina la nota. */
export const QUALIFICATION_FIRST_ORDER: readonly BreakdownKey[] = [
  'habilitation',
  'license',
  'engine',
  'verified',
  'contractFit',
  'location',
];

/**
 * Las filas que esta oferta puede puntuar, en el orden pedido. El orden se pasa
 * porque los dos desgloses ya existentes no coinciden y unificarlos habría
 * movido filas de sitio en cuatro pantallas sin que nadie lo pidiera; lo que sí
 * se unifica es QUÉ filas salen y cómo se rotulan.
 *
 * Recibe la OFERTA y no sus pesos (ajustes finales de Fase 10): el rótulo
 * depende de ella, y de ella salen también los máximos. Con pesos y oferta por
 * separado, una pantalla podía pasar unos de una y rotular con la otra.
 *
 * Sin oferta —la pantalla todavía no sabe contra qué oferta puntúa— la lista es
 * vacía: pintar seis filas con denominadores inventados es peor que no pintar
 * ninguna.
 */
export function visibleBreakdownRows(
  offer: OfferWithRequirements | null | undefined,
  order: readonly BreakdownKey[] = VERIFIED_FIRST_ORDER,
): BreakdownRowSpec[] {
  if (!offer) return [];
  const weights = getMatchScoreWeights(offer);
  const aircraftAreExperience = offerAircraftAreExperience(offer);
  return order
    .filter((key) => weights[key] > 0)
    .map((key) => ({
      key,
      label: key === 'habilitation' && aircraftAreExperience ? AIRCRAFT_EXPERIENCE_LABEL : BREAKDOWN_LABELS[key],
      max: weights[key],
    }));
}
