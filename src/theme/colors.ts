// Paleta del rediseño (docs/UI_REDESIGN.md, sección 1 "Visual system", y los
// valores de las maquetas de docs/redesign/mockups/).
//
// Los nombres de siempre se conservan y cambian de valor, para que toda la app
// coja el estilo nuevo a la vez (respuesta 2 de la revisión). Reglas de uso:
//   - Una sola acción: `primary` (#0B6A9E). Los antiguos azul y cian apuntan
//     ahí.
//   - Ámbar sólo para "requiere atención" (`warning` / `warningSoft`).
//   - Rojo de aviso (`notify`) sólo para contadores de notificaciones. Los
//     errores y las acciones destructivas usan `error` / `errorSoft`, el rojo
//     más oscuro de las maquetas.
//   - Verde sólo para disponible, aceptado, añadido o buena coincidencia.
export const colors = {
  // Acción
  primary: '#0B6A9E',
  primaryPressed: '#08507A',
  primarySoft: '#E6F1F8',
  /** El color del logo "Aviation Job Talent". */
  logo: '#0E8FB0',

  // Nombres heredados: mismo papel, valores nuevos.
  navy: '#0E1A2B',
  navyLight: '#13314D',
  blue: '#0B6A9E',
  blueLight: '#0E8FB0',
  cyan: '#0B6A9E',
  cyanLight: '#0B6A9E',

  // Superficies y líneas
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSoft: '#F3F6F9',
  surfaceMuted: '#EEF3F7',
  /** Bordes de campos, chips y botones secundarios. */
  border: '#D5DEE6',
  /** Líneas divisorias y bordes de tarjeta. */
  borderLight: '#E6ECF1',
  overlay: 'rgba(14, 26, 43, 0.45)',

  // Texto
  text: '#0E1A2B',
  textSecondary: '#526274',
  textMuted: '#66768A',
  placeholder: '#5D6D80',
  textInverse: '#FFFFFF',

  // Desactivado
  disabled: '#F3F6F9',
  disabledText: '#8A97A6',

  // Semánticos
  success: '#157F4F',
  successSoft: '#D3F1E3',
  warning: '#7A3F06',
  warningSoft: '#FDE7B5',
  error: '#B42318',
  errorSoft: '#FDECEC',
  info: '#0B5E8C',
  infoSoft: '#D6ECF8',
  /** Sólo para contadores de notificaciones. */
  notify: '#D42C2C',

  // Acentos por rol: una sola acción para todos.
  technician: '#0B6A9E',
  company: '#0B6A9E',
  admin: '#0B6A9E',
} as const;

export type Color = keyof typeof colors;
