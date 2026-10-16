-- Emergency undo for 106. Prepared only, NOT applied with the migration.
-- Restores technician_public_view, offers_select_published and
-- companies_select_all exactly as they were before 106, and removes the guard
-- trigger, the three functions and the column profiles.is_test_account.
-- Afterwards real users see the test accounts again (search, map, offers,
-- companies). Which accounts were marked is LOST with the column: list them
-- first (docs/MODERATION.md, "Cuentas de prueba para los revisores") if they
-- may need marking again.
-- For a permanent reversal, register these statements as a NEW migration.

BEGIN;

CREATE OR REPLACE VIEW public.technician_public_view AS
 SELECT tp.id,
    tp.anonymous_code,
    tp.technician_type,
    lc.name AS country,
    tp.location_city_name AS city,
    tp.location_city_lat AS latitude,
    tp.location_city_lng AS longitude,
    tp.location_country_code,
    tp.location_city_name,
    tp.location_city_lat,
    tp.location_city_lng,
    tp.location_city_geoname_id,
    tp.availability,
    tp.verification_status,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.first_name
            ELSE NULL::text
        END AS first_name,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.last_name
            ELSE NULL::text
        END AS last_name,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.email
            ELSE NULL::text
        END AS email,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.phone
            ELSE NULL::text
        END AS phone,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.social_links
            ELSE NULL::jsonb
        END AS social_links,
    tp.years_experience,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.photo_path
            ELSE NULL::text
        END AS photo_path
   FROM technician_profiles tp
     JOIN location_countries lc ON lc.code = tp.location_country_code
     JOIN profiles p ON p.id = tp.user_id
  WHERE is_active_user() AND (p.status = ANY (ARRAY['active'::user_status, 'pending_verification'::user_status]));

ALTER POLICY offers_select_published ON public.offers
  USING (is_active_user() AND status = 'published'::offer_status AND visible = true);

ALTER POLICY companies_select_all ON public.companies
  USING (is_active_user() AND verification_status = 'verified'::verification_status);

DROP TRIGGER guard_profiles_test_account ON public.profiles;
DROP FUNCTION public.guard_profiles_test_account();
DROP FUNCTION public.is_test_viewer();
DROP FUNCTION public.is_test_company(uuid);

ALTER TABLE public.profiles DROP COLUMN is_test_account;

NOTIFY pgrst, 'reload schema';

COMMIT;
