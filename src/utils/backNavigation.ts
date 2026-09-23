// Adónde lleva la flecha de atrás cuando no hay atrás.
//
// Cierre de la Fase 10 — "GO_BACK was not handled by any navigator". Una
// pantalla abierta por recarga del navegador o por enlace directo es la PRIMERA
// del historial: `router.back()` no tiene destino, expo-router lanza y el botón
// se queda muerto. No es un caso raro en web, es lo normal cuando alguien
// comparte una URL o pulsa F5.
//
// La regla vive aquí, pura y sin `useRouter`, para poder probarla sin montar un
// navegador: la pantalla por defecto de cada rol es una decisión de producto,
// no un detalle de la librería de navegación.
import { AppRole, UserStatus } from '../types/enums';

export type BackDestination = { kind: 'back' } | { kind: 'replace'; href: string };

/**
 * La pantalla de inicio de un perfil. Misma tabla que usa la redirección
 * automática de `app/index.tsx`, que la importa de aquí: dos copias acabarían
 * mandando al mismo usuario a sitios distintos según por dónde entrara.
 *
 * El estado manda sobre el rol: una cuenta que aún no está activa no tiene
 * panel al que volver, tiene una sala de espera.
 */
export function roleHomeRoute(role: AppRole, status: UserStatus): string {
  if (status !== 'active') return '/auth/pending-verification';
  if (role === 'admin') return '/admin';
  if (role === 'company_user') return '/company';
  return '/technician';
}

/**
 * Con historial, atrás. Sin historial, la pantalla de inicio del rol, y
 * `replace` y no `push` para no dejar una entrada de vuelta a la pantalla de la
 * que se acaba de salir.
 *
 * Sin perfil resuelto —sesión todavía cargando, o pantallas de `/auth`— el
 * destino es la raíz, que ya sabe redirigir por rol cuando el perfil llegue.
 */
export function backDestination(
  canGoBack: boolean,
  profile: { role: AppRole; status: UserStatus } | null | undefined,
): BackDestination {
  if (canGoBack) return { kind: 'back' };
  return { kind: 'replace', href: profile ? roleHomeRoute(profile.role, profile.status) : '/' };
}
