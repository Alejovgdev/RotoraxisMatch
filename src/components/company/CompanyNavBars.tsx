// Las dos barras de navegación de empresa (rediseño, fase 2).
//
//   - CompanyTabBar: móvil. Home, Search, "+ Post offer", Inbox y You (maqueta
//     WTabBar). Sólo la montan las pantallas raíz de pestaña.
//   - CompanyTopBar: escritorio (≥ WIDE_BREAKPOINT). Logo, botón de búsqueda,
//     Inbox, You y "Post offer"; debajo, las secciones (maqueta WTopBar). Sale en
//     todas las pantallas de empresa.
//
// El "+" / "Post offer" abre el formulario de oferta de hoy. Un Viewer lo ve en
// gris y al tocarlo se le explica por qué (respuesta 7 de la revisión).
//
// Las dos barras las pintan las piezas comunes (src/components/ui/TabBar.tsx y
// TopBar.tsx), las mismas que usa el técnico (fase 5A); aquí sólo se decide qué
// está activo y qué hace cada botón.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { House, MessageCircle, Search } from 'lucide-react-native';
import { Avatar, TabBar, TopBar } from '../ui';
import type { TabBarItem } from '../ui';
import { colors } from '../../theme';
import { useCompanyNav, VIEWER_CANNOT_POST } from '../../state/CompanyNavContext';
import {
  COMPANY_POST_OFFER_ROUTE,
  COMPANY_SECTION_ROUTES,
  COMPANY_TAB_ROUTES,
  companySearchActiveForPath,
  companySectionForPath,
  companyTabForPath,
  companyTopActionForPath,
  type CompanySection,
} from '../../utils/companyNavigation';

function CompanyAvatar({ size, ring = false }: { size: number; ring?: boolean }) {
  const { company } = useCompanyNav();
  return (
    <View style={ring ? [styles.ring, { borderRadius: Math.round((size + 4) * 0.28) }] : null}>
      <Avatar kind="company" size={size} name={company?.name} logoPath={company?.logoPath} />
    </View>
  );
}

export function CompanyTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { canPostOffers, unreadChats } = useCompanyNav();
  const active = companyTabForPath(pathname);

  const items: TabBarItem[] = [
    {
      key: 'home',
      label: 'Home',
      active: active === 'home',
      renderIcon: (color) => <House color={color} size={24} strokeWidth={2.1} />,
      onPress: () => router.navigate(COMPANY_TAB_ROUTES.home as never),
    },
    {
      key: 'search',
      label: 'Search',
      active: active === 'search',
      renderIcon: (color) => <Search color={color} size={24} strokeWidth={2.1} />,
      onPress: () => router.navigate(COMPANY_TAB_ROUTES.search as never),
    },
    {
      key: 'inbox',
      label: 'Inbox',
      active: active === 'inbox',
      badge: unreadChats,
      renderIcon: (color) => <MessageCircle color={color} size={24} strokeWidth={2.1} />,
      onPress: () => router.navigate(COMPANY_TAB_ROUTES.inbox as never),
    },
    {
      key: 'you',
      label: 'You',
      active: active === 'you',
      renderIcon: () => <CompanyAvatar size={26} ring={active === 'you'} />,
      onPress: () => router.navigate(COMPANY_TAB_ROUTES.you as never),
    },
  ];

  return (
    <TabBar
      items={items}
      action={{
        label: 'Post offer',
        onPress: () => router.push(COMPANY_POST_OFFER_ROUTE as never),
        disabled: !canPostOffers,
        disabledNote: VIEWER_CANNOT_POST,
      }}
    />
  );
}

const SECTIONS: { key: CompanySection; label: string; adminOnly?: boolean }[] = [
  { key: 'home', label: 'Home' },
  { key: 'applications', label: 'Applications' },
  { key: 'direct', label: 'Direct offers' },
  { key: 'offers', label: 'Your offers' },
  { key: 'map', label: 'Map' },
  { key: 'team', label: 'Team', adminOnly: true },
];

export function CompanyTopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { canPostOffers, isAdmin, pendingApplications, unreadChats } = useCompanyNav();
  const section = companySectionForPath(pathname);
  const topAction = companyTopActionForPath(pathname);

  return (
    <TopBar
      onLogoPress={() => router.navigate(COMPANY_SECTION_ROUTES.home as never)}
      searchLabel="Search technicians"
      onSearch={() => router.navigate(COMPANY_TAB_ROUTES.search as never)}
      searchActive={companySearchActiveForPath(pathname)}
      inbox={{
        active: topAction === 'inbox',
        unread: unreadChats,
        onPress: () => router.navigate(COMPANY_TAB_ROUTES.inbox as never),
      }}
      you={{
        active: topAction === 'you',
        avatar: <CompanyAvatar size={28} />,
        onPress: () => router.navigate(COMPANY_TAB_ROUTES.you as never),
      }}
      action={{
        label: 'Post offer',
        onPress: () => router.push(COMPANY_POST_OFFER_ROUTE as never),
        disabled: !canPostOffers,
        disabledNote: VIEWER_CANNOT_POST,
      }}
      sections={SECTIONS.filter((s) => !s.adminOnly || isAdmin).map((s) => ({
        key: s.key,
        label: s.label,
        active: section === s.key,
        count: s.key === 'applications' ? pendingApplications : undefined,
        onPress: () => router.navigate(COMPANY_SECTION_ROUTES[s.key] as never),
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
