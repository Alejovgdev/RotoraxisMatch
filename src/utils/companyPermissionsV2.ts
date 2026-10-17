import { CompanyMemberRole } from '../types/enums';

// These helpers are frontend-only UI guards. The server enforces the same rules
// with the RLS policies in supabase/migrations/.

// Fase 5.4 (2026-07-28): todos aceptan `CompanyMemberRole | undefined`.
// `undefined` = la sesión de empresa todavía no está resuelta (o el perfil no
// tiene fila en company_members). Se responde SIEMPRE que no: fail-closed.
//
// Es deliberado que absorban el undefined aquí en vez de obligar a 10
// pantallas a repetir el mismo `role ? canX(role) : false`. Y es más seguro
// que lo anterior: antes, una sesión sin resolver llegaba como
// `companyMemberRole: 'viewer'` (el EMPTY_COMPANY que la 5.4 elimina), que
// es un rol REAL — la UI concedía permisos de viewer a una sesión inexistente.
// Ahora no concede ninguno hasta que hay rol de verdad.

// Type guard, no `boolean` a secas: tras comprobarlo, TypeScript sabe que el
// rol es exactamente 'admin'. Evita que las pantallas que ya han verificado
// el permiso tengan que volver a comprobar el undefined para indexar tablas
// de etiquetas (CompanyTeamManagement).
export function canManageCompanyMembers(role: CompanyMemberRole | undefined): role is 'admin' {
  return role === 'admin';
}

export function canManageCompanySettings(role: CompanyMemberRole | undefined): boolean {
  return role === 'admin';
}

export function canManageOffers(role: CompanyMemberRole | undefined): boolean {
  return role === 'admin' || role === 'recruiter';
}

export function canSendDirectOffers(role: CompanyMemberRole | undefined): boolean {
  return role === 'admin' || role === 'recruiter';
}

export function canReviewApplications(role: CompanyMemberRole | undefined): boolean {
  return role === 'admin' || role === 'recruiter';
}

export function canSendChatMessages(role: CompanyMemberRole | undefined): boolean {
  return role === 'admin' || role === 'recruiter';
}

/** Bloquear a un técnico (100). El viewer sólo denuncia; la base lo impone. */
export function canBlockContacts(role: CompanyMemberRole | undefined): boolean {
  return role === 'admin' || role === 'recruiter';
}
