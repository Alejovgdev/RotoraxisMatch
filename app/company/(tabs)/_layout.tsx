import { useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { CompanyTabBar } from '../../../src/components/company/CompanyNavBars';
import { companyUi } from '../../../src/components/company/CompanyUI';
import { WIDE_BREAKPOINT } from '../../../src/theme/ui';

// Las cuatro pestañas de empresa (rediseño, fase 2). El grupo (tabs) no cambia
// ninguna URL: /company, /company/search, /company/chats y /company/profile son
// las de siempre. "+ Post offer" no es una pestaña: lo pinta CompanyTabBar y
// abre /company/offers/new por encima.
//
// En escritorio no hay barra inferior; la sustituye la superior, que pinta
// app/company/_layout.tsx en todas las pantallas.
export default function CompanyTabsLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: companyUi.page } }}
      tabBar={() => (wide ? null : <CompanyTabBar />)}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="chats" options={{ title: 'Inbox' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  );
}
