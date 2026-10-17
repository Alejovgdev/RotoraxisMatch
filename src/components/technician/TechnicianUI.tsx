import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { appUi } from '../../theme/ui';

// Los mismos tokens que la empresa (src/theme/ui.ts): el documento pide que
// las dos áreas compartan estilo. El nombre se conserva porque lo leen todas
// las pantallas del técnico.
export const techUi = appUi;

export function TechnicianScreen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={techStyles.safe}>
      <StatusBar style="dark" />
      {children}
    </SafeAreaView>
  );
}

export const techStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: techUi.page,
  },
});
