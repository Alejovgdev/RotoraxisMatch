// Anillo de foco común en web (rediseño, fase 8).
//
// Antes cada navegador pintaba el suyo, y los buscadores de país, ciudad y
// aeropuerto lo tenían quitado (`outlineStyle: 'none'`): con el teclado no se
// veía dónde estaba el foco. Ahora todo lo que se alcanza con el tabulador
// (botones, enlaces, campos y los pulsables de react-native-web, que llevan
// tabindex="0") pinta el mismo anillo de 2 px en el color de acción, y sólo
// con el teclado (`:focus-visible`; en un campo de texto el navegador lo
// aplica también al hacer clic, como siempre).
//
// Un campo sin borde propio dentro de una píldora (los buscadores) no pinta el
// anillo en el campo, sino en la píldora: el contenedor lleva
// `{...focusRingWithin}`.
//
// El mapa (Leaflet) queda fuera: sus marcadores tienen su propio foco y el
// mapa se queda como está (respuesta 22).
import { Platform } from 'react-native';
import { colors } from '../../theme';

const STYLE_ID = 'ajt-focus-ring';
const RING = `2px solid ${colors.primary}`;

export const FOCUS_RING_CSS = `
:is(button, a[href], input, textarea, select, [tabindex="0"]):not([role="none"]):not(.leaflet-container *):not([data-focus-ring="within"] :is(input, textarea)):focus-visible {
  outline: ${RING} !important;
  outline-offset: 2px !important;
}
[data-focus-ring="within"]:has(:is(input, textarea):focus-visible) {
  outline: ${RING};
  outline-offset: 2px;
}
[data-focus-ring="within"] :is(input, textarea):focus-visible {
  outline: none !important;
}
`;

/** Mete la hoja del anillo en el documento una sola vez. En nativo, y al renderizar en el servidor, no hace nada. */
export function installWebFocusRing(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = FOCUS_RING_CSS;
  document.head.appendChild(style);
}

/**
 * Para el contenedor de un campo sin borde propio (la píldora de un buscador):
 * el anillo se pinta en el contenedor y no en el campo. En nativo no añade nada.
 */
export const focusRingWithin: object = Platform.OS === 'web' ? { dataSet: { focusRing: 'within' } } : {};
