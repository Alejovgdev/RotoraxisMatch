// Pantalla de estado de auth ("Check your email", "Email confirmed"): el dibujo
// de la maqueta T-Done. Icono en un círculo de color, título grande, texto
// secundario y los botones en píldora abajo. En pantallas anchas el bloque
// entero va centrado, con los botones justo debajo del texto.
import React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Text } from '../ui/Text';
import { useDesktopScrollbar } from '../ui/useDesktopScrollbar';
import { colors, spacing } from '../../theme';

/**
 * `info`: el color de acción en suave. `success`: verde, sólo para algo hecho.
 * `attention`: ámbar, sólo para lo que requiere atención.
 */
export type AuthStatusTone = 'info' | 'success' | 'attention';

const TONES: Record<AuthStatusTone, { bg: string; fg: string }> = {
  info: { bg: colors.primarySoft, fg: colors.info },
  success: { bg: colors.successSoft, fg: colors.success },
  attention: { bg: colors.warningSoft, fg: colors.warning },
};

export function AuthStatusLayout({
  icon: Icon,
  tone,
  title,
  children,
  actions,
}: {
  icon: React.ComponentType<LucideProps>;
  tone: AuthStatusTone;
  title: string;
  /** El texto bajo el título. */
  children?: React.ReactNode;
  /** Los botones de abajo. */
  actions?: React.ReactNode;
}) {
  const desktopScrollbar = useDesktopScrollbar();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { bg, fg } = TONES[tone];

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        showsVerticalScrollIndicator={desktopScrollbar}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.content, isWide && styles.contentWide]}>
          <View style={[styles.iconCircle, { backgroundColor: bg }]}>
            <Icon color={fg} size={44} strokeWidth={2.4} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {children}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Un párrafo del cuerpo, con el estilo de la maqueta. */
export function AuthStatusText({
  children,
  tone = 'secondary',
}: {
  children: React.ReactNode;
  tone?: 'secondary' | 'muted' | 'error' | 'success';
}) {
  return <Text style={[styles.body, BODY_TONES[tone]]}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  scrollWide: { justifyContent: 'center' },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  contentWide: { flexGrow: 0 },
  iconCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    fontSize: 15.5,
    lineHeight: 23,
    textAlign: 'center',
  },
  actions: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: spacing.md,
    paddingBottom: 22,
  },
});

const BODY_TONES = StyleSheet.create({
  secondary: { color: colors.textSecondary },
  muted: { color: colors.textMuted, fontSize: 13.5, lineHeight: 20 },
  error: { color: colors.error, fontSize: 14, lineHeight: 20 },
  success: { color: colors.success, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
