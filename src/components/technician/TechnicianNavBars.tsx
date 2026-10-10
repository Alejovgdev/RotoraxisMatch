// Las dos barras de navegación del técnico (rediseño, fase 5A), con el mismo
// patrón que las de empresa (src/components/company/CompanyNavBars.tsx) y las
// mismas piezas comunes (src/components/ui/TabBar.tsx y TopBar.tsx):
//
//   - TechnicianTabBar: móvil. Home, Offers, "+ Add", Inbox y You (maqueta
//     TTabBar, sin campana: respuesta 12). Sólo la montan las pantallas raíz
//     de pestaña.
//   - TechnicianTopBar: escritorio (≥ WIDE_BREAKPOINT). Logo, "Search offers",
//     Inbox, You y "+ Add"; debajo, las secciones Home, Offers, Applications,
//     Direct offers y Map. Sale en todas las pantallas del técnico.
//
// "+ Add" abre el "+" (/technician/add, fase 6B): "What you do" y lo que se
// puede añadir, con sus asistentes.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { House, MessageCircle, Search } from 'lucide-react-native';
import { Avatar, TabBar, TopBar } from '../ui';
import type { TabBarItem } from '../ui';
import { colors } from '../../theme';
import { useTechnicianNav } from '../../state/TechnicianNavContext';
import {
  TECHNICIAN_ADD_ROUTE,
  TECHNICIAN_PROFILE_ROUTES,
  TECHNICIAN_SECTION_ROUTES,
  TECHNICIAN_TAB_ROUTES,
  technicianAddActiveForPath,
  technicianSectionForPath,
  technicianTabForPath,
  technicianTopActionForPath,
  type TechnicianSection,
} from '../../utils/technicianNavigation';

/** El avatar del propio técnico: sus iniciales hasta que lleguen las fotos (fase 7). */
function TechnicianAvatar({ size, ring = false }: { size: number; ring?: boolean }) {
  const { displayName, technician } = useTechnicianNav();
  return (
    <View style={ring ? [styles.ring, { borderRadius: (size + 8) / 2 }] : null}>
      <Avatar kind="person" size={size} name={displayName || null} photoPath={technician?.photoPath} />
    </View>
  );
}

export function TechnicianTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { unreadChats } = useTechnicianNav();
  const active = technicianTabForPath(pathname);

  const items: TabBarItem[] = [
    {
      key: 'home',
      label: 'Home',
      active: active === 'home',
      renderIcon: (color) => <House color={color} size={24} strokeWidth={2.1} />,
      onPress: () => router.navigate(TECHNICIAN_TAB_ROUTES.home as never),
    },
    {
      key: 'offers',
      label: 'Offers',
      active: active === 'offers',
      renderIcon: (color) => <Search color={color} size={24} strokeWidth={2.1} />,
      onPress: () => router.navigate(TECHNICIAN_TAB_ROUTES.offers as never),
    },
    {
      key: 'inbox',
      label: 'Inbox',
      active: active === 'inbox',
      badge: unreadChats,
      renderIcon: (color) => <MessageCircle color={color} size={24} strokeWidth={2.1} />,
      onPress: () => router.navigate(TECHNICIAN_TAB_ROUTES.inbox as never),
    },
    {
      key: 'you',
      label: 'You',
      active: active === 'you',
      renderIcon: () => <TechnicianAvatar size={26} ring={active === 'you'} />,
      onPress: () => router.navigate(TECHNICIAN_TAB_ROUTES.you as never),
    },
  ];

  return (
    <TabBar
      items={items}
      action={{
        label: 'Add',
        onPress: () => router.navigate(TECHNICIAN_ADD_ROUTE as never),
      }}
    />
  );
}

const SECTIONS: { key: TechnicianSection; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'offers', label: 'Offers' },
  { key: 'applications', label: 'Applications' },
  { key: 'direct', label: 'Direct offers' },
  { key: 'map', label: 'Map' },
];

export function TechnicianTopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { unseenApplicationResponses, pendingDirectOffers, unreadChats } = useTechnicianNav();
  const section = technicianSectionForPath(pathname);
  const topAction = technicianTopActionForPath(pathname);

  return (
    <TopBar
      onLogoPress={() => router.navigate(TECHNICIAN_SECTION_ROUTES.home as never)}
      searchLabel="Search offers"
      onSearch={() => router.navigate(TECHNICIAN_TAB_ROUTES.offers as never)}
      inbox={{
        active: topAction === 'inbox',
        unread: unreadChats,
        onPress: () => router.navigate(TECHNICIAN_TAB_ROUTES.inbox as never),
      }}
      you={{
        active: topAction === 'you',
        avatar: <TechnicianAvatar size={28} />,
        // Escritorio: You es el layout de app/technician/(you) y se abre en My
        // work (fase 8); /technician/profile también lleva ahí.
        onPress: () => router.navigate(TECHNICIAN_PROFILE_ROUTES.work as never),
      }}
      action={{
        label: 'Add',
        onPress: () => router.navigate(TECHNICIAN_ADD_ROUTE as never),
        active: technicianAddActiveForPath(pathname),
      }}
      sections={SECTIONS.map((s) => ({
        key: s.key,
        label: s.label,
        active: section === s.key,
        // Applications: respuestas sin ver; Direct offers: las que esperan respuesta.
        count: s.key === 'applications' ? unseenApplicationResponses : s.key === 'direct' ? pendingDirectOffers : undefined,
        countLabel: s.key === 'applications' ? 'new' : 'pending',
        onPress: () => router.navigate(TECHNICIAN_SECTION_ROUTES[s.key] as never),
      }))}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    padding: 2,
    borderWidth: 2,
    borderColor: colors.text,
  },
});
