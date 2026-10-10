// Los filtros de técnicos que comparten la búsqueda y el mapa de empresa
// (rediseño, fase 3B; respuesta 23 y decisiones del dueño del 2026-10-07).
//
// Cuelga del layout de empresa para que las dos pantallas lean el MISMO
// estado. Guarda sólo lo APLICADO: lo que se toca en el panel es un borrador
// de cada pantalla, que pasa a aplicarse al pulsar "Show technicians".
//
// Duración: se conservan mientras se está en búsqueda, mapa o el perfil de un
// técnico abierto desde ellos; al salir a cualquier otra sección se vacían.
// La regla vive, pura y probada, en src/utils/technicianFilters.ts
// (appliedAfterNavigation); aquí sólo se le pasa cada cambio de ruta.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'expo-router';
import {
  NO_APPLIED_FILTERS,
  appliedAfterNavigation,
  applyTechnicianFilters,
  isTechnicianFilterScope,
  type AppliedTechnicianFilters,
  type TechnicianFilterState,
} from '../utils/technicianFilters';

const RESET_DELAY_MS = 400;

export interface TechnicianFiltersValue {
  /** Los filtros aplicados (vacíos hasta el primer "Show technicians"). */
  applied: TechnicianFilterState;
  /** 0 hasta pulsar "Show technicians"; sube cada vez que se aplican. */
  version: number;
  searchTab: 'all' | 'contacts';
  setSearchTab: (tab: 'all' | 'contacts') => void;
  /** "Show technicians". */
  apply: (next: TechnicianFilterState) => void;
}

const TechnicianFiltersContext = createContext<TechnicianFiltersValue | null>(null);

export function TechnicianFiltersProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<AppliedTechnicianFilters>(NO_APPLIED_FILTERS);

  // Fuera de búsqueda y mapa se vacían, pero no al instante: al volver del
  // mapa a la lista (dismissTo), la ruta puede pasar un momento por la pestaña
  // que hubiera debajo antes de llegar a /company/search. Si en ese margen se
  // vuelve a búsqueda o mapa, el vaciado se cancela.
  useEffect(() => {
    if (isTechnicianFilterScope(pathname)) return undefined;
    const timer = setTimeout(() => {
      setState((current) => appliedAfterNavigation(current, pathname));
    }, RESET_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  const apply = useCallback((next: TechnicianFilterState) => {
    setState((current) => applyTechnicianFilters(current, next));
  }, []);

  const setSearchTab = useCallback((searchTab: 'all' | 'contacts') => {
    setState((current) => ({ ...current, searchTab }));
  }, []);

  const value = useMemo<TechnicianFiltersValue>(
    () => ({ applied: state.filters, version: state.version, apply, searchTab: state.searchTab ?? 'all', setSearchTab }),
    [state, apply, setSearchTab],
  );

  return <TechnicianFiltersContext.Provider value={value}>{children}</TechnicianFiltersContext.Provider>;
}

export function useTechnicianFilters(): TechnicianFiltersValue {
  const value = useContext(TechnicianFiltersContext);
  if (!value) throw new Error('useTechnicianFilters must be used inside TechnicianFiltersProvider (app/company/_layout.tsx).');
  return value;
}
