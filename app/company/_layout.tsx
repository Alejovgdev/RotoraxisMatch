import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { companyUi } from '../../src/components/company/CompanyUI';
import { CompanyTopBar } from '../../src/components/company/CompanyNavBars';
import { useAuth } from '../../src/auth/AuthContext';
import { useSession } from '../../src/state/SessionContext';
import { CompanyNavProvider } from '../../src/state/CompanyNavContext';
import { TechnicianFiltersProvider } from '../../src/state/TechnicianFiltersContext';
import { WIDE_BREAKPOINT } from '../../src/theme/ui';

// Las pestañas son la base de la pila: una pantalla interior abierta por F5 o
// por enlace directo (/company/applications/123) tiene debajo las pestañas, así
// que "atrás" vuelve a la Home en vez de quedarse sin destino.
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function CompanyLayout() {
  const { profile, loading } = useAuth();
  const { sessionLoading } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  if (loading) return <LoadingScreen color={companyUi.accent} role="company" />;
  if (!profile) return <Redirect href="/auth/login" />;
  if (profile.status !== 'active') return <Redirect href="/auth/pending-verification" />;
  if (profile.role !== 'company_user') return <Redirect href="/" />;
  // SessionContext resolves companyId via its own async fetch
  // (company_members), independent of the auth check above — waiting for
  // it here too means no screen under /company/* can ever mount while
  // companyId is still ''. Root fix for a crash that kept recurring
  // screen-by-screen (offers list/detail, the map) before this.
  if (sessionLoading) return <LoadingScreen color={companyUi.accent} role="company" />;

  return (
    <CompanyNavProvider>
      {/* Búsqueda y mapa comparten los filtros de técnicos (fase 3B). */}
      <TechnicianFiltersProvider>
        <View style={styles.shell}>
          {/* Escritorio: la barra superior sale en TODAS las pantallas de empresa
              (respuesta 6 de la revisión). En móvil la navegación es la barra
              inferior de las pestañas. */}
          {wide ? <CompanyTopBar /> : null}
          <View style={styles.body}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: companyUi.page },
              }}
            >
              <Stack.Screen name="(tabs)" />
            </Stack>
          </View>
        </View>
      </TechnicianFiltersProvider>
    </CompanyNavProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: companyUi.page,
  },
  body: {
    flex: 1,
  },
});
