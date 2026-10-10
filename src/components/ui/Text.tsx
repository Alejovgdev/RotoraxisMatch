// El <Text> y el <TextInput> de toda la app (rediseño, respuesta 3 de la
// revisión). Mismas props que los de React Native; lo único que hacen distinto
// es poner la fuente Nunito Sans del grosor pedido.
//
// POR QUÉ HACE FALTA: en Android una fuente propia no respeta `fontWeight`. Cada
// grosor es un fichero con su propio nombre de familia, así que este componente
// lee el `fontWeight` del estilo, elige el fichero (`fontFamilyForWeight`) y
// neutraliza el `fontWeight`, que con una familia propia en iOS o Android puede
// sintetizar una negrita falsa o caer en la fuente del sistema.
//
// HERENCIA: un <Text> anidado hereda el estilo del padre. Si el hijo, sin
// `fontWeight` propio, pusiera la familia Regular, rompería esa herencia y un
// trozo de una frase en negrita saldría fino. Por eso el grosor y la cursiva
// resueltos viajan por contexto y el hijo sólo los sustituye si los declara.
//
// Un estilo con `fontFamily` explícita (p. ej. 'monospace', o `fonts.logo`) se
// respeta tal cual, y sus hijos la heredan sin que este componente la pise.
import React, { createContext, forwardRef, useContext } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
} from 'react-native';
import type { TextInputProps, TextProps, TextStyle } from 'react-native';
import { fontFamilyForWeight, normalizeFontWeight, type LoadedWeight } from '../../theme/fonts';

type InheritedFont =
  | { kind: 'nunito'; weight: LoadedWeight; italic: boolean }
  | { kind: 'explicit' };

const InheritedFontContext = createContext<InheritedFont | null>(null);

function resolveFont(style: TextStyle, parent: InheritedFont | null): InheritedFont {
  if (style.fontFamily) return { kind: 'explicit' };
  // Sin grosor ni familia propios, el hijo de un texto con familia explícita
  // la hereda: no se le pone otra encima.
  if (parent?.kind === 'explicit' && style.fontWeight == null && style.fontStyle == null) {
    return parent;
  }
  const inherited = parent?.kind === 'nunito' ? parent : null;
  const weight = style.fontWeight != null ? normalizeFontWeight(style.fontWeight) : inherited?.weight ?? 400;
  const italic = style.fontStyle != null ? style.fontStyle === 'italic' : inherited?.italic ?? false;
  return { kind: 'nunito', weight, italic };
}

function fontOverride(font: InheritedFont): TextStyle | null {
  if (font.kind === 'explicit') return null;
  return {
    fontFamily: fontFamilyForWeight(font.weight, font.italic),
    fontWeight: 'normal',
    fontStyle: 'normal',
  };
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  const parent = useContext(InheritedFontContext);
  const font = resolveFont(StyleSheet.flatten(style) ?? {}, parent);
  return (
    <InheritedFontContext.Provider value={font}>
      <RNText ref={ref} {...rest} style={[style, fontOverride(font)]} />
    </InheritedFontContext.Provider>
  );
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...rest }, ref) {
  const font = resolveFont(StyleSheet.flatten(style) ?? {}, null);
  return <RNTextInput ref={ref} {...rest} style={[style, fontOverride(font)]} />;
});
