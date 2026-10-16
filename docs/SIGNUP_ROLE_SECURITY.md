# Roles de registro: migración 102

La migración posterior 103 cierra los permisos de escritura de ofertas para
empresas no aprobadas. Ver [COMPANY_OFFER_WRITES.md](COMPANY_OFFER_WRITES.md).

Aplicada el 16 de octubre de 2026 al proyecto de desarrollo `rotoaxismatch-dev`
(`rwauwuremzkizeoginza`) mediante el endpoint de migraciones de Supabase.
Versión `20261016094602`, SQL md5 `6301f30f8a6c38cceedafcfb12d40225`;
SQL registrado idéntico al archivo `102_signup_role_guards.sql`.

## Qué cambia

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

## Admins de desarrollo

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

## Ofertas de empresas pendientes: hallazgo histórico de 102

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

## Reversión preparada, sin aplicar

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

## Pruebas

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
