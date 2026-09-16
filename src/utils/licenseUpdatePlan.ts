// Pure planning logic for technicianRepositoryV2.removeUnreferencedLicenses()
// — no Supabase import, unit-tested directly (see scripts/testMatching.ts).
//
// technician_habilitations references technician_licenses via a composite
// FK (technician_id, license_code) — fk_technician_habilitations_license,
// migration 016/018. A candidate license removal that's still referenced by
// a habilitation must never be deleted (the FK would reject it anyway) —
// it has to be reported back so the caller can tell the technician why,
// instead of surfacing a database error or, worse, deleting the
// habilitation out from under them to force the removal through.
export interface LicenseEntry {
  code: string;
  /**
   * La autoridad emisora. OBLIGATORIA desde el paso 5b, cuando el perfil
   * aprendió a elegirla: el repositorio ya no rellena 'EASA', y una licencia
   * sin autoridad no compila (y la base la rechazaría: NOT NULL sin default,
   * migración 073).
   */
  authority: string;
  issuedAt?: string;
  expiresAt?: string;
}

export interface LicenseRemovalPlan {
  // Candidate codes safe to delete — nothing still references them.
  deletes: string[];
  // Candidate codes that CANNOT be deleted because a habilitation still
  // references them.
  blocked: string[];
}

export function planLicenseRemoval(candidateCodes: string[], dependentCodes: string[]): LicenseRemovalPlan {
  const dependentSet = new Set(dependentCodes);
  return {
    deletes: candidateCodes.filter((c) => !dependentSet.has(c)),
    blocked: candidateCodes.filter((c) => dependentSet.has(c)),
  };
}

/**
 * La misma decisión, sobre la IDENTIDAD NUEVA (Fase 10, migración 074).
 *
 * Por qué no vale la de arriba: planea por CÓDIGO, y desde que un técnico
 * puede tener una B1.1 EASA y una B1.1 UK CAA, el código no nombra una
 * credencial. Borrar "la B1.1" borraba las dos, y una habilitación colgada de
 * la UK bloqueaba el borrado de la EASA.
 *
 * Aquí todo es por `technician_licenses.id`: cada candidata se compara con los
 * ids que las habilitaciones referencian en `technician_license_id`. Una
 * habilitación sin ese id (dato que no debería existir desde que la columna es
 * NOT NULL) NO bloquea a nadie — bloquear a ciegas impediría borrar cualquier
 * licencia.
 */
export function planLicenseRemovalById(
  candidateLicenseIds: string[],
  habilitations: { technicianLicenseId?: string }[],
): LicenseRemovalPlan {
  const dependentIds = new Set(
    habilitations.map((h) => h.technicianLicenseId).filter((id): id is string => Boolean(id)),
  );
  return {
    deletes: candidateLicenseIds.filter((id) => !dependentIds.has(id)),
    blocked: candidateLicenseIds.filter((id) => dependentIds.has(id)),
  };
}
