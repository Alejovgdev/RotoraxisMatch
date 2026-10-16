-- Emergency undo for 105. Prepared only, NOT applied with the migration.
-- Restores handle_deleted_user and guard_company_last_admin exactly as they
-- were before 105 and removes its three functions. Afterwards, deleting the
-- last member of a company again leaves the company in place with nobody in
-- it, and pending invitations count as members again. Companies already
-- deleted by 105 are NOT restored. The delete-account function must be rolled
-- back to version 8 first, or a sole member would get an error (the impact
-- function it calls would no longer exist).
-- For a permanent reversal, register these statements as a NEW migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_deleted_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role          app_role;
  v_technician_id UUID;
  v_deleted_email TEXT := 'deleted_' || OLD.id || '@deleted.invalid';
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = OLD.id;

  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE chat_messages
     SET body = '[Message deleted]'
   WHERE sender_user_id = OLD.id
     AND body <> '[Message deleted]';

  IF v_role = 'technician' THEN
    SELECT id INTO v_technician_id FROM technician_profiles WHERE user_id = OLD.id;

    IF v_technician_id IS NOT NULL THEN
      DELETE FROM documents WHERE technician_id = v_technician_id;

      UPDATE offer_applications
         SET cover_note = NULL
       WHERE technician_id = v_technician_id
         AND cover_note IS NOT NULL;

      UPDATE technician_profiles
         SET first_name   = '[Deleted]',
             last_name    = '[User]',
             email        = v_deleted_email,
             phone        = NULL,
             social_links = NULL,
             birth_date   = '1900-01-01'
       WHERE id = v_technician_id;
    END IF;

  ELSIF v_role = 'company_user' THEN
    DELETE FROM company_members WHERE user_id = OLD.id;
  END IF;

  UPDATE profiles
     SET email      = v_deleted_email,
         status     = 'deleted',
         deleted_at = COALESCE(deleted_at, now())
   WHERE id = OLD.id;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_company_last_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_count INT;
BEGIN
  IF is_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' THEN
      SELECT COUNT(*) INTO v_admin_count
      FROM company_members
      WHERE company_id = OLD.company_id
        AND role = 'admin'
        AND id <> OLD.id;
      IF v_admin_count = 0 THEN
        RAISE EXCEPTION 'Cannot remove the last admin of a company';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.role = 'admin' AND NEW.role <> 'admin' THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM company_members
    WHERE company_id = OLD.company_id
      AND role = 'admin'
      AND id <> OLD.id;
    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Cannot downgrade the last admin of a company';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP FUNCTION public.close_company_without_members(uuid);
DROP FUNCTION public.company_account_deletion_impact(uuid);
DROP FUNCTION public.company_member_has_signed_in(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
