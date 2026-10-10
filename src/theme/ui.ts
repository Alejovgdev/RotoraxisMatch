// Tokens de interfaz del rediseño, comunes a empresa, técnico y admin.
//
// `companyUi` (src/components/company/CompanyUI.tsx), `techUi`
// (src/components/technician/TechnicianUI.tsx) y `adminUi` son este mismo
// objeto: el documento pide que las dos áreas usen los mismos tokens. Los
// nombres de las claves son los que ya leían las pantallas; sólo cambian los
// valores (respuesta 2 de la revisión).
import { Platform } from 'react-native';
import type { ViewStyle } from 'react-native';
import { colors } from './colors';

export const appUi = {
  page: colors.background,
  surface: colors.surface,
  surfaceSoft: colors.surfaceSoft,
  surfaceMuted: colors.surfaceMuted,
  border: colors.border,
  borderSoft: colors.borderLight,
  text: colors.text,
  textSoft: colors.textSecondary,
  textMuted: colors.textMuted,
  placeholder: colors.placeholder,
  accent: colors.primary,
  accentPressed: colors.primaryPressed,
  accentSoft: colors.primarySoft,
  blue: colors.info,
  blueSoft: colors.infoSoft,
  green: colors.success,
  greenSoft: colors.successSoft,
  amber: colors.warning,
  amberSoft: colors.warningSoft,
  red: colors.error,
  redSoft: colors.errorSoft,
  notify: colors.notify,
  navy: colors.navy,
  disabled: colors.disabled,
  disabledText: colors.disabledText,
};

export type AppUi = typeof appUi;

/** Radios de las maquetas: tarjetas 16–24, campos 14, todo lo pulsable en píldora. */
export const radius = {
  sm: 10,
  field: 14,
  card: 18,
  sheet: 24,
  pill: 999,
} as const;

/** Altura mínima de cualquier cosa pulsable (documento, sección 1). */
export const TOUCH_TARGET = 44;

/**
 * A partir de este ancho la app usa el diseño de escritorio: barra superior en
 * vez de la inferior, rejillas y diálogos centrados (documento, sección 1).
 */
export const WIDE_BREAKPOINT = 1024;

/**
 * La columna del diseño de móvil. Por debajo de WIDE_BREAKPOINT (teléfono y
 * tablet) la cabecera, el contenido y la botonera de abajo se centran en ella,
 * para que en un tablet no se estiren a todo el ancho (fase 8).
 */
export const MOBILE_COLUMN = 720;

/** Centra un bloque en la columna de móvil; en un teléfono ocupa todo el ancho. */
export const mobileColumn: ViewStyle = { width: '100%', maxWidth: MOBILE_COLUMN, alignSelf: 'center' };

/** Desde este ancho (tablet), las rejillas de tarjetas del diseño de móvil pasan de 2 a 3 columnas. */
export const TABLET_GRID_BREAKPOINT = 700;

/** Columnas de una rejilla de tarjetas en el diseño de móvil: 2 en teléfono, 3 en tablet. */
export function mobileGridColumns(width: number): 2 | 3 {
  return width >= TABLET_GRID_BREAKPOINT ? 3 : 2;
}

/**
 * Fondo al pasar el ratón por una fila, una tarjeta o un botón blanco (sólo
 * web; en nativo no hay `hovered`). Es el mismo gris del "pulsado".
 */
export const HOVER_BG = colors.surfaceSoft;

export type UiTone = 'success' | 'warning' | 'error' | 'info' | 'muted' | 'navy' | 'cyan' | 'waiting' | 'closed';

/** Fondo, texto y borde de cada tono de etiqueta, tomados de las maquetas. */
export const UI_TONES: Record<UiTone, { bg: string; text: string; border: string }> = {
  success: { bg: colors.successSoft, text: '#0B5B3A', border: '#A7DCC3' },
  warning: { bg: colors.warningSoft, text: colors.warning, border: '#F3DDA4' },
  error: { bg: colors.errorSoft, text: colors.error, border: '#F3C2C2' },
  info: { bg: colors.primarySoft, text: colors.info, border: '#BFDDEF' },
  muted: { bg: colors.surfaceSoft, text: colors.textSecondary, border: colors.borderLight },
  navy: { bg: colors.navy, text: colors.white, border: colors.navy },
  cyan: { bg: colors.primarySoft, text: colors.primary, border: '#BFDDEF' },
  /** Esperando respuesta de la otra parte (oferta directa enviada; rol Recruiter). */
  waiting: { bg: '#DCE7FB', text: '#1E4FB8', border: '#C3D4F5' },
  /** Terminado sin más acción: rechazada, retirada, caducada, cerrada. */
  closed: { bg: '#E9EDF1', text: '#4A5A6C', border: '#DDE3E9' },
};

/**
 * Sombra de las tarjetas: casi nada. Con el fondo blanco la tarjeta se separa
 * por su borde, no por la sombra.
 */
export const cardShadow = Platform.select<ViewStyle>({
  web: { boxShadow: '0px 1px 2px rgba(14, 26, 43, 0.04)' } as ViewStyle,
  default: {
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
});

/** Sombra de lo que flota: el botón "+", los botones de mapa, los avisos. */
export const floatingShadow = Platform.select<ViewStyle>({
  web: { boxShadow: '0px 6px 14px rgba(11, 106, 158, 0.28)' } as ViewStyle,
  default: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
});

/** Sombra de los diálogos centrados. */
export const dialogShadow = Platform.select<ViewStyle>({
  web: { boxShadow: '0px 20px 50px rgba(14, 26, 43, 0.3)' } as ViewStyle,
  default: {
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.3,
    shadowRadius: 50,
    elevation: 12,
  },
});
