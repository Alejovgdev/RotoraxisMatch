// Settings, Help y las pantallas de borrar la cuenta dentro del marco del área
// (rediseño, fase 8, decisión B).
//
// Son rutas comunes (/settings, /support, /account/delete, /delete-account),
// fuera de app/company y app/technician, así que en escritorio salían sin la
// barra superior y sin el menú de You. Con sesión activa de empresa o de
// técnico, y en escritorio, se pintan con la barra superior del rol (You
// marcado) y el menú lateral de su cuenta, con su fila marcada. Las URLs no
// cambian.
//
// En móvil, en tablet, sin sesión o con otro rol (admin), cada pantalla se
// pinta como siempre: `useAccountShellRole` devuelve null.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../auth/AuthContext';
import { useSession } from '../state/SessionContext';
import { CompanyNavProvider, useCompanyNav } from '../state/CompanyNavContext';
import { TechnicianNavProvider } from '../state/TechnicianNavContext';
import { CompanyTopBar } from './company/CompanyNavBars';
import { TechnicianTopBar } from './technician/TechnicianNavBars';
import { AccountLayout, CompanyAccountNav } from './company/CompanyAccount';
import { TechnicianAccountNav } from './technician/TechnicianAccount';
import { DesktopTitle, PageBody, useIsWide } from './company/CompanyPage';
import { colors } from '../theme';

export type AccountShellRole = 'company' | 'technician';

/** El área cuyo marco se pinta: sólo en escritorio y con una sesión activa de empresa o de técnico. */
export function useAccountShellRole(): AccountShellRole | null {
  const wide = useIsWide();
  const { profile } = useAuth();
  const { sessionLoading } = useSession();
  if (!wide || !profile || profile.status !== 'active' || sessionLoading) return null;
  if (profile.role === 'company_user') return 'company';
  if (profile.role === 'technician') return 'technician';
  return null;
}

function CompanyShellNav({ active }: { active: 'settings' | 'help' }) {
  const { isAdmin } = useCompanyNav();
  return <CompanyAccountNav active={active} isAdmin={isAdmin} />;
}

export function AccountShell({
  role,
  active,
  title,
  subtitle,
  children,
}: {
  role: AccountShellRole;
  /** La fila del menú de empresa (el del técnico la saca de la URL). */
  active: 'settings' | 'help';
  /** Sin título, la pantalla pinta el suyo (Delete account, con su aviso). */
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const body = (
    <PageBody wide>
      <AccountLayout nav={role === 'company' ? <CompanyShellNav active={active} /> : <TechnicianAccountNav />}>
        <View style={styles.main}>
          {title ? <DesktopTitle title={title} subtitle={subtitle} /> : null}
          {children}
        </View>
      </AccountLayout>
    </PageBody>
  );

  if (role === 'company') {
    return (
      <CompanyNavProvider>
        <View style={styles.shell}>
          <Stack.Screen options={{ headerShown: false }} />
          <CompanyTopBar />
          {body}
        </View>
      </CompanyNavProvider>
    );
  }
  return (
    <TechnicianNavProvider>
      <View style={styles.shell}>
        <Stack.Screen options={{ headerShown: false }} />
        <TechnicianTopBar />
        {body}
      </View>
    </TechnicianNavProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Textos y formularios: una columna legible, no todo el ancho del área.
  main: {
    width: '100%',
    maxWidth: 760,
    gap: 20,
  },
});
