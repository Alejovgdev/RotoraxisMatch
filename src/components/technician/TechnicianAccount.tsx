// La sección "Account" del técnico (rediseño, fase 5A): Settings, Help y Log out.
//
// Antes se llegaba a Settings desde la Home del técnico (el engranaje de la
// tarjeta de perfil), que desaparece con el rediseño; ahora vive al final de
// /technician/profile. Las filas y el "Log out" son los de la cuenta de
// empresa (src/components/company/CompanyAccount.tsx): "Log out" hace lo mismo
// que "Sign out" en Settings.
//
// Escritorio (fase 8, decisión C): TechnicianAccountNav es el menú lateral de
// You, con el patrón de empresa (CompanyAccountNav). Lo llevan You, sus
// pantallas (My work, Personal details…), Documents y las comunes de la cuenta
// (Settings, Help); la fila marcada sale de la URL. `beforeLeave` lo pone el
// apartado con cambios sin guardar: se pregunta antes de ir a otro.
import React from 'react';
import { View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Briefcase, CircleHelp, FileText, Handshake, Link2, LogOut, MapPin, Settings, UserRound } from 'lucide-react-native';
import { AccountNavItem, AccountNavList, AccountRow, useLogout } from '../company/CompanyAccount';
import { SectionTitle } from '../company/CompanyPage';
import {
  TECHNICIAN_DOCUMENTS_ROUTE,
  TECHNICIAN_PROFILE_ROUTES,
  technicianAccountSectionForPath,
  type TechnicianAccountSection,
} from '../../utils/technicianNavigation';

export function TechnicianAccountSection() {
  const router = useRouter();
  const logout = useLogout();
  return (
    <View>
      <SectionTitle>Account</SectionTitle>
      <AccountRow label="Settings" onPress={() => router.push('/settings' as never)} />
      <AccountRow label="Help" onPress={() => router.push('/support' as never)} />
      <AccountRow label="Log out" destructive last onPress={logout} />
    </View>
  );
}

/**
 * El menú lateral de You en escritorio. Las filas son las de You, más Settings,
 * Help y Log out. El apartado abierto no hace nada al pulsarlo; los demás, si
 * `beforeLeave` dice que no (cambios sin guardar que no se descartan), tampoco.
 */
export function TechnicianAccountNav({ beforeLeave }: { beforeLeave?: () => Promise<boolean> }) {
  const router = useRouter();
  const logout = useLogout();
  const active = technicianAccountSectionForPath(usePathname());
  const leave = (key: TechnicianAccountSection | 'logout', action: () => void) => async () => {
    if (key === active) return;
    if (beforeLeave && !(await beforeLeave())) return;
    action();
  };
  const open = (key: TechnicianAccountSection, href: string) => leave(key, () => router.navigate(href as never));
  return (
    <AccountNavList>
      <AccountNavItem label="My work" icon={Briefcase} active={active === 'work'} onPress={open('work', TECHNICIAN_PROFILE_ROUTES.work)} />
      <AccountNavItem label="Documents" icon={FileText} active={active === 'documents'} onPress={open('documents', TECHNICIAN_DOCUMENTS_ROUTE)} />
      <AccountNavItem label="Location" icon={MapPin} active={active === 'location'} onPress={open('location', TECHNICIAN_PROFILE_ROUTES.location)} />
      <AccountNavItem label="Contract types" icon={Handshake} active={active === 'contracts'} onPress={open('contracts', TECHNICIAN_PROFILE_ROUTES.contracts)} />
      <AccountNavItem label="Personal details" icon={UserRound} active={active === 'personal'} onPress={open('personal', TECHNICIAN_PROFILE_ROUTES.personal)} />
      <AccountNavItem label="Professional links" icon={Link2} active={active === 'links'} onPress={open('links', TECHNICIAN_PROFILE_ROUTES.links)} />
      <AccountNavItem label="Settings" icon={Settings} active={active === 'settings'} onPress={leave('settings', () => router.push('/settings' as never))} />
      <AccountNavItem label="Help" icon={CircleHelp} active={active === 'help'} onPress={leave('help', () => router.push('/support' as never))} />
      <AccountNavItem label="Log out" icon={LogOut} destructive onPress={leave('logout', () => void logout())} />
    </AccountNavList>
  );
}
