import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AppRole, UserStatus } from '../types/enums';
import { persistedLocationFromAirport } from '../utils/locationBridge';
import { authErrorText, isEmailNotConfirmed } from './emailConfirmationRules';

export interface SupabaseProfile {
  id: string;
  role: AppRole;
  status: UserStatus;
  created_at: string;
}

interface AuthContextValue {
  session: Session | null;
  profile: SupabaseProfile | null;
  /** True until initial session restore + optional profile fetch completes */
  loading: boolean;
  /**
   * `emailNotConfirmed`: la cuenta existe pero falta confirmar el email (sólo
   * pasa con la confirmación activada en Supabase). El login lleva entonces a
   * "Check your email" en vez de mostrar el error.
   */
  signIn: (email: string, password: string) => Promise<{ error: string | null; emailNotConfirmed: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<SupabaseProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let hydrationGeneration = 0;
    let authEventObserved = false;
    let currentUserId: string | null = null;

    // Supabase warns against awaiting other Supabase calls inside an
    // onAuthStateChange callback because the auth client can deadlock. Keep
    // that callback synchronous and move profile/consent I/O to a later task.
    function applySession(s: Session | null): void {
      const nextUserId = s?.user.id ?? null;
      const userChanged = currentUserId !== nextUserId;
      currentUserId = nextUserId;
      setSession(s);
      if (s) {
        if (userChanged) {
          // Never render one account's profile alongside another account's
          // session while the replacement profile is being loaded.
          setProfile(null);
          setLoading(true);
        }
        const generation = ++hydrationGeneration;
        setTimeout(() => {
          void (async () => {
            let nextProfile: SupabaseProfile | null = null;
            let profileLoadSucceeded = false;
            try {
              await ensureRoleProfile(s.user);
              nextProfile = await loadProfile(s.user.id);
              profileLoadSucceeded = true;
              await ensureLegalConsent(s.user);
            } catch (error) {
              console.error('Failed to hydrate the authenticated profile:', error);
            }
            if (!active || generation !== hydrationGeneration) return;
            // A transient PostgREST error must not erase an already loaded
            // profile and cause a logged-in user to be redirected as a guest.
            if (profileLoadSucceeded) setProfile(nextProfile);
            setLoading(false);
          })();
        }, 0);
      } else {
        hydrationGeneration += 1;
        setProfile(null);
        setLoading(false);
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        if (!active) return;
        authEventObserved = true;
        if (event === 'TOKEN_REFRESHED' && s && currentUserId === s.user.id) {
          // Keep the fresh token without repeating profile/consent I/O.
          setSession(s);
          return;
        }
        applySession(s);
      },
    );

    // Restore an existing session if no auth event won the race first.
    void supabase.auth.getSession()
      .then(({ data: { session: s } }) => {
        if (active && !authEventObserved) applySession(s);
      })
      .catch((error) => {
        console.error('Failed to restore the auth session:', error);
        if (active && !authEventObserved) applySession(null);
      });

    return () => {
      active = false;
      hydrationGeneration += 1;
      subscription.unsubscribe();
    };
  }, []);

  // Called on every SIGNED_IN event. When email confirmation is enabled,
  // data.session is null at signUp() time so the RPC is skipped there.
  // This function detects that gap and creates the role profile on first login.
  /**
   * Los parámetros de localización para los RPC de alta, sirviendo a los DOS
   * tipos de metadata que conviven ahora mismo:
   *
   *   - Escrita por el formulario de F2c: ya trae país y ciudad.
   *   - Escrita ANTES: sólo trae `location_city_id`, un aeropuerto. Se
   *     traduce a país aquí, porque el RPC nuevo ya no acepta aeropuertos.
   *
   * El segundo caso no es hipotético: es toda cuenta registrada y pendiente
   * de confirmar el email en el momento del despliegue. Sin esta rama,
   * confirmar el correo dejaría al usuario sin perfil y sin ningún error
   * visible — `ensureRoleProfile` traga las excepciones a propósito.
   */
  function signupLocationParams(meta: Record<string, any>): Record<string, unknown> {
    if (meta.location_country_code) {
      return {
        p_location_country_code: meta.location_country_code,
        p_location_city_name: meta.location_city_name ?? null,
        p_location_city_lat: meta.location_city_lat ?? null,
        p_location_city_lng: meta.location_city_lng ?? null,
        p_location_city_geoname_id: meta.location_city_geoname_id ?? null,
      };
    }

    const legacy = meta.location_city_id ? persistedLocationFromAirport(meta.location_city_id) : null;
    return {
      // Cadena vacía si ni siquiera eso: el RPC lanza con un mensaje claro
      // ("Unknown or inactive country") en vez de insertar una fila rota.
      p_location_country_code: legacy?.locationCountryCode ?? '',
      p_location_city_name: legacy?.locationCityName ?? null,
      // Sin coordenadas: las del aeropuerto no son las de la ciudad.
      p_location_city_lat: null,
      p_location_city_lng: null,
      p_location_city_geoname_id: null,
    };
  }

  async function ensureRoleProfile(user: User): Promise<void> {
    const meta = user.user_metadata ?? {};
    const role = meta.role as string | undefined;
    if (!role) return;

    try {
      if (role === 'technician') {
        const { data } = await supabase
          .from('technician_profiles')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!data) {
          await supabase.rpc('signup_technician', {
            p_first_name: meta.first_name ?? '',
            p_last_name: meta.last_name ?? '',
            p_birth_date: meta.birth_date ?? '',
            p_technician_type: meta.technician_type ?? '',
            // Fase 6 tanda A. `?? null` y no `?? []`: una cuenta creada
            // antes de que el alta preguntara por varios tipos sólo tiene el
            // singular en su metadata, y NULL es justo lo que hace que el
            // RPC caiga en ARRAY[p_technician_type] — el array vacío también
            // caería ahí, pero NULL lo dice sin ambigüedad. Sin este
            // parámetro, quien confirme el email después de este despliegue
            // se crearía con un solo tipo aunque hubiese elegido tres.
            p_technician_types: meta.technician_types ?? null,
            // Fase 7 F2c. `legacyLocation()` cubre el caso que se rompería en
            // silencio: una cuenta creada ANTES de este despliegue tiene en
            // sus metadatos un aeropuerto y ningún país. Sin la traducción,
            // quien confirme su correo ahora se queda sin perfil.
            ...signupLocationParams(meta),
            // `?? null` rather than `?? 0`: an account created before the
            // signup form asked for this has no value in its metadata, and
            // NULL means "not declared" — which never penalizes the
            // technician. Defaulting to 0 would invent a declaration of "no
            // experience" and get them filtered out of every offer with a
            // minimum. The signup form makes this required for new accounts;
            // this branch only runs for metadata written before that.
            p_years_experience: meta.years_experience ?? null,
          });
        }
      } else if (role === 'company_user') {
        const { data } = await supabase
          .from('company_members')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!data) {
          await supabase.rpc('signup_company', {
            p_company_name: meta.company_name ?? '',
            p_company_type: meta.company_type ?? '',
            ...signupLocationParams(meta),
          });
        }
      }
    } catch {
      // Best-effort: never block auth flow if profile creation fails
    }
  }

  /**
   * Email confirmation can make signUp() return no session, so the signup
   * screen cannot insert its audit row at that moment. On the first confirmed
   * session, copy the exact version and acceptance time already stored in Auth
   * metadata. Never substitute the current version: that would record consent
   * to text the user did not see.
   */
  async function ensureLegalConsent(user: User): Promise<void> {
    const meta = user.user_metadata ?? {};
    const consentVersion = typeof meta.tos_version === 'string' ? meta.tos_version.trim() : '';
    if (!consentVersion) return;

    const rawAcceptedAt = typeof meta.tos_accepted_at === 'string' ? meta.tos_accepted_at : '';
    const acceptedAt = rawAcceptedAt && !Number.isNaN(Date.parse(rawAcceptedAt))
      ? new Date(rawAcceptedAt).toISOString()
      : undefined;

    const { error } = await supabase.from('user_consents').upsert(
      {
        user_id: user.id,
        consent_type: 'tos_privacy',
        consent_version: consentVersion,
        ...(acceptedAt ? { accepted_at: acceptedAt } : {}),
      },
      { onConflict: 'user_id,consent_type,consent_version', ignoreDuplicates: true },
    );

    // Authentication must remain available if the audit write is temporarily
    // unavailable. This helper runs again on every restored/signed-in session.
    if (error) console.error('Failed to record legal consent audit row:', error.message);
  }

  async function loadProfile(userId: string): Promise<SupabaseProfile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, status, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return data ? data as SupabaseProfile : null;
  }

  async function signIn(
    email: string,
    password: string
  ): Promise<{ error: string | null; emailNotConfirmed: boolean }> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: authErrorText(error), emailNotConfirmed: isEmailNotConfirmed(error) };
    return { error: null, emailNotConfirmed: false };
  }

  async function signOut(): Promise<void> {
    setLoading(true);
    // scope: 'local' clears only this device's session.
    // Using 'global' would sign the user out of all their devices,
    // which is undesirable when two people share one device.
    await supabase.auth.signOut({ scope: 'local' });
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
