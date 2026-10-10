// "What they ask vs. your profile": la checklist de la página de oferta del
// técnico (rediseño, fase 5A; maqueta T-Offer, T7 y respuesta 24 de la revisión).
//
// Sustituye a las barras (15/15, 45/45…) y a la tarjeta de requisitos, sin
// tocar el cálculo:
//   - Las filas son EXACTAMENTE los criterios que hoy dan puntos en esta oferta:
//     las de `visibleBreakdownRows` (src/utils/matchBreakdownRows.ts), es decir,
//     los ejes con máximo > 0. Un eje que la oferta no pide no sale.
//   - El estado de cada fila sale del mismo `score.breakdown` que suma el %:
//     ✓ con todos sus puntos, a medias con parte, gris con 0. Sin score (no se
//     pudo calcular), la fila dice lo que pide la oferta, sin estado.
//   - Debajo, los avisos de hoy (bloqueos, tope, vigencia, equivalencia de
//     autoridad, aclaraciones y requisitos no cumplidos), sin lo que la
//     checklist ya dice: ni la lista de "Matches" ni la fila "Exact match —
//     95/100", que repetía el % de arriba.
//
// Que la checklist nunca contradiga el %: si el % queda por debajo de lo que
// suman las filas, es porque se aplicó un tope, y entonces los avisos llevan
// SIEMPRE la nota del tope que lo explica (`scoreCapNote`). Lo comprueba
// scripts/testTechnicianNavigation.ts con el cálculo real.
import type { MatchScore, VigenciaNotice } from '../types/matching';
import type { OfferWithRequirements } from '../types/offer';
import { getAircraftTypeRatingLabel, type AircraftRatingIndex } from '../constants/aircraftTypeRatings';
import type { EngineIndex } from '../constants/engines';
import { CONTRACT_TYPES } from '../constants/contractTypes';
import { visibleBreakdownRows, type BreakdownKey } from './matchBreakdownRows';
import { offerEngineText, offerLicenseDetailText, requirementWithNote } from './offerRequirementsText';
import { formatLocation } from './formatLocation';

export type ChecklistState = 'full' | 'partial' | 'none' | 'unknown';

/** Lo que pide la oferta primero (licencia, aeronave o motor), como en la maqueta. */
export const CHECKLIST_ORDER: readonly BreakdownKey[] = [
  'license',
  'habilitation',
  'engine',
  'verified',
  'contractFit',
  'location',
];

export interface ChecklistRow {
  key: BreakdownKey;
  /** "Licence", "Aircraft", "Engine"… */
  label: string;
  /** Lo que pide la oferta; varias líneas para varias aeronaves. */
  values: string[];
  /** "All of these" / "Any one of these", sólo con varias aeronaves. */
  caption?: string;
  state: ChecklistState;
}

/** El estado de una fila con sus puntos: todos, parte o ninguno. */
export function checklistState(value: number, max: number): ChecklistState {
  if (value >= max) return 'full';
  if (value > 0) return 'partial';
  return 'none';
}

const STATE_TEXT: Record<ChecklistState, string> = {
  full: 'Fully met',
  partial: 'Partly met',
  none: 'Not met',
  unknown: '',
};

export function checklistRowAccessibilityLabel(row: ChecklistRow): string {
  const text = `${row.label}: ${row.values.join(', ')}`;
  return STATE_TEXT[row.state] ? `${text}. ${STATE_TEXT[row.state]}` : text;
}

function rowLabel(key: BreakdownKey, breakdownLabel: string): string {
  switch (key) {
    case 'license': return 'Licence';
    // En una oferta FAA la fila mide experiencia, no type rating, y lo dice
    // (el rótulo lo decide visibleBreakdownRows).
    case 'habilitation': return breakdownLabel === 'Aircraft experience' ? 'Aircraft experience' : 'Aircraft';
    case 'engine': return 'Engine';
    case 'verified': return 'Verification';
    case 'contractFit': return 'Contract';
    case 'location': return 'Location';
    default: return breakdownLabel;
  }
}

function rowValues(
  key: BreakdownKey,
  offer: OfferWithRequirements,
  ratingIndex: AircraftRatingIndex,
  engineIndex: EngineIndex,
): { values: string[]; caption?: string } {
  switch (key) {
    case 'license':
      return { values: [offerLicenseDetailText(offer) ?? 'Licence'] };
    case 'habilitation': {
      const aircraft = offer.requiredHabilitations.map((h) =>
        requirementWithNote(getAircraftTypeRatingLabel(h.aircraftTypeRatingId, ratingIndex), h.notes),
      );
      // Fase 6 tanda D: la exigencia se dice una vez. Con una sola aeronave
      // "todas" y "una de ellas" son lo mismo.
      const caption = aircraft.length > 1 ? (offer.requiresAllAircraft ? 'All of these' : 'Any one of these') : undefined;
      return { values: aircraft.length > 0 ? aircraft : ['Not specified'], caption };
    }
    case 'engine':
      return { values: [requirementWithNote(offerEngineText(offer, engineIndex) ?? 'Not specified', offer.requiredEngineNotes)] };
    case 'verified':
      return { values: ['Verified profile'] };
    case 'contractFit':
      return { values: [CONTRACT_TYPES.find((c) => c.code === offer.contractType)?.label ?? offer.contractType] };
    case 'location':
      return { values: [formatLocation(offer.locationCity, offer.locationCountry) || 'Not specified'] };
    default:
      return { values: [] };
  }
}

/**
 * Las filas de la checklist. `score` null: la oferta se enseña igual (lo que
 * pide), sin estado, como antes se enseñaba la tarjeta de requisitos aunque no
 * hubiera bloque de match.
 */
export function offerChecklistRows(
  offer: OfferWithRequirements,
  score: Pick<MatchScore, 'breakdown'> | null,
  ratingIndex: AircraftRatingIndex,
  engineIndex: EngineIndex,
): ChecklistRow[] {
  return visibleBreakdownRows(offer, CHECKLIST_ORDER).map((row) => ({
    key: row.key,
    label: rowLabel(row.key, row.label),
    ...rowValues(row.key, offer, ratingIndex, engineIndex),
    state: score ? checklistState(score.breakdown[row.key], row.max) : 'unknown',
  }));
}

/**
 * Por qué el % queda por debajo de lo que suman los criterios, o null si no se
 * aplicó ningún tope. El texto es el de siempre (MatchExplanation lo usa también).
 */
export function scoreCapNote(score: MatchScore): string | null {
  const rawSum = Object.values(score.breakdown).reduce((sum, v) => sum + v, 0);
  if (rawSum <= score.total) return null;
  if (score.blockers.length > 0) {
    return 'Score capped: this profile does not meet a hard requirement of the offer (see above).';
  }
  if (score.profileTypeMismatch) {
    return 'Score capped: the offer is looking for a different profile type (see below).';
  }
  if (score.missingRequirements.length > 0) {
    return 'Score capped: this offer states a requirement this profile does not meet (see below).';
  }
  return 'Score capped: this offer requires certified work and the profile does not hold the licence for it.';
}

export type ChecklistNotice =
  | { kind: 'blockers'; lines: string[] }
  | { kind: 'cap'; text: string }
  | { kind: 'validity'; notices: VigenciaNotice[] }
  | { kind: 'authority'; text: string }
  | { kind: 'clarifications'; lines: string[] }
  | { kind: 'missing'; lines: string[] };

/**
 * Los avisos de hoy, en el orden de siempre, sin los que repiten la checklist
 * o el % (la lista de "Matches" y la fila de nivel).
 */
export function offerChecklistNotices(score: MatchScore): ChecklistNotice[] {
  const notices: ChecklistNotice[] = [];
  if (score.blockers.length > 0) notices.push({ kind: 'blockers', lines: score.blockers });
  const cap = scoreCapNote(score);
  if (cap) notices.push({ kind: 'cap', text: cap });
  if (score.vigenciaNotices.length > 0) notices.push({ kind: 'validity', notices: score.vigenciaNotices });
  if (score.authorityEquivalence) notices.push({ kind: 'authority', text: score.authorityEquivalence });
  if (score.clarifications.length > 0) notices.push({ kind: 'clarifications', lines: score.clarifications });
  if (score.missingRequirements.length > 0) notices.push({ kind: 'missing', lines: score.missingRequirements });
  return notices;
}
