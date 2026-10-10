import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../src/theme';
import { FONT_ASSETS, fonts } from '../src/theme/fonts';
import { SessionProvider } from '../src/state/SessionContext';
import { AuthProvider } from '../src/auth/AuthContext';
import { installWebFocusRing } from '../src/components/ui/webFocusRing';
import { NoticeHost } from '../src/components/ui/NoticeHost';

// La pantalla de carga nativa se queda hasta que las fuentes están listas: sin
// esto se vería un instante la app con la letra del sistema. En web no hace nada.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Si las fuentes no llegan (red lenta en web, un fallo raro en nativo), la app
// arranca igual con la letra del sistema en vez de quedarse en blanco.
const FONT_LOAD_TIMEOUT_MS = 4000;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const [timedOut, setTimedOut] = useState(false);
  const ready = fontsLoaded || fontError != null || timedOut;

  // Web: el anillo de foco común de toda la app (fase 8). En nativo no hace nada.
  useEffect(() => {
    installWebFocusRing();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              headerTitleStyle: { fontFamily: fonts.extrabold },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="intro" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            <Stack.Screen name="technician" options={{ headerShown: false }} />
            <Stack.Screen name="company" options={{ headerShown: false }} />
            <Stack.Screen name="admin" options={{ headerShown: false }} />
          </Stack>
          {/* Web: los avisos de notify() en la ventana de la app (fase 8, E). */}
          <NoticeHost />
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
