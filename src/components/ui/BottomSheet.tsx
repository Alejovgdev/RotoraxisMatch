// Hoja inferior del rediseño (respuesta 5 de la revisión; maqueta W-Team).
//
//   - Móvil: `Modal` de React Native, pegada abajo, sin arrastre. Se cierra con
//     un botón del contenido o tocando fuera (y con "atrás" en Android).
//   - Escritorio (≥ WIDE_BREAKPOINT): diálogo centrado, con una "✕" en la
//     cabecera (fase 8): algunos no tienen botón de cerrar en el contenido.
//   - Tablet: la hoja no pasa del ancho de la columna de móvil.
//
// La barrita de arriba es sólo visual: no se arrastra. El fondo oscuro no
// entra en el tabulador (ModalBackdrop).
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Text } from './Text';
import { ModalBackdrop } from './ModalBackdrop';
import { colors } from '../../theme';
import { dialogShadow, HOVER_BG, MOBILE_COLUMN, radius, TOUCH_TARGET, WIDE_BREAKPOINT } from '../../theme/ui';

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  dismissible = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Botones fijos al pie (no se desplazan con el contenido). */
  footer?: React.ReactNode;
  /** false mientras algo se está guardando: ni fuera ni "atrás" la cierran. */
  dismissible?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE_BREAKPOINT;
  const close = () => {
    if (dismissible) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView
        style={[styles.backdrop, wide ? styles.backdropWide : styles.backdropSheet]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ModalBackdrop onPress={close} />
        <View
          style={[
            wide ? styles.dialog : styles.sheet,
            wide ? dialogShadow : null,
            { maxHeight: Math.round(height * (wide ? 0.85 : 0.9)) },
            !wide && { paddingBottom: Math.max(insets.bottom, 24) },
          ]}
          accessibilityViewIsModal
        >
          {!wide ? <View style={styles.handle} /> : null}
          {wide ? (
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : null}
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable
                onPress={close}
                disabled={!dismissible}
                hitSlop={4}
                style={({ hovered }: any) => [styles.close, hovered && dismissible && styles.closeHover]}
                accessibilityRole="button"
                accessibilityLabel="Close"
                accessibilityState={{ disabled: !dismissible }}
              >
                <X color={dismissible ? colors.text : colors.disabledText} size={22} strokeWidth={2.2} />
              </Pressable>
            </View>
          ) : title ? (
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
          ) : null}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={wide}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  backdropSheet: {
    justifyContent: 'flex-end',
  },
  backdropWide: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: MOBILE_COLUMN,
    alignSelf: 'center',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.surface,
    paddingTop: 10,
    paddingHorizontal: 20,
    gap: 16,
  },
  dialog: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 22,
    backgroundColor: colors.surface,
    padding: 22,
    gap: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  header: {
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    // La "✕" se sale un poco hacia la esquina, para que el título siga
    // alineado con el contenido.
    marginTop: -8,
    marginRight: -10,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    paddingTop: 8,
  },
  close: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  closeHover: {
    backgroundColor: HOVER_BG,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  scroll: {
    flexGrow: 0,
  },
  content: {
    gap: 16,
  },
  footer: {
    gap: 10,
  },
});
