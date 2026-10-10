// La ventana de los avisos de `notify()` en web (fase 8, decisión E).
//
// `notify()` es una función suelta que llaman pantallas, paneles y tarjetas;
// en web pintaba la ventana gris del navegador (`window.alert`). Este
// componente, montado una vez en la raíz (app/_layout.tsx), se registra como
// destino de esos avisos y los enseña con la tarjeta de la app, con el mismo
// título y el mismo texto, en el mismo momento. Si llegan varios seguidos, se
// enseñan uno detrás de otro.
//
// En nativo no hace nada: allí `notify()` sigue siendo `Alert.alert`.
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { NoticeDialog } from './ConfirmDialog';
import { setWebNoticeHandler, type WebNotice } from '../../utils/platformAlert';

export function NoticeHost() {
  const [queue, setQueue] = useState<WebNotice[]>([]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    return setWebNoticeHandler((notice) => setQueue((current) => [...current, notice]));
  }, []);

  const current = queue[0] ?? null;
  // Se monta sólo con un aviso: react-native-web apila las ventanas por orden
  // de montaje, y así el aviso queda encima de la que lo provocó (p. ej. el
  // error de "Send direct offer" sobre su propia ventana).
  if (!current) return null;
  return (
    <NoticeDialog
      visible
      title={current.title}
      message={current.message}
      onClose={() => setQueue((rest) => rest.slice(1))}
    />
  );
}
