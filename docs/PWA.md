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
- `src/components/AppSafeAreaProvider.web.tsx`: las zonas seguras se reservan una
  vez en CSS; las pantallas y barras interiores reciben insets cero para evitar
  márgenes duplicados. Los diálogos de React Native web, que usan portales fuera
  de `#root`, reciben los mismos límites seguros mediante `aria-modal`.
- `src/components/AppSafeAreaProvider.tsx`: reexporta el proveedor original para
  iOS/Android nativos. La raíz sólo cambia la ruta de importación del proveedor.

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
