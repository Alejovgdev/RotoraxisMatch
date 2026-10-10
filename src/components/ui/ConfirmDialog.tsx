// Diálogo de confirmación del rediseño (maquetas W-Candidate, C-DirectDetail,
// W-Offer, W-Team): tarjeta centrada sobre un velo, "Cancel" a la izquierda y
// la acción a la derecha. Igual en móvil y en escritorio.
//
// Sustituye en las pantallas rediseñadas a `confirmAction()` de
// src/utils/platformAlert.ts con LA MISMA FORMA: recibe título, mensaje y
// rótulos, y devuelve una promesa que se resuelve a true sólo si se confirma.
// El trabajo sigue escribiéndose después del `await`, en el mismo handler; lo
// único que cambia es el aspecto (en web, `window.confirm` pintaba el diálogo
// del navegador).
//
//   const { confirm, dialog } = useConfirmDialog();
//   if (!(await confirm({ title: 'Withdraw offer?', ... }))) return;
//   ...
//   return <>{pantalla}{dialog}</>;
//
// Tocar fuera, "atrás" en Android o "Cancel" resuelven a false: una promesa que
// nunca se resuelve dejaría el handler colgado sin decir nada.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { ModalBackdrop } from './ModalBackdrop';
import { colors } from '../../theme';
import { dialogShadow, TOUCH_TARGET } from '../../theme/ui';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** La acción en rojo (retirar, borrar, rechazar). */
  destructive?: boolean;
}

export function ConfirmDialog({
  visible,
  options,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  options: ConfirmOptions | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const title = options?.title ?? '';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <ModalBackdrop onPress={onCancel} />
        <View style={[styles.card, dialogShadow]} accessibilityRole="alert" accessibilityLabel={title} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          {options?.message ? <Text style={styles.message}>{options.message}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed, hovered }: any) => [styles.button, styles.cancel, (pressed || hovered) && styles.cancelPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>{options?.cancelLabel ?? 'Cancel'}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed, hovered }: any) => [
                styles.button,
                options?.destructive ? styles.danger : styles.primary,
                hovered && styles.confirmHover,
                pressed && styles.confirmPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.confirmText} numberOfLines={1}>{options?.confirmLabel ?? 'Confirm'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function useConfirmDialog(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOptions(null);
    resolve?.(value);
  }, []);

  // Una pantalla que se desmonta con el diálogo abierto no deja el handler
  // esperando para siempre.
  useEffect(() => () => {
    resolver.current?.(false);
    resolver.current = null;
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    // Dos confirmaciones a la vez no pueden convivir: la anterior se cancela.
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);

  const dialog = (
    <ConfirmDialog
      visible={options !== null}
      options={options}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, dialog };
}

/**
 * Un aviso con un solo botón, con la misma tarjeta que la confirmación. Es la
 * ventana de `notify()` en web (fase 8, decisión E; la monta NoticeHost): antes
 * salía la del navegador (`window.alert`). Escape, tocar fuera u "OK" la
 * cierran.
 */
export function NoticeDialog({
  visible,
  title,
  message,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <ModalBackdrop onPress={onClose} />
        <View style={[styles.card, dialogShadow]} accessibilityRole="alert" accessibilityLabel={title} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={[styles.actions, styles.actionsEnd]}>
            <Pressable
              onPress={onClose}
              style={({ pressed, hovered }: any) => [
                styles.button,
                styles.noticeButton,
                styles.primary,
                hovered && styles.confirmHover,
                pressed && styles.confirmPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.confirmText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionsEnd: {
    justifyContent: 'flex-end',
  },
  noticeButton: {
    flex: 0,
    minWidth: 120,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 22,
    backgroundColor: colors.surface,
    padding: 22,
    gap: 10,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: colors.text,
  },
  message: {
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  button: {
    flex: 1,
    minHeight: TOUCH_TARGET + 4,
    paddingHorizontal: 14,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  danger: {
    backgroundColor: colors.error,
  },
  confirmHover: {
    opacity: 0.92,
  },
  confirmPressed: {
    opacity: 0.85,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.white,
  },
});
