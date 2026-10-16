# Borrar la cuenta del último miembro de una empresa

Migración `105_delete_company_with_last_member.sql`, aplicada el 16 de octubre de
2026 al proyecto de desarrollo `rotoaxismatch-dev` (`rwauwuremzkizeoginza`) por el
endpoint de migraciones de Supabase. Versión `20261016120010`; SQL md5
`66af62839ef3d3553b7e78dae18304da`; SQL registrado idéntico al archivo.
Función `delete-account` versión 9 desplegada después, el mismo día, con
`verify_jwt` true: fuente del repo con saltos LF (md5
`da4d6be623e36beca5783daf178a897b`), presente byte a byte en el mapa de fuentes
del paquete desplegado. OPTIONS respondió 200 y un POST anónimo 401.

## Regla (decisiones del dueño, 2026-10-16)

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

## Piezas

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

## Pruebas y deshacer

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

## Pendiente

- Textos (2026-10-16): la política de privacidad (retención de cuentas de
  empresa y §10, fecha `PRIVACY_POLICY_LAST_UPDATED` al 16 de octubre), los
  Términos de servicio (§10) y la página pública `/delete-account` (incluido el
  paso 5 con los dos textos del botón) explican la regla nueva.
  `LEGAL_CONSENT_VERSION` no se ha subido: se subirá cuando el asesor apruebe la
  versión final.
- Ningún técnico recibe aviso de que la empresa ha desaparecido.
