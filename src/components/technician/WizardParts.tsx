// Piezas de los asistentes del técnico (rediseño, fase 6B; maquetas T-Add,
// T-Lic, T-LicDates, T-LicDone, T-Rat, T-RatDetails, T-Done, T-Eng y la
// cabecera TStepHeader).
//
//   - Móvil: cabecera con "Step N of M" (o cerrar y título), el paso
//     desplazable y el botón fijo abajo.
//   - Escritorio (≥ WIDE_BREAKPOINT): el mismo asistente dentro de una tarjeta
//     centrada sobre fondo gris; la barra superior la pone el layout. Abajo,
//     "Back" (o "Cancel" en el primer paso) a la izquierda y el botón
//     principal a la derecha, como el asistente de oferta (fase 8).
//   - Tablet: cabecera, paso y botón en la columna de móvil.
//
// Sólo presentación: qué se ofrece, qué está "✓ Added" y qué se guarda lo
// deciden src/utils/technicianAdd.ts y el caso de uso.
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { Check, ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react-native';
import { focusRingWithin, StepHeader, Text, TextInput } from '../ui';
import { TechnicianScreen } from './TechnicianUI';
import { ButtonRow, CARD_BORDER, PillButton, StickyBar, useIsWide } from '../company/CompanyPage';
import { colors } from '../../theme';
import { fonts } from '../../theme/fonts';
import { HOVER_BG, MOBILE_COLUMN, radius, TOUCH_TARGET } from '../../theme/ui';

// ── Marco ───────────────────────────────────────────────────────────────────

export interface WizardAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/**
 * Un paso de asistente. Con `step` y `total`, la cabecera de pasos (T-Lic); sin
 * ellos, flecha (o cerrar) y el título (T-Add, T-Eng). `primary` es el botón
 * de abajo; `error`, lo que impidió guardar, justo encima de él.
 */
export function WizardFrame({
  title,
  step,
  total,
  onBack,
  backIcon = 'back',
  largeTitle = false,
  primary,
  secondary,
  error,
  children,
}: {
  title: string;
  step?: number;
  total?: number;
  onBack: () => void;
  backIcon?: 'back' | 'close';
  /** El título grande de T-Add ("Add to your profile"), sin pasos. */
  largeTitle?: boolean;
  primary?: WizardAction;
  secondary?: WizardAction;
  error?: string | null;
  children: React.ReactNode;
}) {
  const wide = useIsWide();
  const header = step != null && total != null ? (
    <StepHeader step={step} total={total} title={title} onBack={onBack} backIcon={backIcon} />
  ) : (
    <View style={styles.plainHeader}>
      <Pressable
        onPress={onBack}
        style={({ hovered }: any) => [styles.back, hovered && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={backIcon === 'close' ? 'Close' : 'Back'}
        hitSlop={4}
      >
        {backIcon === 'close'
          ? <X color={colors.text} size={24} strokeWidth={2.2} />
          : <ChevronLeft color={colors.text} size={26} strokeWidth={2.2} />}
      </Pressable>
      <Text style={largeTitle ? styles.plainTitleLarge : styles.plainTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
    </View>
  );

  const errorText = error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null;

  if (wide) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView style={styles.widePage} contentContainerStyle={styles.widePageContent} keyboardShouldPersistTaps="handled">
          <View style={styles.wideCard}>
            {header}
            <View style={styles.wideBody}>{children}</View>
            {primary || errorText ? (
              <View style={styles.wideFooter}>
                {errorText}
                <View style={styles.wideFooterRow}>
                  {/* Lo mismo que la flecha (o la ✕) de la cabecera. */}
                  <PillButton
                    label={backIcon === 'close' ? 'Cancel' : 'Back'}
                    variant="outline"
                    size="md"
                    onPress={onBack}
                    disabled={primary?.loading}
                  />
                  <View style={styles.wideButtons}>
                    {secondary ? <PillButton label={secondary.label} variant="outline" size="md" onPress={secondary.onPress} disabled={secondary.disabled} /> : null}
                    {primary ? <PillButton label={primary.label} size="md" onPress={primary.onPress} disabled={primary.disabled} loading={primary.loading} /> : null}
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </TechnicianScreen>
    );
  }

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
        {primary || errorText ? (
          <StickyBar>
            {errorText}
            {primary ? (
              <ButtonRow>
                {secondary ? <PillButton label={secondary.label} variant="outline" onPress={secondary.onPress} disabled={secondary.disabled} grow={1} /> : null}
                <PillButton label={primary.label} onPress={primary.onPress} disabled={primary.disabled} loading={primary.loading} grow={1.4} />
              </ButtonRow>
            ) : null}
          </StickyBar>
        ) : null}
      </KeyboardAvoidingView>
    </TechnicianScreen>
  );
}

/** El título del paso ("Which licence do you hold?") y su línea gris. */
export function WizardHeading({ title, text }: { title: string; text?: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.headingTitle} accessibilityRole="header">{title}</Text>
      {text ? <Text style={styles.headingText}>{text}</Text> : null}
    </View>
  );
}

/** La etiqueta de un grupo en mayúsculas ("AUTHORITY"). */
export function WizardLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children.toUpperCase()}</Text>;
}

/** Una nota azul con "+" ("Adds Avionics Technician to what you do"). */
export function AddsNote({ children }: { children: string }) {
  return (
    <View style={styles.addsNote} accessibilityRole="text" accessibilityLiveRegion="polite">
      <View style={styles.addsIcon}>
        <Plus color="#0B5E8C" size={15} strokeWidth={2.8} />
      </View>
      <Text style={styles.addsText}>{children}</Text>
    </View>
  );
}

// ── Búsqueda y filas ────────────────────────────────────────────────────────

/** El buscador en píldora gris de T-Rat y T-Eng. */
export function SearchPill({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  editable = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  editable?: boolean;
}) {
  return (
    <View style={styles.search} {...focusRingWithin}>
      <Search color={colors.textSecondary} size={18} strokeWidth={2.4} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        editable={editable}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

/**
 * El catálogo de una lista mientras no está: cargando, o el fallo con
 * "Retry" (nunca una lista vacía que parezca "no hay nada").
 */
export function CatalogState({
  state,
  what,
  onRetry,
}: {
  state: 'loading' | 'success' | 'empty' | 'error';
  what: string;
  onRetry: () => void;
}) {
  if (state === 'success') return null;
  if (state === 'loading') return <Text style={styles.rowSub}>{`Loading ${what}…`}</Text>;
  return (
    <View style={styles.catalogError}>
      <Text accessibilityRole="alert" style={styles.error}>
        {state === 'empty' ? `No ${what} are available right now.` : `We couldn't load the ${what}.`}
      </Text>
      <PillButton label="Retry" variant="outline" size="sm" onPress={onRetry} />
    </View>
  );
}

/** "✓ Added" en verde: ya está en el perfil (T6). */
export function AddedBadge() {
  return (
    <View style={styles.addedBadge}>
      <Check color="#0B5B3A" size={12} strokeWidth={3.4} />
      <Text style={styles.addedText}>Added</Text>
    </View>
  );
}

/**
 * Una fila de una lista de los asistentes. Elegible: radio, con ✓ azul si es
 * la elegida. Ya en el perfil: "✓ Added", y tocarla lleva a My work (nunca la
 * vuelve a añadir).
 */
export function CatalogRowItem({
  title,
  subtitle,
  selected,
  added,
  addedNote,
  onSelect,
  onOpenAdded,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  added: boolean;
  addedNote?: string;
  onSelect: () => void;
  onOpenAdded: () => void;
}) {
  if (added) {
    return (
      <Pressable
        onPress={onOpenAdded}
        style={({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && styles.rowPressed]}
        accessibilityRole="link"
        accessibilityLabel={`${title} is already on your profile. Open My work`}
      >
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{title}</Text>
          {addedNote || subtitle ? <Text style={styles.rowSub} numberOfLines={2}>{addedNote ?? subtitle}</Text> : null}
        </View>
        <AddedBadge />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && styles.rowPressed]}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {selected ? (
        <View style={styles.rowCheck}>
          <Check color={colors.white} size={15} strokeWidth={3.2} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Una categoría de licencia en la rejilla de T-Lic. Ya en el perfil: verde con
 * "✓ B1.1 · Added", lleva a My work. Si no, se marca (fondo azul suave y borde
 * de 2 px) y se desmarca.
 */
export function CategoryTile({
  code,
  picked,
  added,
  onToggle,
  onOpenAdded,
}: {
  code: string;
  picked: boolean;
  added: boolean;
  onToggle: () => void;
  onOpenAdded: () => void;
}) {
  if (added) {
    return (
      <Pressable
        onPress={onOpenAdded}
        style={({ hovered }: any) => [styles.category, styles.categoryAdded, hovered && styles.categoryAddedHover]}
        accessibilityRole="link"
        accessibilityLabel={`${code} is already on your profile. Open My work`}
      >
        <View style={styles.categoryAddedTop}>
          <Check color="#0B5B3A" size={12} strokeWidth={3.4} />
          <Text style={styles.categoryAddedCode}>{code}</Text>
        </View>
        <Text style={styles.categoryAddedLabel}>Added</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onToggle}
      style={({ hovered }: any) => [styles.category, picked ? styles.categoryPicked : hovered && styles.categoryHover]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: picked }}
      accessibilityLabel={code}
    >
      <Text style={[styles.categoryCode, picked && styles.categoryCodePicked]}>{code}</Text>
    </Pressable>
  );
}

export function CategoryGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.categoryGrid}>
      {items.map((child, i) => <View key={i} style={styles.categoryCell}>{child}</View>)}
    </View>
  );
}

/** La tarjeta de lo elegido, arriba del paso de detalles (T-RatDetails). */
export function ChosenCard({ tile, title, subtitle }: { tile: React.ReactNode; title: string; subtitle: string }) {
  return (
    <View style={styles.chosen}>
      {tile}
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.chosenSub}>{subtitle}</Text>
      </View>
    </View>
  );
}

/** El cuadrado blanco de un icono (aeronave, motor) en las tarjetas de los asistentes. */
export function IconTile({ children, size = 44 }: { children: React.ReactNode; size?: number }) {
  return <View style={[styles.iconTile, { width: size, height: size, borderRadius: Math.round(size * 0.3) }]}>{children}</View>;
}

/** El cuadrado con texto de un elemento (motores: "ENG"). */
export function TextTile({ text, size = 44 }: { text: string; size?: number }) {
  return (
    <IconTile size={size}>
      <Text style={styles.textTile}>{text}</Text>
    </IconTile>
  );
}

// ── El "+" ──────────────────────────────────────────────────────────────────

const ADD_TILE_COLORS: Record<string, { bg: string; fg: string }> = {
  licence: { bg: '#D6ECF8', fg: '#0B5E8C' },
  typeRating: { bg: '#D5F2E4', fg: '#0B6B45' },
  aircraft: { bg: '#F1E9DC', fg: '#5B4528' },
  engine: { bg: '#E3E8EE', fg: '#33465A' },
  document: { bg: colors.errorSoft, fg: colors.error },
};

/**
 * Una opción del "+" (T-Add). Con `disabledReason`, en gris y con línea
 * discontinua, diciendo lo que falta; no se oculta y no responde.
 */
export function AddMenuRow({
  optionKey,
  tile,
  title,
  hint,
  disabledReason,
  onPress,
}: {
  optionKey: string;
  tile: string;
  title: string;
  hint: string;
  disabledReason: string | null;
  onPress: () => void;
}) {
  const look = ADD_TILE_COLORS[optionKey] ?? ADD_TILE_COLORS.engine;
  if (disabledReason) {
    return (
      <View style={[styles.menuRow, styles.menuRowDisabled]} accessibilityRole="text" accessibilityLabel={`${title}. ${disabledReason}`} accessibilityState={{ disabled: true }}>
        <View style={[styles.menuTile, { backgroundColor: '#EEF1F4' }]}>
          <Text style={[styles.menuTileText, { color: '#A9B6C3' }]}>{tile}</Text>
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.menuTitle, styles.menuTitleDisabled]}>{title}</Text>
          <Text style={styles.menuBlocked}>{disabledReason}</Text>
        </View>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [styles.menuRow, (pressed || hovered) && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${hint}`}
    >
      <View style={[styles.menuTile, { backgroundColor: look.bg }]}>
        <Text style={[styles.menuTileText, { color: look.fg }]}>{tile}</Text>
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.rowSub}>{hint}</Text>
      </View>
      <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
    </Pressable>
  );
}

// ── Pantalla final (T-LicDone, T-Done) ──────────────────────────────────────

export function WizardDone({
  title,
  text,
  children,
  primary,
  secondary,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
  primary: WizardAction;
  secondary: WizardAction;
}) {
  const wide = useIsWide();
  const intro = (
    <View style={styles.doneIntro}>
      <View style={styles.doneCircle}>
        <Check color={colors.success} size={44} strokeWidth={2.6} />
      </View>
      <Text style={styles.doneTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.doneText}>{text}</Text>
    </View>
  );

  if (wide) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView style={styles.widePage} contentContainerStyle={styles.widePageContent}>
          <View style={[styles.wideCard, styles.doneCard]}>
            {intro}
            <View style={styles.doneItems}>{children}</View>
            <View style={styles.wideButtons}>
              <PillButton label={secondary.label} variant="outline" size="md" onPress={secondary.onPress} />
              <PillButton label={primary.label} size="md" onPress={primary.onPress} />
            </View>
          </View>
        </ScrollView>
      </TechnicianScreen>
    );
  }

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.doneBody}>
        {intro}
        <View style={styles.doneItems}>{children}</View>
      </ScrollView>
      <View style={styles.doneActions}>
        <PillButton label={primary.label} onPress={primary.onPress} />
        <PillButton label={secondary.label} variant="outline" onPress={secondary.onPress} />
      </View>
    </TechnicianScreen>
  );
}

/** Lo añadido, en la pantalla final: lleva a My work. */
export function DoneItem({ tile, title, subtitle, onPress }: { tile: React.ReactNode; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [styles.doneItem, (pressed || hovered) && styles.rowPressed]}
      accessibilityRole="link"
      accessibilityLabel={`${title}. ${subtitle}. Open My work`}
    >
      {tile}
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <ChevronRight color={colors.textMuted} size={18} strokeWidth={2} />
    </Pressable>
  );
}

/** "Avionics Technician added to what you do" / "It stays while you hold the B2." */
export function DoneNotice({ title, text }: { title: string; text: string | null }) {
  return (
    <View style={styles.doneNotice} accessibilityRole="text">
      <View style={styles.addsIcon}>
        <Plus color="#0B5E8C" size={17} strokeWidth={2.8} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.doneNoticeTitle}>{title}</Text>
        {text ? <Text style={styles.doneNoticeText}>{text}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
    gap: 20,
  },
  plainHeader: {
    width: '100%',
    maxWidth: MOBILE_COLUMN,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 8,
    paddingRight: 20,
    paddingLeft: 4,
    backgroundColor: colors.surface,
  },
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plainTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  plainTitleLarge: {
    flex: 1,
    minWidth: 0,
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  error: {
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '700',
    color: colors.error,
  },
  widePage: {
    flex: 1,
    backgroundColor: colors.surfaceSoft,
  },
  widePageContent: {
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  wideCard: {
    width: '100%',
    maxWidth: 640,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    paddingTop: 8,
  },
  wideBody: {
    paddingHorizontal: 28,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 20,
  },
  wideFooter: {
    gap: 10,
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  wideButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  wideFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  heading: {
    gap: 6,
  },
  headingTitle: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
  },
  headingText: {
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: colors.textMuted,
  },
  addsNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  addsIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  addsText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#0B5E8C',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 18,
    borderRadius: 25,
    backgroundColor: colors.surfaceMuted,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    fontSize: 15.5,
    fontWeight: '700',
    color: colors.text,
  },
  catalogError: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  addedBadge: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#A7DCC3',
    backgroundColor: '#E5F4EC',
  },
  addedText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0B5B3A',
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  rowSub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  rowCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
    rowGap: 8,
  },
  categoryCell: {
    width: '25%',
    paddingHorizontal: 4,
  },
  category: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryHover: {
    backgroundColor: HOVER_BG,
    borderColor: colors.textMuted,
  },
  categoryPicked: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  categoryCode: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  categoryCodePicked: {
    color: '#0B5E8C',
  },
  categoryAddedHover: {
    opacity: 0.85,
  },
  categoryAdded: {
    borderColor: '#A7DCC3',
    backgroundColor: '#E5F4EC',
  },
  categoryAddedTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  categoryAddedCode: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0B5B3A',
  },
  categoryAddedLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0B5B3A',
  },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
  },
  chosenSub: {
    fontSize: 13,
    color: '#2E4C66',
  },
  iconTile: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textTile: {
    fontFamily: fonts.display,
    fontSize: 12.5,
    color: '#33465A',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DDE5EC',
    backgroundColor: colors.surface,
  },
  menuRowDisabled: {
    borderStyle: 'dashed',
    borderColor: '#C9D3DD',
    backgroundColor: '#F7F9FB',
  },
  menuTile: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  menuTileText: {
    fontFamily: fonts.display,
    fontSize: 13.5,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  menuTitleDisabled: {
    color: colors.disabledText,
  },
  menuBlocked: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7785',
  },
  doneBody: {
    width: '100%',
    maxWidth: MOBILE_COLUMN,
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 32,
    gap: 20,
  },
  doneIntro: {
    alignItems: 'center',
    gap: 14,
  },
  doneCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  doneTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
    textAlign: 'center',
  },
  doneText: {
    fontSize: 15.5,
    lineHeight: 23,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  doneItems: {
    gap: 10,
  },
  doneActions: {
    width: '100%',
    maxWidth: MOBILE_COLUMN,
    alignSelf: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 22,
  },
  doneCard: {
    paddingHorizontal: 32,
    paddingVertical: 36,
    gap: 22,
  },
  doneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  doneNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
  },
  doneNoticeTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0B5E8C',
  },
  doneNoticeText: {
    fontSize: 13,
    color: '#2E4C66',
  },
});
