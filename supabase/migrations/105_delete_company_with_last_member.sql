-- ============================================================
-- AviationJobTalent V2 — Migration 105: la empresa se va con su último miembro
-- ============================================================
-- Created: 2026-10-16. Requiere la 100 (contact_blocks).
--
-- Decisiones del dueño (2026-10-16):
--
--   - Al borrarse una cuenta de empresa, si en la empresa no queda ningún
--     miembro que haya entrado alguna vez, se borra la empresa con todo lo suyo,
--     también para los técnicos: ofertas y requisitos, candidaturas, ofertas
--     directas, chats (incluidos los mensajes del técnico), bloqueos, registro
--     de invitaciones y avisos de la empresa (las FK ya van en cascada).
--   - Las invitaciones pendientes NO cuentan como miembros. Pendiente = miembro
--     cuya cuenta nunca ha iniciado sesión (auth.users.last_sign_in_at IS NULL):
--     la creó la invitación y no tiene nada propio. Al borrarse la empresa se
--     cancelan: se borra esa cuenta de Auth (el enlace del correo deja de
--     servir y el email queda libre para registrarse) y su perfil queda como
--     lápida, como cualquier cuenta borrada.
--   - Se borran también los avisos del TÉCNICO (activity_events) sobre esas
--     candidaturas, ofertas directas y chats: el número de Applications cuenta
--     avisos sin mirar si la candidatura existe y se quedaría encendido.
--   - La regla está en la base, dentro de handle_deleted_user: misma
--     transacción que el borrado de la cuenta, o todo o nada, y vale también si
--     soporte borra al usuario desde Supabase.
--   - Si queda algún miembro que sí ha entrado, la empresa sigue. "El único
--     admin nombra otro antes de irse" sigue siendo regla de producto de la
--     función delete-account, no de la base.
--
-- No cambia: perfiles y documentos de técnicos. Las denuncias (content_reports)
-- se conservan aunque desaparezca el contenido denunciado. El logo (Storage)
-- lo borra la función delete-account antes de borrar la cuenta.
--
-- Piezas:
--   1. company_member_has_signed_in(user): qué es "haber entrado".
--   2. company_account_deletion_impact(user): qué pasaría al borrar esa cuenta.
--      La piden la pantalla de borrar cuenta (el propio usuario) y la función
--      delete-account (service_role); nadie puede pedir la de otro.
--   3. close_company_without_members(company): borra la empresa si no le queda
--      nadie que haya entrado y cancela sus invitaciones pendientes. Interna.
--   4. guard_company_last_admin: deja salir a los miembros de una empresa que
--      se está borrando (si no, una invitación pendiente con rol admin
--      bloquearía la cascada). Para una empresa viva no cambia nada.
--   5. handle_deleted_user: tras quitar la membresía, llama a 3.
--
-- No borra ni cambia datos existentes al aplicarse. Ensayo:
-- `node scripts/rehearseCompanyAccountDeletion.cjs` (todo con ROLLBACK).
-- Deshacer: ../rollbacks/105_delete_company_with_last_member.down.sql.
--
-- La autoprueba del final crea sus propios usuarios, empresas, ofertas,
-- candidaturas y chats dentro de un bloque que se revierte, así que funciona en
-- una base sin usuarios. Sin catálogos (un país activo, un tipo de empresa, un
-- tipo de contrato y el oficio 'mechanic') avisa con un NOTICE, salta el
-- comportamiento y comprueba la estructura. Lo que va entre ">>> selftest 105"
-- y "<<< selftest 105" lo reutiliza el ensayo con la base ya instalada.
-- ============================================================


-- ── 1. Haber entrado ────────────────────────────────────────

CREATE FUNCTION public.company_member_has_signed_in(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_user_id AND u.last_sign_in_at IS NOT NULL
  )
$$;

REVOKE ALL ON FUNCTION public.company_member_has_signed_in(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.company_member_has_signed_in(uuid) IS
  'false = pending invitation: the account never signed in (or no longer exists). Pending invitations do not count as company members when an account is deleted (105).';


-- ── 2. Qué pasaría al borrar la cuenta ──────────────────────

CREATE FUNCTION public.company_account_deletion_impact(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  company_id          uuid,
  company_name        text,
  logo_path           text,
  member_role         public.company_member_role,
  other_members       integer,  -- otros miembros que han entrado
  other_admins        integer,  -- de ellos, admins
  pending_invitations integer,  -- otros miembros que nunca han entrado
  offers              integer,
  applications        integer,
  direct_offers       integer,
  chats               integer,
  deletes_company     boolean,  -- no queda nadie que haya entrado
  must_assign_admin   boolean   -- único admin con otros miembros que sí han entrado
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid    uuid := COALESCE(p_user_id, auth.uid());
  v_member public.company_members%ROWTYPE;
BEGIN
  IF v_uid IS NULL
     OR (v_uid IS DISTINCT FROM auth.uid() AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Only the account owner can see what deleting the account would remove.';
  END IF;

  SELECT m.* INTO v_member FROM public.company_members m WHERE m.user_id = v_uid;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH others AS (
    SELECT m.role, public.company_member_has_signed_in(m.user_id) AS signed_in
      FROM public.company_members m
     WHERE m.company_id = v_member.company_id AND m.user_id <> v_uid
  ), k AS (
    SELECT count(*) FILTER (WHERE o.signed_in)::integer                    AS active,
           count(*) FILTER (WHERE o.signed_in AND o.role = 'admin')::integer AS active_admins,
           count(*) FILTER (WHERE NOT o.signed_in)::integer                AS pending
      FROM others o
  )
  SELECT c.id, c.name, c.logo_path, v_member.role,
         k.active, k.active_admins, k.pending,
         (SELECT count(*)::integer FROM public.offers o WHERE o.company_id = c.id),
         (SELECT count(*)::integer FROM public.offer_applications a WHERE a.company_id = c.id),
         (SELECT count(*)::integer FROM public.offer_requests r WHERE r.company_id = c.id),
         (SELECT count(*)::integer FROM public.chat_rooms cr WHERE cr.company_id = c.id),
         k.active = 0,
         v_member.role = 'admin' AND k.active > 0 AND k.active_admins = 0
    FROM public.companies c CROSS JOIN k
   WHERE c.id = v_member.company_id;
END
$$;

REVOKE ALL ON FUNCTION public.company_account_deletion_impact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_account_deletion_impact(uuid) TO authenticated, service_role;


-- ── 3. Cerrar la empresa que se queda sin nadie ─────────────

CREATE FUNCTION public.close_company_without_members(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_pending uuid[];
BEGIN
  -- El bloqueo serializa con una invitación simultánea (su INSERT en
  -- company_members comprueba la FK contra esta fila).
  PERFORM 1 FROM public.companies c WHERE c.id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_members m
              WHERE m.company_id = p_company_id
                AND public.company_member_has_signed_in(m.user_id)) THEN
    RETURN false;
  END IF;

  -- Sólo quedan invitaciones pendientes (o nadie).
  SELECT COALESCE(array_agg(m.user_id), '{}') INTO v_pending
    FROM public.company_members m WHERE m.company_id = p_company_id;

  -- Avisos del técnico sobre lo que va a desaparecer (los de la empresa se
  -- van en cascada con recipient_company_id). En los de chat, entity_id es la
  -- sala.
  DELETE FROM public.activity_events e
   WHERE e.recipient_scope = 'technician'
     AND e.entity_id IN (
       SELECT a.id FROM public.offer_applications a WHERE a.company_id = p_company_id
       UNION ALL
       SELECT r.id FROM public.offer_requests r WHERE r.company_id = p_company_id
       UNION ALL
       SELECT cr.id FROM public.chat_rooms cr WHERE cr.company_id = p_company_id);

  DELETE FROM public.companies c WHERE c.id = p_company_id;

  -- Cancelar las invitaciones: borrar las cuentas que nunca entraron. Su
  -- handle_deleted_user ya no encuentra membresía (la cascada la quitó) y sólo
  -- deja la lápida del perfil.
  DELETE FROM auth.users u
   WHERE u.id = ANY (v_pending)
     AND u.last_sign_in_at IS NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id AND p.role = 'company_user');

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.close_company_without_members(uuid) FROM PUBLIC, anon, authenticated, service_role;


-- ── 4. Último admin: una empresa que se borra se lleva a sus miembros ──

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

  -- 105: la empresa ya no existe (cascada de su borrado): sus miembros,
  -- también los admins con una invitación pendiente, se van con ella.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = OLD.company_id) THEN
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


-- ── 5. La lápida del borrado de cuenta ──────────────────────

CREATE OR REPLACE FUNCTION public.handle_deleted_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role          app_role;
  v_technician_id UUID;
  v_company_id    UUID;
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
    -- 105: si la empresa se queda sin nadie que haya entrado, se borra con lo
    -- suyo y se cancelan sus invitaciones pendientes.
    FOR v_company_id IN
      DELETE FROM company_members WHERE user_id = OLD.id RETURNING company_id
    LOOP
      PERFORM public.close_company_without_members(v_company_id);
    END LOOP;
  END IF;

  UPDATE profiles
     SET email      = v_deleted_email,
         status     = 'deleted',
         deleted_at = COALESCE(deleted_at, now())
   WHERE id = OLD.id;

  RETURN NULL;
END;
$function$;


-- ── 6. Autoprueba ───────────────────────────────────────────

CREATE FUNCTION pg_temp.attempt_105(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_detail text;
BEGIN
  EXECUTE statement;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || ':' || SQLERRM || ':' || COALESCE(v_detail, '');
END $$;

-- >>> selftest 105
DO $selftest$
DECLARE
  v_country text; v_ctype text; v_contract text;
  au  uuid := gen_random_uuid();  -- único miembro que ha entrado de la empresa A
  pu  uuid := gen_random_uuid();  -- invitación pendiente en A, con rol admin
  tu  uuid := gen_random_uuid();  -- técnico
  xu  uuid := gen_random_uuid();  -- admin de otra empresa X
  bu1 uuid := gen_random_uuid();  -- único admin de B
  bu2 uuid := gen_random_uuid();  -- viewer de B que sí ha entrado
  cu1 uuid := gen_random_uuid();  -- admin de C
  cu2 uuid := gen_random_uuid();  -- otro admin de C
  a uuid; x uuid; b uuid; c uuid; t uuid; am uuid;
  oa1 uuid; oa2 uuid; ox uuid; app_a uuid; app_x uuid; req_a uuid; req_x uuid; room_a uuid;
  r record;
  names text[] := '{}'; oks boolean[] := '{}'; seen text[] := '{}';
  observed text; n bigint; failures text := ''; v_expected int := 0;
  i int;
BEGIN
  -- Estructura: siempre, haya datos o no.
  IF to_regprocedure('public.company_member_has_signed_in(uuid)') IS NULL
     OR to_regprocedure('public.company_account_deletion_impact(uuid)') IS NULL
     OR to_regprocedure('public.close_company_without_members(uuid)') IS NULL THEN
    RAISE EXCEPTION '105 self-test failed: missing functions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_deleted'
                    AND tgrelid = 'auth.users'::regclass AND NOT tgisinternal)
     OR position('close_company_without_members' IN pg_get_functiondef('public.handle_deleted_user()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '105 self-test failed: account deletion does not close the company';
  END IF;
  IF has_function_privilege('anon', 'public.company_account_deletion_impact(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.company_account_deletion_impact(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.company_account_deletion_impact(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.close_company_without_members(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.close_company_without_members(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.company_member_has_signed_in(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '105 self-test failed: function privileges';
  END IF;

  -- Comportamiento: con datos propios. Sólo necesita catálogos.
  SELECT code INTO v_country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
  SELECT code INTO v_ctype FROM company_types ORDER BY code LIMIT 1;
  SELECT code INTO v_contract FROM contract_types ORDER BY code LIMIT 1;
  IF v_country IS NULL OR v_ctype IS NULL OR v_contract IS NULL
     OR NOT EXISTS (SELECT 1 FROM technician_types WHERE code = 'mechanic') THEN
    RAISE NOTICE '105 self-test: catalogs are empty (countries, company or contract types, mechanic), behaviour checks skipped; structure checked.';
  ELSE
    v_expected := 24;
    BEGIN
      -- Cuentas reales de Auth (el trigger de alta crea sus perfiles). Sólo la
      -- invitación pendiente no ha iniciado sesión nunca.
      INSERT INTO auth.users (id, email, raw_user_meta_data, last_sign_in_at) VALUES
        (au,  'selftest-105-a@example.invalid',  '{"role":"company"}',    now()),
        (pu,  'selftest-105-p@example.invalid',  '{"role":"company"}',    NULL),
        (tu,  'selftest-105-t@example.invalid',  '{"role":"technician"}', now()),
        (xu,  'selftest-105-x@example.invalid',  '{"role":"company"}',    now()),
        (bu1, 'selftest-105-b1@example.invalid', '{"role":"company"}',    now()),
        (bu2, 'selftest-105-b2@example.invalid', '{"role":"company"}',    now()),
        (cu1, 'selftest-105-c1@example.invalid', '{"role":"company"}',    now()),
        (cu2, 'selftest-105-c2@example.invalid', '{"role":"company"}',    now());
      INSERT INTO technician_profiles (user_id, anonymous_code, first_name, last_name, email, birth_date,
                                       technician_type, location_country_code)
      VALUES (tu, 'TS105' || left(replace(gen_random_uuid()::text, '-', ''), 6), 'Self', 'Test',
              'selftest-105-t@example.invalid', DATE '1990-01-01', 'mechanic', v_country)
      RETURNING id INTO t;

      INSERT INTO companies (name, company_type, email, location_country_code, verification_status)
      VALUES ('selftest-105-a', v_ctype, 'selftest-105-ca@example.invalid', v_country, 'verified') RETURNING id INTO a;
      INSERT INTO companies (name, company_type, email, location_country_code, verification_status)
      VALUES ('selftest-105-x', v_ctype, 'selftest-105-cx@example.invalid', v_country, 'verified') RETURNING id INTO x;
      INSERT INTO companies (name, company_type, email, location_country_code, verification_status)
      VALUES ('selftest-105-b', v_ctype, 'selftest-105-cb@example.invalid', v_country, 'verified') RETURNING id INTO b;
      INSERT INTO companies (name, company_type, email, location_country_code, verification_status)
      VALUES ('selftest-105-c', v_ctype, 'selftest-105-cc@example.invalid', v_country, 'verified') RETURNING id INTO c;
      INSERT INTO company_members (company_id, user_id, role) VALUES (a, au, 'admin') RETURNING id INTO am;
      INSERT INTO company_members (company_id, user_id, role) VALUES
        (a, pu, 'admin'), (x, xu, 'admin'), (b, bu1, 'admin'), (b, bu2, 'viewer'), (c, cu1, 'admin'), (c, cu2, 'admin');

      INSERT INTO offers (company_id, title, description, contract_type, product_type, technician_type,
                          requires_certification, location_country, location_country_code, status, visible)
      VALUES (a, 'selftest-105-a1', 'rollback', v_contract, 'Aeroplane', 'mechanic', false, 'Selftest', v_country, 'published', true)
      RETURNING id INTO oa1;
      INSERT INTO offers (company_id, title, description, contract_type, product_type, technician_type,
                          requires_certification, location_country, location_country_code, status, visible)
      VALUES (a, 'selftest-105-a2', 'rollback', v_contract, 'Aeroplane', 'mechanic', false, 'Selftest', v_country, 'draft', false)
      RETURNING id INTO oa2;
      INSERT INTO offers (company_id, title, description, contract_type, product_type, technician_type,
                          requires_certification, location_country, location_country_code, status, visible)
      VALUES (x, 'selftest-105-x', 'rollback', v_contract, 'Aeroplane', 'mechanic', false, 'Selftest', v_country, 'published', true)
      RETURNING id INTO ox;

      -- Las candidaturas sólo las crea el propio técnico (080).
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', tu, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      INSERT INTO offer_applications (technician_id, offer_id, company_id) VALUES (t, oa1, a) RETURNING id INTO app_a;
      INSERT INTO offer_applications (technician_id, offer_id, company_id) VALUES (t, ox, x) RETURNING id INTO app_x;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
      -- Las ofertas directas avisan al técnico (direct_offer_received).
      INSERT INTO offer_requests (company_id, technician_id, offer_id) VALUES (a, t, oa1) RETURNING id INTO req_a;
      INSERT INTO offer_requests (company_id, technician_id, offer_id) VALUES (x, t, ox) RETURNING id INTO req_x;
      INSERT INTO chat_rooms (offer_application_id, technician_id, company_id) VALUES (app_a, t, a) RETURNING id INTO room_a;
      INSERT INTO chat_messages (chat_room_id, sender_user_id, sender_company_member_id, sender_role, body)
      VALUES (room_a, au, am, 'company', 'selftest company message');
      INSERT INTO chat_messages (chat_room_id, sender_user_id, sender_role, body)
      VALUES (room_a, tu, 'technician', 'selftest technician message');
      -- Una respuesta sin leer en la candidatura: el punto rojo de Applications.
      INSERT INTO activity_events (type, recipient_scope, recipient_technician_id, entity_type, entity_id, offer_id)
      VALUES ('application_accepted', 'technician', t, 'offer_application', app_a, oa1);
      INSERT INTO contact_blocks (technician_id, company_id, blocked_by, blocked_by_user_id) VALUES (t, a, 'technician', tu);

      -- Qué diría la pantalla, como el propio usuario.
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', au, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT * INTO r FROM public.company_account_deletion_impact();
      RESET ROLE;
      names := array_append(names, 'impact: last signed-in member with a pending invitation deletes the company');
      oks := oks || (r.deletes_company AND NOT r.must_assign_admin AND r.other_members = 0 AND r.pending_invitations = 1);
      seen := seen || format('%s/%s/%s/%s', r.deletes_company, r.must_assign_admin, r.other_members, r.pending_invitations);
      names := array_append(names, 'impact: counts offers, applications, direct offers and chats');
      oks := oks || (r.company_name = 'selftest-105-a' AND r.offers = 2 AND r.applications = 1 AND r.direct_offers = 1 AND r.chats = 1);
      seen := seen || format('%s %s/%s/%s/%s', r.company_name, r.offers, r.applications, r.direct_offers, r.chats);

      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', bu1, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT * INTO r FROM public.company_account_deletion_impact();
      RESET ROLE;
      names := array_append(names, 'impact: only admin with a signed-in member must assign an admin');
      oks := oks || (r.must_assign_admin AND NOT r.deletes_company AND r.other_members = 1 AND r.other_admins = 0);
      seen := seen || format('%s/%s/%s/%s', r.must_assign_admin, r.deletes_company, r.other_members, r.other_admins);

      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cu1, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT * INTO r FROM public.company_account_deletion_impact();
      RESET ROLE;
      names := array_append(names, 'impact: one of two admins leaves the company in place');
      oks := oks || (NOT r.must_assign_admin AND NOT r.deletes_company AND r.other_admins = 1);
      seen := seen || format('%s/%s/%s', r.must_assign_admin, r.deletes_company, r.other_admins);

      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', bu2, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      observed := pg_temp.attempt_105(format('SELECT * FROM public.company_account_deletion_impact(%L)', au));
      RESET ROLE;
      names := array_append(names, 'impact: nobody can read another account');
      oks := oks || (observed LIKE '42501:%'); seen := seen || observed;

      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
      SET LOCAL ROLE service_role;
      SELECT count(*) INTO n FROM public.company_account_deletion_impact(au) WHERE deletes_company;
      RESET ROLE;
      names := array_append(names, 'impact: the delete-account function (service_role) can read it');
      oks := oks || (n = 1); seen := seen || n::text;

      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', tu, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO n FROM public.company_account_deletion_impact();
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
      names := array_append(names, 'impact: a technician has no company to delete');
      oks := oks || (n = 0); seen := seen || n::text;

      -- Borrar la cuenta del último miembro que ha entrado (lo que hace Auth).
      observed := pg_temp.attempt_105(format('DELETE FROM auth.users WHERE id = %L', au));
      names := array_append(names, 'deleting the last signed-in member succeeds');
      oks := oks || (observed = 'OK'); seen := seen || observed;
      SELECT count(*) INTO n FROM companies WHERE id = a;
      names := array_append(names, 'company is deleted with its last member'); oks := oks || (n = 0); seen := seen || n::text;
      SELECT count(*) INTO n FROM offers WHERE id IN (oa1, oa2);
      names := array_append(names, 'its offers are deleted'); oks := oks || (n = 0); seen := seen || n::text;
      SELECT count(*) INTO n FROM offer_applications WHERE id = app_a;
      names := array_append(names, 'technician applications to it are deleted'); oks := oks || (n = 0); seen := seen || n::text;
      SELECT count(*) INTO n FROM offer_requests WHERE id = req_a;
      names := array_append(names, 'its direct offers are deleted'); oks := oks || (n = 0); seen := seen || n::text;
      SELECT count(*) INTO n FROM chat_rooms WHERE id = room_a;
      SELECT n + count(*) INTO n FROM chat_messages WHERE chat_room_id = room_a;
      names := array_append(names, 'its chats and both sides of the messages are deleted'); oks := oks || (n = 0); seen := seen || n::text;
      SELECT count(*) INTO n FROM contact_blocks WHERE company_id = a;
      names := array_append(names, 'contact blocks with it are deleted'); oks := oks || (n = 0); seen := seen || n::text;
      SELECT count(*) INTO n FROM activity_events WHERE entity_id IN (app_a, req_a, room_a);
      names := array_append(names, 'technician notices about the company are removed'); oks := oks || (n = 0); seen := seen || n::text;
      SELECT count(*) INTO n FROM auth.users WHERE id = pu;
      names := array_append(names, 'pending invitation account is cancelled'); oks := oks || (n = 0); seen := seen || n::text;
      SELECT count(*) INTO n FROM profiles WHERE id = pu AND status = 'deleted' AND email LIKE 'deleted_%@deleted.invalid';
      names := array_append(names, 'cancelled invitation leaves a tombstone'); oks := oks || (n = 1); seen := seen || n::text;
      SELECT count(*) INTO n FROM profiles WHERE id = au AND status = 'deleted' AND email LIKE 'deleted_%@deleted.invalid';
      names := array_append(names, 'deleted member leaves a tombstone'); oks := oks || (n = 1); seen := seen || n::text;
      SELECT (SELECT count(*) FROM technician_profiles WHERE id = t)
           + (SELECT count(*) FROM offer_applications WHERE id = app_x)
           + (SELECT count(*) FROM activity_events WHERE entity_id = req_x AND recipient_technician_id = t) INTO n;
      names := array_append(names, 'technician keeps profile, other applications and other notices'); oks := oks || (n = 3); seen := seen || n::text;
      SELECT (SELECT count(*) FROM companies WHERE id = x) + (SELECT count(*) FROM offers WHERE id = ox)
           + (SELECT count(*) FROM offer_requests WHERE id = req_x) INTO n;
      names := array_append(names, 'other companies are untouched'); oks := oks || (n = 3); seen := seen || n::text;

      -- B: se borra su único admin (p. ej. soporte desde Supabase) y queda un
      -- viewer que sí ha entrado: la empresa sigue. La regla del admin es de la
      -- función delete-account, no de la base.
      observed := pg_temp.attempt_105(format('DELETE FROM auth.users WHERE id = %L', bu1));
      SELECT count(*) INTO n FROM companies WHERE id = b;
      SELECT n + count(*) INTO n FROM company_members WHERE company_id = b AND user_id = bu2;
      names := array_append(names, 'company with another signed-in member stays');
      oks := oks || (observed = 'OK' AND n = 2); seen := seen || (observed || ' ' || n::text);

      -- C: se va uno de los dos admins.
      observed := pg_temp.attempt_105(format('DELETE FROM auth.users WHERE id = %L', cu1));
      SELECT count(*) INTO n FROM companies WHERE id = c;
      SELECT n + count(*) INTO n FROM company_members WHERE company_id = c AND user_id = cu2;
      names := array_append(names, 'deleting one of two admins keeps the company');
      oks := oks || (observed = 'OK' AND n = 2); seen := seen || (observed || ' ' || n::text);

      -- El ajuste del guard no abre nada en una empresa viva.
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cu2, 'role', 'authenticated')::text, true);
      observed := pg_temp.attempt_105(format('DELETE FROM company_members WHERE company_id = %L AND user_id = %L', c, cu2));
      PERFORM set_config('request.jwt.claims', '', true);
      names := array_append(names, 'last admin still cannot be removed from a live company');
      oks := oks || (observed LIKE '%Cannot remove the last admin of a company%'); seen := seen || observed;

      -- Y nadie de fuera puede cerrar una empresa a mano.
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', xu, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      observed := pg_temp.attempt_105(format('SELECT public.close_company_without_members(%L)', c));
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
      names := array_append(names, 'clients cannot call the internal close function');
      oks := oks || (observed LIKE '42501:%'); seen := seen || observed;

      RAISE EXCEPTION USING ERRCODE = 'P0105', MESSAGE = 'undo selftest 105';
    EXCEPTION WHEN SQLSTATE 'P0105' THEN
      NULL;
    END;
  END IF;

  -- Fuera del bloque revertido: el ensayo deja preparada esta tabla temporal
  -- para leer cada caso; al aplicar la migración no existe.
  IF to_regclass('pg_temp.selftest_105_results') IS NOT NULL THEN
    EXECUTE 'INSERT INTO pg_temp.selftest_105_results (test, passed, observed) SELECT * FROM unnest($1, $2, $3)'
      USING names, oks, seen;
  END IF;
  FOR i IN 1 .. coalesce(array_length(names, 1), 0) LOOP
    IF oks[i] IS NOT TRUE THEN
      failures := failures || names[i] || ' [' || coalesce(seen[i], 'null') || ']; ';
    END IF;
  END LOOP;
  IF coalesce(array_length(names, 1), 0) <> v_expected THEN
    failures := failures || 'expected ' || v_expected || ' cases, ran ' || coalesce(array_length(names, 1), 0) || '; ';
  END IF;
  IF failures <> '' THEN
    RAISE EXCEPTION '105 self-test failed: %', failures;
  END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE name LIKE 'selftest-105%')
     OR EXISTS (SELECT 1 FROM profiles WHERE email LIKE 'selftest-105-%@example.invalid')
     OR EXISTS (SELECT 1 FROM auth.users WHERE email LIKE 'selftest-105-%@example.invalid') THEN
    RAISE EXCEPTION '105 self-test failed: fixtures were left behind';
  END IF;
  RAISE NOTICE '105 self-test: % cases passed', coalesce(array_length(names, 1), 0);
END $selftest$;
-- <<< selftest 105

DROP FUNCTION pg_temp.attempt_105(text);

NOTIFY pgrst, 'reload schema';
