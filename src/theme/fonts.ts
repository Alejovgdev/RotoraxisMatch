// Fuentes del rediseño (docs/UI_REDESIGN.md, D4 y respuesta 3 de la revisión).
//
// Nunito Sans para todo el texto; Nunito 800/900 para el logo "Aviation Job
// Talent" y las cifras grandes. Cada grosor es UN FICHERO con su propio nombre
// de familia: en Android una fuente propia no respeta `fontWeight`, así que el
// grosor se elige escogiendo el fichero, nunca con `fontWeight`. Eso lo hace
// el componente común de texto (src/components/ui/Text.tsx) con
// `fontFamilyForWeight`; una pantalla no debería nombrar estas familias salvo
// para el logo.
//
// Se importa cada grosor por su subruta y no desde la raíz del paquete: la raíz
// exporta los 18 ficheros, y todos acabarían empaquetados en la app.
import { NunitoSans_400Regular } from '@expo-google-fonts/nunito-sans/400Regular';
import { NunitoSans_400Regular_Italic } from '@expo-google-fonts/nunito-sans/400Regular_Italic';
import { NunitoSans_500Medium } from '@expo-google-fonts/nunito-sans/500Medium';
import { NunitoSans_500Medium_Italic } from '@expo-google-fonts/nunito-sans/500Medium_Italic';
import { NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans/600SemiBold';
import { NunitoSans_600SemiBold_Italic } from '@expo-google-fonts/nunito-sans/600SemiBold_Italic';
import { NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans/700Bold';
import { NunitoSans_800ExtraBold } from '@expo-google-fonts/nunito-sans/800ExtraBold';
import { NunitoSans_900Black } from '@expo-google-fonts/nunito-sans/900Black';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { Nunito_900Black } from '@expo-google-fonts/nunito/900Black';

/** El mapa que se pasa a `useFonts` en app/_layout.tsx. */
export const FONT_ASSETS = {
  NunitoSans_400Regular,
  NunitoSans_400Regular_Italic,
  NunitoSans_500Medium,
  NunitoSans_500Medium_Italic,
  NunitoSans_600SemiBold,
  NunitoSans_600SemiBold_Italic,
  NunitoSans_700Bold,
  NunitoSans_800ExtraBold,
  NunitoSans_900Black,
  Nunito_800ExtraBold,
  Nunito_900Black,
} as const;

export type FontFamilyName = keyof typeof FONT_ASSETS;

export const fonts = {
  regular: 'NunitoSans_400Regular',
  medium: 'NunitoSans_500Medium',
  semibold: 'NunitoSans_600SemiBold',
  bold: 'NunitoSans_700Bold',
  extrabold: 'NunitoSans_800ExtraBold',
  black: 'NunitoSans_900Black',
  /** Logo "Aviation Job Talent" (Nunito 900). */
  logo: 'Nunito_900Black',
  /** Cifras grandes de las tarjetas de estadística (Nunito 900). */
  display: 'Nunito_900Black',
  displayBold: 'Nunito_800ExtraBold',
} as const satisfies Record<string, FontFamilyName>;

/** Los grosores que tienen fichero propio. */
export type LoadedWeight = 400 | 500 | 600 | 700 | 800 | 900;

const UPRIGHT: Record<LoadedWeight, FontFamilyName> = {
  400: 'NunitoSans_400Regular',
  500: 'NunitoSans_500Medium',
  600: 'NunitoSans_600SemiBold',
  700: 'NunitoSans_700Bold',
  800: 'NunitoSans_800ExtraBold',
  900: 'NunitoSans_900Black',
};

// Sólo se cargan las cursivas que la app usa hoy (400, 500 y 600). Una cursiva
// más gruesa cae en la de 600 en vez de perder la cursiva.
const ITALIC: Partial<Record<LoadedWeight, FontFamilyName>> = {
  400: 'NunitoSans_400Regular_Italic',
  500: 'NunitoSans_500Medium_Italic',
  600: 'NunitoSans_600SemiBold_Italic',
};

/**
 * El grosor con fichero que corresponde a un `fontWeight` de React Native.
 * 100–400 y 'normal' → 400; 'bold' → 700; el resto, su centena (500–900).
 * Un valor desconocido cae en 400, que es lo que haría el sistema.
 */
export function normalizeFontWeight(weight: unknown): LoadedWeight {
  if (weight === 'bold') return 700;
  const n = typeof weight === 'number' ? weight : parseInt(String(weight ?? ''), 10);
  if (!Number.isFinite(n) || n <= 400) return 400;
  if (n >= 900) return 900;
  return (Math.round(n / 100) * 100) as LoadedWeight;
}

/** La familia (el fichero) para un grosor y estilo dados. */
export function fontFamilyForWeight(weight: unknown, italic = false): FontFamilyName {
  const w = normalizeFontWeight(weight);
  if (!italic) return UPRIGHT[w];
  return ITALIC[w] ?? (w < 400 ? ITALIC[400]! : ITALIC[600]!);
}
