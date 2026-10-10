// El fondo oscuro de una ventana (BottomSheet, ConfirmDialog, hojas del mapa):
// tocarlo la cierra.
//
// En web NO es un botón (fase 8). Como <button> invisible del tamaño de la
// pantalla era la primera parada del tabulador, y la ventana le daba el foco
// al abrirse. Aquí es un <div> que sólo escucha el clic: con el ratón se cierra
// igual, y con el teclado se cierra con Escape, la "✕" o "Cancel".
// En nativo sigue siendo un pulsable "Close" para el lector de pantalla.
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

export function ModalBackdrop({ onPress, style }: { onPress: () => void; style?: StyleProp<ViewStyle> }) {
  if (Platform.OS === 'web') {
    // `onClick` existe en react-native-web, no en los tipos de React Native.
    const webClick = { onClick: onPress } as object;
    return <View style={[StyleSheet.absoluteFill, style]} {...webClick} />;
  }
  return (
    <Pressable
      style={[StyleSheet.absoluteFill, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
    />
  );
}
