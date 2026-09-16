import { TechnicianTypeCatalog, TechnicianTypeCode } from '../types/catalog';

// El oficio que hace elegible para una oferta de motor aunque no se declare
// ningún motor (Fase 10, paso 5a — ver isTechnicianEligibleForOffer). Con
// nombre porque el filtro de elegibilidad lo compara, y un literal suelto en el
// scorer es el que se escribe mal en la segunda copia.
export const ENGINE_TECHNICIAN_TYPE_CODE: TechnicianTypeCode = 'engine_technician';

export const TECHNICIAN_TYPES: TechnicianTypeCatalog[] = [
  { code: 'mechanic',           label: 'Mechanic',            requiresLicense: true,  isActive: true,  sortOrder: 1 },
  { code: 'avionic',            label: 'Avionics Technician', requiresLicense: true,  isActive: true,  sortOrder: 2 },
  { code: 'sheet_metal_worker', label: 'Sheet Metal Worker',  requiresLicense: false, isActive: true,  sortOrder: 3 },
  { code: 'painter',            label: 'Aircraft Painter',    requiresLicense: false, isActive: true,  sortOrder: 4 },
  { code: 'composite',          label: 'Composite Technician',requiresLicense: false, isActive: true,  sortOrder: 5 },
  { code: 'pilot',              label: 'Pilot',               requiresLicense: true,  isActive: false, sortOrder: 6 },
  // Fase 10: creada inactiva en la 076 (paso 5a, sin UI) y activada en la 078
  // (paso 5b), a la vez en la base y aquí, cuando existieron las pantallas de
  // motores. Hace elegible para una oferta de motor aunque no se declaren
  // motores — ver ENGINE_TECHNICIAN_TYPE_CODE arriba.
  { code: 'engine_technician',  label: 'Engine Technician',   requiresLicense: false, isActive: true,  sortOrder: 7 },
];

// Display label for a technician type code. The catalog above is the only
// place a label is written; screens read it through here.
//
// Unknown code -> the code itself, which is what every caller already did on
// a miss. A raw code on screen is ugly but honest; inventing a label for a
// row that is not in the catalog would be worse.
export function technicianTypeLabel(code: string): string {
  return TECHNICIAN_TYPES.find((t) => t.code === code)?.label ?? code;
}

// Los tipos de un técnico, en una línea (Fase 6 tanda A: ahora son varios).
//
// Ordenados por `sortOrder` del catálogo y NO por el orden de llegada: la
// lista viaja desde Postgres y desde el estado de un formulario, y sin esto
// el mismo técnico se pintaría con los tipos permutados según la pantalla.
//
// `fallback` en vez de cadena vacía porque hay un caso real en el que la
// lista llega vacía: una vista de empresa construida sin las relaciones
// cargadas. Un guion es honesto; una línea en blanco parece un fallo de
// maquetación.
export function technicianTypeLabels(codes: readonly string[], fallback = '—'): string {
  if (codes.length === 0) return fallback;
  const order = new Map<string, number>(TECHNICIAN_TYPES.map((t) => [t.code, t.sortOrder]));
  return [...codes]
    .sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER))
    .map(technicianTypeLabel)
    .join(', ');
}

// ══════════════════════════════════════════════════════════════════════
// ⚠ AQUÍ HABÍA UN AVISO DE "TODO LO QUE VIENE DEBAJO ESTÁ SIN CONSUMIDORES"
// (Fase 6 tanda C, 2026-08-10). Ya no vale para todo: la cadena se ha
// partido en dos mitades con distinto destino (2026-08-13).
//
// VIVA otra vez: `isLicensedTechnicianType`, y con ella
// `TechnicianTypeCatalog.requiresLicense` y la columna
// `technician_types.requires_license`. El formulario de oferta la usa para
// decidir si la pregunta "¿hace falta licencia?" existe siquiera cuando el
// puesto es de chapa, pintura o composite, y `licensesSelectableForOfferType`
// (src/constants/licenses.ts) la usa para el mismo corte sobre la lista de
// licencias. Es exactamente el consumidor que le faltaba, así que sale de la
// lista de LIMPIEZA de docs/MISSION_PART66.md.
//
// SIGUE SIN CONSUMIDORES: `offerTargetsLicensedProfiles`, la de abajo del
// todo. La pregunta que respondía — "¿esta oferta tiene eje Part-66?" — la
// contesta `offers.requires_certification`, un booleano que la empresa marca
// explícitamente. Deducirla del TIPO de perfil era el problema de fondo de
// toda la Fase 6: hacía imposible publicar "ayudante para el A320, sin
// licencia". Sigue pendiente del BARRIDO DE EXPORTS MUERTOS, ahora ella sola
// — retirarla ya NO arrastra a `requiresLicense` ni a su columna.
//
// Ojo a la diferencia entre las dos, que es justo lo que las separa:
// `isLicensedTechnicianType` responde "¿este OFICIO tiene licencias?", que es
// propiedad del oficio y siempre fue cierta; `offerTargetsLicensedProfiles`
// respondía "¿esta OFERTA exige licencia?", que es decisión de la empresa y
// nunca debió deducirse del oficio.
// ══════════════════════════════════════════════════════════════════════

// ── Licensed vs non-licensed profiles ───────────────────────────────────
// EASA Part-66 licences and aircraft type ratings only exist for the
// technician types that CERTIFY work (mechanic, avionics, pilot). A sheet
// metal worker, painter or composite technician holds no licence and no type
// rating — the whole Part-66 axis is empty for them, and applying it anyway
// produced offers and profiles with a qualification section that could never
// be filled in.
//
// `requiresLicense` in the catalog above is the single source of truth for
// that split. It had been declared with the right values since the catalog
// was written but was never read anywhere; these two helpers are its only
// consumers, so changing a row above changes the behaviour everywhere.

// Unknown code -> treated as licensed. That is the pre-existing behaviour
// (every Part-66 section visible), and this function must never be the thing
// that hides a qualification section because a catalog row is missing: the
// costly direction of being wrong is silently dropping a real licence, not
// showing an extra section.
export function isLicensedTechnicianType(code: string): boolean {
  return TECHNICIAN_TYPES.find((t) => t.code === code)?.requiresLicense ?? true;
}

// Does this offer target profiles that hold licences, and therefore have a
// Part-66 axis to require anything on?
//
// Empty list = the offer does not restrict the technician type at all, so it
// does not restrict this either: current behaviour, everything stays
// available. Matches how the matching engine reads the same field (an empty
// requiredTechnicianTypes is "no restriction", see offerMatchExplain.ts).
//
// The decision recorded for this feature is that an offer is EITHER for
// licensed profiles OR for non-licensed ones, never both — the offer form
// enforces that and offerRepository re-checks it server-side. `.some()`
// rather than `.every()` is the safe reading for any row that predates the
// rule (or was written by an older client): if even one licensed type is
// targeted, the Part-66 sections stay visible and existing requirements stay
// editable, instead of being hidden behind a screen that cannot show them.
export function offerTargetsLicensedProfiles(offer: { requiredTechnicianTypes: readonly string[] }): boolean {
  if (offer.requiredTechnicianTypes.length === 0) return true;
  return offer.requiredTechnicianTypes.some(isLicensedTechnicianType);
}
