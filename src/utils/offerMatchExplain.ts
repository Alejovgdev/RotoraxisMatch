// Pure, offer+technician matching logic — no Supabase/repository imports so
// it can be unit-tested without a database connection (see
// scripts/testMatching.ts).
//
// Core rule (fixes the false-combination bug): a category (license) and an
// aircraft/rating are only ever considered "matched together" when they come
// from the SAME technician_habilitations row. Holding a license and having
// some unrelated habilitation never counts as holding that license for that
// aircraft. See docs/archive/PART66_AIRCRAFT_MODEL_ANALYSIS.md section 6 for the
// original bug report.
//
// Business principle (see CLAUDE.md "Backend / data model notes"): a
// technician who holds exactly what an offer requires must score clearly
// above one who does not, regardless of how good the rest of their profile
// looks — a missing required qualification is a legal blocker, not a minor
// preference gap. Four mechanisms enforce this, applied after the raw
// breakdown is summed:
//   - an offer that requires ALL its listed aircraft (requiresAllAircraft)
//     with any of them unmet at T1 caps the total at
//     INCOMPLETE_AIRCRAFT_SET_CAP (stays in the "Partial" label range at
//     most);
//   - a qualification-requiring offer where the technician scores zero on the
//     axis THE OFFER ASKED FOR (the aircraft when it names one, the license
//     when it names only that — Fase 9) caps the total further, at
//     ZERO_QUALIFICATION_CAP (stays "Weak" — verified/availability/location
//     alone can never manufacture a "Partial" result out of zero real
//     qualification).
//   - a different declared profile type is a strong but SOFT mismatch: it
//     caps the score at PROFILE_TYPE_MISMATCH_CAP while keeping the offer
//     selectable and the percentage visible;
//   - a hard disqualifier (currently fewer declared years than the offer's
//     minimum) caps it at BLOCKER_CAP and is surfaced separately from soft
//     mismatches. See the ceiling ladder below.
//
// ratingIndex: the caller loads the aircraft_type_ratings catalog (via
// catalogRepository/useAircraftTypeRatingsCatalog) and builds the index with
// buildAircraftRatingIndex() BEFORE calling this function — matching never
// queries Supabase directly. An id missing from the index (e.g. a pending
// catalog request, never a real catalog row) simply resolves to no match,
// never a crash.
import { Offer, OfferRequiredHabilitation, OfferWithRequirements } from '../types/offer';
import { AuthorityLicenseCode, EngineCatalog } from '../types/catalog';
import { TechnicianHabilitation, TechnicianLicense, TechnicianWithRelations } from '../types/technician';
import {
  MatchScore,
  MatchLabel,
  MatchLevel,
  MatchDisplayLabel,
  VigenciaNotice,
  GENERAL_COMPATIBILITY_LABEL,
} from '../types/matching';
import { ENGINE_TECHNICIAN_TYPE_CODE, TECHNICIAN_TYPES } from '../constants/technicianTypes';
import { AircraftRatingIndex, areRatingsRelated, getAircraftTypeRatingLabel } from '../constants/aircraftTypeRatings';
import { EngineIndex, getEngineLabel } from '../constants/engines';
import {
  LicenseSatisfaction,
  authorityLicenseCanExpire,
  isB1LicenseCode,
  licenseSatisfiesRequirement,
} from '../constants/licenses';
import { localDateToIso } from './dateField';
import { offerAircraftAreExperience } from './offerShape';

// ── EL BLOQUE DE CUALIFICACIÓN VALE SIEMPRE 65 ───────────────────────────
//
// Cuatro tablas, un solo principio: los 65 puntos de cualificación se reparten
// entre LOS EJES QUE LA OFERTA NOMBRE, y un eje que la oferta no ha pedido no
// descuenta nada.
//
//   la oferta nombra…    tabla                       65 repartidos así
//   licencia + aeronave  QUALIFICATION_WEIGHTS       45 habilitación + 20 licencia
//   FAA + aeronave       LICENSE_WITH_EXPERIENCE_WEIGHTS 40 licencia + 25 experiencia
//   sólo aeronave        NO_CERTIFICATION_WEIGHTS    65 habilitación
//   sólo licencia        LICENSE_ONLY_WEIGHTS        65 licencia
//   nada                 NO_REQUIREMENTS_WEIGHTS     no hay bloque → la escala baja a 75
//
// Las tres primeras topan en 100, y eso es lo que mantiene MONÓTONA la
// escalera de exigencia: cumplir todo lo que una oferta pide vale 100, pida
// mucho o pida poco. El técnico ve las ofertas en una lista con su porcentaje
// al lado, así que un techo estructural distinto por rama se leería como
// "encajo peor aquí" cuando lo único que cambia es la escala.
//
// El 75 de la cuarta es EL ÚNICO DESCENSO LEGÍTIMO de la escalera, y lo es
// porque allí no hay nada que confirmar: sin requisitos, ninguna señal dice
// que este técnico encaje en ESTA oferta, así que la calidad del perfil por sí
// sola nunca debe alcanzar "Excellent" (>=80).
//
// Cuando un eje sale del reparto, sus puntos van ÍNTEGROS al eje que la oferta
// SÍ nombra, nunca repartidos entre las señales sueltas (verificado, contrato,
// ubicación): ésas no son cualificación, y reforzarlas dejaría que un perfil
// genérico compensara justo lo que la oferta exige. Precedente doble — la
// retirada de `experience` (2026-07-28) y la Fase 6 tanda E.

// Licencia Y aeronave: el bloque se parte, y no a partes iguales — tener el
// rating de la aeronave es la señal fuerte, tener la categoría a secas la
// débil.
//
// ── Sub-fase de experiencia (2026-07-28) ──────────────────────────────
// El componente `experience` YA NO EXISTE. Principio de producto fijado por
// el usuario: **la cualificación puntúa, la experiencia informa y filtra**.
// Los años de experiencia son un dato visual y un FILTRO DURO server-side
// (offer.minYearsExperience contra technician_profiles.years_experience),
// nunca puntos.
//
// Los 10 puntos que liberaba van ÍNTEGROS a habilitación (35 → 45), no
// repartidos con licencia: el bloque de cualificación queda en 65 de
// cualquier forma, pero repartir habría reforzado la señal DÉBIL (tener la
// licencia sin el rating). Concentrarlos afila justo la discriminación que
// esta misión persigue.
const QUALIFICATION_WEIGHTS = { verified: 15, habilitation: 45, license: 20, contractFit: 15, location: 5, engine: 0 } as const;

// Fase 6 tanda E — ofertas que NO exigen certificar ("ayudante para el A320,
// sin licencia"). No hay licencia que puntuar (el CHECK de la 053 la fuerza a
// NULL), así que sus 20 puntos van ÍNTEGROS a habilitación: sin licencia, la
// AERONAVE es toda la cualificación que la oferta pide, y se lleva el bloque
// entero.
const NO_CERTIFICATION_WEIGHTS = { verified: 15, habilitation: 65, license: 0, contractFit: 15, location: 5, engine: 0 } as const;

// Fase 9 — el caso espejo del anterior, y el que faltaba: la oferta exige
// licencia pero NO nombra ninguna aeronave ("necesito un B1.1; la flota ya la
// verás"). Los 45 de habilitación van ÍNTEGROS a licencia, por el mismo motivo
// escrito en la tanda E — si la oferta sólo nombra una licencia, la licencia es
// toda la cualificación que pide.
//
// Antes de esta tabla la rama caía en QUALIFICATION_WEIGHTS y resolvía la fila
// de habilitación por el tier ancho (0,29 → 13 de 45): descontaba 32 puntos por
// una aeronave que la oferta nunca pidió. El candidato perfecto sacaba 68 y
// quedaba POR DEBAJO del 75 de una oferta que no pide nada — la escalera dejaba
// de ser monótona justo donde el técnico la lee, en su lista de ofertas.
const LICENSE_ONLY_WEIGHTS = { verified: 15, habilitation: 0, license: 65, contractFit: 15, location: 5, engine: 0 } as const;

// Fase 10, sesión 2 — licencia FAA + aeronaves. La FAA no emite type ratings,
// así que la aeronave no es certificación sino EXPERIENCIA declarada: puntúa y
// no excluye. El reparto es el de QUALIFICATION_WEIGHTS al revés, y por lo
// mismo que allí: la señal fuerte se lleva la mayor parte. Aquí la única
// certificación es la licencia (40); la aeronave (25, en la fila
// `habilitation`) sube la nota sin decidir quién puede firmar.
//
// 40/25 y no 45/20: con la licencia y sin la aeronave el total es 75, el mismo
// techo que una oferta sin requisitos, y por el mismo motivo — nada confirma
// que haya trabajado en ESTA flota, así que no debe leerse "Excellent" (>=80).
// Con 45/20 quedaría exactamente en 80.
const LICENSE_WITH_EXPERIENCE_WEIGHTS = { verified: 15, habilitation: 25, license: 40, contractFit: 15, location: 5, engine: 0 } as const;

// habilitation/license are always 0 here (never awarded, never penalized —
// see the no-requirements branch below) — kept as explicit fields rather
// than omitted so `weights` stays a single consistent shape instead of a
// union, which is both simpler to read and avoids TypeScript narrowing
// gymnastics at every access site.
//
// Suma 75, NO 100, y es deliberado: es el techo de la rama sin requisitos.
// Los 15 que liberaba `experience` se reparten DENTRO de ese techo
// (25/25/10 → 30/30/15), así que el máximo de esta rama no cambia.
const NO_REQUIREMENTS_WEIGHTS = { verified: 30, habilitation: 0, license: 0, contractFit: 30, location: 15, engine: 0 } as const;

// Fase 10 — LA QUINTA TABLA: la oferta de motor.
//
// Suma 100, como las tres que piden cualificación, y por el mismo motivo:
// una oferta de motor PIDE algo comprobable, así que cumplirlo del todo vale
// 100. Antes de esta tabla caía en NO_REQUIREMENTS_WEIGHTS —techo 75— y
// encima anunciaba "no requiere licencia ni aeronave" en una oferta que sí
// pide algo; el candidato perfecto se quedaba por debajo de una oferta que no
// pide nada, que es justo la no-monotonía que la Fase 9 arregló en la rama de
// sólo licencia.
//
// El reparto es el de NO_CERTIFICATION_WEIGHTS con `engine` en el sitio de
// `habilitation`, y eso no es una analogía suelta: una oferta de motor tampoco
// exige papel, así que el eje que pide se lleva el bloque entero de
// cualificación (65). Ni escala nueva ni pesos inventados.
//
// `habilitation` y `license` son 0 AQUÍ Y SIEMPRE en esta tabla: sin licencia
// pedida, la licencia no suma en una oferta de motor (un B2 con el CFM56 no
// supera a un técnico sin licencia con el mismo CFM56), y las habilitaciones
// sólo entran como FUENTE del motor implícito, nunca como puntos propios. La
// oferta de motor que sí pide licencia usa la tabla siguiente.
const ENGINE_WEIGHTS = { verified: 15, habilitation: 0, license: 0, contractFit: 15, location: 5, engine: 65 } as const;

// Fase 10, sesión 2 — la oferta de motor que ADEMÁS pide licencia (opcional:
// Part-66 B1.x o FAA P / A&P). El bloque de 65 se parte como en
// QUALIFICATION_WEIGHTS —45 para lo concreto, 20 para la licencia— con el
// motor en el sitio de la aeronave, así que el motor sigue siendo el eje que
// más pesa.
//
// La licencia PUNTÚA Y NO TOPA: el eje que topa a 39 sigue siendo el motor. Con
// este reparto el motor exacto sin licencia (80) queda por encima de la
// licencia con un motor sin relación (69 como mucho, mismo tipo de motor), que
// es el orden que se pidió: saber del motor vale más que el papel.
const ENGINE_WITH_LICENSE_WEIGHTS = { verified: 15, habilitation: 0, license: 20, contractFit: 15, location: 5, engine: 45 } as const;

export interface MatchScoreWeights {
  verified: number;
  habilitation: number;
  license: number;
  contractFit: number;
  location: number;
  /** Fase 10: sólo distinto de 0 en ENGINE_WEIGHTS. */
  engine: number;
}

// Which weight set applies to a given offer, and therefore what each
// breakdown component's maximum actually is right now. Exported so UI that
// renders score.breakdown (e.g. the technician-match cards on the offer
// detail screen) can show real denominators instead of hardcoding them —
// hardcoded maximums silently drift out of sync whenever these weights
// change here.
export function getMatchScoreWeights(offer: OfferWithRequirements): MatchScoreWeights {
  // Fase 6 tanda D: `licenseCode != null` sustituye a
  // `requiredLicenses.length > 0`. Es la razón por la que la columna quedó
  // NULLABLE con un CHECK atado a `requiresCertification` (migración 053): si
  // fuera NOT NULL, TODA oferta tendría licencia, NO_REQUIREMENTS_WEIGHTS no
  // se aplicaría nunca y las ofertas sin certificar saltarían de la escala de
  // 75 a la de 100 — cambiar el scorer por la puerta de atrás.
  //
  // Fase 6 tanda E: tres ramas, no dos. Una oferta que no certifica PERO
  // nombra aeronaves sí tiene cualificación que pedir — sólo que no de papel.
  //
  // Fase 9: cuatro. La que faltaba es la simétrica de la anterior — exige
  // licencia y no nombra aeronave.
  // Fase 10: PRIMERA rama, antes que ninguna otra. Una oferta de motor no
  // tiene aeronaves (y hasta la sesión 2 tampoco licencia), así que las
  // preguntas de abajo responderían sobre algo que la oferta no pide.
  // Sesión 2: con licencia (opcional) el motor cede 20 a la licencia.
  if (offer.offerKind === 'engine') return offer.licenseCode != null ? ENGINE_WITH_LICENSE_WEIGHTS : ENGINE_WEIGHTS;
  if (!offerAsksForQualification(offer)) return NO_REQUIREMENTS_WEIGHTS;
  if (!offer.requiresCertification) return NO_CERTIFICATION_WEIGHTS;
  // `licenseCode != null` no es redundante con requiresCertification: el CHECK
  // de la 053 ata la licencia a la exigencia en la dirección que importa, pero
  // el scorer nunca da por hecho lo que la base garantiza. Sin licencia y con
  // aeronaves, la evaluación cae igualmente en el evaluador de conocimiento
  // (ver `evaluate` más abajo), así que esa combinación se queda donde estaba.
  if (offer.licenseCode != null && offer.requiredHabilitations.length === 0) return LICENSE_ONLY_WEIGHTS;
  // Sesión 2: licencia FAA con aeronaves — la aeronave es experiencia.
  if (aircraftEvidenceFor(offer) === 'experience') return LICENSE_WITH_EXPERIENCE_WEIGHTS;
  return QUALIFICATION_WEIGHTS;
}

/**
 * ¿Contra qué evidencia se comparan las aeronaves de esta oferta? (Sesión 2)
 *
 *   'rating'     certifica bajo una autoridad con type ratings (Part-66): las
 *                habilitaciones de LA credencial elegida, misma fila.
 *   'experience' certifica bajo una autoridad sin type ratings (FAA): sólo la
 *                experiencia de aeronave declarada. Puntúa, no excluye.
 *   'knowledge'  no certifica: habilitaciones y experiencia, en unión (tanda E).
 *
 * Una sola función para las cuatro preguntas que dependen de esto: qué tabla de
 * pesos, qué evaluador, qué etiqueta ("B1.1 + A320" o "737") y qué eje topa.
 */
type AircraftEvidence = 'rating' | 'experience' | 'knowledge';

function aircraftEvidenceFor(
  offer: Pick<OfferWithRequirements, 'requiresCertification' | 'licenseCode' | 'licenseAuthority'>,
): AircraftEvidence {
  if (!offer.requiresCertification || !offer.licenseCode) return 'knowledge';
  return offerAircraftAreExperience(offer) ? 'experience' : 'rating';
}

// ¿La oferta pide ALGO comprobable sobre la cualificación? Una licencia, una
// aeronave, o las dos. Si no pide nada, no hay nada que confirmar ni que
// penalizar y se cae en NO_REQUIREMENTS_WEIGHTS.
// Fase 10: el motor es cualificación. No es una licencia ni un type rating,
// pero es una afirmación comprobable sobre lo que el técnico sabe hacer, y
// contestar que no a esta pregunta era lo que mandaba la oferta de motor a la
// escala de 75 Y hacía que el tope de cero cualificación ni se planteara.
function offerAsksForQualification(
  offer: Pick<OfferWithRequirements, 'requiredHabilitations' | 'licenseCode' | 'offerKind'>,
): boolean {
  if (offer.offerKind === 'engine') return true;
  return offer.requiredHabilitations.length > 0 || offer.licenseCode != null;
}

// Within the habilitation budget: T1 (exact) gets the full amount; T2
// (same family, different engine) gets a smaller fraction — still real,
// still surfaced as a clarification, never silently equal to an exact
// match.
//
// Fase 5.3 (2026-07-28): T3 ('related_legacy' — a bare legacy
// aircraft_type_code resolving to the required family) is GONE with the
// pre-Part-66 aircraft_types catalog. It had exactly one input, that
// column, and migration 029 removes it; a habilitation now names an
// aircraft through the rating catalog or not at all.
const HABILITATION_TIER_FRACTIONS = { exact: 1, related_family: 0.57, not_met: 0 } as const;

// The license-category branch (evaluateLicenseCategoryMatch) keeps its own
// fraction: 0.29 when the technician holds a required license category and
// the offer never named a specific aircraft. Deliberately well below T2's
// 0.57 — holding a category confirms no aircraft experience whatsoever.
//
// Fase 5 (2026-08-04): this map used to carry a second entry,
// legacy_aircraft_confirmed (0.57), for an offer that required an aircraft
// FAMILY approximately. That requirement is gone with
// offer_required_aircraft_types, so the tier had no remaining input and was
// removed with it. 0.29 and BROAD_ONLY_CAP below are untouched.
const BROAD_TIER_FRACTIONS = { legacy_category_only: 0.29 } as const;

// Fase 3 — vigencia: a SLIGHT cut, applied on top of whichever tier fraction
// already applies, whenever the row that produced the winning match is
// expired or explicitly marked not current. Deliberately small — holding an
// expired-but-real qualification is not the same as not holding it (T1
// stays T1, missingRequirements is never triggered by this alone); it is a
// paperwork/renewal flag, not a disqualification.
const VIGENCIA_DEGRADATION_FRACTION = 0.1;

// Fase 10 — equivalencia de autoridad: el mismo recorte multiplicativo, sobre
// el mismo sitio, cuando la credencial que responde por la oferta viene de
// OTRA autoridad Part-66 que la empresa aceptó (sesión 2: la eligió en la lista
// "Also accept licences from:", migración 088; antes era una sola casilla).
//
// Multiplicador y NO un tier nuevo, a propósito: la equivalencia es
// ortogonal a lo bien que el técnico cubre la aeronave. Un tier mezclaría las
// dos cosas y obligaría a inventar la casilla "equivalente con la familia
// pero no el motor". Así, la escalera de aeronave sigue siendo la misma y la
// autoridad la escala entera.
//
// 0,2 y no 0,1: una licencia de otra autoridad es una diferencia de fondo
// —otro regulador, otro proceso de convalidación— y no un papel por renovar.
// Lo único que el número tiene que garantizar es el orden que fija el test:
// exacto > equivalente > no aceptado, sin que el equivalente caiga al tope de
// cero cualificación.
const EQUIVALENT_AUTHORITY_DEGRADATION_FRACTION = 0.2;

// Ladder of score ceilings, loosest to tightest — Fase 5.3 (2026-07-27),
// checkpoint-confirmed. Applied together via applyScoreCeilings() below,
// most-restrictive-wins by construction (sequential Math.min, order never
// matters): an exact match has no ceiling at all; anything else is capped
// at progressively lower labels the weaker the confirmed evidence is.
//
//   no ceiling      — exact (T1) match: a confirmed, same-row qualification.
//   BROAD_ONLY_CAP  — the requirement was only ever satisfied via the
//                     approximate broad license/aircraft filter
//                     (evaluateLegacyBroadMatch), never a confirmed exact
//                     rating — can never read as "Excellent" (>=80).
//   INCOMPLETE_AIRCRAFT_SET_CAP — la oferta declaró que hacen falta TODAS
//                     las aeronaves listadas (requiresAllAircraft) y alguna
//                     no se cumple en T1.
//                     Fase 6 tanda D: era MANDATORY_UNMET_CAP, disparado por
//                     una fila marcada `mandatory`. Mismo valor y misma
//                     posición en la escalera — lo único que cambia es de
//                     dónde sale el flag: de una etiqueta por fila que nadie
//                     entendía, a una decisión declarada de la oferta.
//   ZERO_QUALIFICATION_CAP — the offer asks for real qualification and the
//                     technician scored ZERO ON THE AXIS IT ASKED FOR —
//                     stricter than the two above, applies even for a
//                     preferred-only mismatch.
//                     Fase 9: qué eje es lo decide la oferta. Si nombra
//                     aeronave, la habilitación; si sólo nombra licencia, la
//                     licencia. Preguntar siempre por la habilitación tumbaba
//                     a TODA la rama de sólo-licencia, cuyo peso de
//                     habilitación es 0 por construcción.
//   PROFILE_TYPE_MISMATCH_CAP — the offer asks for a different trade than
//                     every type declared by the technician. This is a strong
//                     ranking penalty, NOT an eligibility blocker: the offer
//                     stays selectable and displays its low percentage.
//   BLOCKER_CAP     — a hard disqualifier applies (MatchScore.blockers), such
//                     as fewer declared years than the offer's stated
//                     minimum. A blocker is a different KIND of statement:
//                     this pair does not meet an explicit hard requirement.
// Fase 6 tanda E: AQUÍ VIVÍA `BROAD_ONLY_CAP = 79`, y se retira porque era
// INALCANZABLE — no por un cambio de criterio. El máximo bruto de la rama que
// lo alimentaba es 15 (verified) + round(45 × 0,29) = 13 + 20 (license) + 15
// (contractFit) + 5 (location) = 68, así que su `Math.min(total, 79)` nunca
// recortó nada en ninguna entrada posible. Retirarlo no mueve ni un score.
//
// La frase que se le atribuía —"sabes de la aeronave pero no lo has demostrado
// con papel"— no era suya: describe el tier `related_family` (0,57), que sí
// tiene esa semántica y sigue en pie.
//
// Si algún día sube `BROAD_TIER_FRACTIONS.legacy_category_only`, revisa si
// hace falta un techo para esa rama; hoy no lo hay porque no puede pasar de 68.
const INCOMPLETE_AIRCRAFT_SET_CAP = 59;
const ZERO_QUALIFICATION_CAP = 39;
const PROFILE_TYPE_MISMATCH_CAP = 19;
const BLOCKER_CAP = 19;

// Single place the whole ceiling ladder is combined — see the comment
// above for what each one means and why "most restrictive wins" needs no
// special-casing (Math.min chains regardless of which flags are true, or
// how many). Exported for direct testing of the combination itself,
// independent of whether today's branch structure can produce every
// combination in practice (see scripts/testMatching.ts).
export function applyScoreCeilings(
  total: number,
  flags: {
    hasIncompleteAircraftSet: boolean;
    isZeroQualification: boolean;
    hasProfileTypeMismatch: boolean;
    hasBlocker: boolean;
  },
): number {
  let capped = total;
  if (flags.hasIncompleteAircraftSet) capped = Math.min(capped, INCOMPLETE_AIRCRAFT_SET_CAP);
  if (flags.isZeroQualification) capped = Math.min(capped, ZERO_QUALIFICATION_CAP);
  if (flags.hasProfileTypeMismatch) capped = Math.min(capped, PROFILE_TYPE_MISMATCH_CAP);
  if (flags.hasBlocker) capped = Math.min(capped, BLOCKER_CAP);
  return capped;
}

// Profile-type explanations are read by a human (recruiter or technician),
// so they always name the type the way the rest of the product does — "Avionics
// Technician", never the raw `avionic` code. Falls back to the code only if
// a profile somehow carries a type absent from the catalog, which is a data
// problem to surface, never a reason to render nothing. `isActive` is
// deliberately not consulted: a type retired from the pickers must still
// label the rows already storing it.
function technicianTypeLabel(code: string): string {
  return TECHNICIAN_TYPES.find((t) => t.code === code)?.label ?? code;
}

type HabilitationTier = 'exact' | 'related_family' | 'not_met';

interface RequirementOutcome {
  tier: HabilitationTier;
  matchText?: string;
  clarificationText?: string;
  vigenciaDegraded?: boolean;
  vigenciaNotice?: VigenciaNotice;
  // Fase 6 tanda E: la cualificación EXISTE pero está caducada, en una oferta
  // que exige certificar. Se distingue de "no la tiene" porque el mensaje es
  // distinto y accionable — renovar, no formarse.
  expiredText?: string;
}

function toYearMonth(iso: string): string {
  return iso.slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'
}

/**
 * Fase 6 tanda E — la vigencia deja de ser un solo booleano.
 *
 * `expired` (licencia o rating con fecha pasada) y `not_current` (el técnico
 * ha marcado a mano que hace tiempo que no lo toca) degradaban IGUAL hasta
 * ahora, y no son lo mismo:
 *
 *  - Una caducidad es un hecho REGISTRAL con fecha. En una oferta que exige
 *    certificar, no autoriza a firmar: cuenta como no tener la cualificación.
 *  - `isCurrent = false` es una AUTODECLARACIÓN en un campo opcional.
 *    Excluir por ella castigaría al técnico por ser honesto, que es
 *    justamente lo que el resto del modelo evita.
 *
 * Sin certificación las tres siguen degradando sin excluir: para trabajar de
 * ayudante la vigencia del papel no decide nada.
 */
type VigenciaOutcome = { kind: 'ok' | 'expired' | 'not_current'; notice?: VigenciaNotice };

// Fase 3 — vigencia. Checked against whichever row actually produced the
// match (T1/T2), plus the technician's own TechnicianLicense row for the
// same category (licenses have no isCurrent — only issued/expiresAt).
//
// Precedence (fixed by design, not incidental): an expired date ALWAYS wins
// over isCurrent, even isCurrent === true explicitly — the default true
// never rescues a rating past its expiry date. isCurrent === false only
// matters when the date is absent or still in the future (the "declared
// not current ahead of expiry" case) — its own distinct message, never
// combined with an "expired" one for the same row.
//
// A license-level expiry subsumes the row-level check entirely: it affects
// every habilitation declared under that category, and if the row is ALSO
// individually expired/not-current that would be a second, redundant
// notice about the same underlying fact — so license expiry always wins
// and produces exactly one notice, never two.
/**
 * ¿Está caducada ESTA credencial? (Fase 10)
 *
 * Única implementación de la pregunta, y consulta la autoridad ANTES que la
 * fecha: el certificado de mecánico de la FAA (14 CFR 65.19) se emite sin
 * expiración y no se renueva, así que ninguna licencia FAA caduca — ni
 * siquiera una que, por un PATCH directo, llevara fecha escrita.
 *
 * Sin fecha = no caduca. Es el caso normal de la FAA y también el de una
 * Part-66 cuyo titular no la ha rellenado: la ausencia de dato no penaliza.
 */
function isLicenseExpired(license: TechnicianLicense | undefined, today: string): boolean {
  if (!license?.expiresAt) return false;
  if (!authorityLicenseCanExpire(license.authority)) return false;
  return license.expiresAt < today;
}

function evaluateVigencia(
  row: Pick<TechnicianHabilitation, 'expiresAt' | 'isCurrent'>,
  license: TechnicianLicense | undefined,
  licenseCode: string,
  ratingLabel: string,
  today: string,
): VigenciaOutcome {
  const licenseExpired = isLicenseExpired(license, today);
  if (licenseExpired) {
    return {
      kind: 'expired',
      notice: {
        label: 'Expired',
        detail: `License ${licenseCode} expired ${toYearMonth(license!.expiresAt!)} — all its ratings affected, including ${ratingLabel}.`,
      },
    };
  }

  const rowExpired = Boolean(row.expiresAt && row.expiresAt < today);
  if (rowExpired) {
    return {
      kind: 'expired',
      notice: { label: 'Expired', detail: `Rating expired ${toYearMonth(row.expiresAt!)}: ${ratingLabel}.` },
    };
  }

  if (row.isCurrent === false) {
    return {
      kind: 'not_current',
      notice: { label: 'Not current', detail: `Rating marked as not current: ${ratingLabel}.` },
    };
  }

  return { kind: 'ok' };
}

/** One credential supports the whole offer; aircraft from different licences
 * are never combined. Compare the actual complete-offer score (validity,
 * authority degradation and requiresAllAircraft ceilings included). This
 * makes adding a credential monotone: existing alternatives remain available.
 * Ties prefer effective coverage, a valid licence, exact authority, then expiry.
 */
interface SelectedLicense {
  license: TechnicianLicense;
  satisfaction: LicenseSatisfaction;
}

function selectLicenseForOffer(
  offer: OfferWithRequirements,
  technician: TechnicianWithRelations,
  ratingIndex: AircraftRatingIndex,
  today: string,
  scoreCandidate: (candidate: SelectedLicense) => MatchScore,
): (SelectedLicense & { score: MatchScore }) | undefined {
  const required = offer.licenseCode;
  if (!required) return undefined;
  // FAA A and P are ratings on one mechanic certificate. Two stored rows
  // represent A&P for matching; this projection is never persisted and never
  // joins Part-66 aircraft from separate credentials.
  const credentials = [...technician.licenses];
  const faaA = credentials.find((l) => l.authority === 'FAA' && l.licenseCode === 'A');
  const faaP = credentials.find((l) => l.authority === 'FAA' && l.licenseCode === 'P');
  if (faaA && faaP) credentials.push({ ...faaA, id: `faa-ap:${faaA.id}:${faaP.id}`, licenseCode: 'A&P' });
  const evidence = aircraftEvidenceFor(offer);
  const candidates = credentials.flatMap((license) => {
    const satisfaction = licenseSatisfiesRequirement(
      license, { authority: offer.licenseAuthority, licenseCode: required }, offer.acceptedAuthorities,
    );
    if (!satisfaction) return [];
    const candidate = { license, satisfaction };
    const quality = offer.requiredHabilitations.reduce((sum, req) => {
      const outcome = evaluateAircraftRequirement(evidence, req, required, license, technician, ratingIndex, today);
      return sum + HABILITATION_TIER_FRACTIONS[outcome.tier] *
        (outcome.vigenciaDegraded ? 1 - VIGENCIA_DEGRADATION_FRACTION : 1);
    }, 0);
    return [{ ...candidate, score: scoreCandidate(candidate), quality,
      expired: isLicenseExpired(license, today), exact: satisfaction === 'exact',
      expiresAt: authorityLicenseCanExpire(license.authority) ? license.expiresAt ?? '9999-12-31' : '9999-12-31',
    }];
  });
  return candidates.sort((a, b) => {
    if (a.score.total !== b.score.total) return b.score.total - a.score.total;
    if (a.quality !== b.quality) return b.quality - a.quality;
    if (a.expired !== b.expired) return a.expired ? 1 : -1;
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (a.expiresAt !== b.expiresAt) return a.expiresAt < b.expiresAt ? 1 : -1;
    return a.license.id.localeCompare(b.license.id);
  })[0];
}

// ¿Cuelgan de ESTA credencial? Por id, nunca por código (Fase 10, paso 3).
//
// El paso 3 tenía aquí una red para filas con `technicianLicenseId` nulo. Se
// retira en el paso 4: la columna es NOT NULL con FK desde la 074, así que esa
// fila no existe, y la red sólo podía acertar por código — que es justamente
// lo que deja de identificar una credencial en cuanto hay dos autoridades.
// Una red que no puede distinguir las dos B1.1 no es una red, es el bug.
function habilitationsOfLicense(
  technician: TechnicianWithRelations,
  license: TechnicianLicense | undefined,
): TechnicianHabilitation[] {
  if (!license) return [];
  return technician.habilitations.filter((h) => h.technicianLicenseId === license.id);
}

// El tier de UNA aeronave sobre las filas de UNA credencial, sin mirar fechas.
//
// Separado de evaluateHabilitationRequirement porque lo necesitan dos
// preguntas distintas: qué nota saca el requisito (allí, con vigencia y
// textos) y la comparación de cobertura efectiva entre credenciales.
// Duplicar el emparejamiento en los dos sitios habría sido la forma de que la
// elección y la puntuación acabaran discrepando.
function bestHabilitationTier(
  rows: TechnicianHabilitation[],
  requiredRatingId: string,
  ratingIndex: AircraftRatingIndex,
): { tier: HabilitationTier; row?: TechnicianHabilitation } {
  // T1 — exact: same license, same rating, in the same row.
  const exactRow = rows.find((h) => h.aircraftTypeRatingId === requiredRatingId);
  if (exactRow) return { tier: 'exact', row: exactRow };

  // T2 — related_family: same license, a different rating in the same
  // aircraft family (same manufacturer, overlapping family), different engine.
  const relatedRow = rows.find(
    (h): h is TechnicianHabilitation & { aircraftTypeRatingId: string } =>
      Boolean(h.aircraftTypeRatingId) &&
      areRatingsRelated(h.aircraftTypeRatingId as string, requiredRatingId, ratingIndex),
  );
  if (relatedRow) return { tier: 'related_family', row: relatedRow };

  return { tier: 'not_met' };
}

// Fase 6 tanda D: la licencia ya no viene en `req` — es de la OFERTA, y se
// pasa aparte. El emparejamiento sigue siendo exactamente igual de estricto:
// se cruza contra las filas del técnico que tienen ESA licencia, nunca
// combinando un chequeo de licencia con otro de aeronave por separado.
function evaluateHabilitationRequirement(
  req: Pick<OfferRequiredHabilitation, 'aircraftTypeRatingId'>,
  offerLicenseCode: AuthorityLicenseCode,
  license: TechnicianLicense | undefined,
  technician: TechnicianWithRelations,
  ratingIndex: AircraftRatingIndex,
  today: string,
): RequirementOutcome {
  const reqLabel = getAircraftTypeRatingLabel(req.aircraftTypeRatingId, ratingIndex);
  // Fase 10, paso 4: la credencial LLEGA ELEGIDA. Antes se elegía aquí dentro,
  // una vez por aeronave, y con dos licencias del mismo código eso permitía que
  // cada requisito escogiera la que le convenía — ver selectLicenseForOffer.
  const sameLicenseRows = habilitationsOfLicense(technician, license);
  const best = bestHabilitationTier(sameLicenseRows, req.aircraftTypeRatingId, ratingIndex);

  // T1 — exact: same license, same rating, in the same row. Deliberately
  // does not look at experienceYears — optional, informational only, never
  // a penalty (a rating endorsed with no declared experience is still a
  // full, legally valid match). isCurrent/expiresAt DO matter — see
  // evaluateVigencia — but only degrade the match slightly, never exclude
  // it: this stays tier 'exact' either way.
  //
  // TODO(open regulatory question, see mission brief): EASA AMC 66.A.45
  // may record some B2 endorsements without an engine designation. Not
  // special-cased here — would affect this tier and T2 below, and the
  // category pre-filter planned for a later phase.
  if (best.tier === 'exact') {
    const vigencia = evaluateVigencia(best.row!, license, offerLicenseCode, reqLabel, today);
    // Fase 6 tanda E: una CADUCIDAD (licencia o rating) en una oferta que
    // exige certificar no es una degradación, es una descalificación —
    // legalmente no puede firmar ese trabajo. Cae a 'not_met', que arrastra
    // la habilitación a 0 y con ella el ZERO_QUALIFICATION_CAP (39).
    // `isCurrent = false` sigue degradando y nunca excluye.
    if (vigencia.kind === 'expired') {
      return { tier: 'not_met', expiredText: `${offerLicenseCode} + ${reqLabel}`, vigenciaNotice: vigencia.notice };
    }
    return {
      tier: 'exact',
      matchText: `${offerLicenseCode} + ${reqLabel}`,
      vigenciaDegraded: vigencia.kind === 'not_current',
      vigenciaNotice: vigencia.notice,
    };
  }

  // T2 — related_family: same license, a different rating in the same
  // aircraft family (same manufacturer, overlapping family), different
  // engine.
  if (best.tier === 'related_family') {
    const heldLabel = getAircraftTypeRatingLabel(best.row!.aircraftTypeRatingId as string, ratingIndex);
    const vigencia = evaluateVigencia(best.row!, license, offerLicenseCode, heldLabel, today);
    if (vigencia.kind === 'expired') {
      return { tier: 'not_met', expiredText: `${offerLicenseCode} + ${heldLabel}`, vigenciaNotice: vigencia.notice };
    }
    return {
      tier: 'related_family',
      clarificationText: `Same family, different engine: ${reqLabel} vs ${heldLabel}.`,
      vigenciaDegraded: vigencia.kind === 'not_current',
      vigenciaNotice: vigencia.notice,
    };
  }

  // T3 used to sit here: a bare legacy aircraft_type_code resolving to the
  // required family, scored at 0.29 of the habilitation budget. Removed in
  // Fase 5.3 (2026-07-28) together with the pre-Part-66 aircraft_types
  // catalog — its only possible input was that column, which migration 029
  // drops. Nothing replaces it: a habilitation row either resolves to a
  // catalog rating (T1/T2) or contributes no aircraft evidence at all.
  //
  // Fase 6 tanda E: la rama SIN certificación no pasa por aquí — tiene su
  // propio evaluador (evaluateAircraftKnowledgeRequirement), porque su
  // pregunta es otra: no "¿puede firmar esto?" sino "¿ha trabajado en esto?".
  //
  // NOTE for anyone reading the original Fase 5 plan: its step 3 said "T3
  // stays, only for needsReview habilitations, labeled". That step is VOID
  // — a needsReview row had a NULL rating id AND (after 029) no code, so
  // there would be nothing left for T3 to match on. The needs_review column
  // goes with it. See docs/MISSION_PART66.md.

  // T3 — not_met (was T4 before the old T3 was removed above).
  return { tier: 'not_met' };
}

/**
 * Fase 6 tanda E — el evaluador de las ofertas que NO exigen certificar.
 *
 * Pregunta distinta, evidencia distinta: aquí no importa quién puede FIRMAR el
 * trabajo sino quién SABE HACERLO, así que cuentan las dos tablas.
 *
 * ── La regla "la licencia cuenta también como experiencia, nunca al revés" ──
 * Se aplica como UNIÓN DE CONJUNTOS sobre `aircraftTypeRatingId`, calculada
 * aquí en lectura y NUNCA persistida: las dos tablas apuntan al mismo catálogo
 * de ratings, así que una habilitación en el A320 ya demuestra experiencia en
 * el A320 sin copiar ninguna fila. Al revés no vale, y por eso este evaluador
 * no lo usa la rama que certifica.
 *
 * La licencia de la habilitación NO se mira: para trabajar de ayudante en un
 * A320 da igual bajo qué categoría lo tocaste. Eso no rompe la invariante de
 * misma fila — la invariante impide combinar "tiene B1.1" con "tiene A320"
 * para concluir "tiene B1.1 EN A320", una afirmación sobre certificación. Aquí
 * no se afirma nada sobre certificación: sólo que estuvo en ese avión.
 */
//
// Sesión 2 — `sources.habilitations`: la oferta FAA con aeronaves pregunta lo
// mismo ("¿ha trabajado en esto?") pero SÓLO a la experiencia declarada. Es el
// mismo evaluador con una fuente menos, no una copia: false quita las
// habilitaciones de las dos búsquedas (exacta y de familia) y nada más.
function evaluateAircraftKnowledgeRequirement(
  req: Pick<OfferRequiredHabilitation, 'aircraftTypeRatingId'>,
  technician: TechnicianWithRelations,
  ratingIndex: AircraftRatingIndex,
  today: string,
  sources: { habilitations: boolean },
): RequirementOutcome {
  const reqLabel = getAircraftTypeRatingLabel(req.aircraftTypeRatingId, ratingIndex);
  const habilitations = sources.habilitations ? technician.habilitations : [];

  // T1 — la aeronave pedida está en la unión. Se busca PRIMERO en las
  // habilitaciones para poder arrastrar su vigencia (la experiencia declarada
  // no tiene fechas que degradar).
  const exactHab = habilitations.find((h) => h.aircraftTypeRatingId === req.aircraftTypeRatingId);
  if (exactHab) {
    // Por el id de la credencial de la que cuelga la habilitación: es la
    // única que puede caducarla. Buscarla por código elegía la primera del
    // array, que con dos autoridades puede ser otra distinta.
    const license = technician.licenses.find((l) => l.id === exactHab.technicianLicenseId);
    const vigencia = evaluateVigencia(exactHab, license, exactHab.licenseCode, reqLabel, today);
    // Sin certificación una caducidad NO excluye: degrada, como siempre. Para
    // trabajar de ayudante el papel vencido no borra la experiencia.
    return {
      tier: 'exact',
      matchText: `Worked on ${reqLabel}`,
      vigenciaDegraded: vigencia.kind !== 'ok',
      vigenciaNotice: vigencia.notice,
    };
  }

  const exactExperience = technician.aircraftExperience.find((e) => e.aircraftTypeRatingId === req.aircraftTypeRatingId);
  if (exactExperience) {
    return {
      tier: 'exact',
      matchText:
        exactExperience.years != null
          ? `Worked on ${reqLabel} — ${exactExperience.years} years declared`
          : `Worked on ${reqLabel}`,
    };
  }

  // T2 — misma familia, otro motor. Misma fracción (0,57) y mismo significado
  // que en la rama que certifica: evidencia real, nunca igual a la exacta.
  const relatedIds = [
    ...habilitations.map((h) => h.aircraftTypeRatingId),
    ...technician.aircraftExperience.map((e) => e.aircraftTypeRatingId),
  ].filter((id): id is string => Boolean(id));
  const relatedId = relatedIds.find((id) => areRatingsRelated(id, req.aircraftTypeRatingId, ratingIndex));
  if (relatedId) {
    return {
      tier: 'related_family',
      clarificationText: `Same family, different engine: ${reqLabel} vs ${getAircraftTypeRatingLabel(relatedId, ratingIndex)}.`,
    };
  }

  return { tier: 'not_met' };
}

// El evaluador de UNA aeronave según la evidencia que la oferta admite (ver
// aircraftEvidenceFor). Lo usan la elección de credencial y la puntuación: si
// cada una eligiera su evaluador, podrían discrepar sobre la misma aeronave.
function evaluateAircraftRequirement(
  evidence: AircraftEvidence,
  req: Pick<OfferRequiredHabilitation, 'aircraftTypeRatingId'>,
  offerLicenseCode: AuthorityLicenseCode | undefined,
  license: TechnicianLicense | undefined,
  technician: TechnicianWithRelations,
  ratingIndex: AircraftRatingIndex,
  today: string,
): RequirementOutcome {
  if (evidence === 'rating' && offerLicenseCode) {
    return evaluateHabilitationRequirement(req, offerLicenseCode, license, technician, ratingIndex, today);
  }
  return evaluateAircraftKnowledgeRequirement(req, technician, ratingIndex, today, { habilitations: evidence !== 'experience' });
}

// The fallback branch, used only when an offer states NO exact
// category+rating requirement. Two outcomes:
//   - 'legacy_category_only': the technician holds one of the license
//     categories the offer asks for. Nothing here confirms they have ANY
//     relevant aircraft experience, only the category — so it scores at
//     0.29 (BROAD_TIER_FRACTIONS) and carries its own clarification.
//   - 'not_met': no evidence at all.
interface BroadOutcome {
  tier: 'legacy_category_only' | 'not_met';
  matchText?: string;
  clarificationText?: string;
  /**
   * Fase 10, paso 3: la licencia EXISTE pero está caducada. Se distingue de
   * "no la tiene" porque el mensaje es otro y es accionable — renovar, no
   * formarse — igual que ya hacía la rama con aeronave (tanda E).
   */
  expiredText?: string;
  vigenciaNotice?: VigenciaNotice;
}

// Fase 5 (2026-08-04) — this was evaluateLegacyBroadMatch, and it evaluated
// TWO independent offer-side sets: required licenses and required aircraft
// FAMILIES (offer_required_aircraft_types, the approximate filter). Its two
// aircraft-bearing branches — "license + aircraft satisfied by the SAME
// technician_habilitations row" and "aircraft only" — both scored
// 'legacy_aircraft_confirmed' at 0.57.
//
// With the approximate filter retired, an offer can no longer express an
// aircraft requirement approximately: aircraft is stated exactly, as a
// license+rating pair in requiredHabilitations, which is evaluated by
// evaluateHabilitationRequirement above and never reaches this function.
// Both branches lost their only input and went with it, along with the
// ratingIndex parameter they needed. What remains is purely a license-
// category check, hence the name.
//
// The same-row rule the deleted branch enforced is NOT lost — it lives on
// where it actually matters, in the exact path (see the "same row" contract
// in evaluateHabilitationRequirement and CLAUDE.md). Nothing here combines
// an independent license check with an independent aircraft check, because
// there is no aircraft check left to combine.
// Fase 6 tanda D: `offer.requiredLicenses` (array) pasó a `offer.licenseCode`
// (una sola, y ausente exactamente cuando la oferta no exige certificar).
// Esta rama pasa de residual a NORMAL: "exijo B1.1, me da igual la aeronave"
// es justo lo que la tanda hace fácil de expresar.
function evaluateLicenseCategoryMatch(
  offer: Pick<OfferWithRequirements, 'licenseCode'>,
  license: TechnicianLicense | undefined,
  today: string,
): BroadOutcome {
  const required = offer.licenseCode;
  if (!required) return { tier: 'not_met' };

  // La credencial LLEGA ELEGIDA (Fase 10, paso 4). Aquí ya no se busca nada:
  // quien decide cuál responde por la oferta —código, autoridad, equivalencias
  // y el A&P de la FAA— es selectLicenseForOffer, y tiene que ser la misma
  // decisión que en la rama con aeronave.

  // Fase 10, paso 3 — LA CADUCIDAD TAMBIÉN CUENTA AQUÍ.
  //
  // Esta rama no la miraba: una B1.1 vencida puntuaba 100 en una oferta que
  // sólo pedía la B1.1, mientras la MISMA licencia vencida en una oferta que
  // nombra aeronave caía al tope de 39 (tanda E). El criterio es el mismo en
  // los dos sitios y no depende de que la oferta liste aviones: con la
  // licencia vencida no se puede firmar el trabajo.
  if (isLicenseExpired(license, today)) {
    return {
      tier: 'not_met',
      expiredText: `${required}`,
      vigenciaNotice: {
        label: 'Expired',
        detail: `License ${required} expired ${toYearMonth(license!.expiresAt!)}.`,
      },
    };
  }

  // Sin red por código. La que había —"o alguna habilitación declara este
  // código"— cubría filas sin licencia, que desde la 074 no pueden existir, y
  // con dos autoridades habría contestado que sí a una oferta EASA por una
  // habilitación colgada de una UK CAA.
  return license
    ? {
        tier: 'legacy_category_only',
        matchText: 'Required license category present in profile',
        clarificationText: 'Category-only match — no specific aircraft requirement to verify.',
      }
    : { tier: 'not_met' };
}

/**
 * La licencia como EJE PROPIO (sesión 2): cuenta o no cuenta, y si no, por qué.
 *
 * La rama de sólo licencia ya lo hacía en línea; la oferta FAA con aeronaves
 * necesita exactamente lo mismo —allí la licencia es el requisito y la aeronave
 * sólo informa—, así que sale aquí en vez de copiarse. La variante que no
 * cuenta lleva el texto y la que cuenta no: no hay "por qué" que leer de una
 * licencia que sí está.
 */
type LicenseAxis =
  | { held: true; matchText?: string; clarificationText?: string }
  | { held: false; missingText: string; vigenciaNotice?: VigenciaNotice };

function evaluateLicenseAxis(
  offer: Pick<OfferWithRequirements, 'licenseCode'>,
  license: TechnicianLicense | undefined,
  today: string,
): LicenseAxis {
  const broad = evaluateLicenseCategoryMatch(offer, license, today);
  if (broad.tier !== 'not_met') {
    return { held: true, matchText: broad.matchText, clarificationText: broad.clarificationText };
  }
  // Vencida: qué caducó, no qué falta — mismo formato que la rama con aeronave.
  // Ausente: la segunda fuente de missingRequirements, que no depende de
  // mandatory/preferred sino de que la oferta pida una licencia que no tiene.
  return {
    held: false,
    missingText: broad.expiredText ? `${broad.expiredText} — expired` : `Required license: ${offer.licenseCode}`,
    vigenciaNotice: broad.vigenciaNotice,
  };
}

const TIER_RANK: Record<HabilitationTier, number> = { not_met: 0, related_family: 1, exact: 2 };

function upgradeTier(current: HabilitationTier, next: HabilitationTier): HabilitationTier {
  return TIER_RANK[next] > TIER_RANK[current] ? next : current;
}

// A match score is always computed for a specific offer + technician pair.
// Never store this value on a technician_profile row.
//
// now: injectable "current time" for the vigencia (expired/not-current)
// check — defaults to the real clock. Tests pass a fixed Date so expired-
// vs-future fixtures are deterministic regardless of when they run (same
// dependency-injection style as aircraftTypeRatingsCache.ts).
//
// engineIndex: el catálogo de motores ya cargado, igual que ratingIndex. Vacío
// por defecto para no obligar a los llamadores de ofertas de aeronave —que son
// todos hoy— a cargar un catálogo que no van a mirar. En una oferta de motor
// sin él, el escalón exacto sigue funcionando (compara ids) y los de familia y
// tipo no pueden resolverse: bajo, nunca inventado.
export function calculateOfferTechnicianMatch(
  offer: OfferWithRequirements,
  technician: TechnicianWithRelations,
  ratingIndex: AircraftRatingIndex,
  now: Date = new Date(),
  engineIndex: EngineIndex = new Map(),
): MatchScore {
  const selected = selectLicenseForOffer(offer, technician, ratingIndex, localDateToIso(now),
    (candidate) => scoreWithSelectedLicense(offer, technician, ratingIndex, now, engineIndex, candidate));
  return selected?.score ?? scoreWithSelectedLicense(offer, technician, ratingIndex, now, engineIndex, undefined);
}

function scoreWithSelectedLicense(
  offer: OfferWithRequirements,
  technician: TechnicianWithRelations,
  ratingIndex: AircraftRatingIndex,
  now: Date,
  engineIndex: EngineIndex,
  selectedLicense: SelectedLicense | undefined,
): MatchScore {
  const hasQualificationRequirements = offerAsksForQualification(offer);
  const weights = getMatchScoreWeights(offer);
  const today = localDateToIso(now);

  let verified = 0;
  let habilitation = 0;
  let license = 0;
  let contractFit = 0;
  let location = 0;
  let engine = 0;

  const matches: string[] = [];
  const clarifications: string[] = [];
  const vigenciaNotices: VigenciaNotice[] = [];
  const missingRequirements: string[] = [];
  const blockers: string[] = [];
  let profileTypeMismatch = false;
  let level: MatchLevel = 'not_met';

  if (technician.verificationStatus === 'verified') {
    verified = weights.verified;
    matches.push('Verified profile');
  }

  const offerLicenseCode = offer.licenseCode;

  // The same selected credential supplies every certification requirement.

  // El recorte por equivalencia de autoridad. Multiplica a los DOS ejes de
  // papel (habilitación y licencia) porque los dos salen de la misma
  // credencial: si la que responde es de otra autoridad, lo es para todo lo
  // que sostiene, no sólo para la línea de licencia.
  const equivalenceFraction =
    selectedLicense?.satisfaction === 'equivalent' ? 1 - EQUIVALENT_AUTHORITY_DEGRADATION_FRACTION : 1;

  if (offer.offerKind === 'engine') {
    // ── Oferta de motor ────────────────────────────────────────────────
    // Sin aeronaves: el motor es el eje, con el bloque de cualificación entero
    // (ENGINE_WEIGHTS) o, si la oferta pide licencia, con 45 de 65
    // (ENGINE_WITH_LICENSE_WEIGHTS). `habilitation` se queda en 0 siempre, y
    // `license` también cuando la oferta no pide licencia: por eso un B2 con el
    // motor pedido no supera a un técnico sin licencia con el mismo motor.
    const outcome = evaluateEngineRequirement(offer.requiredEngineId, technician, ratingIndex, engineIndex);
    engine = Math.round(weights.engine * ENGINE_TIER_FRACTIONS[outcome.tier]);
    level = ENGINE_TIER_LEVEL[outcome.tier];
    if (outcome.matchText) matches.push(outcome.matchText);
    if (outcome.clarificationText) clarifications.push(outcome.clarificationText);
    // Sin missingRequirements: no tener el motor pedido baja la nota, no es un
    // requisito incumplido que nombrar. La oferta pide un motor y el eje
    // siempre contesta algo — incluso "ninguno", que puntúa poco pero cuenta.

    // Sesión 2 — la licencia opcional. Se evalúa como en la rama de sólo
    // licencia (misma función, caducidad y equivalencias incluidas), pero su
    // ausencia va a clarifications y NO a missingRequirements: allí dispararía
    // INCOMPLETE_AIRCRAFT_SET_CAP (59) y la licencia topa, cuando aquí sólo
    // puntúa. Tampoco toca el nivel, que es el del motor.
    if (offer.licenseCode) {
      const axis = evaluateLicenseAxis(offer, selectedLicense?.license, today);
      if (axis.held) {
        license = Math.round(weights.license * equivalenceFraction);
        if (axis.matchText) matches.push(axis.matchText);
      } else {
        clarifications.push(
          axis.vigenciaNotice
            ? `${offer.licenseCode} expired. On an engine offer the licence adds to the score; it never excludes.`
            : `The offer also asks for ${offer.licenseCode}; not present in the profile. On an engine offer the licence adds to the score; it never excludes.`,
        );
        if (axis.vigenciaNotice) vigenciaNotices.push(axis.vigenciaNotice);
      }
    }
  } else if (offer.requiredHabilitations.length > 0) {
    // Fase 6 tanda E — LA FUENTE DE EVIDENCIA LA ELIGE LA OFERTA.
    //
    //   requiresCertification = true  -> sólo technician_habilitations, y sólo
    //     las de LA licencia de la oferta. La experiencia declarada no puntúa
    //     por mucha que sea: es un requisito legal, no una preferencia. Quien
    //     no puede firmar no sirve para el puesto, sepa lo que sepa.
    //
    //   requiresCertification = false -> habilitaciones Y experiencia
    //     declarada, en unión. La pregunta es si sabe hacer el trabajo.
    //
    // Es el interruptor que la tanda C dejó montado sin conectar.
    //
    // Sesión 2 — tercera fuente: certificando bajo la FAA, que no emite type
    // ratings, sólo la experiencia declarada (aircraftEvidenceFor).
    const evidence = aircraftEvidenceFor(offer);
    const evaluate = (req: OfferRequiredHabilitation) =>
      evaluateAircraftRequirement(evidence, req, offerLicenseCode, selectedLicense?.license, technician, ratingIndex, today);

    //
    // Evaluated once up front (not inline in the loop below) so the
    // vigencia degradation can be scoped correctly: only the row(s) that
    // actually produced the WINNING tier should shave points off the
    // score, even though every degraded row's notice is still surfaced —
    // same "always show, only the best one scores" pattern T2
    // clarifications already follow.
    const evaluations = offer.requiredHabilitations.map((req) => ({ req, outcome: evaluate(req) }));

    let bestTier: HabilitationTier = 'not_met';
    for (const { outcome } of evaluations) {
      bestTier = upgradeTier(bestTier, outcome.tier);
    }
    const vigenciaDegraded = evaluations.some(({ outcome }) => outcome.tier === bestTier && outcome.vigenciaDegraded);

    // Fase 6 tanda D: `everyMandatoryExact` (por fila) pasa a
    // `everyAircraftExact` (por oferta). El cálculo es el mismo — "¿está
    // TODO cumplido en T1?" — pero ahora sólo importa cuando la oferta ha
    // declarado que hacen falta todas las aeronaves.
    let everyAircraftExact = true;

    for (const { req, outcome } of evaluations) {
      if (outcome.tier === 'exact' && outcome.matchText) matches.push(outcome.matchText);
      if (outcome.tier === 'related_family' && outcome.clarificationText) {
        clarifications.push(outcome.clarificationText);
      }
      if (outcome.vigenciaNotice) vigenciaNotices.push(outcome.vigenciaNotice);

      // La etiqueta lleva la licencia SÓLO cuando la aeronave cuelga de ella:
      // en una oferta de ayudante, "B1.1 + A320" prometería una certificación
      // que nadie ha pedido ni comprobado, y "A&P + 737" un type rating que la
      // FAA no emite.
      const ratingLabel = getAircraftTypeRatingLabel(req.aircraftTypeRatingId, ratingIndex);
      const aircraftLabel = evidence === 'rating' ? `${offerLicenseCode} + ${ratingLabel}` : ratingLabel;

      // Fase 6 tanda E: una cualificación CADUCADA en oferta que certifica
      // llega aquí como 'not_met' con su propio texto. Se nombra siempre —
      // aunque la oferta no exija todas las aeronaves — porque no es "te
      // falta esto", es "lo tienes pero vencido", y eso es accionable.
      if (outcome.expiredText) missingRequirements.push(`${outcome.expiredText} — expired`);

      if (outcome.tier !== 'exact') {
        // Cualquier cosa por debajo de T1 significa que esta aeronave no
        // está cumplida exactamente. Una coincidencia degradada por vigencia
        // SIGUE siendo tier 'exact' — degradar nunca degrada a "no cumplida".
        everyAircraftExact = false;
        if (offer.requiresAllAircraft) {
          // La oferta dijo que hacen falta TODAS: esto es lo que dispara el
          // cap y hay que nombrarlo.
          missingRequirements.push(aircraftLabel);
        } else if (outcome.tier === 'not_met') {
          // Basta con una: no cumplir ésta no es un fallo, es información.
          clarifications.push(`The offer also lists ${aircraftLabel}; not present in the profile`);
        }
      }
    }

    // Con una sola licencia por oferta, "¿tiene la licencia?" es UNA pregunta,
    // no una por fila: antes era `licenseHeldForAll`, que recorría requisitos
    // que en la práctica repetían siempre el mismo código.
    //
    // Fase 6 tanda E: en una oferta que no certifica, `weights.license` es 0
    // (NO_CERTIFICATION_WEIGHTS), así que este cálculo no puede sumar nada
    // aunque el técnico tenga licencias. No hace falta condicionarlo: los 20
    // puntos ya están en habilitación.
    // Fase 10: "¿tiene la licencia?" es "¿hay credencial elegida?", ni más ni
    // menos. Antes se comparaba el código a mano contra las licencias Y contra
    // las habilitaciones, y eso ignoraba la autoridad: una B1.1 UK CAA cobraba
    // los 20 puntos de una oferta EASA sin equivalencias. La pregunta la
    // contesta selectLicenseForOffer, que sí mira código, autoridad, autoridades
    // aceptadas y el A&P de la FAA.
    const licenseHeld = selectedLicense != null;

    // `everyAircraftExact` sólo degrada el nivel cuando la oferta EXIGE todas
    // las aeronaves. Con "basta con una", cubrir una de tres es un match
    // exacto y punto — que es exactamente lo que hacía el modelo anterior:
    // `everyMandatoryExact` sólo lo ponían a false las filas `mandatory`, así
    // que una lista toda `preferred` lo dejaba en true. Sin esta condición,
    // "basta con una" degradaría a 'related' un match que sí es exacto.
    const requiredSetSatisfied = !offer.requiresAllAircraft || everyAircraftExact;
    level = bestTier === 'exact' && requiredSetSatisfied ? 'exact' : bestTier !== 'not_met' ? 'related' : 'not_met';
    const vigenciaFraction = vigenciaDegraded ? 1 - VIGENCIA_DEGRADATION_FRACTION : 1;
    // La equivalencia de autoridad recorta la aeronave sólo cuando la aeronave
    // sale de la credencial ('rating'). Como experiencia (FAA, o sin certificar)
    // no depende de ninguna licencia.
    const aircraftEquivalenceFraction = evidence === 'rating' ? equivalenceFraction : 1;
    habilitation = Math.round(
      weights.habilitation * HABILITATION_TIER_FRACTIONS[bestTier] * vigenciaFraction * aircraftEquivalenceFraction,
    );
    if (evidence === 'experience') {
      // Sesión 2 — FAA con aeronaves: la licencia es el requisito y la aeronave
      // informa. La licencia se evalúa como en la rama de sólo licencia (misma
      // función, caducidad incluida) y su ausencia se nombra. Con la licencia y
      // sin la aeronave el nivel es el de categoría, no 'not_met'.
      const axis = evaluateLicenseAxis(offer, selectedLicense?.license, today);
      if (axis.held) {
        license = Math.round(weights.license * equivalenceFraction);
        if (axis.matchText) matches.push(axis.matchText);
        if (level === 'not_met') level = 'legacy';
      } else {
        // Sin la licencia no hay match, por mucha experiencia que tenga: el
        // nivel no puede decir "exacto" de quien no puede firmar el trabajo.
        license = 0;
        level = 'not_met';
        missingRequirements.push(axis.missingText);
        if (axis.vigenciaNotice) vigenciaNotices.push(axis.vigenciaNotice);
      }
    } else {
      license = licenseHeld ? Math.round(weights.license * equivalenceFraction) : 0;
    }
  } else if (hasQualificationRequirements) {
    // No aircraft named — the offer only states its license category, so
    // fall back to the category check.
    const axis = evaluateLicenseAxis(offer, selectedLicense?.license, today);
    if (axis.held) {
      level = 'legacy';
      if (axis.matchText) matches.push(axis.matchText);
      if (axis.clarificationText) clarifications.push(axis.clarificationText);
      // Fase 9: con LICENSE_ONLY_WEIGHTS el peso de habilitación es 0, así que
      // esta fila sale 0 — que es lo correcto y lo que arregla la fase: la
      // oferta no nombró ninguna aeronave, luego no hay eje de aeronave que
      // puntuar NI que descontar. La fracción 0,29 sobrevive porque describe
      // una evidencia real ("tiene la categoría, nada confirma la aeronave") y
      // volvería a aplicarse si alguna rama futura vuelve a puntuar la
      // aeronave aquí; hoy multiplica a cero.
      habilitation = Math.round(weights.habilitation * BROAD_TIER_FRACTIONS.legacy_category_only);
      license = Math.round(weights.license * equivalenceFraction);
    } else {
      level = 'not_met';
      habilitation = 0;
      license = 0;
      // Vencida o ausente: el texto lo decide evaluateLicenseAxis, el mismo
      // para esta rama y para la FAA con aeronaves.
      missingRequirements.push(axis.missingText);
      if (axis.vigenciaNotice) vigenciaNotices.push(axis.vigenciaNotice);
    }
  } else {
    // The offer specifies no qualification requirement at all — habilitation
    // and license simply never enter the score (not awarded, not
    // penalized). weights here is NO_REQUIREMENTS_WEIGHTS, so the other
    // four components already sum to at most 75.
    level = 'legacy';
    matches.push('The offer does not require a specific license or aircraft');
  }

  // ── Contract fit (antes, mal llamada "Availability") ─────────────────
  // Esta fila NUNCA midió disponibilidad: mide si el técnico acepta el TIPO
  // DE CONTRATO de la oferta. El nombre viejo mentía, y encima la
  // disponibilidad real (immediately) no entra en el score en absoluto — es
  // filtro y etiqueta, no puntos: un estado binario no debe mover un ranking.
  //
  // REGLA DEL CONJUNTO VACÍO: no declarar tipos de contrato significa
  // "abierto a cualquiera", así que puntúa COMPLETO. Sólo saca cero quien SÍ
  // declaró y ninguno coincide. Sin esto, renombrar la fila la habría hecho
  // honesta pero habría dejado 15 puntos inalcanzables para quien no rellena
  // un campo OPCIONAL — exactamente lo que se decidió no hacer con los años
  // de experiencia ("la ausencia de dato nunca penaliza").
  const techContractTypes = technician.availability.contractTypes as string[];
  const openToAnyContract = techContractTypes.length === 0;
  if (openToAnyContract || techContractTypes.includes(offer.contractType)) {
    contractFit = weights.contractFit;
  }

  // offer.minYearsExperience SIGUE sin puntuar y sin entrar en breakdown —
  // "la cualificación puntúa, la experiencia informa" no cambia. Lo que sí
  // hace ahora es descalificar: ver la sección de blockers más abajo.

  // ── Localización: SÓLO EL PAÍS (Fase 7 tanda F2c) ────────────────────
  //
  // Mismo país, los puntos enteros. Distinto país, cero. No hay grados.
  //
  // Antes se puntuaba por aeropuerto, o por código de aeropuerto, o por
  // nombre de ciudad — tres formas de acertar sobre un catálogo de 255
  // aeropuertos que decidía por accidente qué países existían. La ciudad ya
  // NO puntúa: ni la elegida del directorio ni la escrita a mano. Informa y
  // coloca el pin del mapa, nada más.
  //
  // Consecuencia asumida, y es la correcta si el criterio es el país: un
  // técnico de Alicante y otro de Bilbao puntúan IGUAL para una oferta en
  // Madrid. Puntuar la ciudad exigiría decidir cuánto vale cada kilómetro, y
  // eso es una pregunta que este producto no responde — hay ofertas donde
  // mudarse es normal y otras donde 40 km ya son demasiado.
  //
  // Comparación exacta sobre el código ISO, sin normalizar: las dos columnas
  // son NOT NULL con FK a `location_countries`, así que ya vienen en
  // mayúsculas y validadas por Postgres. Normalizar aquí sugeriría que puede
  // llegar texto libre, y no puede.
  if (technician.locationCountryCode === offer.locationCountryCode) {
    location = weights.location;
  }

  // ── Profile type: strong SOFT mismatch ────────────────────────────────
  // A matching type awards no points. A different type applies a low ceiling
  // so generic signals such as verification, contract fit and country cannot
  // manufacture a plausible-looking match for another trade. It deliberately
  // does NOT add a blocker: cross-trade offers remain selectable and the UI
  // keeps showing the resulting percentage.
  //
  // A technician can declare several types (Fase 6 tanda A), so this is a
  // membership check: matching ANY declared type is sufficient. The offer
  // always declares exactly one type (`offers.technician_type` is NOT NULL).
  // Fase 10 — NO SE APLICA EN OFERTAS DE MOTOR, y no es una excepción de
  // conveniencia: `offers.technician_type` es NOT NULL, así que TODA oferta
  // nombra un oficio, incluidas las de motor, donde ese campo no describe nada
  // que la oferta pida. Con el techo puesto, un mecánico con el CFM56 exacto
  // caía a 19 frente a una oferta cuyo único requisito ya cumplía. Aquí el
  // oficio se calla igual que se calla la habilitación: ni suma ni topa. La
  // columna se queda como está — cambiarla a NULL era mover el esquema para
  // arreglar un problema del scorer.
  if (offer.offerKind === 'engine') {
    // Nada: ni línea de match, ni aclaración, ni techo.
  } else if (technician.technicianTypes.includes(offer.technicianType)) {
    matches.push(`Technician type: ${technicianTypeLabel(offer.technicianType)}`);
  } else {
    const profileIs = technician.technicianTypes.map(technicianTypeLabel).join(', ');
    profileTypeMismatch = true;
    clarifications.push(
      `Profile type differs — the offer is for ${technicianTypeLabel(offer.technicianType)}; this profile declares ${profileIs || 'no type'}.`,
    );
  }

  // ── Hard blockers ────────────────────────────────────────────────────
  // These live HERE, in the pure function, rather than in either
  // matchingV2.ts wrapper: both matching directions and all direct screen
  // callers must produce the same result. A blocker caps the total; it never
  // awards or subtracts component points.

  // Minimum declared experience. `yearsExperience` absent (undefined/NULL)
  // is NOT a blocker — deliberate product rule, the same one the server-side
  // prefilter encodes as `years_experience.is.null OR >= N` (see
  // applyMinYearsFilter in technicianRepositoryV2): the ABSENCE OF DATA NEVER
  // PENALIZES. Only a value the technician actually declared, below the
  // offer's stated minimum, disqualifies. `!= null` rather than a typeof
  // check so a NULL that survives a mapper is treated as "not declared"
  // instead of comparing as 0 and blocking everyone who left the field empty.
  const declaredYears = technician.yearsExperience;
  if (offer.minYearsExperience > 0 && declaredYears != null && declaredYears < offer.minYearsExperience) {
    blockers.push(
      `The offer requires at least ${offer.minYearsExperience} years of experience; this profile declares ${declaredYears}.`,
    );
  }

  const rawTotal = verified + habilitation + license + contractFit + location + engine;

  // Every score ceiling is applied in one place — see applyScoreCeilings()
  // and the ladder documented above it. Most restrictive always wins,
  // however many apply at once.
  // Fase 9 — `isZeroQualification` pregunta por EL EJE QUE LA OFERTA PIDE, no
  // por habilitación siempre. Con LICENSE_ONLY_WEIGHTS el peso de habilitación
  // es 0, así que un `habilitation === 0` pelado se cumpliría SIEMPRE en esa
  // rama y el tope de 39 caería sobre todo el mundo — incluido el candidato
  // perfecto, que pasaría de 68 a 39 y empeoraría justo el problema que la
  // fase arregla. La regla que el tope defiende no cambia ni un ápice: en una
  // oferta que nombra aeronave, tener la licencia sin el rating sigue topado
  // en ZERO_QUALIFICATION_CAP.
  //
  // Fase 10 — tercera rama: en una oferta de motor el eje que la oferta pide es
  // el motor. Preguntar por la habilitación o por la licencia allí daba SIEMPRE
  // cero (sus pesos son 0 por construcción) y tumbaba al candidato perfecto al
  // tope de 39. Como el escalón más bajo del eje puntúa 3 y no 0, esta rama no
  // se cumple nunca hoy — y está escrita igualmente, porque el tope defiende
  // una regla ("cero en lo que la oferta pidió no puede leerse como Partial"),
  // no un número, y bajar NO_ENGINE a cero no debe abrir el agujero en
  // silencio.
  //
  // Sesión 2 — en una oferta FAA con aeronaves el eje pedido es la LICENCIA: la
  // aeronave es experiencia, puntúa y no excluye. Preguntar por la habilitación
  // topaba a 39 al titular del A&P que no ha declarado el 737.
  const zeroOnRequestedAxis =
    offer.offerKind === 'engine'
      ? engine === 0
      : offer.requiredHabilitations.length > 0 && aircraftEvidenceFor(offer) !== 'experience'
        ? habilitation === 0
        : license === 0;

  const total = applyScoreCeilings(rawTotal, {
    hasIncompleteAircraftSet: missingRequirements.length > 0,
    isZeroQualification: hasQualificationRequirements && zeroOnRequestedAxis,
    hasProfileTypeMismatch: profileTypeMismatch,
    hasBlocker: blockers.length > 0,
  });

  return {
    offerId: offer.id,
    technicianId: technician.id,
    total,
    label: getMatchLabel(total),
    breakdown: { verified, habilitation, license, contractFit, location, engine },
    level,
    matches,
    clarifications,
    vigenciaNotices,
    missingRequirements,
    profileTypeMismatch,
    blockers,
  };
}

export function getMatchLabel(total: number): MatchLabel {
  if (total >= 80) return 'Excellent match';
  if (total >= 60) return 'Strong match';
  if (total >= 40) return 'Partial match';
  return 'Weak match';
}

// PRESENTATION ONLY — the scoring is untouched. An offer with no
// qualification requirement already falls into NO_REQUIREMENTS_WEIGHTS on its
// own (topping out at 75, never "Excellent"); this only decides what the
// resulting number is CALLED on screen. See GENERAL_COMPATIBILITY_LABEL in
// types/matching.ts for why non-licensed offers get their own wording.
//
// Fase 6 tanda C: lo decide el interruptor que la empresa marca, no el TIPO
// de perfil buscado. Antes se deducía con offerTargetsLicensedProfiles() y
// eso arrastraba el problema de fondo de toda la fase — que la etiqueta del
// puesto gobernara si hacía falta licencia.
export function getMatchDisplayLabel(
  offer: Pick<Offer, 'requiresCertification'>,
  score: Pick<MatchScore, 'label'>,
): MatchDisplayLabel {
  return offer.requiresCertification ? score.label : GENERAL_COMPATIBILITY_LABEL;
}

// PRESENTACIÓN — el texto de un par que el filtro saca (paso 5b). Un solo sitio
// para el copy, por la misma razón que GENERAL_COMPATIBILITY_LABEL: lo pintan
// varias pantallas y cada copia escrita a mano diría una cosa distinta.
export function ineligibilityReasonText(reason: IneligibilityReason): string {
  switch (reason) {
    case 'no_engine_experience':
      return 'This engine offer is for technicians with engine experience: a declared engine, a B1 type rating on this engine or its family, or the Engine Technician trade.';
    case 'licensed_technician':
      return 'This offer is only for technicians without a licence.';
  }
}

// ══════════════════════════════════════════════════════════════════════
// EL EJE DE MOTORES (Fase 10)
//
// Una oferta de motor no pide aeronaves: pide UN MOTOR (y, desde la sesión 2,
// opcionalmente una licencia que puntúa sin topar). Hasta esta
// fase el scorer no sabía que ese eje existía, y las tres consecuencias
// hundían al candidato bueno — caía en la escala de 75, se comía el tope de
// cero cualificación por no tener ni habilitación ni licencia, y el oficio le
// topaba a 19 si no coincidía. Las tres se arreglan aquí y en las tres ramas
// que llaman a esto, no con excepciones sueltas.
//
// LA ESCALERA, de más a menos evidencia:
//   declared_exact  el técnico DECLARÓ ese motor.
//   implicit_exact  ese motor cuelga de un type rating B1 que el técnico tiene.
//   same_family     mismo `engines.family` (CFM56-7B / CFM56-5B), declarado o
//                   por type rating B1.
//   same_type       mismo `engines.engine_type` (dos turbofanes cualesquiera).
//   other_type      tiene motores, ninguno se parece.
//   none            no ha declarado motores ni tiene ratings B1 con motor.
//
// `same_type` y `other_type` son los dos "motor sin relación" del paso 5b,
// partidos: un turbofán de otra familia se parece más a un CFM56 que un
// turboeje. Los dos quedan por debajo de la familia y por encima de `none`,
// que es el orden que fija el paso.
//
// CUATRO REGLAS QUE NO SON NEGOCIABLES:
//
//  1. El motor implícito sale de `AircraftTypeRatingCatalog.engineId` Y DE
//     NADA MÁS. `engineManufacturer` / `engineFamily` son texto EASA sucio
//     (`Corp 250` es el Model 250 mal partido, 12 filas llevan el modelo
//     escrito en el fabricante), y leerlos daría el motor equivocado con cara
//     de acierto.
//
//  1b. Y sólo de habilitaciones colgadas de una B1 (B1.1–B1.4), paso 5b. La B1
//     es la rama que certifica el motor; una B2 o una C en el 737NG no dicen
//     nada del CFM56-7B. Se lee `habilitation.licenseCode`, que es el código de
//     SU credencial por construcción: la FK compuesta
//     (technician_license_id, license_code) de la 074 no deja que difieran.
//     No es cruzar por código, es leer el de la fila a la que ya apunta.
//
//  2. Un rating enlazado a un motor GENÉRICO (`isGeneric`, migración 089: las
//     17 filas "<fabricante> (model not specified)" del seed de la 071) da
//     crédito de FAMILIA y nunca de motor exacto: una genérica no dice qué
//     motor es, sólo de quién. Se mira `isGeneric` y NUNCA `isActive`:
//     desactivar un modelo concreto lo quita de los selectores, no convierte
//     en familia el exacto de quien ya lo tiene.
//
//  3. `none` PUNTÚA, poco pero no cero. El eje arranca vacío para todos los
//     perfiles, así que un cero aquí sería castigar por un campo que nadie ha
//     tenido ocasión de rellenar — y además dispararía el tope de cero
//     cualificación sobre toda la lista. De ahí salen también los años: 1 año
//     y 20 valen lo mismo, porque "la cualificación puntúa, la experiencia
//     informa".
type EngineTier = 'declared_exact' | 'implicit_exact' | 'same_family' | 'same_type' | 'other_type' | 'none';

// Fracciones del presupuesto de motor (65), misma mecánica que
// HABILITATION_TIER_FRACTIONS: la escalera es multiplicativa sobre el peso, no
// una escala aparte.
const ENGINE_TIER_FRACTIONS: Record<EngineTier, number> = {
  declared_exact: 1,
  implicit_exact: 0.8,
  same_family: 0.55,
  same_type: 0.3,
  other_type: 0.12,
  none: 0.05,
};

// Qué `MatchLevel` cuenta cada escalón. Es el mismo reparto que en aeronave:
// el motor pedido es 'exact', algo del mismo aire es 'related', y lo demás no
// confirma nada.
const ENGINE_TIER_LEVEL: Record<EngineTier, MatchLevel> = {
  declared_exact: 'exact',
  implicit_exact: 'exact',
  same_family: 'related',
  same_type: 'related',
  other_type: 'not_met',
  none: 'not_met',
};

interface EngineOutcome {
  tier: EngineTier;
  matchText?: string;
  clarificationText?: string;
}

interface EngineEvidence {
  engineId: string;
  /** De dónde salió: declarado por el técnico, o implícito en un type rating B1. */
  source: 'declared' | 'implicit';
  /** El rating del que salió, cuando es implícito — sólo para el texto. */
  ratingId?: string;
  /** La licencia B1 de la que cuelga ese rating, cuando es implícito — sólo para el texto. */
  licenseCode?: string;
}

// Los motores que el perfil respalda, por las dos vías. NO se deduplica: el
// escalón se decide por el mejor hallazgo, y un motor que aparece dos veces no
// vale más que uno que aparece una. Los declarados van PRIMERO: a igualdad de
// motor, el declarado es el escalón más alto (ver matchEngineEvidence).
function collectEngineEvidence(
  technician: Pick<TechnicianWithRelations, 'engines' | 'habilitations'>,
  ratingIndex: AircraftRatingIndex,
): EngineEvidence[] {
  const evidence: EngineEvidence[] = technician.engines.map((e) => ({
    engineId: e.engineId,
    source: 'declared' as const,
  }));
  for (const hab of technician.habilitations) {
    if (!hab.aircraftTypeRatingId) continue;
    // Regla 1b de la cabecera: sólo la rama B1 dice algo del motor.
    if (!isB1LicenseCode(hab.licenseCode)) continue;
    const engineId = ratingIndex.get(hab.aircraftTypeRatingId)?.engineId;
    if (engineId) {
      evidence.push({ engineId, source: 'implicit', ratingId: hab.aircraftTypeRatingId, licenseCode: hab.licenseCode });
    }
  }
  return evidence;
}

/**
 * El escalón de un conjunto de evidencia frente al motor pedido. UNA sola
 * implementación para las dos preguntas que lo necesitan: cuánto puntúa el
 * técnico (evaluateEngineRequirement, con toda su evidencia) y si entra en la
 * oferta por la vía (b) de la elegibilidad (sólo con la implícita). Escribir
 * el emparejamiento dos veces es la forma de que la lista y la nota acaben
 * discrepando.
 */
function matchEngineEvidence(
  evidence: EngineEvidence[],
  requiredEngineId: string,
  engineIndex: EngineIndex,
): { tier: EngineTier; exact?: EngineEvidence; held?: EngineCatalog } {
  if (evidence.length === 0) return { tier: 'none' };

  // Exacto: por id, y sólo si la fila del motor NO es genérica. Una genérica
  // nunca puede ser el motor exacto de nadie (regla 2 de la cabecera); un
  // modelo concreto desactivado sí. Un id que no esté en el índice —catálogo a
  // medio cargar— cuenta: la igualdad de id es evidencia por sí sola, y
  // desconocer la fila no la desmiente.
  const exact = evidence.find(
    (ev) => ev.engineId === requiredEngineId && engineIndex.get(ev.engineId)?.isGeneric !== true,
  );
  if (exact) return { tier: exact.source === 'declared' ? 'declared_exact' : 'implicit_exact', exact };

  const required = engineIndex.get(requiredEngineId);
  if (required) {
    const held = evidence.map((ev) => engineIndex.get(ev.engineId)).filter((e): e is EngineCatalog => Boolean(e));
    const sameFamily = held.find((e) => e.family === required.family);
    if (sameFamily) return { tier: 'same_family', held: sameFamily };
    const sameType = held.find((e) => e.engineType === required.engineType);
    if (sameType) return { tier: 'same_type', held: sameType };
  }
  return { tier: 'other_type' };
}

function evaluateEngineRequirement(
  requiredEngineId: string | undefined,
  technician: Pick<TechnicianWithRelations, 'engines' | 'habilitations'>,
  ratingIndex: AircraftRatingIndex,
  engineIndex: EngineIndex,
): EngineOutcome {
  // Una oferta de motor sin motor es una fila que la base no acepta (CHECK de
  // la 076). Si llega, no se inventa una escalera: nadie confirma nada.
  if (!requiredEngineId) return { tier: 'none' };

  const match = matchEngineEvidence(collectEngineEvidence(technician, ratingIndex), requiredEngineId, engineIndex);
  const requiredLabel = getEngineLabel(requiredEngineId, engineIndex);

  switch (match.tier) {
    case 'none':
      return { tier: 'none' };
    case 'declared_exact':
      return { tier: 'declared_exact', matchText: `Engine: ${requiredLabel}` };
    case 'implicit_exact':
      return {
        tier: 'implicit_exact',
        matchText: `Engine: ${requiredLabel} — from the ${match.exact!.licenseCode} ${getAircraftTypeRatingLabel(match.exact!.ratingId as string, ratingIndex)} type rating`,
        clarificationText: `${requiredLabel} is not declared directly; it comes from a B1 type rating in the profile.`,
      };
    case 'same_family':
      return {
        tier: 'same_family',
        clarificationText: `Same engine family, different model: ${requiredLabel} vs ${match.held!.displayName}.`,
      };
    case 'same_type':
      return {
        tier: 'same_type',
        clarificationText: `Another ${match.held!.engineType}, different family: ${requiredLabel} vs ${match.held!.displayName}.`,
      };
    case 'other_type':
      return { tier: 'other_type', clarificationText: `No declared engine is related to ${requiredLabel}.` };
  }
}

/**
 * ⚠ LOS ÚNICOS FILTROS EXCLUYENTES DE TODA LA PLATAFORMA. Son dos, y viven
 * juntos aquí a propósito.
 *
 * Todo lo demás en este fichero ORDENA: un requisito incumplido baja el
 * porcentaje, lo explica y deja el par en la lista, porque quien decide a quién
 * llamar es una persona. Esto no: el técnico que no pasa NO APARECE. No sale
 * abajo con nota baja — no sale.
 *
 * Se aplican en LAS DOS DIRECCIONES (rankTechniciansForOffer y
 * rankOffersForTechnician, y por tanto los dos envoltorios de matchingV2). Un
 * filtro que excluye en una sola dirección es un filtro que se puede rodear
 * entrando por la otra pantalla. Por eso son UNA función y no dos: un tercer
 * filtro escrito aparte sería el que una de las dos direcciones olvide.
 *
 * ── 1. Oferta de motor: sólo quien tiene algo que ver con motores ────────
 * Elegible si cumple AL MENOS UNA (paso 5b, sustituye a la regla del 5a):
 *   (a) ha DECLARADO algún motor, sea cual sea su oficio;
 *   (b) tiene un type rating colgado de una B1 (B1.1–B1.4) cuyo motor es el de
 *       la oferta o de su familia — el 737NG de un B1 entra en una oferta de
 *       CFM56-7B sin haber declarado nada;
 *   (c) tiene 'engine_technician' entre sus oficios, aunque no declare motores.
 * Nadie más. Un type rating colgado sólo de B2, C u otra licencia no da
 * entrada: esas ramas no certifican el motor (regla 1b del eje de motores).
 *
 * Sin este filtro, una oferta de motor enseñaba a toda la plataforma: el eje
 * puntúa 3 a quien no tiene motores (ENGINE_TIER_FRACTIONS.none), así que
 * pintores y aviónicos sin motor alguno llenaban la lista con un "Weak".
 *
 * Es elegibilidad, NO puntuación: quien pasa puntúa con la escalera normal. La
 * vía (b) pregunta al MISMO emparejador que la puntuación (matchEngineEvidence)
 * y exige de él lo mismo que la escalera llama exacto o familia, así que entrar
 * por (b) y puntuar ese escalón no pueden discrepar. Por eso necesita los dos
 * catálogos: sin `engineIndex` la familia no se resuelve y la vía (b) sólo
 * reconoce el motor exacto.
 *
 * ── 2. "Sólo técnicos sin licencia" ─────────────────────────────────────
 * Existe porque hay un caso real que ninguna puntuación resuelve: un taller de
 * motores que busca mano de obra sin licencia no quiere ordenar a los
 * licenciados los últimos, quiere no verlos. Ordenarlos los dejaría en la
 * lista, y la lista es el producto.
 *
 * "Licenciado" es tener alguna credencial DECLARADA, caducada o no: una B2
 * vencida sigue describiendo a un técnico licenciado, que es lo que el filtro
 * mira. No se consulta el OFICIO —un mecánico sin licencias es un perfil
 * perfectamente válido para estas ofertas— ni ningún otro campo.
 */
export function isTechnicianEligibleForOffer(
  offer: Pick<Offer, 'onlyUnlicensed' | 'offerKind' | 'requiredEngineId'>,
  technician: Pick<TechnicianWithRelations, 'licenses' | 'engines' | 'technicianTypes' | 'habilitations'>,
  ratingIndex: AircraftRatingIndex,
  engineIndex: EngineIndex,
): boolean {
  return technicianIneligibilityReason(offer, technician, ratingIndex, engineIndex) === null;
}

/** Por qué un par no pasa el filtro. La pantalla lo traduce a texto (ineligibilityReasonText). */
export type IneligibilityReason = 'no_engine_experience' | 'licensed_technician';

/**
 * Lo mismo que isTechnicianEligibleForOffer, diciendo CUÁL de los dos filtros
 * falla. Es la implementación; la booleana la envuelve. Las pantallas que
 * muestran un par concreto (una candidatura, una oferta directa) necesitan el
 * motivo: el par existe y hay que explicar por qué no lleva porcentaje.
 */
export function technicianIneligibilityReason(
  offer: Pick<Offer, 'onlyUnlicensed' | 'offerKind' | 'requiredEngineId'>,
  technician: Pick<TechnicianWithRelations, 'licenses' | 'engines' | 'technicianTypes' | 'habilitations'>,
  ratingIndex: AircraftRatingIndex,
  engineIndex: EngineIndex,
): IneligibilityReason | null {
  if (offer.offerKind === 'engine' && !isEngineOfferCandidate(offer, technician, ratingIndex, engineIndex)) return 'no_engine_experience';
  if (offer.onlyUnlicensed && technician.licenses.length > 0) return 'licensed_technician';
  return null;
}

/**
 * Un par (oferta, técnico) YA FILTRADO Y PUNTUADO. La variante no elegible no
 * tiene `score`: un par que el filtro saca no tiene porcentaje que enseñar, y
 * un campo a null sería la invitación a pintarlo igualmente.
 */
export type PairMatch =
  | { eligible: true; score: MatchScore }
  | { eligible: false; reason: IneligibilityReason };

/**
 * EL camino de un par: filtro y, si pasa, scorer. Las dos funciones de ranking
 * de abajo son esto más deduplicar y ordenar, y las pantallas que miran un par
 * suelto lo usan a través de matchingService.matchPairs. Que las tres cosas
 * pasen por aquí es lo que impide que una pantalla puntúe a quien la lista
 * habría sacado.
 */
export function matchOfferTechnicianPair(
  offer: OfferWithRequirements,
  technician: TechnicianWithRelations,
  ratingIndex: AircraftRatingIndex,
  engineIndex: EngineIndex,
  now: Date = new Date(),
): PairMatch {
  const reason = technicianIneligibilityReason(offer, technician, ratingIndex, engineIndex);
  if (reason) return { eligible: false, reason };
  return { eligible: true, score: calculateOfferTechnicianMatch(offer, technician, ratingIndex, now, engineIndex) };
}

function eligibleScores(pairs: PairMatch[]): MatchScore[] {
  return pairs.flatMap((pair) => (pair.eligible ? [pair.score] : []));
}

// Filtro 1 de isTechnicianEligibleForOffer: las vías (a), (b) y (c), en orden
// de coste — las dos baratas primero.
function isEngineOfferCandidate(
  offer: Pick<Offer, 'requiredEngineId'>,
  technician: Pick<TechnicianWithRelations, 'engines' | 'technicianTypes' | 'habilitations'>,
  ratingIndex: AircraftRatingIndex,
  engineIndex: EngineIndex,
): boolean {
  if (technician.engines.length > 0) return true; // (a)
  if (technician.technicianTypes.includes(ENGINE_TECHNICIAN_TYPE_CODE)) return true; // (c)
  if (!offer.requiredEngineId) return false;
  // (b) Sin motores declarados, toda la evidencia que queda es implícita y B1
  // (collectEngineEvidence ya descarta las demás ramas).
  const { tier } = matchEngineEvidence(collectEngineEvidence(technician, ratingIndex), offer.requiredEngineId, engineIndex);
  return tier === 'implicit_exact' || tier === 'same_family';
}

// Orden del ranking: por total descendente, y a igualdad por id. El desempate
// por id no es cosmético — sin él, dos técnicos empatados salen en el orden en
// que PostgREST devolvió las filas, y la misma lista se repinta distinta.
function byTotalThen(id: (score: MatchScore) => string) {
  return (a: MatchScore, b: MatchScore) => (b.total !== a.total ? b.total - a.total : id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0);
}

// Un id, un resultado. Una consulta con join devuelve el mismo técnico una vez
// por licencia, y tres B1.1 no pueden convertirse en tres filas del ranking.
function dedupeById<T>(items: T[], id: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = id(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Los técnicos de una oferta, filtrados (isTechnicianEligibleForOffer),
 * puntuados y ordenados. Pura: recibe el catálogo ya cargado y no importa
 * Supabase. Es la función que usa getTechnicianMatchesForOffer (matchingV2).
 *
 * UN SOLO RESULTADO POR TÉCNICO, siempre. `calculateOfferTechnicianMatch`
 * elige UNA credencial y puntúa una vez con ella, así que tener tres licencias
 * válidas a la vez no suma tres veces la habilitación; esta función además
 * deduplica la entrada, que es la otra mitad del mismo problema.
 */
// `engineIndex` es obligatorio aquí (paso 5b), a diferencia de
// calculateOfferTechnicianMatch: el filtro lo necesita para la vía (b), y un
// valor por defecto vacío es exactamente la forma de olvidarlo sin que nada
// avise.
export function rankTechniciansForOffer(
  offer: OfferWithRequirements,
  technicians: TechnicianWithRelations[],
  ratingIndex: AircraftRatingIndex,
  engineIndex: EngineIndex,
  now: Date = new Date(),
): MatchScore[] {
  return eligibleScores(
    dedupeById(technicians, (t) => t.id).map((technician) => matchOfferTechnicianPair(offer, technician, ratingIndex, engineIndex, now)),
  ).sort(byTotalThen((s) => s.technicianId));
}

/**
 * La dirección contraria, con exactamente las mismas reglas: mismo filtro,
 * mismo scorer, mismo resultado para el mismo par. Que las dos pantallas
 * pudieran discrepar es un fallo que ya se ha cometido en este producto.
 */
export function rankOffersForTechnician(
  technician: TechnicianWithRelations,
  offers: OfferWithRequirements[],
  ratingIndex: AircraftRatingIndex,
  engineIndex: EngineIndex,
  now: Date = new Date(),
): MatchScore[] {
  return eligibleScores(
    dedupeById(offers, (o) => o.id).map((offer) => matchOfferTechnicianPair(offer, technician, ratingIndex, engineIndex, now)),
  ).sort(byTotalThen((s) => s.offerId));
}
