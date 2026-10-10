// Lo que editan las pantallas del perfil del técnico (rediseño, fase 6A: You,
// My work y las pantallas pequeñas). Es la forma de FORMULARIO, no la de la
// base: `yearsInput` es texto porque '' (no declarado) y '0' son cosas
// distintas, y las licencias van por credencial (autoridad + código).
//
// Las tres filas de abajo vivían en los editores (HabilitationsEditor,
// AircraftExperienceEditor, EngineExperienceEditor), que las siguen
// reexportando. Se movieron aquí porque ahora también las usan el caso de uso
// que guarda (src/usecases/technicianProfile.ts) y el repositorio que carga, y
// un repositorio no importa de un componente.
import type { AuthorityCode, ContractTypeCode } from './catalog';
import type { VerificationStatus } from './enums';
import type { LocationValue, PersistedLocation } from './location';
import type { AvailabilityStatus, SocialLinks } from './technician';
import type { HeldLicense } from '../utils/profileLicenses';

export interface HabilitationRow {
  id?: string;
  // Paso 5b: la CREDENCIAL de la que cuelga, autoridad incluida. Con una B1.1
  // EASA y otra UK CAA el código no dice de cuál es, y el repositorio resuelve
  // technician_license_id por el par (ver replaceHabilitations).
  authority: AuthorityCode;
  licenseCode: string;
  aircraftTypeRatingId: string;
  experienceYears?: number;
  // Optional vigencia (Fase 3). Absent issuedAt/expiresAt and isCurrent
  // undefined/true are all neutral for matching — only an explicit
  // isCurrent === false or a past expiresAt degrade a match, never exclude
  // it. See offerMatchExplain.ts.
  issuedAt?: string;
  expiresAt?: string;
  isCurrent?: boolean;
}

export interface AircraftExperienceRow {
  id?: string;
  aircraftTypeRatingId: string;
  years?: number;
  /** 094: ha firmado trabajo en esta aeronave. Sólo con FAA A o A&P. */
  signed?: boolean;
}

export interface EngineExperienceRow {
  id?: string;
  engineId: string;
  years?: number;
}

/** El perfil propio, tal y como lo cargan y lo editan las pantallas de You. */
export interface EditableTechnicianProfile {
  photoPath?: string | null;
  id: string;
  anonymousCode: string;
  fullName: string;
  /** Sólo lectura: el perfil no lo cambia ni lo vuelve a escribir. */
  email: string;
  phone: string;
  verificationStatus: VerificationStatus;
  location: LocationValue;
  /** `status` es la etiqueta de `immediately`, 1:1 (ver types/technician.ts). */
  availability: { status: AvailabilityStatus; contractTypes: ContractTypeCode[] };
  /** '' = no declarado (NULL en la base), distinto de '0'. */
  yearsInput: string;
  /** Los tres enlaces que la pantalla enseña, en crudo. */
  socialInputs: Record<string, string>;
  /**
   * Los de la tabla puente MÁS los que bloquean las licencias declaradas: una
   * fila anterior a la invariante (2026-08-13) se enseña reparada, y la
   * reparación viaja con el próximo guardado de tipos (ver la carga).
   */
  technicianTypes: string[];
  licenses: HeldLicense[];
  habilitations: HabilitationRow[];
  aircraftExperience: AircraftExperienceRow[];
  engines: EngineExperienceRow[];
}

/**
 * Las columnas de `technician_profiles` que el perfil escribe. Sólo se mandan
 * las claves presentes: cada pantalla escribe las suyas y ninguna otra.
 */
export interface OwnProfileColumnsPatch {
  firstName?: string;
  lastName?: string;
  /** null = sin teléfono. */
  phone?: string | null;
  /** Las cinco columnas de localización, siempre juntas. */
  location?: PersistedLocation;
  /** El JSON entero: quien lo manda ha leído antes la clave que no cambia. */
  availability?: { immediately: boolean; contractTypes: ContractTypeCode[] };
  yearsExperience?: number | null;
  socialLinks?: SocialLinks | null;
}
