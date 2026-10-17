# Product Context V2 — AviationJobTalent

> **Historical context (June 2026).** It may be out of date: the code and
> `supabase/migrations/` are the source of truth (see CLAUDE.md, "Important docs").

AviationJobTalent V2 is a bidirectional aviation marketplace connecting verified technicians with companies, MROs, airlines, operators, and recruitment agencies.

## Marketplace model

V2 is **bidirectional** — two independent directions:

| Direction | Actor | Action |
|-----------|-------|--------|
| Company → Technician | Company | Searches anonymous profiles, sends direct offer |
| Technician → Job Offer | Technician | Browses published offers, applies |

Both paths converge into the same acceptance flow.

## Roles

- **Technician** — creates profile, applies to offers, receives direct offers from companies
- **Company** — multi-user organization; publishes offers, searches technicians, sends direct offers
- **Admin** — verifies users and documents, reviews reports, can block users

## Technician types

| Type | License required |
|------|-----------------|
| mechanic | Yes (Part-66 A or B1.x) |
| avionic | Yes (Part-66 B2 or B2L) |
| sheet_metal_worker | No |
| painter | No |
| composite | No |
| pilot | Standby — not active in V2 |

## Licenses (EASA Part-66)

A1, A2, A3, A4, B1.1, B1.2, B1.3, B1.4, B2, B2L, B3, L, C

## Aircraft habilitations

- A habilitation is a type rating tied to a specific license category.
- A technician can hold a license without any habilitation.
- Aircraft experience is stored per aircraft type regardless of whether a habilitation exists.
- Experience and habilitation are separate fields.

## Privacy model

### Before acceptance
Company sees:
- anonymousCode (alias)
- ~~age~~ — RETIRADA del contrato público (retirada 2026-07-29, migración 040 — característica protegida, riesgo de discriminación en el cribado). Ni la edad ni birthDate salen hacia una empresa.
- country, city, baseAirport
- technicianType
- licenses, habilitations
- availability
- verificationStatus
- matchScore for this offer (only when browsing within an offer context — see Matching model)

Company does NOT see:
- firstName, lastName
- email, phone
- birthDate (raw)
- documents

### After acceptance
Automatically unlocked:
- Full identity: firstName, lastName, email, phone
- All documents
- Chat

## Job offers

Companies publish offers visible to technicians. Fields include:
- title, description
- contractType (permanent | short_term | long_term)
- location (country, city, optional baseAirport)
- requiredTechnicianType
- requiredLicenses
- requiredAircraftTypes
- minYearsExperience
- visible (published/draft)
- expiresAt

## Offer request flow

**Path A — Company sends direct offer to technician:**
1. Company finds anonymous technician in search.
2. Company sends offer (with or without a linked job offer).
3. Technician receives full offer detail.
4. Technician accepts or rejects.

**Path B — Technician applies to job offer:**
1. Technician browses visible offers.
2. Technician applies (optional cover note).
3. Company sees application (technician still anonymous).
4. Company accepts or rejects.

**On acceptance (both paths):**
- Counter-party notified.
- Chat room opens.
- Technician identity revealed to company.
- Technician documents unlocked for company.

**On rejection (both paths):**
- Counter-party notified.
- No chat. Data remains locked.

## Company structure

- A company has multiple users.
- User roles: admin | recruiter | viewer
- Viewer can browse but not send offers or accept.
- Recruiter can send offers, accept, and message.
- Admin manages company settings and team.

## Company types

MRO | airline | recruitment_agency | helicopter_operator | other

## Contract types

permanent | short_term | long_term

## Matching model

**A match score is always calculated for a specific Offer + Technician pair.**
The same technician can score 90% for Offer A and 30% for Offer B.
Match scores are never stored on a technician profile.

### Company UX
- The main matching view is **offer-centric**: the company selects or opens an offer, then sees technicians ranked by match % for that specific offer.
- Each technician card says **"X% match for this offer"**.
- If the company browses technicians without selecting an offer, no match % is shown. The card says **"Select an offer to calculate match"**.

### Technician UX
- When a technician browses published offers, each offer card shows **"X% match with your profile"**.
- The score uses the same calculation function.

### Never show a match % without knowing the offer it belongs to.
Every displayed match score must be tied to a specific `offerId` + `technicianId` pair.

### Scoring criteria
1. verificationStatus = verified → +25
2. At least one habilitation matches required aircraft types → +25
3. At least one license matches required licenses → +20
4. Availability contractTypes includes offer contractType → +15
5. Total aircraft experience ≥ minYearsExperience → +10
6. Same city or base airport as offer location → +5
7. **Maximum: 100**

Match labels:
- 80–100: Excellent match
- 60–79: Strong match
- 40–59: Partial match
- < 40: Low match

## Document statuses

pending | verified | rejected | expired

## Admin responsibilities

- Manual minimum verification before profiles appear in search results.
- Can block technicians and companies.
- Reviews technician profiles, company profiles, documents, and user reports.
- Views all offer requests and applications (read-only overview).
