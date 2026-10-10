// Piezas de las pantallas que cuelgan de You (rediseño, fase 6A): My work y las
// pantallas pequeñas (Personal details, Location, Contract types, Professional
// links). No tienen maqueta: siguen el patrón de las que ya existen
// (C-EditCompany, /company/profile/edit): flecha y título arriba, el formulario
// y "Save" fijo abajo en móvil; en escritorio, el layout de You
// (YouDesktopShell, en app/technician/(you)/_layout.tsx): el menú lateral a la
// izquierda (fase 8, decisión C; como la cuenta de empresa) y, a la derecha,
// la tarjeta del técnico y la disponibilidad (YouDesktopHeader), que se quedan
// montados, y debajo el apartado: su título, el contenido y el botón al
// final. Cambiar de apartado con cambios sin guardar pide descartarlos, como
// My work antes de abrir un asistente.
//
// Sólo presentación. Lo que se guarda y cómo lo decide el caso de uso
// (src/usecases/technicianProfile.ts).
import React from 'react';
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { Text, useConfirmDialog } from '../ui';
import { ProfileImageEditor } from '../ui/ProfileImageEditor';
import { LoadingScreen } from '../LoadingScreen';
import { TechnicianScreen } from './TechnicianUI';
import { TechnicianAccountNav } from './TechnicianAccount';
import { AccountLayout } from '../company/CompanyAccount';
import {
  ButtonRow,
  CARD_BORDER,
  ErrorBlock,
  PageBar,
  PageBody,
  PageSubtitle,
  PillButton,
  StickyBar,
  VerificationPill,
  useIsWide,
} from '../company/CompanyPage';
import { useOwnTechnicianProfile } from '../../state/useOwnTechnicianProfile';
import { useTechnicianNav } from '../../state/TechnicianNavContext';
import { useAvailabilityToggle } from '../../state/useAvailabilityToggle';
import { youHeaderLine } from '../../utils/technicianWork';
import { colors } from '../../theme';
import { radius, TOUCH_TARGET } from '../../theme/ui';
import type { OwnTechnicianProfileState } from '../../state/useOwnTechnicianProfile';
import type { EditableTechnicianProfile } from '../../types/technicianProfileEdit';
import type { AvailabilityStatus } from '../../types/technician';

// ── Marco ───────────────────────────────────────────────────────────────────

/**
 * El layout de You en escritorio (app/technician/(you)/_layout.tsx, fase 8).
 * Los apartados (My work, Documents, Location…) son sus rutas hijas: el menú
 * lateral, la tarjeta del técnico y la disponibilidad se quedan montados y
 * sólo cambia el apartado de debajo. Los apartados saben por este contexto que
 * están dentro y le dicen cómo preguntar antes de salir si tienen cambios sin
 * guardar.
 */
interface YouShellValue {
  setBeforeLeave: (ask: (() => Promise<boolean>) | null) => void;
}

const YouShellContext = React.createContext<YouShellValue | null>(null);

function useYouShell(): YouShellValue | null {
  return React.useContext(YouShellContext);
}

export function YouDesktopShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const scrollRef = React.useRef<ScrollView>(null);
  const askRef = React.useRef<(() => Promise<boolean>) | null>(null);
  const value = React.useMemo<YouShellValue>(() => ({
    setBeforeLeave: (ask) => { askRef.current = ask; },
  }), []);
  const beforeLeave = React.useCallback(async () => (askRef.current ? askRef.current() : true), []);

  // Al cambiar de apartado, arriba: la tarjeta y el principio del apartado a la vista.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [pathname]);

  return (
    <YouShellContext.Provider value={value}>
      <TechnicianScreen>
        <PageBody wide scrollRef={scrollRef}>
          <AccountLayout nav={<TechnicianAccountNav beforeLeave={beforeLeave} />}>
            <YouDesktopHeader />
            {children}
          </AccountLayout>
        </PageBody>
      </TechnicianScreen>
    </YouShellContext.Provider>
  );
}

/** Entrada corta del apartado nuevo: aparece y sube unos píxeles. */
function SectionFade({ children }: { children: React.ReactNode }) {
  const progress = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });
  return <Animated.View style={[styles.section, { opacity: progress, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/**
 * Una pantalla que cuelga de You. `footer` es la barra de guardar: fija abajo
 * en móvil, al final del contenido en escritorio. Sin `footer`, no hay barra.
 *
 * Escritorio: dentro del layout de You pinta sólo el apartado (título,
 * contenido y botón); el menú, la tarjeta y la disponibilidad son del layout.
 *
 * `unsaved`: hay cambios sin guardar. En escritorio, elegir otro apartado en
 * el menú lateral pregunta antes; si se descartan, `onDiscard` los quita.
 */
export function ProfileScreenFrame({
  title,
  subtitle,
  onBack,
  backLabel = 'You',
  right,
  footer,
  unsaved = false,
  onDiscard,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  /** Ya no se usa: en escritorio el menú lateral sustituye al "‹ You" (fase 8). */
  backLabel?: string;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  unsaved?: boolean;
  onDiscard?: () => void;
  children: React.ReactNode;
}) {
  const wide = useIsWide();
  const shell = useYouShell();
  const { confirm, dialog } = useConfirmDialog();

  // Lo último que sabe el apartado, para cuando el menú pregunte.
  const latest = React.useRef({ unsaved, onDiscard, title });
  latest.current = { unsaved, onDiscard, title };
  React.useEffect(() => {
    if (!shell) return undefined;
    shell.setBeforeLeave(async () => {
      const current = latest.current;
      if (!current.unsaved) return true;
      const discard = await confirm({
        title: 'Unsaved changes',
        message: `Save or discard your changes in ${current.title} before opening another section.`,
        confirmLabel: 'Discard changes',
        destructive: true,
      });
      if (discard) current.onDiscard?.();
      return discard;
    });
    return () => shell.setBeforeLeave(null);
  }, [shell, confirm]);

  const head = (
    <View style={styles.sectionHead}>
      <View style={styles.sectionHeadCopy}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.sectionHeadRight}>{right}</View> : null}
    </View>
  );
  const footerWide = footer ? <View style={styles.footerWide}>{footer}</View> : null;

  if (wide && shell) {
    return (
      <SectionFade>
        {head}
        {children}
        {footerWide}
        {dialog}
      </SectionFade>
    );
  }

  if (wide) {
    // Fuera del layout de You (no debería pasar): el apartado solo.
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <PageBody wide maxWidth={760} gap={20}>
          {head}
          {children}
          {footerWide}
        </PageBody>
        {dialog}
      </TechnicianScreen>
    );
  }

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <PageBar title={title} large onBack={onBack} right={right} />
        {subtitle ? <PageSubtitle>{subtitle}</PageSubtitle> : null}
        <PageBody wide={false} gap={20}>{children}</PageBody>
        {footer ? <StickyBar>{footer}</StickyBar> : null}
      </KeyboardAvoidingView>
    </TechnicianScreen>
  );
}

/**
 * Lo que pinta un apartado mientras carga: en móvil, la pantalla de carga de
 * siempre; dentro del layout de You de escritorio, un hueco con el indicador
 * (la tarjeta y el menú siguen ahí).
 */
export function ProfileSectionLoading() {
  const shell = useYouShell();
  if (shell) {
    return (
      <View style={styles.sectionLoading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LoadingScreen color={colors.primary} role="technician" />
    </>
  );
}

/**
 * Lo fijo de You en escritorio (fase 8): la tarjeta del técnico (foto, nombre,
 * ID y verificado) y la disponibilidad, encima de cada apartado. La foto se
 * cambia tocando el avatar, como en You en móvil; la disponibilidad se guarda
 * al tocarla, con la misma lógica (useAvailabilityToggle). Carga su propia
 * copia del perfil y la refresca al volver el foco y al cambiar de apartado,
 * para enseñar lo que un apartado acaba de guardar (el nombre, por ejemplo).
 */
export function YouDesktopHeader() {
  const state = useOwnTechnicianProfile({ refreshOnFocus: true });
  // Se queda montada al cambiar de apartado: entonces se refresca, por si el
  // anterior guardó algo que enseña (el nombre, los años).
  const pathname = usePathname();
  const firstPath = React.useRef(true);
  const { reload } = state;
  React.useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    void reload();
  }, [pathname, reload]);
  if (!state.profile) {
    // Cargando: el sitio reservado, para que el apartado no salte. Si falla, el
    // apartado ya enseña su propio error.
    return state.loading ? (
      <View style={[styles.youCard, styles.youCardLoading]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    ) : null;
  }
  return <YouDesktopHeaderBody profile={state.profile} reload={state.reload} />;
}

function YouDesktopHeaderBody({ profile, reload }: { profile: EditableTechnicianProfile; reload: () => Promise<unknown> }) {
  const { reloadTechnician } = useTechnicianNav();
  const availability = useAvailabilityToggle(profile, reload);
  const name = profile.fullName || profile.anonymousCode;
  return (
    <View style={styles.youHeader}>
      <View style={styles.youCard}>
        <ProfileImageEditor kind="technician" id={profile.id} name={name} path={profile.photoPath} size={80} compact
          onChanged={() => { reloadTechnician(); void reload(); }} />
        <View style={styles.youCopy}>
          <Text style={styles.youName} numberOfLines={2}>{name}</Text>
          <Text style={styles.youLine}>{youHeaderLine(profile.anonymousCode, profile.yearsInput)}</Text>
          <View style={styles.youPill}>
            <VerificationPill status={profile.verificationStatus} large />
          </View>
        </View>
      </View>
      <AvailabilitySwitch
        value={availability.availability}
        onChange={(next) => void availability.change(next)}
        disabled={availability.saving}
        error={availability.error}
      />
    </View>
  );
}

/**
 * La barra de guardar: el error (o el aviso) justo encima del botón, para que
 * se vea donde se pulsó, y "Save".
 */
export function SaveFooter({
  label = 'Save',
  onSave,
  saving,
  disabled,
  error,
  notice,
  status,
}: {
  label?: string;
  onSave: () => void;
  saving: boolean;
  disabled?: boolean;
  error?: string | null;
  /** Un aviso que no es un error ("Saved — but could not remove…"). */
  notice?: string | null;
  /** Una línea tenue a la izquierda del botón en escritorio ("Unsaved changes"). */
  status?: string | null;
}) {
  const wide = useIsWide();
  return (
    <View style={styles.saveFooter}>
      {error ? <Text accessibilityRole="alert" style={styles.footerError}>{error}</Text> : null}
      {notice ? <Text style={styles.footerNotice}>{notice}</Text> : null}
      <View style={[styles.saveRow, wide && styles.saveRowWide]}>
        {status ? <Text style={styles.footerStatus}>{status}</Text> : null}
        <ButtonRow>
          <PillButton label={label} onPress={onSave} loading={saving} disabled={disabled} size={wide ? 'md' : 'lg'} grow={wide ? undefined : 1} />
        </ButtonRow>
      </View>
    </View>
  );
}

// ── Carga ───────────────────────────────────────────────────────────────────

/**
 * Lo que pintan todas estas pantallas mientras el perfil no está: el spinner,
 * "Profile not set up" o el error con "Try again". Con el perfil, `children`.
 */
export function ProfileLoadGate({
  state,
  title,
  onBack,
  children,
}: {
  state: OwnTechnicianProfileState;
  title: string;
  /** Sin flecha en You (raíz de pestaña). */
  onBack?: () => void;
  children: (profile: EditableTechnicianProfile) => React.ReactNode;
}) {
  if (state.loading && !state.profile) return <ProfileSectionLoading />;
  if (state.profile) return <>{children(state.profile)}</>;

  const body = state.notSetUp ? (
    <View style={styles.stateBox}>
      <Text style={styles.stateTitle}>Profile not set up</Text>
      <Text style={styles.stateText}>
        Your technician profile hasn&apos;t been created yet. Complete your sign-up to configure your profile.
      </Text>
    </View>
  ) : (
    <ErrorBlock text={state.error ?? 'Could not load your profile.'} onRetry={() => void state.reload()} />
  );

  if (!onBack) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.rootState}>
          <Text style={styles.rootTitle} accessibilityRole="header">{title}</Text>
          {body}
        </View>
      </TechnicianScreen>
    );
  }
  return <ProfileScreenFrame title={title} onBack={onBack}>{body}</ProfileScreenFrame>;
}

// ── Campos ──────────────────────────────────────────────────────────────────

export function FormField({
  label,
  optional = false,
  hint,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {optional ? <Text style={styles.optional}>  Optional</Text> : null}
      </Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Un valor que no se edita aquí (el email). */
export function ReadOnlyValue({ value }: { value: string }) {
  return (
    <View style={styles.readOnly}>
      <Text style={styles.readOnlyText} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Una nota gris de privacidad o de contexto, a ancho completo. */
export function FormNote({ children }: { children: string }) {
  return <Text style={styles.note}>{children}</Text>;
}

// ── Disponibilidad (T-You) ──────────────────────────────────────────────────

const AVAILABILITY_OPTIONS: { value: AvailabilityStatus; label: string }[] = [
  { value: 'open_to_offers', label: 'Open to offers' },
  { value: 'unavailable', label: 'Unavailable' },
];

/**
 * La caja de disponibilidad de You: verde con "Open to offers", gris con
 * "Unavailable". Se guarda al tocar (respuesta 25): quien llama escribe.
 */
export function AvailabilitySwitch({
  value,
  onChange,
  disabled = false,
  error,
}: {
  value: AvailabilityStatus;
  onChange: (next: AvailabilityStatus) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const open = value === 'open_to_offers';
  return (
    <View style={[styles.availability, { backgroundColor: open ? colors.successSoft : colors.surfaceSoft }]}>
      <View style={styles.availabilityCopy}>
        <Text style={styles.availabilityTitle} accessibilityRole="header">Availability</Text>
        <Text style={styles.availabilityText}>Controls how you appear in offer matching.</Text>
      </View>
      <View style={styles.availabilityTrack} accessibilityRole="radiogroup" accessibilityLabel="Availability">
        {AVAILABILITY_OPTIONS.map((option) => {
          const on = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => { if (!on) onChange(option.value); }}
              disabled={disabled}
              style={[styles.availabilityOption, on && styles.availabilityOptionOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled }}
              accessibilityLabel={option.label}
            >
              <Text style={[styles.availabilityOptionText, on && styles.availabilityOptionTextOn]} numberOfLines={1}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.availabilityError}>{error}</Text> : null}
    </View>
  );
}

export const profileFormStyles = StyleSheet.create({
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 15,
    color: colors.text,
  },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: {
    gap: 20,
  },
  sectionLoading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  youHeader: {
    gap: 16,
  },
  youCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    padding: 24,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  youCardLoading: {
    minHeight: 130,
    justifyContent: 'center',
  },
  youCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  youName: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
  },
  youLine: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  youPill: {
    flexDirection: 'row',
    marginTop: 2,
  },
  sectionHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 8,
  },
  sectionHeadCopy: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  sectionTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 14.5,
    color: colors.textSecondary,
  },
  sectionHeadRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerWide: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  saveFooter: {
    gap: 8,
  },
  saveRow: {
    gap: 10,
  },
  saveRowWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  footerError: {
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '700',
    color: colors.error,
  },
  footerNotice: {
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '700',
    color: colors.warning,
  },
  footerStatus: {
    flexShrink: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  rootState: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 20,
  },
  rootTitle: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: colors.text,
  },
  stateBox: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  stateText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  optional: {
    fontWeight: '600',
    color: colors.textMuted,
  },
  hint: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.textMuted,
  },
  readOnly: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    backgroundColor: colors.surfaceSoft,
    justifyContent: 'center',
  },
  readOnlyText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  availability: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
  },
  availabilityCopy: {
    gap: 2,
  },
  availabilityTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  availabilityText: {
    fontSize: 13.5,
    color: '#33465A',
  },
  availabilityTrack: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  availabilityOption: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  availabilityOptionOn: {
    backgroundColor: colors.navy,
  },
  availabilityOptionText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  availabilityOptionTextOn: {
    color: colors.white,
  },
  availabilityError: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.error,
  },
});
