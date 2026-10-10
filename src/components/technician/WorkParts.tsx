// Piezas de My work (rediseño, fase 6A; maqueta T-Quals, con los chips de
// T-Add): "What you do" con candados, tarjetas de licencia con sus
// habilitaciones dentro, filas de experiencia y la fila bloqueada de motores.
//
// Sólo presentación: las reglas (qué bloquea, qué se puede añadir, qué se
// guarda) vienen de fuera —src/utils/profileTypes.ts, src/utils/technicianWork.ts
// y el caso de uso— y las pantallas no las repiten.
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { Check, ChevronDown, ChevronUp, Lock, Plus } from 'lucide-react-native';
import { Text } from '../ui';
import { colors } from '../../theme';
import { fonts } from '../../theme/fonts';
import { HOVER_BG, radius, TOUCH_TARGET } from '../../theme/ui';
import { CARD_BORDER } from '../company/CompanyPage';
import { licenceTileColors } from '../../utils/technicianWork';
import type { TechnicianTypeOption } from '../../auth/useCatalogOptions';

// ── Secciones ───────────────────────────────────────────────────────────────

/** Título de sección de My work, con su línea gris y algo a la derecha. */
export function WorkSectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeadRow}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
        {right}
      </View>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    </View>
  );
}

/** Una nota gris pequeña, con un candado opcional delante. */
export function WorkNote({ children, locked = false, tone = 'muted' }: { children: string; locked?: boolean; tone?: 'muted' | 'warning' | 'error' }) {
  const color = tone === 'warning' ? colors.warning : tone === 'error' ? colors.error : colors.textSecondary;
  return (
    <View style={styles.noteRow}>
      {locked ? <Lock color={color} size={13} strokeWidth={2.4} style={styles.noteIcon} /> : null}
      <Text style={[styles.note, { color }]} accessibilityRole={tone === 'error' ? 'alert' : undefined}>{children}</Text>
    </View>
  );
}

// ── "What you do" ───────────────────────────────────────────────────────────

/**
 * Los tipos de perfil como chips (T-Add): bloqueado por una licencia, azul
 * suave con candado; marcado, azul marino con ✓; sin marcar, blanco. Se
 * guardan al tocar: el que llama decide qué pasa (toggleProfileType).
 */
export function ProfileTypeChips({
  options,
  loading,
  selected,
  locked,
  disabled = false,
  savingCode,
  onToggle,
}: {
  options: TechnicianTypeOption[];
  loading: boolean;
  selected: readonly string[];
  locked: readonly string[];
  /** Todos apagados (p. ej. hay licencias sin guardar). */
  disabled?: boolean;
  /** El chip que se está guardando ahora. */
  savingCode?: string | null;
  onToggle: (code: string) => void;
}) {
  if (loading) return <WorkNote>Loading profile types...</WorkNote>;
  // Catálogo vacío = fallo de carga, no "no hay tipos".
  if (options.length === 0) return <WorkNote tone="error">Could not load the profile types. Check your connection and reload.</WorkNote>;

  return (
    <View style={styles.typeChips}>
      {options.map((option) => {
        const on = selected.includes(option.code);
        const isLocked = on && locked.includes(option.code);
        const saving = savingCode === option.code;
        const fg = isLocked ? '#0B5E8C' : on ? colors.white : colors.text;
        return (
          <Pressable
            key={option.code}
            onPress={() => onToggle(option.code)}
            disabled={disabled || Boolean(savingCode)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: disabled || Boolean(savingCode), busy: saving }}
            accessibilityLabel={isLocked ? `${option.label}, comes from your licences` : option.label}
            style={({ pressed, hovered }: any) => [
              styles.typeChip,
              isLocked ? styles.typeChipLocked : on ? styles.typeChipOn : null,
              disabled && styles.typeChipDisabled,
              hovered && !on && !disabled && !savingCode && styles.typeChipHover,
              pressed && !disabled && styles.typeChipPressed,
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={fg} />
            ) : isLocked ? (
              <Lock color={fg} size={14} strokeWidth={2.4} />
            ) : on ? (
              <Check color={fg} size={14} strokeWidth={3} />
            ) : null}
            <Text style={[styles.typeChipText, { color: fg }]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * La sección "What you do" entera, la misma en My work y en el "+": los chips,
 * una línea por candado ("Mechanic comes from your EASA B1.1."), la nota de
 * la FAA A o A&P y los avisos. Los datos los calcula quien la monta
 * (whatYouDoFacts y useProfileTypesEditor).
 */
export function WhatYouDo({
  subtitle,
  options,
  loading,
  types,
  locked,
  lockLines,
  faaNote,
  disabled = false,
  disabledNote,
  savingCode,
  error,
  onToggle,
}: {
  subtitle: string;
  options: TechnicianTypeOption[];
  loading: boolean;
  types: readonly string[];
  locked: readonly string[];
  lockLines: readonly string[];
  faaNote: string | null;
  disabled?: boolean;
  disabledNote?: string | null;
  savingCode: string | null;
  error: string | null;
  onToggle: (code: string) => void;
}) {
  return (
    <View style={styles.whatYouDo}>
      <WorkSectionHeader title="What you do" subtitle={subtitle} />
      <ProfileTypeChips
        options={options}
        loading={loading}
        selected={types}
        locked={locked}
        disabled={disabled}
        savingCode={savingCode}
        onToggle={onToggle}
      />
      {lockLines.map((line) => <WorkNote key={line} locked>{line}</WorkNote>)}
      {faaNote ? <WorkNote>{faaNote}</WorkNote> : null}
      {disabled && disabledNote ? <WorkNote tone="warning">{disabledNote}</WorkNote> : null}
      {error ? <WorkNote tone="error">{error}</WorkNote> : null}
    </View>
  );
}

// ── Licencias ───────────────────────────────────────────────────────────────

/**
 * El cuadrado con el código ("B1.1", "A&P"), azul las Part-66 y arena la FAA.
 * Dentro de la cabecera azul de una tarjeta es blanco; `onWhite`, sobre fondo
 * blanco (asistente de licencia, T-LicDates y T-LicDone), lleva el azul suave.
 */
export function LicenceTile({ authority, code, size = 48, onWhite = false }: { authority: string; code: string; size?: number; onWhite?: boolean }) {
  const colorsFor = licenceTileColors(authority);
  const look = onWhite && authority !== 'FAA' ? { ...colorsFor, bg: colorsFor.header } : colorsFor;
  const scale = code.length <= 2 ? 0.34 : code.length <= 3 ? 0.3 : 0.28;
  return (
    <View
      style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.29), backgroundColor: look.bg }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.tileText, { color: look.fg, fontSize: Math.round(size * scale) }]} numberOfLines={1}>{code}</Text>
    </View>
  );
}

/**
 * Una licencia como tarjeta (T-Quals): la cabecera con el código, su nombre y
 * sus fechas; al tocarla se abre `details` (fechas y "Remove licence"). Debajo,
 * sus habilitaciones y lo que se pueda añadir. La cabecera es el único botón;
 * lo de dentro va FUERA de ella, nunca un botón dentro de otro.
 */
export function LicenceCard({
  authority,
  code,
  title,
  subtitle,
  meta,
  expanded,
  onToggle,
  details,
  children,
}: {
  authority: string;
  code: string;
  title: string;
  subtitle: string;
  /** Una segunda línea gris (las fechas). */
  meta?: string;
  expanded: boolean;
  onToggle: () => void;
  details: React.ReactNode;
  children?: React.ReactNode;
}) {
  const look = licenceTileColors(authority);
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onToggle}
        style={({ pressed, hovered }: any) => [styles.cardHead, { backgroundColor: look.header }, (pressed || hovered) && styles.cardHeadPressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}. ${subtitle}.${meta ? ` ${meta}.` : ''} ${expanded ? 'Hide' : 'Edit'} dates`}
      >
        <LicenceTile authority={authority} code={code} />
        <View style={styles.cardHeadCopy}>
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.cardSub} numberOfLines={2}>{subtitle}</Text>
          {meta ? <Text style={styles.cardSub} numberOfLines={2}>{meta}</Text> : null}
        </View>
        <Chevron color={colors.textMuted} size={20} strokeWidth={2} />
      </Pressable>
      {expanded ? <View style={styles.cardDetails}>{details}</View> : null}
      {children}
    </View>
  );
}

/** Una franja de la tarjeta, con la línea de arriba. */
export function CardStrip({ children }: { children: React.ReactNode }) {
  return <View style={styles.strip}>{children}</View>;
}

// ── Filas de añadir y elementos ─────────────────────────────────────────────

/** "+ Add a type rating on B1.1": la acción de añadir dentro de una tarjeta o sección. */
export function AddRow({ label, onPress, inCard = false }: { label: string; onPress: () => void; inCard?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [inCard ? styles.addRowInCard : styles.addRow, (pressed || hovered) && styles.addRowPressed]}
      accessibilityRole="button"
    >
      <Plus color={colors.primary} size={16} strokeWidth={2.6} />
      <Text style={styles.addRowText}>{label}</Text>
    </Pressable>
  );
}

/** La caja de un formulario de añadir abierto (fuera de una tarjeta). */
export function AddPanel({ children }: { children: React.ReactNode }) {
  return <View style={styles.addPanel}>{children}</View>;
}

/** Un elemento de experiencia (T-Quals): cuadrado, nombre y una línea. Sin pulsar. */
export function ExperienceItem({
  tile,
  icon: Icon,
  title,
  subtitle,
  trailing,
  children,
}: {
  tile?: string;
  icon?: React.ComponentType<LucideProps>;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.item}>
      <View style={styles.itemRow}>
        <View style={styles.itemTile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Icon ? <Icon color="#33465A" size={20} strokeWidth={2} /> : <Text style={styles.itemTileText}>{tile}</Text>}
        </View>
        <View style={styles.itemCopy}>
          <Text style={styles.itemTitle}>{title}</Text>
          {subtitle ? <Text style={styles.itemSub}>{subtitle}</Text> : null}
        </View>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** "Remove" en rojo, como texto pulsable. */
export function RemoveLink({ label = 'Remove', onPress, accessibilityLabel }: { label?: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.remove} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}>
      {({ hovered }: any) => <Text style={[styles.removeText, hovered && styles.linkHover]}>{label}</Text>}
    </Pressable>
  );
}

/** Texto pulsable del color de acción, en línea ("Retry engine catalog", "Request it"). */
export function InlineLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.inlineLink} accessibilityRole="button">
      {({ hovered }: any) => <Text style={[styles.inlineLinkText, hovered && styles.linkHover]}>{label}</Text>}
    </Pressable>
  );
}

/**
 * Lo que necesita algo antes, en gris y con lo que falta (documento, sección 1:
 * no se oculta). La fila de motores sin Engine Technician (T-Quals).
 */
export function LockedRow({ tile, title, subtitle }: { tile: string; title: string; subtitle: string }) {
  return (
    <View style={styles.locked} accessibilityRole="text" accessibilityLabel={`${title}. ${subtitle}`}>
      <View style={styles.lockedTile}>
        <Text style={styles.lockedTileText}>{tile}</Text>
      </View>
      <View style={styles.itemCopy}>
        <Text style={styles.lockedTitle}>{title}</Text>
        <Text style={styles.itemSub}>{subtitle}</Text>
      </View>
    </View>
  );
}

/** Una casilla con su texto (la firma FAA de una aeronave). */
export function CheckboxRow({ label, checked, onPress, disabled = false }: { label: string; checked: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.checkboxRow, disabled && styles.checkboxDisabled]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
    >
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
        {checked ? <Check color={colors.white} size={14} strokeWidth={3} /> : null}
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
    </Pressable>
  );
}

export const workStyles = StyleSheet.create({
  fieldLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  fieldHint: {
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 15,
    color: colors.text,
  },
  dates: {
    flexDirection: 'row',
    gap: 10,
  },
  dateField: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  dateLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  warning: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
    color: colors.warning,
  },
});

const styles = StyleSheet.create({
  whatYouDo: {
    gap: 8,
  },
  sectionHeader: {
    gap: 2,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  sectionSub: {
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  noteIcon: {
    marginTop: 3,
  },
  note: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  typeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeChipOn: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  typeChipLocked: {
    backgroundColor: colors.primarySoft,
    borderColor: '#BFDDEF',
  },
  typeChipDisabled: {
    opacity: 0.5,
  },
  typeChipHover: {
    backgroundColor: HOVER_BG,
    borderColor: colors.textMuted,
  },
  typeChipPressed: {
    opacity: 0.85,
  },
  typeChipText: {
    fontSize: 14,
    fontWeight: '800',
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tileText: {
    fontFamily: fonts.display,
  },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  cardHeadPressed: {
    opacity: 0.9,
  },
  cardHeadCopy: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  cardSub: {
    fontSize: 13,
    color: '#2E4C66',
  },
  cardDetails: {
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  strip: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  addRow: {
    minHeight: TOUCH_TARGET + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#B8C8D9',
    backgroundColor: '#F7FAFC',
  },
  addRowInCard: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  addRowPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  addRowText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  addPanel: {
    gap: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  item: {
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surfaceSoft,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemTileText: {
    fontFamily: fonts.display,
    fontSize: 12.5,
    color: '#33465A',
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.text,
  },
  itemSub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  remove: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    flexShrink: 0,
  },
  removeText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.error,
  },
  /** Al pasar el ratón por un enlace de texto: subrayado. */
  linkHover: {
    textDecorationLine: 'underline',
  },
  inlineLink: {
    alignSelf: 'flex-start',
    minHeight: 32,
    justifyContent: 'center',
  },
  inlineLinkText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.primary,
  },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C9D3DD',
    backgroundColor: '#F7F9FB',
  },
  lockedTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#EEF1F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedTileText: {
    fontFamily: fonts.display,
    fontSize: 12.5,
    color: colors.disabledText,
  },
  lockedTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#4A5A6C',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: TOUCH_TARGET,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDisabled: {
    opacity: 0.6,
  },
  checkboxOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.text,
  },
});
