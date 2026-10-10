-- Phase 7 / candidate only. Apply once, ONLY after owner approval.
-- Additive: no existing data/policies/helpers are removed or rewritten.
-- Photos are identity: use the SAME offer_accepted_between gate as the name.
-- No signed photo URLs: SELECT is restricted by Storage operation as well as RLS.
-- Clients upload a NEW random filename, then save its path; no overwrite/upsert.

ALTER TABLE public.technician_profiles ADD COLUMN photo_path text;
ALTER TABLE public.companies ADD COLUMN logo_path text;

ALTER TABLE public.technician_profiles ADD CONSTRAINT technician_photo_path_shape
  CHECK (photo_path IS NULL OR photo_path ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'));
ALTER TABLE public.companies ADD CONSTRAINT company_logo_path_shape
  CHECK (logo_path IS NULL OR logo_path ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'));

COMMENT ON COLUMN public.technician_profiles.photo_path IS
  'Private technician-photos object path, never a public or signed URL. Identity gate matches first_name.';
COMMENT ON COLUMN public.companies.logo_path IS
  'Public company-logos object path. Only company/platform admins may change it.';

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
  ('technician-photos','technician-photos',false,2097152,ARRAY['image/jpeg']),
  ('company-logos','company-logos',true,2097152,ARRAY['image/png']);

-- Text comparison avoids unsafe UUID casts on untrusted object names.
CREATE FUNCTION public.owns_technician_photo(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.is_active_user(),false) AND EXISTS (
    SELECT 1 FROM public.technician_profiles tp
    WHERE tp.user_id=auth.uid()
      AND object_name ~ ('^' || tp.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  )
$$;

CREATE FUNCTION public.can_read_technician_photo(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.is_active_user(),false) AND EXISTS (
    SELECT 1 FROM public.technician_profiles tp
    JOIN public.profiles p ON p.id=tp.user_id
    WHERE tp.photo_path=object_name
      AND p.status IN ('active','pending_verification')
      AND (tp.user_id=auth.uid() OR public.is_admin()
        OR public.offer_accepted_between(public.my_company_id(),tp.id))
  )
$$;

CREATE FUNCTION public.can_manage_company_logo(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.is_active_user(),false) AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE object_name ~ ('^' || c.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$')
      AND (public.my_company_role(c.id)='admin' OR public.is_admin())
  )
$$;

REVOKE ALL ON FUNCTION public.owns_technician_photo(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_technician_photo(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_company_logo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_technician_photo(text), public.can_read_technician_photo(text),
  public.can_manage_company_logo(text) TO authenticated;

CREATE POLICY technician_photo_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='technician-photos' AND (
    (storage.allow_only_operation('object.get_authenticated')
      AND public.can_read_technician_photo(name))
    OR (storage.allow_any_operation(ARRAY['object.get_authenticated','object.upload','object.list','object.list_v2','object.delete','object.delete_many'])
      AND public.owns_technician_photo(name))
  )
);
CREATE POLICY technician_photo_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='technician-photos' AND storage.allow_only_operation('object.upload')
  AND public.owns_technician_photo(name)
);
CREATE POLICY technician_photo_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id='technician-photos' AND public.owns_technician_photo(name)
);
-- No UPDATE policy: changing a photo always uses a new object, preventing stale caches.
-- No sign/sign_many/render.image_sign operation is allowed, including for the owner.

CREATE POLICY company_logo_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='company-logos' AND public.can_manage_company_logo(name)
);
CREATE POLICY company_logo_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='company-logos' AND public.can_manage_company_logo(name)
);
CREATE POLICY company_logo_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id='company-logos' AND public.can_manage_company_logo(name)
);
-- Public logo downloads bypass SELECT RLS by design. Writes never do.

-- Existing row RLS still applies. These guards additionally reject foreign paths,
-- missing objects, and writes to the new column by otherwise privileged users.
CREATE FUNCTION public.guard_profile_image_path() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE object_path text; image_bucket text;
BEGIN
  IF TG_TABLE_NAME='technician_profiles' THEN
    -- Defensive support for a detached profile as well as the existing tombstone.
    IF NEW.user_id IS NULL THEN NEW.photo_path:=NULL; END IF;
    IF TG_OP='UPDATE' THEN
      IF NEW.photo_path IS NOT DISTINCT FROM OLD.photo_path THEN RETURN NEW; END IF;
    ELSIF NEW.photo_path IS NULL THEN RETURN NEW;
    END IF;
    IF auth.uid() IS NOT NULL AND NEW.user_id IS NOT NULL
      AND NOT coalesce(public.is_active_user() AND NEW.user_id=auth.uid(),false)
      AND NOT (NEW.photo_path IS NULL AND EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id=NEW.user_id AND p.status='deleted'
      )) THEN
      RAISE EXCEPTION 'Only the technician may change their photo' USING ERRCODE='42501';
    END IF;
    object_path:=NEW.photo_path; image_bucket:='technician-photos';
  ELSE
    IF TG_OP='UPDATE' THEN
      IF NEW.logo_path IS NOT DISTINCT FROM OLD.logo_path THEN RETURN NEW; END IF;
    ELSIF NEW.logo_path IS NULL THEN RETURN NEW;
    END IF;
    IF auth.uid() IS NOT NULL AND NOT coalesce(public.is_active_user()
      AND (public.my_company_role(NEW.id)='admin' OR public.is_admin()),false) THEN
      RAISE EXCEPTION 'Only an admin may change the company logo' USING ERRCODE='42501';
    END IF;
    object_path:=NEW.logo_path; image_bucket:='company-logos';
  END IF;
  IF object_path IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id=image_bucket AND o.name=object_path
  ) THEN
    RAISE EXCEPTION 'Upload the image before saving its path' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_profile_image_path() FROM PUBLIC;
CREATE TRIGGER guard_technician_photo_path BEFORE INSERT OR UPDATE OF photo_path,user_id
  ON public.technician_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_image_path();
CREATE TRIGGER guard_company_logo_path BEFORE INSERT OR UPDATE OF logo_path
  ON public.companies FOR EACH ROW EXECUTE FUNCTION public.guard_profile_image_path();

-- 039 retains profiles/user_id on account deletion. Extend its tombstone without
-- replacing that function. Storage bytes are cleaned via the delete-account API.
CREATE FUNCTION public.clear_deleted_technician_photo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.technician_profiles SET photo_path=NULL WHERE user_id=NEW.id AND photo_path IS NOT NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_deleted_technician_photo() FROM PUBLIC;
CREATE TRIGGER clear_deleted_technician_photo AFTER UPDATE OF status ON public.profiles
  FOR EACH ROW WHEN (NEW.status='deleted') EXECUTE FUNCTION public.clear_deleted_technician_photo();

-- Append one column: keep all previous columns, grants and view dependencies.
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
  CASE WHEN offer_accepted_between(my_company_id(),tp.id) THEN tp.first_name ELSE NULL::text END AS first_name,
  CASE WHEN offer_accepted_between(my_company_id(),tp.id) THEN tp.last_name ELSE NULL::text END AS last_name,
  CASE WHEN offer_accepted_between(my_company_id(),tp.id) THEN tp.email ELSE NULL::text END AS email,
  CASE WHEN offer_accepted_between(my_company_id(),tp.id) THEN tp.phone ELSE NULL::text END AS phone,
  CASE WHEN offer_accepted_between(my_company_id(),tp.id) THEN tp.social_links ELSE NULL::jsonb END AS social_links,
  tp.years_experience,
  CASE WHEN offer_accepted_between(my_company_id(),tp.id) THEN tp.photo_path ELSE NULL::text END AS photo_path
FROM public.technician_profiles tp
JOIN public.location_countries lc ON lc.code=tp.location_country_code
JOIN public.profiles p ON p.id=tp.user_id
WHERE is_active_user() AND p.status IN ('active','pending_verification');

DO $$ BEGIN
  IF (SELECT public FROM storage.buckets WHERE id='technician-photos') IS DISTINCT FROM false
    OR (SELECT public FROM storage.buckets WHERE id='company-logos') IS DISTINCT FROM true THEN
    RAISE EXCEPTION '098: incorrect image bucket visibility';
  END IF;
  IF EXISTS (SELECT 1 FROM public.technician_profiles WHERE photo_path IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.companies WHERE logo_path IS NOT NULL) THEN
    RAISE EXCEPTION '098: first application expects empty optional image columns';
  END IF;
END $$;
