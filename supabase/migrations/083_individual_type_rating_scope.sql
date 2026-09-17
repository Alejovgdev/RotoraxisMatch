-- H3: scope of individual technician type ratings. Additive, no data cleanup.
-- Inventoried before implementation: 8 rows; 0 forbidden categories, 0 B1
-- product/propulsion mismatches, 0 B1 unknown propulsion (2026-09-17).
-- Authority/category membership comes from authority_licenses. This is NOT
-- recognition of every EASA endorsement by every authority; catalog work,
-- group/system endorsements and offer product decisions remain separate.
-- Rehearse with scripts/testHabilitationScopeDatabase.cjs (BEGIN / ROLLBACK).

CREATE OR REPLACE FUNCTION public.individual_type_rating_scope_error(
  p_authority text, p_license_code text, p_rating_id uuid
) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.authority_licenses al JOIN public.authorities a ON a.code=al.authority
      WHERE al.authority=p_authority AND al.license_code=p_license_code AND a.has_type_ratings
        AND al.license_code IN ('B1.1','B1.2','B1.3','B1.4','B2','C')
    ) THEN 'category'
    WHEN NOT EXISTS (SELECT 1 FROM public.aircraft_type_ratings WHERE id=p_rating_id) THEN 'rating'
    WHEN p_license_code IN ('B2','C') THEN NULL
    ELSE (
      SELECT CASE
        WHEN r.product_type IS DISTINCT FROM
          CASE WHEN p_license_code IN ('B1.1','B1.2') THEN 'Aeroplane' ELSE 'Helicopter' END THEN 'product'
        WHEN e.engine_type IS NULL OR e.engine_type NOT IN ('piston','turbofan','turbojet','turboprop','turboshaft') THEN 'unknown_propulsion'
        WHEN (p_license_code IN ('B1.2','B1.4')) IS DISTINCT FROM (e.engine_type='piston') THEN 'propulsion'
        ELSE NULL END
      FROM public.aircraft_type_ratings r LEFT JOIN public.engines e ON e.id=r.engine_id WHERE r.id=p_rating_id
    ) END
$$;

-- INVOKER: credential reads keep the writer's RLS. No private-facts oracle.
CREATE OR REPLACE FUNCTION public.enforce_individual_type_rating_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE credential public.technician_licenses; reason text;
BEGIN
  SELECT * INTO credential FROM public.technician_licenses WHERE id=NEW.technician_license_id FOR SHARE;
  IF NOT FOUND OR credential.technician_id IS DISTINCT FROM NEW.technician_id THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Credential unavailable.';
  END IF;
  reason:=public.individual_type_rating_scope_error(credential.authority,credential.license_code,NEW.aircraft_type_rating_id);
  IF reason IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Individual type rating is outside the licence scope.', DETAIL=reason;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER enforce_individual_type_rating_scope
  BEFORE INSERT OR UPDATE OF technician_id,technician_license_id,license_code,aircraft_type_rating_id
  ON public.technician_habilitations FOR EACH ROW EXECUTE FUNCTION public.enforce_individual_type_rating_scope();

-- Also guard changes to the parent credential; no reliance on the client
-- preserving authority/category or on which order future FK updates use.
CREATE OR REPLACE FUNCTION public.enforce_credential_type_rating_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.technician_habilitations h WHERE h.technician_license_id=OLD.id
    AND public.individual_type_rating_scope_error(NEW.authority,NEW.license_code,h.aircraft_type_rating_id) IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Existing type rating is outside the new licence scope.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER enforce_credential_type_rating_scope
  BEFORE UPDATE OF authority,license_code ON public.technician_licenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_credential_type_rating_scope();

REVOKE ALL ON FUNCTION public.individual_type_rating_scope_error(text,text,uuid),
  public.enforce_individual_type_rating_scope(), public.enforce_credential_type_rating_scope() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.individual_type_rating_scope_error(text,text,uuid),
  public.enforce_individual_type_rating_scope(), public.enforce_credential_type_rating_scope() TO authenticated;
