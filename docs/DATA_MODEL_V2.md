# Data Model V2 — AviationJobTalent

This document is the technical source of truth for the V2 data model.
It explains every entity, its purpose, required vs optional fields, relationships, and design decisions.

---

## Entity overview

```
profiles (auth bridge)
├── technician_profiles
│   ├── technician_licenses        → license_categories (catalog)
│   ├── technician_habilitations   → license_categories + aircraft_types (catalog)
│   ├── technician_aircraft_experience → aircraft_types (catalog)
│   └── documents
│
└── company_members ←→ companies
                         └── offers
                               ├── offer_required_licenses        → license_categories
                               ├── offer_required_aircraft_types  → aircraft_types
                               └── offer_required_technician_types → technician_types

location_airports ← technician_profiles / companies / offers

offer_requests (company → technician)  ──→ chat_rooms → chat_messages
offer_applications (technician → offer) ──→ chat_rooms → chat_messages

offer_requests / offer_applications / chat_messages ──→ activity_events → activity_reads
```

---

## Catalog tables

Catalog tables store reference data that must be editable without a code deployment.
They use a `code` primary key (short string) instead of integer IDs for readability in foreign keys.

### technician_types

Defines the types of aviation professional in the system.

| Field | Type | Notes |
|-------|------|-------|
| code | TEXT (PK) | e.g. `mechanic`, `avionic` |
| label | TEXT | Human-readable label |
| requires_license | BOOLEAN | true for mechanic, avionic |
| is_active | BOOLEAN | false = pilot (standby in V2) |
| sort_order | INT | Display ordering |

Seed values: `mechanic`, `avionic`, `sheet_metal_worker`, `painter`, `composite`, `pilot` (inactive).

### license_categories

EASA Part-66 license categories. Catalog table because new license types can emerge.

| Field | Type | Notes |
|-------|------|-------|
| code | TEXT (PK) | e.g. `B1.1`, `B2` |
| label | TEXT | Full description |
| category_group | TEXT | `A`, `B1`, `B2`, `B3`, `L`, `C` |
| sort_order | INT | |

Seed values: A1, A2, A3, A4, B1.1, B1.2, B1.3, B1.4, B2, B2L, B3, L, C.

### aircraft_types

Aircraft type codes. New types can be added at any time without migrations.

| Field | Type | Notes |
|-------|------|-------|
| code | TEXT (PK) | e.g. `A320`, `B737`, `H135` |
| label | TEXT | Full name |
| manufacturer | TEXT | optional |
| aircraft_family | TEXT | narrow_body / wide_body / helicopter / turboprop / piston |
| aircraft_category | TEXT | `airplane` or `helicopter` — CHECK constraint enforced |
| is_active | BOOLEAN | |

**MVP catalog (33 types, 24 airplanes + 9 helicopters):**
- Airplanes (24): A220, A318, A319, A320, A321, A330, A340, A350, A380, B737, B747, B757, B767, B777, B787, ATR42, ATR72, Q400, CRJ200, CRJ700, CRJ900, E175, E190, E195
- Helicopters (9): H125, H135, H145, S76, S92, B407, B412, AW139, R44

**MVP catalog note:** Aircraft type codes are intentionally simplified — one code per aircraft family. More granular variant codes (`B737NG`, `B737CL`, `B737M`, `EC135`, `DH8D`, `AS350`) can be introduced as separate catalog rows in a later migration if clients need them. (Superseded: migration 030 dropped `aircraft_types`; `src/constants/aircraftTypes.ts` and `docs/SUPABASE_SCHEMA_V2.sql` no longer exist.)

### company_types

| Field | Type | Notes |
|-------|------|-------|
| code | TEXT (PK) | `MRO`, `airline`, `recruitment_agency`, `helicopter_operator`, `other` |
| label | TEXT | |
| sort_order | INT | |

### contract_types

| Field | Type | Notes |
|-------|------|-------|
| code | TEXT (PK) | `permanent`, `long_term`, `short_term` |
| label | TEXT | |
| sort_order | INT | |

### location_airports

Canonical location catalog for cities/base airports. App entities should reference this table instead of storing free-text location fields.

MVP uses a curated initial catalog of relevant aviation hubs, not a complete worldwide airport database. New airport rows can be added later without schema changes.

| Field | Type | Notes |
|-------|------|-------|
| id | TEXT (PK) | Stable FK, e.g. `airport:LEVC` |
| country_name | TEXT | Display country |
| city | TEXT | Display city |
| airport | TEXT | Airport display name |
| icao | TEXT | Unique ICAO code |
| iata | TEXT | Optional IATA code |
| latitude | DOUBLE PRECISION | Map marker latitude |
| longitude | DOUBLE PRECISION | Map marker longitude |
| is_active | BOOLEAN | Allows hiding catalog entries without breaking old records |

---

## Core tables

### profiles

Bridge between Supabase Auth and application-level roles.
One row per authenticated user. id = auth.users.id.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | UUID = auth.users.id |
| role | ✓ | `technician` \| `company_user` \| `admin` |
| status | ✓ | user_status enum, default `pending_verification` |
| created_at | ✓ | |

**user_status values:**
- `pending_verification` — account created, awaiting admin review
- `active` — verified and fully operational
- `blocked` — permanently blocked by admin, no access
- `suspended` — temporarily suspended

**Design decision:** Separating `status` (account-level) from `verification_status` in technician/company (profile-level) allows an account to be blocked even if the profile was previously verified.

---

### technician_profiles

The technician's profile. Contains both private (identity) and public (professional) fields.

| Field | Required | Privacy | Notes |
|-------|----------|---------|-------|
| id | ✓ | — | UUID PK |
| user_id | ✓ | — | FK → profiles.id |
| anonymous_code | ✓ | public | Generated alias, e.g. `TECH-4821` |
| first_name | ✓ | **private** | Hidden until offer accepted |
| last_name | ✓ | **private** | Hidden until offer accepted |
| email | ✓ | **private** | Hidden until offer accepted |
| phone | — | **private** | Hidden until offer accepted |
| birth_date | ✓ | **private** | Date — NUNCA sale, ni siquiera derivada como `age` (retirada 2026-07-29, migración 040 — característica protegida, riesgo de discriminación en el cribado) |
| technician_type | ✓ | public | FK → technician_types.code |
| location_city_id | ✓ | public | FK → location_airports.id. Country, city, base airport and coordinates are derived from catalog |
| availability | ✓ | public | JSONB (see shape below) |
| verification_status | ✓ | public | verification_status enum |
| profile_completeness | ✓ | public | 0–100 computed |
| social_links | — | private→public | JSONB, unlocked on acceptance |
| created_at | ✓ | — | |
| updated_at | ✓ | — | |

**Availability JSONB shape:**
```json
{
  "immediately": true,
  "available_from": null,
  "contract_types": ["permanent", "long_term"]
}
```

**Why JSONB for availability?** Availability is a small, always-read-together unit. Normalizing it into a separate table adds a join for no benefit in the MVP. It can be refactored later if availability slots become complex.

**Design decision — phone as optional:** Phone is collected if the technician provides it, but it is not required for the profile to be useful. Email is sufficient for initial contact after acceptance.

---

### technician_licenses

Normalized relation between a technician and their held licenses.
A technician without licenses (e.g. sheet_metal_worker) simply has no rows here.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | UUID PK |
| technician_id | ✓ | FK → technician_profiles.id |
| license_code | ✓ | FK → license_categories.code |
| issued_at | — | Date of issue |
| expires_at | — | Expiry date if applicable |
| created_at | ✓ | |

**Unique constraint:** (technician_id, license_code) — one row per license per technician.

---

### technician_habilitations

Aircraft type ratings tied to a specific license. A technician can hold a license without any habilitation.
Experience (hours/years) is stored separately — these two are independent.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| technician_id | ✓ | FK → technician_profiles.id |
| license_code | ✓ | FK → license_categories.code |
| aircraft_type_code | ✓ | FK → aircraft_types.code |
| issued_at | — | |
| expires_at | — | |
| created_at | ✓ | |

**Unique constraint:** (technician_id, license_code, aircraft_type_code).

---

### technician_aircraft_experience

Logged experience per aircraft type. Independent of licenses or habilitations.
A technician may have years of experience on an aircraft for which they hold no formal type rating.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| technician_id | ✓ | FK → technician_profiles.id |
| aircraft_type_code | ✓ | FK → aircraft_types.code |
| value | ✓ | Number (hours or years) |
| unit | ✓ | `hours` \| `years` |
| created_at | ✓ | |

**Unique constraint:** (technician_id, aircraft_type_code) — one experience row per aircraft per technician.

**Catalog constraint:** `aircraft_type_code` must reference a valid entry in `aircraft_types`. Generic or non-catalog codes such as `GENERAL` are not valid and must never be written. If no aircraft type is known, no experience row should be created. The V1 flat `yearsExperience` field is a display adapter only — it must not be migrated to `technician_aircraft_experience` as a `GENERAL` row.

---

### companies

A company is an organization that hires technicians. It is public (identity not hidden).
A company can have multiple users via `company_members`.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| name | ✓ | Company display name |
| location_city_id | ✓ | FK → location_airports.id. Company stores only this FK for location |
| phone | — | |
| email | ✓ | Contact / admin email |
| company_type | ✓ | FK → company_types.code |
| verification_status | ✓ | verification_status enum |
| created_at | ✓ | |
| updated_at | ✓ | |

Country/city/base airport are read models derived by joining `location_airports`.
Do not persist duplicate location text on `companies`.

---

### company_members

Links auth users to companies with a role. One company can have many members, but each company user belongs to only one company in the MVP.

MVP member creation is manual/demo-only. There is no self-service invitation flow, no invite token, no email invite link, and no Resend/email onboarding path in V2-S1.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| company_id | ✓ | FK → companies.id |
| user_id | ✓ | FK → profiles.id |
| role | ✓ | `admin` \| `recruiter` \| `viewer` |
| created_at | ✓ | |

**Unique constraints:** (company_id, user_id) and, for the MVP, (user_id). Multi-company membership is future scope.

**Role capabilities:**

| Action | admin | recruiter | viewer |
|--------|-------|-----------|--------|
| Browse technicians | ✓ | ✓ | ✓ |
| Browse offers | ✓ | ✓ | ✓ |
| Publish offers | ✓ | ✓ | ✗ |
| Send direct offers | ✓ | ✓ | ✗ |
| Accept/reject applications | ✓ | ✓ | ✗ |
| Send chat messages | ✓ | ✓ | ✗ |
| Manage team | ✓ | ✗ | ✗ |
| Manage company settings | ✓ | ✗ | ✗ |

---

### offers

Job offers published by companies, visible to technicians.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| company_id | ✓ | FK → companies.id |
| title | ✓ | Short title |
| description | ✓ | Full description |
| contract_type | ✓ | FK → contract_types.code |
| location_city_id | ✓ | FK → location_airports.id |
| location_country | ✓ | Controlled snapshot copied from location_airports |
| location_city | ✓ | Controlled snapshot copied from location_airports |
| location_base_airport | ✓ | Controlled snapshot copied from location_airports (IATA when available, otherwise ICAO) |
| min_years_experience | ✓ | Default 0 |
| status | ✓ | `draft` \| `published` \| `closed` \| `expired` |
| visible | ✓ | true only when published |
| expires_at | — | If null, no expiry |
| created_at | ✓ | |
| updated_at | ✓ | |

Offer location uses a FK plus controlled snapshot. The FK powers matching and future joins;
the snapshot preserves the location text shown in the historical job advert. The snapshot
must be generated from `location_airports` on create/update, not edited independently.

**Required technician types, licenses, and aircraft types** are stored in three relation tables:
- `offer_required_technician_types`
- `offer_required_licenses`
- `offer_required_aircraft_types`

All three are optional (no requirements = open offer). PK = composite (offer_id + code):
- `offer_required_technician_types`: `(offer_id, technician_type_code)`
- `offer_required_licenses`: `(offer_id, license_code)`
- `offer_required_aircraft_types`: `(offer_id, aircraft_type_code)`

**Local demo note:** Local seed rows include a human-readable `id` field (e.g. `ort-001`, `orl-001`, `orat-001`) for demo readability. This field is **not** part of the Supabase schema — these tables have no surrogate PK column. When importing to Supabase, drop the local `id` field and insert using the composite key columns only. Duplicate composite-key pairs must be rejected before import.

---

### offer_requests

A company sends a direct offer to a specific technician.
Optionally linked to a published offer.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| company_id | ✓ | FK → companies.id |
| technician_id | ✓ | FK → technician_profiles.id |
| offer_id | — | FK → offers.id — optional link |
| status | ✓ | offer_request_status, default `pending` — frontend writes this only |
| identity_revealed | ✓ | **READ-ONLY** — set by trigger on acceptance, never by frontend |
| documents_unlocked | ✓ | **READ-ONLY** — set by trigger on acceptance, never by frontend |
| message | — | Optional note from company |
| created_at | ✓ | |
| updated_at | ✓ | |

**offer_request_status values:** `pending` \| `accepted` \| `rejected` \| `expired` \| `withdrawn`

- `expired` — set server-side when the offer or request expires without a response (never by the frontend)
- `withdrawn` — set by the initiating party (company withdraws a direct offer; technician withdraws an application)

**Allowed status transitions:**

| From | To |
|------|----|
| pending | accepted |
| pending | rejected |
| pending | expired |
| pending | withdrawn |
| accepted | terminal |
| rejected | terminal |
| expired | terminal |
| withdrawn | terminal |

Status side effects are server-owned:
- `accepted` unlocks identity/documents and creates chat.
- `accepted` and `rejected` create counterparty activity events.
- `withdrawn` and `expired` do not masquerade as rejected events.

**Design decision — no strict uniqueness on (company, technician, offer):** Direct offers use active-only duplicate enforcement, not global uniqueness.

**H11 MVP rule:**
- **Blocked**: duplicate active direct offer — same `companyId + technicianId + offerId` where status is `pending` or `accepted`.
- **Allowed**: sending a new direct offer after the previous one was `rejected`, `expired`, or `withdrawn` — those are historical records, not active blockers.
- **Allowed**: sending a direct offer for a different `offerId` to the same technician.
- **No DB UNIQUE constraint** on `(company_id, technician_id)` or `(company_id, technician_id, offer_id)`. Supabase enforcement is via RPC validation, not a global unique index.
- If a partial unique index is added later, it must be scoped to active statuses: `WHERE status IN ('pending', 'accepted')`.

Enforcement: `offerRequestRepository.create()` checks active duplicates before inserting. The UI `hasSentRequest()` reflects the same active-only rule.

---

### offer_applications

A technician applies to a published offer.
The company_id is denormalized for query convenience (avoids joining through offers).

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| technician_id | ✓ | FK → technician_profiles.id |
| offer_id | ✓ | FK → offers.id |
| company_id | ✓ | Denormalized from offers.company_id |
| status | ✓ | offer_request_status, default `pending` — frontend writes this only |
| identity_revealed | ✓ | **READ-ONLY** — set by trigger on acceptance, never by frontend |
| documents_unlocked | ✓ | **READ-ONLY** — set by trigger on acceptance, never by frontend |
| cover_note | — | Optional message |
| created_at | ✓ | |
| updated_at | ✓ | |

**Unique constraint:** (technician_id, offer_id) — one application per offer, regardless of status. Reapplication (creating a second application after withdrawn/rejected/expired) is out of scope for MVP. The existing application row is the historical record.

Applications use the same `offer_request_status` transition machine as direct offers:

| From | To |
|------|----|
| pending | accepted |
| pending | rejected |
| pending | expired |
| pending | withdrawn |
| accepted | terminal |
| rejected | terminal |
| expired | terminal |
| withdrawn | terminal |

Status side effects are server-owned:
- `accepted` unlocks identity/documents and creates chat.
- `accepted` and `rejected` create counterparty activity events.
- `withdrawn` and `expired` do not create rejected activity.

---

### chat_rooms

Created only when an offer_request or offer_application is accepted.
Linked to exactly one source: either an offer_request OR an offer_application.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| offer_request_id | one or other | Nullable FK |
| offer_application_id | one or other | Nullable FK |
| technician_id | ✓ | Denormalized for RLS |
| company_id | ✓ | Denormalized for RLS |
| created_at | ✓ | |

**Check constraint:** Exactly one of offer_request_id / offer_application_id must be non-null.
**Partial unique indexes:** Ensure one chat room per offer_request or offer_application.

---

### chat_messages

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| chat_room_id | ✓ | FK → chat_rooms.id |
| sender_user_id | ✓ | FK → profiles.id. This is the real user/profile identity, never a company_id or technician_id |
| sender_company_member_id | optional | FK → company_members.id. Present for company messages when the sender is tied to a company member; null for technician messages |
| sender_role | ✓ | `technician` \| `company` |
| body | ✓ | Message text |
| sent_at | ✓ | Timestamp |

---

### activity_events

Server-created in-app notification events used by red activity dots, unread-first sorting, and future notification center views.
Events represent what happened; read state is stored separately per profile in `activity_reads`.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| type | ✓ | **MVP Phase 1:** `application_received` \| `application_accepted` \| `application_rejected` \| `direct_offer_received` \| `direct_offer_accepted` \| `direct_offer_rejected`. **Future scope:** `chat_message_received` (local demo only; Supabase Phase 1 does not emit this). |
| recipient_scope | ✓ | `technician` \| `company` |
| recipient_technician_id | technician only | FK → technician_profiles.id |
| recipient_company_id | company only | FK → companies.id |
| actor_profile_id | — | FK → profiles.id for the user who caused the event, when known |
| entity_type | ✓ | `offer_request` \| `offer_application` \| `chat_message` |
| entity_id | ✓ | ID of the source entity. Polymorphic by `entity_type` |
| offer_id | — | FK → offers.id when the event belongs to an offer context |
| metadata | ✓ | JSONB for small display/audit details; default `{}` |
| created_at | ✓ | |

**Design decision — event/read split:** A company can have multiple members. A single `read` boolean would either mark the event read for everyone or require duplicating the event per member. `activity_reads` keeps one canonical event and per-user read state.

### activity_reads

Marks one event as read by one authenticated profile.

| Field | Required | Notes |
|-------|----------|-------|
| activity_event_id | ✓ | FK → activity_events.id |
| profile_id | ✓ | FK → profiles.id |
| read_at | ✓ | Timestamp |

**Primary key:** `(activity_event_id, profile_id)`.

Unread query rule:

```sql
SELECT e.*
FROM activity_events e
LEFT JOIN activity_reads r
  ON r.activity_event_id = e.id
 AND r.profile_id = auth.uid()
WHERE r.activity_event_id IS NULL;
```

---

### documents

Technician-uploaded documents. Locked by default — unlocked after offer acceptance.

**MVP review model:** Admin manually changes document status. No audit log, no reviewer identity, no automatic expiration for MVP. Future iterations can add `reviewed_by`, an audit table, and cron-based expiration if real users request them.

| Field | Required | Notes |
|-------|----------|-------|
| id | ✓ | |
| technician_id | ✓ | FK → technician_profiles.id |
| type | ✓ | `license` \| `medical` \| `id` \| `training` \| `resume` \| `other` |
| file_name | ✓ | Original file name |
| storage_path | ✓ | Storage path (local for demo, Supabase Storage later) |
| status | ✓ | document_status, default `pending` |
| uploaded_at | ✓ | |
| reviewed_at | — | Set when admin changes status (verified / rejected / expired); cleared when reset to pending |
| rejection_reason | — | Set when status becomes rejected; cleared on all other transitions |
| expires_at | — | For licenses and time-limited certificates |

---

## Status enums (Postgres)

Using Postgres enums for all status fields because they are bounded business logic values that change only with intentional schema migrations.

| Enum | Values |
|------|--------|
| user_status | pending_verification, active, blocked, suspended |
| verification_status | pending, verified, rejected |
| document_status | pending, verified, rejected, expired |
| offer_request_status | pending, accepted, rejected, expired, withdrawn |
| offer_status | draft, published, closed, expired |
| company_member_role | admin, recruiter, viewer |
| app_role | technician, company_user, admin |
| experience_unit | hours, years |
| sender_role | technician, company |

---

## Privacy rules

### Core invariant

Identity and documents are locked by default and unlocked atomically on acceptance.

```
identity_revealed = (status = 'accepted')
documents_unlocked = (status = 'accepted')
chat_room exists = (status = 'accepted')
```

These three transitions happen together, triggered by a **server-side DB trigger** (`handle_offer_accepted`).

> **Frontend rule:** The frontend only writes `status`. It never writes `identity_revealed`, `documents_unlocked`, or creates `chat_rooms`. These are set by the trigger atomically in the same transaction as the status update.

### Company query rule

> **Companies must never query `technician_profiles` directly.**
> All company-side technician queries (search, detail, inbox preview) must go through `technician_public_view`.
> This view enforces column-level privacy using CASE WHEN to expose private fields only when an accepted offer exists between the company and the technician.
> Technicians query their own profile row directly. Admin queries the base table.

### What companies see before acceptance

- anonymous_code, location_city_id plus derived country, city, base_airport (SIN age (retirada 2026-07-29, migración 040 — característica protegida, riesgo de discriminación en el cribado))
- technician_type, licenses (codes), habilitations, aircraft experience
- availability, verification_status
- match_score **only in offer context** — computed dynamically via `calculateOfferTechnicianMatch(offer, technician)`, never stored on the profile row

### What companies see after acceptance

Everything above, plus:
- first_name, last_name, email, phone
- social_links
- Admin-verified documents only (status = `verified`). Pending, rejected, and expired documents are not included.

### Age derivation

`age = floor(years between birth_date and today)`

`birth_date` is never sent to clients. Age is computed server-side (or in app logic) and exposed as an integer.

---

## Matching score V2

**Rule: match scores are computed per Offer + Technician pair. They are never stored on `technician_profiles`.**

`matching_score` is NOT a column on `technician_profiles`. It is calculated dynamically:

```
calculateOfferTechnicianMatch(offer: OfferWithRequirements, technician: TechnicianWithRelations) → MatchScore
```

`MatchScore` always carries `offerId` + `technicianId` so the caller always knows which pair it belongs to.

For future caching (if needed for performance at scale), an `offer_technician_matches` table can be added.
For MVP, always compute dynamically.

### Scoring criteria

| Criterion | Points |
|-----------|--------|
| verification_status = verified | +25 |
| At least one habilitation matches required aircraft types | +25 |
| At least one license matches required licenses | +20 |
| Availability contract_types includes offer contract_type | +15 |
| Total aircraft experience years ≥ min_years_experience | +10 |
| Same location_city_id, city, or base_airport as offer location | +5 |
| **Maximum** | **100** |

Match labels:
- 80–100: Excellent match
- 60–79: Strong match
- 40–59: Partial match
- < 40: Low match

### Helpers (src/utils/matchingV2.ts)

- `calculateOfferTechnicianMatch(offer, technician)` — pure function, no I/O
- `getTechnicianMatchesForOffer(offerId)` — all technicians ranked by score for a given offer
- `getOfferMatchesForTechnician(technicianId)` — all published offers ranked by score for a given technician

---

## Offer visibility and historical record policy

### Core principle

**Offer visibility controls discovery, not history.**

`offer.visible` and `offer.status` determine whether an offer appears as a new opportunity to technicians browsing job offers. They do not retroactively erase relationships, applications, or direct offers that were created while the offer was active.

### Browse offers (technician)

- Only `published` offers with `visible = true` are returned by `getPublished` / `getPublishedWithRequirements`.
- Closed, expired, and draft offers do not appear as new opportunities.

### Applications (technician → offer)

- `OfferApplication` records are historical and always remain visible to the technician and company, regardless of the linked offer's current status.
- Application status (pending, accepted, rejected) remains visible.
- Chat rooms created on accepted applications remain accessible.
- **Do not remove or hide applications when an offer closes.**
- Technician access: the **My Applications** screen (`/technician/applications`) loads all applications via `getForTechnician()` — not via `getPublishedOffers()`. It is the canonical application history, independent of offer visibility.
- Browse Offers (`/technician/offers`) is for discovery only — published/visible offers ranked by match. My Applications is for history.

### Direct offers / offer requests (company → technician)

| Direct offer status | Linked offer becomes inactive | Technician list behaviour | Technician detail behaviour |
|--------------------|-----------------------------|--------------------------|----------------------------|
| `pending` | Yes | Hidden from list (not actionable) | Shows "Offer closed" banner; Accept disabled |
| `pending` | No | Normal "Pending" card | Normal accept / reject actions |
| `accepted` | Either | Always shown | Offer details + match score shown (historical context); chat remains |
| `rejected` | Either | Shown but deprioritised (sorted lower) | "Declined" status card |
| `expired` / `withdrawn` | Either | Shown in history | Status-specific banner |

Key rules:
- Only **pending** direct offers are subject to offer-status filtering in the technician list (`getForTechnician`).
- **Accepted** direct offers are always returned — the relationship (identity revealed, documents unlocked, chat) is established and must persist.
- **Do not physically delete records.** Closing an offer does not remove `offer_requests` or `offer_applications`.
- Admin and company history always show all records via `getAll` / `getForCompany`.

### Implementation boundary

- `offerRepository.isOfferOpenForTechnicians(offer)` — checks `status === 'published' && visible === true`.
- `offerRequestRepository.getForTechnician(technicianId)` — hides only `pending` requests whose linked offer is inactive. All other statuses are returned unconditionally.
- `offerApplicationRepository.getForTechnician(technicianId)` — returns all applications regardless of offer status.

---

## MVP vs future scope

| Feature | MVP | Future |
|---------|-----|--------|
| Profile completeness calculation | ✓ | |
| Habilitation expiry tracking | ✓ (stored) | Notify on expiry |
| Document expiry | ✓ (stored) | Auto-set expired status |
| Social links visible post-acceptance | ✓ | |
| Pilot technician type | stored, inactive | Activate when ready |
| Availability slots (calendar) | JSONB simple | Normalize if needed |
| Company profile page (public) | ✓ | |
| Multi-language offers | — | i18n layer |
| Offer analytics (views, applications) | — | |
| Email notifications | — | Future scope |
| Realtime chat | — | Future scope |
| Self-service company invitations | — | Future scope |
| Multi-company membership | — | Future scope |
| Complete worldwide airport catalog | — | Add airports on demand |
