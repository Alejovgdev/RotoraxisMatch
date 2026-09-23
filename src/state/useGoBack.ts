// El ÚNICO "volver atrás" de la app.
//
// Envuelve `backDestination` (src/utils/backNavigation.ts, donde está la regla
// y sus tests) con el router y el perfil de la sesión. Toda flecha de atrás y
// todo cierre de formulario llaman a esto en vez de a `router.back()`: sin
// historial, `router.back()` lanza "GO_BACK was not handled by any navigator" y
// deja el botón muerto, que es exactamente lo que pasa al recargar la página o
// al abrir un enlace directo.
//
// `canGoBack()` se pregunta AL PULSAR, no al renderizar: entre una cosa y otra
// el historial puede haber cambiado.
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthContext';
import { backDestination } from '../utils/backNavigation';

export function useGoBack(): () => void {
  const router = useRouter();
  const { profile } = useAuth();
  return useCallback(() => {
    const destination = backDestination(router.canGoBack(), profile);
    if (destination.kind === 'back') router.back();
    else router.replace(destination.href as never);
  }, [router, profile]);
}
