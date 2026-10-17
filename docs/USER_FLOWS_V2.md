# User Flows V2 — AviationJobTalent

> **Historical context (June 2026).** It may be out of date: the code and
> `supabase/migrations/` are the source of truth (see CLAUDE.md, "Important docs").

## 1. Technician registration and profile setup

1. User opens app → selects "I am a technician".
2. Creates account (email + password in future auth; demo mode uses local session).
3. Fills profile:
   - firstName, lastName, birthDate
   - technicianType
   - city, country, baseAirport (optional)
   - licenses (if mechanic or avionic)
   - habilitations per license (optional)
   - aircraft experience per type (hours or years)
   - availability (immediately / date / contract types)
   - social links (optional)
4. Uploads documents (license scan, medical, ID, etc.).
5. Profile is in `verificationStatus: pending` until admin verifies.
6. Profile appears in company search only after minimum admin verification.

---

## 2. Company registration and team setup

1. Company account/member is created manually for the MVP (demo/platform admin operation).
2. Company profile is completed with:
   - name, companyType, country, city, phone, email
3. First manually created member becomes company `admin`.
4. Additional company members can be manually created with `recruiter` or `viewer` role.
5. Company appears in the system after admin verification.

No self-service company invitations, invite links, invite tokens, or email invite flows are part of the MVP.

---

## 3. Company publishes a job offer

1. Company user (admin or recruiter) goes to "Job Offers" section.
2. Creates new offer:
   - title, description
   - contractType
   - location
   - requiredTechnicianTypes, requiredLicenses, requiredAircraftTypes
   - minYearsExperience
   - expiresAt (optional)
3. Saves as `draft` or publishes (`status: published`, `visible: true`).
4. Published offer appears in technician job search.
5. Company can close or edit the offer at any time.

---

## 4. Company searches technicians

**Matching rule: a match % is only shown when an offer is selected. Browsing without an offer shows no score.**

### 4a. Offer-centric path (recommended)
1. Company opens a published job offer.
2. Opens "Find Technicians for this Offer".
3. App calls `getTechnicianMatchesForOffer(offerId)` and shows ranked results.
4. Each technician card shows **"X% match for this offer"**.
5. Company can send a direct offer (linked to the open job offer).

### 4b. General technician search (no offer context)
1. Company navigates to "Find Technicians" without selecting an offer.
2. Applies filters: technicianType, licenses, aircraftTypes, availability, location, verificationStatus.
3. Results show anonymous profiles. **No match % is shown.** Cards say **"Select an offer to calculate match"**.
4. Company can still send a direct offer (without a linked job offer).

**Direct offer screen:**
- Company sees: anonymousCode, technicianType, licenses, habilitations, experience, availability. SIN age (retirada 2026-07-29, migración 040 — característica protegida, riesgo de discriminación en el cribado).
- If an offer was pre-selected, the match score for that offer is shown.
- Company writes optional message.
- Company sends offer → OfferRequest created with `status: pending`.

---

## 5. Technician searches job offers

**Browse Offers is for discovery only. My Applications is for history.**

### 5a. Browse Offers (discovery)
1. Technician navigates to "Browse Offers".
2. Applies filters: contractType, requiredLicenses, requiredAircraftTypes, location.
3. App calls `getOfferMatchesForTechnician(technicianId)` — **only `published` + `visible` offers are returned**.
4. Each offer card shows **"X% match with your profile"** (score is offer-specific).
5. Technician opens offer detail: title, description, requirements, location, contract type, **match score prominently displayed**.
6. Technician applies:
   - Optional cover note.
   - OfferApplication created with `status: pending`.
   - **One application per technician per offer.** If an application already exists (any status), no second application can be created. Reapplication is out of scope for MVP.
7. Company receives notification of application.

> Closed, expired, and draft offers never appear in Browse Offers. Offer visibility controls discovery only — existing applications and accepted relationships are not affected when an offer closes.

### 5b. Offer Map (location discovery)
1. Technician opens `/technician/map` from the dashboard or from Browse Offers.
2. The map uses the same `getOfferMatchesForTechnician(technicianId)` source as the list, so only `published` + `visible` offers appear and every score remains offer-specific.
3. A directory city uses its exact stored coordinates. A manual or missing city falls back to the country centroid and uses a dashed marker to communicate that the location is approximate.
4. Offers sharing the same coordinates are grouped under one marker instead of covering one another.
5. Filters cover contract type, aircraft product, match band and eligibility. Selecting a marker shows company, offer, location, match and current application status.
6. "View offer" opens the existing `/technician/offers/[id]` detail, where the technician can review requirements and apply.

### 5c. My Applications (history)
1. Technician navigates to "My Applications".
2. Screen loads **all** offer applications for this technician via `getForTechnician()` — independent of offer status.
3. Each entry shows: offer title, company name, application status, offer status (if not published), applied date.
4. Technician can open the offer detail from history (shows historical context for closed/expired offers).
5. Accepted applications show a direct "Open chat" link.
6. Withdrawn/rejected/expired applications remain permanently in history — no reapplication.

> My Applications is the canonical technician application history. It never disappears when a linked offer closes.

---

## 6. Technician reviews received direct offers

1. Technician navigates to "Direct Offers".
2. The list shows:
   - **Pending** direct offers whose linked offer is still `published` + `visible` — shown as actionable.
   - **Accepted** direct offers — always shown regardless of whether the linked offer is still active (established relationship, chat accessible).
   - **Rejected / expired / withdrawn** — shown in history, sorted below pending and accepted.
   - **Pending** direct offers whose linked offer is now closed/unpublished — hidden from the list (not actionable).
3. Opens offer detail:
   - Company name, position details, match score with profile.
   - If the linked offer has been closed since the direct offer was sent, a "Offer closed" banner appears and Accept is disabled.
   - For accepted offers (even if the linked offer has since closed), full offer details and match score are shown for historical context.
4. Technician accepts or rejects (only for pending + linked offer still active).
5. On acceptance: identity and admin-verified documents are unlocked for the company; a chat room is created.

> **Visibility rule for direct offers:** only pending actionability is tied to the linked offer's current status. Accepted relationships persist regardless of offer lifecycle. Records are never deleted — admin and company history show all records.

---

## 7. Company reviews received applications

1. Company navigates to "My Offers" → selects a JobOffer.
2. Sees list of OfferApplications for that offer.
3. Views anonymous applicant profile (same privacy rules as search).
4. Accepts or rejects.

---

## 8. Acceptance flow (same for both paths)

### When technician accepts an OfferRequest:
1. `OfferRequest.status` → `accepted`
2. `identityRevealed` → `true`
3. `documentsUnlocked` → `true`
4. `ChatRoom` created and linked to the request.
5. Company receives in-app notification.
6. Company can now see: full name, email, phone, and admin-verified documents (status = `verified`).
7. Chat tab becomes accessible.

### When company accepts an OfferApplication:
1. `OfferApplication.status` → `accepted`
2. `identityRevealed` → `true`
3. `documentsUnlocked` → `true`
4. `ChatRoom` created and linked.
5. Technician receives in-app notification.
6. Company can now see full technician identity and admin-verified documents (status = `verified`).
7. Chat opens for both parties.

### Unlocked technician profile (company)

1. After either acceptance path, the company can open the canonical technician profile at `/company/technician/[id]`.
2. The route is reachable from unlocked search/map results, accepted application and direct-offer records, offer candidate cards, and company chats.
3. The screen re-checks the company privacy view on every load. A direct URL never exposes a profile without an accepted relationship.
4. It shows full identity, contact details, professional qualifications, availability, aircraft experience, and admin-verified documents.
5. It does not show a global match score. Match remains specific to an offer + technician pair.
6. There is no separate unlocked-technicians directory; `Search Technicians` remains the company discovery screen.

---

## 9. Rejection flow

1. Status → `rejected`.
2. Counter-party receives notification.
3. No chat is created.
4. Identity remains locked.
5. Documents remain locked.
6. Technician profile returns to anonymous state for that company.

---

## 10. Chat flow

- Chat is accessible only from an accepted OfferRequest or OfferApplication.
- No chat screen is visible before acceptance.
- Both parties (technician and company user) can send messages.
- Company viewers cannot send messages (read-only role).
- Messages are stored in ChatMessages linked to the ChatRoom.

---

## 11. Document unlock flow

- Documents are locked by default — companies cannot see them.
- On offer acceptance: `documentsUnlocked` → `true` automatically.
- `documentsUnlocked = true` means the company may access **eligible** documents — not every document row.
- **Company sees only verified documents** (status = `verified`). Pending, rejected, and expired documents remain visible to the technician and admin only.
- Document files (URLs) are only accessible for verified documents when `documentsUnlocked = true`.

**Access by role:**
| Document status | Technician (own) | Company (after accepted) | Admin |
|----------------|-----------------|--------------------------|-------|
| `verified` | ✅ visible | ✅ visible | ✅ visible |
| `pending` | ✅ visible | ❌ not visible | ✅ visible |
| `rejected` | ✅ visible (+ rejection reason) | ❌ not visible | ✅ visible |
| `expired` | ✅ visible | ❌ not visible | ✅ visible |

---

## 12. Admin verification flow

1. Admin opens admin panel.
2. Reviews pending technician profiles:
   - Checks submitted documents.
   - Sets `verificationStatus` to `verified`, `rejected`, or `blocked`.
3. Reviews pending company profiles:
   - Sets `verificationStatus` accordingly.
4. Reviews individual documents:
   - Sets document `status` to `verified`, `rejected`, or `expired`.
5. Can block any user (technician or company) from appearing in the platform.
6. Read-only overview of all offer requests and applications.

---

## Flow summary table

| Flow | Initiator | Result on acceptance |
|------|-----------|---------------------|
| Direct offer | Company | Identity + docs + chat unlocked |
| Job offer application | Technician | Identity + docs + chat unlocked |
| Document upload | Technician | Awaits admin verification |
| Admin verify technician | Admin | Profile appears in search |
| Admin verify company | Admin | Company can publish offers and search |
