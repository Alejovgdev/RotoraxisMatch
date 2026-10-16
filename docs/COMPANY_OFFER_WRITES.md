# Ofertas: empresa aprobada obligatoria

Migración `103_offer_writes_require_verified_company.sql`, aplicada el 16 de
octubre de 2026 al proyecto de desarrollo `rotoaxismatch-dev`
(`rwauwuremzkizeoginza`) por el endpoint de migraciones de Supabase.
Versión `20261016100620`; SQL md5 `9d2d579cff4c9d3d7b6b28cc850c6134`;
SQL registrado idéntico al archivo local.

## Regla

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

## Datos y revisión de desarrollo

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

## Reversión preparada, sin aplicar

`supabase/rollbacks/103_offer_writes_require_verified_company.down.sql` elimina
únicamente estas cinco políticas. Restaura los permisos anteriores sin cambiar
datos, pero reabre el hueco. Está fuera de `migrations/` y solo se ha ensayado
dentro de una transacción terminada en ROLLBACK.

Para revertir permanentemente, registrar esas sentencias como una migración
nueva. No borrar ni reejecutar 103 ni ejecutar `supabase db push` con el historial
actual del proyecto.

## Pruebas

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
