import type { TechnicianWithRelations } from './technician';
import type { TechnicianView } from './privacy';

// A match score is ALWAYS tied to a specific offer + technician pair.
// It is never a global score on a technician_profile row.
//
// `level` / `matches` / `clarifications` / `missingRequirements` make the score
// explainable instead of an opaque percentage:
//   - 'exact'    every required habilitation matches license+rating exactly
//                (tier T1 in offerMatchExplain.ts).
//   - 'related'  same category + a related rating in the same aircraft
//                family, different engine (tier T2) — needs a human to
//                confirm the detail (engine, recency, etc).
//                Fase 5.3 (2026-07-28): this used to also cover T3 (a legacy
//                general habilitation with no engine on record). T3 is gone
//                with the pre-Part-66 aircraft_types catalog, so 'related'
//                now means T2 and only T2.
//   - 'legacy'   the offer only has broad (unlinked) requirements; the match
//                was resolved via a real technician_habilitations row, not by
//                combining independent license/aircraft lists. Also used for
//                offers with no qualification requirement at all (nothing to
//                confirm either way).
//   - 'not_met'  no requirement could be matched at all. This never removes
//                the technician from results by itself — a requirement the
//                offer states and the profile does not meet is surfaced via
//                missingRequirements.
export type MatchLevel = 'exact' | 'related' | 'legacy' | 'not_met';

// A slight, non-excluding degradation signal (Fase 3 — vigencia): an
// expired date always wins over an explicit isCurrent=false (see
// offerMatchExplain.ts evaluateVigencia) so there is always at most ONE
// notice per requirement, never two contradictory ones. `label` is the
// short badge text; `detail` is the full explanation shown alongside it.
export interface VigenciaNotice {
  label: 'Expired' | 'Not current';
  detail: string;
}

export interface MatchScore {
  offerId: string;      // the offer this score belongs to
  technicianId: string; // the technician this score belongs to
  // 0–100 — ordering only, never the sole explanation. May be lower than
  // breakdown's own sum: an incomplete required aircraft set, a zero
  // habilitation score on a qualification-requiring offer, a profile-type
  // mismatch, or a hard blocker caps this value (see offerMatchExplain.ts).
  // breakdown itself is never capped — compare sum(breakdown) to total to
  // detect whether (and how much) a cap applied.
  total: number;
  label: MatchLabel;
  // Sub-fase de experiencia (2026-07-28): `experience` ya no está aquí. Los
  // años de experiencia no puntúan — informan y filtran (filtro duro
  // server-side por offer.minYearsExperience). "La cualificación puntúa, la
  // experiencia informa."
  breakdown: {
    verified: number;
    habilitation: number;
    license: number;
    // Renombrada desde `availability` (2026-07-29): esta fila NUNCA midió
    // disponibilidad, mide coincidencia de TIPO DE CONTRATO. La disponibilidad
    // real es binaria y va como filtro/etiqueta, no como puntos. Conjunto
    // vacío de contract_types = abierto a cualquiera = puntúa completo.
    contractFit: number;
    location: number;
    /**
     * El eje de motores (Fase 10). Sólo puede ser distinto de 0 en una oferta
     * de motor, y allí `habilitation` y `license` valen siempre 0: son ejes
     * excluyentes, no acumulables.
     *
     * Nunca vale 0 en una oferta de motor, ni siquiera sin motores
     * declarados: el escalón más bajo de la escalera puntúa poco pero no
     * cero, y de eso depende que el tope de cero cualificación no caiga
     * sobre todo el mundo.
     */
    engine: number;
  };
  level: MatchLevel;
  matches: string[];          // human-readable confirmed matches
  clarifications: string[];   // human-readable points that need confirming
  vigenciaNotices: VigenciaNotice[]; // expired / not-current — informational, never excludes (see VigenciaNotice)
  /**
   * Ajustes finales de Fase 10: la credencial que responde por la oferta es de
   * OTRA autoridad que la oferta acepta ("Also accept licences from:"), y por
   * eso la licencia y sus ratings puntúan recortados (87 en vez de 100). Sin
   * esta línea el recorte no lo explicaba nada en pantalla.
   *
   * Ausente cuando la autoridad es la exacta o cuando la credencial no llega a
   * puntuar: no hay recorte que explicar.
   */
  authorityEquivalence?: string;
  // Requisitos que la oferta declara y el perfil no cumple. DOS fuentes
  // (Fase 6 tanda D): una aeronave no cumplida en T1 cuando la oferta exige
  // TODAS (requiresAllAircraft), y la licencia de la oferta que el técnico no
  // tiene. Antes se llamaba mandatoryMissing, cuando la primera fuente era
  // una etiqueta por fila.
  missingRequirements: string[];
  // A strong but non-excluding ranking signal. `true` means the offer's
  // requested profile type is absent from the technician's declared types.
  // It applies PROFILE_TYPE_MISMATCH_CAP, remains selectable, and must never
  // be presented as "Not eligible".
  profileTypeMismatch: boolean;
  // Hard disqualifiers — English, human-readable, one entry per broken rule.
  //
  // blockers ≠ missingRequirements, and the distinction is deliberate:
  //   - missingRequirements is a QUALIFICATION requirement that was not met
  //     exactly. The pair is still a legitimate one to look at — a B1.1
  //     technician with the A320 V2500 rating against an offer asking for
  //     the CFM56 is a real, plausible candidate a recruiter may well want
  //     to call. It caps the score (INCOMPLETE_AIRCRAFT_SET_CAP) and is
  //     surfaced,
  //     never hidden.
  //   - blockers means "this pair does not meet a hard requirement" (for
  //     example, less declared experience than the offer's stated minimum).
  //     No amount of profile quality makes it eligible, so it is capped lower
  //     (BLOCKER_CAP) and the UI must not present it as a bare percentage.
  //
  // Empty array = nothing disqualifies the pair. It is never used to remove
  // a result from a list here — the scorer only ever explains and ranks;
  // whether a blocked pair is hidden is a UI/repository decision.
  blockers: string[];
}

export type MatchLabel = 'Excellent match' | 'Strong match' | 'Partial match' | 'Weak match';

// Shown instead of a MatchLabel for an offer aimed at non-licensed trades
// (sheet metal, paint, composite). Those offers have no Part-66 requirement
// to satisfy — by rule, not by omission — so the score comes entirely from
// verification, contract fit and location. Calling that a "match" in the
// technical sense the rest of the product uses would overclaim: nothing
// about the technician's qualification was confirmed, because there was
// nothing to confirm.
//
// Declared HERE, next to MatchLabel, rather than in the util that applies
// it: the type below needs it, and a domain label with a type that depends
// on it should have exactly one definition. Never retype the string — import
// the constant (there are 7 display sites).
export const GENERAL_COMPATIBILITY_LABEL = 'General compatibility';

// Everything a score can legitimately be CALLED on screen. Deliberately a
// closed union rather than `string`: this type is what stops a typo in a
// seventh screen from compiling (it briefly was `string`, and did).
export type MatchDisplayLabel = MatchLabel | typeof GENERAL_COMPATIBILITY_LABEL;

/**
 * Un técnico candidato a una oferta, en las DOS formas que necesita el
 * envoltorio oferta→técnicos (Fase 10, paso 5a): la completa, que es lo que
 * puntúa el scorer, y la vista protegida de empresa (con identidad sólo si
 * ya está desbloqueada). Salen de la MISMA fila de `technician_public_view` y
 * del mismo lote de relaciones, así que no pueden describir técnicos distintos.
 */
export interface TechnicianMatchCandidate {
  technician: TechnicianWithRelations;
  preview: TechnicianView;
}
