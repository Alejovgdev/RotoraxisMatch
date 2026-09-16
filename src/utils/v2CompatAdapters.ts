/**
 * V1-compatibility adapters for V2 data shapes.
 *
 * These are temporary bridges so existing V1 screens continue to work while
 * the hooks are migrated to V2 repositories internally.
 *
 * Remove each function as the screen that depends on it is migrated to V2 types.
 *
 * IMPORTANT: Never use these adapters to expose private fields before
 * status === 'accepted'. The callers are responsible for calling the right
 * adapter (safe vs unlocked).
 */

import {
  AvailabilityStatus,
  Availability,
  Technician,
  SafeTechnicianView,
  TechnicianWithRelations,
  TechnicianProfile,
} from '../types/technician';
import { Company, CompanyProfile, CompanyProfileView } from '../types/company';
import { TechnicianDocument, Document } from '../types/document';
import { SafeTechnicianPreview, UnlockedTechnicianView } from '../types/privacy';
import { OfferRequest } from '../types/offerRequest';
import { MatchRequest, MatchRequestStatus } from '../types/matchRequest';
import { AircraftRatingIndex } from '../constants/aircraftTypeRatings';
import { TechnicianHabilitation } from '../types/technician';
import { AircraftTypeRatingCatalog } from '../types/catalog';

// V1-shaped flat aircraft list for the compat screens: the rating's
// aircraft family, which since Fase 5.3 (2026-07-28) is the only source
// there is — the bare legacy aircraftTypeCode this used to prefer went with
// the aircraft_types catalog. ratingIndex is loaded by the caller (via
// catalogRepository / useAircraftTypeRatingsCatalog) — this stays a pure
// function, never a Supabase call of its own.
export function habilitationAircraftCodes(habilitations: TechnicianHabilitation[], ratingIndex: AircraftRatingIndex): string[] {
  const codes = new Set<string>();
  for (const h of habilitations) {
    if (!h.aircraftTypeRatingId) continue;
    const rating = ratingIndex.get(h.aircraftTypeRatingId);
    if (rating) codes.add(rating.aircraftFamily);
  }
  return [...codes];
}

// Fase 3b screens 3-4 — "Type ratings" labels (renamed from "Aircraft"),
// showing each EXACT rating's catalog displayName instead of the family
// strings habilitationAircraftCodes() above returns. A row with no rating
// id has no exact rating to show and is skipped — same as
// TypeRatingRequirementsEditor/
// HabilitationsEditor. Shared by search.tsx and the map (native + web) so
// both render the same labels from the same rule, never two independent
// copies.
export function resolveTypeRatingLabels(habilitations: TechnicianHabilitation[], ratingIndex: AircraftRatingIndex): string[] {
  const labels = new Set<string>();
  habilitations.forEach((h) => {
    if (!h.aircraftTypeRatingId) return;
    const rating = ratingIndex.get(h.aircraftTypeRatingId);
    if (rating) labels.add(rating.displayName);
  });
  return [...labels];
}

// Airplane/Helicopter/Mixed badge, derived from the 606-row catalog's own
// productType field — never a hardcoded aircraft category lookup. A
// habilitation with no resolvable rating, or a rating whose productType
// hasn't been backfilled, contributes nothing (never guessed).
export function resolveTechnicianProductTypes(
  habilitations: TechnicianHabilitation[],
  ratingIndex: AircraftRatingIndex,
): Set<NonNullable<AircraftTypeRatingCatalog['productType']>> {
  const types = new Set<NonNullable<AircraftTypeRatingCatalog['productType']>>();
  habilitations.forEach((h) => {
    if (!h.aircraftTypeRatingId) return;
    const productType = ratingIndex.get(h.aircraftTypeRatingId)?.productType;
    if (productType) types.add(productType);
  });
  return types;
}

// ---------------------------------------------------------------------------
// Availability helpers
// ---------------------------------------------------------------------------

/**
 * Etiqueta legible del booleano persistido. 1:1 y SIN pérdida en los dos
 * sentidos desde que la disponibilidad es binaria (2026-07-29): lo único que
 * se guarda es `immediately`, y `status` existe para que UI y filtros no
 * tengan que hablar en booleanos.
 *
 * Ya NO consulta un `status` preexistente: durante la etapa de 3 estados eso
 * era lo que permitía que un "Open to offers" sin fecha sobreviviera en
 * memoria y muriera al recargar. Con dos estados no hay nada que preferir.
 */
export function deriveAvailabilityStatus(avail: Availability): AvailabilityStatus {
  return avail.immediately ? 'open_to_offers' : 'unavailable';
}

/**
 * Adjunta la etiqueta `status` al objeto de disponibilidad para que las
 * pantallas y los filtros la lean. Nunca se persiste: el PATCH del perfil
 * escribe sólo `immediately` y `contract_types`.
 */
export function withAvailabilityStatus(avail: Availability): Availability {
  return { ...avail, status: deriveAvailabilityStatus(avail) };
}

// ---------------------------------------------------------------------------
// Experience helpers
// ---------------------------------------------------------------------------

/**
 * Sub-fase de experiencia (2026-07-28): antes derivaba los años del array
 * technician_aircraft_experience (tabla retirada, migracion 031). Ahora es
 * simplemente el campo declarado del perfil.
 *
 * El tipo V1 exige `number`, pero el V2 distingue undefined (no declarado)
 * de 0 (declarado sin experiencia). Colapsar a 0 aqui es una PERDIDA de
 * informacion aceptada solo para la capa de compatibilidad V1: ninguna
 * decision real (ni el filtro duro ni el scoring) pasa por esta funcion.
 * Las pantallas V2 deben leer yearsExperience directamente y mostrar
 * "not specified" cuando sea undefined.
 */
export function computeYearsExperience(yearsExperience: number | undefined): number {
  return yearsExperience ?? 0;
}

// ---------------------------------------------------------------------------
// Location helpers
// ---------------------------------------------------------------------------

/**
 * Fase 7 F2c — LAS COORDENADAS YA NO SALEN DEL AEROPUERTO.
 *
 * Antes, `latitude`/`longitude` eran las del aeropuerto del catálogo. Eso es
 * justo el pin preciso y falso que esta fase retira: Barajas está a 12 km del
 * centro de Madrid, así que el punto decía "aquí" señalando otro sitio.
 *
 * Ahora sólo se propagan las coordenadas de una ciudad ELEGIDA DEL
 * DIRECTORIO. Si no las hay, quedan `undefined` y es `useMapTechnicians`
 * quien decide el pin de país — ver `resolveMapPin`. Dejarlas `undefined`
 * aquí es deliberado: quien no aplique la regla del pin no pinta nada, en vez
 * de pintar mal.
 */
function compatLocation(reference: {
  locationCityId?: string;
  country?: string;
  city?: string;
  baseAirport?: string;
  locationCityName?: string;
  locationCityLat?: number;
  locationCityLng?: number;
}) {
  // Fase 7 F2d: sin catalogo de aeropuertos. Todo sale del modelo nuevo.
  return {
    country: reference.country ?? '',
    city: reference.locationCityName ?? reference.city ?? '',
    baseAirport: '',
    latitude: reference.locationCityLat,
    longitude: reference.locationCityLng,
  };
}

// ---------------------------------------------------------------------------
// SafeTechnicianPreview  →  SafeTechnicianView (anonymous, no identity)
// ---------------------------------------------------------------------------

/**
 * Convert a V2 SafeTechnicianPreview to the V1 SafeTechnicianView shape.
 *
 * Safe for company views before acceptance:
 * - No firstName, lastName, email, phone
 * - No matchingScore (general search has no offer context)
 */
export function v2SafePreviewToSafeView(preview: SafeTechnicianPreview, ratingIndex: AircraftRatingIndex): SafeTechnicianView {
  const location = compatLocation(preview);

  return {
    id: preview.id,
    anonymousCode: preview.anonymousCode,
    country: location.country,
    city: location.city,
    baseAirport: location.baseAirport,
    locationCountryCode: preview.locationCountryCode,
    latitude: location.latitude,
    longitude: location.longitude,
    licenseCategories: preview.licenses.map((license) => license.licenseCode),
    aircraftTypes: habilitationAircraftCodes(preview.habilitations, ratingIndex),
    specialties: [],
    availability: withAvailabilityStatus(preview.availability),
    verificationStatus: preview.verificationStatus,
    yearsExperience: computeYearsExperience(preview.yearsExperience),
    // matchingScore intentionally omitted — no offer context in general search
  };
}

// ---------------------------------------------------------------------------
// UnlockedTechnicianView  →  SafeTechnicianView (identity visible)
// ---------------------------------------------------------------------------

/**
 * Convert a V2 UnlockedTechnicianView (post-acceptance) to SafeTechnicianView.
 * Only call this after canRevealIdentity() returns true.
 */
export function v2UnlockedViewToSafeView(view: UnlockedTechnicianView, ratingIndex: AircraftRatingIndex): SafeTechnicianView {
  return {
    ...v2SafePreviewToSafeView(view, ratingIndex),
    fullName: `${view.firstName} ${view.lastName}`,
    email: view.email,
    phone: view.phone,
  };
}

// ---------------------------------------------------------------------------
// TechnicianWithRelations  →  Technician (own profile or admin — identity always shown)
// ---------------------------------------------------------------------------

/**
 * Convert a full V2 TechnicianWithRelations to the V1 Technician type.
 * Always reveals identity — only call for own-profile or admin views.
 */
export function v2TechnicianToV1(tech: TechnicianWithRelations, ratingIndex: AircraftRatingIndex): Technician {
  const location = compatLocation(tech);

  return {
    id: tech.id,
    anonymousCode: tech.anonymousCode,
    fullName: `${tech.firstName} ${tech.lastName}`,
    email: tech.email,
    phone: tech.phone ?? '',
    country: location.country,
    city: location.city,
    baseAirport: location.baseAirport,
    locationCountryCode: tech.locationCountryCode,
    latitude: location.latitude,
    longitude: location.longitude,
    licenseCategories: tech.licenses.map((l) => l.licenseCode),
    aircraftTypes: habilitationAircraftCodes(tech.habilitations, ratingIndex),
    specialties: [],
    availability: withAvailabilityStatus(tech.availability),
    verificationStatus: tech.verificationStatus,
    yearsExperience: computeYearsExperience(tech.yearsExperience),
  };
}

// ---------------------------------------------------------------------------
// CompanyProfile  →  Company (V1 compat)
// ---------------------------------------------------------------------------

/**
 * Convert a V2 CompanyProfile to the V1 Company shape.
 * V2 has no `website` field — it is set to an empty string.
 */
export function v2CompanyToV1(c: CompanyProfile | CompanyProfileView): Company {
  const location = compatLocation(c);

  return {
    id: c.id,
    companyName: c.name,
    country: location.country,
    city: location.city,
    // Ya no es el '' hardcodeado que inventario la auditoria de campos
    // fantasma: desde la migracion 036 hay columna real detras. El ?? '' que
    // queda es solo la traduccion de "no declarada" al tipo V1, que exige
    // string.
    website: c.website ?? '',
    companyType: c.companyType, // CompanyTypeCode ⊂ CompanyType union
    verificationStatus: c.verificationStatus,
    contactEmail: c.email,
  };
}

// ---------------------------------------------------------------------------
// OfferRequest  →  MatchRequest (V1 compat)
// ---------------------------------------------------------------------------

/**
 * Convert a V2 OfferRequest to the V1 MatchRequest shape for existing screens.
 *
 * Status mapping (V2 → V1):
 *   pending    → sent       (V1 screens filter by status === 'sent' for pending tab)
 *   accepted   → accepted
 *   rejected / expired / withdrawn → rejected
 *
 * This mapping is ONLY for V1 screen compatibility. V2 repositories always use
 * V2 status values internally. Never store the mapped status back to the DB.
 */
export function v2OfferRequestToMatchRequest(req: OfferRequest): MatchRequest {
  let status: MatchRequestStatus;
  if (req.status === 'pending') status = 'sent';
  else if (req.status === 'accepted') status = 'accepted';
  else status = 'rejected';

  return {
    id: req.id,
    companyId: req.companyId,
    technicianId: req.technicianId,
    status,
    identityRevealed: req.identityRevealed,
    createdAt: req.createdAt,
    message: req.message,
  };
}

// ---------------------------------------------------------------------------
// Document  →  TechnicianDocument (V1 compat)
// ---------------------------------------------------------------------------

/**
 * Strip storage and admin-internal V2 fields (storagePath, reviewedAt) that V1
 * screens don't need. Pass through expiresAt and rejectionReason so technician
 * screens can access them via the existing typecast pattern.
 */
export function v2DocumentToV1(doc: Document): TechnicianDocument {
  const result: TechnicianDocument = {
    id: doc.id,
    technicianId: doc.technicianId,
    type: doc.type,
    fileName: doc.fileName,
    status: doc.status,
    uploadedAt: doc.uploadedAt,
  };
  // Pass through display fields used by technician screens via typecast.
  // These are not on TechnicianDocument's TypeScript type but exist at runtime.
  if (doc.expiresAt !== undefined) (result as any).expiresAt = doc.expiresAt;
  if (doc.rejectionReason !== undefined) (result as any).rejectionReason = doc.rejectionReason;
  return result;
}
