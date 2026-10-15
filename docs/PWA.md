# PWA web de Aviation Job Talent

Implementación mínima: apertura independiente desde la pantalla de inicio, sin
service worker, modo sin conexión ni caché programada. Se mantiene la caché HTTP
normal del navegador. La barra del sistema (hora, batería y gestos) sigue visible.

## Archivos

- `public/manifest.webmanifest`: Aviation Job Talent / AJT, `standalone`, inicio y
  ámbito `/`, colores `#03295B`.
- `public/icons/`: PNG de 192, 512 y 180 px derivados de `icon.png`; maskable de
  512 px derivado del lienzo completo de `adaptive-icon.png`, sobre `#03295B`.
  El logo cabe dentro del círculo seguro de radio 40 % del icono.
- `app/+html.tsx`: etiquetas comunes de todas las páginas web, manifest, icono
  de Apple, viewport y `black-translucent` aprobado para iPhone.
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

## Comprobaciones realizadas (2026-10-15)

- TypeScript y `expo export --platform web` correctos: 81 páginas estáticas.
- Las 81 páginas se sirven por HTTP con un único viewport y las etiquetas PWA.
- Manifest y cuatro iconos: HTTP 200, MIME correcto, dimensiones correctas y
  contenido exportado idéntico a `public/`. Ningún icono tiene transparencia;
  el logo maskable permanece dentro del círculo seguro.
- Chromium analiza el manifest sin errores y devuelve cero errores de
  instalabilidad en localhost. Cero registros de service worker.
- Navegador: márgenes simulados de iPhone en vertical (59 px arriba, 34 abajo)
  y horizontal (59 a cada lado, 21 abajo), sin desbordamiento horizontal ni
  duplicación del margen superior. Comprobadas pantalla de acceso y ventana del
  selector de país, incluidos los portales de diálogos.
- Conservados los cambios previos: comparación de huellas de los archivos
  versionados; sólo cambia la importación en `app/_layout.tsx` durante esta tarea.

La simulación en Chromium no sustituye una instalación en iPhone/Android reales.
Queda comprobar allí el aspecto exacto de la barra del sistema, rotación y teclado,
y las pantallas con sesión iniciada. No se ha publicado la web ni se han ejecutado
flujos reales de autenticación o correos durante estas comprobaciones.

## Corrección del borde inferior en iPhone instalado (2026-10-15)

El diseño anterior aplicaba `safe-area-inset-bottom` como padding de `#root`:
levantaba toda la app, incluida la barra de pestañas, y descubría el fondo azul
marino del documento. Además, el reset de Expo fija `html`, `body` y `#root` al
`100%`. Si iOS calcula esa altura excluyendo la barra de estado, ambos huecos se
suman. Con 59 px de barra de estado y 34 px de zona segura inferior, son 93 px.
La simulación reproduce esa suma; no demuestra qué altura comunica el iPhone
del usuario. WebKit tiene registrados problemas de este tipo con `black-translucent`
y los insets de apps instaladas:
[reporte 236445](https://bugs.webkit.org/show_bug.cgi?id=236445) y
[reporte 254868](https://bugs.webkit.org/show_bug.cgi?id=254868).

Un script en el documento activa la corrección antes del primer pintado sólo si
el dispositivo es un iPhone y `navigator.standalone` o `display-mode: standalone`
indica apertura instalada. En ese caso `#root` usa `position: fixed; inset: 0;
height: auto`, sin padding inferior global. No calcula alturas con `innerHeight`
ni suma una altura de barra de estado. La barra existente usa el inset inferior
real, una sola vez; las pantallas sin barra lo aplican dentro de su fondo.

Validación local en Chromium mediante Playwright, con los proveedores,
`SafeAreaView`, `TabBar`, `Modal` y `BottomSheet` reales. Los insets se simulan en
CSS, incluida la sonda de la librería; se reduce deliberadamente en 59 px la
altura porcentual del documento para reproducir el caso descrito.

| Caso | Resultado medido |
| --- | --- |
| Diseño anterior, pantalla de 852 px | Barra termina en 759 px: franja de 93 px |
| PWA iPhone vertical, 59 px arriba y 34 abajo | Raíz y barra terminan en 852 px; fondo blanco en el último píxel; padding inferior de barra 34 px y de escena 0 |
| Pantalla sin barra, con pestañas ocultas detrás | Fondo hasta 852 px; último control hasta 818 px; inset de 34 px una vez |
| Navegador de pestañas sin barra visible | Fondo hasta 852 px; inset inferior de 34 px |
| Modal y hoja inferior abiertos desde una pestaña | Fondo hasta 852 px; contenido protegido por 34 px una vez |
| Rotación en la misma página, 852 × 393 px | Barra hasta 393 px; padding inferior 21 px; laterales protegidos por 59 px |
| iPhone pequeño, 375 × 667 px, inset inferior cero | Barra hasta 667 px; conserva los 14 px de espaciado de diseño |
| iPhone en navegador, Android instalado, iPad instalado y escritorio | Geometría idéntica al diseño anterior; corrección desactivada |
| Detección mediante `display-mode: standalone` | Corrección activada aunque `navigator.standalone` sea falso |
| `/auth/login` de la exportación Expo, después de hidratar | Fondo hasta 852 px; arriba 59 px y abajo 34 px; último píxel blanco |

Sin desbordamiento horizontal ni errores de JavaScript en estos casos. Capturas
e informe locales en `.tmp-pwa-check/`, ignorado por Git. Comprobaciones correctas:
`npm run ts`, `npx expo export --platform web` (81 páginas),
`test:company-nav`, `test:technician-nav`, `test:location`, `test:web-notices`
y `check:nested-buttons`.

Esto verifica el reparto del espacio y el alcance de la corrección en componentes
reales, además de la pantalla de acceso exportada. No reproduce el compositor de
iOS, la barra del sistema ni el teclado real; las pantallas autenticadas se prueban
mediante una composición local de componentes, sin iniciar sesión ni escribir en
el backend. Queda comprobar una instalación real en iPhone, especialmente teclado,
rotación y reapertura desde el icono. No se ha publicado ni hecho commit.
