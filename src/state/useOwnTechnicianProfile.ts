// El perfil propio del técnico, para You, My work y las pantallas pequeñas
// (rediseño, fase 6A). Lo carga el caso de uso (loadEditableTechnicianProfile),
// que pasa por el repositorio: ninguna de estas pantallas llama a Supabase.
//
// Cada pantalla tiene su copia y la pide al montarse. You la vuelve a pedir al
// recuperar el foco (`refreshOnFocus`), sin parpadeo, para enseñar lo que una
// pantalla pequeña acaba de guardar. Las pantallas de formulario no: recargar
// al volver el foco les borraría lo que el técnico está escribiendo.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useTechnicianSession } from './SessionContext';
import { loadEditableTechnicianProfile } from '../usecases/technicianProfile';
import { AircraftRatingIndex, buildAircraftRatingIndex } from '../constants/aircraftTypeRatings';
import type { EditableTechnicianProfile } from '../types/technicianProfileEdit';

export interface OwnTechnicianProfileState {
  technicianId: string | undefined;
  profile: EditableTechnicianProfile | null;
  /** Los ratings que nombran sus habilitaciones y su experiencia. */
  ratingsById: AircraftRatingIndex;
  /** Sólo la primera carga; las recargas no vuelven a enseñar el spinner. */
  loading: boolean;
  error: string | null;
  /** La sesión no tiene perfil de técnico (alta sin terminar). */
  notSetUp: boolean;
  /** Vuelve a pedirlo. Resuelve con el perfil nuevo (o null si falló). */
  reload: () => Promise<EditableTechnicianProfile | null>;
}

export function useOwnTechnicianProfile(options: { refreshOnFocus?: boolean } = {}): OwnTechnicianProfileState {
  const session = useTechnicianSession();
  const technicianId = session?.technicianId || undefined;
  const [profile, setProfile] = useState<EditableTechnicianProfile | null>(null);
  const [ratingsById, setRatingsById] = useState<AircraftRatingIndex>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const requestId = useRef(0);
  const loadedOnce = useRef(false);

  const reload = useCallback(async (): Promise<EditableTechnicianProfile | null> => {
    const id = ++requestId.current;
    if (!technicianId) {
      setNotSetUp(true);
      setLoading(false);
      return null;
    }
    try {
      const result = await loadEditableTechnicianProfile(technicianId);
      if (id !== requestId.current) return null;
      setError(null);
      if (!result) {
        setNotSetUp(true);
        setProfile(null);
        return null;
      }
      setNotSetUp(false);
      setProfile(result.profile);
      setRatingsById(buildAircraftRatingIndex(result.ratings));
      loadedOnce.current = true;
      return result.profile;
    } catch (err: any) {
      if (id !== requestId.current) return null;
      setError(err?.message ?? 'Failed to load profile. Please try again.');
      return null;
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [technicianId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refreshOnFocus = options.refreshOnFocus === true;
  useFocusEffect(
    useCallback(() => {
      // La primera carga ya la hace el efecto de arriba.
      if (refreshOnFocus && loadedOnce.current) void reload();
    }, [refreshOnFocus, reload]),
  );

  return { technicianId, profile, ratingsById, loading, error, notSetUp, reload };
}
