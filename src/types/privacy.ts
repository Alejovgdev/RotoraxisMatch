/**
 * Privacy DTO types for company-facing technician views.
 *
 * SECURITY NOTE: These DTOs prevent accidental private field access in React code.
 * They are NOT the security boundary. The Supabase boundary enforces real access control:
 *   - Row-level Security on technician_profiles (row access)
 *   - technician_public_view (column-level privacy via CASE WHEN offer_accepted_between())
 *   - get_unlocked_technician() RPC (requires accepted status, checked server-side)
 *
 * In the live app the privacy gate is applied at two entry points:
 *   - technicianRepositoryV2.getViewForCompany() — company screens
 *   - canRevealIdentity() + getUnlockedTechnicianView() / getSafeTechnicianPreview()
 *     (privacyV2.ts) — the search, map and dashboard hooks, which already hold the
 *     acceptance records and build the view themselves.
 * Both populate these same DTOs from view/RPC responses.
 *
 * Future Supabase mapping:
 *   SafeTechnicianPreview / TechnicianPublicPreviewDTO  →  technician_public_view / search_technicians_public()
 *   UnlockedTechnicianView / TechnicianUnlockedDTO      →  get_unlocked_technician() (requires accepted status)
 *
 * Company-facing code must NEVER consume TechnicianProfile or TechnicianWithRelations directly.
 * Go through technicianRepositoryV2.getViewForCompany(), or — when the caller already holds
 * the acceptance records — through canRevealIdentity() plus getUnlockedTechnicianView() /
 * getSafeTechnicianPreview() (privacyV2.ts), so the privacy gate is always applied.
 */

import { TechnicianTypeCode, AuthorityLicenseCode, AuthorityCode } from './catalog';
import { VerificationStatus } from './enums';
import {
  TechnicianAircraftExperience,
  TechnicianEngineExperience,
  TechnicianHabilitation,
  Availability,
  SocialLinks,
} from './technician';
import { Document } from './document';
import { PersistedLocation } from './location';

// What a company sees BEFORE offer acceptance.
// No real identity, no documents, NO age (migración 040 — ver abajo).
// Fase 7 F2b: el país ISO y la ciudad entran en el contrato público. Salen de
// `technician_public_view`, que la migración 057 recreó con las cinco
// columnas nuevas — y con sus 5 gates de identidad y sus 3 GRANT verificados
// en las post-condiciones, porque recrear una vista se los lleva por delante.
//
// No amplían lo que la empresa ve: `country` y `city` ya estaban, derivados
// del aeropuerto. Lo que cambia es de dónde salen y que ahora hay un código
// ISO estable en vez de un nombre suelto.
export interface SafeTechnicianPreview extends PersistedLocation {
  id: string;
  anonymousCode: string;
  // SIN edad, a propósito (migración 040). La edad es característica protegida
  // en normativa laboral europea: mostrarla al empleador durante el cribado es
  // riesgo de discriminación, e incoherente con anonimizar el nombre justo para
  // reducir sesgo. No aporta al cribado — licencias, type ratings y años de
  // experiencia cubren lo relevante. `birthDate` nunca sale, ni derivada.
  // Varios tipos desde la Fase 6 tanda A. Llegan por la tabla puente
  // `technician_profile_types`, con su propia policy de empresa, igual que
  // `licenses` y `habilitations` de más abajo — no por technician_public_view,
  // que sólo existe para anular los campos de IDENTIDAD.
  technicianTypes: TechnicianTypeCode[];
  country: string;
  city: string;
  baseAirport?: string;
  latitude?: number;
  longitude?: number;
  // Paso 5b: CREDENCIALES, no códigos. Hasta aquí viajaban sólo los códigos
  // ("B1.1"), y con cinco autoridades eso no dice cuál es: la empresa no podía
  // distinguir una B1.1 EASA de una UK CAA ni ver que un A&P es de la FAA. Sin
  // id ni fechas: la empresa ve QUÉ credencial tiene, no su registro.
  licenses: PublicLicense[];
  habilitations: TechnicianHabilitation[];
  // Aeronaves declaradas SIN necesidad de licencia (Fase 6 tanda B). Campo
  // público, como las habilitaciones, y por el mismo camino: su propia tabla
  // con su policy de empresa, no technician_public_view. Sin esto la tanda no
  // serviría de nada — un técnico sin licencia seguiría siendo invisible para
  // la empresa por mucho que declarara.
  //
  // NO puntúa en esta tanda: el scorer no lo lee. Tanda E.
  aircraftExperience: TechnicianAircraftExperience[];
  // Paso 5b: motores declarados (technician_engine_experience), por el mismo
  // camino que aircraftExperience — tabla propia con policy de empresa
  // (tee_select_company, migración 068), no technician_public_view. Es lo que
  // hace a un técnico elegible y bien puntuado en una oferta de motor, así que
  // la empresa tiene que poder verlo.
  engines: TechnicianEngineExperience[];
  // Años declarados — visual y filtrable, nunca puntuable. undefined = no
  // declarado, se muestra "not specified".
  yearsExperience?: number;
  availability: Availability;
  verificationStatus: VerificationStatus;
  // matchingScore is NOT stored here — ask matchPair / matchPairs (src/utils/matchingV2.ts) for the pair instead.
  // A score only exists in the context of a specific offer+technician pair.
}

/** Una licencia tal como la ve una empresa: quién la emite y qué categoría es. */
export interface PublicLicense {
  authority: AuthorityCode;
  licenseCode: AuthorityLicenseCode;
}

// What a company sees AFTER offer acceptance.
// Full identity + documents unlocked.
export interface UnlockedTechnicianView extends SafeTechnicianPreview {
  photoPath?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  socialLinks?: SocialLinks;
  documents: Document[];
}

export type TechnicianView = SafeTechnicianPreview | UnlockedTechnicianView;

export function isUnlocked(view: TechnicianView): view is UnlockedTechnicianView {
  return 'firstName' in view;
}

// ---------------------------------------------------------------------------
// DTO name aliases — same types, names that make the intent explicit at call sites.
//
// TechnicianPublicPreviewDTO  — use this name when the context is "data the company
//   receives from a search or listing before any acceptance".
//
// TechnicianUnlockedDTO — use this name when the context is "data the company
//   receives after an accepted offer_request or offer_application".
//
// Both aliases are re-exported from src/types/index.ts so screens can import either
// the canonical interface name or the DTO alias — whichever reads more clearly.
// ---------------------------------------------------------------------------
export type TechnicianPublicPreviewDTO = SafeTechnicianPreview;
export type TechnicianUnlockedDTO = UnlockedTechnicianView;
