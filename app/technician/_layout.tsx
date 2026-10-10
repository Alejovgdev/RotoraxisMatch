import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { techUi } from '../../src/components/technician/TechnicianUI';
import { TechnicianTopBar } from '../../src/components/technician/TechnicianNavBars';
import { useAuth } from '../../src/auth/AuthContext';
import { useSession } from '../../src/state/SessionContext';
import { TechnicianNavProvider } from '../../src/state/TechnicianNavContext';
import { WIDE_BREAKPOINT } from '../../src/theme/ui';

// Las pestañas son la base de la pila (rediseño, fase 5A, como en empresa): una
// pantalla interior abierta por F5 o por enlace directo (/technician/offers/123)
// tiene debajo las pestañas, así que "atrás" vuelve a la Home en vez de
// quedarse sin destino.
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function TechnicianLayout() {
  const { profile, loading } = useAuth();
  const { sessionLoading } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  if (loading) return <LoadingScreen color={techUi.accent} role="technician" />;
  if (!profile) return <Redirect href="/auth/login" />;
  if (profile.status !== 'active') return <Redirect href="/auth/pending-verification" />;
  if (profile.role !== 'technician') return <Redirect href="/" />;
  // SessionContext resolves technicianId via its own async fetch
  // (technician_profiles), independent of the auth check above — waiting
  // for it here too means no screen under /technician/* can ever mount
  // while technicianId is still ''. Same root fix as CompanyLayout.
  if (sessionLoading) return <LoadingScreen color={techUi.accent} role="technician" />;

  return (
    <TechnicianNavProvider>
      <View style={styles.shell}>
        {/* Escritorio: la barra superior sale en TODAS las pantallas del técnico
            (respuesta 6 de la revisión). En móvil la navegación es la barra
            inferior de las pestañas. */}
        {wide ? <TechnicianTopBar /> : null}
        <View style={styles.body}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: techUi.page },
            }}
          >
            <Stack.Screen name="(tabs)" />
          </Stack>
        </View>
      </View>
    </TechnicianNavProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: techUi.page,
  },
  body: {
    flex: 1,
  },
});
