import { Alert, Platform } from 'react-native';

/**
 * Avisos y confirmaciones que funcionan EN LAS TRES PLATAFORMAS.
 *
 * ── Por qué existe esto ───────────────────────────────────────────────
 * `Alert` de react-native-web (0.21.2) es literalmente una función vacía:
 *
 *     class Alert { static alert() {} }
 *
 * En web, TODA llamada a `Alert.alert(...)` no hace absolutamente nada. Sin
 * error, sin log, sin diálogo. Consecuencias que esto tenía en la app:
 *
 *   - Confirmaciones destructivas ROTAS: "Withdraw application?" y
 *     "Close offer?" pasaban el trabajo real a `onPress` de un botón que en
 *     web nunca se dibuja. El usuario pulsaba y no pasaba NADA — ni la
 *     acción ni un mensaje. Es el bug que el usuario reportó.
 *   - Mensajes de éxito y de error TRAGADOS: la acción sí ocurría, pero
 *     "Application sent" o "Could not apply: <motivo>" no se veían nunca en
 *     web. Un fallo de red se veía igual que un éxito.
 *
 * Regla del proyecto derivada: **una acción que no puede completarse tiene
 * que decirlo**. Un `return` mudo o un aviso que no se renderiza son el
 * mismo bug con distinta cara.
 *
 * No usar `Alert` de react-native directamente en pantallas. Usar `notify()`
 * y `confirmAction()`.
 */

export interface WebNotice {
  title: string;
  message?: string;
}

let webNoticeHandler: ((notice: WebNotice) => void) | null = null;

/**
 * Web: la ventana de avisos de la app (NoticeHost, montada en la raíz) se
 * registra aquí para enseñar los de `notify()` (fase 8, decisión E). Devuelve
 * la función que la desregistra.
 */
export function setWebNoticeHandler(handler: (notice: WebNotice) => void): () => void {
  webNoticeHandler = handler;
  return () => {
    if (webNoticeHandler === handler) webNoticeHandler = null;
  };
}

/**
 * Mensaje informativo (éxito, error, acción no disponible). En web sale en la
 * ventana de la app, con el mismo título y texto; sólo si aún no está montada
 * (no debería pasar), en la del navegador. En nativo, `Alert.alert`.
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (webNoticeHandler) {
      webNoticeHandler({ title, message });
      return;
    }
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/**
 * Confirmación de dos opciones. Devuelve `true` si el usuario confirma.
 *
 * Devolver una promesa (en vez de recibir callbacks como `Alert.alert`) es
 * deliberado: el trabajo se escribe DESPUÉS del await, en el mismo handler,
 * en vez de dentro de un `onPress` anidado que en web nunca se ejecutaba.
 * Esa forma es la que hacía que el fallo fuese silencioso.
 */
export function confirmAction(options: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive } = options;

  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }

  return new Promise((resolve) => {
    // `settle` protege de resolver dos veces: en Android, `onDismiss` se
    // dispara TAMBIÉN después de pulsar un botón en algunas versiones.
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => settle(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => settle(true) },
      ],
      {
        // ANDROID: el botón atrás / tocar fuera cierra el diálogo SIN llamar
        // a ningún onPress. Sin esto la promesa se queda colgada para
        // siempre y el handler que la espera no continúa nunca — un cuelgue
        // silencioso, justo la clase de fallo que estamos eliminando.
        // `cancelable` + `onDismiss` solo tienen efecto en Android; en iOS
        // el diálogo no se puede descartar sin pulsar un botón.
        cancelable: true,
        onDismiss: () => settle(false),
      },
    );
  });
}
