// El icono de la app (assets/images/brand/icon.png): el cuadrado azul marino
// con "AJT". Hace de logo en las pantallas de antes de entrar (bienvenida,
// intro, login, registro, contraseña olvidada).
//
// El PNG va a sangre, sin esquinas redondeadas (LEEME.md de la carpeta: iOS y
// Android las ponen solos al icono del sistema), así que dentro de la app las
// pone quien lo pinta con `radius`. Es decorativo: el nombre de la app va
// siempre al lado en texto.
import React from 'react';
import { Image } from 'react-native';

const APP_ICON = require('../../../assets/images/brand/icon.png');

export function AppIcon({ size, radius }: { size: number; radius: number }) {
  return (
    <Image
      source={APP_ICON}
      style={{ width: size, height: size, borderRadius: radius }}
      accessibilityIgnoresInvertColors
      testID="app-icon"
    />
  );
}
