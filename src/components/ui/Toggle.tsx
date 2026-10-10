// El interruptor del rediseño (maquetas W-Post4 y WFilters): pista azul
// encendido, gris apagado y pulgar siempre blanco.
//
// Es el `Switch` de React Native con los colores puestos. En web,
// react-native-web pinta el pulgar ENCENDIDO con `activeThumbColor` (por
// defecto verde azulado) e ignora `thumbColor`; esa prop no está en los tipos
// de React Native, así que se pasa sólo en web.
import React from 'react';
import { Platform, Switch } from 'react-native';
import { colors } from '../../theme';

const TRACK_OFF = '#C9D3DD';

export function Toggle({
  value,
  onChange,
  accessibilityLabel,
  disabled = false,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  const webThumb = Platform.OS === 'web' ? ({ activeThumbColor: colors.white } as object) : {};
  return (
    <Switch
      accessibilityLabel={accessibilityLabel}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ false: TRACK_OFF, true: colors.primary }}
      thumbColor={colors.white}
      {...webThumb}
    />
  );
}
