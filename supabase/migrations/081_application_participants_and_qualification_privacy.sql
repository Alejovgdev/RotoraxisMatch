-- Fase 10, paso 5d / H4, H5, H15. Additive; no existing rows are rewritten.
-- Client identity fields are immutable. Service maintenance still goes through
-- the eligibility trigger when it changes the offer.
CREATE OR REPLACE FUNCTION public.guard_application_participants()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') AND
     (NEW.offer_id IS DISTINCT FROM OLD.offer_id OR
      NEW.technician_id IS DISTINCT FROM OLD.technician_id OR
      NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Application participants cannot be changed.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_application_participants() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a_guard_application_participants ON public.offer_applications;
CREATE TRIGGER a_guard_application_participants BEFORE UPDATE ON public.offer_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_participants();

CREATE OR REPLACE FUNCTION public.enforce_offer_application_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_reason text;
BEGIN
  -- Accept/reject/withdraw do not read qualifications and retain their RLS.
  IF TG_OP='UPDATE' AND NEW.offer_id IS NOT DISTINCT FROM OLD.offer_id AND
     NOT (NEW.status='pending' AND OLD.status IS DISTINCT FROM 'pending') THEN
    RETURN NEW;
  END IF;
  -- Before any query about the target's qualifications, including for a UUID
  -- that does not exist. Same SQLSTATE/message/detail for every unauthorized row.
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR
     NEW.technician_id IS DISTINCT FROM public.my_technician_id() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.offers WHERE id=NEW.offer_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
  END IF;
  v_reason:=public.offer_application_ineligibility_reason(NEW.offer_id,NEW.technician_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='PT403', MESSAGE='The technician is not eligible for this offer.', DETAIL=v_reason;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_offer_application_eligibility() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_offer_application_eligibility ON public.offer_applications;
CREATE TRIGGER enforce_offer_application_eligibility
  BEFORE INSERT OR UPDATE OF status, offer_id ON public.offer_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_offer_application_eligibility();

-- Reuse the actual discovery view, including its account-status and location
-- requirements. Historical relationships remain readable regardless of status.
CREATE OR REPLACE FUNCTION public.company_can_read_technician_qualifications(p_technician_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
  SELECT public.is_active_user() AND public.auth_role()='company_user'
    AND public.my_company_id() IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.technician_public_view WHERE id=p_technician_id)
      OR EXISTS (SELECT 1 FROM public.offer_applications
        WHERE technician_id=p_technician_id AND company_id=public.my_company_id())
      OR EXISTS (SELECT 1 FROM public.offer_requests
        WHERE technician_id=p_technician_id AND company_id=public.my_company_id())
    );
$$;
REVOKE ALL ON FUNCTION public.company_can_read_technician_qualifications(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_can_read_technician_qualifications(uuid) TO authenticated;
DROP POLICY IF EXISTS tl_select_company ON public.technician_licenses;
CREATE POLICY tl_select_company ON public.technician_licenses FOR SELECT TO authenticated
  USING (public.company_can_read_technician_qualifications(technician_id));
DROP POLICY IF EXISTS th_select_company ON public.technician_habilitations;
CREATE POLICY th_select_company ON public.technician_habilitations FOR SELECT TO authenticated
  USING (public.company_can_read_technician_qualifications(technician_id));
DROP POLICY IF EXISTS tee_select_company ON public.technician_engine_experience;
CREATE POLICY tee_select_company ON public.technician_engine_experience FOR SELECT TO authenticated
  USING (public.company_can_read_technician_qualifications(technician_id));
NOTIFY pgrst, 'reload schema';
