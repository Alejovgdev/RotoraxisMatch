import { useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { TechnicianTabBar } from '../../../src/components/technician/TechnicianNavBars';
import { techUi } from '../../../src/components/technician/TechnicianUI';
import { WIDE_BREAKPOINT } from '../../../src/theme/ui';

// Las cuatro pestañas del técnico (rediseño, fase 5A; T1). El grupo (tabs) no
// cambia ninguna URL: /technician, /technician/offers, /technician/chats y
// /technician/profile son las de siempre. "+ Add" no es una pestaña: lo pinta
// TechnicianTabBar.
//
// En escritorio no hay barra inferior; la sustituye la superior, que pinta
// app/technician/_layout.tsx en todas las pantallas.
export default function TechnicianTabsLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: techUi.page } }}
      tabBar={() => (wide ? null : <TechnicianTabBar />)}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="offers" options={{ title: 'Offers' }} />
      <Tabs.Screen name="chats" options={{ title: 'Inbox' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  );
}
