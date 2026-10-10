// Datos compartidos por la navegación de empresa (rediseño, fase 2): la barra
// inferior en móvil y la superior en escritorio necesitan la empresa (nombre
// para el avatar de "You"), el rol (el "+" del Viewer) y dos contadores que la
// app ya tenía antes del rediseño:
//   - candidaturas pendientes (Applications), y
//   - conversaciones con mensajes sin leer (Inbox), de activity_events.
//
// Se cargan una vez para las dos barras y se refrescan al cambiar de pantalla,
// para que el número no se quede viejo después de revisar una candidatura o
// abrir un chat. Nada aquí escribe.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'expo-router';
import { useCompanySession } from './SessionContext';
import { companyRepositoryV2 } from '../repositories/v2/companyRepositoryV2';
import { offerApplicationRepository } from '../repositories/v2/offerApplicationRepository';
import { activityRepository } from '../repositories/v2/activityRepository';
import { canManageCompanyMembers, canManageOffers } from '../utils/companyPermissionsV2';
import type { CompanyProfileView } from '../types/company';
import type { CompanyMemberRole } from '../types/enums';

export interface CompanyNavValue {
  company: CompanyProfileView | null;
  role: CompanyMemberRole | undefined;
  /** Admin o recruiter. Un Viewer ve el "+" en gris. */
  canPostOffers: boolean;
  /** Sólo un admin ve Team (círculo de la Home y sección de escritorio). */
  isAdmin: boolean;
  pendingApplications: number;
  unreadChats: number;
  /** Vuelve a pedir los contadores (p. ej. al volver a la Home). */
  refreshCounts: () => void;
  /** Vuelve a leer la empresa (tras editar sus datos, el nombre del avatar cambia). */
  reloadCompany: () => void;
}

const CompanyNavContext = createContext<CompanyNavValue | null>(null);

export function CompanyNavProvider({ children }: { children: React.ReactNode }) {
  const session = useCompanySession();
  const companyId = session?.companyId;
  const role = session?.companyMemberRole;
  const pathname = usePathname();

  const [company, setCompany] = useState<CompanyProfileView | null>(null);
  const [pendingApplications, setPendingApplications] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [tick, setTick] = useState(0);
  const [companyTick, setCompanyTick] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!companyId) {
      setCompany(null);
      return;
    }
    let active = true;
    companyRepositoryV2.getById(companyId)
      .then((row) => { if (active) setCompany(row); })
      .catch(() => { if (active) setCompany(null); });
    return () => { active = false; };
  }, [companyId, companyTick]);

  useEffect(() => {
    if (!companyId) {
      setPendingApplications(0);
      setUnreadChats(0);
      return;
    }
    const id = ++requestId.current;
    Promise.all([
      offerApplicationRepository.countPendingForCompany(companyId),
      activityRepository.getUnreadChatRoomIds('company', companyId),
    ])
      .then(([pending, unreadRooms]) => {
        if (id !== requestId.current) return;
        setPendingApplications(pending);
        setUnreadChats(unreadRooms.size);
      })
      // Un fallo de red no borra el último número bueno: un contador que
      // parpadea a 0 diría "no hay nada" cuando no lo sabemos.
      .catch(() => {});
  }, [companyId, pathname, tick]);

  const refreshCounts = useCallback(() => setTick((t) => t + 1), []);
  const reloadCompany = useCallback(() => setCompanyTick((t) => t + 1), []);

  const value = useMemo<CompanyNavValue>(() => ({
    company,
    role,
    canPostOffers: canManageOffers(role),
    isAdmin: canManageCompanyMembers(role),
    pendingApplications,
    unreadChats,
    refreshCounts,
    reloadCompany,
  }), [company, role, pendingApplications, unreadChats, refreshCounts, reloadCompany]);

  return <CompanyNavContext.Provider value={value}>{children}</CompanyNavContext.Provider>;
}

export function useCompanyNav(): CompanyNavValue {
  const value = useContext(CompanyNavContext);
  if (!value) throw new Error('useCompanyNav must be used inside CompanyNavProvider (app/company/_layout.tsx).');
  return value;
}

/** Texto del aviso cuando un Viewer toca "Post offer" (maquetas WTabBar/WTopBar). */
export const VIEWER_CANNOT_POST = "Viewers can't post offers. Ask an admin to change your role.";
