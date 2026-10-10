// Piezas de página de las pantallas de empresa rediseñadas (fase 3; maquetas
// W-Applications, W-Candidate, W-Direct, C-Offers, W-Offer, W-You, W-Team y sus
// versiones de escritorio W-D-*). Sólo presentación: ninguna carga datos ni
// decide permisos.
//
//   - Móvil: PageBar (flecha y título) arriba, PageBody desplazable y, si hay
//     acciones, StickyBar fija abajo. Sin barra inferior de pestañas: estas
//     pantallas se apilan encima (respuesta 6 de la revisión). En un tablet las
//     tres van en la misma columna centrada (`mobileColumn`, fase 8): el fondo
//     y las líneas siguen a todo el ancho, el contenido no.
//   - Escritorio (≥ WIDE_BREAKPOINT): la barra superior la pone el layout;
//     aquí van las migas (Breadcrumb) y el contenido a dos columnas, con las
//     acciones en la columna lateral.
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import type { LayoutChangeEvent, RefreshControlProps, StyleProp, ViewStyle } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Avatar, Chip, Text } from '../ui';
import { colors } from '../../theme';
import { fonts } from '../../theme/fonts';
import { HOVER_BG, MOBILE_COLUMN, radius, TOUCH_TARGET, UI_TONES, WIDE_BREAKPOINT, type UiTone } from '../../theme/ui';
import { offerTile } from '../../utils/companyHome';
import { cardGridItemWidth } from '../../utils/cardGrid';
import type { Offer } from '../../types/offer';

/** Escritorio: barra superior, rejillas y dos columnas (documento, sección 1). */
export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}

/**
 * Rejilla de tarjetas de escritorio con el mismo ancho para todas (fase 8): el
 * contenedor lleva `onLayout` y cada tarjeta `itemStyle`, que fija su ancho
 * (cardGridItemWidth). Hasta medir, `itemStyle` es undefined y las tarjetas
 * usan su flexBasis de siempre.
 */
export function useCardGrid(minWidth: number, gap: number): {
  onLayout: (event: LayoutChangeEvent) => void;
  itemStyle: ViewStyle | undefined;
} {
  const [width, setWidth] = React.useState(0);
  const onLayout = React.useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  }, []);
  const itemWidth = cardGridItemWidth(width, minWidth, gap);
  const itemStyle: ViewStyle | undefined = itemWidth == null
    ? undefined
    : { width: itemWidth, minWidth: 0, flexGrow: 0, flexShrink: 0, flexBasis: 'auto' };
  return { onLayout, itemStyle };
}

/** Borde de las tarjetas y listas de escritorio de las maquetas. */
export const CARD_BORDER = '#E1E8EE';

// ── Cabeceras ───────────────────────────────────────────────────────────────

/**
 * Cabecera de una pantalla interior en móvil. `large` es el título de una
 * lista ("Applications"); sin él, el rótulo corto de un detalle ("Application").
 */
export function PageBar({
  title,
  onBack,
  right,
  large = false,
  backLabel = 'Back',
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
  large?: boolean;
  backLabel?: string;
}) {
  return (
    <View style={styles.pageBarOuter}>
      <View style={styles.pageBar}>
        <Pressable
          onPress={onBack}
          style={({ hovered }: any) => [styles.back, hovered && styles.hover]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
        >
          <ChevronLeft color={colors.text} size={26} strokeWidth={2.2} />
        </Pressable>
        <Text
          style={[large ? styles.pageTitle : styles.pageLabel, styles.pageBarTitle]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {right ? <View style={styles.pageBarRight}>{right}</View> : null}
      </View>
    </View>
  );
}

/** La línea gris bajo el título de una lista en móvil, alineada con el título. */
export function PageSubtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.pageSubtitle}>{children}</Text>;
}

/** Título de página de escritorio (26 px) con su línea secundaria. */
export function DesktopTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.desktopTitleRow}>
      <View style={styles.desktopTitleCopy}>
        <Text style={styles.desktopTitle} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.desktopSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.desktopTitleRight}>{right}</View> : null}
    </View>
  );
}

/** Migas de escritorio: "Applications › Technician T7A2C91B04". */
export function Breadcrumb({ parent, onParent, current }: { parent: string; onParent: () => void; current: string }) {
  return (
    <View style={styles.breadcrumb} accessibilityRole="toolbar" accessibilityLabel="Breadcrumb">
      <Pressable onPress={onParent} hitSlop={8} accessibilityRole="link">
        {({ hovered }: any) => (
          <Text style={[styles.breadcrumbLink, hovered && styles.breadcrumbLinkHover]}>{parent}</Text>
        )}
      </Pressable>
      <Text style={styles.breadcrumbSep}>›</Text>
      <Text style={styles.breadcrumbCurrent} numberOfLines={1}>{current}</Text>
    </View>
  );
}

/** "‹ Back" de escritorio, para una pantalla a la que se llega desde varios sitios. */
export function BackLink({ onPress, label = 'Back' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.backLink} accessibilityRole="link" accessibilityLabel={label}>
      {({ hovered }: any) => (
        <>
          <ChevronLeft color={hovered ? colors.primaryPressed : colors.primary} size={18} strokeWidth={2.4} />
          <Text style={[styles.breadcrumbLink, hovered && styles.breadcrumbLinkHover]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// ── Cuerpo ──────────────────────────────────────────────────────────────────

/**
 * El cuerpo desplazable. En móvil, márgenes de 20 y un ancho máximo para
 * tabletas; en escritorio, el ancho de las maquetas (1160 o 1240).
 */
export function PageBody({
  wide,
  children,
  refreshControl,
  maxWidth = 1160,
  gap,
  contentStyle,
  scrollRef,
}: {
  wide: boolean;
  children: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  maxWidth?: number;
  gap?: number;
  contentStyle?: StyleProp<ViewStyle>;
  /** Para mover el desplazamiento desde fuera (You vuelve arriba al cambiar de apartado). */
  scrollRef?: React.Ref<ScrollView>;
}) {
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={[
        wide ? styles.bodyWide : styles.body,
        wide && { maxWidth },
        gap != null && { gap },
        contentStyle,
      ]}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={wide}
    >
      {children}
    </ScrollView>
  );
}

/** Dos columnas de escritorio: la principal y la lateral (acciones, resumen). */
export function TwoColumns({ main, aside }: { main: React.ReactNode; aside: React.ReactNode }) {
  return (
    <View style={styles.columns}>
      <View style={styles.columnMain}>{main}</View>
      <View style={styles.columnAside}>{aside}</View>
    </View>
  );
}

/** La caja lateral con borde de escritorio (W-D-Candidate, W-D-Tech). */
export function AsideCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.asideCard, style]}>{children}</View>;
}

/** Botonera fija abajo en móvil. En un tablet, los botones no pasan de la columna del contenido. */
export function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.sticky}>
      <View style={styles.stickyInner}>{children}</View>
    </View>
  );
}

/** Una fila de botones que se reparten el ancho. */
export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.buttonRow}>{children}</View>;
}

// ── Botones ─────────────────────────────────────────────────────────────────

export type PillVariant = 'primary' | 'outline' | 'accent' | 'danger';

/**
 * Botón en píldora de las maquetas.
 *   - primary: relleno del color de acción.
 *   - outline: blanco con borde gris (la acción secundaria).
 *   - accent: blanco con borde y texto del color de acción ("Send offer").
 *   - danger: blanco con borde y texto rojos ("Withdraw offer").
 * Desactivado se pinta gris, no transparente (W-Candidate, Viewer).
 */
export function PillButton({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon: Icon,
  loading = false,
  disabled = false,
  grow,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  variant?: PillVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ComponentType<LucideProps>;
  loading?: boolean;
  disabled?: boolean;
  /** Reparto del ancho en una ButtonRow (1, 1.5…). */
  grow?: number;
  accessibilityLabel?: string;
}) {
  const off = disabled || loading || !onPress;
  const look = PILL_LOOK[variant];
  const fg = disabled ? (variant === 'primary' ? colors.white : colors.disabledText) : look.fg;
  return (
    <Pressable
      // Dentro de una fila pulsable (W-D-Applications), el botón no abre también la fila.
      onPress={(event) => { event?.stopPropagation?.(); onPress?.(); }}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: loading }}
      style={({ pressed, hovered }: any) => [
        styles.pill,
        PILL_SIZE[size],
        { backgroundColor: hovered && !off ? look.hoverBg : look.bg, borderColor: look.border, borderWidth: look.borderWidth },
        disabled && (variant === 'primary' ? styles.pillPrimaryDisabled : styles.pillDisabled),
        grow != null && { flexGrow: grow, flexShrink: 1, flexBasis: 0 },
        pressed && !off && styles.pillPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {Icon ? <Icon color={fg} size={size === 'sm' ? 16 : 19} strokeWidth={2.2} /> : null}
          <Text style={[styles.pillText, size === 'sm' && styles.pillTextSmall, { color: fg }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** `hoverBg`: el fondo al pasar el ratón (sólo web). */
const PILL_LOOK: Record<PillVariant, { bg: string; hoverBg: string; fg: string; border: string; borderWidth: number }> = {
  primary: { bg: colors.primary, hoverBg: colors.primaryPressed, fg: colors.white, border: colors.primary, borderWidth: 0 },
  outline: { bg: colors.surface, hoverBg: HOVER_BG, fg: colors.text, border: colors.border, borderWidth: 1 },
  accent: { bg: colors.surface, hoverBg: colors.primarySoft, fg: colors.primary, border: colors.primary, borderWidth: 1.5 },
  danger: { bg: colors.surface, hoverBg: colors.errorSoft, fg: colors.error, border: '#F3C2C2', borderWidth: 1 },
};

const PILL_SIZE: Record<'sm' | 'md' | 'lg', ViewStyle> = {
  sm: { minHeight: 40, paddingHorizontal: 14 },
  md: { minHeight: 46, paddingHorizontal: 20 },
  lg: { minHeight: 52, paddingHorizontal: 22 },
};

/** Texto plano pulsable del color de acción ("Edit", "See all"). */
export function TextLink({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={styles.textLink} accessibilityRole="link" accessibilityLabel={accessibilityLabel ?? label}>
      {({ hovered }: any) => <Text style={[styles.textLinkText, hovered && styles.breadcrumbLinkHover]}>{label}</Text>}
    </Pressable>
  );
}

// ── Contenido ───────────────────────────────────────────────────────────────

export function SectionTitle({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <Text style={[styles.sectionTitle, wide && styles.sectionTitleWide]} accessibilityRole="header">{children}</Text>;
}

/** Una sección con título: el bloque básico de los detalles. */
export function Section({
  title,
  wide = false,
  right,
  children,
  gap = 8,
}: {
  title: string;
  wide?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
  gap?: number;
}) {
  return (
    <View style={{ gap }}>
      {right ? (
        <View style={styles.sectionHead}>
          <SectionTitle wide={wide}>{title}</SectionTitle>
          {right}
        </View>
      ) : (
        <SectionTitle wide={wide}>{title}</SectionTitle>
      )}
      {children}
    </View>
  );
}

/** Rejilla de cuadros grises "rótulo / valor" (W-Offer, C-DirectDetail, W-Team). */
export function StatGrid({ children, columns = 2 }: { children: React.ReactNode; columns?: 2 | 3 }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.statGrid}>
      {items.map((child, i) => (
        <View key={i} style={columns === 3 ? styles.statCell3 : styles.statCell2}>{child}</View>
      ))}
    </View>
  );
}

/** Un cuadro de la rejilla. `big` es el número grande de W-You / W-Team. */
export function StatTile({
  label,
  value,
  valueColor,
  big = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  value: string | number;
  valueColor?: string;
  big?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      {big ? (
        <>
          <Text style={[styles.statBig, valueColor ? { color: valueColor } : null]}>{value}</Text>
          <Text style={styles.statBigLabel}>{label}</Text>
        </>
      ) : (
        <>
          <Text style={styles.statLabel}>{label}</Text>
          <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
        </>
      )}
    </>
  );
  if (!onPress) return <View style={styles.statTile}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [styles.statTile, (pressed || hovered) && styles.statTilePressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${value} ${label}`}
    >
      {body}
    </Pressable>
  );
}

/** Fila "rótulo … valor" con línea debajo (Requirements, Company details). */
export function KeyValueRow({
  label,
  value,
  last = false,
  muted = false,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
  /** "Not provided": valor en gris. */
  muted?: boolean;
}) {
  return (
    <View style={[styles.kvRow, !last && styles.kvLine]}>
      <Text style={styles.kvLabel}>{label}</Text>
      {typeof value === 'string' ? (
        <Text style={[styles.kvValue, muted && styles.kvValueMuted]}>{value}</Text>
      ) : (
        <View style={styles.kvValueBox}>{value}</View>
      )}
    </View>
  );
}

/** Píldora de solo lectura con borde (licencias: "EASA B1.1"). */
export function OutlineTag({ label }: { label: string }) {
  return (
    <View style={styles.outlineTag}>
      <Text style={styles.outlineTagText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function TagRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.tagRow}>{children}</View>;
}

/** Caja suave con icono opcional: candados, avisos, notas. */
export function NoticeBox({
  icon: Icon,
  tone = 'muted',
  title,
  children,
}: {
  icon?: React.ComponentType<LucideProps>;
  tone?: 'muted' | 'success' | 'warning' | 'error';
  title?: string;
  children?: React.ReactNode;
}) {
  const t = NOTICE_TONES[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]}>
      {title ? (
        <View style={styles.noticeHead}>
          {Icon ? <Icon color={t.title} size={16} strokeWidth={2.4} /> : null}
          <Text style={[styles.noticeTitle, { color: t.title }]}>{title}</Text>
        </View>
      ) : null}
      {children != null ? (
        <View style={!title && Icon ? styles.noticeInline : undefined}>
          {!title && Icon ? <Icon color={t.text} size={16} strokeWidth={2.4} /> : null}
          {typeof children === 'string'
            ? <Text style={[styles.noticeText, { color: t.text }, !title && Icon ? styles.flexShrink : null]}>{children}</Text>
            : children}
        </View>
      ) : null}
    </View>
  );
}

const NOTICE_TONES = {
  muted: { bg: colors.surfaceSoft, title: colors.text, text: colors.textSecondary },
  success: { bg: '#E5F4EC', title: '#0B5B3A', text: '#2D5A45' },
  warning: { bg: '#FFF6E2', title: colors.warning, text: colors.warning },
  error: { bg: colors.errorSoft, title: colors.error, text: colors.error },
} as const;

/** Texto citado sobre fondo gris (nota de candidatura, mensaje de la oferta directa). */
export function QuoteBox({ text }: { text: string }) {
  return (
    <View style={styles.quote}>
      <Text style={styles.quoteText}>{text}</Text>
    </View>
  );
}

/** El cuadrado de color de una oferta ("B1.1", "ENG", "MEC"), como en la Home. */
export function OfferTileSquare({ offer, size = 44 }: { offer: Pick<Offer, 'offerKind' | 'licenseCode' | 'technicianType'>; size?: number }) {
  const tile = offerTile(offer);
  const len = tile.code.length;
  const scale = len <= 2 ? 0.36 : len <= 3 ? 0.3 : len <= 4 ? 0.26 : 0.22;
  return (
    <View
      style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.29), backgroundColor: tile.bg }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.tileCode, { color: tile.fg, fontSize: Math.round(size * scale) }]} numberOfLines={1}>
        {tile.code}
      </Text>
    </View>
  );
}

/**
 * Enlace a una oferta: cuadrado de color, una línea pequeña ("Applied 2h ago
 * to") y el título (W-Candidate, C-DirectDetail). `soft` es la versión gris de
 * la columna lateral de escritorio.
 */
export function OfferLinkCard({
  offer,
  caption,
  meta,
  onPress,
  soft = false,
  trailingLabel,
}: {
  offer: Pick<Offer, 'offerKind' | 'licenseCode' | 'technicianType' | 'title'>;
  caption: string;
  meta?: string;
  onPress: () => void;
  soft?: boolean;
  /** "View offer" en lugar del chevron. */
  trailingLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        styles.offerLink,
        soft ? styles.offerLinkSoft : styles.offerLinkOutline,
        (pressed || hovered) && (soft ? styles.offerLinkSoftPressed : styles.offerLinkPressed),
      ]}
      accessibilityRole="link"
      accessibilityLabel={`${caption} ${offer.title}`}
    >
      {!soft ? <OfferTileSquare offer={offer} size={44} /> : null}
      <View style={styles.offerLinkCopy}>
        <Text style={styles.offerLinkCaption}>{caption}</Text>
        <Text style={styles.offerLinkTitle} numberOfLines={2}>{offer.title}</Text>
        {meta ? <Text style={styles.offerLinkMeta} numberOfLines={2}>{meta}</Text> : null}
      </View>
      {trailingLabel
        ? <Text style={styles.textLinkText}>{trailingLabel}</Text>
        : !soft ? <ChevronRight color={colors.textMuted} size={18} strokeWidth={2} /> : null}
    </Pressable>
  );
}

/** Píldora de estado con los tonos comunes, en dos tamaños. */
export function StatusPill({ label, tone, large = false }: { label: string; tone: UiTone; large?: boolean }) {
  const t = UI_TONES[tone];
  return (
    <View style={[styles.statusPill, large && styles.statusPillLarge, { backgroundColor: t.bg }]}>
      <Text style={[styles.statusPillText, large && styles.statusPillTextLarge, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Verificado en verde; si no, el estado en gris (W-Candidate, C-Tech, W-You). */
export function VerificationPill({ status, large = false }: { status: string | undefined; large?: boolean }) {
  if (status === 'verified') {
    const t = UI_TONES.success;
    return (
      <View style={[styles.statusPill, styles.statusPillIcon, large && styles.statusPillLarge, { backgroundColor: t.bg }]}>
        <Check color={t.text} size={large ? 12 : 11} strokeWidth={3.2} />
        <Text style={[styles.statusPillText, large && styles.statusPillTextLarge, { color: t.text }]}>Verified</Text>
      </View>
    );
  }
  const label = status === 'pending' ? 'Verification pending' : status === 'rejected' ? 'Not verified' : 'Not verified';
  return <StatusPill label={label} tone={status === 'pending' ? 'warning' : 'closed'} large={large} />;
}

/**
 * Cabecera de una persona: avatar, nombre, una línea gris y sus etiquetas
 * (W-Candidate, C-Tech, C-DirectDetail). Con `anonymous` el avatar es el icono
 * genérico, sin nada que identifique (respuesta 4 de la revisión); quién es
 * anónimo lo decide la pantalla con los datos ya filtrados por la base.
 */
export function PersonHero({
  photoPath,
  name,
  anonymous,
  subtitle,
  chips,
  wide = false,
}: {
  name: string;
  anonymous: boolean;
  photoPath?: string | null;
  subtitle?: string;
  chips?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <View style={styles.hero}>
      <Avatar kind="person" size={wide ? 88 : 72} photoPath={photoPath} anonymous={anonymous} name={anonymous ? null : name} />
      <View style={styles.heroCopy}>
        <Text style={[styles.heroName, wide && styles.heroNameWide]} accessibilityRole="header">{name}</Text>
        {subtitle ? <Text style={[styles.heroSub, wide && styles.heroSubWide]}>{subtitle}</Text> : null}
        {chips ? <View style={styles.heroChips}>{chips}</View> : null}
      </View>
    </View>
  );
}

/** El punto rojo de "hay algo nuevo" sobre un avatar. */
export function AvatarDot({ size = 13 }: { size?: number }) {
  return <View style={[styles.avatarDot, { width: size, height: size, borderRadius: size / 2 }]} />;
}

// ── Listas ──────────────────────────────────────────────────────────────────

/**
 * Filas separadas por una línea. En móvil van sueltas sobre el fondo; en
 * escritorio, dentro de una caja con borde (W-D-Applications).
 */
export function RowList({ wide, children }: { wide: boolean; children: React.ReactNode }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={wide ? styles.rowListWide : undefined}>
      {rows.map((row, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <View style={styles.rowDivider} /> : null}
          {row}
        </React.Fragment>
      ))}
    </View>
  );
}

/** Los filtros de estado: en móvil se desplazan en horizontal; en escritorio se envuelven. */
export function FilterChipRow<K extends string>({
  wide,
  options,
  value,
  onChange,
}: {
  wide: boolean;
  options: readonly { key: K; label: string; count?: number }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const chips = options.map((o) => (
    <Chip key={o.key} label={o.label} count={o.count} selected={o.key === value} onPress={() => onChange(o.key)} />
  ));
  if (wide) return <View style={styles.chipsWrap}>{chips}</View>;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipsScroll}
      contentContainerStyle={styles.chipsScrollContent}
    >
      {chips}
    </ScrollView>
  );
}

/**
 * Control segmentado de las maquetas (WFilters "Airplanes or helicopters",
 * W-D-Search "List | Map"): una opción elegida, sobre fondo gris.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  fill = true,
}: {
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  accessibilityLabel?: string;
  /** Las opciones se reparten el ancho; sin él, cada una mide lo que su texto. */
  fill?: boolean;
}) {
  return (
    <View style={[styles.segment, !fill && styles.segmentInline]} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ hovered }: any) => [
              styles.segmentOption,
              fill && styles.segmentOptionFill,
              on ? styles.segmentOptionOn : hovered && styles.segmentOptionHover,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Estados de carga ────────────────────────────────────────────────────────

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <View style={styles.stateBox}>
      <ActivityIndicator color={colors.primary} />
      {label ? <Text style={styles.stateText}>{label}</Text> : null}
    </View>
  );
}

export function EmptyBlock({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function ErrorBlock({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <View style={styles.stateBox}>
      <Text style={styles.stateText}>{text}</Text>
      {onRetry ? <PillButton label="Try again" variant="outline" size="md" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },

  pageBarOuter: {
    backgroundColor: colors.surface,
  },
  pageBar: {
    width: '100%',
    maxWidth: MOBILE_COLUMN,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 8,
    paddingRight: 16,
    paddingLeft: 4,
  },
  hover: {
    backgroundColor: HOVER_BG,
  },
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pageBarTitle: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  pageLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  pageBarRight: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pageSubtitle: {
    width: '100%',
    maxWidth: MOBILE_COLUMN,
    alignSelf: 'center',
    paddingLeft: 48,
    paddingRight: 20,
    fontSize: 14,
    color: colors.textSecondary,
  },

  desktopTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
  },
  desktopTitleCopy: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  desktopTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
  },
  desktopSubtitle: {
    fontSize: 14.5,
    color: colors.textSecondary,
  },
  desktopTitleRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
  },
  breadcrumbLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  breadcrumbLinkHover: {
    color: colors.primaryPressed,
  },
  breadcrumbSep: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  breadcrumbCurrent: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },

  body: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 20,
  },
  bodyWide: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 48,
    gap: 18,
  },
  columns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 32,
  },
  columnMain: {
    flexGrow: 999,
    flexShrink: 1,
    flexBasis: 520,
    minWidth: 0,
    gap: 22,
  },
  columnAside: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 320,
    minWidth: 0,
    gap: 16,
  },
  asideCard: {
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 22,
    padding: 22,
    gap: 14,
    backgroundColor: colors.surface,
  },
  sticky: {
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  stickyInner: {
    width: '100%',
    maxWidth: MOBILE_COLUMN - 40,
    alignSelf: 'center',
    gap: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },

  pill: {
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pillPressed: {
    opacity: 0.85,
  },
  pillPrimaryDisabled: {
    backgroundColor: '#C9D3DD',
    borderColor: '#C9D3DD',
  },
  pillDisabled: {
    backgroundColor: colors.disabled,
    borderColor: CARD_BORDER,
  },
  pillText: {
    fontSize: 16,
    fontWeight: '800',
  },
  pillTextSmall: {
    fontSize: 13.5,
  },
  textLink: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  textLinkText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },

  sectionHead: {
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
  sectionTitleWide: {
    fontSize: 17,
  },

  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCell2: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 0,
  },
  statCell3: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 0,
  },
  statTile: {
    flexGrow: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
    gap: 1,
  },
  statTilePressed: {
    backgroundColor: colors.surfaceMuted,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  statValue: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.text,
  },
  statBig: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
  },
  statBigLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
  },
  kvLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  kvLabel: {
    flexShrink: 0,
    maxWidth: '45%',
    fontSize: 14,
    color: colors.textSecondary,
  },
  kvValue: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'right',
  },
  kvValueMuted: {
    fontWeight: '600',
    color: colors.textMuted,
  },
  kvValueBox: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },

  outlineTag: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  outlineTagText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.text,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  notice: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    gap: 6,
  },
  noticeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeTitle: {
    fontSize: 14.5,
    fontWeight: '800',
  },
  noticeInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  noticeText: {
    fontSize: 13.5,
    lineHeight: 19,
  },

  quote: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
  },
  quoteText: {
    fontSize: 14.5,
    lineHeight: 22,
    color: '#33465A',
  },

  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tileCode: {
    fontFamily: fonts.display,
  },

  offerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  offerLinkOutline: {
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  offerLinkPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  offerLinkSoft: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 14,
  },
  offerLinkSoftPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  offerLinkCopy: {
    flex: 1,
    minWidth: 0,
  },
  offerLinkCaption: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  offerLinkTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  offerLinkMeta: {
    marginTop: 1,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  statusPill: {
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  statusPillLarge: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 14,
  },
  statusPillIcon: {
    flexDirection: 'row',
    gap: 4,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  heroName: {
    fontSize: 21,
    fontWeight: '800',
    color: colors.text,
  },
  heroNameWide: {
    fontSize: 26,
  },
  heroSub: {
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  heroSubWide: {
    fontSize: 15,
  },
  heroChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  statusPillTextLarge: {
    fontSize: 12.5,
  },
  avatarDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.notify,
  },

  rowListWide: {
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },

  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipsScroll: {
    flexGrow: 0,
    marginHorizontal: -20,
  },
  chipsScrollContent: {
    gap: 8,
    paddingHorizontal: 20,
  },

  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  segmentInline: {
    alignSelf: 'flex-start',
    borderRadius: 24,
  },
  segmentOption: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOptionFill: {
    flex: 1,
    paddingHorizontal: 6,
  },
  segmentOptionOn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  segmentOptionHover: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  segmentText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  segmentTextOn: {
    color: colors.text,
  },
  stateBox: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 12,
  },
  stateText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyBox: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: colors.surfaceSoft,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  emptyAction: {
    marginTop: 8,
    alignItems: 'flex-start',
  },
});
