# PWA web de Aviation Job Talent

Implementación mínima: apertura independiente desde la pantalla de inicio, sin
service worker, modo sin conexión ni caché programada. Se mantiene la caché HTTP
normal del navegador. La barra del sistema (hora, batería y gestos) sigue visible.

## Archivos

- `public/manifest.webmanifest`: Aviation Job Talent / AJT, `standalone`, inicio y
  ámbito `/`, colores `#FFFFFF`.
- `public/icons/`: PNG de 192, 512 y 180 px derivados de `icon.png`; maskable de
  512 px derivado del lienzo completo de `adaptive-icon.png`, sobre `#03295B`.
  El logo cabe dentro del círculo seguro de radio 40 % del icono.
- `app/+html.tsx`: etiquetas comunes de todas las páginas web, manifest, icono
  de Apple, viewport con `viewport-fit=cover`, barra de estado `default` para
  iPhone, zonas seguras y ajuste de alto del iPhone instalado (ver abajo).
- `src/components/ui/TabBar.tsx`: `nativeID="ajt-tab-bar"`, para que el CSS del
  iPhone instalado ajuste el margen inferior de la barra de menú.
- `src/components/ui/Text.tsx` y `src/components/DateField.web.tsx`: letra de
  16 px en los campos y sin `autoFocus` en web (ver abajo).
- `src/components/AppSafeAreaProvider.web.tsx`: en el navegador conserva las
  zonas seguras globales en CSS y los insets interiores cero. En la PWA de iPhone,
  CSS reserva arriba y a los lados; abajo lo reserva la barra de pestañas o el
  `SafeAreaView` de la pantalla, dentro de su propio fondo.
- Los layouts de pestañas de empresa y técnico usan `TabSceneSafeArea`: sólo las
  escenas con barra visible reciben el inset inferior cero. La barra conserva
  el inset real. Los detalles abiertos encima y las vistas sin barra conservan
  su protección inferior aunque las pestañas sigan montadas detrás.
- `src/components/AppModal.web.tsx`: los portales recuperan el inset de pantalla,
  también al abrirse desde una pestaña. En la PWA de iPhone llegan al borde
  inferior y reservan el espacio dentro; los demás navegadores conservan los
  límites CSS anteriores y el selector de país conserva su `SafeAreaView` anterior.
- `src/components/AppSafeAreaProvider.tsx`: reexporta el proveedor original para
  iOS/Android nativos; el adaptador de escenas devuelve sus hijos sin modificarlos.
- `src/components/AppModal.ts`: reexporta el `Modal`, el `SafeAreaView` y el hook
  originales para las apps nativas.

Los originales de marca y la configuración nativa no se modifican. Para regenerar
los iconos se utiliza el procesamiento de imágenes ya incluido en Expo:

```sh
node scripts/generatePwaIcons.cjs
npm run ts
npx expo export --platform web
```

## Publicación e instalación

Publicar el contenido completo de `dist/` en la raíz de un dominio HTTPS. Servir
`/manifest.webmanifest` como `application/manifest+json` y los iconos como
`image/png`, sin redirigir esos recursos a una página HTML. Mantener el enrutado
de la exportación estática, incluidas `/auth/confirm` y `/auth/set-password`.

En iPhone: abrir en Safari, compartir y añadir a la pantalla de inicio. Cuando
aparezca la opción «Abrir como app web», dejarla activada. Abrir desde el icono
AJT. En Android: abrir en Chrome, menú y «Añadir a pantalla de inicio» /
«Instalar aplicación». El nombre de la opción depende de la versión de Chrome.

La instalación desde el menú de Chrome Android no requiere service worker.
No se añade un aviso propio de instalación.
[Referencia de Chrome](https://developer.chrome.com/blog/update-install-criteria).

## Inicio de sesión y correos en iPhone

La autenticación existente usa Supabase con `persistSession` y AsyncStorage
(localStorage en web). La PWA mantiene su propia sesión al cerrarse y abrirse,
mientras su almacenamiento siga disponible y la sesión siga siendo válida.
La sesión de Safari no se transfiere automáticamente a esta PWA: iOS 17.2 añadió
la copia de cookies al instalar, pero no copia localStorage. Hay que iniciar
sesión desde el icono AJT; iniciar o cerrar sesión en Safari no sincroniza esa
acción con la PWA. Borrar sus datos o reinstalarla puede exigir iniciar sesión de
nuevo. [Referencia de WebKit](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).

Los enlaces HTTPS del correo los gestiona iOS y el cliente de correo: pueden
abrirse en el navegador predeterminado o en un navegador integrado. Instalar esta
PWA o definir `scope: "/"` no garantiza que esos enlaces abran la PWA.
[Referencia de Apple sobre enlaces HTTP/HTTPS](https://developer.apple.com/documentation/xcode/preparing-your-app-to-be-the-default-browser).

Consecuencias del código actual, sin cambios de autenticación en esta tarea:

- **Confirmar email:** el enlace vuelve a `/auth/confirm` y esa pantalla establece
  la sesión en el navegador que recibió el enlace. La confirmación de la cuenta
  sí queda guardada en Supabase. Volver al icono AJT e iniciar sesión si hace falta;
  la sesión creada en el navegador no se transporta a la PWA.
- **Restablecer contraseña:** terminar el proceso en `/auth/set-password` dentro
  del navegador que abrió el correo; después volver a AJT e iniciar sesión con la
  nueva contraseña si se solicita. No se garantiza continuidad automática entre
  ambos contextos. Los enlaces con código PKCE también dependen del verificador
  guardado en el contexto que inició el proceso; si faltase, podría fallar el
  intercambio. La pantalla actual admite tokens, código y `token_hash`, pero no
  elimina esa restricción de PKCE.
  [Referencia de Supabase](https://supabase.com/docs/guides/auth/sessions/pkce-flow#limitations).
- `EXPO_PUBLIC_APP_URL` y las URLs permitidas en Supabase deben seguir apuntando
  al dominio publicado. El manifest no cambia las redirecciones de los correos.

## Colores y barra de estado

Las barras se ven como antes de la PWA, con el fondo de la app:

- Sin `theme-color` en `<head>` y sin color de fondo en `html` ni `body`: el
  navegador pinta su blanco por defecto, igual que antes de la PWA.
- `manifest.webmanifest`: `theme_color` y `background_color` en `#FFFFFF`, para la
  app instalada en Android.
- iPhone instalado: `apple-mobile-web-app-status-bar-style` en `default`. La barra
  de estado es clara, con la hora y la batería en oscuro, e iOS coloca la página
  debajo de ella; en vertical la zona segura superior vale 0.
- iOS suele conservar el estilo de barra de estado con el que se añadió el icono.
  Si tras un cambio sigue viéndose el anterior, borrar el icono AJT y añadirlo de
  nuevo desde Safari.

## Zonas seguras y borde inferior en iPhone instalado

En todos los navegadores, `app/+html.tsx` reserva las zonas seguras una sola vez
gracias a `viewport-fit=cover`: padding de `#root` y límites de los portales
modales con `env(safe-area-inset-*)`. `html` y `body` llevan `overflow: hidden`.

Un script del documento marca el iPhone instalado antes del primer pintado
(`data-ajt-iphone-pwa`), sólo si el dispositivo es un iPhone y
`navigator.standalone` o `display-mode: standalone` indica apertura instalada.
Con esa marca:

- **Alto.** La página termina exactamente en el borde inferior de lo visible
  (`window.innerHeight`). Se prueba en orden y se queda el primer paso que lo
  consigue: `calc(100% + env(safe-area-inset-top))` (con `default` la zona
  superior vale 0, así que equivale a `100%`), `100lvh` y, por último,
  `--app-height` con el valor de `window.innerHeight`. Se recalcula al cambiar el
  tamaño o girar el teléfono. `body` y `#root` heredan ese alto.
- **Borde inferior.** `#root` no lleva padding inferior global. La barra de menú
  (`#ajt-tab-bar`) llega al borde y usa `padding-bottom:
  env(safe-area-inset-bottom)`, así que sus botones quedan por encima de la raya
  de inicio. Las pantallas sin barra y los portales (`AppModal.web.tsx`) llegan
  también al borde y reservan ese espacio dentro de su propio fondo, una sola vez.
- En un iPhone instalado sin raya de inicio (zona inferior 0), la barra queda sin
  margen inferior en lugar de los 14 px que usa en el navegador.

Origen del problema: con `black-translucent` la página ocupaba también la zona de
la hora, iOS calculaba el `100%` sin esa zona y la barra de menú no llegaba al
borde inferior, dejando una franja azul marino debajo. WebKit tiene registrados
problemas de este tipo:
[reporte 236445](https://bugs.webkit.org/show_bug.cgi?id=236445) y
[reporte 254868](https://bugs.webkit.org/show_bug.cgi?id=254868). Con `default` la
página empieza debajo de la hora; por eso el objetivo del alto es lo visible y no
`screen.height`, que empujaría la barra de menú fuera de la pantalla.

## Zoom en los campos de texto (web)

Safari de iOS amplía la página al enfocar un campo con letra menor de 16 px.

- `src/components/ui/Text.tsx`: en web, el `TextInput` de la app sube la letra a
  16 px cuando es menor y conserva la altura de línea (la indicada o 20 px).
  También ignora `autoFocus` en web, para que ninguna pantalla abra el teclado ni
  amplíe la página al cargarse.
- `src/components/DateField.web.tsx`: el selector de fecha usa 16 px.

Las apps nativas no cambian.

## Comprobaciones (2026-10-15)

- `npm run ts` y `npx expo export --platform web` correctos: 81 páginas estáticas,
  sin `theme-color` ni azul marino en el documento y con el manifest en `#FFFFFF`.
- Manifest y cuatro iconos: HTTP 200, MIME y dimensiones correctos, sin
  transparencia. Chromium analiza el manifest sin errores de instalabilidad y sin
  service worker.
- Chromium, iPhone instalado simulado con `default` (pantalla de 852 px, 793
  visibles): `html`, `body` y `#root` terminan en 793 con el primer paso. Forzando
  el fallo de los dos primeros pasos, el último también deja la página en 793. En
  el navegador normal la geometría no cambia y el fondo queda sin color.
- iPhone real instalado, comprobado por el dueño: barra de estado clara con la
  hora en negro, la barra de menú llega al borde inferior y las medidas cuadran.

No se ha comprobado una instalación en un Android real.
