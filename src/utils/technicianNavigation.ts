// Qué pestaña (móvil) y qué sección (escritorio) están activas para cada URL
// del técnico (docs/UI_REDESIGN.md, sección 4; fase 5A).
//
// Misma forma que src/utils/companyNavigation.ts: pura, compartida por las dos
// barras y con pruebas en scripts/testTechnicianNavigation.ts.
import { PROFILE_FROM_CHAT, accountPageForPath, isProfileOpenedFromChat } from './companyNavigation';

export type TechnicianTab = 'home' | 'offers' | 'inbox' | 'you';
export type TechnicianSection = 'home' | 'offers' | 'applications' | 'direct' | 'map';

/** Las cuatro pantallas raíz de pestaña, las únicas que muestran la barra inferior. */
export const TECHNICIAN_TAB_ROUTES: Record<TechnicianTab, string> = {
  home: '/technician',
  offers: '/technician/offers',
  inbox: '/technician/chats',
  you: '/technician/profile',
};

export const TECHNICIAN_SECTION_ROUTES: Record<TechnicianSection, string> = {
  home: '/technician',
  offers: '/technician/offers',
  applications: '/technician/applications',
  direct: '/technician/direct-offers',
  map: '/technician/map',
};

/**
 * Las pantallas que cuelgan de You (fase 6A). Cuelgan de su URL, así que en
 * escritorio marcan You en la barra superior y en móvil no llevan la barra
 * inferior (no son raíz de pestaña).
 */
export const TECHNICIAN_PROFILE_ROUTES = {
  work: '/technician/profile/work',
  personal: '/technician/profile/personal',
  location: '/technician/profile/location',
  contracts: '/technician/profile/contracts',
  links: '/technician/profile/links',
} as const;

/**
 * El "+" y sus asistentes (fase 6B; maquetas T-Add, T-Lic, T-Rat, T-Eng). No
 * son pestañas: se apilan encima, sin barra inferior.
 */
export const TECHNICIAN_ADD_ROUTES = {
  menu: '/technician/add',
  licence: '/technician/add/licence',
  typeRating: '/technician/add/type-rating',
  aircraft: '/technician/add/aircraft',
  engine: '/technician/add/engine',
} as const;

/** Adónde lleva "+ Add" (barra inferior y barra superior): al "+". */
export const TECHNICIAN_ADD_ROUTE = TECHNICIAN_ADD_ROUTES.menu;

/** El asistente de type rating, con la licencia ya elegida si se sabe ("Add a type rating on B1.1"). */
export function technicianTypeRatingHref(licence?: { authority: string; code: string }): string {
  if (!licence) return TECHNICIAN_ADD_ROUTES.typeRating;
  return `${TECHNICIAN_ADD_ROUTES.typeRating}?licence=${encodeURIComponent(`${licence.authority}:${licence.code}`)}`;
}

export const TECHNICIAN_DOCUMENTS_ROUTE = '/technician/documents';

/**
 * Documents con la subida ya abierta: el atajo del "+" y del asistente de
 * licencia ("Photo or PDF of the licence"). `type` sólo preelige el tipo de
 * documento; no liga el documento a ninguna licencia (respuesta 26).
 */
export function technicianDocumentsUploadHref(type?: 'license'): string {
  return `${TECHNICIAN_DOCUMENTS_ROUTE}?upload=${type ?? '1'}`;
}

function normalize(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function within(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** La pestaña activa, sólo en una pantalla raíz de pestaña. */
export function technicianTabForPath(pathname: string): TechnicianTab | null {
  const path = normalize(pathname);
  const match = (Object.keys(TECHNICIAN_TAB_ROUTES) as TechnicianTab[]).find((tab) => TECHNICIAN_TAB_ROUTES[tab] === path);
  return match ?? null;
}

/**
 * La sección de la barra superior que corresponde a una pantalla, incluidas
 * las interiores (una oferta cuelga de Offers). Inbox, You, Documents y la
 * pantalla vieja de solicitudes no son secciones: devuelven null.
 */
export function technicianSectionForPath(pathname: string): TechnicianSection | null {
  const path = normalize(pathname);
  if (path === TECHNICIAN_SECTION_ROUTES.home) return 'home';
  if (within(path, TECHNICIAN_SECTION_ROUTES.offers)) return 'offers';
  if (within(path, TECHNICIAN_SECTION_ROUTES.applications)) return 'applications';
  if (within(path, TECHNICIAN_SECTION_ROUTES.direct)) return 'direct';
  if (within(path, TECHNICIAN_SECTION_ROUTES.map)) return 'map';
  return null;
}

/**
 * En escritorio, Inbox y You se marcan en la fila de arriba, no como sección.
 * Documents cuelga de You (es una de sus filas) aunque su URL no: también
 * marca You (fase 8).
 */
export function technicianTopActionForPath(pathname: string): 'inbox' | 'you' | null {
  const path = normalize(pathname);
  if (within(path, TECHNICIAN_TAB_ROUTES.inbox)) return 'inbox';
  if (within(path, TECHNICIAN_TAB_ROUTES.you)) return 'you';
  if (path === TECHNICIAN_DOCUMENTS_ROUTE) return 'you';
  if (accountPageForPath(path)) return 'you';
  return null;
}

export type TechnicianAccountSection =
  | 'work' | 'documents' | 'location' | 'contracts' | 'personal' | 'links' | 'settings' | 'help';

/**
 * La fila marcada del menú lateral de You en escritorio (fase 8, decisión C):
 * las pantallas que cuelgan de You, Documents y las comunes de la cuenta. You
 * misma (/technician/profile) enseña My work en escritorio, y marca My work.
 */
export function technicianAccountSectionForPath(pathname: string): TechnicianAccountSection | null {
  const path = normalize(pathname);
  if (path === TECHNICIAN_TAB_ROUTES.you) return 'work';
  const profile = (Object.keys(TECHNICIAN_PROFILE_ROUTES) as (keyof typeof TECHNICIAN_PROFILE_ROUTES)[])
    .find((key) => TECHNICIAN_PROFILE_ROUTES[key] === path);
  if (profile) return profile;
  if (path === TECHNICIAN_DOCUMENTS_ROUTE) return 'documents';
  return accountPageForPath(path);
}

/** En escritorio, "+ Add" se marca en el "+" y en sus asistentes (fase 8). */
export function technicianAddActiveForPath(pathname: string): boolean {
  return within(normalize(pathname), TECHNICIAN_ADD_ROUTES.menu);
}

// ── Pantallas abiertas desde un chat (fase 5B) ───────────────────────────
//
// La misma regla que en empresa (companyNavigation.ts, perfil desde un chat):
// la tarjeta de la oferta del chat abre la página de la candidatura o de la
// oferta directa, y esas páginas ofrecen "Open chat". Sin más, se podía ir de
// una a otra sin fin. Cuando se abren DESDE un chat lo dice la URL
// (?from=chat) y entonces no ofrecen volver a abrir el chat: para eso está la
// flecha de atrás. Desde cualquier otro sitio siguen igual.

/** ¿Se abrió la pantalla desde un chat? (`from` es el parámetro de la URL). Misma regla que empresa. */
export const isOpenedFromChat = isProfileOpenedFromChat;

function withFromChat(base: string, fromChat: boolean | undefined): string {
  return fromChat ? `${base}?from=${PROFILE_FROM_CHAT}` : base;
}

/** La página de una oferta; con `fromChat`, marcada como abierta desde un chat. */
export function technicianOfferHref(offerId: string, options: { fromChat?: boolean } = {}): string {
  return withFromChat(`/technician/offers/${encodeURIComponent(offerId)}`, options.fromChat);
}

/** La página de una oferta directa; con `fromChat`, marcada como abierta desde un chat. */
export function technicianDirectOfferHref(requestId: string, options: { fromChat?: boolean } = {}): string {
  return withFromChat(`/technician/direct-offers/${encodeURIComponent(requestId)}`, options.fromChat);
}

/**
 * Adónde lleva la tarjeta de la oferta de un chat: a la oferta directa si el
 * chat nació de una, o a la página de la oferta (donde se ve la candidatura) si
 * nació de una candidatura. Siempre marcada como abierta desde el chat.
 */
export function chatContextHref(
  room: { offerRequestId?: string | null; offerApplicationId?: string | null },
  offerId: string | null | undefined,
): string | null {
  if (room.offerRequestId) return technicianDirectOfferHref(room.offerRequestId, { fromChat: true });
  if (room.offerApplicationId && offerId) return technicianOfferHref(offerId, { fromChat: true });
  return null;
}
