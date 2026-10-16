# Alta automática de técnicos

Cambio del 16 de octubre de 2026. Migración: `101_auto_approve_new_technicians.sql`.

Las correcciones posteriores de roles están en [SIGNUP_ROLE_SECURITY.md](SIGNUP_ROLE_SECURITY.md)
(migración 102): registro limitado a `technician`/`company`, sin alta pública de
admins ni creación de empresas desde cuentas de técnico. El sello no cambia.

Aplicada al proyecto de desarrollo `rotoaxismatch-dev` (`rwauwuremzkizeoginza`)
mediante el endpoint de migraciones de la Management API. Versión registrada:
`20261016091746`; SQL registrado idéntico al archivo, md5
`93211bd7afd3cf6c8fe718381f46341c`. Las huellas de todas las tablas públicas y
usuarios de Auth confirman que la aplicación no modificó datos existentes;
solo cambiaron las dos funciones previstas. La reversión no está instalada.

## Comportamiento

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

## Reversión preparada, sin instalar

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

## Revisión inicial de 101: hallazgos históricos

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
con cuenta activa se corrige con 103; ver [COMPANY_OFFER_WRITES.md](COMPANY_OFFER_WRITES.md).
Las reproducciones usan solo fixtures que se eliminan mediante ROLLBACK.

## Pruebas

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
