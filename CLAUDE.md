# AviationJobTalent — Claude Context

> **V2 is the source of truth.** AviationJobTalent V2 is now the active product definition.
> Read `docs/PRODUCT_CONTEXT_V2.md`, `docs/DATA_MODEL_V2.md`, `docs/USER_FLOWS_V2.md`,
> `docs/SUPABASE_PLAN_V2.md`, and `docs/IMPLEMENTATION_PHASES_V2.md` before any major work.

AviationJobTalent is a cross-platform aviation technician matching app.

## Product

AviationJobTalent connects verified aviation mechanics/technicians with aviation companies, MROs, operators, airlines, contractors and recruiters.

The app must run on:
- Web
- Android
- iOS

## Stack

- Expo
- React Native
- TypeScript
- Expo Router
- Supabase (Postgres + Auth + Storage + Edge Functions) — the active backend, not a future migration target. `src/repositories/v2/*` query Supabase directly (`src/lib/supabase.ts`); real Supabase Auth is wired (`AuthContext`, `/auth/*` screens); RLS is enabled on every table.
- `supabase/migrations/*.sql` — 92 files, numbered `001`–`091` (the `014` slot is split into `0140`/`0141`). All of `001`–`091` are applied (see `docs/fase-10.md`). **064–091 are single-application migrations, not a replayable script set.** Never edit an already-applied migration; add a new one. Use Supabase MCP `apply_migration`, or the official Management API migration endpoint when MCP is unavailable, so the application is recorded in `supabase_migrations.schema_migrations`. Do not apply through the SQL editor or `execute_sql`. Transactional rehearsal queries must end in ROLLBACK.
  - **Fase 10 sesión 4, 2026-09-29:** 091 (engines belong to the Engine Technician type; offer kind derived from the technician type; eligibility path (a) retired) is applied and registered — `20260929094519` (md5 of `statements` byte-identical to the file). Rehearsed first inside rolled-back transactions — its self-test, five negative controls (the new suites without 091, four mutants of it), `testApplicationSecurity` 14/14, `testTransactionalWrites` 20/20, H3 scope 412/412, account deletion with and without it, and TS↔SQL parity 386/386 via `validate:application-eligibility -- --rehearse=…` — and applied after explicit user confirmation. Afterwards `npm test` is green (validator 386/386 against the installed core) and `npm run test:db` passes (14 + 20 regressions, H3 412) with no test residue. The app never calls `offer_eligibility_reason` (only the trigger and the validator do). `validate:application-eligibility -- --rehearse=<migration>` is the way to check TS↔SQL parity for a future migration that touches the core before applying it.
  - **Fase 10 sesión 3, 2026-09-21:** 089 (`engines.is_generic`) and 090 (CFM56/V2500 variants) are applied and registered — `20260921103422` and `20260921103512` (md5 of `statements` byte-identical to each file). Rehearsed first inside a rolled-back transaction (self-tests, two negative controls, `testApplicationSecurity` 13/13, `testTransactionalWrites` 17/17, H3 scope 412/412) and applied in order after explicit user confirmation. Afterwards: 174 engines, 19 generic, 17 inactive; `npm test` green, including `validate:application-eligibility`, and the other validators pass. Still no client release deployed.
  - **Fase 10 sesión 2, 2026-09-21:** 086–088 are applied and registered — `20260921063655`, `20260921063718` and `20260921063811` (md5 of `statements` byte-identical to each file). Rehearsed with rollback in the previous session and applied in order after explicit user confirmation; their self-tests passed, and `npm run test:db` passes afterwards (17/17 transactional regressions) with no test residue left. After the 088 backfill all 8 offers have an empty `accepted_authorities` (none had `accepts_equivalent`). Still no client release deployed.
  - **Fase 10 cierre, 2026-09-17:** 081–085 are applied and registered — `20260917071326`, `20260917071907`, `20260917150705`, `20260917173614` and `20260917173624`. Each was rehearsed inside a rolled-back transaction and applied only after explicit user confirmation. Installed functions, policies, triggers and rollback regressions verified afterwards. **No client release has been deployed by this work**, so production still runs `main`'s client — see the warning in `docs/fase-10.md`. Full history, plan and caveats live there.
  - **History repair, 2026-09-15.** `001`, `004`–`007` and `061`–`063` had been applied through the SQL editor, so they were live but missing from `schema_migrations`. They were registered by hand, each with its file's full SQL in `statements` (md5 byte-identical to the file), under versions that keep the order: `001`→`20260603000100`, `004`→`20260604000400`, `005`→`20260604000500`, `006`→`20260606000600`, `007`→`20260606000700`, `061`→`20260812120000`, `062`→`20260910120000`, `063`→`20260910120100`. Backup taken first: `supabase_migrations.schema_migrations_backup_20260915` (the 73 rows before the repair; drop it once nobody needs it). At the time of that repair, history had 81 rows, one per migration file (`020` counts as 9 batches).
  - ⚠ **Do not run `supabase db push` or `supabase migration repair` as-is.** The CLI matches a local file to the history by the filename prefix (`001`, `002`…), but every history version is a timestamp (`20260603112059`…). To the CLI, no local file matches any history row, so it would try to run all of them. Renaming the files to timestamps, or rewriting the versions, has to come first, and it is a separate decision. Supabase branching builds from the files on an empty database, so this does not affect it.
  - The local CLI link is stale: `supabase/.temp/project-ref` points to `duxcidflcecojublxmpx` (`rotoraxis-deploy-rehearsal-DELETEME`, already deleted), not to `rwauwuremzkizeoginza`. Relink deliberately before using the CLI. The 5d database tests successfully authenticate to the project derived from `EXPO_PUBLIC_SUPABASE_URL`; they prefer `SUPABASE_TEST_ACCESS_TOKEN`, then the `.env` token, then the inherited token.

`src/data/seeds/*.json` and its validator (`scripts/validateSeeds.js`) — pre-Supabase-phase legacy — were deleted 2026-07-27 (Fase 5.3, docs/MISSION_PART66.md): confirmed zero remaining consumers under `src/`/`app/`, and the validator had nothing left to validate once the JSON was gone.

Do not use yet:
- Firebase
- Stripe
- Paddle

## Core concept

Technicians create profiles with licenses, aircraft types, location, coordinates and availability.

Companies search technicians by:
- license
- aircraft type
- location
- availability
- verification status
- experience

Technician identity is private by default.

Companies can only see (contrato V2, alineado con `technician_public_view` y
`SafeTechnicianPreview` — esta lista era la de V1 y estaba desactualizada;
corregida 2026-07-29 tras la auditoría de cierre):
- anonymousCode
- technicianTypes (VARIOS desde la Fase 6 tanda A, migración 048: tabla puente
  `technician_profile_types`. La columna `technician_profiles.technician_type`
  sigue existiendo sin lectores, pendiente de retirada)
- country / city / baseAirport (+ latitude/longitude para el mapa)
- licenses (desde el paso 5b de la Fase 10, CREDENCIALES `{ authority, licenseCode }`
  — "EASA B1.1", "FAA A&P" —, no códigos sueltos: con cinco autoridades "B1.1"
  no dice cuál es)
- habilitations (type ratings EASA célula+motor; el V1 `aircraftTypes` era la
  familia suelta, sin motor)
- engines (Fase 10, paso 5b, migración 068: motores declarados, sólo de un
  Engine Technician desde la 091. Puntúan en ofertas de motor; los años son
  display-only)
- aircraftExperience (Fase 6 tanda B, migración 050: aeronaves en las que ha
  trabajado, CON O SIN licencia. Lista separada de `habilitations` — aquélla
  representa una habilitación declarada y ésta experiencia de trabajo. Desde
  la Tanda E SÍ aporta evidencia de aeronave en ofertas sin certificación,
  mediante `evaluateAircraftKnowledgeRequirement`, y desde la sesión 2 de la
  Fase 10 es la ÚNICA evidencia de aeronave en ofertas FAA. Los años no suman
  puntos)
- availability
- yearsExperience
- verificationStatus
- matchingScore (calculado por par oferta+técnico, nunca global)

`profileCompleteness` salió de esta lista el 2026-08-10: el porcentaje de
completitud se retiró del producto entero. Un número único sobre ejes
independientes obliga a repartir pesos entre cosas que no se comparan, y
bajaba cuando el técnico declaraba una licencia. Nunca fue un gate. Si hay que
señalar que falta algo, va una lista de "te falta esto", no un porcentaje.
La columna ya no existe: la borró la migración 049.

Companies must NOT see:
- fullName
- email
- phone
- socialLinks
- birthDate
- **age** — retirada del contrato público por decisión del 2026-07-29: es
  característica protegida en normativa laboral europea y mostrarla al
  empleador durante el cribado es riesgo de discriminación, además de
  incoherente con anonimizar el nombre para reducir sesgo. No aporta al
  cribado (licencias, ratings y años de experiencia ya cubren lo relevante).
  La retirada está implementada: migración 040, vista pública, tipos y UI.

Identity is revealed only when:

matchRequest.status === "accepted"
AND identityRevealed === true

El enforcer real es la base de datos, no el TypeScript: `technician_public_view`
anula los 5 campos de identidad con `CASE WHEN offer_accepted_between(...)`, y
RLS impide a una empresa leer `technician_profiles` directamente. El gate de
`privacyV2.ts` es una decisión de UI sobre datos que ya vienen filtrados.

## Architecture rules

Use a clean architecture:

screens/components
→ stores/hooks/usecases
→ repositories
→ storage adapter

Current storage:
- Supabase Postgres (via `src/repositories/v2/*`)
- Supabase Auth
- Supabase Storage (documents)

Do not couple UI directly to Supabase — go through a repository (`src/repositories/v2/*`), never call `src/lib/supabase.ts` from a screen/component/hook directly.

## Backend / data model notes

- **Schema first, code second (expand-contract)**: when a change needs both a migration and code, the migration is applied FIRST, then the code that reads or writes the new shape. Never the reverse. Code that `SELECT`s a column that does not exist yet fails every query against that table — in dev it is a nuisance, in a real deploy it is an outage, and the window lasts until someone remembers to run the migration. Same rule on the way out: stop reading a column in code, ship that, and only then drop it. Recorded 2026-07-29 after `companies.website` (migration 036) was written into the repository selects before the column existed.
- **Migrations**: numbered, additive SQL files in `supabase/migrations/`. Never `DROP`/`DELETE`/`TRUNCATE` existing data in a migration; deactivate (`is_active = false`) rather than delete when a catalog row becomes obsolete. Do not assume replayability: **064–091 are for one application, in order**. Their assertions depend on first-application state (068: empty engine-experience table; 070: original offers; 074: no multi-authority data yet; 075: all equivalences off; 088: offers with accepted authorities only where `accepts_equivalent` was set; 089: the 17 seed generics; 090: 164 engines and the seven CFM56/V2500 ratings on the aggregate rows; 091: no declared engines outside `engine_technician` and every offer's kind matching its type). The 077 self-test expects a CHECK where 079 later adds NOT NULL. Test a new migration in a transaction with rollback; do not reapply this historical set. Keep the CLI/history-prefix warning above in force.
- **Catalog tables with a TTL cache**: `aircraft_type_ratings` (EASA Part-66 aircraft-engine type ratings) is read through `src/repositories/v2/catalogRepository.ts`, backed by a dependency-injected, unit-testable TTL cache (`src/repositories/v2/aircraftTypeRatingsCache.ts`) and a shared hook (`src/state/useAircraftTypeRatingsCatalog.ts`) with explicit `loading`/`success`/`empty`/`error` states — never a hardcoded catalog baked into a TypeScript constant. `src/constants/aircraftTypeRatings.ts` holds only types and pure functions that take the loaded catalog/index as an argument.
- **A licence is a ROW, not a code** (Fase 10, migrations 073–075). `technician_licenses.id` identifies the credential; `(authority, license_code)` identifies the type, with a composite FK against `authority_licenses`. The UNIQUE is `(technician_id, authority, license_code)`, so the same code can be held under two authorities. Consequences that are easy to get wrong:
  - `technician_habilitations.technician_license_id` (NOT NULL) says which credential a rating hangs off. Never join habilitations to licences by `license_code` — with two B1.1s that picks whichever row came first, and that choice decides expiry, which is worth 61 points. The scorer picks explicitly (`selectLicenseForOffer`).
  - Two composite FKs protect it: `(technician_id, technician_license_id)` so a habilitation cannot hang off another technician's licence, and `(technician_license_id, license_code)` so the redundant code cannot drift from its licence's.
  - Aircraft uniqueness is `(technician_license_id, aircraft_type_rating_id)`. The old one was per code and blocked declaring the same aircraft under two authorities.
  - `offers.license_authority` travels with `offers.license_code`: present exactly together (`chk_offers_license_authority_pairing`), same composite FK. Writing the code without the authority fails the CHECK at runtime.
  - The upsert's `onConflict` is a **string literal no compiler checks**: it must name the columns of `uq_technician_licenses_authority_code` in order (`technician_id,authority,license_code`) or every licence save fails with 42P10. Verified live: the old string returns 42P10, the new one only hits RLS.
  - **No authority defaults anywhere since paso 5b.** `DEFAULT_AUTHORITY` (technician repo) and `DEFAULT_OFFER_AUTHORITY` (offer repo) are gone: the profile and the offer form pick the authority, `LicenseEntry.authority` and the habilitation entries require it, and a licence without one fails at the guard, not silently as EASA. The profile keys licences by credential (`src/utils/profileLicenses.ts`) and `removeUnreferencedLicenses` deletes by `(authority, code)`: removing the EASA B1.1 must never take the UK CAA B1.1 with it.
  - **Qué licencias puede pedir una oferta lo decide `licensesSelectableForOffer(oficio, autoridad)`**, la misma función para los chips del formulario y para la guarda de `offerRepository` (abierta a la FAA en el paso 5b, tras comprobar que el selector escribe ofertas FAA bien). FAA: A, P y A&P para mecánico; A y A&P para aviónico (sesión 2). Pedir no es implicar: el A&P sigue implicando sólo el oficio mecánico, igual que una B1. **La FAA no emite type ratings** (`authorities.has_type_ratings = false`): un A&P no admite habilitaciones, y las aeronaves de una oferta FAA son EXPERIENCIA (sesión 2, migración 086, `offerAircraftAreExperience`): se comparan sólo con `technician_aircraft_experience`, nunca con habilitaciones, y puntúan sin excluir (`LICENSE_WITH_EXPERIENCE_WEIGHTS`: licencia 40 + experiencia 25; el eje que topa a 39 es la licencia). Las ofertas Part-66 no cambian.
- **Same-row matching rule** (`src/utils/offerMatchExplain.ts`): a license category and an aircraft/engine rating only ever count as "held together" when they come from the SAME `technician_habilitations` row. Holding a license and separately having an unrelated habilitation must never be combined into a false match. This is a previously-fixed real bug — do not reintroduce it.
- **Matching's business principle**: required certification strongly affects the score and its ceilings. Engine evidence instead contributes to one weighted component: a declared exact engine scores above implicit evidence on that component, but the other components can reverse the overall ranking. A matching result is not a legal determination of certification privileges.
- **El motor de matching, Fase 10 (`src/utils/offerMatchExplain.ts`)**. Cinco reglas que se rompen solas si alguien toca el fichero sin saberlas:
  - **La credencial se elige UNA VEZ por par (oferta, técnico)**, en `selectLicenseForOffer`. Desde H2 se evalúa el resultado de la oferta completa para cada candidata, con vigencia, equivalencia y techos. Orden: total efectivo → cobertura efectiva → licencia vigente → autoridad exacta → fecha → ID estable. Añadir una credencial no reduce el mejor resultado existente. Todas las aeronaves pedidas se evalúan bajo esa misma credencial; no se combinan ratings de EASA y UK CAA para completar una oferta.
  - **`licenseCodeSatisfies` es la única comparación de códigos.** B1.1–B1.4 satisfacen respectivamente A1–A4; `licenseSatisfiesRequirement` limita esa inclusión B1→A a la misma autoridad. FAA A&P satisface A, P y A&P, sin simetría inversa. Desde H8 las filas FAA A y P separadas se proyectan como A&P solo en matching; no se persiste esa proyección ni se combinan credenciales Part-66.
  - **La caducidad se pregunta por `authorityLicenseCanExpire` ANTES que por la fecha.** FAA y CASA no caducan como documento; una fecha histórica se ignora y la UI no la pide. EASA, UK CAA y GCAA sí mantienen caducidad administrativa. Experiencia reciente y vigencia de una habilitación son datos distintos de la caducidad de la licencia.
  - **La equivalencia de autoridad es un MULTIPLICADOR (`EQUIVALENT_AUTHORITY_DEGRADATION_FRACTION`), no un tier nuevo**, igual que `VIGENCIA_DEGRADATION_FRACTION`. Es ortogonal a lo bien que el técnico cubre la aeronave; un tier mezclaría las dos cosas y obligaría a inventar "equivalente con la familia pero no el motor". Se aplica a habilitación y licencia a la vez: si la credencial que responde es de otra autoridad, lo es para todo lo que sostiene. Desde la sesión 2 (migración 088) la oferta guarda una LISTA, `offers.accepted_authorities` (`Offer.acceptedAuthorities`), de las otras autoridades Part-66 aceptadas además de la exigida; vacía = sólo la exacta. Sustituye al booleano `accepts_equivalent`, que ya no se lee ni se escribe (retirada pendiente). Exacta 100, equivalente aceptada 87, no aceptada 35 en el perfil a favor. Qué autoridades caben lo dice `equivalentAuthoritiesForLicense` (las otras Part-66 que emiten ese código: chips del formulario, espejo de forma y limpieza); al cambiar la autoridad o el código se quedan sólo las que siguen aplicando (`retainApplicableAuthorities`, en formulario y `resolveOfferPatch`). En base: `chk_offers_accepted_authorities` (sólo Part-66, nunca la exigida, vacía sin licencia o con FAA) y el trigger `enforce_offer_accepted_authorities` (cada una emite el código, sin repetidas; rechaza, no corrige). La lista ensancha la AUTORIDAD, nunca el código, y la FAA no cruza con nadie.
  - **Una oferta de motor (`offer_kind = 'engine'`) cambia CUATRO cosas a la vez**, y quitar cualquiera devuelve un bug conocido: (1) `offerAsksForQualification` devuelve true —si no, cae en la escala de 75 y anuncia "no requiere licencia ni aeronave" en una oferta que sí pide algo—; (2) usa `ENGINE_WEIGHTS` (15/0/0/15/5 + **65 de motor**, el reparto de `NO_CERTIFICATION_WEIGHTS` con el eje de motor en el sitio de la habilitación) o, si pide licencia (opcional desde la sesión 2), `ENGINE_WITH_LICENSE_WEIGHTS` (**45 de motor + 20 de licencia**: el motor sigue siendo el eje con más peso); (3) `zeroOnRequestedAxis` mira el motor, nunca la licencia: la licencia de una oferta de motor puntúa y no topa ni excluye, y su ausencia va a `clarifications`, no a `missingRequirements` (allí dispararía el tope de 59); (4) **el oficio no puntúa pero SÍ topa, desde la sesión 4 (091)**. Hasta entonces se saltaba a propósito: `offers.technician_type` es NOT NULL y toda oferta de motor nombraba un oficio que no describía lo que pedía, así que con el techo un mecánico con el motor exacto caía a 19 frente a una oferta cuyo único requisito ya cumplía. La 091 cambia la premisa: la clase se deriva del tipo (`chk_offers_kind_matches_technician_type`), una oferta de motor ES la del tipo Engine Technician, y el tipo sí dice lo que pide. Quien no es Engine Technician tiene un tipo de perfil distinto, igual que en aeronave: `PROFILE_TYPE_MISMATCH_CAP` (19) y la aclaración "Profile type differs". Tampoco existe ya el caso que motivó quitarlo, el mecánico con el motor declarado: sólo un Engine Technician declara motores, y los demás sólo entran por un type rating B1 (vía (b)) y se quedan en 19. Consecuencia buscada: ese mecánico queda por debajo de un Engine Technician sin motores que tenga el resto a favor (verificado, contrato y país: 38).
- **El eje de motores: escalera y fuentes**. `declarado > implícito en un type rating B1 > misma familia (declarado o B1) > mismo tipo de motor > tipo distinto > sin motores`, como fracciones del peso de motor (`ENGINE_TIER_FRACTIONS`). Este orden describe solo el componente motor; no garantiza el orden del total. `mismo tipo` y `tipo distinto` son los dos "motor sin relación", partidos. Cuatro cosas que no son negociables:
  - El motor implícito sale de `AircraftTypeRatingCatalog.engineId` (`aircraft_type_ratings.engine_id`, migración 069) **y de nada más**. `engine_manufacturer`/`engine_family` son texto EASA sucio —`Corp 250` es el Model 250 mal partido, 12 filas llevan el modelo escrito en el fabricante— y leerlos da el motor equivocado con cara de acierto.
  - **Y sólo de habilitaciones colgadas de una B1 (B1.1–B1.4)**, paso 5b, tanto para puntuar como para entrar en la oferta. La B1 es la rama que certifica el motor; un 737NG bajo una B2 o una C no dice nada del CFM56-7B. Se lee `habilitation.licenseCode`, que la FK compuesta de la 074 ata al código de SU credencial.
  - **Inactivo no significa genérico** (separados en la migración 089). `engines.is_generic` (`EngineCatalog.isGeneric`) marca una fila que no nombra un modelo: nunca da motor exacto, sólo familia, y ningún selector la ofrece. `is_active` sólo decide si el selector la ofrece: desactivar un modelo concreto no cambia la nota de quien ya lo tiene. El scorer mira `isGeneric`, nunca `isActive`; `searchEngines` filtra las dos. Genéricas: las 17 "<fabricante> (model not specified)", que además siguen inactivas, y desde la 090 "CFM56" y "V2500", activas.
  - **CFM56 y V2500 van en variantes** (090, con fuente TCDS de EASA en la cabecera): CFM56-2/-3/-5A/-5B/-5C/-7B y V2500-A1/-A5/-D5/-E5. Un type rating se enlaza a una variante sólo si admite UNA (737NG → -7B, 737 Classic → -3, A340 → -5C, DC-8 → -2, MD-90 → -D5); si admite varias (A320 CFM, A320 IAE) se queda en la genérica y da familia, no exacto. No hay tabla rating↔motores múltiple: no enlaces un rating a una variante "por defecto".
  - **Sin motores puntúa poco pero NO cero** (el eje arranca vacío para todos los perfiles, y un cero dispararía `ZERO_QUALIFICATION_CAP` sobre toda la lista), y **los años no puntúan**: 1 año vale lo mismo que 20. "La cualificación puntúa, la experiencia informa".
- **Los motores del técnico son del tipo Engine Technician (091).** Invariante de la base, no de la pantalla: el trigger `enforce_engine_experience_requires_engine_technician` rechaza (23514, `DETAIL` `not_engine_technician`) cualquier fila de `technician_engine_experience` de un técnico sin el tipo —hace falta en la tabla, porque `tee_insert_own` deja insertar sin pasar por la RPC—; `replace_technician_engines` lo comprueba antes de borrar (la lista vacía pasa); y `clear_engines_without_engine_technician` borra sus motores cuando el técnico se queda sin el tipo (DELETE, o UPDATE del admin). Los dos triggers bloquean la fila de `technician_profiles`, como la RPC, para que un alta de motor y una retirada del tipo simultáneas no dejen filas sueltas. El perfil sólo pinta `EngineExperienceEditor` con el tipo y avisa antes de quitarlo teniendo motores (`src/utils/profileEngines.ts`); cancelar deja el tipo marcado. Por eso el guardado escribe los tipos ANTES que los motores. El borrado de cuenta no pasa por aquí: `handle_deleted_user` conserva tipos y motores en la lápida, y nada hace cascada desde `auth.users` hasta el perfil (ensayado con y sin la 091).
- **El núcleo de elegibilidad tiene DOS filtros en `isTechnicianEligibleForOffer`.** Se aplican en las dos direcciones (`rankTechniciansForOffer` y `rankOffersForTechnician`). No son todos los filtros de la plataforma: repositorios, RLS y pantallas también filtran por visibilidad, verificación, publicación, búsqueda y mínimo de años, con diferencias entre recorridos. Cualquier nuevo filtro de elegibilidad del par debe añadirse al núcleo y su espejo SQL.
  - **Elegibilidad de oferta de motor (paso 5b, sustituye a la del 5a; sesión 4, 091).** En una oferta con `offer_kind = 'engine'` entra quien cumpla AL MENOS UNA: (b) tiene un type rating colgado de una **B1** cuyo motor es el de la oferta o de su familia —si no es Engine Technician, con el techo de 19, ver arriba—; (c) tiene `engine_technician` entre sus oficios aunque no declare motores. Nadie más: un type rating colgado sólo de B2, C u otra licencia no da entrada. La vía (a), "ha DECLARADO algún motor, sea cual sea su oficio", se retiró en la 091: declarar motores exige ser Engine Technician, así que (a) ya estaba dentro de (c). Las letras se conservan. La (b) mira sólo la evidencia implícita B1: un motor declarado que traiga un perfil desfasado no da entrada, igual que en el núcleo SQL, que ya no recibe el número de motores. La vía (b) pregunta al mismo emparejador que la puntuación (`matchEngineEvidence`), así que entrar por ella y puntuar ese escalón no pueden discrepar; por eso `isTechnicianEligibleForOffer` y las dos funciones de ranking exigen `ratingIndex` y `engineIndex` (sin valor por defecto: olvidarlo dejaría fuera la familia en silencio). Es filtro, no puntuación: quien pasa puntúa con la escalera normal, y `engine_technician` sin motores saca los 3 puntos del escalón `none`.
  - **`offers.only_unlicensed`.** Un técnico con alguna licencia declarada —caducada o no— no aparece. Vale en ofertas de aeronave y de motor, y sólo en las que NO exigen licencia (CHECK de la 077). Se suma al anterior: no rescata a quien no tiene nada de motor.
  - `technicianIneligibilityReason` dice cuál de los dos falla; la booleana la envuelve. `engine_technician` es fila activa de `technician_types` desde la 078 (creada inactiva en la 076), en la base y en `TECHNICIAN_TYPES` a la vez.
  - **Las candidaturas los hace cumplir LA BASE (080, reforzada por 081).** Los participantes son inmutables para clientes; se autoriza antes de leer cualificaciones privadas. El trigger `enforce_offer_application_eligibility` rechaza con `ERRCODE PT403` y el motivo en `DETAIL` en INSERT, re-aplicación y reasignación de oferta por mantenimiento. Retirar, aceptar o rechazar sin cambiar oferta no vuelven a comprobar elegibilidad. `offerApplicationRepository.throwIfIneligible` traduce el motivo con `ineligibilityReasonText`: el texto vive sólo en TS. La 081 alinea además la lectura de cualificaciones con visibilidad o relación existente.
  - ⚠ **La regla está en DOS implementaciones, TS y SQL, y es forzoso**: Postgres no ejecuta TypeScript (no hay plv8). El SQL es un núcleo que recibe HECHOS, `public.offer_eligibility_reason(...)`, y `npm run validate:application-eligibility` lo ejecuta junto a `technicianIneligibilityReason` sobre ~390 casos con el catálogo vivo y falla si divergen (el patrón de `validate:state-machine`). **Si tocas la regla en `offerMatchExplain.ts`, toca el núcleo en una migración nueva y pasa el validador.** Detalle replicado a propósito: sólo cuentan ratings ACTIVOS, porque el índice del cliente sólo carga los activos. `offer_application_ineligibility_reason` (lee datos del técnico) es SECURITY DEFINER sin EXECUTE para clientes; el núcleo sí es ejecutable (sólo lee catálogos públicos).
  - Lo que el trigger NO cubre: las ofertas directas (`offer_requests`, las envía la empresa) y una oferta que cambia DESPUÉS de recibir candidaturas (p. ej. se marca "sólo sin licencia", o cambia de tipo y con él de clase): las candidaturas ya existentes no se revisan.
- **La forma de una oferta la imponen CHECKs y triggers, y la repite un espejo en TS.** Motor ⇒ con motor y licencia opcional, sólo Part-66 B1.1–B1.4 o FAA P / A&P (`chk_offers_engine_kind_shape`, 076 reemplazado por la 087; `ENGINE_OFFER_LICENSE_CODES` en TS, que decide también los chips vía `licensesSelectableForOffer`) y sin aeronaves (dos triggers de la 076: las aeronaves viven en otra tabla); aeronave ⇒ sin `required_engine_id` (`chk_offers_aircraft_without_engine`, 077); `offer_kind` NOT NULL con DEFAULT 'aircraft' desde la 079 (la 077 se escribió con `IS NOT DISTINCT FROM` cuando aún podía ser NULL); `only_unlicensed` ⇒ no exige licencia (`chk_offers_only_unlicensed_without_license`, 077); motor ⇔ `technician_type = 'engine_technician'` (`chk_offers_kind_matches_technician_type`, 091: la clase ya no se elige, sale del tipo con `offerKindForTechnicianType`). `src/utils/offerShape.ts` (`offerShapeViolations`) es el espejo: lo usan `offerRepository` y los fixtures de tests para no mandar lo que Postgres rechaza. La 077 se autocomprueba al aplicarse (intenta las filas prohibidas y exige que ESOS constraints las rechacen).
  - `offerRepository.update` calcula el estado resultante con **`resolveOfferPatch`** y escribe los grupos acoplados desde él (certificación/licencia/autoridad/autoridades aceptadas/"sólo sin licencia", y tipo/clase/motor: si el patch cambia el tipo sin mandar la clase, la clase se deriva; si manda una que lo contradice, la guarda lanza). `create` no recibe la clase: la deriva. La RPC 082 (reemplazada por la 086 y la 088, que añade la clave `accepted_authorities`) `update_offer_with_habilitations` hace atómicos el cambio de oferta y el reemplazo de aeronaves; valida antes de borrar y restaura todo si falla. Pasar a motor limpia aeronaves dentro de esa misma transacción; pasar a una licencia FAA ya no (086).
  - La 082 también hace transaccionales `replace_technician_habilitations` y `replace_technician_engines`. No convierte el formulario completo de perfil ni la creación inicial de oferta en una única transacción.
  - **H3, punto 6 del paso 5d:** el perfil solo permite ratings individuales bajo B1.x, B2 y C, en combinaciones válidas de autoridad/código. B1.x exige producto y propulsión coherentes, resueltos por `engine_id`; propulsión desconocida exige revisión de catálogo. La 083 ya aplicada impone las mismas reglas en servidor. El perfil avisa qué habilitación impide retirar una licencia o guardar una combinación incompatible antes de escribir. Si la base rechaza por 083 con datos de cliente desactualizados, se diagnostica por habilitación y se muestra su nombre; no se reintenta la escritura. No se eliminan ni reasignan filas automáticamente.
  - Las transiciones del formulario de oferta (crear y editar) viven en `src/utils/offerFormRules.ts`, con tests (`npm run test:offer-form`). Volver a "Yes, licence required" desmarca "sólo sin licencia"; la casilla sólo aparece con "No licence needed", en aeronave y en motor. Desde la sesión 4 no hay selector de clase (se retiró `selectOfferKind` y `OfferKindSection`): `selectTechnicianType` la decide, Engine Technician ⇒ motor sin aeronaves, cualquier otro ⇒ aeronave sin motor. La pregunta de licencia de la oferta de motor no cambia.
- **Los envoltorios `getTechnicianMatchesForOffer` / `getOfferMatchesForTechnician` (`src/utils/matchingV2.ts`) no puntúan ni filtran nada**: son `createMatchingService` (`src/utils/matchingService.ts`, puro, con cargadores inyectados) conectado a los repositorios, y delegan en las dos funciones de ranking con `ratingIndex` y `engineIndex` cargados. Un test comprueba que pasar por ellos da exactamente lo mismo que las funciones directas. Si vuelves a escribir un bucle con `calculateOfferTechnicianMatch` ahí, ese test falla.
  - `catalogRepository.getEngines()` devuelve el catálogo ENTERO, **inactivos incluidos**: de las 17 genéricas inactivas cuelgan 268 type ratings, y sin su `family` en el índice pierden el crédito de familia sin ningún error. Un selector filtra `isActive` al pintar.
  - **Ninguna pantalla llama a `calculateOfferTechnicianMatch`** (paso 5b; `matchingV2` ya no la exporta). Las que miran un par suelto —búsqueda de empresa, candidaturas, ofertas directas, detalle de oferta del técnico— piden `matchPair`/`matchPairs`, que es `matchOfferTechnicianPair`: filtro y scorer con los dos catálogos. Devuelve `PairMatch`, `{ eligible: true, score } | { eligible: false, reason }` — la variante no elegible no tiene score, y la pantalla pinta "Not eligible" con `ineligibilityReasonText`. Las dos funciones de ranking son ese mismo par más deduplicar y ordenar.
  - La búsqueda de empresa oculta los no elegibles y solo muestra resultados una vez comprobado el lote para la oferta actual. Si falla la carga inicial de catálogos o `matchPairs`, muestra error y reintento; nunca retorna la lista sin filtrar como alternativa.
- **`MatchScore.breakdown` tiene SEIS componentes desde la Fase 10**: el `engine` nuevo sólo es distinto de 0 en una oferta de motor, y allí `habilitation` y `license` valen siempre 0 — son ejes excluyentes, no acumulables. `getMatchScoreWeights` devuelve los seis máximos; no los escribas a mano en una pantalla.

## UI/UX rules

The app must feel like a premium B2B SaaS:
- mobile-first
- clean
- professional
- aviation-inspired
- trustworthy
- responsive on web
- cards/lists on mobile
- wider dashboards on web

Avoid generic UI.

## Important docs

V2 docs (source of truth):
- docs/PRODUCT_CONTEXT_V2.md
- docs/DATA_MODEL_V2.md
- docs/USER_FLOWS_V2.md
- docs/SUPABASE_PLAN_V2.md
- docs/IMPLEMENTATION_PHASES_V2.md
- docs/HANDOFF_SUMMARY.md

V2 technical model (read before any implementation):
- docs/TYPESCRIPT_TYPES_V2.md — canonical TypeScript types
- docs/SUPABASE_SCHEMA_V2.sql — Postgres schema with seeds
- docs/RLS_PLAN_V2.md — security / RLS policies
- docs/MIGRATION_FROM_DEMO_TO_V2.md — V1→V2 field mapping and migration guide

## Working rules

Before major implementation:
1. Inspect relevant files.
2. Explain the plan briefly.
3. Implement in small phases.
4. Keep the app runnable.
5. Do not remove existing functionality without permission.
6. Run available checks before finishing.

General checks: `npm test` runs the regression suites that **never write to the
database**, plus both authority/eligibility validators, sequentially and stopping
on failure. The validators do query the live project, but read-only (a `SELECT`
on two catalogs and a `STABLE` function that takes facts as arguments), and they
are the TS↔SQL parity guard, so they stay in the general run. Run `npm run ts`
separately.

⚠ `npm run test:db` is the one that **writes to production** — `test:database`
and `test:habilitation-scope:database`. Everything goes inside `BEGIN … ROLLBACK`
and both runners check afterwards that nothing was left behind, but while a run
lasts it injects triggers and, in rehearsal mode, replaces installed functions,
so a concurrent real write can block on it. Never run it in parallel with itself,
and never assume `npm test` covers it.

Present any new migration and its rollback test results to the user and wait for
explicit confirmation before applying it to production.
