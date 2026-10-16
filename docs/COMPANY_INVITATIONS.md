# Invitaciones al equipo de una empresa tras la 102

## Fallo

Desde la migración 102 (2026-10-16), el trigger de `auth.users` sólo acepta los
roles de alta `technician` y `company`. La función `invite-company-member`
(versión 8 desplegada, julio de 2026) invitaba a los emails nuevos con
`{ role: 'company_user' }`: la base rechazaba la cuenta (`22023 Invalid signup
role`) y el admin veía "The invitation could not be sent". Invitar a una cuenta
de empresa ya existente seguía funcionando. Comprobado el 2026-10-16 con una
sentencia anulada, sin cambiar nada; no había intentos reales en los registros
(la última invitación registrada es del 3 de julio).

## Arreglo (sólo la función, sin migración)

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

## Pruebas

- `npm run test:company-invitation` (en `npm test`, sin red): la petición
  completa con un backend simulado y las decisiones de la app en el primer
  inicio de sesión.
- `npm run test:company-invitation:database` (escribe en dev dentro de
  ROLLBACK): invitación y primer inicio de sesión con el rol que manda de verdad
  la función, 13/13; control negativo con `company_user`.

## Estado

Desplegada en dev como **versión 9** el 2026-10-16, con el OK del dueño, sin
cambiar `verify_jwt` (false, como la 8: la función comprueba la sesión ella
misma). Fuente del repo con saltos LF, md5 `05b6f15ba22c71a1fb3305dacee866b5`,
presente byte a byte en el mapa de fuentes del paquete desplegado (la 8 era el
blob de `HEAD`, md5 `f493b518fe2b4f3b29cc160203bb42b4`). Sin sesión: OPTIONS 200,
POST 401 ("Missing bearer token."), origen desconocido 403. Falta una invitación
real desde la app, que prueba el dueño.
