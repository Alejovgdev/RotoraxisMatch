// Datos compartidos por la navegación del técnico (rediseño, fase 5A), el
// equivalente de CompanyNavContext: la barra inferior en móvil, la superior en
// escritorio y la Home necesitan
//   - el propio perfil (nombre para el avatar de "You", código y verificación),
//   - respuestas a sus candidaturas que aún no ha visto (círculo Applications
//     y sección de escritorio; fase 8: antes contaba las pendientes, que
//     subían al aplicar y bajaban al recibir respuesta),
//   - ofertas directas pendientes, las que esperan su respuesta (círculo Direct
//     offers y sección de escritorio, fase 5B), y
//   - conversaciones con mensajes sin leer (Inbox), de activity_events.
// Son los mismos datos que la Home vieja ya cargaba.
//
// Se cargan una vez para las barras y se refrescan al cambiar de pantalla, para
// que el número no se quede viejo después de abrir un chat. Nada aquí escribe.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'expo-router';
import { useTechnicianSession } from './SessionContext';
import { technicianRepositoryV2 } from '../repositories/v2/technicianRepositoryV2';
import { offerRequestRepository } from '../repositories/v2/offerRequestRepository';
import { activityRepository } from '../repositories/v2/activityRepository';
import type { TechnicianProfile } from '../types/technician';

export interface TechnicianNavValue {
  technicianId: string | undefined;
  /** El perfil del propio técnico (null mientras carga o si falla). */
  technician: TechnicianProfile | null;
  /** Nombre para el avatar de "You": el suyo, o su código si no hay nombre. */
  displayName: string;
  /** Candidaturas aceptadas o rechazadas sin ver: el mismo dato que el punto rojo de su lista. */
  unseenApplicationResponses: number;
  /** Ofertas directas que esperan respuesta: el mismo dato que "N pending" en su lista. */
  pendingDirectOffers: number;
  unreadChats: number;
  /** Vuelve a pedir los contadores (p. ej. al tirar para refrescar la Home). */
  refreshCounts: () => void;
  /** Vuelve a pedir el propio perfil: el nombre del avatar cambia al guardar Personal details (fase 6A). */
  reloadTechnician: () => void;
}

const TechnicianNavContext = createContext<TechnicianNavValue | null>(null);

export function TechnicianNavProvider({ children }: { children: React.ReactNode }) {
  const session = useTechnicianSession();
  const technicianId = session?.technicianId;
  const pathname = usePathname();

  const [technician, setTechnician] = useState<TechnicianProfile | null>(null);
  const [unseenApplicationResponses, setUnseenApplicationResponses] = useState(0);
  const [pendingDirectOffers, setPendingDirectOffers] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [tick, setTick] = useState(0);
  const [profileTick, setProfileTick] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!technicianId) {
      setTechnician(null);
      return;
    }
    let active = true;
    technicianRepositoryV2.getById(technicianId)
      .then((row) => { if (active) setTechnician(row); })
      .catch(() => { if (active) setTechnician(null); });
    return () => { active = false; };
  }, [technicianId, profileTick]);

  useEffect(() => {
    if (!technicianId) {
      setUnseenApplicationResponses(0);
      setPendingDirectOffers(0);
      setUnreadChats(0);
      return;
    }
    const id = ++requestId.current;
    Promise.all([
      activityRepository.getUnseenApplicationResponseIds(technicianId),
      offerRequestRepository.countPendingForTechnician(technicianId),
      activityRepository.getUnreadChatRoomIds('technician', technicianId),
    ])
      .then(([unseenResponses, pendingDirect, unreadRooms]) => {
        if (id !== requestId.current) return;
        setUnseenApplicationResponses(unseenResponses.size);
        setPendingDirectOffers(pendingDirect);
        setUnreadChats(unreadRooms.size);
      })
      // Un fallo de red no borra el último número bueno: un contador que
      // parpadea a 0 diría "no hay nada" cuando no lo sabemos.
      .catch(() => {});
  }, [technicianId, pathname, tick]);

  const refreshCounts = useCallback(() => setTick((t) => t + 1), []);
  const reloadTechnician = useCallback(() => setProfileTick((t) => t + 1), []);

  const displayName = technician
    ? `${technician.firstName ?? ''} ${technician.lastName ?? ''}`.trim() || technician.anonymousCode
    : '';

  const value = useMemo<TechnicianNavValue>(() => ({
    technicianId,
    technician,
    displayName,
    unseenApplicationResponses,
    pendingDirectOffers,
    unreadChats,
    refreshCounts,
    reloadTechnician,
  }), [technicianId, technician, displayName, unseenApplicationResponses, pendingDirectOffers, unreadChats, refreshCounts, reloadTechnician]);

  return <TechnicianNavContext.Provider value={value}>{children}</TechnicianNavContext.Provider>;
}

export function useTechnicianNav(): TechnicianNavValue {
  const value = useContext(TechnicianNavContext);
  if (!value) throw new Error('useTechnicianNav must be used inside TechnicianNavProvider (app/technician/_layout.tsx).');
  return value;
}
