import { supabase } from '../../lib/supabase';
import { locationColumns } from '../../utils/locationBridge';
import { PersistedLocation } from '../../types/location';
import {
  Availability,
  SocialLinks,
  TechnicianProfile,
  TechnicianWithRelations,
} from '../../types/technician';
import type { OwnProfileColumnsPatch } from '../../types/technicianProfileEdit';
import { SafeTechnicianPreview, TechnicianView, isUnlocked } from '../../types/privacy';
import { TechnicianMatchCandidate } from '../../types/matching';
import { LicenseCode } from '../../types/catalog';
import { typesLockedByLicenses } from '../../constants/licenses';
import { technicianTypeLabel } from '../../constants/technicianTypes';
import { buildAircraftRatingIndex } from '../../constants/aircraftTypeRatings';
import { catalogRepository } from './catalogRepository';
import {
  DbRow,
  loadTechnicianProfileTypes,
  loadTechnicianRelations,
  mapAvailability,
  mapPrivateTechnicianRow,
  mapPublicTechnicianRow,
  mapPublicTechnicianView,
  publicRowToPrivateCompat,
  throwIfError,
  throwIfNoRows,
} from './supabaseMappers';
import { documentRepositoryV2 } from './documentRepositoryV2';
import { planLicenseRemovalById, LicenseEntry } from '../../utils/licenseUpdatePlan';
import { AuthorityCode } from '../../types/catalog';
import { credentialLabel } from '../../constants/licenses';
// Fase 10, paso 5b: aquí vivía DEFAULT_AUTHORITY = 'EASA', el relleno de la
// autoridad mientras el perfil no la pedía. Se retira con el selector de
// autoridad del perfil: un olvido falla a la vista, no se rellena aquí.
import { matchesTechnicianSearch, type TechnicianSearchQuery } from '../../utils/technicianSearchFilterMatch';
import { explainHabilitationScopeRejection, HabilitationCredential, isHabilitationScopeRejection } from '../../utils/profileHabilitationValidation';

// `technician_type` (singular) NO se pide en ninguno de los dos SELECT desde
// la Fase 6 tanda A: los tipos salen de `technician_profile_types` vía
// loadTechnicianProfileTypes(). La columna sigue en la tabla y en la vista
// hasta la migración que la retire, pero pedirla aquí sería mantener viva la
// fuente que la tabla puente sustituye.
//
// `profile_completeness` tampoco se pide desde el 2026-08-10: el porcentaje
// de completitud se retiró entero, y la migración 049 YA BORRÓ la columna.
// Dejar de pedirla tuvo que ir ANTES del DROP (expand-contract) porque un
// SELECT explícito de una columna inexistente no se ignora: revienta TODAS
// las consultas de la tabla. Volver a nombrarla aquí ya no es un despiste,
// es una caída.
// Fase 7 F2b: entran las cinco columnas del modelo nuevo (migración 057).
// Fase 7 F2d: `location_city_id` SALE de los dos SELECT. Dejar de pedirlo va
// ANTES de su DROP (expand-contract): un SELECT de una columna inexistente
// revienta todas las consultas de la tabla.
const PRIVATE_SELECT = `
  id, user_id, anonymous_code, first_name, last_name, email, phone, birth_date, photo_path,
  location_country_code, location_city_name,
  location_city_lat, location_city_lng, location_city_geoname_id,
  availability, years_experience,
  verification_status, social_links, created_at, updated_at
`;

// Las mismas cinco sobre `technician_public_view`, que la 057 recreó para
// exponerlas. `country`, `city`, `base_airport`, `latitude` y `longitude`
// siguen aquí — son las derivadas del aeropuerto, y las pantallas las leen
// hasta F2c.
const PUBLIC_SELECT = `
  id, anonymous_code, country, city, latitude, longitude,
  location_country_code, location_city_name,
  location_city_lat, location_city_lng, location_city_geoname_id,
  availability, years_experience,
  verification_status, first_name, last_name, email,
  phone, social_links, photo_path
`;

// Sub-fase de experiencia (2026-07-28) — FILTRO DURO, en el servidor.
//
// Traduce offer.minYearsExperience a un predicado de PostgREST, NO a un
// post-filtrado en JS. Es el unico filtro de este repositorio que corre de
// verdad en Postgres; los otros ocho siguen aplicandose en
// matchesSearchFilters() sobre las filas ya traidas (deuda inventariada en
// docs/MISSION_PART66.md, agravada por el tope de 1000 filas de PostgREST).
//
// La clausula `.is.null` NO es un detalle: ES la regla de producto "la
// ausencia de dato nunca penaliza", escrita en SQL. Excluye solo a quien
// tenga un valor DECLARADO por debajo del minimo; quien no ha declarado
// nada sigue apareciendo y la UI lo muestra como "not specified".
// Si alguna vez lo cambias a un `.gte()` a secas, estaras excluyendo
// silenciosamente a todo el que no haya rellenado el campo.
function applyMinYearsFilter<T extends { or: (f: string) => T }>(query: T, minYears?: number): T {
  if (!minYears || minYears <= 0) return query;
  return query.or(`years_experience.is.null,years_experience.gte.${minYears}`);
}

// ── Fase 5.6 (2026-07-28) — recorte visible en vez de silencioso ──────
//
// PostgREST corta cualquier respuesta en 1000 filas sin error ni aviso
// (comprobado: `Content-Range: 0-999/2500`). Las dos consultas de abajo
// traen filas de technician_public_view y aplican DESPUES, en JS, la mayor
// parte de sus filtros (matchesSearchFilters) — asi que un recorte no solo
// pierde resultados: hace que el filtro opere sobre un subconjunto
// arbitrario. Correctitud, no escalabilidad.
//
// MITIGACION, no arreglo. El arreglo de fondo es llevar los 8 filtros al
// servidor (backlog "search(): filtros a server-side", con alcance en
// docs/MISSION_PART66.md). Mientras tanto: rango explicito, conteo exacto,
// y un aviso ruidoso cuando el total supera lo traido.
//
// A diferencia del catalogo de ratings, aqui NO se lanza: dejar la busqueda
// inutilizable seria peor que devolver los primeros N con un aviso. Esa es
// justo la diferencia entre "un catalogo parcial es inservible" y "una
// busqueda parcial sigue sirviendo".
const TECHNICIAN_FETCH_LIMIT = 1000;

function warnIfTruncated(context: string, fetched: number, total: number | null): void {
  if (total === null || total <= fetched) return;
  console.warn(
    `[technicianRepositoryV2.${context}] Truncated: fetched ${fetched} of ${total} technicians ` +
      `(limit ${TECHNICIAN_FETCH_LIMIT}). Filters are applied client-side AFTER this fetch, so results ` +
      'are computed over a partial set. See docs/MISSION_PART66.md — backlog "search(): filtros a server-side".',
  );
}

function privatePatchToDb(patch: Partial<Omit<TechnicianProfile, 'id' | 'userId' | 'createdAt' | 'technicianTypes'>>): Record<string, unknown> {
  return {
    ...(patch.anonymousCode !== undefined ? { anonymous_code: patch.anonymousCode } : {}),
    ...(patch.firstName !== undefined ? { first_name: patch.firstName } : {}),
    ...(patch.lastName !== undefined ? { last_name: patch.lastName } : {}),
    ...(patch.email !== undefined ? { email: patch.email } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone ?? null } : {}),
    ...(patch.birthDate !== undefined ? { birth_date: patch.birthDate } : {}),
    // `technicianTypes` NO se escribe aquí: vive en la tabla puente, no en una
    // columna de technician_profiles. Va por replaceProfileTypes().
    // Fase 7 F2c: escritura DIRECTA de país y ciudad. Las cinco columnas van
    // siempre juntas — `locationColumns()` no deja escribir sólo algunas, y
    // por eso cambiar de país limpia las coordenadas de la ciudad anterior en
    // vez de dejarlas colgando.
    //
    // `location_city_id` ya no se escribe: el perfil dejó de elegir
    // aeropuerto. La columna sigue existiendo (la 060 sólo la hizo opcional)
    // para las filas anteriores, hasta su propia migración de retirada.
    ...(patch.locationCountryCode !== undefined ? locationColumns(patch as PersistedLocation) : {}),
    ...(patch.availability !== undefined ? {
      // Sólo `immediately` y `contract_types`. `status` es etiqueta de UI y
      // NUNCA se persiste; `available_from` se retiró en la 041.
      availability: {
        immediately: Boolean(patch.availability.immediately),
        contract_types: patch.availability.contractTypes ?? [],
      },
    } : {}),
    ...(patch.yearsExperience !== undefined ? { years_experience: patch.yearsExperience ?? null } : {}),
    ...(patch.socialLinks !== undefined ? { social_links: patch.socialLinks ?? null } : {}),
  };
}

// Qué técnicos entran en una búsqueda —pantalla de búsqueda y mapa de empresa,
// los dos llamadores de search()— lo decide UNA función pura y probada,
// matchesTechnicianSearch (src/utils/technicianSearchFilterMatch.ts). Vivía
// aquí como matchesSearchFilters; se movió para poder probarla sin red
// (rediseño, fase 3B).

async function getPublicRow(id: string): Promise<DbRow | null> {
  const { data, error } = await supabase
    .from('technician_public_view')
    .select(PUBLIC_SELECT)
    .eq('id', id)
    .maybeSingle();
  throwIfError(error);
  return (data as DbRow | null) ?? null;
}

export const technicianRepositoryV2 = {
  async getAll(): Promise<TechnicianProfile[]> {
    const { data, error } = await supabase
      .from('technician_profiles')
      .select(PRIVATE_SELECT)
      .order('created_at', { ascending: false });
    throwIfError(error);
    const rows = (data ?? []) as DbRow[];
    // Un lote, no una consulta por técnico: estas tres rutas devuelven
    // TechnicianProfile SIN relaciones, así que cargan los tipos por su
    // cuenta en vez de arrastrar licencias y habilitaciones que después
    // desechan.
    const types = await loadTechnicianProfileTypes(rows.map((row) => row.id));
    return rows.map((row) => {
      const full = mapPrivateTechnicianRow(row);
      const { licenses: _licenses, habilitations: _habilitations, ...profile } = full;
      return { ...profile, technicianTypes: types[row.id] ?? [] };
    });
  },

  // getPublicProfiles() eliminado (Fase 10, paso 5b): su único llamante era
  // el bucle de getTechnicianMatchesForOffer, que el paso 5a sustituyó por
  // getPublicMatchCandidates (misma consulta, con las relaciones en lote).

  async getById(id: string): Promise<TechnicianProfile | null> {
    const { data, error } = await supabase
      .from('technician_profiles')
      .select(PRIVATE_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (!error && data) {
      const full = mapPrivateTechnicianRow(data as DbRow);
      const { licenses: _licenses, habilitations: _habilitations, ...profile } = full;
      return { ...profile, technicianTypes: (await loadTechnicianProfileTypes([id]))[id] ?? [] };
    }

    const publicRow = await getPublicRow(id);
    if (!publicRow) return null;
    const full = publicRowToPrivateCompat(publicRow);
    const { licenses: _licenses, habilitations: _habilitations, ...profile } = full;
    return { ...profile, technicianTypes: (await loadTechnicianProfileTypes([id]))[id] ?? [] };
  },

  async getLicenses(technicianId: string) {
    const relations = await loadTechnicianRelations([technicianId]);
    return relations[technicianId]?.licenses ?? [];
  },

  async getHabilitations(technicianId: string) {
    const relations = await loadTechnicianRelations([technicianId]);
    return relations[technicianId]?.habilitations ?? [];
  },

  // getAircraftExperience() eliminado con la tabla (migracion 031). Tenia
  // cero call sites y la tabla cero filas: la mitad de lectura de una feature
  // cuya mitad de escritura nunca se construyo.

  async getWithRelations(id: string): Promise<TechnicianWithRelations | null> {
    const relations = await loadTechnicianRelations([id]);
    const rel = relations[id];

    const { data, error } = await supabase
      .from('technician_profiles')
      .select(PRIVATE_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (!error && data) return mapPrivateTechnicianRow(data as DbRow, rel);

    const publicRow = await getPublicRow(id);
    if (!publicRow) return null;
    return publicRowToPrivateCompat(publicRow, rel);
  },

  /**
   * El perfil PROPIO con sus relaciones, para editarlo (rediseño, fase 6A;
   * antes lo leía la pantalla de perfil con supabase directamente).
   *
   * A diferencia de getWithRelations, NO cae a technician_public_view si la
   * lectura privada falla: lanza. Editar sobre la vista pública —que anula
   * nombre, email, teléfono y enlaces— y guardar después escribiría esos
   * huecos encima de los datos reales. null = no hay fila.
   */
  async getOwnWithRelations(id: string): Promise<TechnicianWithRelations | null> {
    const [{ data, error }, relations] = await Promise.all([
      supabase.from('technician_profiles').select(PRIVATE_SELECT).eq('id', id).maybeSingle(),
      loadTechnicianRelations([id]),
    ]);
    throwIfError(error);
    if (!data) return null;
    return mapPrivateTechnicianRow(data as DbRow, relations[id]);
  },

  /**
   * Los candidatos de una oferta, en un lote (Fase 10, paso 5a).
   *
   * Sustituye al bucle de getTechnicianMatchesForOffer, que llamaba a
   * getPublicProfiles y luego, por cada técnico y en serie, a
   * getPublicWithRelations y a getSafeView: dos lecturas de la vista y dos
   * cargas de relaciones (cinco tablas cada una) POR TÉCNICO. Aquí es una
   * lectura de la vista y un lote de relaciones para todos, igual que search().
   * Las dos primeras se borraron en el paso 5b al quedarse sin llamantes.
   *
   * Mismo conjunto que antes: sólo verificados, y con el filtro duro de años
   * en el servidor.
   */
  async getPublicMatchCandidates(minYearsExperience?: number): Promise<TechnicianMatchCandidate[]> {
    const { data, error, count } = await applyMinYearsFilter(
      supabase
        .from('technician_public_view')
        .select(PUBLIC_SELECT, { count: 'exact' })
        .eq('verification_status', 'verified'),
      minYearsExperience,
    ).range(0, TECHNICIAN_FETCH_LIMIT - 1);
    throwIfError(error);
    warnIfTruncated('getPublicMatchCandidates', (data ?? []).length, count ?? null);

    const rows = (data ?? []) as DbRow[];
    const relations = await loadTechnicianRelations(rows.map((row) => row.id));
    return rows.map((row) => ({
      technician: publicRowToPrivateCompat(row, relations[row.id]),
      preview: mapPublicTechnicianView(row, relations[row.id]),
    }));
  },

  async getSafeView(id: string): Promise<SafeTechnicianPreview | null> {
    const publicRow = await getPublicRow(id);
    if (!publicRow) return null;
    const relations = await loadTechnicianRelations([id]);
    return mapPublicTechnicianRow(publicRow, relations[id]);
  },

  async getViewForCompany(id: string, _companyId: string): Promise<TechnicianView | null> {
    const publicRow = await getPublicRow(id);
    if (!publicRow) return null;
    const relations = await loadTechnicianRelations([id]);
    const preview = mapPublicTechnicianView(publicRow, relations[id]);
    if (!isUnlocked(preview)) return preview;
    const documents = await documentRepositoryV2.getVerifiedForTechnician(id);
    return { ...preview, documents };
  },

  async update(id: string, patch: Partial<Omit<TechnicianProfile, 'id' | 'userId' | 'createdAt'>>): Promise<TechnicianProfile | null> {
    const { data, error } = await supabase
      .from('technician_profiles')
      .update(privatePatchToDb(patch))
      .eq('id', id)
      .select(PRIVATE_SELECT)
      .maybeSingle();
    throwIfError(error);
    if (!data) return null;
    const full = mapPrivateTechnicianRow(data as DbRow);
    const { licenses: _licenses, habilitations: _habilitations, ...profile } = full;
    return profile;
  },

  /**
   * Las dos columnas JSON del perfil propio, leídas justo antes de escribir
   * UNA de sus claves (rediseño, fase 6A). `availability` guarda la
   * disponibilidad y los contratos juntos, y cada cosa se guarda ahora desde
   * su pantalla: escribir los contratos con la disponibilidad que la pantalla
   * cargó hace un rato pisaría un cambio hecho después. Por eso el caso de uso
   * relee aquí la clave que no toca. null = la fila no se puede leer.
   */
  async getOwnJsonColumns(id: string): Promise<{ availability: Availability; socialLinks: SocialLinks | null } | null> {
    const { data, error } = await supabase
      .from('technician_profiles')
      .select('availability, social_links')
      .eq('id', id)
      .maybeSingle();
    throwIfError(error);
    if (!data) return null;
    const row = data as DbRow;
    return { availability: mapAvailability(row.availability), socialLinks: (row.social_links as SocialLinks | null) ?? null };
  },

  /**
   * Escribe en `technician_profiles` SÓLO las columnas presentes en `patch`
   * (rediseño, fase 6A: cada pantalla del perfil guarda lo suyo). Devuelve
   * false si la fila no se actualizó: `.select('id')` no es decorativo, sin él
   * un bloqueo de RLS (p. ej. la cuenta deja de estar `active`) daría 0 filas
   * y CERO error, y la pantalla diría "guardado" sin haber guardado nada.
   */
  async updateOwnProfile(id: string, patch: OwnProfileColumnsPatch): Promise<boolean> {
    const row: Record<string, unknown> = {
      ...(patch.firstName !== undefined ? { first_name: patch.firstName } : {}),
      ...(patch.lastName !== undefined ? { last_name: patch.lastName } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      // Las cinco columnas juntas: cambiar de país limpia las coordenadas de
      // la ciudad anterior en vez de dejarlas.
      ...(patch.location !== undefined ? locationColumns(patch.location) : {}),
      // Sólo `immediately` y `contract_types`; `status` nunca se persiste.
      ...(patch.availability !== undefined
        ? { availability: { immediately: patch.availability.immediately, contract_types: patch.availability.contractTypes } }
        : {}),
      ...(patch.yearsExperience !== undefined ? { years_experience: patch.yearsExperience } : {}),
      ...(patch.socialLinks !== undefined ? { social_links: patch.socialLinks } : {}),
    };
    if (Object.keys(row).length === 0) return true;
    const { data, error } = await supabase
      .from('technician_profiles')
      .update(row)
      .eq('id', id)
      .select('id');
    throwIfError(error);
    return (data ?? []).length > 0;
  },

  /**
   * Reemplaza los tipos de perfil de un técnico (Fase 6 tanda A).
   *
   * Diferencial, NO borrar-e-insertar: se calcula qué sobra y qué falta y se
   * tocan sólo esas filas. Un DELETE completo seguido de INSERT dejaría al
   * técnico sin ningún tipo durante un instante, y como no hay transacción
   * desde el cliente, un fallo de red entre las dos mitades lo dejaría así
   * de forma permanente — sin tipos, que es un estado que el modelo prohíbe.
   * Guardar sin cambiar nada no escribe.
   *
   * `codes` vacío se rechaza aquí y no en la pantalla: el mínimo de uno es
   * regla del modelo, y la pantalla no puede ser el único sitio donde vive.
   *
   * Por lo mismo, `licenseCodes` (2026-08-13): una licencia declarada IMPLICA
   * su oficio, así que un conjunto de tipos al que le falte alguno implicado
   * se RECHAZA, igual que el conjunto vacío — no se completa en silencio.
   * Desde el 2026-10-02, sólo los que la licencia BLOQUEA
   * (typesLockedByLicenses): la FAA A y la A&P marcan Mechanic sin exigirlo.
   * Completarlo escribiría algo distinto de lo que el llamante pidió y le
   * diría "guardado", que es la clase de éxito falso que este repositorio
   * evita en todas partes; y el único llamante ya marca esos tipos solo, así
   * que llegar aquí sin ellos es un fallo de programación, no un descuido del
   * técnico. La pantalla nunca debería ver este error.
   *
   * ⚠ `licenseCodes` son las licencias que van a QUEDAR después del guardado
   * en curso, no las que hay en la base: este método corre ANTES de que se
   * escriban las licencias (ver saveWork en src/usecases/technicianProfile.ts), así que un
   * guardado que las reduce tiene que calcular los implicados sobre las
   * nuevas o se rechazaría a sí mismo.
   */
  async replaceProfileTypes(technicianId: string, codes: string[], licenseCodes: readonly string[]): Promise<void> {
    const next = [...new Set(codes)].filter(Boolean);
    if (next.length === 0) {
      throw new Error('Select at least one technician type.');
    }

    const missing = typesLockedByLicenses(licenseCodes).filter((t) => !next.includes(t));
    if (missing.length > 0) {
      throw new Error(
        `These profile types come from licences you hold and cannot be removed: ${missing
          .map(technicianTypeLabel)
          .join(', ')}. Remove the licence first if the type should come off.`,
      );
    }

    const { data: existingRows, error: selectError } = await supabase
      .from('technician_profile_types')
      .select('type_code')
      .eq('technician_id', technicianId);
    throwIfError(selectError);
    const existing = (existingRows ?? []).map((r: any) => r.type_code as string);

    const toRemove = existing.filter((c) => !next.includes(c));
    const toAdd = next.filter((c) => !existing.includes(c));

    if (toAdd.length > 0) {
      const { data, error } = await supabase
        .from('technician_profile_types')
        .insert(toAdd.map((code) => ({ technician_id: technicianId, type_code: code })))
        .select('type_code');
      throwIfError(error);
      // Hay filas que insertar, así que 0 filas sólo puede ser RLS
      // (tpt_insert_own) bloqueando — nunca un no-op legítimo.
      throwIfNoRows(data, 'Could not save your profile types — your session may have expired. Sign in again and retry.');
    }

    // Los añadidos van ANTES que los borrados: si el INSERT falla, el técnico
    // conserva los tipos que ya tenía en vez de quedarse sin ninguno.
    if (toRemove.length > 0) {
      const { data, error } = await supabase
        .from('technician_profile_types')
        .delete()
        .eq('technician_id', technicianId)
        .in('type_code', toRemove)
        .select('type_code');
      throwIfError(error);
      throwIfNoRows(data, 'Could not remove the deselected profile types — your session may have expired.');
    }
  },

  /**
   * Upserts (insert-or-update-in-place) the technician's held licenses —
   * NEVER deletes. Callers that also save habilitations in the same flow
   * (e.g. the profile screen) must call this BEFORE replaceHabilitations(),
   * so a brand-new license code already has a row by the time a
   * habilitation references it — technician_habilitations' composite FK
   * (fk_technician_habilitations_license, migration 016/018) requires the
   * (technician_id, license_code) pair to pre-exist. Pair with
   * removeUnreferencedLicenses() for the deletion half.
   */
  async upsertLicenses(technicianId: string, entries: LicenseEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const { data, error } = await supabase
      .from('technician_licenses')
      .upsert(
        entries.map((e) => ({
          technician_id: technicianId,
          // Fase 10: NOT NULL y sin default en la base (073). Paso 5b: la manda
          // el perfil; LicenseEntry la exige.
          authority: e.authority,
          license_code: e.code,
          issued_at: e.issuedAt ?? null,
          expires_at: e.expiresAt ?? null,
        })),
        // ⚠ LITERAL DE CADENA, Y NINGÚN COMPILADOR LO MIRA. Tiene que nombrar
        // las columnas de una constraint única REAL o Postgres devuelve 42P10
        // y TODOS los guardados de licencia fallan. Copiado de
        // uq_technician_licenses_authority_code (073), en su orden:
        //   UNIQUE (technician_id, authority, license_code)
        // Si esa constraint cambia, esta cadena cambia con ella.
        { onConflict: 'technician_id,authority,license_code' },
      )
      .select('id, authority, license_code');
    throwIfError(error);
    // Hay entradas que escribir, así que 0 filas sólo puede significar que RLS
    // (tl_insert_own / tl_update_own) no dejó pasar ninguna — nunca un no-op
    // legítimo.
    throwIfNoRows(data, 'Could not save your licences — your session may have expired. Sign in again and retry.');
  },

  /**
   * Deletes license rows the technician no longer wants (any existing code
   * absent from `nextCodes`) — but ONLY the ones no habilitation still
   * references; a delete-then-reinsert of a still-referenced row fails
   * outright against fk_technician_habilitations_license (see
   * upsertLicenses' comment), and deleting the technician's real
   * habilitations just to force the license delete through would be worse.
   * Call this AFTER replaceHabilitations() in any flow that saves both in
   * the same action, so the dependency check reflects the technician's
   * actual final state instead of a stale pre-save snapshot. Returns the
   * codes that could NOT be removed, so the caller can tell the technician
   * why instead of surfacing a DB error.
   */
  async removeUnreferencedLicenses(
    technicianId: string,
    next: { authority: string; code: string }[],
  ): Promise<{ blocked: string[] }> {
    const { data: existingRows, error: selectError } = await supabase
      .from('technician_licenses')
      .select('id, authority, license_code')
      .eq('technician_id', technicianId);
    throwIfError(selectError);
    const existing = (existingRows ?? []).map((r: any) => ({
      id: r.id as string,
      authority: r.authority as string,
      code: r.license_code as string,
    }));

    // Paso 5b: el filtro es por CREDENCIAL (autoridad + código), no por
    // código. Hasta que el perfil supo elegir autoridad, desmarcar "B1.1"
    // quería decir "ninguna B1.1"; ahora el técnico puede quitar su B1.1 EASA
    // y quedarse con la UK CAA, y un filtro por código borraría las dos.
    const nextSet = new Set(next.map((l) => `${l.authority}|${l.code}`));
    const candidates = existing.filter((l) => !nextSet.has(`${l.authority}|${l.code}`));
    if (candidates.length === 0) return { blocked: [] };

    const candidateIds = candidates.map((l) => l.id);
    const { data: depRows, error: depError } = await supabase
      .from('technician_habilitations')
      .select('technician_license_id')
      .eq('technician_id', technicianId)
      .in('technician_license_id', candidateIds);
    throwIfError(depError);
    const dependents = (depRows ?? []).map((r: any) => ({ technicianLicenseId: r.technician_license_id as string }));

    const plan = planLicenseRemovalById(candidateIds, dependents);

    if (plan.deletes.length > 0) {
      const { data: deleted, error: deleteError } = await supabase
        .from('technician_licenses')
        .delete()
        .eq('technician_id', technicianId)
        .in('id', plan.deletes)
        .select('id');
      throwIfError(deleteError);
      // plan.deletes sale de filas que acabamos de leer, así que si no cae
      // ninguna es que RLS bloqueó el borrado, no que ya no estuvieran.
      throwIfNoRows(deleted, 'Could not remove the deselected licences — your session may have expired.');
    }

    // El aviso que ve el técnico habla de CREDENCIALES ("EASA B1.1"), no de ids.
    const byId = new Map(candidates.map((l) => [l.id, credentialLabel(l.authority, l.code)]));
    return { blocked: plan.blocked.map((id) => byId.get(id) ?? id) };
  },

  /**
   * Replaces a technician's normalized habilitations with an explicit set of
   * { licenseCode, aircraftTypeRatingId } pairs. Never infers or defaults the
   * license — every row must name its own category.
   *
   * Fase 5.3 (2026-07-28): this used to spare rows without a rating id (the
   * legacy aircraft_type_code ones) from the delete. That exemption is gone
   * with the legacy catalog — every habilitation carries a rating id, and
   * migration 029 makes that a NOT NULL invariant.
   */
  async replaceHabilitations(
    technicianId: string,
    entries: {
      licenseCode: string;
      /** La autoridad de la licencia de la que cuelga. Obligatoria desde el paso 5b. */
      authority: AuthorityCode;
      aircraftTypeRatingId: string;
      issuedAt?: string;
      expiresAt?: string;
      experienceYears?: number;
      isCurrent?: boolean;
    }[],
  ): Promise<void> {
    const { error } = await supabase.rpc('replace_technician_habilitations', {
      p_technician_id: technicianId,
      p_entries: entries.map((entry) => ({
        authority: entry.authority,
        license_code: entry.licenseCode,
        aircraft_type_rating_id: entry.aircraftTypeRatingId,
        issued_at: entry.issuedAt ?? null,
        expires_at: entry.expiresAt ?? null,
        experience_years: entry.experienceYears ?? null,
        is_current: entry.isCurrent ?? true,
      })),
    });
    if (isHabilitationScopeRejection(error)) {
      throw new Error(await technicianRepositoryV2.describeHabilitationScopeRejection(entries));
    }
    throwIfError(error);
  },

  /** Read-only diagnosis also used by the profile when a credential upsert
   * hits 083's parent trigger before ratings are replaced. */
  async describeHabilitationScopeRejection(entries: readonly HabilitationCredential[]): Promise<string> {
    return explainHabilitationScopeRejection(entries,
        async () => buildAircraftRatingIndex(await catalogRepository.getAircraftTypeRatingsByIds(entries.map((e) => e.aircraftTypeRatingId))),
        async (entry) => {
          const { data, error: diagnosticError } = await supabase.rpc('individual_type_rating_scope_error', {
            p_authority: entry.authority, p_license_code: entry.licenseCode, p_rating_id: entry.aircraftTypeRatingId,
          });
          throwIfError(diagnosticError);
          return data as string | null;
        });
  },

  /**
   * Reemplaza la experiencia declarada en aeronaves (Fase 6 tanda B).
   *
   * Semántica de REEMPLAZO, igual que replaceHabilitations y por el mismo
   * motivo estructural: la RLS de esta tabla es una copia de la de
   * technician_habilitations, que NO TIENE política de UPDATE — un guardado
   * diferencial que intentara actualizar los años en su sitio sería rechazado
   * por RLS. Si algún día hace falta, la política se añade primero y el código
   * después, nunca al revés.
   *
   * 084: el reemplazo es UNA RPC, es decir una transacción. Antes eran dos
   * sentencias, y el DELETE entraba solo: un INSERT que fallara después —años
   * fuera de rango, rating inexistente, RLS, red— dejaba al técnico SIN
   * experiencia mientras la pantalla decía "guardado". Era el último hueco de
   * H1. La RPC valida la lista entera antes de borrar nada.
   *
   * `technician_habilitations` no se toca aquí. Son dos listas separadas: una
   * dice que el técnico está autorizado a firmar, ésta que sabe hacer el
   * trabajo. Guardar una nunca escribe en la otra — la regla de la Tanda E
   * ("la licencia cuenta también como experiencia") se resuelve en LECTURA,
   * como unión de conjuntos, jamás copiando filas aquí.
   */
  async replaceAircraftExperience(
    technicianId: string,
    entries: { aircraftTypeRatingId: string; years?: number; signed?: boolean }[],
  ): Promise<void> {
    const { error } = await supabase.rpc('replace_technician_aircraft_experience', {
      p_technician_id: technicianId,
      p_entries: entries.map((entry) => ({
        aircraft_type_rating_id: entry.aircraftTypeRatingId,
        // `?? null` y no `?? 0`: NULL es "no declarado", 0 sería una
        // declaración de "sin años", que no es lo mismo.
        years: entry.years ?? null,
        // 094: la base rechaza true sin licencia FAA A o A&P.
        signed: entry.signed === true,
      })),
    });
    throwIfError(error);
  },

  /**
   * Reemplaza los motores declarados (Fase 10, paso 5b; tabla de la 068).
   *
   * Misma semántica de REEMPLAZO que replaceAircraftExperience y por el mismo
   * motivo: la RLS de technician_engine_experience está calcada de la de
   * experiencia en aeronaves y NO tiene política de UPDATE (tee_insert_own y
   * tee_delete_own, nada más). Los años son display-only: se guardan y nunca
   * puntúan.
   */
  async replaceEngineExperience(
    technicianId: string,
    entries: { engineId: string; years?: number }[],
  ): Promise<void> {
    const { error } = await supabase.rpc('replace_technician_engines', {
      p_technician_id: technicianId,
      p_entries: entries.map((entry) => ({ engine_id: entry.engineId, years: entry.years ?? null })),
    });
    throwIfError(error);
  },

  /** Deletes a single habilitation row by id. */
  async deleteHabilitation(id: string): Promise<void> {
    const { data, error } = await supabase
      .from('technician_habilitations')
      .delete()
      .eq('id', id)
      .select('id');
    throwIfError(error);
    throwIfNoRows(data, 'Could not remove this type rating — it may no longer exist, or you may not have permission.');
  },

  async search(filters: TechnicianSearchQuery): Promise<SafeTechnicianPreview[]> {
    const { data, error, count } = await applyMinYearsFilter(
      supabase.from('technician_public_view').select(PUBLIC_SELECT, { count: 'exact' }),
      filters.minYearsExperience,
    ).range(0, TECHNICIAN_FETCH_LIMIT - 1);
    throwIfError(error);
    warnIfTruncated('search', (data ?? []).length, count ?? null);

    const rows = (data ?? []) as DbRow[];
    const [relations, ratings] = await Promise.all([
      loadTechnicianRelations(rows.map((row) => row.id)),
      catalogRepository.getAircraftTypeRatings(),
    ]);
    const ratingIndex = buildAircraftRatingIndex(ratings);
    return rows
      .map((row) => mapPublicTechnicianRow(row, relations[row.id]))
      .filter((preview) => matchesTechnicianSearch(preview, filters, ratingIndex));
  },
};
