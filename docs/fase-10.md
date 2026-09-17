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

**Sesión 2** — ofertas FAA con aeronaves como experiencia; licencia opcional en
ofertas de motor (FAA P o A&P, Part-66 B1.x); equivalencias por autoridad
elegidas por la empresa.

**Sesión 3** — separar CFM56 en variantes y V2500 con fuente oficial; separar
«genérico» de «inactivo» en el catálogo de motores.

**Final** — pruebas manuales, ajustes sólo de los fallos encontrados, merge y
despliegue.

## 3. Pendientes (fuera de esta fase)

- Avisos de candidaturas cuando una oferta cambia sus requisitos.
- Rendimiento de la búsqueda.
- Paginación de relaciones (H12).
- Guardado del perfil completo en una sola transacción.
- Resto del catálogo de motores.
- Catálogo de licencias: B1.E, subcategorías L, B2L (H9).
- IA y Repairman de la FAA.

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
  todos. Del lado del esquema no queda nada pendiente en esta fase; lo que
  falta es el despliegue del cliente.
- **`npm run test:db` escribe en producción**, dentro de transacciones que
  revierten. Inyecta triggers y reemplaza funciones mientras dura. No
  ejecutarlo en paralelo consigo mismo. `npm test` no lo incluye: se queda con
  las suites que no escriben, más los dos validadores, que sólo leen.

## 5. Estado de las sesiones

- Sesión 1: **cerrada**. 084 y 085 aplicadas y registradas.
- Sesión 2: pendiente.
- Sesión 3: pendiente.
- Final: pendiente.
