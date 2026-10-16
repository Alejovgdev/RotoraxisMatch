# Edad mínima del técnico: 18 años

Migración `104_technician_minimum_age.sql`, aplicada el 16 de octubre de 2026 al
proyecto de desarrollo `rotoaxismatch-dev` (`rwauwuremzkizeoginza`) por el
endpoint de migraciones de Supabase. Versión `20261016110856`; SQL md5
`b7d972930e32c3ac9a50b153a5152986`; SQL registrado idéntico al archivo.

## Regla

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

## App

`src/auth/birthDateRules.ts` es la única regla del formulario de alta: fecha real
del calendario (rechaza 31/02), año desde 1930 como antes, no futura y 18 años.
La pantalla muestra "You must be at least 18 years old." bajo la fecha.
`npm run test:birth-date-rules` (en `npm test`) comprueba la regla y que los
casos de frontera son los mismos que los de la autoprueba SQL.

## Datos

Antes de aplicar: 9 técnicos, ninguno menor de 18. La migración comprueba los
perfiles existentes y para sin cambiar nada si alguno incumple; sin técnicos,
avisa y sigue.

## Pruebas y deshacer

`node scripts/rehearseTechnicianMinimumAge.cjs` (candidata) y `--installed`
(aplicada), todo con ROLLBACK: autoprueba 18/18 (10 de regla con fechas fijas y 8
de comportamiento con usuarios propios), alta 25, roles 40, ofertas 53, seguridad
23, escrituras 27, H3 412; base vacía y técnico menor ya guardado; 5 mutantes.

Deshacer (preparado, sin aplicar):
`supabase/rollbacks/104_technician_minimum_age.down.sql`. Quita la regla de la
base; no toca datos.
