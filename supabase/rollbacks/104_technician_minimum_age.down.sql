-- Emergency undo for 104. Prepared only, NOT applied with the migration.
-- Removes the database minimum-age rule: technician profiles could again store
-- a birth date under 18 (the signup form would still ask for 18).
-- No technician profile or other data is changed.
-- For a permanent reversal, register these statements as a NEW migration.

BEGIN;

DROP TRIGGER enforce_technician_minimum_age ON public.technician_profiles;
DROP FUNCTION public.enforce_technician_minimum_age();
DROP FUNCTION public.meets_minimum_technician_age(date, date);

COMMIT;
