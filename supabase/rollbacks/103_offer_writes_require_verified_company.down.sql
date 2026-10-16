-- Emergency undo for 103. Prepared only, NOT applied with the migration.
-- Restores the previous permissions and reopens unapproved-company writes.
-- No existing offers, requirements, companies or accounts are changed.
-- For a permanent reversal, register these statements as a NEW migration.

BEGIN;

DROP POLICY orh_delete_verified_company ON public.offer_required_habilitations;
DROP POLICY orh_update_verified_company ON public.offer_required_habilitations;
DROP POLICY orh_insert_verified_company ON public.offer_required_habilitations;
DROP POLICY offers_update_verified_company ON public.offers;
DROP POLICY offers_insert_verified_company ON public.offers;

COMMIT;
