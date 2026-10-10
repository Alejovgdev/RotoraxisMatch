// Qué pestaña (móvil) y qué sección (escritorio) están activas para cada URL de
// empresa (docs/UI_REDESIGN.md, sección 2, y respuesta 6 de la revisión).
//
// Vive aquí, pura, porque las dos barras la comparten y porque la regla es de
// producto: qué pantalla "pertenece" a qué sección. Con pruebas en
// scripts/testCompanyNavigation.ts.

export type CompanyTab = 'home' | 'search' | 'inbox' | 'you';
export type CompanySection = 'home' | 'applications' | 'direct' | 'offers' | 'map' | 'team';

/** Las cuatro pantallas raíz de pestaña, las únicas que muestran la barra inferior. */
export const COMPANY_TAB_ROUTES: Record<CompanyTab, string> = {
  home: '/company',
  search: '/company/search',
  inbox: '/company/chats',
  you: '/company/profile',
};

export const COMPANY_SECTION_ROUTES: Record<CompanySection, string> = {
  home: '/company',
  applications: '/company/applications',
  direct: '/company/direct-offers',
  offers: '/company/offers',
  map: '/company/map',
  team: '/company/team',
};

export const COMPANY_POST_OFFER_ROUTE = '/company/offers/new';

function normalize(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function within(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** La pestaña activa, sólo en una pantalla raíz de pestaña. */
export function companyTabForPath(pathname: string): CompanyTab | null {
  const path = normalize(pathname);
  const match = (Object.keys(COMPANY_TAB_ROUTES) as CompanyTab[]).find((tab) => COMPANY_TAB_ROUTES[tab] === path);
  return match ?? null;
}

/**
 * La sección de la barra superior que corresponde a una pantalla, incluidas
 * las interiores (una candidatura cuelga de Applications). Search, el perfil
 * de un técnico, Inbox y You no son secciones: devuelven null.
 */
export function companySectionForPath(pathname: string): CompanySection | null {
  const path = normalize(pathname);
  if (path === COMPANY_SECTION_ROUTES.home) return 'home';
  if (within(path, COMPANY_SECTION_ROUTES.applications)) return 'applications';
  if (within(path, COMPANY_SECTION_ROUTES.direct)) return 'direct';
  if (within(path, COMPANY_SECTION_ROUTES.offers)) return 'offers';
  if (within(path, COMPANY_SECTION_ROUTES.map)) return 'map';
  if (within(path, COMPANY_SECTION_ROUTES.team)) return 'team';
  return null;
}

/**
 * En escritorio, Inbox y You se marcan en la fila de arriba, no como sección.
 * Las pantallas que cuelgan de You (editar los datos de la empresa) también.
 */
export function companyTopActionForPath(pathname: string): 'inbox' | 'you' | null {
  const path = normalize(pathname);
  if (within(path, COMPANY_TAB_ROUTES.inbox)) return 'inbox';
  if (within(path, COMPANY_TAB_ROUTES.you)) return 'you';
  if (accountPageForPath(path)) return 'you';
  return null;
}

// ── Pantallas comunes de la cuenta (fase 8, decisión B) ──────────────────
//
// Settings, Help y las dos de borrar la cuenta viven fuera de /company y
// /technician (sus URLs no cambian), pero en escritorio se pintan dentro del
// marco del área de la sesión y cuelgan de You: marcan You en la barra
// superior y su fila en el menú lateral.

/**
 * Settings y lo que se abre desde ella: borrar la cuenta y los textos legales
 * (Privacy Policy y Terms, que también enlaza Help; con sesión llevan el marco
 * desde la fase 8).
 */
export const ACCOUNT_SETTINGS_ROUTES = ['/settings', '/account/delete', '/privacy-policy', '/terms-of-service'] as const;
/** Help y la página pública de cómo borrar la cuenta (a la que se llega desde Help). */
export const ACCOUNT_HELP_ROUTES = ['/support', '/delete-account'] as const;

/** Qué fila del menú lateral de cuenta corresponde a una pantalla común, o null. */
export function accountPageForPath(pathname: string): 'settings' | 'help' | null {
  const path = normalize(pathname);
  if ((ACCOUNT_SETTINGS_ROUTES as readonly string[]).includes(path)) return 'settings';
  if ((ACCOUNT_HELP_ROUTES as readonly string[]).includes(path)) return 'help';
  return null;
}

/**
 * En escritorio, el botón de búsqueda se marca en la búsqueda (fase 8). Sólo
 * ahí: el mapa es su propia sección y el perfil de un técnico, al que se llega
 * desde muchos sitios, no marca nada.
 */
export function companySearchActiveForPath(pathname: string): boolean {
  return normalize(pathname) === COMPANY_TAB_ROUTES.search;
}

// ── Perfil de un técnico abierto desde un chat ───────────────────────────
//
// El perfil completo ofrece "Open chat" y la cabecera del chat ofrece
// "Profile": sin más, se podía ir de uno a otro sin fin. Cuando el perfil se
// abre DESDE un chat lo dice la URL (?from=chat) y entonces no ofrece volver a
// abrir el chat: para eso está la flecha de atrás. Desde cualquier otro sitio
// (candidatura, ofertas directas, mapa…) el perfil sigue igual.

export const PROFILE_FROM_CHAT = 'chat';

/** La ruta del perfil completo de un técnico; con `fromChat`, marcada como abierta desde un chat. */
export function technicianProfileHref(technicianId: string, options: { fromChat?: boolean } = {}): string {
  const base = `/company/technician/${encodeURIComponent(technicianId)}`;
  return options.fromChat ? `${base}?from=${PROFILE_FROM_CHAT}` : base;
}

/** ¿Se abrió el perfil desde un chat? (`from` es el parámetro de la URL). */
export function isProfileOpenedFromChat(from: string | string[] | undefined): boolean {
  const value = Array.isArray(from) ? from[0] : from;
  return value === PROFILE_FROM_CHAT;
}
