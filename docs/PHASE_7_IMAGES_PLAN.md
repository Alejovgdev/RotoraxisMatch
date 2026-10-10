# Fase 7: fotos y logos

Preparado el 2026-10-09. **Paso 2 autorizado; migración 098 aplicada** después de
confirmar con el propietario que `rwauwuremzkizeoginza` es desarrollo.
Registro: `20261009094539`; md5 del SQL `19325dde24127874320c10429176ed93`.
No editar ni volver a aplicar 098. El ensayo original del paso 1 queda abajo.
Cliente implementado; verificaciones con sesión pendientes del propietario.
**`delete-account` desplegado como versión 8 el 2026-10-10** con el OK del propietario:
el fichero del repo tal cual (fotos, y recorrido de la carpeta propia para documentos
del 2026-08-14), `verify_jwt` true; fuente publicada idéntica al blob de git.
Mandan la petición de esta sesión, `UI_REDESIGN.md` §8 (4, 30 y 35) y `CLAUDE.md`.
Los cambios previos de la rama se conservan; no se ha hecho ningún commit.

## Estado del paso 2

- Aplicación por el endpoint oficial de migraciones de Management API, con
  comprobación del historial y coincidencia exacta del archivo. Ensayo sobre
  esquema instalado: 67 pruebas de imágenes, 23 de seguridad, 27 de escrituras y
  412 H3; rollback verificado, sin repetir 098.
- Selector compartido en You, Personal details y C-EditCompany; recorte nativo
  y previsualización cuadrada ajustable en web; reducción a 512 px antes de subir.
  Fotos JPEG y logos PNG; nombres aleatorios con `expo-crypto`. Guardado compara
  la ruta anterior, recupera respuestas perdidas y permite reintentar limpieza.
- Avatar común conectado a nombres visibles, con icono genérico para identidad
  bloqueada e iniciales al quitar. Descarga privada autenticada a memoria,
  separada por cuenta y descartada al cerrar sesión, incluso respuestas en curso.
- `npm run ts` y `npm test` pasan, incluido `check:nested-buttons` (308 archivos).
  Exportación Expo web, Android e iOS completada. Esto no sustituye las pruebas
  con sesión ni en dispositivo; el asistente no ha iniciado sesión.
- Corrección del HTTP 400 / `NoSuchKey`, aplicada el 2026-10-09 mediante **099**,
  registro `20261009152917`, md5 `ea6e448cc7e794da5e563f6d73e1bf7c`. Los logs
  reales mostraron la consulta previa `/object/info/authenticated/...`, operación
  `object.get_authenticated_info`, omitida en 098. El archivo sí existía (descarga
  administrativa 200, 29.139 bytes). Cambiar la URL del cliente no bastaba.
  La 099 permite GET-info y HEAD-info con los mismos permisos de identidad y
  propietario; mantiene bloqueados los enlaces firmados. No modifica 098.
  Ensayo previo e instalado: 67 casos originales y cuatro variantes de metadatos
  de 67 casos cada una, 23 seguridad, 27 escrituras y 412 H3; rollback verificado.
  Controles negativos: sin 099 se reproduce el fallo; habilitar firma lo detecta
  la prueba. `npm run ts` y `npm test` pasan. **Pendiente retest de pantalla por
  el propietario**, sin volver a subir la imagen. No se ha iniciado sesión.
  Comando de regresión: `node scripts/rehearseProfileImages.cjs --installed`.
  Los logs se obtuvieron por `analytics/endpoints/logs`, tabla `logs`, filtro
  `source='storage_logs'` y rango ISO explícito; `source_name` daba error backend.

## Almacenamiento y columnas

| Imagen | Bucket | Lectura | Columna nueva (nullable text) |
|---|---|---|---|
| Foto del técnico | `technician-photos` | Privada, autenticada, con RLS | `technician_profiles.photo_path` |
| Logo de empresa | `company-logos` | Pública, incluido quien conozca el enlace | `companies.logo_path` |

Se guarda la ruta del objeto, nunca una URL ni una URL firmada. Formato:
`<id técnico>/<uuid aleatorio>.jpg` y `<id empresa>/<uuid aleatorio>.png`.
Las rutas no contienen nombres, correos ni nombres de archivo originales.
JPEG para fotos; PNG para conservar transparencia en logos. Límite de Storage:
2 MiB por objeto y tipos MIME acotados a esos formatos. El cliente generará un
cuadrado de como máximo 512×512, sin ampliar originales pequeños, antes de subir.
Las restricciones de MIME/tamaño de Storage no son un análisis del contenido del
archivo; la recodificación normal se hace en el cliente.

## Protección

- La función **existente** `offer_accepted_between(my_company_id(), technician_id)`
  es la autoridad del nombre y de la foto. En el esquema instalado comprueba un
  `status = 'accepted'` en cualquiera de las dos tablas de relaciones. No añade
  banderas, tipos de contacto ni otra regla de aceptación.
- La vista conserva todas sus columnas, filtros y permisos; añade al final
  `CASE WHEN offer_accepted_between(my_company_id(),tp.id) THEN tp.photo_path ELSE NULL END`.
  La empresa sigue sin poder leer directamente `technician_profiles`.
- Storage permite leer la foto actual al técnico, al admin de plataforma activo
  y a la empresa que pasa esa misma función. El técnico debe conservar un perfil
  visible según el mismo filtro de estado que usa la vista. Una empresa bloqueada
  no accede, aunque exista aceptación. Recruiter y Viewer ven lo que su empresa
  tenga desbloqueado, igual que con el nombre.
- Solo el dueño activo sube o borra fotos de su carpeta. Puede leer y limpiar sus
  propias subidas todavía no elegidas. Las empresas solo descargan la foto actual:
  nunca ven las antiguas ni las subidas incompletas.
- La política SELECT filtra también la operación de Storage: admite descarga
  autenticada; bloquea firmar enlaces, firmar por lotes, renderizado firmado y
  copia. Esto se aplica también al dueño. Conocer o copiar la URL de descarga
  no concede acceso sin una sesión autorizada.
- Solo un **admin de esa empresa** puede subir, cambiar o quitar su logo. Se
  conserva también la facultad del admin de plataforma que ya existe sobre la
  empresa. Recruiter, Viewer, técnicos y admins de otra empresa quedan excluidos.
- CHECKs exigen rutas de la carpeta propia. Triggers exigen que el objeto exista
  antes de guardar la referencia y refuerzan quién puede cambiar cada columna.
- No se permiten sobrescrituras de objetos: cada cambio lleva UUID nuevo. Así no
  se recicla una dirección cuyo contenido pudiera quedar en caché.
- Al quitar una imagen se guarda NULL. La foto retirada deja de ser descargable
  por empresas inmediatamente después del guardado, aunque su borrado físico falle.
- Un trigger adicional limpia `photo_path` cuando la cuenta pasa a `deleted`,
  ampliando la lápida de la 039 sin reemplazar su función. En el paso 2 también
  debe ampliarse `delete-account` para borrar fotos mediante la API de Storage.
  No se borran objetos reales mediante SQL.

La migración es aditiva; no toca funciones de aceptación, ofertas, matching ni
políticas existentes. Su autoinspección comprueba los buckets y columnas vacías.

## Cliente previsto, solo después del OK

1. Aplicar 098 una sola vez mediante `apply_migration` o el endpoint oficial de
   migraciones de Management API, registrándola en el historial. No `db push`,
   SQL editor ni `execute_sql`. Verificar esquema e historial antes del cliente.
2. Instalar versiones compatibles de `expo-image-picker` y
   `expo-image-manipulator`. Recorte cuadrado en Android/iOS; en web añadir una
   previsualización con recorte cuadrado, porque `allowsEditing` no lo ofrece allí.
3. Subir el archivo reducido con un nombre nuevo, guardar la ruta, actualizar
   estado y limpiar el anterior por Storage API. Si falla guardar, mantener la
   imagen anterior y limpiar la subida nueva. Evitar dobles envíos y usar la ruta
   anterior como condición del guardado para detectar ediciones concurrentes.
4. Descargar fotos con sesión desde un repositorio, convertirlas en una fuente
   local para el `Avatar` común y mantener una caché solo en memoria por sesión y
   ruta. Limpiarla al salir/cambiar de cuenta y al cambiar/quitar la foto. No
   introducir URLs firmadas ni tokens en URLs. Reutilizar el fallback existente;
   revisar que un error de una imagen no impida mostrar otra nueva.
5. Técnico: tocar el avatar de You y cambiar desde Personal details. Empresa:
   `Change logo` en C-EditCompany, solo admin. Acciones subir/cambiar/quitar con
   estado de carga/error y cancelación sin cambios.
6. Pasar foto/logo por los repositorios, mappers y modelos adecuados hasta los
   avatares existentes. Foto únicamente donde se muestra el nombre; técnico
   bloqueado conserva icono genérico. Sin imagen e identidad visible: iniciales.
   Logo donde ya aparece el nombre de empresa. No añade fotos de miembros del equipo.
7. Cubrir las superficies de empresa ya auditadas: Home, búsqueda, contactos,
   mapa, candidatos de oferta, candidaturas, ofertas directas, perfil, Inbox/chat
   y hoja de envío. Cubrir logos en ofertas, solicitudes, Inbox/chat y empresa.
   No modificar `offerMatchExplain`, `matchPairs`, porcentajes ni envío de ofertas.

## Riesgos y límites

- Un archivo ya descargado o una captura no se puede recuperar del dispositivo
  de quien tenía permiso. Sí se impiden nuevas descargas sin permiso.
- Los logos son públicos: puede persistir una copia en navegador/CDN después de
  quitarlos. La app vuelve a iniciales al guardar NULL.
- Storage y la fila del perfil no comparten transacción HTTP. Las subidas fallidas
  o cierres de la app pueden dejar archivos huérfanos; usar limpieza compensatoria
  y errores recuperables. Una foto huérfana no queda visible para empresas.
- Las cuentas eliminadas fuera de `delete-account` pueden dejar bytes huérfanos,
  como ocurre con documentos; la BD elimina su referencia y deniega acceso.
- Recorte, formatos de entrada HEIC, permisos/cancelación y transporte real de
  archivos deben verificarse en los tres entornos. El ensayo SQL valida RLS y
  operaciones, no ejecuta el servidor HTTP de Storage ni el selector nativo.
- No se han probado pantallas con sesión ni en dispositivos; quedan para el
  propietario tras el paso 2, como ha pedido.

## Resultado del ensayo

Comandos ejecutados:

```
node scripts/rehearseProfileImages.cjs
node scripts/testProfileImageAvatar.cjs
npm run ts
npm test
```

- **67/67** comprobaciones SQL de imágenes: vista y Storage con ambas vías de
  aceptación, relación pendiente adicional, otra empresa, rutas conocidas,
  técnicos ajenos, operaciones de firma, roles, cambio/retirada, estados de cuenta
  y borrado real de auth dentro de la transacción revertida.
- **23/23** seguridad, **27/27** escrituras transaccionales, **412/412** H3, con
  la migración candidata presente solo dentro de cada transacción.
- **6/6 controles negativos** detectados: foto sin máscara en la vista, Storage
  sin aceptación, firma de URL permitida, recruiter con subida de logo, acceso a
  fotos retiradas y falta de limpieza al eliminar cuenta.
- **5/5** pruebas sin conexión del Avatar común actual: imagen, iniciales tras
  quitar foto/logo, icono genérico aunque lleguen nombre/URI, fallback tras error.
  No son todavía pruebas del futuro flujo de subida/borrado de la pantalla.
- `npm run ts`: verde. `npm test`: verde, incluido `check:nested-buttons`
  (304 archivos), identidad de empresa, contactos y validadores SQL de solo lectura.
- Comparación antes/después: **35 tablas**, incluidos usuarios de auth, metadatos
  de Storage e historial de migraciones, y columnas, funciones, vistas, políticas,
  triggers y constraints sin cambios. Todos los ensayos terminaron en ROLLBACK.
- Ninguna sesión de aplicación iniciada, ningún archivo real subido, ningún
  paquete instalado, ninguna pantalla cambiada. 098 sigue pendiente de aplicar.

## Pruebas del propietario después del paso 2

- Técnico en web/Android/iOS: subir, cancelar recorte, cambiar y quitar desde You
  y Personal details; recargar y comprobar foto/iniciales en ambos sitios.
- Empresa sin desbloqueo: icono genérico en todas las superficies y descarga
  rechazada aunque se conozca la ruta exacta. Probar también sin sesión.
- Empresa desbloqueada por candidatura y por oferta directa: foto donde está el
  nombre, incluyendo una nueva relación pendiente y Your contacts. Otra empresa
  permanece bloqueada. Copiar la URL no debe dar acceso a esa segunda cuenta.
- Admin de empresa: subir/cambiar/quitar logo y verificarlo en el lado técnico.
  Recruiter y Viewer no pueden modificarlo, ni siquiera llamando a la API.
- Cerrar/cambiar de cuenta: no arrastrar fotos de la sesión anterior. Quitar una
  imagen vuelve a iniciales; una identidad bloqueada sigue mostrando icono.

Referencias técnicas consultadas: [Storage y descargas autenticadas](https://supabase.com/docs/guides/storage/serving/downloads),
[operaciones en RLS](https://supabase.com/docs/guides/storage/schema/helper-functions),
[Expo ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/),
[Expo ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/).
