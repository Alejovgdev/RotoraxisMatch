import { supabase } from '../../lib/supabase';
import { persistedLocationFromRow } from '../../utils/locationBridge';
import { salaryFromRow } from '../../utils/offerSalary';
import { CompanyMember, CompanyProfileView } from '../../types/company';
import { Document, DocumentType } from '../../types/document';
import { CompanyMemberRole, DocumentStatus, OfferRequestStatus, OfferStatus, VerificationStatus } from '../../types/enums';
import { AuthorityCode, AuthorityLicenseCode, ContractTypeCode, LicenseCode, TechnicianTypeCode } from '../../types/catalog';
import {
  Availability,
  TechnicianAircraftExperience,
  TechnicianHabilitation,
  TechnicianLicense,
  TechnicianProfile,
  TechnicianEngineExperience,
  TechnicianWithRelations,
} from '../../types/technician';
import { SafeTechnicianPreview, TechnicianView, UnlockedTechnicianView } from '../../types/privacy';
import { Offer, OfferKind, OfferProductType, OfferRequiredHabilitation, OfferWithRequirements } from '../../types/offer';
import { OfferApplication, OfferRequest } from '../../types/offerRequest';
import { ChatMessage, ChatRoom } from '../../types/chat';
import { SenderRole } from '../../types/enums';
import { CatalogRequest } from '../../types/catalogRequest';

export type DbRow = Record<string, any>;

export function firstJoin(row: unknown): DbRow | null {
  if (!row) return null;
  if (Array.isArray(row)) return (row[0] as DbRow | undefined) ?? null;
  return row as DbRow;
}

export function throwIfError(error: { message?: string } | null | undefined): void {
  if (error) throw new Error(error.message ?? 'Supabase request failed.');
}

/**
 * Comprueba que una mutación afectó de verdad a alguna fila.
 *
 * `error === null` NO es prueba de que la escritura ocurrió: si RLS no deja
 * pasar la fila, PostgREST devuelve 0 filas y CERO error, y la UI informa de
 * un éxito que no existió. Es la clase 1 de la taxonomía de la auditoría y ya
 * mordió una vez de verdad (borrar una oferta "funcionaba" y la oferta
 * reaparecía en la lista — migración 026).
 *
 * Uso: añade `.select('id')` a la mutación y pásale el `data` resultante.
 * Sin ese `.select()` no hay nada que contar y este helper no sirve.
 *
 * El mensaje debe describir la ACCIÓN del usuario, no la fila: quien lo lee
 * está en una pantalla, no en una tabla.
 */
export function throwIfNoRows(
  data: unknown[] | null | undefined,
  message: string,
): void {
  if (!data || data.length === 0) throw new Error(message);
}

// Disponibilidad binaria (2026-07-29). `available_from` ya no se lee ni se
// escribe: la migración 041 lo retira de las filas existentes. No se deja un
// fallback "por si acaso" — sería justo el campo fantasma que esa migración
// existe para eliminar.
export function mapAvailability(value: unknown): Availability {
  const source = (value && typeof value === 'object' ? value : {}) as {
    immediately?: boolean;
    contract_types?: string[];
    contractTypes?: string[];
  };
  const immediately = Boolean(source.immediately);
  return {
    immediately,
    status: immediately ? 'open_to_offers' : 'unavailable',
    contractTypes: (source.contract_types ?? source.contractTypes ?? []) as Availability['contractTypes'],
  };
}

export function mapCompanyRow(row: DbRow): CompanyProfileView {
  // Fase 7 F2d: sin JOIN a aeropuertos y sin `location_city_id`. La
  // localizacion sale de las columnas de la propia fila.
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? undefined,
    email: row.email,
    companyType: row.company_type,
    website: row.website ?? undefined,
    verificationStatus: row.verification_status as VerificationStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // `country` es el NOMBRE, resuelto por JOIN contra `location_countries`:
    // es lo que las pantallas pintan, y el JOIN lo mantiene al dia en vez de
    // congelarlo en la fila. `baseAirport` desaparece: el modelo nuevo no
    // habla de aeropuertos. Las coordenadas solo existen si la ciudad vino
    // del directorio — si no, el pin cae en el pais (ver resolveMapPin).
    country: firstJoin(row.location_countries)?.name ?? '',
    city: row.location_city_name ?? '',
    latitude: row.location_city_lat ?? undefined,
    longitude: row.location_city_lng ?? undefined,
    ...persistedLocationFromRow(row),
  };
}

export function mapCompanyMemberRow(row: DbRow): CompanyMember {
  const profileJoin = row.profiles as { email?: string } | null | undefined;
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    role: row.role as CompanyMemberRole,
    displayName: row.display_name ?? undefined,
    email: profileJoin?.email ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapDocumentRow(row: DbRow): Document {
  return {
    id: row.id,
    technicianId: row.technician_id,
    type: row.type as DocumentType,
    fileName: row.file_name,
    storagePath: row.storage_path,
    status: row.status as DocumentStatus,
    uploadedAt: row.uploaded_at,
    reviewedAt: row.reviewed_at ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    expiresAt: row.expires_at ?? undefined,
  };
}

export function mapOfferRow(row: DbRow): Offer {
  return {
    id: row.id,
    companyId: row.company_id,
    title: row.title,
    description: row.description,
    contractType: row.contract_type as ContractTypeCode,
    salary: salaryFromRow(row),
    productType: row.product_type as OfferProductType,
    technicianType: row.technician_type as TechnicianTypeCode,
    // `Boolean(...)` y no `?? true`: la columna es NOT NULL DEFAULT true, así
    // que una fila siempre trae un valor real. Un `?? true` escondería un
    // SELECT que se hubiera olvidado de pedir la columna, y la escondería en
    // la dirección peligrosa — haciendo pasar por "exige certificar" a una
    // oferta que declaró lo contrario.
    requiresCertification: Boolean(row.requires_certification),
    // `?? undefined` y no `?? null`: NULL en la columna significa "esta oferta
    // no exige certificar", y el CHECK de la 053 garantiza que sólo pasa en
    // ese caso. Nunca es un dato que falte.
    licenseCode: (row.license_code as AuthorityLicenseCode | null) ?? undefined,
    // Fase 10 (075): va con el código o no va. La base lo ata con
    // chk_offers_license_authority_pairing, así que aquí no hay que decidir
    // nada: se refleja lo que hay.
    licenseAuthority: (row.license_authority as AuthorityCode | null) ?? undefined,
    requiresAllAircraft: Boolean(row.requires_all_aircraft),
    // Fase 10 (migración 070). `Boolean(...)` reproduce el DEFAULT de las dos
    // columnas booleanas, que siguen siendo nullables. `offer_kind` es NOT NULL
    // desde la 079, así que el `?? 'aircraft'` ya no rellena ninguna fila real:
    // sólo cubriría un SELECT que se olvidara de pedirla —las cuatro están en
    // OFFER_COLUMNS, y si alguna saliera de ahí la oferta se puntuaría como de
    // aeronave sin avisar—.
    offerKind: (row.offer_kind as OfferKind | null) ?? 'aircraft',
    // Sesión 2 (088): la lista sustituye a `accepts_equivalent`, que ya no se
    // lee. La columna es NOT NULL DEFAULT '{}': el `?? []` sólo cubriría un
    // SELECT que la olvidara, y en la dirección segura (sin equivalencias).
    acceptedAuthorities: (row.accepted_authorities as AuthorityCode[] | null) ?? [],
    // 096: sólo en ofertas FAA con autoridades aceptadas; NULL en las demás.
    acceptedLicenseCode: (row.accepted_license_code as LicenseCode | null) ?? undefined,
    requiredEngineId: row.required_engine_id ?? undefined,
    onlyUnlicensed: Boolean(row.only_unlicensed),
    locationCountry: row.location_country,
    // Fase 7 F2b — `locationCity` y `locationBaseAirport` YA NO SON COLUMNAS:
    // la migración 059 retira `offers.location_city` y
    // `offers.location_base_airport`. Se DERIVAN, que es lo que siempre
    // fueron: copias denormalizadas de lo que `location_city_id` ya determina.
    //
    // La ciudad sale del modelo nuevo y sólo cae al aeropuerto si faltara;
    // así, cuando F2c deje al usuario elegir una ciudad distinta de la del
    // aeropuerto, esto ya la respeta sin tocar nada.
    locationCity: row.location_city_name ?? '',

    ...persistedLocationFromRow(row),
    minYearsExperience: row.min_years_experience ?? 0,
    status: row.status as OfferStatus,
    visible: Boolean(row.visible),
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type OfferRequirementsPick = Pick<OfferWithRequirements, 'requiredHabilitations'>;

export function mapOfferRequiredHabilitationRow(row: DbRow): OfferRequiredHabilitation {
  return {
    offerId: row.offer_id,
    aircraftTypeRatingId: row.aircraft_type_rating_id,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
  };
}

export async function loadOfferRequirements(offerIds: string[]): Promise<Record<string, OfferRequirementsPick>> {
  const uniqueIds = [...new Set(offerIds)].filter(Boolean);
  const empty: Record<string, OfferRequirementsPick> = {};
  for (const id of uniqueIds) {
    empty[id] = { requiredHabilitations: [] };
  }
  if (uniqueIds.length === 0) return empty;

  // Fase 5 (2026-08-04): aquí se leía también offer_required_aircraft_types
  // (el requisito aproximado por familia). Ese SELECT tenía un throwIfError
  // debajo, así que dropear la tabla con el lector vivo habría tumbado el
  // listado de ofertas entero — por eso el lector se va AQUÍ y el DROP va
  // después, en la migración 045.
  //
  // Fase 6 tanda C (2026-08-10): y aquí se leía offer_required_technician_types,
  // exactamente con la misma forma y el mismo riesgo. Lo sustituye la columna
  // `offers.technician_type` (migración 051), que llega ya en mapOfferRow; el
  // DROP de la tabla va en la 052, después de este cambio.
  // Fase 6 tanda D: `offer_required_licenses` deja de leerse — la licencia es
  // `offers.license_code`, una sola, y llega ya en mapOfferRow. Y de
  // `offer_required_habilitations` se dejan de pedir `license_code` y
  // `requirement_level`: las dos columnas se dropean en la migración 054,
  // DESPUÉS de este cambio, porque pedirlas por nombre cuando ya no existen
  // no degrada nada — tumba el listado de ofertas entero.
  const [habilitationsRes] = await Promise.all([
    supabase.from('offer_required_habilitations').select('offer_id, aircraft_type_rating_id, notes, created_at').in('offer_id', uniqueIds),
  ]);
  throwIfError(habilitationsRes.error);

  for (const row of (habilitationsRes.data ?? []) as DbRow[]) {
    empty[row.offer_id]?.requiredHabilitations.push(mapOfferRequiredHabilitationRow(row));
  }
  return empty;
}

export function withRequirements(offer: Offer, reqs?: OfferRequirementsPick): OfferWithRequirements {
  return {
    ...offer,
    requiredHabilitations: reqs?.requiredHabilitations ?? [],
  };
}

export function mapOfferRequestRow(row: DbRow): OfferRequest {
  return {
    kind: 'direct_offer',
    id: row.id,
    companyId: row.company_id,
    technicianId: row.technician_id,
    offerId: row.offer_id ?? undefined,
    status: row.status as OfferRequestStatus,
    identityRevealed: Boolean(row.identity_revealed),
    documentsUnlocked: Boolean(row.documents_unlocked),
    message: row.message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOfferApplicationRow(row: DbRow): OfferApplication {
  return {
    kind: 'application',
    id: row.id,
    technicianId: row.technician_id,
    offerId: row.offer_id,
    companyId: row.company_id,
    status: row.status as OfferRequestStatus,
    identityRevealed: Boolean(row.identity_revealed),
    documentsUnlocked: Boolean(row.documents_unlocked),
    coverNote: row.cover_note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapChatRoomRow(row: DbRow): ChatRoom {
  return {
    id: row.id,
    offerRequestId: row.offer_request_id ?? undefined,
    offerApplicationId: row.offer_application_id ?? undefined,
    technicianId: row.technician_id,
    companyId: row.company_id,
    createdAt: row.created_at,
  };
}

export function mapChatMessageRow(row: DbRow): ChatMessage {
  return {
    id: row.id,
    chatRoomId: row.chat_room_id,
    senderUserId: row.sender_user_id,
    senderCompanyMemberId: row.sender_company_member_id ?? undefined,
    senderRole: row.sender_role as SenderRole,
    body: row.body,
    sentAt: row.sent_at,
  };
}

/**
 * Tipos de perfil de un lote de técnicos, desde `technician_profile_types`
 * (migración 048).
 *
 * ES LA ÚNICA FUENTE que el código lee. La columna
 * `technician_profiles.technician_type` sigue existiendo y sigue
 * escribiéndose en el alta, pero NO se lee en ninguna parte: es una copia
 * del primer tipo, en espera de la migración que la retire. Leerla en
 * cualquier sitio reabriría exactamente el problema que la tabla puente
 * resuelve (un perfil con dos tipos que aparenta tener uno).
 *
 * `.order('type_code')` para que la lista se pinte siempre igual entre
 * pantallas y recargas — sin él, el orden lo decide Postgres y dos tarjetas
 * del mismo técnico pueden salir con los tipos permutados.
 */
export async function loadTechnicianProfileTypes(technicianIds: string[]): Promise<Record<string, TechnicianTypeCode[]>> {
  const uniqueIds = [...new Set(technicianIds)].filter(Boolean);
  const map: Record<string, TechnicianTypeCode[]> = {};
  for (const id of uniqueIds) map[id] = [];
  if (uniqueIds.length === 0) return map;

  const { data, error } = await supabase
    .from('technician_profile_types')
    .select('technician_id, type_code')
    .in('technician_id', uniqueIds)
    .order('type_code');
  throwIfError(error);
  for (const row of (data ?? []) as DbRow[]) {
    map[row.technician_id]?.push(row.type_code as TechnicianTypeCode);
  }
  return map;
}

export async function loadTechnicianRelations(technicianIds: string[]): Promise<Record<string, {
  licenses: TechnicianLicense[];
  habilitations: TechnicianHabilitation[];
  technicianTypes: TechnicianTypeCode[];
  aircraftExperience: TechnicianAircraftExperience[];
  engines: TechnicianEngineExperience[];
}>> {
  const uniqueIds = [...new Set(technicianIds)].filter(Boolean);
  const map: Record<string, {
    licenses: TechnicianLicense[];
    habilitations: TechnicianHabilitation[];
    technicianTypes: TechnicianTypeCode[];
    aircraftExperience: TechnicianAircraftExperience[];
    engines: TechnicianEngineExperience[];
  }> = {};
  for (const id of uniqueIds) {
    map[id] = { licenses: [], habilitations: [], technicianTypes: [], aircraftExperience: [], engines: [] };
  }
  if (uniqueIds.length === 0) return map;

  // QUINTA relación desde la Fase 10 (motores declarados, migración 068).
  // Sigue siendo UN lote por tabla, no una consulta por técnico: es lo que
  // hace que la búsqueda de empresa no se convierta en N+1 al crecer el
  // número de resultados.
  const [licensesRes, habsRes, types, experienceRes, enginesRes] = await Promise.all([
    supabase.from('technician_licenses').select('id, technician_id, authority, license_code, issued_at, expires_at, created_at').in('technician_id', uniqueIds),
    supabase.from('technician_habilitations').select('id, technician_id, technician_license_id, license_code, aircraft_type_rating_id, experience_years, is_current, issued_at, expires_at, created_at').in('technician_id', uniqueIds),
    loadTechnicianProfileTypes(uniqueIds),
    // `signed` existe desde la 094: aplicar la migración antes de desplegar esto.
    supabase.from('technician_aircraft_experience').select('id, technician_id, aircraft_type_rating_id, years, signed, created_at').in('technician_id', uniqueIds),
    supabase.from('technician_engine_experience').select('id, technician_id, engine_id, years, created_at').in('technician_id', uniqueIds),
  ]);
  throwIfError(licensesRes.error);
  throwIfError(habsRes.error);
  throwIfError(experienceRes.error);
  throwIfError(enginesRes.error);
  for (const id of uniqueIds) map[id].technicianTypes = types[id] ?? [];

  for (const row of (experienceRes.data ?? []) as DbRow[]) {
    map[row.technician_id]?.aircraftExperience.push({
      id: row.id,
      technicianId: row.technician_id,
      aircraftTypeRatingId: row.aircraft_type_rating_id,
      // `?? undefined` y NO `?? 0`: NULL es "no declarado" y 0 es "declarado
      // sin años". Convertirlo a 0 inventaría una declaración.
      years: row.years ?? undefined,
      signed: row.signed === true,
      createdAt: row.created_at,
    });
  }

  for (const row of (enginesRes.data ?? []) as DbRow[]) {
    map[row.technician_id]?.engines.push({
      id: row.id,
      technicianId: row.technician_id,
      engineId: row.engine_id,
      // Misma regla que en aeronaves: NULL es "no declarado", 0 es
      // "declarado sin años". Los años no puntúan en ningún caso.
      years: row.years ?? undefined,
      createdAt: row.created_at,
    });
  }

  for (const row of (licensesRes.data ?? []) as DbRow[]) {
    map[row.technician_id]?.licenses.push({
      id: row.id,
      technicianId: row.technician_id,
      // Fase 10: la autoridad viaja SIEMPRE con el código. Es NOT NULL en la
      // base, así que un undefined aquí sólo puede venir de un select que se
      // olvidó de pedirla — y eso hay que verlo, no rellenarlo con 'EASA'.
      authority: row.authority,
      licenseCode: row.license_code,
      issuedAt: row.issued_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      createdAt: row.created_at,
    });
  }
  for (const row of (habsRes.data ?? []) as DbRow[]) {
    map[row.technician_id]?.habilitations.push({
      id: row.id,
      technicianId: row.technician_id,
      // De qué CREDENCIAL cuelga. El scorer cruza por esto, no por el código:
      // con dos B1.1 de autoridades distintas el código no distingue.
      technicianLicenseId: row.technician_license_id,
      licenseCode: row.license_code,
      aircraftTypeRatingId: row.aircraft_type_rating_id ?? undefined,
      experienceYears: row.experience_years ?? undefined,
      isCurrent: row.is_current ?? undefined,
      issuedAt: row.issued_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      createdAt: row.created_at,
    });
  }
  return map;
}

export function mapPrivateTechnicianRow(row: DbRow, relations?: Awaited<ReturnType<typeof loadTechnicianRelations>>[string]): TechnicianWithRelations {
  return {
    id: row.id,
    userId: row.user_id,
    anonymousCode: row.anonymous_code,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone ?? undefined,
    birthDate: row.birth_date ?? '1970-01-01',
    technicianTypes: relations?.technicianTypes ?? [],
    ...persistedLocationFromRow(row),
    availability: mapAvailability(row.availability),
    yearsExperience: row.years_experience ?? undefined,
    verificationStatus: row.verification_status as VerificationStatus,
    socialLinks: row.social_links ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    licenses: relations?.licenses ?? [],
    habilitations: relations?.habilitations ?? [],
    aircraftExperience: relations?.aircraftExperience ?? [],
    engines: relations?.engines ?? [],
  };
}

export function mapPublicTechnicianRow(row: DbRow, relations?: Awaited<ReturnType<typeof loadTechnicianRelations>>[string]): SafeTechnicianPreview {
  return {
    id: row.id,
    anonymousCode: row.anonymous_code,
    technicianTypes: relations?.technicianTypes ?? [],
    country: row.country ?? '',
    city: row.city ?? '',
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    ...persistedLocationFromRow(row),
    licenses: (relations?.licenses ?? []).map((license) => ({ authority: license.authority, licenseCode: license.licenseCode })),
    habilitations: relations?.habilitations ?? [],
    aircraftExperience: relations?.aircraftExperience ?? [],
    engines: relations?.engines ?? [],
    yearsExperience: row.years_experience ?? undefined,
    availability: mapAvailability(row.availability),
    verificationStatus: row.verification_status as VerificationStatus,
  };
}

export function mapPublicTechnicianView(row: DbRow, relations?: Awaited<ReturnType<typeof loadTechnicianRelations>>[string], documents: Document[] = []): TechnicianView {
  const preview = mapPublicTechnicianRow(row, relations);
  if (!row.first_name || !row.last_name || !row.email) return preview;
  const unlocked: UnlockedTechnicianView = {
    ...preview,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone ?? undefined,
    socialLinks: row.social_links ?? undefined,
    documents,
  };
  return unlocked;
}

export function mapCatalogRequestRow(row: DbRow): CatalogRequest {
  return {
    id: row.id,
    requestedBy: row.requested_by,
    rawText: row.raw_text,
    context: row.context ?? undefined,
    status: row.status,
    resolvedAircraftTypeRatingId: row.resolved_aircraft_type_rating_id ?? undefined,
    adminNotes: row.admin_notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function publicRowToPrivateCompat(row: DbRow, relations?: Awaited<ReturnType<typeof loadTechnicianRelations>>[string]): TechnicianWithRelations {
  const now = new Date().toISOString();
  return {
    id: row.id,
    userId: row.user_id ?? '',
    anonymousCode: row.anonymous_code,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? undefined,
    // `technician_public_view` NO expone `birth_date` NI `age` (migración 040:
    // la edad se retiró del contrato público por ser característica protegida).
    // Aquí va cadena vacía, NUNCA una fecha inventada: el placeholder
    // '1970-01-01' que había antes producía "56 años" para TODOS los técnicos
    // que veía una empresa.
    birthDate: '',
    technicianTypes: relations?.technicianTypes ?? [],
    // Fase 7 F2d: aquí se leía `row.location_city_id`, y era la última fuga.
    // `technician_public_view` ya no lo expone —PUBLIC_SELECT dejó de pedirlo
    // y la migración 061 recrea la vista sin él—, así que el campo llegaba
    // `undefined` sin que nada avisara. Mismo patrón que OFFER_COLUMNS sin
    // `license_code` y que los dos fallos de `offerPatchToDb`: un dato que
    // deja de viajar en silencio. La línea de abajo ya aporta la
    // localización entera desde las columnas nuevas.
    ...persistedLocationFromRow(row),
    availability: mapAvailability(row.availability),
    yearsExperience: row.years_experience ?? undefined,
    verificationStatus: row.verification_status as VerificationStatus,
    socialLinks: row.social_links ?? undefined,
    createdAt: row.created_at ?? now,
    updatedAt: row.updated_at ?? now,
    licenses: relations?.licenses ?? [],
    habilitations: relations?.habilitations ?? [],
    aircraftExperience: relations?.aircraftExperience ?? [],
    engines: relations?.engines ?? [],
  };
}
