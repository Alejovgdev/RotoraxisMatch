/**
 * V2 privacy guard utilities.
 *
 * All functions are pure — they take pre-loaded data as parameters.
 * No I/O, no AsyncStorage calls. This keeps them composable with any hook or screen.
 *
 * Core rule: status === 'accepted' is the source of truth for identity and document access.
 * identityRevealed/documentsUnlocked are READ-ONLY flags set server-side (or by the local
 * acceptance trigger). Never use those booleans alone as the gate — always check status.
 *
 * If a record has identityRevealed: true but status !== 'accepted', treat as locked.
 *
 * SECURITY BOUNDARY NOTE:
 * These TypeScript utilities prevent ACCIDENTAL misuse in React code (e.g. a developer
 * passing a TechnicianProfile directly to a company screen). They are NOT a substitute
 * for Supabase RLS / views / RPCs.
 *
 * When Supabase is live, the real enforcement is:
 *   - technician_public_view  — CASE WHEN offer_accepted_between() gates private columns
 *   - get_unlocked_technician() RPC — returns unlocked shape only if accepted, checked server-side
 * These functions will still be used to map API responses into the same DTO shapes.
 */

import { OfferRequest, OfferApplication } from '../types/offerRequest';
import {
  TechnicianWithRelations,
} from '../types/technician';
import { SafeTechnicianPreview, UnlockedTechnicianView } from '../types/privacy';
import { Document } from '../types/document';
import { LicenseCode } from '../types/catalog';

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

// calculateAge() ELIMINADA (migración 040). La edad salió del contrato público
// por ser característica protegida, así que no queda ningún sitio donde una
// empresa deba verla derivada. Si alguna vez hace falta la edad para un uso
// interno (p. ej. un requisito regulatorio), se calcula donde se necesite y con
// `birthDate`, que sigue siendo privado — no se reintroduce aquí un helper cuyo
// único cliente histórico fue la vista que una empresa consume.

// ---------------------------------------------------------------------------
// Shared params type for all three gate functions
// ---------------------------------------------------------------------------

export interface AcceptanceCheckParams {
  companyId: string;
  technicianId: string;
  offerRequests: OfferRequest[];
  offerApplications: OfferApplication[];
}

/**
 * Returns true if at least one accepted offer record exists between this company and technician.
 * Checks status === 'accepted' — does NOT rely on identityRevealed or documentsUnlocked alone.
 */
function hasAcceptedRecord({ companyId, technicianId, offerRequests, offerApplications }: AcceptanceCheckParams): boolean {
  const acceptedRequest = offerRequests.some(
    (r) => r.companyId === companyId && r.technicianId === technicianId && r.status === 'accepted',
  );
  if (acceptedRequest) return true;

  return offerApplications.some(
    (a) => a.companyId === companyId && a.technicianId === technicianId && a.status === 'accepted',
  );
}

// ---------------------------------------------------------------------------
// Gate functions
// ---------------------------------------------------------------------------

/**
 * True if the company may see the technician's real identity (firstName, lastName, email, phone, socialLinks).
 * Only unlocked after an accepted direct offer or accepted application.
 */
export function canRevealIdentity(params: AcceptanceCheckParams): boolean {
  return hasAcceptedRecord(params);
}

// ---------------------------------------------------------------------------
// View builders
// ---------------------------------------------------------------------------

/**
 * Builds a SafeTechnicianPreview — the anonymous company view before acceptance.
 *
 * Includes: id, anonymousCode, technicianTypes, country, city,
 *           baseAirport, location coordinates, país ISO + ciudad del modelo
 *           nuevo (Fase 7 F2b), licenses, habilitations,
 *           yearsExperience, availability, verificationStatus.
 *
 * Excludes: firstName, lastName, email, phone, birthDate, socialLinks, documents, matchingScore.
 */
export function getSafeTechnicianPreview(technician: TechnicianWithRelations): SafeTechnicianPreview {
  return {
    id: technician.id,
    anonymousCode: technician.anonymousCode,
    technicianTypes: technician.technicianTypes,
    // Fase 7 F2d: sin aeropuerto. `country` es el codigo ISO y las
    // coordenadas solo existen si la ciudad vino del directorio; si no, el
    // pin cae en el pais (resolveMapPin).
    country: technician.locationCountryCode,
    city: technician.locationCityName ?? '',
    latitude: technician.locationCityLat,
    longitude: technician.locationCityLng,
    // Fase 7 F2b: el modelo nuevo se COPIA del perfil, no se recalcula. El
    // perfil ya lo trae de Postgres (mapPrivateTechnicianRow), y volver a
    // derivarlo del aeropuerto aquí sería una segunda fuente que podría
    // discrepar en cuanto F2c deje elegir una ciudad distinta de la del
    // aeropuerto. Esta función anonimiza, no decide localización.
    locationCountryCode: technician.locationCountryCode,
    locationCityName: technician.locationCityName,
    locationCityLat: technician.locationCityLat,
    locationCityLng: technician.locationCityLng,
    locationCityGeonameId: technician.locationCityGeonameId,
    licenses: technician.licenses.map((l) => ({ authority: l.authority, licenseCode: l.licenseCode })),
    habilitations: technician.habilitations,
    aircraftExperience: technician.aircraftExperience,
    engines: technician.engines,
    yearsExperience: technician.yearsExperience,
    availability: technician.availability,
    verificationStatus: technician.verificationStatus,
  };
}

/**
 * Builds an UnlockedTechnicianView — the full company view after acceptance.
 * Extends SafeTechnicianPreview with identity fields and documents.
 * Only call this when canRevealIdentity() returns true.
 *
 * DOCUMENT CONTRACT: The `documents` parameter must be pre-filtered to verified-only
 * for all company-facing calls. Use documentRepositoryV2.getVerifiedForTechnician().
 * Technician and admin views may pass all documents regardless of status.
 *
 * MVP rule: Company sees only documents with status = 'verified'.
 * Pending, rejected, and expired documents are technician/admin-only.
 */
export function getUnlockedTechnicianView(
  technician: TechnicianWithRelations,
  documents: Document[],
): UnlockedTechnicianView {
  return {
    ...getSafeTechnicianPreview(technician),
    photoPath: technician.photoPath ?? null,
    firstName: technician.firstName,
    lastName: technician.lastName,
    email: technician.email,
    phone: technician.phone,
    socialLinks: technician.socialLinks,
    documents,
  };
}
