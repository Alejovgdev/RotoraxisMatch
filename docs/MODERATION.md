# Moderación: denuncias, bloqueos y qué puede hacer el admin

Lo mínimo para la norma 1.2 de App Store y la política de contenido de usuarios de
Google Play (2026-10-15). Migración `100_reports_and_blocks.sql`. No hay panel de
denuncias: todo lo de esta guía se hace con los botones de admin que ya existen o
desde el panel de Supabase (Table editor o SQL editor) del proyecto que toque.

## Qué tiene la app

**Denunciar** un perfil de técnico, una oferta o un mensaje del chat, con uno de
cinco motivos: `offensive`, `harassment`, `spam_scam`, `misleading`, `other`.

| Quién | Dónde |
|---|---|
| Empresa (admin, recruiter y viewer) | "⋯" en la ficha del técnico y en la candidatura → *Report profile* |
| Técnico | "⋯" en la página de la oferta y en el detalle de una oferta directa → *Report offer* |
| Los dos | Chat: mantener pulsado un mensaje de la otra parte (iOS/Android) o la banderita junto a la hora (web) → *Report message* |

La denuncia se guarda en `content_reports`. Sólo la ve el admin. La misma persona
no duplica la denuncia del mismo contenido.

**Bloquear** entre un técnico y una empresa. El técnico bloquea a la empresa
entera; por la empresa bloquean el admin y el recruiter (el viewer sólo denuncia),
y el bloqueo vale para toda la empresa. Mientras exista, en los dos sentidos:

- el chat entre ellos desaparece para los dos y nadie puede escribir;
- no se pueden enviar ni aceptar candidaturas ni ofertas directas entre ellos
  (re-aplicar tampoco). Retirar y rechazar siguen funcionando.

No oculta nada en la búsqueda, el mapa ni las listas de ofertas. No borra nada: al
quitar el bloqueo, el chat vuelve como estaba. Se guarda en `contact_blocks`.

## Ver las denuncias

**Hasta activar el aviso por correo, nadie recibe nada: hay que mirar la tabla.**

```sql
-- Denuncias, las más nuevas primero, con lo denunciado tal como está ahora.
SELECT r.created_at, r.id AS report_id, r.target_type, r.reason, r.notified_at,
       p.email AS reporter_email, p.role AS reporter_role,
       CASE r.target_type
         WHEN 'chat_message' THEN (SELECT m.sender_role || ' ' || m.sender_user_id || ': ' || left(m.body, 300)
                                     FROM chat_messages m WHERE m.id = r.target_id)
         WHEN 'offer' THEN (SELECT o.title || ' [' || o.status || '] company ' || o.company_id
                              FROM offers o WHERE o.id = r.target_id)
         ELSE (SELECT t.anonymous_code || ' user ' || t.user_id
                 FROM technician_profiles t WHERE t.id = r.target_id)
       END AS reported,
       r.target_id
  FROM content_reports r
  LEFT JOIN profiles p ON p.id = r.reporter_user_id
 ORDER BY r.created_at DESC;
```

`reported` vacío significa que el contenido ya no existe.

## Qué puede hacer hoy el admin

| Para… | Cómo |
|---|---|
| Suspender a un técnico | App → Admin → Technicians → *Reject*. La cuenta pasa a `suspended`: pierde el acceso en su siguiente petición y desaparece de las búsquedas. Se deshace con *Verify*. |
| Suspender a cualquier usuario, también un recruiter o viewer concreto | SQL: `UPDATE profiles SET status = 'suspended' WHERE id = '<user id>';` Se deshace con `status = 'active'`. |
| Suspender una empresa entera | Admin → Companies → *Reject* (suspende a sus admins y la oculta a los técnicos), **más** suspender por SQL a sus recruiters y viewers, **más** cerrar sus ofertas publicadas (fila siguiente). Ver "Pendiente". |
| Quitar una oferta | Admin → Offers → *Close* o *Expire*. Deja de verse para los técnicos. |
| Quitar un mensaje del chat | SQL: `DELETE FROM chat_messages WHERE id = '<target_id>';` |
| Quitar la foto de un técnico | SQL: `UPDATE technician_profiles SET photo_path = NULL WHERE id = '<technician id>';` Deja de poder descargarse al momento; el archivo se borra a mano en Storage → `technician-photos`. |
| Quitar los enlaces de un técnico | SQL: `UPDATE technician_profiles SET social_links = NULL WHERE id = '<technician id>';` |
| Quitar el logo de una empresa | SQL: `UPDATE companies SET logo_path = NULL WHERE id = '<company id>';` y borrar el archivo en Storage → `company-logos`. |

Los `UPDATE` de `profiles.status` funcionan desde el SQL editor: la protección de
esa columna sólo frena a los usuarios de la app.

Ids útiles: el `user id` de quien escribió un mensaje es `chat_messages.sender_user_id`;
el de un técnico, `technician_profiles.user_id`; los miembros de una empresa están en
`company_members` (`company_id`, `user_id`, `role`).

## Quitar un bloqueo

En la app no se puede desbloquear. Si alguien lo pide a soporte, comprueba primero
que escribe la parte que bloqueó (el técnico, o un admin o recruiter de la empresa).

```sql
-- Ver los bloqueos de un técnico o de una empresa.
SELECT b.*, c.name AS company, t.anonymous_code AS technician
  FROM contact_blocks b
  JOIN companies c ON c.id = b.company_id
  JOIN technician_profiles t ON t.id = b.technician_id
 WHERE b.technician_id = '<technician id>' OR b.company_id = '<company id>';

-- Quitar el bloqueo que puso una de las partes ('technician' o 'company').
DELETE FROM contact_blocks
 WHERE technician_id = '<technician id>' AND company_id = '<company id>' AND blocked_by = '<technician|company>';
```

Si las dos partes se bloquearon, hay dos filas: con una sola, el bloqueo sigue.

## Cuentas de prueba para los revisores

Para las cuentas que piden Apple y Google: un técnico, una empresa y una cuenta
desechable para probar el borrado. Migración `106_test_accounts.sql`.

Una cuenta marcada (`profiles.is_test_account`) y las cuentas reales no se ven
entre sí, en ningún sentido: ni en la búsqueda y el mapa de técnicos, ni en los
técnicos de una oferta, ni en las ofertas publicadas (lista, mapa y detalle), ni
en las empresas. Las de prueba sí se ven entre ellas, así que el revisor ve la
app funcionando con los datos de prueba. Una empresa es de prueba si alguno de
sus miembros está marcado, y entonces todos sus miembros cuentan como de prueba
(también los que invite). El admin de la plataforma las sigue viendo todas.

La marca sólo se pone o se quita desde el SQL editor del panel de Supabase.
Desde la app no la cambia nadie: ni el propio usuario, ni el admin, ni las
funciones.

### Preparar las cuentas

1. Registrar cada cuenta en la app como un usuario normal y **marcarla nada más
   registrarla**, antes de completar el perfil o publicar nada:

   ```sql
   UPDATE public.profiles SET is_test_account = true
    WHERE email IN ('<técnico>', '<empresa>', '<desechable>');
   ```

   Un técnico recién registrado ya aparece en la búsqueda de las empresas reales
   (con los datos del registro) hasta que se marca. La empresa no se ve hasta que
   se verifica.
2. Verificar la empresa como cualquier otra: App → Admin → Companies → *Verify*.
3. Con la empresa de prueba, publicar una o dos ofertas que encajen con el
   técnico de prueba, para que el revisor vea búsqueda, matching y candidaturas.
   Si se quiere que la app se vea más llena, registrar y marcar más técnicos.
4. Poner los correos y contraseñas en App Store Connect (App Review Information →
   Sign-In Information) y en Google Play Console (App content → App access).

**No marcar cuentas que ya tengan candidaturas, ofertas directas o chats con
cuentas reales**: esas relaciones se siguen viendo por los dos lados.

### Ver cuáles están marcadas

```sql
SELECT p.email, p.role, p.status, c.name AS company,
       p.is_test_account AS marked, public.is_test_company(c.id) AS test_company
  FROM public.profiles p
  LEFT JOIN public.company_members m ON m.user_id = p.id
  LEFT JOIN public.companies c ON c.id = m.company_id
 WHERE p.is_test_account OR public.is_test_company(m.company_id)
 ORDER BY c.name NULLS FIRST, p.email;
```

`marked` false con `test_company` true es un miembro sin marca de una empresa de
prueba.

### Quitar la marca

```sql
UPDATE public.profiles SET is_test_account = false WHERE email = '<email>';
```

La cuenta vuelve a verse al momento. Una empresa sigue siendo de prueba mientras
le quede algún miembro marcado.

La cuenta desechable se borra desde la propia app (*Delete account*), sin quitarle
la marca. Si es de empresa y era su único miembro, la empresa se borra con ella
(migración 105). Para volver a probar el borrado, registrar otra cuenta y marcarla.

### Lo que no hace

- No impide una candidatura o una oferta directa entre una cuenta de prueba y una
  real: no hay forma de crearla porque no se ven, pero la base no lo bloquea.
- Los totales del panel de admin incluyen las cuentas de prueba.

## Activar el aviso por correo (cuando haya correo propio)

La función `supabase/functions/notify-report` está en el repo, sin desplegar. Manda
cada denuncia nueva a support@aviationjobtalent.com con Resend y marca
`content_reports.notified_at`.

1. En Resend, verificar el dominio del remitente.
2. Secrets del proyecto: `RESEND_API_KEY` y `REPORT_EMAIL_FROM` (por ejemplo
   `Aviation Job Talent <reports@aviationjobtalent.com>`). Opcional:
   `REPORT_EMAIL_TO` (por defecto support@aviationjobtalent.com).
3. Desplegar `notify-report` con `verify_jwt` activado. Si la web se sirve desde
   otro dominio, añadirlo a `ALLOWED_ORIGINS` de la función.
4. Poner `REPORT_EMAIL_NOTIFICATIONS_ENABLED = true` en
   `src/constants/moderation.ts` y publicar la app.
5. Las denuncias anteriores no se avisan solas: verlas con
   `SELECT * FROM content_reports WHERE notified_at IS NULL;`

## Pendiente, para después de publicar

- Una cuenta suspendida ve la pantalla "pending verification", con un texto que
  no explica que está suspendida.
- *Reject* de empresa sólo suspende a sus miembros admin: recruiters y viewers
  siguen activos, y sus ofertas publicadas siguen visibles para los técnicos.
  Hoy hay que completarlo a mano (tabla de arriba).

## ¿Verifica el admin a todos antes de que publiquen o chateen?

Comprobado el 2026-10-15 en la base de dev:

- **Sí, para todas las cuentas que se registran solas.** Técnicos y empresas nacen
  `pending_verification`. Sólo pasan a `active` cuando un admin los verifica
  (`admin_update_technician_verification`, `admin_update_company_verification`).
  Un usuario no puede cambiar su propio estado. Sin `active`, la base no les deja
  publicar ofertas, candidatarse, enviar ofertas directas, aceptar ni escribir en
  el chat.
- **No para los miembros invitados.** Un admin de una empresa ya verificada invita
  a recruiters y viewers, y la función `invite-company-member` los activa al
  momento, sin revisión de nuestro equipo.
- **Lo publicado después no se revisa antes de salir**: ofertas, mensajes, cartas
  de presentación, fotos, logos y enlaces se ven en cuanto se guardan. No hay
  filtro previo (decisión del 2026-10-15).
- Un técnico pendiente ya aparece en la búsqueda de empresas, pero sólo con los
  datos estructurados del registro. Su nombre, su foto y sus enlaces siguen
  ocultos, y no puede escribir nada que vean otros.

### Nota para el revisor de Apple (App Review Information → Notes)

> Aviation Job Talent is a B2B marketplace for aviation maintenance technicians and companies. New technician accounts become active on registration without manual admin approval. Company accounts are reviewed and verified manually by our team before gaining access to the platform. Additional company team members can only be invited by the administrator of an already verified company. Chat is only available between a technician and a company after one of them has accepted the other's application or direct offer.
>
> Users can report a profile, a job offer or an individual chat message (the "⋯" menu on profiles and offers; press and hold a message in the chat) and can block another user, which removes the conversation for both sides and stops further contact. Reports go to our moderation team, who act on them promptly by removing the content and suspending the account responsible. Our Terms of Service (section 6) state that there is zero tolerance for objectionable content and abusive users.
