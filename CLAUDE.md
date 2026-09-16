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
- `supabase/migrations/*.sql` — 79 files, numbered `001`–`078` (the `014` slot is split into `0140`/`0141`); idempotent, hand-reviewed migrations (see "Backend / data model notes" below). Never edit an already-applied migration; add a new one. Apply them with the Supabase MCP `apply_migration`, never the SQL editor or `execute_sql`: only `apply_migration` records the migration in `supabase_migrations.schema_migrations`.
  - **History repair, 2026-09-15.** `001`, `004`–`007` and `061`–`063` had been applied through the SQL editor, so they were live but missing from `schema_migrations`. They were registered by hand, each with its file's full SQL in `statements` (md5 byte-identical to the file), under versions that keep the order: `001`→`20260603000100`, `004`→`20260604000400`, `005`→`20260604000500`, `006`→`20260606000600`, `007`→`20260606000700`, `061`→`20260812120000`, `062`→`20260910120000`, `063`→`20260910120100`. Backup taken first: `supabase_migrations.schema_migrations_backup_20260915` (the 73 rows before the repair; drop it once nobody needs it). History now has 81 rows, one per migration file (`020` counts as 9 batches).
  - ⚠ **Do not run `supabase db push` or `supabase migration repair` as-is.** The CLI matches a local file to the history by the filename prefix (`001`, `002`…), but every history version is a timestamp (`20260603112059`…). To the CLI, no local file matches any history row, so it would try to run all of them. Renaming the files to timestamps, or rewriting the versions, has to come first, and it is a separate decision. Supabase branching builds from the files on an empty database, so this does not affect it.
  - The local CLI link is stale: `supabase/.temp/project-ref` points to `duxcidflcecojublxmpx` (`rotoraxis-deploy-rehearsal-DELETEME`, already deleted), not to `rwauwuremzkizeoginza`. And `SUPABASE_ACCESS_TOKEN` in `.env` returns 401. Both need redoing before using the CLI.

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
- engines (Fase 10, paso 5b, migración 068: motores declarados. Hacen elegible y
  puntúan en ofertas de motor; los años son display-only)
- aircraftExperience (Fase 6 tanda B, migración 050: aeronaves en las que ha
  trabajado, CON O SIN licencia. Lista separada de `habilitations` — aquélla
  dice que está autorizado a firmar el trabajo, ésta que sabe hacerlo. NO
  puntúa: el scorer no la lee hasta la Tanda E)
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
  ⚠ La vista SQL y los tipos TODAVÍA la exponen: la retirada está pendiente de
  implementación (hallazgo B2 de `docs/FINAL_AUDIT_REPORT.md`). Hasta que se
  complete, esta línea describe el destino acordado, no el estado actual.

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
- **Migrations**: numbered, additive, idempotent SQL files in `supabase/migrations/`. Never `DROP`/`DELETE`/`TRUNCATE` existing data in a migration; deactivate (`is_active = false`) rather than delete when a catalog row becomes obsolete. `016_part66_ratings_habilitations.sql` is the reference style for a well-commented, idempotent migration (header explaining intent/rationale, explicit backfill logic guarded against double-writes).
- **Catalog tables with a TTL cache**: `aircraft_type_ratings` (EASA Part-66 aircraft-engine type ratings) is read through `src/repositories/v2/catalogRepository.ts`, backed by a dependency-injected, unit-testable TTL cache (`src/repositories/v2/aircraftTypeRatingsCache.ts`) and a shared hook (`src/state/useAircraftTypeRatingsCatalog.ts`) with explicit `loading`/`success`/`empty`/`error` states — never a hardcoded catalog baked into a TypeScript constant. `src/constants/aircraftTypeRatings.ts` holds only types and pure functions that take the loaded catalog/index as an argument.
- **A licence is a ROW, not a code** (Fase 10, migrations 073–075). `technician_licenses.id` identifies the credential; `(authority, license_code)` identifies the type, with a composite FK against `authority_licenses`. The UNIQUE is `(technician_id, authority, license_code)`, so the same code can be held under two authorities. Consequences that are easy to get wrong:
  - `technician_habilitations.technician_license_id` (NOT NULL) says which credential a rating hangs off. Never join habilitations to licences by `license_code` — with two B1.1s that picks whichever row came first, and that choice decides expiry, which is worth 61 points. The scorer picks explicitly (`selectLicenseForOffer`).
  - Two composite FKs protect it: `(technician_id, technician_license_id)` so a habilitation cannot hang off another technician's licence, and `(technician_license_id, license_code)` so the redundant code cannot drift from its licence's.
  - Aircraft uniqueness is `(technician_license_id, aircraft_type_rating_id)`. The old one was per code and blocked declaring the same aircraft under two authorities.
  - `offers.license_authority` travels with `offers.license_code`: present exactly together (`chk_offers_license_authority_pairing`), same composite FK. Writing the code without the authority fails the CHECK at runtime.
  - The upsert's `onConflict` is a **string literal no compiler checks**: it must name the columns of `uq_technician_licenses_authority_code` in order (`technician_id,authority,license_code`) or every licence save fails with 42P10. Verified live: the old string returns 42P10, the new one only hits RLS.
  - **No authority defaults anywhere since paso 5b.** `DEFAULT_AUTHORITY` (technician repo) and `DEFAULT_OFFER_AUTHORITY` (offer repo) are gone: the profile and the offer form pick the authority, `LicenseEntry.authority` and the habilitation entries require it, and a licence without one fails at the guard, not silently as EASA. The profile keys licences by credential (`src/utils/profileLicenses.ts`) and `removeUnreferencedLicenses` deletes by `(authority, code)`: removing the EASA B1.1 must never take the UK CAA B1.1 with it.
  - **Qué licencias puede pedir una oferta lo decide `licensesSelectableForOffer(oficio, autoridad)`**, la misma función para los chips del formulario y para la guarda de `offerRepository` (abierta a la FAA en el paso 5b, tras comprobar que el selector escribe ofertas FAA bien). FAA: A, P y A&P para mecánico, nada para aviónico; el A&P implica el oficio mecánico igual que una B1. **La FAA no emite type ratings** (`authorities.has_type_ratings = false`): una oferta FAA no puede pedir aeronaves y un A&P no admite habilitaciones.
- **Same-row matching rule** (`src/utils/offerMatchExplain.ts`): a license category and an aircraft/engine rating only ever count as "held together" when they come from the SAME `technician_habilitations` row. Holding a license and separately having an unrelated habilitation must never be combined into a false match. This is a previously-fixed real bug — do not reintroduce it.
- **Matching's business principle**: a technician who holds exactly what an offer requires must score clearly above one who does not, regardless of how good the rest of their profile looks — a missing mandatory qualification is a legal blocker (the technician cannot sign that work), not a minor preference gap. Score design should make that unambiguous, not just directionally true.
- **El motor de matching, Fase 10 (`src/utils/offerMatchExplain.ts`)**. Cinco reglas que se rompen solas si alguien toca el fichero sin saberlas:
  - **La credencial se elige UNA VEZ por par (oferta, técnico)**, en `selectLicenseForOffer`, antes de puntuar nada. Elegirla dentro de cada requisito —como hacía el paso 3— deja que un técnico con el A320 bajo su B1.1 EASA y el B777 bajo su B1.1 UK CAA cumpla una oferta que exige LAS DOS: cada aeronave escogería la licencia que le conviene. Es la combinación falsa de la regla de misma fila, colada por la puerta de la autoridad. El orden de preferencia es cualificación válida → **calidad** (cuántas aeronaves pedidas sostiene y en qué tier) → **vigencia** → **exacta sobre equivalente**; vigencia ANTES que exactitud para que una EASA caducada no bloquee a una UK CAA vigente.
  - **`licenseCodeSatisfies` es la única comparación de códigos.** `held === required` es correcto para las trece Part-66 y mentira para la FAA: A&P satisface A, P y A&P (y un A no satisface un A&P — la dirección no es simétrica). Si esa comparación se escribe en línea en un segundo sitio, ése se olvidará del A&P y dejará fuera al candidato que sí puede hacer el trabajo.
  - **La caducidad se pregunta por `authorityLicenseCanExpire` ANTES que por la fecha.** El certificado FAA (14 CFR 65.19) no expira; el 65.83 es experiencia reciente, no una fecha en el papel. Comparar `expiresAt` a secas marcaba como vencido a todo titular FAA.
  - **La equivalencia de autoridad es un MULTIPLICADOR (`EQUIVALENT_AUTHORITY_DEGRADATION_FRACTION`), no un tier nuevo**, igual que `VIGENCIA_DEGRADATION_FRACTION`. Es ortogonal a lo bien que el técnico cubre la aeronave; un tier mezclaría las dos cosas y obligaría a inventar "equivalente con la familia pero no el motor". Se aplica a habilitación y licencia a la vez: si la credencial que responde es de otra autoridad, lo es para todo lo que sostiene. `accepts_equivalent` ensancha la AUTORIDAD, nunca el código, y la FAA no cruza con nadie — eso sale solo de que los códigos son disjuntos.
  - **Una oferta de motor (`offer_kind = 'engine'`) cambia CUATRO cosas a la vez**, y quitar cualquiera devuelve un bug conocido: (1) `offerAsksForQualification` devuelve true —si no, cae en la escala de 75 y anuncia "no requiere licencia ni aeronave" en una oferta que sí pide algo—; (2) usa `ENGINE_WEIGHTS` (15/0/0/15/5 + **65 de motor**, el reparto de `NO_CERTIFICATION_WEIGHTS` con el eje de motor en el sitio de la habilitación); (3) `zeroOnRequestedAxis` mira el motor, no la habilitación ni la licencia, que allí valen 0 por construcción; (4) **el oficio no puntúa ni topa** — `offers.technician_type` es NOT NULL (no lo toques), así que toda oferta de motor nombra un oficio que no describe nada de lo que pide, y con el techo puesto un mecánico con el motor exacto caía a 19.
- **El eje de motores: escalera y fuentes**. `declarado > implícito en un type rating B1 > misma familia (declarado o B1) > mismo tipo de motor > tipo distinto > sin motores`, como fracciones del peso de motor (`ENGINE_TIER_FRACTIONS`). `mismo tipo` y `tipo distinto` son los dos "motor sin relación", partidos. Cuatro cosas que no son negociables:
  - El motor implícito sale de `AircraftTypeRatingCatalog.engineId` (`aircraft_type_ratings.engine_id`, migración 069) **y de nada más**. `engine_manufacturer`/`engine_family` son texto EASA sucio —`Corp 250` es el Model 250 mal partido, 12 filas llevan el modelo escrito en el fabricante— y leerlos da el motor equivocado con cara de acierto.
  - **Y sólo de habilitaciones colgadas de una B1 (B1.1–B1.4)**, paso 5b, tanto para puntuar como para entrar en la oferta. La B1 es la rama que certifica el motor; un 737NG bajo una B2 o una C no dice nada del CFM56-7B. Se lee `habilitation.licenseCode`, que la FK compuesta de la 074 ata al código de SU credencial.
  - Un rating enlazado a un motor **genérico** (`engines.is_active = false`, las 17 filas "<fabricante> (model not specified)" del seed de la 071) da crédito de FAMILIA y nunca de motor exacto ni implícito: una genérica no dice qué motor es, sólo de quién.
  - **Sin motores puntúa poco pero NO cero** (el eje arranca vacío para todos los perfiles, y un cero dispararía `ZERO_QUALIFICATION_CAP` sobre toda la lista), y **los años no puntúan**: 1 año vale lo mismo que 20. "La cualificación puntúa, la experiencia informa".
- **Hay DOS filtros excluyentes en toda la plataforma, y viven juntos en `isTechnicianEligibleForOffer`.** Todo lo demás ordena: un requisito incumplido baja el porcentaje, lo explica y deja el par en la lista, porque quien decide a quién llamar es una persona. Estos dos no: quien no pasa no aparece. Se aplican en las DOS direcciones (`rankTechniciansForOffer` y `rankOffersForTechnician`); un filtro que excluye en una sola dirección se rodea entrando por la otra pantalla. Un tercero va en la misma función, no aparte.
  - **Elegibilidad de oferta de motor (paso 5b, sustituye a la del 5a).** En una oferta con `offer_kind = 'engine'` entra quien cumpla AL MENOS UNA: (a) ha DECLARADO algún motor (`technician_engine_experience`), sea cual sea su oficio; (b) tiene un type rating colgado de una **B1** cuyo motor es el de la oferta o de su familia; (c) tiene `engine_technician` entre sus oficios aunque no declare motores. Nadie más: un type rating colgado sólo de B2, C u otra licencia no da entrada. La vía (b) pregunta al mismo emparejador que la puntuación (`matchEngineEvidence`), así que entrar por ella y puntuar ese escalón no pueden discrepar; por eso `isTechnicianEligibleForOffer` y las dos funciones de ranking exigen `ratingIndex` y `engineIndex` (sin valor por defecto: olvidarlo dejaría fuera la familia en silencio). Es filtro, no puntuación: quien pasa puntúa con la escalera normal, y `engine_technician` sin motores saca los 3 puntos del escalón `none`.
  - **`offers.only_unlicensed`.** Un técnico con alguna licencia declarada —caducada o no— no aparece. Vale en ofertas de aeronave y de motor, y sólo en las que NO exigen licencia (CHECK de la 077). Se suma al anterior: no rescata a quien no tiene nada de motor.
  - `technicianIneligibilityReason` dice cuál de los dos falla; la booleana la envuelve. `engine_technician` es fila activa de `technician_types` desde la 078 (creada inactiva en la 076), en la base y en `TECHNICIAN_TYPES` a la vez.
- **La forma de una oferta la imponen CHECKs y triggers, y la repite un espejo en TS.** Motor ⇒ sin licencia, sin certificación, con motor (`chk_offers_engine_kind_shape`, 076) y sin aeronaves (dos triggers de la 076: las aeronaves viven en otra tabla); aeronave ⇒ sin `required_engine_id` (`chk_offers_aircraft_without_engine`, 077, con `offer_kind IS NOT DISTINCT FROM 'engine'` para que un NULL no se cuele); `only_unlicensed` ⇒ no exige licencia (`chk_offers_only_unlicensed_without_license`, 077). `src/utils/offerShape.ts` (`offerShapeViolations`) es el espejo: lo usan `offerRepository` y los fixtures de tests para no mandar lo que Postgres rechaza. La 077 se autocomprueba al aplicarse (intenta las filas prohibidas y exige que ESOS constraints las rechacen).
  - `offerRepository.update` calcula el estado resultante con **`resolveOfferPatch`** y escribe los grupos acoplados desde él (certificación/licencia/autoridad/equivalencias/"sólo sin licencia", y clase/motor). Pasar a motor o a una licencia FAA borra las aeronaves ANTES del UPDATE (triggers de la 076), como el cambio de producto.
  - Las transiciones del formulario de oferta (crear y editar) viven en `src/utils/offerFormRules.ts`, con tests (`npm run test:offer-form`). Volver a "Yes, licence required" desmarca "sólo sin licencia"; la casilla sólo aparece con "No licence needed", en aeronave y en motor.
- **Los envoltorios `getTechnicianMatchesForOffer` / `getOfferMatchesForTechnician` (`src/utils/matchingV2.ts`) no puntúan ni filtran nada**: son `createMatchingService` (`src/utils/matchingService.ts`, puro, con cargadores inyectados) conectado a los repositorios, y delegan en las dos funciones de ranking con `ratingIndex` y `engineIndex` cargados. Un test comprueba que pasar por ellos da exactamente lo mismo que las funciones directas. Si vuelves a escribir un bucle con `calculateOfferTechnicianMatch` ahí, ese test falla.
  - `catalogRepository.getEngines()` devuelve el catálogo ENTERO, **inactivos incluidos**: de las 17 genéricas inactivas cuelgan 268 type ratings, y sin su `family` en el índice pierden el crédito de familia sin ningún error. Un selector filtra `isActive` al pintar.
  - **Ninguna pantalla llama a `calculateOfferTechnicianMatch`** (paso 5b; `matchingV2` ya no la exporta). Las que miran un par suelto —búsqueda de empresa, candidaturas, ofertas directas, detalle de oferta del técnico— piden `matchPair`/`matchPairs`, que es `matchOfferTechnicianPair`: filtro y scorer con los dos catálogos. Devuelve `PairMatch`, `{ eligible: true, score } | { eligible: false, reason }` — la variante no elegible no tiene score, y la pantalla pinta "Not eligible" con `ineligibilityReasonText`. Las dos funciones de ranking son ese mismo par más deduplicar y ordenar.
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