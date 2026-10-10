// La parte "cuenta" de You (rediseño, fase 3; maquetas W-You, W-D-You,
// W-D-Team y W-D-EditCompany):
//   - CompanyAccountSection (móvil): "Signed in as", Settings, Help y Log out.
//   - CompanyAccountNav (escritorio): el menú lateral Company profile, Team
//     access (sólo admin), Settings, Help y Log out. Desde la fase 8 también
//     sale en Settings y Help (AccountShell), con su fila marcada.
//   - AccountNavItem / AccountNavList: las piezas del menú, que comparte el
//     menú lateral del técnico (TechnicianAccountNav).
//
// "Log out" hace lo mismo que "Sign out" en Settings: cerrar la sesión y
// volver al inicio. Settings y Help son las pantallas de siempre.
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Building2, CircleHelp, LogOut, Settings, Users } from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { Text } from '../ui';
import { colors } from '../../theme';
import { TOUCH_TARGET, UI_TONES } from '../../theme/ui';
import { useAuth } from '../../auth/AuthContext';
import type { CompanyMemberRole } from '../../types/enums';
import { SectionTitle } from './CompanyPage';

export const ROLE_LABELS: Record<CompanyMemberRole, string> = {
  admin: 'Admin',
  recruiter: 'Recruiter',
  viewer: 'Viewer',
};

/** El color de cada rol en las maquetas: admin oscuro, recruiter azul, viewer gris. */
export function RolePill({ role }: { role: CompanyMemberRole }) {
  const tone = role === 'admin' ? UI_TONES.navy : role === 'recruiter' ? UI_TONES.waiting : UI_TONES.closed;
  return (
    <View style={[styles.rolePill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.rolePillText, { color: tone.text }]}>{ROLE_LABELS[role]}</Text>
    </View>
  );
}

/**
 * Cerrar la sesión y volver al inicio: lo mismo que "Sign out" en Settings.
 * Lo usan la empresa y, desde la fase 5A, la sección Account del técnico.
 */
export function useLogout(): () => Promise<void> {
  const router = useRouter();
  const { signOut } = useAuth();
  return useCallback(async () => {
    await signOut();
    router.replace('/' as never);
  }, [router, signOut]);
}

export const useCompanyLogout = useLogout;

/** Una fila de la sección Account (Settings, Help, Log out). */
export function AccountRow({
  label,
  onPress,
  destructive = false,
  last = false,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [styles.row, !last && styles.rowLine, (pressed || hovered) && styles.rowPressed]}
      accessibilityRole="button"
    >
      <Text style={[styles.rowLabel, destructive && styles.destructive]}>{label}</Text>
      {!destructive ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

export function CompanyAccountSection({ userName, role }: { userName: string; role: CompanyMemberRole | undefined }) {
  const router = useRouter();
  const logout = useCompanyLogout();
  return (
    <View>
      <SectionTitle>Account</SectionTitle>
      <View style={[styles.row, styles.rowLine]}>
        <Text style={styles.signedLabel}>Signed in as</Text>
        <View style={styles.signedValue}>
          {userName ? <Text style={styles.signedName} numberOfLines={1}>{userName}</Text> : null}
          {role ? <RolePill role={role} /> : null}
        </View>
      </View>
      <AccountRow label="Settings" onPress={() => router.push('/settings' as never)} />
      <AccountRow label="Help" onPress={() => router.push('/support' as never)} />
      <AccountRow label="Log out" destructive last onPress={logout} />
    </View>
  );
}

export function AccountNavItem({
  label,
  icon: Icon,
  active,
  destructive = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<LucideProps>;
  active?: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  const color = destructive ? colors.error : active ? colors.text : '#3D4A57';
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered }: any) => [styles.navItem, (active || hovered) && styles.navItemActive]}
      accessibilityRole="link"
      accessibilityState={{ selected: !!active }}
    >
      <Icon color={color} size={19} strokeWidth={2} />
      <Text style={[styles.navLabel, { color }, (active || destructive) && styles.navLabelStrong]}>{label}</Text>
    </Pressable>
  );
}

/** La lista del menú lateral de cuenta. */
export function AccountNavList({ children }: { children: React.ReactNode }) {
  return <View style={styles.nav} accessibilityRole="menu" accessibilityLabel="Account">{children}</View>;
}

export function CompanyAccountNav({
  active,
  isAdmin,
}: {
  active: 'profile' | 'team' | 'settings' | 'help' | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const logout = useCompanyLogout();
  return (
    <AccountNavList>
      <AccountNavItem label="Company profile" icon={Building2} active={active === 'profile'} onPress={() => router.navigate('/company/profile' as never)} />
      {isAdmin ? (
        <AccountNavItem label="Team access" icon={Users} active={active === 'team'} onPress={() => router.navigate('/company/team' as never)} />
      ) : null}
      <AccountNavItem label="Settings" icon={Settings} active={active === 'settings'} onPress={() => router.push('/settings' as never)} />
      <AccountNavItem label="Help" icon={CircleHelp} active={active === 'help'} onPress={() => router.push('/support' as never)} />
      <AccountNavItem label="Log out" icon={LogOut} destructive onPress={logout} />
    </AccountNavList>
  );
}

/** Escritorio: el menú de cuenta a la izquierda y el contenido a la derecha. */
export function AccountLayout({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.layout}>
      <View style={styles.layoutNav}>{nav}</View>
      <View style={styles.layoutMain}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  rolePill: {
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  row: {
    minHeight: TOUCH_TARGET + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  destructive: {
    fontWeight: '800',
    color: colors.error,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 24,
    color: colors.textMuted,
  },
  signedLabel: {
    fontSize: 14.5,
    color: colors.textSecondary,
  },
  signedValue: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signedName: {
    flexShrink: 1,
    fontSize: 14.5,
    fontWeight: '700',
    color: colors.text,
  },
  nav: {
    gap: 2,
  },
  navItem: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navItemActive: {
    backgroundColor: colors.surfaceMuted,
  },
  navLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  navLabelStrong: {
    fontWeight: '800',
  },
  layout: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 32,
  },
  layoutNav: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    maxWidth: 280,
  },
  layoutMain: {
    flexGrow: 999,
    flexShrink: 1,
    flexBasis: 560,
    minWidth: 0,
    gap: 24,
  },
});
