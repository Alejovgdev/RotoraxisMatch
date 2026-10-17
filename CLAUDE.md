# AviationJobTalent — Claude Context

> **UI redesign:** finished (merged into `main` on 2026-10-10, commit `26f5960`). Its mockups no longer exist; `docs/UI_REDESIGN.md` remains only as a style reference for `app/company` and `app/technician`.

> **Source of truth: the code and the migrations** (`app/`, `src/`, `supabase/migrations/`).
> `docs/PRODUCT_CONTEXT_V2.md` and `docs/USER_FLOWS_V2.md` are historical context from June 2026
> and may be out of date: where they disagree with the code, the code wins. The current docs
> are listed under "Important docs".

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
- `supabase/migrations/*.sql` — 107 files, numbered `001`–`106` (the `014` slot is split into `0140`/`0141`). All of `001`–`106` are applied to dev. The application record of each one (version, md5, rehearsal results, undo script, edge function deployments) is in `docs/MIGRATIONS_LOG.md`.

Do not use yet:
- Firebase
- Stripe
- Paddle

## Migration rules

- Never edit an already-applied migration; add a new one. Migrations are additive: never `DROP`/`DELETE`/`TRUNCATE` existing data; deactivate a catalog row (`is_active = false`) instead of deleting it.
- Rehearse every new migration inside a transaction that ends in ROLLBACK, present the results and wait for the owner's explicit OK before applying it (today, to dev).
- Apply only through Supabase MCP `apply_migration` or the official Management API migration endpoint, so the application is recorded in `supabase_migrations.schema_migrations`. Never through the SQL editor or `execute_sql`.
- **064–106 are single-application migrations, not a replayable script set**: their self-tests depend on first-application state. Never re-run them (details in `docs/DOMAIN_RULES.md`, "Migrations").
- ⚠ Do not run `supabase db push` or `supabase migration repair` as-is: the CLI matches local files by prefix (`001`…) while every history version is a timestamp, so it would try to run all of them. Renaming the files or rewriting the versions comes first, and it is a separate decision.
- The local CLI link is stale (`supabase/.temp/project-ref` points to a deleted project): relink deliberately before using the CLI. The database tests authenticate to the project derived from `EXPO_PUBLIC_SUPABASE_URL` (token: `SUPABASE_TEST_ACCESS_TOKEN`, then `.env`, then the inherited one).

## Mobile release config (2026-10-16)

- **iPhone only**: `ios.supportsTablet: false`; an iPad runs the app in iPhone compatibility mode.
- **EAS Update**: `expo-updates` installed, `runtimeVersion.policy: "fingerprint"`, and each build profile in `eas.json` has its `channel` and `environment` (`preview`, `production`). Not linked to Expo yet: no `extra.eas.projectId` and no `updates.url`, so the plugin writes `EXUpdatesEnabled: false` and builds run their embedded bundle. Linking is `eas init` + `eas update:configure`, the owner's decision. With SDK 55+ `eas update` requires `--environment` and reads only the EAS server variables of that environment, never `.env` nor the `env` block of `eas.json`: the `EXPO_PUBLIC_*` values must exist as EAS environment variables (preview → dev, production → prod) before the first publish.
- **Password**: minimum 8 characters, defined once in `src/auth/passwordRules.ts` and used by both signups and `/auth/set-password` (`npm run test:password-rules`). Supabase Auth's own minimum (Authentication → Sign In / Providers → Email) must match; dev was still 6 on 2026-10-16.

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

Companies can only see (alineado con `technician_public_view` y `SafeTechnicianPreview`):
- anonymousCode
- technicianTypes (varios: tabla puente `technician_profile_types`. La columna
  `technician_profiles.technician_type` sigue existiendo sin lectores, pendiente de retirada)
- country / city / baseAirport (+ latitude/longitude para el mapa)
- licenses (CREDENCIALES `{ authority, licenseCode }` — "EASA B1.1", "FAA A&P" —,
  no códigos sueltos: con cinco autoridades "B1.1" no dice cuál es)
- habilitations (type ratings EASA célula+motor)
- engines (motores declarados, sólo de un Engine Technician (091). Puntúan en
  ofertas de motor; los años son display-only)
- aircraftExperience (aeronaves en las que ha trabajado, CON O SIN licencia. Lista
  separada de `habilitations` — aquélla representa una habilitación declarada y ésta
  experiencia de trabajo. Aporta evidencia de aeronave en ofertas sin certificación
  (`evaluateAircraftKnowledgeRequirement`) y en ofertas FAA, igual en las dos: ella o
  el type rating, de cualquier autoridad y para cualquier técnico; con las dos, la que
  dé más puntos. Los años no suman puntos)
- availability
- yearsExperience
- verificationStatus
- matchingScore (calculado por par oferta+técnico, nunca global)

No hay porcentaje de completitud del perfil: si hay que señalar que falta algo, va una
lista de "te falta esto", no un porcentaje.

Companies must NOT see:
- fullName
- email
- phone
- socialLinks
- birthDate
- **age** — es
  característica protegida en normativa laboral europea y mostrarla al
  empleador durante el cribado es riesgo de discriminación, además de
  incoherente con anonimizar el nombre para reducir sesgo. No aporta al
  cribado (licencias, ratings y años de experiencia ya cubren lo relevante).

Identity is revealed only when:

matchRequest.status === "accepted"
AND identityRevealed === true

El enforcer real es la base de datos, no el TypeScript: `technician_public_view`
anula los 5 campos de identidad con `CASE WHEN offer_accepted_between(...)`, y
RLS impide a una empresa leer `technician_profiles` directamente. El gate de
`privacyV2.ts` es una decisión de UI sobre datos que ya vienen filtrados.

Quién puede ACEPTAR (y rechazar, retirar) lo decide también la base desde la
092: una candidatura la acepta la empresa, una oferta directa el técnico;
nunca la parte que la propuso, ni un admin de la plataforma en nombre de nadie
(`offer_relation_transition_actor` dentro de
`handle_offer_relation_status_transition`; espejo `TRANSITION_ACTORS` en
`src/utils/offerRelationStateMachine.ts`, comparado por
`validate:state-machine`).

Y quién es parte de la relación tampoco cambia (093):
técnico, empresa y oferta son inmutables para los usuarios de la app en las
dos tablas (081 en candidaturas, 093 en ofertas directas). Sin eso, una
empresa cambiaba el técnico de una oferta directa ya aceptada y veía la
identidad y los documentos de cualquier otro. Cada parte edita sólo su texto:
`cover_note` el técnico, `message` la empresa.

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

## Domain rules

> **Read `docs/DOMAIN_RULES.md` before touching matching, eligibility, licences or the shape of an offer.**
> Each line below is one rule from that file; the file has the reasons, the edge cases and the bugs each rule prevents.

- **Schema first, code second (expand-contract):** apply the migration, then ship the code that reads or writes the new shape; to remove a column, stop reading it first and drop it afterwards.
- **Catalogs with a TTL cache:** `aircraft_type_ratings` is read through `catalogRepository`, `aircraftTypeRatingsCache` and `useAircraftTypeRatingsCatalog`, never from a hardcoded TypeScript constant.
- **A licence is a row:** `technician_licenses.id` is the credential, unique per `(technician_id, authority, license_code)`; habilitations hang off `technician_license_id`. Never join habilitations to licences by `license_code`.
- **The licence upsert's `onConflict`** is a string no compiler checks: it must be `technician_id,authority,license_code`, or every licence save fails with 42P10.
- **No authority defaults:** `offers.license_authority` travels with `offers.license_code`, and every licence entry carries its authority.
- **`licensesSelectableForOffer(type, authority)`** decides which licences an offer can ask for (form chips and repository guard). Implying a technician type is not locking it (`typesImpliedByLicenses` / `typesLockedByLicenses`). The FAA issues no type ratings, so the aircraft of an FAA offer count as experience.
- **Same-row rule:** a licence and an aircraft/engine rating count as held together only when they come from the same `technician_habilitations` row.
- **Matching principle:** required certification drives the score and its ceilings; engine evidence is one weighted component; a match is not a legal determination of certification privileges.
- **One credential per (offer, technician) pair,** chosen in `selectLicenseForOffer`; every requested aircraft is evaluated under it.
- **`licenseCodeSatisfies` is the only licence-code comparison.**
- **Expiry:** ask `authorityLicenseCanExpire` before looking at the date (FAA and CASA licences do not expire as documents).
- **Authority equivalence is a multiplier, not a tier:** `offers.accepted_authorities`; the FAA counts through `FAA_EQUIVALENT_CODES`; an FAA offer accepts one Part-66 category through `offers.accepted_license_code`. The SQL mirrors are checked by `validate:authority-licenses`.
- **An engine offer changes four things at once** (`offerAsksForQualification`, the engine weights, `zeroOnRequestedAxis` on the engine axis, and the technician-type cap); removing any of them brings back a known bug.
- **Engine axis:** declared > implicit in a B1 type rating > same family > same engine type > different type > none. The implicit engine comes only from `engineId` and only from B1 habilitations; `isGeneric` is not `isActive`; CFM56/V2500 link to a variant only when a rating admits one; no engines scores low but not zero; years never score.
- **Declared engines belong to the Engine Technician type (091),** enforced by the database; the profile saves types before engines.
- **Eligibility has two filters in `isTechnicianEligibleForOffer`** (engine-offer entry and `only_unlicensed`), applied in both ranking directions; any new pair filter goes into that core and its SQL mirror.
- **The database enforces eligibility on applications** (`enforce_offer_application_eligibility`, PT403), also on accept. `can_act_for_company` returns NULL for non-members: guard with `COALESCE(…, false)`.
- **The eligibility rule lives in TS and SQL:** change both (the SQL in a new migration) and run `validate:application-eligibility` (`-- --rehearse=<migration>` before applying).
- **Offer shape** is enforced by CHECKs and triggers and mirrored by `offerShapeViolations`; `offerRepository.update` computes the result with `resolveOfferPatch`; `update_offer_with_habilitations` is atomic.
- **H3:** profile type ratings only under B1.x, B2 and C, with product and propulsion resolved by `engine_id` (083 enforces it in the database).
- **Offer form transitions** live in `src/utils/offerFormRules.ts` (`npm run test:offer-form`); the offer kind follows the technician type.
- **`getTechnicianMatchesForOffer` / `getOfferMatchesForTechnician`** only delegate to the ranking functions; `catalogRepository.getEngines()` returns inactive engines too.
- **No screen calls `calculateOfferTechnicianMatch`:** screens use `matchPair`/`matchPairs` (`PairMatch`), and company search never falls back to an unfiltered list.
- **`MatchScore.breakdown` has six components;** read the maxima from `getMatchScoreWeights`, never hardcode them.

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

The code and `supabase/migrations/` are the source of truth. Current docs:
- docs/DOMAIN_RULES.md — the domain rules in full (one-line summary under "Domain rules")
- docs/MIGRATIONS_LOG.md — application record of each migration
- docs/UI_REDESIGN.md — visual style reference for the company and technician areas
- docs/fase-10.md — engines, authorities, matching and eligibility (Fase 10, migrations 064–097)
- docs/ACCOUNTS_AND_SIGNUP.md — signup, roles, offer writes, minimum age, account deletion and invitations (101–105)
- docs/MODERATION.md — reports, blocks and the store-review test accounts (100, 106)
- docs/PHASE_7_IMAGES_PLAN.md — profile photos and company logos (098, 099)
- docs/OFFER_SALARY.md — optional gross remuneration on offers (062, 063)
- docs/STORE_PRIVACY_DECLARATIONS.md — App Store / Play privacy declarations (`validate:store-privacy`)
- docs/PWA.md — the installable web app

Out of date, pending a merge into `docs/DEPLOYMENT.md`: docs/ENVIRONMENT.md, docs/DEPLOYMENT_CHECKLIST.md, docs/V2_S1_ADMIN_BOOTSTRAP_SQL.sql.

Historical context, may be out of date: docs/PRODUCT_CONTEXT_V2.md, docs/USER_FLOWS_V2.md. Historical records (not current rules): docs/MISSION_PART66.md, docs/FINAL_AUDIT_REPORT.md, docs/PHASE5_INVENTORY.md, docs/RLS_OPERATION_AUDIT_2026-07-23_REPORT.md, docs/OFFER_DELETE_SOFT_DELETE_PROPOSAL.md, docs/DELETED_ACCOUNT_ANONYMIZATION_PROPOSAL.md, docs/archive/.

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

⚠ `npm run test:db` is the one that **writes to the live development database**
(`rwauwuremzkizeoginza`, the only Supabase project today; it is dev, not
production) — `test:database` and `test:habilitation-scope:database`. Everything
goes inside `BEGIN … ROLLBACK` and both runners check afterwards that nothing was
left behind, but while a run lasts it injects triggers and, in rehearsal mode,
replaces installed functions, so a concurrent real write can block on it. Never
run it in parallel with itself, and never assume `npm test` covers it.

**Dev-only lock (2026-10-16).** Every script that writes to the database, even
inside a rollback — `test:db`, the `test:*:database` runners, `rehearse*.cjs` and
the validators' `--rehearse=` mode — first calls
`scripts/lib/devDatabaseGuard.cjs`, which stops with exit code 1 and a clear
message unless every `EXPO_PUBLIC_SUPABASE_URL` it can see (`.env`, the shell,
the URL a helper receives) is `https://rwauwuremzkizeoginza.supabase.co`. A new
writer script must call `assertDevDatabase()` before reading or sending
anything; `npm run test:dev-db-guard` (offline, in `npm test`) fails if a script
under `scripts/` calls the Management API without being on its list.

Present any new migration and its rollback test results to the user and wait for
explicit confirmation before applying it to the database (today, dev).