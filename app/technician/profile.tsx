import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { Button } from '../../src/components/Button';
import { CountryCityPicker } from '../../src/components/CountryCityPicker';
import { EMPTY_LOCATION, LocationValue } from '../../src/types/location';
import { locationValueFromPersisted, persistedLocationFromValue } from '../../src/utils/locationBridge';
import {
  InitialAvatar,
  TechnicianBadge,
  TechnicianCard,
  TechnicianChip,
  TechnicianPageHeader,
  TechnicianScreen,
  techStyles,
  techUi,
} from '../../src/components/technician/TechnicianUI';
import { useAuth } from '../../src/auth/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { Technician, AvailabilityStatus } from '../../src/types';
import { SocialLinks } from '../../src/types/technician';
import { isValidUrl, normalizeUrl } from '../../src/utils/urlValidation';
import { CONTRACT_TYPES } from '../../src/constants/contractTypes';
import {
  AUTHORITIES,
  AUTHORITY_LICENSES,
  LICENSE_CATEGORIES,
  authorityLabel,
  credentialLabel,
  typesAfterLicenseChange,
  typesImpliedByLicenses,
} from '../../src/constants/licenses';
import {
  HeldLicense,
  heldCountByAuthority,
  heldLicenseCodes,
  holdsLicense,
  sortHeldLicenses,
  toggleHeldLicense,
  updateHeldLicenseDates,
} from '../../src/utils/profileLicenses';
import { EngineExperienceEditor, EngineExperienceRow } from '../../src/components/technician/EngineExperienceEditor';
import { AuthorityCode, AuthorityLicenseCode } from '../../src/types/catalog';
import { TechnicianTypeSelector } from '../../src/components/TechnicianTypeSelector';
import { useTechnicianTypes } from '../../src/auth/useCatalogOptions';
import { AircraftRatingIndex, buildAircraftRatingIndex, getAircraftTypeRatingLabel } from '../../src/constants/aircraftTypeRatings';
import { HabilitationsEditor, HabilitationRow as HabRow } from '../../src/components/technician/HabilitationsEditor';
import { AircraftExperienceEditor, AircraftExperienceRow } from '../../src/components/technician/AircraftExperienceEditor';
import { DateField } from '../../src/components/DateField';
import { isValidDateOrder } from '../../src/utils/validityDates';
import { validateProfileYearsExperience } from '../../src/utils/yearsExperienceValidation';
import { technicianRepositoryV2 } from '../../src/repositories/v2/technicianRepositoryV2';
import { catalogRepository } from '../../src/repositories/v2/catalogRepository';
import { catalogRequestRepository } from '../../src/repositories/v2/catalogRequestRepository';
import { colors, spacing } from '../../src/theme';

// Paso 5b: aquí vivía `LicenseDetail`, las fechas de cada licencia indexadas
// por CÓDIGO. Ahora viajan dentro de cada credencial (HeldLicense), porque una
// B1.1 EASA y una B1.1 UK CAA tienen fechas distintas.

const DATE_FIELD_PALETTE = {
  text: techUi.text,
  muted: techUi.textMuted,
  border: techUi.border,
  surface: techUi.surfaceSoft,
  accent: techUi.accent,
};

type AvailabilityContract = Technician['availability']['contractTypes'][number];

// Dos estados, sin fecha (2026-07-29). El tercero ('available') y el campo
// "Available from" desaparecieron: elegir "Open to offers" sin fecha se
// guardaba como no disponible y volvía como "Unavailable" al recargar.
const AVAILABILITY_OPTIONS: { value: AvailabilityStatus; label: string }[] = [
  { value: 'open_to_offers', label: 'Open to offers' },
  { value: 'unavailable', label: 'Unavailable' },
];

type SupaTechRow = {
  id: string;
  anonymous_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  // Sin `technician_type`: esta pantalla ya no lo pide en su SELECT. Los
  // tipos vienen de `technician_profile_types` (Fase 6 tanda A).
  location_country_code: string;
  location_city_name: string | null;
  location_city_lat: number | null;
  location_city_lng: number | null;
  location_city_geoname_id: number | null;
  availability: {
    immediately?: boolean;
    contract_types?: string[];
  } | null;
  years_experience: number | null;
  verification_status: string;
  social_links: SocialLinks | null;
};

// Las tres claves que la UI ofrece hoy sobre technician_profiles.social_links.
// El tipo SocialLinks admite mas por index signature: si alguna vez llega una
// clave desconocida desde la BD, se conserva al guardar (ver handleSave) en
// vez de borrarse por no tener campo en pantalla.
const SOCIAL_FIELDS: { key: keyof SocialLinks & string; label: string; placeholder: string }[] = [
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/your-profile' },
  { key: 'instagram', label: 'Instagram', placeholder: 'instagram.com/your-handle' },
  { key: 'website', label: 'Personal website', placeholder: 'your-portfolio.com' },
];

function supaRowToForm(
  row: SupaTechRow,
  licenses: string[],
  aircraftTypes: string[],
  yearsExperience: number,
): Technician {
  const avail = row.availability ?? {};
  const immediately = avail.immediately ?? false;
  const contractTypes = (avail.contract_types ?? []) as AvailabilityContract[];
  const status: AvailabilityStatus = immediately ? 'open_to_offers' : 'unavailable';


  return {
    id: row.id,
    anonymousCode: row.anonymous_code,
    fullName: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email,
    phone: row.phone ?? '',
    // Fase 7 F2d: sin aeropuerto. `country` es el codigo ISO y las
    // coordenadas solo existen si la ciudad vino del directorio.
    country: row.location_country_code ?? '',
    city: row.location_city_name ?? '',
    baseAirport: '',
    locationCountryCode: row.location_country_code ?? undefined,
    latitude: row.location_city_lat ?? undefined,
    longitude: row.location_city_lng ?? undefined,
    licenseCategories: licenses,
    aircraftTypes,
    specialties: [],
    availability: { immediately, status, contractTypes },
    verificationStatus: row.verification_status as Technician['verificationStatus'],
    yearsExperience,
  };
}

function verificationTone(status: string): 'success' | 'warning' | 'error' | 'muted' {
  if (status === 'verified') return 'success';
  if (status === 'rejected') return 'error';
  if (status === 'pending') return 'warning';
  return 'muted';
}

function availabilityLabel(status?: AvailabilityStatus): string {
  return AVAILABILITY_OPTIONS.find((opt) => opt.value === status)?.label ?? 'Open to offers';
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionTitleBlock}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export default function TechnicianProfileScreen() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  // Mismo catalogo que el alta (tabla `technician_types`), para que el
  // selector compartido enseñe exactamente lo mismo en los dos sitios.
  const { options: techTypeOptions, loading: techTypesLoading } = useTechnicianTypes();

  const [techId, setTechId] = useState<string | null>(null);
  const [form, setForm] = useState<Technician | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  // Fase 7 F2c: la localizacion vive fuera de `form` porque `form` es el
  // shape V1 `Technician`, que sigue hablando de aeropuertos. Cuando ese
  // shape muera, esto se funde con el resto del formulario.
  const [location, setLocation] = useState<LocationValue>(EMPTY_LOCATION);
  const [saving, setSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [noTechProfile, setNoTechProfile] = useState(false);
  // Set only when a save partly succeeds — a deselected license couldn't be
  // removed because a habilitation still references it. Distinct from
  // profileError (a hard failure) since the rest of the save did go through.
  const [licenseRemovalWarning, setLicenseRemovalWarning] = useState<string | null>(null);

  // Habilitations are stored as explicit { licenseCode, aircraftTypeRatingId }
  // rows — never as a flat aircraft-type list saved against a "default"
  // license. See technicianRepositoryV2.replaceHabilitations().
  const [habilitations, setHabilitations] = useState<HabRow[]>([]);
  const [habDirty, setHabDirty] = useState(false);
  // Fase 6 tanda B: aeronaves declaradas SIN licencia. Lista aparte de
  // `habilitations` a proposito — ver AircraftExperienceEditor. Su propio
  // flag de sucio para no reescribir la tabla en cada guardado del perfil.
  const [aircraftExperience, setAircraftExperience] = useState<AircraftExperienceRow[]>([]);
  const [experienceDirty, setExperienceDirty] = useState(false);
  // Anios declarados como TEXTO: '' = no declarado (NULL en BD), distinto de
  // '0' = declarado sin experiencia. Estado propio y no `form.yearsExperience`
  // justamente porque el tipo V1 es `number` y no sabe expresar "no declarado".
  //
  // OJO: al vivir FUERA de `form`, no pasa por updateField() y por tanto NO
  // marca el formulario como sucio por si solo. Se edita siempre a traves de
  // updateYearsInput() de abajo, nunca con setYearsInput directamente — ese
  // fue justo el bug de la primera version (el boton "Save changes" no se
  // activaba al cambiar los anios).
  const [yearsInput, setYearsInput] = useState('');
  // Fase 6 tanda A: varios tipos de perfil, EDITABLES aqui (antes se fijaban
  // en el alta y no habia forma de cambiarlos). Fuera de `form` porque el
  // tipo V1 `Technician` no tiene este campo.
  //
  // 2026-08-13: los tipos IMPLICADOS por una licencia declarada ya no se
  // eligen — se marcan solos y se bloquean (ver `impliedTypes` y
  // toggleLicense). Los que no tienen licencia (chapa, pintura, composite)
  // siguen siendo enteramente libres, y un tecnico puede tener a la vez
  // implicados y manuales.
  //
  // `typesLoaded` distingue "aun no ha llegado" de "llego vacio". Sin esa
  // distincion, guardar antes de que responda la consulta mandaria [] a
  // replaceProfileTypes y borraria los tipos del tecnico.
  const [technicianTypes, setTechnicianTypes] = useState<string[]>([]);
  const [typesLoaded, setTypesLoaded] = useState(false);
  // Enlaces sociales, EN CRUDO tal y como los teclea el tecnico (sin
  // normalizar): normalizar en cada pulsacion pelearia con el cursor. La
  // normalizacion pasa una sola vez, al guardar.
  //
  // Vive FUERA de `form` por lo mismo que yearsInput: el tipo V1 `Technician`
  // no tiene socialLinks. Y por lo mismo, editalo SIEMPRE con
  // updateSocialLink() — setSocialInputs a pelo no marcaria el formulario
  // como sucio y el boton "Save changes" se quedaria apagado.
  const [socialInputs, setSocialInputs] = useState<Record<string, string>>({});
  // Claves que ya venian en la BD y para las que esta pantalla no tiene campo.
  // Se reescriben tal cual al guardar; nunca se pierden por no ser visibles.
  const [unknownSocialKeys, setUnknownSocialKeys] = useState<SocialLinks>({});
  // Paso 5b: las licencias como CREDENCIALES (autoridad + código), con sus
  // fechas dentro. `form.licenseCategories` sigue existiendo —lo exige el tipo
  // V1 y lo lee la implicación de oficio— y se mantiene como los códigos de
  // éstas (heldLicenseCodes) desde toggleLicense.
  const [heldLicenses, setHeldLicenses] = useState<HeldLicense[]>([]);
  // Qué autoridad enseñan los chips de licencia. Es una VISTA, no un dato: no
  // se guarda y no rellena nada. Sin licencias arranca sin elegir.
  const [licenseAuthorityView, setLicenseAuthorityView] = useState<AuthorityCode | null>(null);
  // Motores declarados (paso 5b). Mismo patrón de "sucio" que la experiencia
  // en aeronaves: sin tocarlos, guardar no los reescribe.
  const [engines, setEngines] = useState<EngineExperienceRow[]>([]);
  const [enginesDirty, setEnginesDirty] = useState(false);
  // Resolves BOTH active and inactive rating ids referenced by this
  // technician's own habilitations (loaded ones + newly picked ones) — not
  // the same as the picker's own active-only search list. Needed so a
  // previously-selected, now-deactivated rating still shows a real label
  // instead of a bare UUID (see catalogRepository.getAircraftTypeRatingsByIds).
  const [ratingsById, setRatingsById] = useState<AircraftRatingIndex>(new Map());

  const [requestPanelOpen, setRequestPanelOpen] = useState(false);
  const [requestLicense, setRequestLicense] = useState<string | null>(null);
  const [requestAircraft, setRequestAircraft] = useState('');
  const [requestLabel, setRequestLabel] = useState('');
  const [requestNotes, setRequestNotes] = useState('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  // Auth guards
  useEffect(() => {
    if (!authLoading && !profile) {
      router.replace('/auth/login' as any);
    }
  }, [authLoading, profile]);

  useEffect(() => {
    if (!authLoading && profile?.status === 'pending_verification') {
      router.replace('/auth/pending-verification' as any);
    }
  }, [authLoading, profile]);

  const loadProfile = useCallback(async () => {
    if (!profile?.id) return;
    setProfileLoading(true);
    setProfileError(null);
    setNoTechProfile(false);

    try {
      const { data: techRow, error: techErr } = await supabase
        .from('technician_profiles')
        // Sin `technician_type`: los tipos salen de la tabla puente de abajo.
        .select(
          'id, anonymous_code, first_name, last_name, email, phone, location_country_code, location_city_name, location_city_lat, location_city_lng, location_city_geoname_id, availability, years_experience, verification_status, social_links',
        )
        .eq('user_id', profile.id)
        .maybeSingle();

      if (techErr) throw techErr;

      if (!techRow) {
        setNoTechProfile(true);
        setProfileLoading(false);
        return;
      }

      setTechId(techRow.id);

      const [licResult, habResult, typeResult, expResult, engResult] = await Promise.all([
        supabase
          .from('technician_licenses')
          .select('id, authority, license_code, issued_at, expires_at')
          .eq('technician_id', techRow.id),
        supabase
          .from('technician_habilitations')
          .select('id, technician_license_id, license_code, aircraft_type_rating_id, experience_years, issued_at, expires_at, is_current')
          .eq('technician_id', techRow.id),
        supabase
          .from('technician_profile_types')
          .select('type_code')
          .eq('technician_id', techRow.id)
          .order('type_code'),
        supabase
          .from('technician_aircraft_experience')
          .select('id, aircraft_type_rating_id, years')
          .eq('technician_id', techRow.id)
          .order('created_at'),
        supabase
          .from('technician_engine_experience')
          .select('id, engine_id, years')
          .eq('technician_id', techRow.id)
          .order('created_at'),
      ]);

      // Un fallo cargando licencias NO se traga, por lo mismo que los tipos:
      // guardar con la lista vacía mandaría a borrar las que el técnico tiene.
      if (licResult.error) throw licResult.error;
      const licRows = (licResult.data ?? []) as {
        id: string;
        authority: AuthorityCode;
        license_code: AuthorityLicenseCode;
        issued_at: string | null;
        expires_at: string | null;
      }[];
      const loadedLicenses: HeldLicense[] = sortHeldLicenses(
        licRows.map((r) => ({
          authority: r.authority,
          code: r.license_code,
          issuedAt: r.issued_at ?? undefined,
          expiresAt: r.expires_at ?? undefined,
        })),
      );
      const licenses = heldLicenseCodes(loadedLicenses);
      const authorityByLicenseId = new Map(licRows.map((r) => [r.id, r.authority]));
      setHeldLicenses(loadedLicenses);
      setLicenseAuthorityView((prev) => prev ?? loadedLicenses[0]?.authority ?? null);

      // Un fallo aqui NO se traga: sin tipos cargados, guardar mandaria [] a
      // replaceProfileTypes (que lo rechaza) o, peor, el selector enseñaria
      // el perfil como si no tuviera ninguno. Mejor caer al banner de error.
      if (typeResult.error) throw typeResult.error;
      const loadedTypes = ((typeResult.data ?? []) as { type_code: string }[]).map((r) => r.type_code);
      // Los implicados se AÑADEN a lo que diga la fila, y por eso se cargan
      // las licencias primero. Una fila anterior a la invariante (2026-08-13)
      // puede tener una B1.1 y sólo la casilla de aviónico; enseñarla tal cual
      // dejaria el chip de mecanico desmarcado y desbloqueado, contradiciendo
      // en pantalla la regla que el guardado impone — y ese guardado seria
      // ademas rechazado sin que el tecnico hubiera tocado nada.
      //
      // Se usa el setter PLANO a proposito, nunca updateTechnicianTypes(): la
      // reparacion entra en el estado INICIAL, no como una edicion del
      // tecnico. Con `setIsDirty(true)` de por medio, abrir el perfil y
      // salir sin tocar nada sacaria el aviso de "Unsaved changes" y
      // encenderia el boton de guardar por una fila que el tecnico no ha
      // editado. Asi, la reparacion viaja con el proximo guardado real y por
      // si sola no escribe nada.
      setTechnicianTypes([...new Set([...loadedTypes, ...typesImpliedByLicenses(licenses)])]);
      setTypesLoaded(true);

      if (habResult.error) throw habResult.error;
      const habRows = (habResult.data ?? []) as {
        id: string;
        technician_license_id: string;
        license_code: string;
        aircraft_type_rating_id: string | null;
        experience_years: number | null;
        issued_at: string | null;
        expires_at: string | null;
        is_current: boolean;
      }[];
      // The rating-id filter stays until migration 029 makes the column NOT
      // NULL — after that it can never exclude anything. It is not a legacy
      // path: a row with no rating id names no aircraft and has nothing to
      // render.
      const normalizedHabs: HabRow[] = habRows
        .filter((r) => r.aircraft_type_rating_id)
        .map((r) => {
          // La autoridad sale de la licencia a la que APUNTA la fila
          // (technician_license_id, NOT NULL con FK desde la 074), nunca del
          // código: con dos B1.1 el código no dice de cuál es.
          const authority = authorityByLicenseId.get(r.technician_license_id);
          if (!authority) {
            throw new Error('A type rating on your profile points at a licence that could not be loaded. Reload and try again.');
          }
          return { r, authority };
        })
        .map(({ r, authority }) => ({
          id: r.id,
          authority,
          licenseCode: r.license_code,
          aircraftTypeRatingId: r.aircraft_type_rating_id as string,
          experienceYears: r.experience_years ?? undefined,
          issuedAt: r.issued_at ?? undefined,
          expiresAt: r.expires_at ?? undefined,
          isCurrent: r.is_current,
        }));
      setHabilitations(normalizedHabs);
      setHabDirty(false);

      // Experiencia sin licencia (Fase 6 tanda B). Un fallo aqui NO se traga,
      // por lo mismo que los tipos: si la lista no carga, guardar mandaria []
      // a replaceAircraftExperience y borraria lo que el tecnico tenia
      // declarado sin que nadie se enterara.
      if (expResult.error) throw expResult.error;
      const expRows = (expResult.data ?? []) as {
        id: string;
        aircraft_type_rating_id: string;
        years: number | null;
      }[];
      const normalizedExperience: AircraftExperienceRow[] = expRows.map((r) => ({
        id: r.id,
        aircraftTypeRatingId: r.aircraft_type_rating_id,
        years: r.years ?? undefined,
      }));
      setAircraftExperience(normalizedExperience);
      setExperienceDirty(false);

      // Motores declarados (paso 5b). Mismo motivo para no tragarse el fallo:
      // guardar con [] borraría los que el técnico tenía.
      if (engResult.error) throw engResult.error;
      setEngines(
        ((engResult.data ?? []) as { id: string; engine_id: string; years: number | null }[]).map((r) => ({
          id: r.id,
          engineId: r.engine_id,
          years: r.years ?? undefined,
        })),
      );
      setEnginesDirty(false);

      // Resolve every referenced rating id in one batched call — includes
      // inactive ratings, since an existing habilitation may point at one.
      // Las dos listas comparten catalogo, asi que se resuelven juntas: sin
      // los ids de la experiencia, sus filas se pintarian con un UUID crudo.
      const resolvedRatings = await catalogRepository.getAircraftTypeRatingsByIds([
        ...normalizedHabs.map((h) => h.aircraftTypeRatingId),
        ...normalizedExperience.map((e) => e.aircraftTypeRatingId),
      ]);
      const resolvedIndex = buildAircraftRatingIndex(resolvedRatings);
      setRatingsById(resolvedIndex);

      // '' cuando la columna es NULL: "no declarado" y "0 anios" son estados
      // distintos y el string vacio es el unico que sabe expresar el primero.
      setYearsInput(techRow.years_experience == null ? '' : String(techRow.years_experience));

      // social_links: se reparte en los tres campos conocidos y un cajon con
      // el resto, para poder devolverlo intacto al guardar.
      const storedSocial = (techRow.social_links ?? {}) as SocialLinks;
      const knownKeys = SOCIAL_FIELDS.map((f) => f.key);
      const loadedInputs: Record<string, string> = {};
      knownKeys.forEach((k) => {
        loadedInputs[k] = storedSocial[k] ?? '';
      });
      setSocialInputs(loadedInputs);
      setUnknownSocialKeys(
        Object.fromEntries(Object.entries(storedSocial).filter(([k]) => !knownKeys.includes(k))),
      );

      const aircraftTypes = [...new Set(
        normalizedHabs
          .map((h) => resolvedIndex.get(h.aircraftTypeRatingId)?.aircraftFamily)
          .filter((v): v is string => Boolean(v)),
      )];

      // Los anios ya no se derivan de technician_aircraft_experience (tabla
      // retirada, migracion 031): salen del campo declarado del perfil, que
      // se carga arriba en yearsInput. El 0 que se pasa aqui solo alimenta el
      // tipo V1 `Technician`, que exige un number y no sabe expresar "no
      // declarado"; la fuente de verdad para mostrar y guardar es yearsInput.
      setForm(supaRowToForm(techRow as SupaTechRow, licenses, aircraftTypes, techRow.years_experience ?? 0));
      // El nombre del pais sale de la fila; el selector lo reemplazara por
      // el del catalogo vivo en cuanto el tecnico lo abra.
      const row = techRow as SupaTechRow;
      setLocation(
        locationValueFromPersisted(
          {
            locationCountryCode: row.location_country_code,
            locationCityName: row.location_city_name ?? undefined,
            locationCityLat: row.location_city_lat ?? undefined,
            locationCityLng: row.location_city_lng ?? undefined,
            locationCityGeonameId: row.location_city_geoname_id ?? undefined,
          },
          row.location_country_code ?? '',
        ),
      );
    } catch (err: any) {
      setProfileError(err?.message ?? 'Failed to load profile. Please try again.');
    } finally {
      setProfileLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile]),
  );

  // Fase 6 tanda A (2026-08-10): AQUI VIVIA `holdsPart66Qualifications`, que
  // escondia las secciones de Licenses y Habilitations a los tipos que no
  // certifican. Se retira: el eje Part-66 se muestra SIEMPRE.
  //
  // Su premisa original ("son datos que no existen para el") ya no se
  // sostiene. Estar licenciado es propiedad de la PERSONA, no del tipo, asi
  // que un pintor puede tener una B1.1 perfectamente real — y con el gate
  // puesto no tendria donde meterla salvo marcandose "mechanic" para
  // desbloquear el formulario, que es un rodeo absurdo y ademas falsea sus
  // tipos.
  //
  // `isLicensedTechnicianType` estuvo SIN CONSUMIDORES desde la Tanda C, y
  // volvio a tenerlos el 2026-08-13: el formulario de oferta decide con ella
  // si la pregunta "¿hace falta licencia?" existe. Sale del barrido de
  // exports muertos. Lo que NO cambia es esta pantalla: aqui el eje Part-66
  // se sigue mostrando siempre, porque estar licenciado es propiedad de la
  // persona y no de la etiqueta que eligio al registrarse.

  function updateField<K extends keyof Technician>(key: K, value: Technician[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setIsDirty(true);
  }

  // Unico punto de edicion de yearsInput desde la UI: mantiene el flag de
  // sucio en linea con el resto de campos del formulario.
  function updateYearsInput(value: string) {
    setYearsInput(value.replace(/[^0-9]/g, ''));
    setIsDirty(true);
  }

  // Unico punto de edicion de socialInputs desde la UI (ver el comentario del
  // estado): mantiene el flag de sucio en linea con el resto del formulario.
  function updateSocialLink(key: string, value: string) {
    setSocialInputs((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }

  // Unico punto de edicion de technicianTypes desde la UI. El minimo de uno
  // lo hace cumplir TechnicianTypeSelector, y el bloqueo de los implicados
  // tambien (con `lockedCodes`), no esto.
  function updateTechnicianTypes(next: string[]) {
    setTechnicianTypes(next);
    setIsDirty(true);
  }

  function markDirty() {
    setIsDirty(true);
  }

  function updateFields(patch: Partial<Technician>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setIsDirty(true);
  }

  function updateAvailability(patch: Partial<Technician['availability']>) {
    setForm((prev) => {
      if (!prev) return prev;
      return { ...prev, availability: { ...prev.availability, ...patch } };
    });
    setIsDirty(true);
  }

  // La licencia DECIDE el oficio, y esta es la unica direccion (2026-08-13):
  // anadir una licencia marca su tipo implicado, y quitar la ultima que
  // implicaba un tipo lo desmarca. El tecnico sigue pudiendo declarar
  // CUALQUIER licencia — la lista de chips de arriba no se filtra por nada.
  //
  // La reasignacion vive en `typesAfterLicenseChange`, pura y con tests: los
  // tipos manuales sobreviven, y ninguna licencia deja colgado el tipo de
  // otra.
  //
  // Paso 5b: se añade o quita una CREDENCIAL (autoridad + código). La
  // implicación de oficio sigue mirando CÓDIGOS: quitar la B1.1 EASA cuando
  // queda la UK CAA no cambia ningún código, y por tanto no toca los tipos.
  function toggleLicense(authority: AuthorityCode, code: AuthorityLicenseCode) {
    if (!form) return;
    const next = sortHeldLicenses(toggleHeldLicense(heldLicenses, authority, code));
    const nextCodes = heldLicenseCodes(next);
    setHeldLicenses(next);
    updateField('licenseCategories', nextCodes);
    setTechnicianTypes((prev) => typesAfterLicenseChange(prev, form.licenseCategories, nextCodes));
  }

  function updateLicenseDetail(authority: string, code: string, patch: Pick<HeldLicense, 'issuedAt' | 'expiresAt'>) {
    setHeldLicenses((prev) => updateHeldLicenseDates(prev, authority, code, patch));
    setIsDirty(true);
  }

  function onChangeEngines(next: EngineExperienceRow[]) {
    setEngines(next);
    setEnginesDirty(true);
    setIsDirty(true);
  }

  // HabilitationsEditor owns add/remove/vigencia-field mutation internally
  // (mirrors TypeRatingRequirementsEditor) — this is the single point where
  // the resulting array flows back up, marking both dirty flags exactly
  // like the three separate handlers it replaces used to.
  function onChangeHabilitations(next: HabRow[]) {
    setHabilitations(next);
    setHabDirty(true);
    setIsDirty(true);
  }

  // Mismo patron que el de arriba, para la lista de experiencia sin licencia.
  function onChangeAircraftExperience(next: AircraftExperienceRow[]) {
    setAircraftExperience(next);
    setExperienceDirty(true);
    setIsDirty(true);
  }

  async function submitCatalogRequest() {
    if (!profile?.id || !requestLabel.trim()) return;
    setRequestSubmitting(true);
    try {
      await catalogRequestRepository.create({
        requestedBy: profile.id,
        rawText: requestLabel.trim(),
        context: [
          requestLicense && `License: ${requestLicense}`,
          requestAircraft.trim() && `Aircraft/family: ${requestAircraft.trim()}`,
          requestNotes.trim(),
        ]
          .filter(Boolean)
          .join(' — ') || undefined,
      });
      setRequestSubmitted(true);
    } catch (err: any) {
      setProfileError(err?.message ?? 'Could not send the request. Please try again.');
    } finally {
      setRequestSubmitting(false);
    }
  }

  function toggleContractType(type: AvailabilityContract) {
    if (!form) return;
    const current = form.availability.contractTypes;
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    updateAvailability({ contractTypes: next });
  }

  async function handleSave() {
    if (!form || !isDirty || !techId) return;

    // Los tipos aun no han llegado: guardar ahora los borraria. No es un
    // caso teorico — basta con pulsar Save mientras la consulta esta en
    // vuelo.
    if (!typesLoaded) {
      setProfileError('Still loading your profile types. Try again in a moment.');
      return;
    }
    if (technicianTypes.length === 0) {
      setProfileError('Select at least one profile type.');
      return;
    }

    // Los anios declarados son OBLIGATORIOS desde que el alta los pide
    // (migracion 044). Aqui se revalida porque esta pantalla es el otro
    // camino de escritura del campo: sin esto, un tecnico podia vaciar la
    // casilla y volver a dejar su perfil en "no declarado".
    //
    // OJO: '' y '0' NO son lo mismo y esa distincion se respeta intacta —
    // esto rechaza SOLO la cadena vacia. Declarar 0 anios sigue siendo una
    // respuesta valida y se guarda como 0, no como NULL.
    const yearsError = validateProfileYearsExperience(yearsInput);
    if (yearsError) {
      setProfileError(yearsError);
      return;
    }

    // Client-side validation only — must never reach the database as a
    // constraint error. Absent dates are neutral (checked inside
    // isValidDateOrder); only an explicit expiresAt on/before issuedAt is
    // flagged.
    const dateErrors: string[] = [];
    heldLicenses.forEach((license) => {
      if (!isValidDateOrder(license.issuedAt, license.expiresAt)) {
        dateErrors.push(`${credentialLabel(license.authority, license.code)}: expiry date must be after the issue date.`);
      }
    });
    habilitations.forEach((h) => {
      if (!isValidDateOrder(h.issuedAt, h.expiresAt)) {
        dateErrors.push(
          `${credentialLabel(h.authority, h.licenseCode)} + ${getAircraftTypeRatingLabel(h.aircraftTypeRatingId, ratingsById)}: expiry date must be after the issue date.`,
        );
      }
    });
    if (dateErrors.length > 0) {
      setProfileError(dateErrors.join(' '));
      return;
    }

    // Enlaces sociales: se valida ANTES de tocar la BD, igual que las fechas.
    // Un enlace vacio es valido (campo opcional) y simplemente no se guarda.
    const socialErrors = SOCIAL_FIELDS.filter((f) => !isValidUrl(socialInputs[f.key] ?? '')).map(
      (f) => `${f.label}: enter a valid link (e.g. ${f.placeholder}).`,
    );
    if (socialErrors.length > 0) {
      setProfileError(socialErrors.join(' '));
      return;
    }

    // 2026-08-13: AQUI VIVIA EL DIALOGO DE LICENCIAS HUERFANAS, que al quitar
    // un tipo ofrecia retirar las licencias de ese oficio. Desaparece entero,
    // con `findOrphanedLicenses`: ya no puede darse el caso que lo motivaba.
    // Un tipo implicado por una licencia declarada no se puede quitar (el
    // chip esta bloqueado), asi que ninguna licencia puede quedar huerfana —
    // y al reves, quitar la licencia se lleva su tipo sin preguntar nada,
    // porque no hay nada que decidir.

    // Se persiste la forma normalizada y SIN claves vacias; las claves que no
    // tienen campo en esta pantalla se devuelven intactas. Objeto vacio -> NULL,
    // para no dejar `{}` en la columna.
    const socialToSave: SocialLinks = { ...unknownSocialKeys };
    SOCIAL_FIELDS.forEach((f) => {
      const normalized = normalizeUrl(socialInputs[f.key] ?? '');
      if (normalized !== '') socialToSave[f.key] = normalized;
    });
    const socialDeclared = Object.keys(socialToSave).length > 0;

    const persistedLocation = persistedLocationFromValue(location);


    const nameParts = form.fullName.trim().split(/\s+/);
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName;

    // El booleano ES el modelo; `status` es sólo su etiqueta de UI y nunca
    // se persiste.
    const immediately = form.availability.status === 'open_to_offers';

    // Never filter habilitations by which licenses are still selected —
    // technician_habilitations references technician_licenses via a
    // composite FK, so a license the technician deselected but that still
    // has a habilitation here simply won't be removable below (see
    // removeUnreferencedLicenses); silently dropping the habilitation
    // instead would destroy real technician data just to force the license
    // removal through.
    const derivedAircraftTypes = [...new Set(
      habilitations
        .map((h) => ratingsById.get(h.aircraftTypeRatingId)?.aircraftFamily)
        .filter((v): v is string => Boolean(v)),
    )];
    const trimmedYears = yearsInput.trim();
    const yearsToSave = trimmedYears === '' ? null : Math.max(0, Math.min(70, parseInt(trimmedYears, 10) || 0));

    setSaving(true);
    setProfileError(null);
    setLicenseRemovalWarning(null);
    try {
      // Update main profile row.
      // `.select('id')` no es decorativo: sin él, si tp_update_own no dejara
      // pasar la fila (p. ej. la cuenta deja de estar `active` mientras el
      // formulario está abierto), PostgREST devolvería 0 filas y CERO error,
      // y la pantalla diría "Profile saved" sin haber guardado nada.
      const { data: updatedRows, error: updateErr } = await supabase
        .from('technician_profiles')
        .update({
          first_name: firstName,
          last_name: lastName,
          email: form.email,
          phone: form.phone || null,
          // Fase 7 F2c: las cinco columnas juntas. Cambiar de pais limpia
          // las coordenadas de la ciudad anterior en vez de dejarlas.
          location_country_code: persistedLocation.locationCountryCode,
          location_city_name: persistedLocation.locationCityName ?? null,
          location_city_lat: persistedLocation.locationCityLat ?? null,
          location_city_lng: persistedLocation.locationCityLng ?? null,
          location_city_geoname_id: persistedLocation.locationCityGeonameId ?? null,
          availability: {
            immediately,
            contract_types: form.availability.contractTypes,
          },
          years_experience: yearsToSave,
          social_links: socialDeclared ? socialToSave : null,
        })
        .eq('id', techId)
        .select('id');

      if (updateErr) throw updateErr;
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error('Could not save your profile — your session may have expired. Sign in again and retry.');
      }

      // 1) Tipos de perfil. Diferencial y con los añadidos antes que los
      // borrados, para que un fallo a mitad nunca deje al tecnico sin
      // ninguno — ver technicianRepositoryV2.replaceProfileTypes.
      //
      // Las licencias van como SEGUNDO argumento y son las que el tecnico
      // tiene seleccionadas AHORA, no las que hay en la base: este paso corre
      // ANTES de escribirlas (2 y 5), asi que si el guardado las reduce, los
      // tipos implicados son los de las que van a QUEDAR. Pasar las de la
      // base rechazaria el guardado por un tipo que esta misma accion esta
      // quitando.
      await technicianRepositoryV2.replaceProfileTypes(techId, technicianTypes, form.licenseCategories);

      // 2) Upsert held licenses in place FIRST — never delete+reinsert (see
      // technicianRepositoryV2.upsertLicenses). Ensures any brand-new
      // license code already has a row before a habilitation below can
      // reference it.
      // Paso 5b: cada credencial con SU autoridad; el repositorio ya no rellena
      // EASA.
      await technicianRepositoryV2.upsertLicenses(
        techId,
        heldLicenses.map((license) => ({
          authority: license.authority,
          code: license.code,
          issuedAt: license.issuedAt,
          expiresAt: license.expiresAt,
        })),
      );

      // 3) Replace normalized habilitations — each row carries its own
      // explicit licenseCode, never a "default" license applied to every
      // aircraft. Legacy rows (aircraft_type_rating_id IS NULL) are left
      // untouched. The full local set is sent, unfiltered (see above).
      if (habDirty) {
        await technicianRepositoryV2.replaceHabilitations(
          techId,
          habilitations.map((h) => ({
            authority: h.authority,
            licenseCode: h.licenseCode,
            aircraftTypeRatingId: h.aircraftTypeRatingId,
            experienceYears: h.experienceYears,
            issuedAt: h.issuedAt,
            expiresAt: h.expiresAt,
            isCurrent: h.isCurrent,
          })),
        );
        setHabDirty(false);
      }

      // 4) Experiencia sin licencia (Fase 6 tanda B). INDEPENDIENTE del
      // bloque de arriba: esta tabla no tiene ninguna FK hacia licencias ni
      // hacia habilitaciones, asi que su orden no importa y quitar una
      // licencia NO arrastra la experiencia declarada en esa aeronave. Es
      // justo el punto de la tanda — saber hacer el trabajo no caduca con la
      // licencia.
      if (experienceDirty) {
        await technicianRepositoryV2.replaceAircraftExperience(
          techId,
          aircraftExperience.map((e) => ({
            aircraftTypeRatingId: e.aircraftTypeRatingId,
            years: e.years,
          })),
        );
        setExperienceDirty(false);
      }

      // 4b) Motores declarados (paso 5b). Tampoco tienen FK hacia licencias:
      // su orden no importa.
      if (enginesDirty) {
        await technicianRepositoryV2.replaceEngineExperience(
          techId,
          engines.map((e) => ({ engineId: e.engineId, years: e.years })),
        );
        setEnginesDirty(false);
      }

      // 5) Only now remove deselected licenses — AFTER habilitations are
      // saved, so the dependency check reflects the technician's actual
      // final state rather than a stale pre-save snapshot. Paso 5b: por
      // credencial, así que quitar la B1.1 EASA no se lleva la UK CAA.
      const { blocked } = await technicianRepositoryV2.removeUnreferencedLicenses(
        techId,
        heldLicenses.map((license) => ({ authority: license.authority, code: license.code })),
      );

      setForm((prev) => (prev ? {
        ...prev,
        aircraftTypes: derivedAircraftTypes,
      } : prev));
      setIsDirty(false);

      // Una licencia que no se pudo retirar sigue en la base, y con ella su
      // tipo implicado, que este guardado SI ha quitado de
      // technician_profile_types. La recarga de abajo devuelve la licencia a
      // la pantalla y vuelve a marcar el tipo (ver loadProfile), asi que el
      // proximo guardado lo repone: el desajuste dura lo que tarde el tecnico
      // en atender el aviso, y la direccion del error es la buena — sobra un
      // tipo en pantalla, nunca falta una licencia.
      if (blocked.length > 0) {
        setLicenseRemovalWarning(
          `Saved — but could not remove ${blocked.join(', ')}: the technician still has habilitations declared under ${
            blocked.length > 1 ? 'them' : 'it'
          }. Remove those habilitations first if the license should come off the profile.`,
        );
        await loadProfile();
      }
    } catch (err: any) {
      setProfileError(err?.message ?? 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Loading states ────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.technician} role="technician" />
      </>
    );
  }

  if (profileLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.technician} role="technician" />
      </>
    );
  }

  if (noTechProfile) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centeredState}>
          <Text style={styles.stateTitle}>Profile not set up</Text>
          <Text style={styles.stateBody}>
            Your technician profile hasn&apos;t been created yet. Complete your sign-up to
            configure your profile.
          </Text>
          <Button
            label="Go to dashboard"
            variant="primary"
            onPress={() => router.replace('/technician' as any)}
            style={styles.stateBtn}
          />
        </View>
      </TechnicianScreen>
    );
  }

  if (profileError && !form) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centeredState}>
          <Text style={styles.stateTitle}>Could not load profile</Text>
          <Text style={styles.stateBody}>{profileError}</Text>
          <Button
            label="Retry"
            variant="primary"
            onPress={loadProfile}
            style={styles.stateBtn}
          />
        </View>
      </TechnicianScreen>
    );
  }

  if (!form) {
    // Unexpected: loading done, no error, no noTechProfile, but form is still null
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.technician} role="technician" />
      </>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────

  const status = form.availability.status ?? 'open_to_offers';
  // Los tipos que las licencias declaradas IMPLICAN: van marcados y el
  // selector no deja desmarcarlos. Se derivan en cada render de
  // `form.licenseCategories` en vez de guardarse en su propio estado, para
  // que no exista ningun instante en el que el bloqueo y las licencias digan
  // cosas distintas.
  const impliedTypes = typesImpliedByLicenses(form.licenseCategories);

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[techStyles.content, isWide && techStyles.contentWide]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TechnicianPageHeader
            eyebrow="Technician profile"
            title="My Profile"
            subtitle="Manage the details companies use for matching and verification."
            onBack={() => router.back()}
          />

          <TechnicianCard style={styles.profileCard}>
            <View style={styles.profileTop}>
              <InitialAvatar label={form.fullName || form.anonymousCode} size={54} />
              <View style={styles.profileInfo}>
                <Text style={styles.profileName} numberOfLines={1}>{form.fullName}</Text>
                <Text style={styles.profileCode}>{form.anonymousCode}</Text>
              </View>
              <TechnicianBadge
                label={form.verificationStatus}
                tone={verificationTone(form.verificationStatus)}
                small
              />
            </View>

            <View style={styles.profileMetaRow}>
              <View style={styles.profileMetaItem}>
                <Text style={styles.profileMetaLabel}>Base</Text>
                <Text style={styles.profileMetaValue}>{form.baseAirport || 'N/A'}</Text>
              </View>
              <View style={styles.profileMetaItem}>
                <Text style={styles.profileMetaLabel}>Experience</Text>
                <Text style={styles.profileMetaValue}>{yearsInput.trim() === '' ? 'Not specified' : `${yearsInput.trim()} yr`}</Text>
              </View>
              <View style={styles.profileMetaItem}>
                <Text style={styles.profileMetaLabel}>Status</Text>
                <Text style={styles.profileMetaValue}>{availabilityLabel(status)}</Text>
              </View>
            </View>
          </TechnicianCard>

          {isDirty && (
            <View style={styles.dirtyBanner}>
              <Text style={styles.dirtyText}>Unsaved changes</Text>
            </View>
          )}

          {profileError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{profileError}</Text>
            </View>
          )}

          {licenseRemovalWarning && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>{licenseRemovalWarning}</Text>
            </View>
          )}

          <SectionTitle title="Identity" subtitle="Private details remain controlled by privacy rules." />
          <TechnicianCard style={styles.sectionCard}>
            <FieldLabel>Full name</FieldLabel>
            <TextInput
              style={styles.input}
              value={form.fullName}
              onChangeText={(v) => updateField('fullName', v)}
              placeholder="Full name"
              placeholderTextColor={techUi.textMuted}
              autoCapitalize="words"
            />
            <View style={styles.fieldGap} />
            <FieldLabel>Email</FieldLabel>
            <TextInput
              style={[styles.input, styles.readOnlyInput]}
              value={form.email}
              readOnly
              placeholder="email@example.com"
              placeholderTextColor={techUi.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.privacyNote}>
              This email cannot be changed from your profile.
            </Text>
            <View style={styles.fieldGap} />
            <FieldLabel>Phone</FieldLabel>
            <TextInput
              style={styles.input}
              value={form.phone}
              onChangeText={(v) => updateField('phone', v)}
              placeholder="+1 555 000 0000"
              placeholderTextColor={techUi.textMuted}
              keyboardType="phone-pad"
            />
            <View style={styles.fieldGap} />
            <FieldLabel>Total years of experience</FieldLabel>
            <TextInput
              style={styles.input}
              value={yearsInput}
              onChangeText={updateYearsInput}
              placeholder="e.g. 8 — enter 0 if you have none yet"
              placeholderTextColor={techUi.textMuted}
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={styles.privacyNote}>
              Required. Companies filter by minimum years of experience, so a profile with
              nothing here is hard to place. Entering 0 is a valid answer.
            </Text>
          </TechnicianCard>
          <Text style={styles.privacyNote}>
            Your identity is private by default and is only shared with accepted company contacts.
          </Text>

          <SectionTitle
            title="Professional links"
            subtitle="Optional. Private until a company accepts."
          />
          <TechnicianCard style={styles.sectionCard}>
            {/* El aviso va ARRIBA, antes del primer campo: el tecnico tiene que
                saber quien vera esto ANTES de escribirlo, no despues. */}
            <Text style={styles.privacyNote}>
              These links stay private. A company can only see them after it accepts your
              application, or after you accept a direct offer from it.
            </Text>
            {SOCIAL_FIELDS.map((field, index) => (
              <View key={field.key}>
                {index > 0 && <View style={styles.fieldGap} />}
                <FieldLabel>{field.label}</FieldLabel>
                <TextInput
                  style={styles.input}
                  value={socialInputs[field.key] ?? ''}
                  onChangeText={(v) => updateSocialLink(field.key, v)}
                  placeholder={field.placeholder}
                  placeholderTextColor={techUi.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
            ))}
          </TechnicianCard>

          <SectionTitle
            title="Profile types"
            subtitle="What you work on. Pick as many as apply — the ones your licences prove are ticked for you."
          />
          <TechnicianCard style={styles.sectionCard}>
            <TechnicianTypeSelector
              options={techTypeOptions}
              selected={technicianTypes}
              onChange={updateTechnicianTypes}
              loading={techTypesLoading}
              lockedCodes={impliedTypes}
              palette={{
                text: techUi.text,
                muted: techUi.textMuted,
                border: techUi.border,
                surface: techUi.surfaceSoft,
                accent: techUi.accent,
                accentText: techUi.accent,
                accentSurface: techUi.accent + '1A',
              }}
            />
          </TechnicianCard>

          <SectionTitle title="Location" />
          <TechnicianCard style={styles.sectionCard}>
            {/* Fase 7 F2c. Fuera el aeropuerto base: era un campo de texto
                libre de 4 letras que el técnico podía teclear a mano y que no
                se validaba contra nada. El país es lo que puntúa; la ciudad
                sitúa el pin y sólo trae coordenadas si sale del directorio. */}
            <CountryCityPicker
              value={location}
              onChange={(value) => {
                setLocation(value);
                markDirty();
              }}
            />
          </TechnicianCard>

          <SectionTitle title="Availability" subtitle="Controls how your profile appears in offer matching." />
          <TechnicianCard style={styles.sectionCard}>
            <FieldLabel>Status</FieldLabel>
            <View style={styles.chipRow}>
              {AVAILABILITY_OPTIONS.map((opt) => (
                <TechnicianChip
                  key={opt.value}
                  label={opt.label}
                  selected={status === opt.value}
                  onPress={() => updateAvailability({ status: opt.value })}
                />
              ))}
            </View>

            <View style={styles.fieldGap} />
            <FieldLabel>Contract types</FieldLabel>
            <View style={styles.chipRow}>
              {CONTRACT_TYPES.map((ct) => {
                const code = ct.code as AvailabilityContract;
                return (
                  <TechnicianChip
                    key={ct.code}
                    label={ct.label}
                    selected={form.availability.contractTypes.includes(code)}
                    onPress={() => toggleContractType(code)}
                  />
                );
              })}
            </View>

          </TechnicianCard>

          {/* Eje Part-66 completo (licencias + habilitaciones + peticion de
              catalogo). SIEMPRE visible desde la Fase 6 tanda A: tener
              licencia es propiedad de la persona, no de la etiqueta que
              eligio al registrarse, y esconder la seccion dejaba sin sitio a
              un pintor con una B1.1 real. */}
          <SectionTitle
            title="Licenses"
            subtitle="Pick the issuing authority, then every licence you hold from it. Leave empty if you hold none. Each one ticks the profile type it certifies — mechanical or avionics — and unticks it again if you remove it."
          />
          <TechnicianCard style={styles.sectionCard}>
            {/* Paso 5b: primero la autoridad. Con cinco autoridades "B1.1" no
                dice cuál es, y los códigos que existen dependen de quién los
                emite (CASA sin B2L/B3/L, GCAA sin B2L, FAA sólo A, P y A&P). */}
            <FieldLabel>Issuing authority</FieldLabel>
            <View style={styles.chipRow}>
              {AUTHORITIES.map((authority) => {
                const count = heldCountByAuthority(heldLicenses)[authority.code];
                return (
                  <TechnicianChip
                    key={authority.code}
                    label={count > 0 ? `${authority.label} (${count})` : authority.label}
                    selected={licenseAuthorityView === authority.code}
                    onPress={() => setLicenseAuthorityView(authority.code)}
                  />
                );
              })}
            </View>

            {licenseAuthorityView ? (
              <>
                <View style={styles.fieldGap} />
                <FieldLabel>{`${authorityLabel(licenseAuthorityView)} licences`}</FieldLabel>
                <View style={styles.chipRow}>
                  {AUTHORITY_LICENSES.filter((row) => row.authority === licenseAuthorityView).map((row) => (
                    <TechnicianChip
                      key={row.code}
                      label={row.code}
                      selected={holdsLicense(heldLicenses, row.authority, row.code)}
                      onPress={() => toggleLicense(row.authority, row.code)}
                    />
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.privacyNote}>Pick an authority to see the licences it issues.</Text>
            )}

            {heldLicenses.length > 0 ? (
              <>
                <View style={styles.fieldGap} />
                <Text style={styles.subSectionLabel}>Your licences — validity dates (optional)</Text>
                {heldLicenses.map((license) => (
                  <View key={`${license.authority}-${license.code}`} style={styles.licenseDetailRow}>
                    <Text style={styles.licenseDetailCode}>{credentialLabel(license.authority, license.code)}</Text>
                    <View style={styles.licenseDetailFields}>
                      <View style={styles.licenseDetailField}>
                        <Text style={styles.fieldLabelXs}>Issued</Text>
                        <DateField
                          value={license.issuedAt}
                          onChange={(v) => updateLicenseDetail(license.authority, license.code, { issuedAt: v })}
                          placeholder="Not set"
                          palette={DATE_FIELD_PALETTE}
                        />
                      </View>
                      {/* La FAA no caduca (14 CFR 65.19): no se pide fecha de
                          caducidad que nadie tiene. */}
                      {license.authority !== 'FAA' ? (
                        <View style={styles.licenseDetailField}>
                          <Text style={styles.fieldLabelXs}>Expires</Text>
                          <DateField
                            value={license.expiresAt}
                            onChange={(v) => updateLicenseDetail(license.authority, license.code, { expiresAt: v })}
                            placeholder="Not set"
                            palette={DATE_FIELD_PALETTE}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </>
            ) : null}
          </TechnicianCard>

          <HabilitationsEditor
            value={habilitations}
            onChange={onChangeHabilitations}
            heldLicenses={heldLicenses}
            ratingsById={ratingsById}
            onRatingResolved={(r) => setRatingsById((prev) => new Map(prev).set(r.id, r))}
            onRequestCatalog={() => setRequestPanelOpen((v) => !v)}
            dateFieldPalette={DATE_FIELD_PALETTE}
          />

          {/* Debajo de las habilitaciones y como seccion propia (Fase 6 tanda
              B): declarar una aeronave sin licencia es una lista SEPARADA, no
              una habilitacion a la que le falta un campo. */}
          <AircraftExperienceEditor
            value={aircraftExperience}
            onChange={onChangeAircraftExperience}
            habilitatedRatingIds={habilitations.map((h) => h.aircraftTypeRatingId)}
            ratingsById={ratingsById}
            onRatingResolved={(r) => setRatingsById((prev) => new Map(prev).set(r.id, r))}
            onRequestCatalog={() => setRequestPanelOpen((v) => !v)}
          />

          {/* Paso 5b: motores, como sección propia bajo la experiencia en
              aeronaves. Es lo que hace a un técnico elegible y bien
              puntuado en una oferta de motor. */}
          <EngineExperienceEditor value={engines} onChange={onChangeEngines} />

          {requestPanelOpen && (
            <TechnicianCard style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Request a catalog addition</Text>
              <Text style={styles.sectionSub}>
                Sent to the platform team for review — it will not be used for matching until added.
              </Text>
              <View style={styles.fieldGap} />
              <FieldLabel>Category</FieldLabel>
              <View style={styles.chipRow}>
                {LICENSE_CATEGORIES.map((lic) => (
                  <TechnicianChip
                    key={lic.code}
                    label={lic.code}
                    selected={requestLicense === lic.code}
                    onPress={() => setRequestLicense(lic.code)}
                  />
                ))}
              </View>
              <View style={styles.fieldGap} />
              <FieldLabel>Aircraft or family</FieldLabel>
              <TextInput
                style={styles.input}
                value={requestAircraft}
                onChangeText={setRequestAircraft}
                placeholder="e.g. AW169"
                placeholderTextColor={techUi.textMuted}
              />
              <View style={styles.fieldGap} />
              <FieldLabel>Name as it appears on your license</FieldLabel>
              <TextInput
                style={styles.input}
                value={requestLabel}
                onChangeText={setRequestLabel}
                placeholder="e.g. AW169 (PWC 210)"
                placeholderTextColor={techUi.textMuted}
              />
              <View style={styles.fieldGap} />
              <FieldLabel>Notes (optional)</FieldLabel>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={requestNotes}
                onChangeText={setRequestNotes}
                placeholder="Anything else that helps identify it"
                placeholderTextColor={techUi.textMuted}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
              <View style={styles.fieldGap} />
              {requestSubmitted ? (
                <Text style={styles.privacyNote}>Request pending catalog addition.</Text>
              ) : (
                <Button
                  label={requestSubmitting ? 'Sending...' : 'Send request'}
                  variant="secondary"
                  size="sm"
                  loading={requestSubmitting}
                  disabled={!requestLabel.trim() || requestSubmitting}
                  onPress={submitCatalogRequest}
                />
              )}
            </TechnicianCard>
          )}

          {/* La seccion "Specialties" se retiro el 2026-07-29: no existe ni
              columna ni tabla de specialties en el esquema public, ni ningun
              camino de escritura (admin incluido). El array salia hardcodeado
              como [] en supaRowToForm y en v2CompatAdapters, asi que la
              seccion solo podia renderizar "Not specified" para siempre, bajo
              un texto que prometia que la verificacion lo rellenaba. El campo
              Technician.specialties sigue en el bloque V1-compat de
              types/technician.ts (lo exige el tipo, no la UI). */}

          <Button
            label={saving ? 'Saving...' : 'Save Changes'}
            variant="primary"
            onPress={handleSave}
            loading={saving}
            disabled={!isDirty}
            fullWidth
            style={styles.saveBtn}
          />

        </ScrollView>
      </KeyboardAvoidingView>
    </TechnicianScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1 },
  profileCard: {
    gap: spacing.md,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: techUi.text,
  },
  profileCode: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: techUi.textMuted,
  },
  profileMetaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  profileMetaItem: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: techUi.borderSoft,
    backgroundColor: techUi.surfaceSoft,
    borderRadius: 16,
    padding: spacing.sm,
  },
  profileMetaLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: techUi.textMuted,
    marginBottom: 4,
  },
  profileMetaValue: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: techUi.text,
  },
  dirtyBanner: {
    marginTop: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: techUi.amberSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dirtyText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: techUi.amber,
  },
  errorBanner: {
    marginTop: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#DC2626',
  },
  warningBanner: {
    marginTop: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: techUi.amberSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  warningText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: techUi.amber,
  },
  sectionTitleBlock: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: techUi.text,
  },
  sectionSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: techUi.textSoft,
  },
  sectionCard: {
    gap: spacing.sm,
  },
  privacyNote: {
    marginTop: spacing.xs,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: techUi.textMuted,
  },
  fieldLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: techUi.textSoft,
    marginBottom: 6,
  },
  fieldGap: { height: spacing.sm },
  subSectionLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: techUi.textSoft,
    marginBottom: 4,
  },
  licenseDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: techUi.borderSoft,
  },
  licenseDetailCode: {
    width: 44,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: techUi.text,
  },
  licenseDetailFields: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  licenseDetailField: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabelXs: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: techUi.textMuted,
    marginBottom: 3,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: techUi.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: techUi.text,
    backgroundColor: techUi.surfaceSoft,
  },
  readOnlyInput: {
    borderColor: techUi.borderSoft,
    backgroundColor: techUi.page,
    color: techUi.textSoft,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  textarea: {
    minHeight: 88,
    paddingTop: spacing.sm,
  },
  saveBtn: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: techUi.accent,
    borderRadius: 16,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  stateTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: techUi.text,
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: techUi.textSoft,
    textAlign: 'center',
  },
  stateBtn: {
    marginTop: spacing.sm,
    minWidth: 160,
  },
});
