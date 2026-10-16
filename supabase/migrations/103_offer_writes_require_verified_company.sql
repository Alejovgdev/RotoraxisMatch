-- Offer creation, editing and publication require an approved company.
-- Restrictive policies combine with every existing permission, including
-- offers_all_admin. They grant no new access and do not modify stored data.
-- Reading and deleting offers retain their existing policies.
-- update_offer_with_habilitations is SECURITY INVOKER and obeys these rules.
-- Undo: ../rollbacks/103_offer_writes_require_verified_company.down.sql

CREATE POLICY offers_insert_verified_company ON public.offers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = offers.company_id AND c.verification_status = 'verified'
  ));

CREATE POLICY offers_update_verified_company ON public.offers
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = offers.company_id AND c.verification_status = 'verified'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = offers.company_id AND c.verification_status = 'verified'
  ));

-- Requirements are part of an offer: direct child-table writes must not
-- bypass the parent UPDATE rule. Check both old and new offer on UPDATE.
CREATE POLICY orh_insert_verified_company ON public.offer_required_habilitations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.offers o JOIN public.companies c ON c.id = o.company_id
    WHERE o.id = offer_required_habilitations.offer_id AND c.verification_status = 'verified'
  ));

CREATE POLICY orh_update_verified_company ON public.offer_required_habilitations
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.offers o JOIN public.companies c ON c.id = o.company_id
    WHERE o.id = offer_required_habilitations.offer_id AND c.verification_status = 'verified'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.offers o JOIN public.companies c ON c.id = o.company_id
    WHERE o.id = offer_required_habilitations.offer_id AND c.verification_status = 'verified'
  ));

CREATE POLICY orh_delete_verified_company ON public.offer_required_habilitations
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.offers o JOIN public.companies c ON c.id = o.company_id
    WHERE o.id = offer_required_habilitations.offer_id AND c.verification_status = 'verified'
  ));
