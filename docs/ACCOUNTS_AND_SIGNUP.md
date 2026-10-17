# Altas, roles y cuentas (migraciones 101–105)

Cambios del 16 de octubre de 2026 en el proyecto de desarrollo `rotoaxismatch-dev`
(`rwauwuremzkizeoginza`). Eran seis documentos:
`TECHNICIAN_SIGNUP.md`, `SIGNUP_ROLE_SECURITY.md`, `COMPANY_INVITATIONS.md`, `COMPANY_OFFER_WRITES.md`, `TECHNICIAN_MINIMUM_AGE.md`, `COMPANY_ACCOUNT_DELETION.md`;
se juntaron aquí el 17 de octubre de 2026 sin cambiar su contenido. Las cuentas de
prueba para los revisores (migración 106) están en `docs/MODERATION.md`.

1. Alta automática de técnicos (migración 101)
2. Roles de registro: migración 102
3. Invitaciones al equipo de una empresa tras la 102 (función invite-company-member v9)
4. Ofertas: empresa aprobada obligatoria (migración 103)
5. Edad mínima del técnico: 18 años (migración 104)
6. Borrar la cuenta del último miembro de una empresa (migración 105)

## 1. Alta automática de técnicos

Cambio del 16 de octubre de 2026. Migración: `101_auto_approve_new_technicians.sql`.

Las correcciones posteriores de roles están en la sección 2 de este documento
(migración 102): registro limitado a `technician`/`company`, sin alta pública de
admins ni creación de empresas desde cuentas de técnico. El sello no cambia.

Aplicada al proyecto de desarrollo `rotoaxismatch-dev` (`rwauwuremzkizeoginza`)
mediante el endpoint de migraciones de la Management API. Versión registrada:
`20261016091746`; SQL registrado idéntico al archivo, md5
`93211bd7afd3cf6c8fe718381f46341c`. Las huellas de todas las tablas públicas y
usuarios de Auth confirman que la aplicación no modificó datos existentes;
solo cambiaron las dos funciones previstas. La reversión no está instalada.

### Comportamiento

- Una cuenta nueva con rol `technician` nace con `profiles.status = active`.
- El trigger de creación de su ficha fuerza `verification_status = verified`
  cuando la cuenta propietaria es un técnico activo. El cliente no elige ese estado.
- Las cuentas de empresa siguen pendientes y sus empresas siguen sin verificar.
- No hay ningún UPDATE de datos existentes. Los técnicos ya pendientes siguen
  pendientes, incluso si su ficha se crea después al confirmar el correo.
- Se mantienen los controles de acceso, la pantalla de espera, los guards de
  campos protegidos y los RPC de aprobación/rechazo del administrador.
- El alta del técnico termina en `/`: el inicio espera al perfil y decide el
  destino por su estado real. También funciona si se restaura la aprobación manual.
- Si Supabase exige confirmar el correo, ese paso sigue siendo obligatorio.
  Los dos caminos de creación de ficha usan el mismo `signup_technician`.

Los textos del alta, del selector de cuenta y la frase de las condiciones sobre
el acceso de técnicos reflejan el cambio. El consentimiento de nuevas cuentas
usa la versión `2026-10-16`; los consentimientos existentes no se modifican.

### Reversión preparada, sin instalar

`supabase/rollbacks/101_auto_approve_new_technicians.down.sql` restaura las dos
funciones de creación originales. Solo afecta a futuras altas: no suspende ni
modifica a los técnicos que ya estén activos. Está fuera de `migrations/` para
evitar que se ejecute junto con la migración de alta automática.

Para una reversión permanente, registrar esas definiciones como una migración
nueva mediante el endpoint de migraciones de Supabase. No borrar ni reejecutar
101, ni ejecutar `supabase db push` con el historial actual del proyecto.
Después de 102, no ejecutar esta reversión directamente: también quitaría la
validación de roles de `handle_new_user`. Recuperar la aprobación manual debe
conservar esa validación en una nueva migración específica.
Restaurar también los textos que anuncian acceso sin aprobación; la redirección
al inicio ya funciona con ambos comportamientos. La prueba de reversión se
ejecuta únicamente dentro de una transacción terminada en ROLLBACK.

### Revisión inicial de 101: hallazgos históricos

1. **El rol inicial procede del cliente.** `handle_new_user` usa
   `raw_user_meta_data.role` y mantiene el comportamiento anterior de asumir
   `technician` cuando falta. Un usuario puede elegir darse de alta como técnico.
   Cambiar después la metadata de Auth no cambia `profiles.role`; RLS y el guard
   de UPDATE impiden que un técnico se cambie directamente el rol almacenado.
2. **Existe una escalada a administrador previa a este cambio.** El trigger
   también acepta `role = admin`, y `is_admin()` solo comprueba ese rol, sin
   exigir una cuenta activa. La reproducción con usuarios temporales confirma
   que ese usuario puede incluso activarse mediante la política UPDATE de
   `profiles`. La ausencia de un botón de alta de administradores no protege
   la API. La migración 101 no corrige ni amplía la lista de roles aceptados.
3. **Hay una vía de acceso a operaciones de empresa desde un técnico activo.**
   `signup_company` solo exige autenticación, no rol de empresa. El técnico
   puede llamarlo, crear una empresa pendiente y ser su miembro administrador
   conservando su cuenta activa. La reproducción también consigue insertar una
   oferta para esa empresa a través de RLS, que usa cuenta activa y pertenencia,
   sin exigir empresa verificada. No necesita cambiar `profiles.role`. La UI
   conserva la separación por rol, pero esta vía se puede usar directamente
   contra la API. Era posible para técnicos aprobados antes de 101; las nuevas
   altas activas también pueden usarla.
4. **Las empresas ven un sello de verificación.** La búsqueda muestra un check
   verde y el detalle/candidaturas/ofertas directas muestran `Verified` desde
   `verification_status`. También existe el filtro `Verified only` y la
   verificación influye en el orden del mapa. Las nuevas altas tendrán estas
   señales aunque ningún administrador las haya revisado. No se ha cambiado
   el sello, su significado ni el proceso separado de revisión de documentos.
5. **El administrador sigue viendo y moderando las nuevas altas.** Aparecen en
   `All` y `Verified`, no en `Pending`. La acción existente `Reject` escribe
   `rejected` en la ficha y `suspended` en la cuenta, retirando el acceso. Puede
   volver a habilitarla con `Verify`. No se ha añadido un botón nuevo de bloqueo.

Los fallos de registro de admin y creación de empresa por técnico se corrigen
posteriormente con 102. La autorización de ofertas para una empresa pendiente
con cuenta activa se corrige con 103; ver la sección 4 de este documento.
Las reproducciones usan solo fixtures que se eliminan mediante ROLLBACK.

### Pruebas

```powershell
node scripts/testTechnicianSignup.cjs --rehearse # Antes de instalar 101
npm run test:technician-signup:database          # Con 101 instalada
npm run ts
npm run test:email-confirmation
```

Las pruebas SQL cubren altas por los triggers reales de Auth, estados iniciales,
empresas pendientes, confirmaciones tardías de cuentas pendientes, reintentos,
protección de roles/estados, acceso y rechazo/reaprobación por el administrador.
El ensayo añade tres controles negativos y verifica la reversión. También
ejecuta las 23 regresiones de seguridad y las 27 de escrituras transaccionales.
Comprueba las huellas de datos, usuarios de Auth, esquema e historial antes y
después: no deja usuarios ni cambios de prueba, ni envía correos.

Resultado verificado el 16 de octubre de 2026: ensayo y comprobación instalada
correctos (25 altas/acceso, 23 seguridad, 27 escrituras), tres controles negativos
y reversión correctos. `npm run ts`, las 18 pruebas de confirmación del correo
y la suite completa `npm test` también pasan.

Prueba manual con el cliente actualizado:

1. Registrar un técnico con un correo nuevo. Si se exige confirmación, abrir el
   enlace. Debe poder entrar a su área y editar el perfil sin aprobación.
2. En administración, encontrarlo en `All`/`Verified`, pulsar `Reject` y volver
   a iniciar sesión como ese técnico: debe quedar sin acceso a su área. `Verify`
   debe devolverle el acceso.
3. Registrar una empresa nueva: debe continuar en espera de aprobación.
4. Comprobar que un técnico pendiente anterior conserva su estado y solo entra
   después de la aprobación manual.
5. Consultar el nuevo técnico como empresa: tendrá la señal `Verified` actual.

No se ha publicado una versión del cliente como parte de este cambio.

## 2. Roles de registro: migración 102

La migración posterior 103 cierra los permisos de escritura de ofertas para
empresas no aprobadas. Ver la sección 4 de este documento.

Aplicada el 16 de octubre de 2026 al proyecto de desarrollo `rotoaxismatch-dev`
(`rwauwuremzkizeoginza`) mediante el endpoint de migraciones de Supabase.
Versión `20261016094602`, SQL md5 `6301f30f8a6c38cceedafcfb12d40225`;
SQL registrado idéntico al archivo `102_signup_role_guards.sql`.

### Qué cambia

- El trigger de `auth.users` acepta exactamente `technician` o `company` en
  `raw_user_meta_data.role`. Rechaza cualquier otro valor, incluido `admin`,
  `company_user`, rol ausente, vacío o nulo, con SQLSTATE `22023`. La transacción
  fallida no deja usuario de Auth ni perfil. No hay conversión por defecto.
- `company` es el nombre público del registro; se almacena como `company_user`,
  el enum interno ya utilizado por las políticas y la app. El formulario de
  empresa envía el nuevo nombre. Las sesiones de cuentas antiguas siguen
  reconociendo metadatos `company_user`.
- `signup_company` comprueba el rol **almacenado en `profiles`**, no los metadatos
  editables. Solo permite cuentas `company_user`. Un técnico, un admin o un
  usuario sin perfil recibe SQLSTATE `42501`, antes de crear empresa o miembro.
- Una nueva comprobación de INSERT impide crear una ficha técnica para una
  cuenta de otro rol, tanto por `signup_technician` como por escritura directa.
- No se modifican datos existentes. Se mantienen admins, cuentas pendientes,
  estados de la 101, controles de UPDATE y políticas de acceso.
- El trigger de verificación de la 101 y el sello **Verified** no cambian.

El cliente de empresa actualizado debe acompañar al backend: un cliente anterior
que intente un alta nueva enviando `company_user` será rechazado. Esto no impide
iniciar sesión ni completar fichas de cuentas ya creadas. No se ha publicado una
versión nueva del cliente como parte de este trabajo.

### Admins de desarrollo

La consulta antes y después encontró una única cuenta con `profiles.role=admin`,
estado `active`, creada el 3 de junio de 2026. Su identidad se ha entregado al
propietario en la conversación, sin incluir emails en documentación versionada.
La migración y las pruebas no modificaron esa cuenta ni el resto de usuarios.

Los nuevos admins se provisionan manualmente desde Supabase. El alta inicial de
Auth también pasa por el trigger: debe proporcionar primero un rol de registro
permitido. Antes del primer acceso, el operador asigna `admin` en `profiles` y
actualiza sus metadatos de Auth mediante SQL administrativo. No hay endpoint de
la app que conceda este rol, ni una excepción de registro basada en datos del
cliente. Ejemplo administrativo, **no ejecutado por estas migraciones**:

```sql
BEGIN;
UPDATE public.profiles SET role='admin', status='active'
WHERE id='<UUID de la cuenta creada por el operador>';
UPDATE auth.users SET raw_user_meta_data=jsonb_set(
  coalesce(raw_user_meta_data,'{}'::jsonb), '{role}', '"admin"'::jsonb)
WHERE id='<el mismo UUID>';
COMMIT;
```

### Ofertas de empresas pendientes: hallazgo histórico de 102

Hay dos estados diferentes:

| Cuenta (`profiles.status`) | Empresa (`verification_status`) | INSERT de oferta |
|---|---|---|
| `pending_verification` | `pending` | Denegado por RLS |
| `active` | `pending` | Permitido por la API si es miembro autorizado |

Se reprodujo antes del cambio y se volvió a comprobar con 102. El propietario
ha recibido el resultado antes de cualquier cambio de estos permisos. La 102 no
modifica políticas ni funciones de ofertas. En el segundo caso el RPC de edición
`update_offer_with_habilitations` falla su validación de referencia a la empresa
(`23503`), pero eso no impide el INSERT directo permitido por RLS.

Este hueco se corrige posteriormente con 103: una empresa pendiente o rechazada
no puede crear, editar ni publicar ofertas aunque la cuenta esté activa. El RPC
de edición ahora se deniega explícitamente por RLS (`42501`). Las pruebas de
roles distinguen la base histórica de los permisos actuales para seguir siendo
utilizables tras instalar 103.

### Reversión preparada, sin aplicar

`supabase/rollbacks/102_signup_role_guards.down.sql` elimina el nuevo guard y
restaura exactamente las definiciones anteriores de `handle_new_user` y
`signup_company`. No cambia usuarios ni estados. **Reabre los dos fallos**:
es una vuelta atrás de emergencia, probada solo dentro de ROLLBACK.
Para revertir permanentemente, registrar sus definiciones como una migración
nueva y devolver el cliente de empresa al nombre de registro anterior.

La reversión de 101 también reemplaza `handle_new_user`: no debe ejecutarse
directamente encima de 102, porque quitaría la lista de roles permitidos. Si se
quiere recuperar la aprobación manual conservando estas correcciones, preparar
una migración nueva que solo cambie los estados iniciales.

### Pruebas

```powershell
node scripts/testSignupRoles.cjs --rehearse # Solo antes de instalar 102
npm run test:signup-roles:database          # Con 102 instalada
npm run test:technician-signup:database
npm run ts
npm test
```

El ensayo reproduce primero la creación de admin y su autoactivación, y la
creación de empresa por técnico (18 comprobaciones de la base sin corrección).
Después verifica los rechazos y los flujos válidos con 102 (40 comprobaciones),
las 25 regresiones de alta de técnicos, 23 de seguridad y 27 de escrituras.
Tres controles negativos confirman que las pruebas detectan quitar cada guard.
La reversión restaura comportamiento y esquema originales. Las huellas de 35
tablas, usuarios Auth, esquema e historial quedan iguales tras las pruebas.
La aplicación permanente también conservó todos los datos y admins existentes.

Resultado final verificado el 16 de octubre de 2026: ensayo, reversión y pruebas
contra 102 instalada correctos; `npm run ts`, confirmación de correo (18/18) y
la suite completa `npm test` pasan. El comando independiente de regresión de
alta de técnicos también pasa con 101 y 102 instaladas.

Prueba manual con el cliente actualizado:

1. Registrar un técnico: sigue entrando sin aprobación y con estado verificado.
2. Registrar una empresa: debe crear una cuenta/ficha pendientes.
3. Desde un cliente de prueba contra Auth, intentar registrar con `role: admin`,
   sin rol o con un valor desconocido: falla y no aparece ningún usuario/perfil.
   Auth puede mostrar el error genérico de creación de usuario al envolver el
   error del trigger; la comprobación fiable es que no existe ninguna fila.
4. Con una sesión de técnico, llamar a `signup_company`: debe responder permiso
   denegado, también después de cambiar su metadata a `company`.
5. Con el admin existente, verificar/rechazar un técnico: sigue funcionando.

Las pruebas automatizadas usan fixtures transaccionales, no inicios de sesión
reales ni envíos de correo.

## 3. Invitaciones al equipo de una empresa tras la 102

### Fallo

Desde la migración 102 (2026-10-16), el trigger de `auth.users` sólo acepta los
roles de alta `technician` y `company`. La función `invite-company-member`
(versión 8 desplegada, julio de 2026) invitaba a los emails nuevos con
`{ role: 'company_user' }`: la base rechazaba la cuenta (`22023 Invalid signup
role`) y el admin veía "The invitation could not be sent". Invitar a una cuenta
de empresa ya existente seguía funcionando. Comprobado el 2026-10-16 con una
sentencia anulada, sin cambiar nada; no había intentos reales en los registros
(la última invitación registrada es del 3 de julio).

### Arreglo (sólo la función, sin migración)

- Al invitar a un email nuevo, `inviteUserByEmail` manda `{ role: 'company' }`.
  La base la guarda como `company_user` pendiente, como cualquier alta de
  empresa; la función la activa y la añade al equipo, como antes de la 102.
- Al reutilizar una cuenta de Auth sin perfil, acepta `company` y la antigua
  `company_user`; un técnico sigue rechazado.
- No cambia lo que hizo la 102: la base sigue rechazando `company_user`, `admin`
  y cualquier otro rol; un técnico nuevo entra activo y un alta de empresa queda
  pendiente de verificación.

Primer inicio de sesión del invitado: `ensureRoleProfile` encuentra su fila de
`company_members` y no llama a `signup_company`; su cuenta activa le lleva a
`/company`, a la empresa que le invitó. `signup_company` tampoco podría darle
otra (UNIQUE de `company_members.user_id`).

### Pruebas

- `npm run test:company-invitation` (en `npm test`, sin red): la petición
  completa con un backend simulado y las decisiones de la app en el primer
  inicio de sesión.
- `npm run test:company-invitation:database` (escribe en dev dentro de
  ROLLBACK): invitación y primer inicio de sesión con el rol que manda de verdad
  la función, 13/13; control negativo con `company_user`.

### Estado

Desplegada en dev como **versión 9** el 2026-10-16, con el OK del dueño, sin
cambiar `verify_jwt` (false, como la 8: la función comprueba la sesión ella
misma). Fuente del repo con saltos LF, md5 `05b6f15ba22c71a1fb3305dacee866b5`,
presente byte a byte en el mapa de fuentes del paquete desplegado (la 8 era el
blob de `HEAD`, md5 `f493b518fe2b4f3b29cc160203bb42b4`). Sin sesión: OPTIONS 200,
POST 401 ("Missing bearer token."), origen desconocido 403. Falta una invitación
real desde la app, que prueba el dueño.

## 4. Ofertas: empresa aprobada obligatoria

Migración `103_offer_writes_require_verified_company.sql`, aplicada el 16 de
octubre de 2026 al proyecto de desarrollo `rotoaxismatch-dev`
(`rwauwuremzkizeoginza`) por el endpoint de migraciones de Supabase.
Versión `20261016100620`; SQL md5 `9d2d579cff4c9d3d7b6b28cc850c6134`;
SQL registrado idéntico al archivo local.

### Regla

Una empresa está aprobada cuando `companies.verification_status='verified'`.
El estado activo de la cuenta que opera no sustituye la aprobación de la empresa.

Cinco políticas RLS restrictivas añaden esta condición a los permisos existentes:

- `offers`: INSERT y UPDATE, incluido cambiar a `published` y editar ofertas ya
  publicadas. UPDATE comprueba tanto la empresa original como la de destino:
  no se puede eludir la regla trasladando una oferta entre empresas.
- `offer_required_habilitations`: INSERT, UPDATE y DELETE, porque añadir,
  modificar o quitar requisitos también es editar una oferta. UPDATE comprueba
  el origen y el destino si se cambia la oferta a la que pertenece un requisito.

Son políticas restrictivas para `authenticated`: se combinan con todos los
permisos existentes, incluso las políticas `ALL` de administradores de la app.
No conceden permisos a viewers, personas ajenas ni cuentas suspendidas. La regla
de aprobación también se exige al admin de la app; el acceso administrativo
directo a Supabase sigue siendo privilegiado.

`update_offer_with_habilitations` ya es SECURITY INVOKER y respeta RLS: no se
ha reescrito. Con empresa pendiente o rechazada, sus operaciones de edición,
publicación y reemplazo de requisitos fallan con `42501`. Una escritura directa
UPDATE/DELETE filtrada por RLS puede devolver cero filas en lugar de un error;
las pruebas comprueban tanto filas afectadas como datos conservados.

### Datos y revisión de desarrollo

La consulta antes y después de aplicar 103 encontró **cero ofertas** de empresas
pendientes o rechazadas. No se borró, archivó ni modificó ninguna oferta.
Las huellas de todas las tablas públicas y usuarios Auth son idénticas antes y
después. No cambiaron funciones, triggers, políticas previas, cuentas ni empresas:
solo se añadieron las cinco políticas.

No se modifican las reglas de lectura ni de borrado de la oferta. Si una empresa
con ofertas existentes pierde la aprobación, sus ofertas conservan su estado y
su visibilidad anteriores; la empresa deja de poder editarlas/publicarlas hasta
recuperar la aprobación. No se ocultan ni se retiran automáticamente.

Los flujos de alta 101/102 y el sello Verified permanecen intactos. Este cambio
es exclusivamente de base de datos y no requiere publicar un cliente nuevo.

### Reversión preparada, sin aplicar

`supabase/rollbacks/103_offer_writes_require_verified_company.down.sql` elimina
únicamente estas cinco políticas. Restaura los permisos anteriores sin cambiar
datos, pero reabre el hueco. Está fuera de `migrations/` y solo se ha ensayado
dentro de una transacción terminada en ROLLBACK.

Para revertir permanentemente, registrar esas sentencias como una migración
nueva. No borrar ni reejecutar 103 ni ejecutar `supabase db push` con el historial
actual del proyecto.

### Pruebas

```powershell
node scripts/testCompanyOfferWrites.cjs --rehearse # Solo antes de instalar 103
npm run test:company-offer-writes:database          # Con 103 instalada
npm run test:signup-roles:database
npm run ts
npm test
npm run test:db
```

El ensayo ejecuta primero 49 comprobaciones sobre la base sin corregir y
reproduce los INSERT, UPDATE/publicación y cambios de requisitos permitidos.
Con 103, 53 comprobaciones cubren empresas pendientes/rechazadas con cuentas
activas, escrituras directas y RPC, admins de la app, requisitos, cambios de
empresa y controles positivos para empresas aprobadas. Verifica que cada
intento rechazado conserva las ofertas/requisitos existentes completos.

También ejecuta las 40 pruebas de roles, 25 de alta de técnicos, 23 de seguridad
y 27 de escrituras. Seis controles negativos detectan eliminar cada política o
quitar la comprobación de empresa destino. La reversión restaura exactamente
esquema y permisos anteriores. Las huellas de 35 tablas, Auth, esquema e historial
quedan iguales después de los ensayos; no hay sesiones reales ni correos.

Resultado final del 16 de octubre de 2026: ensayo y comprobaciones contra 103
instalada correctos; TypeScript, suite completa `npm test` y `npm run test:db`
correctos, incluidos los 412 casos H3. Seis controles negativos y reversión
correctos. La reversión no está instalada.

Prueba manual, preferiblemente con las fixtures transaccionales del comando:

1. Mantener activa una cuenta de empresa, pero dejar su empresa en `pending` o
   `rejected`: crear una oferta debe fallar.
2. Con una oferta de prueba ya existente de esa empresa, intentar editarla,
   publicarla o cambiar sus requisitos: debe fallar o afectar cero filas,
   conservando todos los datos.
3. Aprobar la empresa (`verified`), manteniendo una cuenta activa y rol autorizado:
   crear, editar y publicar vuelve a funcionar.

No se debe usar una oferta real para probar cambios de estado. El comando de
base de datos crea sus propias fixtures y deshace todo al finalizar.

## 5. Edad mínima del técnico: 18 años

Migración `104_technician_minimum_age.sql`, aplicada el 16 de octubre de 2026 al
proyecto de desarrollo `rotoaxismatch-dev` (`rwauwuremzkizeoginza`) por el
endpoint de migraciones de Supabase. Versión `20261016110856`; SQL md5
`b7d972930e32c3ac9a50b153a5152986`; SQL registrado idéntico al archivo.

### Regla

- Un perfil de técnico no puede guardar una fecha de nacimiento de alguien menor
  de 18 años: ni al darse de alta (`signup_technician` o INSERT directo) ni al
  cambiarla después, tampoco un admin o `service_role`. Lo impone el trigger
  `enforce_technician_minimum_age` (BEFORE INSERT OR UPDATE OF `birth_date`),
  con SQLSTATE `23514` y DETAIL `under_minimum_age`.
- "18 cumplidos" es `fecha <= hoy - 18 años`, en `meets_minimum_technician_age`
  (inmutable). Quien nace un 29 de febrero los cumple el 1 de marzo en años no
  bisiestos.
- "Hoy" es el día en **UTC**, en la base y en el formulario, para que nunca
  discrepen. En España, quien cumple 18 hoy puede tener que esperar hasta las
  02:00 (hora de verano).
- Editar otros campos no vuelve a mirar la edad. La lápida del borrado de cuenta
  (`birth_date = '1900-01-01'`) sigue pasando.

### App

`src/auth/birthDateRules.ts` es la única regla del formulario de alta: fecha real
del calendario (rechaza 31/02), año desde 1930 como antes, no futura y 18 años.
La pantalla muestra "You must be at least 18 years old." bajo la fecha.
`npm run test:birth-date-rules` (en `npm test`) comprueba la regla y que los
casos de frontera son los mismos que los de la autoprueba SQL.

### Datos

Antes de aplicar: 9 técnicos, ninguno menor de 18. La migración comprueba los
perfiles existentes y para sin cambiar nada si alguno incumple; sin técnicos,
avisa y sigue.

### Pruebas y deshacer

`node scripts/rehearseTechnicianMinimumAge.cjs` (candidata) y `--installed`
(aplicada), todo con ROLLBACK: autoprueba 18/18 (10 de regla con fechas fijas y 8
de comportamiento con usuarios propios), alta 25, roles 40, ofertas 53, seguridad
23, escrituras 27, H3 412; base vacía y técnico menor ya guardado; 5 mutantes.

Deshacer (preparado, sin aplicar):
`supabase/rollbacks/104_technician_minimum_age.down.sql`. Quita la regla de la
base; no toca datos.

## 6. Borrar la cuenta del último miembro de una empresa

Migración `105_delete_company_with_last_member.sql`, aplicada el 16 de octubre de
2026 al proyecto de desarrollo `rotoaxismatch-dev` (`rwauwuremzkizeoginza`) por el
endpoint de migraciones de Supabase. Versión `20261016120010`; SQL md5
`66af62839ef3d3553b7e78dae18304da`; SQL registrado idéntico al archivo.
Función `delete-account` versión 9 desplegada después, el mismo día, con
`verify_jwt` true: fuente del repo con saltos LF (md5
`da4d6be623e36beca5783daf178a897b`), presente byte a byte en el mapa de fuentes
del paquete desplegado. OPTIONS respondió 200 y un POST anónimo 401.

### Regla (decisiones del dueño, 2026-10-16)

- Al borrarse una cuenta de empresa, si no queda ningún miembro que haya entrado
  alguna vez, se borra la empresa con todo lo suyo, también para los técnicos:
  ofertas y requisitos, candidaturas, ofertas directas, chats (con los mensajes
  del técnico), bloqueos, registro de invitaciones, avisos de la empresa y los
  avisos del técnico sobre esas candidaturas, ofertas directas y chats.
- **Invitación pendiente** = miembro cuya cuenta nunca ha iniciado sesión
  (`auth.users.last_sign_in_at IS NULL`). No cuenta como miembro. Si la empresa
  se borra, se cancela: se borra esa cuenta de Auth (el enlace deja de servir y
  el email queda libre) y su perfil queda como lápida. Una cuenta que ya había
  entrado alguna vez y fue reinvitada sí cuenta; el admin puede quitarla desde
  Team.
- La regla vive en la base (`handle_deleted_user` →
  `close_company_without_members`): misma transacción que el borrado de la
  cuenta, y vale también si soporte borra al usuario desde Supabase.
- Con algún miembro que sí ha entrado, la empresa sigue. Que el único admin
  nombre otro antes de irse es regla de producto de `delete-account` (409), no
  de la base.
- No cambia: perfiles y documentos de técnicos. Las denuncias se conservan
  aunque el contenido denunciado desaparezca.

### Piezas

- `company_member_has_signed_in(user)`: qué es "haber entrado". Interna.
- `company_account_deletion_impact(user)`: qué pasaría al borrar esa cuenta
  (empresa, cifras, `deletes_company`, `must_assign_admin`). La piden la pantalla
  (el propio usuario) y `delete-account` (service_role); nadie la de otro.
- `close_company_without_members(company)`: interna, sin EXECUTE para clientes ni
  service_role.
- `guard_company_last_admin`: deja salir a los miembros de una empresa que se
  está borrando; en una empresa viva no cambia nada.
- `delete-account` v9: consulta el impacto; 409 si debe nombrar otro admin; si la
  empresa se va, borra su logo (carpeta `<company_id>/` de `company-logos`) ANTES
  de borrar la cuenta y no sigue si Storage no lo confirma.
- Pantalla `app/account/delete.tsx`: avisa antes con el nombre de la empresa y
  las cifras, enlaza a Team cuando hay que nombrar otro admin y no habilita el
  botón hasta saber qué pasa con la empresa
  (`src/utils/accountDeletionNotice.ts`, `accountDeletionRepository`).

### Pruebas y deshacer

`node scripts/rehearseCompanyAccountDeletion.cjs` (candidata) y `--installed`
(aplicada), todo con ROLLBACK: autoprueba 24/24 con usuarios de Auth propios
(funciona sin usuarios en la base; sin catálogos avisa y sigue), alta 25, roles
40, ofertas 53, seguridad 23, escrituras 27, imágenes 67, H3 412, autopruebas 100
(50) y 104 (18); 9 mutantes. `npm run test:company-account-deletion` (en
`npm test`) prueba avisos, pantalla y función sin red.

Deshacer (preparado, sin aplicar):
`supabase/rollbacks/105_delete_company_with_last_member.down.sql`. Antes hay que
volver a `delete-account` v8 (fuente en git `HEAD`, md5
`6bde497b132822599799b56100260aa9`). No recupera empresas ya borradas.

### Pendiente

- Textos (2026-10-16): la política de privacidad (retención de cuentas de
  empresa y §10, fecha `PRIVACY_POLICY_LAST_UPDATED` al 16 de octubre), los
  Términos de servicio (§10) y la página pública `/delete-account` (incluido el
  paso 5 con los dos textos del botón) explican la regla nueva.
  `LEGAL_CONSENT_VERSION` no se ha subido: se subirá cuando el asesor apruebe la
  versión final.
- Ningún técnico recibe aviso de que la empresa ha desaparecido.
