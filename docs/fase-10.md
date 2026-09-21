# Fase 10 — motores, autoridades y cierre

Rama `fase-10-motores-autoridades`. Funde la auditoría, los dos informes del
paso 5d y la revisión cruzada. Los identificadores H1–H16 son los de la
auditoría original y se conservan para poder referirse a ellos.

## 1. Hecho

Hallazgos corregidos:

- **H1** — reemplazos con pérdida de datos: habilitaciones, motores y la
  edición de oferta con sus aeronaves pasan por RPC transaccionales (082);
  los años se limitan a 0–70 en UI y en servidor.
- **H2** — añadir una credencial podía bajar la nota: `selectLicenseForOffer`
  elige por resultado efectivo de la oferta completa, una credencial por par.
- **H3** — habilitaciones fuera del alcance de la licencia: sólo B1.x, B2 y C,
  con producto y propulsión resueltos por `engine_id`; impuesto en cliente y
  en servidor (083), con avisos que nombran la habilitación.
- **H4** — cambio de participantes eludía elegibilidad: `offer_id`,
  `technician_id` y `company_id` inmutables para clientes (081).
- **H5** — oráculo de cualificaciones por el trigger: se autoriza antes de leer
  hechos privados; la RPC de hechos no es ejecutable por clientes (081).
- **H7** — CASA se trataba como licencia que caduca: FAA y CASA son perpetuas.
- **H8** — cobertura de categorías: B1.x cubre A.x de la misma autoridad; FAA A
  y P en filas separadas se proyectan como A&P sólo para matching.
- **H11** — texto de los escalones de motor: el componente motor no dicta el
  orden total.
- **H13** — la búsqueda seguía sin filtrar si fallaba el matching: ahora error
  visible con reintento, nunca resultados sin comprobar.
- **H14** — 064–085 documentadas como aplicación única.
- **H15** — RLS de cualificaciones más amplia que la del perfil: licencias,
  habilitaciones y motores alineados con visibilidad o relación existente (081);
  experiencia de aeronaves y tipos de perfil, lo mismo (085).
- **H16** — documentación y textos alineados con el código.

Migraciones aplicadas y registradas en `supabase_migrations.schema_migrations`:

- **081** `20260917071326` — participantes inmutables, autorización previa a
  hechos privados y RLS de cualificaciones por visibilidad o relación.
- **082** `20260917071907` — `replace_technician_habilitations`,
  `replace_technician_engines` y `update_offer_with_habilitations`
  transaccionales, SECURITY INVOKER.
- **083** `20260917150705` — alcance de los type ratings individuales, con
  trigger sobre habilitaciones y sobre cambios de su credencial.
- **084** `20260917173614` — `replace_technician_aircraft_experience`
  transaccional, SECURITY INVOKER.
- **085** `20260917173624` — las dos políticas de cualificación restantes
  (`tae_select_company`, `tpt_select_company`) alineadas con visibilidad o
  relación.

Verificado en la revisión cruzada: los tests distinguen el arreglo del fallo
(mutar el código compilado rompe el test correspondiente en H2, H3, H7 y H8);
las suites de base no dejan rastro en producción (cero triggers de prueba, cero
filas de prueba, la función privada intacta); ninguna pantalla actual se queda
sin datos por la RLS nueva.

## 2. Plan de cierre

**Sesión 1** (cerrada) — experiencia de aeronaves transaccional (084); H15 en
`tae_select_company` y `tpt_select_company` (085); el perfil se guarda aunque
falle el catálogo de motores; separar las suites de base del `npm test`
general; textos de UI nuevos al inglés.

Cierre de la sesión 1:

- **084 y 085 aplicadas y registradas** (17 septiembre 2026), tras ensayarlas
  con rollback y con confirmación explícita del usuario, mediante
  `apply_migration`. Verificado después: la RPC es SECURITY INVOKER con
  `search_path=public` y sin EXECUTE para `anon`; las dos políticas apuntan a
  `company_can_read_technician_qualifications` para `authenticated`; los
  recuentos de filas no cambiaron. `npm run test:db` pasa contra la base ya
  migrada — 29 regresiones más 412 controles de alcance — y no deja rastro.
- Reproducido antes de arreglar, en los dos casos: la experiencia en aeronaves
  se quedaba en cero tras un INSERT fallido, y sin la 085 un usuario de empresa
  leía 3 filas (1 experiencia de aeronave, 2 tipos de perfil) de un técnico
  bloqueado y sin relación.
- El guardado del perfil ya no depende del catálogo de motores salvo cuando la
  acción reescribe las habilitaciones.
- `npm test` ya no escribe en la base; `npm run test:db` es el que sí.
- Textos: el único literal de UI en castellano que queda es
  «Considerar otras autoridades» (`RequiredLicensesSection.tsx:87`), reservado
  para la sesión 2 junto con las equivalencias. Todo lo demás que parecía
  castellano eran comentarios, que van en castellano por convención.

**Sesión 2** (cerrada, migraciones aplicadas el 21 septiembre 2026) — ofertas FAA con
aeronaves como experiencia; licencia opcional en ofertas de motor (FAA P o A&P,
Part-66 B1.x); equivalencias por autoridad elegidas por la empresa.

Cierre de la sesión 2 (18 septiembre 2026), un commit por punto:

- **Punto 1, FAA con aeronaves** (`25b7ff2`, migración 086). Bajo la FAA la
  aeronave se compara sólo con la experiencia declarada, nunca con
  habilitaciones (mismo evaluador que las ofertas sin certificar, con una
  fuente menos). Puntúa y no excluye. Pesos nuevos
  `LICENSE_WITH_EXPERIENCE_WEIGHTS`: licencia 40 + experiencia 25; con la
  licencia y sin la aeronave, 75. El eje que topa a 39 es la licencia. Aviónica
  puede pedir FAA A o A&P. Las ofertas Part-66 no cambian. La 086 quita de
  `update_offer_with_habilitations` la cláusula que vaciaba las aeronaves FAA.
- **Punto 2, licencia opcional en motor** (`dd88b21`, migración 087). Sólo
  Part-66 B1.1–B1.4 o FAA P / A&P; B2, C y FAA A se rechazan en UI,
  repositorio, espejo y base. Pesos nuevos `ENGINE_WITH_LICENSE_WEIGHTS`: motor
  45 + licencia 20. La licencia puntúa y no topa: motor exacto sin licencia 80,
  licencia con motor sin relación 69 como mucho. La elegibilidad no cambia, así
  que el núcleo SQL de la 080 y su validador siguen igual.
- **Punto 3, equivalencias en lista** (`274b3f5`, migración 088).
  `offers.accepted_authorities` sustituye a `accepts_equivalent`. "Also accept
  licences from:" con las otras Part-66 que emiten la categoría; la FAA nunca
  aparece. Exacta 100, equivalente aceptada 87, no aceptada 35. Al cambiar la
  autoridad o el código se limpian las que ya no aplican. Sustituye también al
  último literal de UI en castellano («Considerar otras autoridades»).
- **086, 087 y 088 escritas y ensayadas con rollback**, en orden, sin aplicar:
  sus autocomprobaciones pasan, `testTransactionalWrites.sql` da 17/17 (la
  regresión nueva de la 086 falla sin ella), 13 pruebas extra de RPC y forma
  pasan, y el backfill de la 088 se probó marcando las 4 ofertas EASA. Después
  de cada ensayo, producción sin rastro (misma RPC, mismo CHECK de la 076, sin
  columna nueva, última migración registrada la 085).
- **086, 087 y 088 aplicadas el 21 septiembre 2026**, en orden, tras
  confirmación explícita, con `apply_migration`. Registradas como
  `20260921063655`, `20260921063718` y `20260921063811`; el md5 de
  `statements` coincide byte a byte con cada fichero. Sus autocomprobaciones
  pasaron al aplicarse. Después, `npm run test:db` en verde (412 casos H3, 13
  de seguridad, 17/17 transaccionales) y sin rastro: 0 ofertas `selftest-*`, 0
  triggers o funciones de prueba, 0 transacciones colgadas. El runner
  `testHabilitationScopeDatabase.cjs` seguía esperando 16 regresiones
  transaccionales; se corrigió a 17 (la de la 086). Backfill de la 088: las 8
  ofertas quedan con `accepted_authorities` vacía; ninguna tenía la casilla.

**Sesión 3** (cerrada; migraciones pendientes de confirmación) — separar
«genérico» de «inactivo» en el catálogo de motores; CFM56 y V2500 en variantes
con fuente oficial.

Cierre de la sesión 3 (21 septiembre 2026), un commit por punto:

- **Punto 1, genérico ≠ inactivo** (`5a3d698`, migración 089).
  `engines.is_generic`; las 17 «(model not specified)» pasan a genéricas y
  siguen inactivas. El scorer niega el motor exacto por `isGeneric`, nunca por
  `isActive`: desactivar un modelo concreto ya no rebaja a familia a quien lo
  tiene. `searchEngines` filtra las dos banderas. La elegibilidad no cambia
  (exacto y familia admiten los dos), así que el núcleo SQL de la 080 sigue
  igual. Mutar el scorer de vuelta a `isActive` rompe el test nuevo.
- **Punto 2, CFM56 y V2500 en variantes** (`1b3f4c3`, migración 090).
  CFM56-2/-3/-5A/-5B/-5C/-7B y V2500-A1/-A5/-D5/-E5, una fila por serie de
  TCDS de EASA (E.066, E.067, E.003, E.004, IM.E.069; el V2500-A1 por A.064).
  `CFM56` y `V2500` pasan a genéricas activas. Ratings de una sola variante
  enlazados a ella: 737NG → -7B, 737 Classic → -3, A340 → -5C, DC-8 → -2,
  MD-90 → -D5. A320 CFM y A320 IAE se quedan en la genérica (familia).
  Motores declarados y ofertas en CFM56/V2500: 0 y 0 (tampoco hay motores
  declarados ni ofertas de motor en toda la base); no se reasignan.
- **089 y 090 escritas y ensayadas con rollback**, en orden, sin aplicar:
  autocomprobaciones en verde; dos controles negativos (un rating sin mover,
  una genérica de más) fallan como deben; sobre ellas pasan
  `testApplicationSecurity` 13/13, `testTransactionalWrites` 17/17 y H3
  412/412. Después, producción sin rastro (164 motores, sin columna nueva,
  737NG en CFM56, última migración la 088).
- El código de la rama ya pide `engines.is_generic`:
  `validate:application-eligibility`, último paso de `npm test`, falla hasta
  aplicar la 089. Todo lo anterior de `npm test` y `npm run ts` en verde.

**Final** — pruebas manuales, ajustes sólo de los fallos encontrados, merge y
despliegue.

## 3. Pendientes (fuera de esta fase)

- Avisos de candidaturas cuando una oferta cambia sus requisitos.
- Rendimiento de la búsqueda.
- Paginación de relaciones (H12).
- Guardado del perfil completo en una sola transacción.
- Resto del catálogo de motores en variantes (sólo CFM56 y V2500 lo están).
- Relación rating ↔ varios motores: el A320 CFM (-5A/-5B) y el A320 IAE
  (-A1/-A5) sólo dan familia porque un rating tiene un único `engine_id`.
- La base no impide declarar ni pedir un motor genérico; sólo lo filtra el
  selector (`searchEngines`). Una oferta sobre una genérica no da exacto a
  nadie.
- Catálogo de licencias: B1.E, subcategorías L, B2L (H9).
- IA y Repairman de la FAA.
- Retirar `offers.accepts_equivalent` y su clave en
  `update_offer_with_habilitations` cuando el cliente de esta rama esté
  desplegado (fase contract de la 088; hoy no la lee ni la escribe nadie).
- El desglose del match rotula "Habilitation" una fila que en ofertas FAA y sin
  certificar mide experiencia declarada, no type ratings.

## 4. Avisos

- **Producción está rota hasta desplegar esta rama.** El cliente desplegado es
  el de `main`, que no conoce 073/074: `upsertLicenses` falla con 42P10 (el
  UNIQUE que nombra su `onConflict` ya no existe) y con 23502 (no manda
  `authority`), y `replaceHabilitations` borra y luego falla al insertar sin
  `technician_license_id`, dejando al técnico sin type ratings. No hace falta
  ninguna migración nueva: hace falta el despliegue.
- **064–085 son de aplicación única, en orden, y ya están todas aplicadas.**
  Sus postcondiciones dependen del estado de la primera aplicación. No
  reejecutarlas. No usar `supabase db push` ni `supabase migration repair` con
  el historial actual: los ficheros llevan prefijo numérico y el historial
  lleva timestamp, así que la CLI no casa ninguno y trataría de aplicarlos
  todos.
- **086, 087 y 088 están aplicadas** (21 septiembre 2026) y también son de
  aplicación única: no reejecutarlas. La base ya tiene `accepted_authorities`,
  así que esta rama lee ofertas contra ella. El cliente de `main` no la pide y
  sigue funcionando: la 088 no retira `accepts_equivalent`.
- **089 y 090 sin aplicar** (21 septiembre 2026): esperan confirmación
  explícita. Aplicar en orden, con `apply_migration`, y comprobar el md5 de
  `statements`. Son de aplicación única: sus post-condiciones cuentan el
  estado actual (17 genéricas, 164 motores, siete ratings en las agregadas).
- **`npm run test:db` escribe en producción**, dentro de transacciones que
  revierten. Inyecta triggers y reemplaza funciones mientras dura. No
  ejecutarlo en paralelo consigo mismo. `npm test` no lo incluye: se queda con
  las suites que no escriben, más los dos validadores, que sólo leen.

## 5. Estado de las sesiones

- Sesión 1: **cerrada**. 084 y 085 aplicadas y registradas.
- Sesión 2: **cerrada**. 086, 087 y 088 aplicadas y registradas.
- Sesión 3: **cerrada**. 089 y 090 escritas y ensayadas; pendientes de aplicar.
- Final: pendiente.
