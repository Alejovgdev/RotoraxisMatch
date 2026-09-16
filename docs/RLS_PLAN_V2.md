# RLS Plan V2 — AviationJobTalent

Row Level Security policies for the V2 Supabase schema.
Do not implement yet. This is a design document.

---

## Guiding principles

1. **Default deny.** Every table has RLS enabled. No implicit access.
2. **Privacy by status.** Identity and documents are locked until `status = accepted` in the relevant offer record.
3. **Blocking is enforced.** A `blocked` or `suspended` user loses read access as if they were unauthenticated.
4. **Role is authoritative.** The `profiles.role` field, not the calling context, determines what a user can do.
5. **Viewer is always read-only.** Company members with `role = viewer` can never write.
6. **Admin overrides all read policies.** Admin can read every row in every table.
7. **Companies never query technician_profiles directly.** All company-facing technician queries go through `technician_public_view`. Direct table access is a privacy violation.
8. **Acceptance side effects are server-side only.** `identity_revealed`, `documents_unlocked`, and chat room creation are set by a DB trigger, never by frontend writes. The frontend only writes the `status` field when accepting or rejecting.
9. **One company per company user in MVP.** Company RLS helpers may assume one primary company. Multi-company membership, company switching, and company context selectors are future scope.
10. **Company member creation is manual in MVP.** No self-service invitations, invite tokens, email invite links, or email onboarding flows are required for V2-S1.
11. **Frontend DTOs are not the security boundary.** TypeScript types (`SafeTechnicianPreview`, `TechnicianUnlockedDTO`) prevent accidental private-field access in React code, but they are not enforced at runtime. The only true security boundary is Supabase RLS + views + RPCs. DTOs and DTOs type aliases exist to catch developer mistakes at compile time, not to enforce access control at runtime.

---

## Frontend DTO boundary

Before Supabase is live, the local demo enforces privacy through TypeScript repository boundaries:

| Context | Type used | Private fields? |
|---------|-----------|-----------------|
| Company screen (before acceptance) | `SafeTechnicianPreview` / `TechnicianPublicPreviewDTO` | None — private cols excluded |
| Company screen (after acceptance) | `UnlockedTechnicianView` / `TechnicianUnlockedDTO` | Identity + docs visible |
| Technician own-profile screen | `TechnicianProfile` / `TechnicianWithRelations` | All fields visible |
| Admin screen | `TechnicianProfile` / `TechnicianWithRelations` | All fields visible |

**Rules for company-facing screens:**
- Only call `technicianRepositoryV2.getSafeView()`, `getViewForCompany()`, or `search()`.
- Never call `getAll()`, `getById()` or `getWithRelations()` from company screens.
- Use `isUnlocked(techView)` as the type guard before accessing any identity field.
- When Supabase is live, replace the repository calls with `technician_public_view` / `search_technicians_public()` / `get_unlocked_technician()` — the DTO shapes stay identical.

---

## Auth helper functions

These Postgres functions are used inside RLS policies to avoid repeating the same subqueries.

```sql
-- Returns the app_role of the calling user
CREATE OR REPLACE FUNCTION auth_role()
RETURNS app_role LANGUAGE sql STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- Returns the user_status of the calling user
CREATE OR REPLACE FUNCTION auth_status()
RETURNS user_status LANGUAGE sql STABLE AS $$
  SELECT status FROM profiles WHERE id = auth.uid()
$$;

-- Returns true if the calling user is active (not blocked/suspended)
CREATE OR REPLACE FUNCTION is_active_user()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT status = 'active' FROM profiles WHERE id = auth.uid()
$$;

-- Returns true if the calling user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT role = 'admin' FROM profiles WHERE id = auth.uid()
$$;

-- Returns the technician_profile.id linked to the calling user
CREATE OR REPLACE FUNCTION my_technician_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM technician_profiles WHERE user_id = auth.uid()
$$;

-- Returns the company_id of the calling company_user.
-- MVP assumption: one company per company user; multi-company membership is future scope.
CREATE OR REPLACE FUNCTION my_company_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1
$$;

-- Returns the company_member_role of the calling user in a given company
CREATE OR REPLACE FUNCTION my_company_role(cid uuid)
RETURNS company_member_role LANGUAGE sql STABLE AS $$
  SELECT role FROM company_members WHERE user_id = auth.uid() AND company_id = cid
$$;

-- Returns true if calling user is a company member who can act (admin or recruiter)
CREATE OR REPLACE FUNCTION can_act_for_company(cid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT role IN ('admin', 'recruiter')
  FROM company_members
  WHERE user_id = auth.uid() AND company_id = cid
$$;

-- Returns true if an accepted offer record exists between a company and a technician
CREATE OR REPLACE FUNCTION offer_accepted_between(cid uuid, tid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM offer_requests
    WHERE company_id = cid AND technician_id = tid AND status = 'accepted'
  ) OR EXISTS (
    SELECT 1 FROM offer_applications
    WHERE company_id = cid AND technician_id = tid AND status = 'accepted'
  )
$$;
```

---

## Table policies

### profiles

| Operation | Who | Condition |
|-----------|-----|-----------|
| SELECT | Owner | `id = auth.uid()` |
| SELECT | Admin | always |
| INSERT | — | Managed by auth trigger, not directly |
| UPDATE | Owner | own row only (status is not user-editable) |
| UPDATE | Admin | any row |

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY profiles_select_admin ON profiles
  FOR SELECT USING (is_admin());

CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_admin ON profiles
  FOR UPDATE USING (is_admin());
```

---

### technician_profiles

> **RULE: Companies must never query `technician_profiles` directly.**
> All company-side technician lookups (search, detail, inbox) must go through `technician_public_view`.
> This is the only table where column-level privacy is required. Bypassing the view is a privacy violation regardless of RLS.

**Core privacy rules:**
- A company can always read the public fields (anonymous_code, technician_type, location_city_id and derived city/country/base airport, verification_status, etc.). SIN age (retirada 2026-07-29, migración 040 — característica protegida, riesgo de discriminación en el cribado).
- A company cannot read private fields (first_name, last_name, email, phone, birth_date, social_links) unless an accepted offer record exists.

**Implementation approach:**
- No company `SELECT` policy is granted on the `technician_profiles` base table.
- Company-facing reads are exposed only through `technician_public_view` / safe RPCs whose returned columns are privacy-gated behind `offer_accepted_between()`.
- Technicians query their own row directly (no view needed — they own all their fields).
- Admin queries the base table directly (admin RLS bypasses the view).

In Supabase, RLS does not selectively reveal columns. A company `SELECT` policy on the base table would expose private columns, so company access must be through a **view/RPC** that enforces column-level privacy:

```sql
ALTER TABLE technician_profiles ENABLE ROW LEVEL SECURITY;

-- Technician can read and update their own profile
CREATE POLICY tp_select_own ON technician_profiles
  FOR SELECT USING (user_id = auth.uid() AND is_active_user());

CREATE POLICY tp_update_own ON technician_profiles
  FOR UPDATE USING (user_id = auth.uid() AND is_active_user())
  WITH CHECK (user_id = auth.uid());

-- Admin can read all
CREATE POLICY tp_select_admin ON technician_profiles
  FOR SELECT USING (is_admin());
```

**Column-level privacy view:**

```sql
CREATE OR REPLACE VIEW technician_public_view AS
SELECT
  tp.id,
  tp.anonymous_code,
  compute_age(tp.birth_date) AS age,
  tp.technician_type,
  tp.location_city_id,
  loc.country_name AS country,
  loc.city,
  COALESCE(loc.iata, loc.icao) AS base_airport,
  loc.latitude,
  loc.longitude,
  tp.availability,
  tp.verification_status,
  tp.profile_completeness,
  -- Include identity fields only if accepted offer exists
  CASE WHEN offer_accepted_between(my_company_id(), tp.id)
    THEN tp.first_name ELSE NULL END AS first_name,
  CASE WHEN offer_accepted_between(my_company_id(), tp.id)
    THEN tp.last_name ELSE NULL END AS last_name,
  CASE WHEN offer_accepted_between(my_company_id(), tp.id)
    THEN tp.email ELSE NULL END AS email,
  CASE WHEN offer_accepted_between(my_company_id(), tp.id)
    THEN tp.phone ELSE NULL END AS phone,
  CASE WHEN offer_accepted_between(my_company_id(), tp.id)
    THEN tp.social_links ELSE NULL END AS social_links
FROM technician_profiles tp
JOIN location_airports loc ON loc.id = tp.location_city_id;
```

> Note: This view is for company queries. Technicians query their own row directly.
> Admin queries the base table via admin RLS.

---

### technician_licenses, technician_habilitations, technician_aircraft_experience

These are always public-safe (no private data).

```sql
-- Each table: same policy pattern

-- Technician can read/write their own rows
CREATE POLICY tl_select_own ON technician_licenses
  FOR SELECT USING (
    technician_id = my_technician_id() AND is_active_user()
  );

CREATE POLICY tl_insert_own ON technician_licenses
  FOR INSERT WITH CHECK (
    technician_id = my_technician_id() AND is_active_user()
  );

CREATE POLICY tl_delete_own ON technician_licenses
  FOR DELETE USING (technician_id = my_technician_id());

-- Company can read licenses of verified technicians
CREATE POLICY tl_select_company ON technician_licenses
  FOR SELECT USING (
    auth_role() = 'company_user' AND is_active_user()
  );

-- Admin can read all
CREATE POLICY tl_select_admin ON technician_licenses
  FOR SELECT USING (is_admin());

-- (Same pattern applies to technician_habilitations and technician_aircraft_experience)
```

---

### documents

Documents are locked by default. A company can read a technician's **verified** documents only after an accepted offer. Pending, rejected, and expired documents are technician/admin-only regardless of acceptance state.

**MVP review model:** Admin manually sets status, `reviewed_at`, and `rejection_reason`. No audit log table, no cron, no `reviewed_by` for V1 Supabase. Technicians can read their own `rejection_reason`. Companies read allowed document metadata only after an accepted relationship. No advanced audit permissions needed for MVP.

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Technician can read their own documents (including status and rejection_reason)
CREATE POLICY docs_select_own ON documents
  FOR SELECT USING (
    technician_id = my_technician_id() AND is_active_user()
  );

-- Technician can upload new documents
CREATE POLICY docs_insert_own ON documents
  FOR INSERT WITH CHECK (
    technician_id = my_technician_id() AND is_active_user()
  );

-- Technicians must NOT update status, reviewed_at, or rejection_reason themselves.
-- Those fields are admin-only. In production, restrict the technician UPDATE policy
-- to only allow updating file_name / storage_path (re-upload use case).
-- For MVP this policy is omitted — technicians cannot update documents from the UI.

-- Company can read only verified documents when documents_unlocked = true in an accepted offer record.
-- status = 'verified' is required: pending/rejected/expired documents are not visible to companies.
CREATE POLICY docs_select_company ON documents
  FOR SELECT USING (
    auth_role() = 'company_user'
    AND is_active_user()
    AND documents.status = 'verified'
    AND (
      EXISTS (
        SELECT 1 FROM offer_requests or2
        WHERE or2.company_id = my_company_id()
          AND or2.technician_id = documents.technician_id
          AND or2.documents_unlocked = true
      )
      OR
      EXISTS (
        SELECT 1 FROM offer_applications oa
        WHERE oa.company_id = my_company_id()
          AND oa.technician_id = documents.technician_id
          AND oa.documents_unlocked = true
      )
    )
  );

-- Admin can read and update all documents (sets status, reviewed_at, rejection_reason)
CREATE POLICY docs_all_admin ON documents
  FOR ALL USING (is_admin());
```

---

### companies

Companies are public entities. Any active authenticated user can read them.

```sql
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Any active authenticated user can read verified companies
CREATE POLICY companies_select_all ON companies
  FOR SELECT USING (is_active_user() AND verification_status = 'verified');

-- Company admin can update their own company
CREATE POLICY companies_update_own ON companies
  FOR UPDATE USING (
    is_active_user()
    AND my_company_role(id) = 'admin'
  );

-- Admin can read and update all
CREATE POLICY companies_all_admin ON companies
  FOR ALL USING (is_admin());
```

---

### company_members

MVP scope: company members are created manually, not through self-service invitations. Enforce one company per company user with a unique `user_id` constraint in the schema; `my_company_id()` may use the single primary membership assumption.

```sql
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;

-- Members of a company can see who else is in the company
CREATE POLICY cm_select_own_company ON company_members
  FOR SELECT USING (
    is_active_user()
    AND company_id = my_company_id()
  );

-- Only company admin can manage members
CREATE POLICY cm_insert_admin ON company_members
  FOR INSERT WITH CHECK (
    is_active_user()
    AND my_company_role(company_id) = 'admin'
  );

CREATE POLICY cm_update_admin ON company_members
  FOR UPDATE USING (
    is_active_user()
    AND my_company_role(company_id) = 'admin'
  );

CREATE POLICY cm_delete_admin ON company_members
  FOR DELETE USING (
    is_active_user()
    AND my_company_role(company_id) = 'admin'
  );

-- Admin can read all
CREATE POLICY cm_all_admin ON company_members
  FOR ALL USING (is_admin());
```

---

### offers

Any active user can read published offers. Only company admin/recruiter can create/update.

```sql
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

-- Any active user can read visible published offers
CREATE POLICY offers_select_published ON offers
  FOR SELECT USING (
    is_active_user()
    AND status = 'published'
    AND visible = true
  );

-- Company can read all their own offers (including drafts)
CREATE POLICY offers_select_own ON offers
  FOR SELECT USING (
    is_active_user()
    AND company_id = my_company_id()
  );

-- Company admin/recruiter can create offers
CREATE POLICY offers_insert_company ON offers
  FOR INSERT WITH CHECK (
    is_active_user()
    AND can_act_for_company(company_id)
  );

-- Company admin/recruiter can update their own offers
CREATE POLICY offers_update_company ON offers
  FOR UPDATE USING (
    is_active_user()
    AND can_act_for_company(company_id)
  );

-- Admin can read/manage all
CREATE POLICY offers_all_admin ON offers
  FOR ALL USING (is_admin());
```

**Same SELECT policies apply to offer_required_technician_types, offer_required_licenses, offer_required_aircraft_types** (visible if the parent offer is visible, or if you're the owning company).

---

### offer_requests

```sql
ALTER TABLE offer_requests ENABLE ROW LEVEL SECURITY;

-- Company can read/write their own offer requests
CREATE POLICY or_select_company ON offer_requests
  FOR SELECT USING (
    is_active_user()
    AND company_id = my_company_id()
  );

CREATE POLICY or_insert_company ON offer_requests
  FOR INSERT WITH CHECK (
    is_active_user()
    AND can_act_for_company(company_id)
  );

-- Company admin/recruiter can update status (withdraw)
CREATE POLICY or_update_company ON offer_requests
  FOR UPDATE USING (
    is_active_user()
    AND can_act_for_company(company_id)
  );

-- Technician can read offer requests addressed to them
CREATE POLICY or_select_technician ON offer_requests
  FOR SELECT USING (
    is_active_user()
    AND technician_id = my_technician_id()
  );

-- Technician can update status (accept/reject) on their own received requests
CREATE POLICY or_update_technician ON offer_requests
  FOR UPDATE USING (
    is_active_user()
    AND technician_id = my_technician_id()
  )
  -- Technician can only change status, not other fields
  WITH CHECK (technician_id = my_technician_id());

-- Admin can read all
CREATE POLICY or_all_admin ON offer_requests
  FOR ALL USING (is_admin());
```

**Server-side enforcement rule:**
The frontend may only request a status transition.
`identity_revealed`, `documents_unlocked`, chat room creation, and activity event creation are handled exclusively by server-side RPC/trigger logic.
If a client attempts to write these fields directly, the update must be rejected — enforce this via a column-level check constraint or a separate trigger that resets them if written outside the accepted transition.

Allowed transitions for both `offer_requests` and `offer_applications`:

| From | Allowed to |
|------|------------|
| pending | accepted, rejected, expired, withdrawn |
| accepted | terminal |
| rejected | terminal |
| expired | terminal |
| withdrawn | terminal |

RPC recommendation:
- `transition_offer_request_status(record_id uuid, next_status offer_request_status)`
- `transition_offer_application_status(record_id uuid, next_status offer_request_status)`

Both RPCs should validate the transition, update status, then run side effects in the same transaction.

---

### offer_applications

```sql
ALTER TABLE offer_applications ENABLE ROW LEVEL SECURITY;

-- Technician can read/create their own applications
CREATE POLICY oa_select_technician ON offer_applications
  FOR SELECT USING (
    is_active_user()
    AND technician_id = my_technician_id()
  );

CREATE POLICY oa_insert_technician ON offer_applications
  FOR INSERT WITH CHECK (
    is_active_user()
    AND technician_id = my_technician_id()
  );

-- Technician can withdraw their own application
CREATE POLICY oa_update_technician ON offer_applications
  FOR UPDATE USING (
    is_active_user()
    AND technician_id = my_technician_id()
  );

-- Company can read applications to their offers
CREATE POLICY oa_select_company ON offer_applications
  FOR SELECT USING (
    is_active_user()
    AND company_id = my_company_id()
  );

-- Company admin/recruiter can update status (accept/reject)
CREATE POLICY oa_update_company ON offer_applications
  FOR UPDATE USING (
    is_active_user()
    AND can_act_for_company(company_id)
  );

-- Admin can read all
CREATE POLICY oa_all_admin ON offer_applications
  FOR ALL USING (is_admin());
```

---

### chat_rooms

```sql
ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;

-- Technician can access their own chat rooms
CREATE POLICY cr_select_technician ON chat_rooms
  FOR SELECT USING (
    is_active_user()
    AND technician_id = my_technician_id()
  );

-- Company can access chat rooms belonging to their company
CREATE POLICY cr_select_company ON chat_rooms
  FOR SELECT USING (
    is_active_user()
    AND company_id = my_company_id()
  );

-- Chat rooms are created by trigger on acceptance, not directly by client
-- No INSERT policy for clients.

-- Admin can read all
CREATE POLICY cr_all_admin ON chat_rooms
  FOR ALL USING (is_admin());
```

---

### chat_messages

```sql
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Anyone in the chat room can read messages
CREATE POLICY cm_select_participant ON chat_messages
  FOR SELECT USING (
    is_active_user()
    AND EXISTS (
      SELECT 1 FROM chat_rooms cr
      WHERE cr.id = chat_messages.chat_room_id
        AND (
          cr.technician_id = my_technician_id()
          OR cr.company_id = my_company_id()
        )
    )
  );

-- Technician can insert messages in their own chat rooms
CREATE POLICY cm_insert_technician ON chat_messages
  FOR INSERT WITH CHECK (
    is_active_user()
    AND sender_user_id = auth.uid()
    AND sender_role = 'technician'
    AND sender_company_member_id IS NULL
    AND EXISTS (
      SELECT 1 FROM chat_rooms cr
      WHERE cr.id = chat_messages.chat_room_id
        AND cr.technician_id = my_technician_id()
    )
  );

-- Company admin/recruiter can insert messages in their company chat rooms
-- Viewer role cannot insert (enforced via can_act_for_company check)
CREATE POLICY cm_insert_company ON chat_messages
  FOR INSERT WITH CHECK (
    is_active_user()
    AND sender_user_id = auth.uid()
    AND sender_role = 'company'
    AND EXISTS (
      SELECT 1 FROM chat_rooms cr
      JOIN company_members cm
        ON cm.company_id = cr.company_id
       AND cm.user_id = auth.uid()
       AND cm.role IN ('admin', 'recruiter')
      WHERE cr.id = chat_messages.chat_room_id
        AND cr.company_id = my_company_id()
        AND can_act_for_company(cr.company_id)
        AND (
          chat_messages.sender_company_member_id IS NULL
          OR chat_messages.sender_company_member_id = cm.id
        )
    )
  );

-- Admin can read all
CREATE POLICY cm_all_admin ON chat_messages
  FOR ALL USING (is_admin());
```

---

### activity_events

Activity events power red dots and notification feeds. Ordinary clients read recipient-scoped events but do not insert them directly; trusted triggers/functions create events when offer/application/chat state changes.

```sql
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

-- Technician can read events addressed to their technician profile
CREATE POLICY ae_select_technician ON activity_events
  FOR SELECT USING (
    is_active_user()
    AND recipient_scope = 'technician'
    AND recipient_technician_id = my_technician_id()
  );

-- Company members can read events addressed to their company
CREATE POLICY ae_select_company ON activity_events
  FOR SELECT USING (
    is_active_user()
    AND recipient_scope = 'company'
    AND recipient_company_id = my_company_id()
  );

-- Admin can read all activity events
CREATE POLICY ae_all_admin ON activity_events
  FOR ALL USING (is_admin());
```

No public INSERT policy is defined for `activity_events`. Use server-side triggers or SECURITY DEFINER functions for event creation.

---

### activity_reads

Read state is per authenticated profile. This keeps company notifications precise when multiple company members share a workspace.

```sql
ALTER TABLE activity_reads ENABLE ROW LEVEL SECURITY;

-- Users can read their own read markers
CREATE POLICY ar_select_own ON activity_reads
  FOR SELECT USING (
    is_active_user()
    AND profile_id = auth.uid()
  );

-- Users can mark only events they are allowed to see as read
CREATE POLICY ar_insert_own ON activity_reads
  FOR INSERT WITH CHECK (
    is_active_user()
    AND profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM activity_events ae
      WHERE ae.id = activity_reads.activity_event_id
        AND (
          (
            ae.recipient_scope = 'technician'
            AND ae.recipient_technician_id = my_technician_id()
          )
          OR
          (
            ae.recipient_scope = 'company'
            AND ae.recipient_company_id = my_company_id()
          )
        )
    )
  );

-- Optional: allow users to restore an unread state for their own markers
CREATE POLICY ar_delete_own ON activity_reads
  FOR DELETE USING (
    is_active_user()
    AND profile_id = auth.uid()
  );

-- Admin can inspect read markers
CREATE POLICY ar_all_admin ON activity_reads
  FOR ALL USING (is_admin());
```

Unread query pattern:

```sql
SELECT ae.*
FROM activity_events ae
LEFT JOIN activity_reads ar
  ON ar.activity_event_id = ae.id
 AND ar.profile_id = auth.uid()
WHERE ar.activity_event_id IS NULL;
```

---

## Blocking enforcement

When a user's `profiles.status` is set to `blocked` or `suspended`, all policies that include `is_active_user()` will fail. This effectively cuts off all data access without deleting any rows.

The `is_active_user()` function checks:
```sql
SELECT status = 'active' FROM profiles WHERE id = auth.uid()
```

A blocked user returns false → all policies that depend on `is_active_user()` deny access.

**Admin queries are not subject to this check** — admins need to be able to view and unblock users.

---

## Server-side enforcement boundary

### What the frontend is allowed to write

| Table | Field | Frontend can write? |
|-------|-------|---------------------|
| profiles | role | **NO** — set by auth trigger on registration; admin UPDATE policy only |
| profiles | status | **NO** — set by admin (block/suspend flows); not user-editable |
| technician_profiles | verification_status | **NO** — admin only (admin-only UPDATE policy; no RPC needed) |
| companies | verification_status | **NO** — admin only (admin-only UPDATE policy; no RPC needed) |
| offer_requests | status transition request only | ✓ via RPC |
| offer_requests | identity_revealed | **NO** — trigger only |
| offer_requests | documents_unlocked | **NO** — trigger only |
| offer_applications | status transition request only | ✓ via RPC |
| offer_applications | identity_revealed | **NO** — trigger only |
| offer_applications | documents_unlocked | **NO** — trigger only |
| chat_rooms | (any field) | **NO** — trigger creates the room |
| activity_events | (any field) | **NO** — trigger/function creates the event |
| activity_reads | own read marker | ✓ |

**Note on admin writes:** Admin users writing `verification_status` directly via UPDATE are intentional and correct — the `is_admin()` RLS policy grants unrestricted UPDATE on the relevant tables. The rows above describe non-admin frontend behavior. Technicians and company users must never write these fields under any circumstances.

The frontend requests a transition only. The server validates the current state and does the rest atomically.

### RPC/Trigger: transition_offer_relation_status

Runs for both `offer_requests` and `offer_applications`.
Validates the allowed transition before writing status. Accepted side effects and activity creation must run in the same transaction.

```sql
-- Pseudocode — full implementation in Supabase migration phase
CREATE OR REPLACE FUNCTION assert_offer_relation_transition(
  old_status offer_request_status,
  new_status offer_request_status
)
RETURNS void AS $$
BEGIN
  IF old_status = new_status THEN
    RETURN;
  END IF;

  IF old_status <> 'pending' THEN
    RAISE EXCEPTION 'Terminal offer relation cannot transition from % to %', old_status, new_status;
  END IF;

  IF new_status NOT IN ('accepted', 'rejected', 'expired', 'withdrawn') THEN
    RAISE EXCEPTION 'Invalid offer relation transition from % to %', old_status, new_status;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION handle_offer_relation_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM assert_offer_relation_transition(OLD.status, NEW.status);

  IF NEW.status = 'accepted' AND OLD.status <> 'accepted' THEN
    NEW.identity_revealed  := true;
    NEW.documents_unlocked := true;

    -- Create the chat room idempotently.
    IF TG_TABLE_NAME = 'offer_requests' THEN
      INSERT INTO chat_rooms (offer_request_id, technician_id, company_id)
      VALUES (NEW.id, NEW.technician_id, NEW.company_id)
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO chat_rooms (offer_application_id, technician_id, company_id)
      VALUES (NEW.id, NEW.technician_id, NEW.company_id)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Insert accepted activity event for the counterparty.
    -- Direct offer: recipient company. Application: recipient technician.
  ELSIF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
    NEW.identity_revealed  := false;
    NEW.documents_unlocked := false;

    -- Insert rejected activity event for the counterparty.
  ELSE
    -- withdrawn/expired do not create rejected activity.
    NEW.identity_revealed  := false;
    NEW.documents_unlocked := false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_offer_request_accepted
  BEFORE UPDATE ON offer_requests
  FOR EACH ROW EXECUTE FUNCTION handle_offer_relation_status_transition();

CREATE TRIGGER trigger_offer_application_accepted
  BEFORE UPDATE ON offer_applications
  FOR EACH ROW EXECUTE FUNCTION handle_offer_relation_status_transition();
```

**Why SECURITY DEFINER?** The trigger must be able to insert into `chat_rooms` even though clients have no INSERT policy on that table. SECURITY DEFINER runs with the permissions of the function owner (a privileged role), not the calling user.

---

## Storage policies

Bucket: `technician-documents` (private)

```sql
-- Only the technician can upload to their own path
CREATE POLICY storage_upload_own ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'technician-documents'
    AND (storage.foldername(name))[1] = my_technician_id()::text
  );

-- Technician can read their own files
CREATE POLICY storage_read_own ON storage.objects
  FOR SELECT USING (
    bucket_id = 'technician-documents'
    AND (storage.foldername(name))[1] = my_technician_id()::text
  );

-- Company can read files only if documents_unlocked = true
CREATE POLICY storage_read_company ON storage.objects
  FOR SELECT USING (
    bucket_id = 'technician-documents'
    AND offer_accepted_between(
      my_company_id(),
      (storage.foldername(name))[1]::uuid
    )
  );

-- Admin can read all files
CREATE POLICY storage_read_admin ON storage.objects
  FOR SELECT USING (
    bucket_id = 'technician-documents'
    AND is_admin()
  );
```

---

## Summary of access matrix

| Table | Technician (own) | Company (verified, active) | Admin |
|-------|-----------------|---------------------------|-------|
| profiles | read/update own | — | read/update all |
| technician_profiles (public fields) | read/update own | read (via view) | read all |
| technician_profiles (private fields) | read own | only after accepted offer | read all |
| technician_licenses | read/write own | read | read all |
| technician_habilitations | read/write own | read | read all |
| technician_aircraft_experience | read/write own | read | read all |
| documents | read/write own | only verified docs if documents_unlocked | read/update all |
| companies | — | read verified | read/update all |
| company_members | — | read own company (admin: write) | read/update all |
| offers | read published | read published + own | read/update all |
| offer_requests | read/update own | read/write own | read all |
| offer_applications | read/write own | read/update own | read all |
| chat_rooms | read own | read own | read all |
| chat_messages | read/write own rooms | read/write own rooms (non-viewer) | read all |
| activity_events | read own recipient events | read own company events | read all |
| activity_reads | read/write own markers | read/write own markers | read all |
