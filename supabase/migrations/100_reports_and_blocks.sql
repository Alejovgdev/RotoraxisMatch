-- ============================================================
-- AviationJobTalent V2 — Migration 100: denuncias y bloqueos
-- ============================================================
-- Created: 2026-10-15. Requiere la 093 (participantes inmutables).
--
-- Lo mínimo para la norma 1.2 de App Store y la política de contenido de
-- usuarios de Google Play (decisiones del dueño del 2026-10-15):
--
--   - DENUNCIAR un perfil de técnico, una oferta o un mensaje de chat, con un
--     motivo de una lista corta. Se guarda en content_reports, que sólo lee el
--     admin. Se crea con report_content(), que comprueba que quien denuncia
--     puede ver lo que denuncia y que no es suyo; la misma persona no duplica
--     la denuncia del mismo contenido. El aviso por correo a soporte lo manda la
--     función notify-report (en el repo, sin desplegar) y marca notified_at.
--
--   - BLOQUEAR, entre un técnico y una empresa (las dos partes de la app), en
--     contact_blocks. Bloquea el técnico y, por la empresa, admin y recruiter
--     (can_act_for_company); el viewer sólo denuncia. Mientras exista un
--     bloqueo, en cualquiera de los dos sentidos:
--       · el chat entre ellos desaparece para los dos y nadie puede escribir;
--       · no se pueden enviar ni aceptar candidaturas ni ofertas directas
--         entre ellos (re-aplicar tras retirarse cuenta como enviar).
--     NO oculta nada en la búsqueda, el mapa ni las listas de ofertas. Retirar
--     y rechazar siguen funcionando. Nada se borra: quitar el bloqueo devuelve
--     el chat tal como estaba. No hay desbloqueo en la app: lo quita soporte
--     desde Supabase (docs/MODERATION.md).
--
-- Un admin de la plataforma sigue viendo todos los chats (cr_all_admin), para
-- moderar.
--
-- Se ensaya con `node scripts/rehearseReportsAndBlocks.cjs` (todo dentro de
-- transacciones con ROLLBACK) y se deshace con
-- supabase/rollbacks/100_reports_and_blocks.down.sql, que borra las denuncias y
-- bloqueos guardados.
--
-- La autoprueba del final crea sus propios usuarios, empresas, ofertas y chat
-- dentro de un bloque que se revierte, así que funciona en una base sin
-- usuarios. Si faltan los catálogos que necesita (un país activo, un tipo de
-- empresa, un tipo de contrato y el oficio 'mechanic'), avisa con un NOTICE y
-- sigue. Lo que va entre los marcadores ">>> selftest 100" y "<<< selftest 100"
-- lo reutiliza el ensayo para comprobar la base ya instalada.
-- ============================================================


-- ── 1. Tablas ───────────────────────────────────────────────

CREATE TABLE public.content_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Quien denuncia. Las cuentas borradas quedan como lápida en profiles, así
  -- que la referencia no se pierde; SET NULL sólo por si un perfil se borrara.
  reporter_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type      text NOT NULL
                   CHECK (target_type IN ('technician_profile', 'offer', 'chat_message')),
  -- technician_profiles.id, offers.id o chat_messages.id según target_type.
  -- Sin FK a propósito: la denuncia se conserva aunque el contenido se borre.
  target_id        uuid NOT NULL,
  reason           text NOT NULL
                   CHECK (reason IN ('offensive', 'harassment', 'spam_scam', 'misleading', 'other')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Cuándo salió el aviso por correo a soporte. NULL = todavía no avisado.
  notified_at      timestamptz
);

CREATE UNIQUE INDEX uq_content_reports_reporter_target
  ON public.content_reports (reporter_user_id, target_type, target_id);

COMMENT ON TABLE public.content_reports IS
  'Denuncias de contenido (100). Sólo las lee el admin; se crean con report_content().';

CREATE TABLE public.contact_blocks (
  technician_id      uuid NOT NULL REFERENCES public.technician_profiles(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Qué parte bloqueó. Un par puede tener los dos bloqueos a la vez.
  blocked_by         text NOT NULL CHECK (blocked_by IN ('technician', 'company')),
  blocked_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (technician_id, company_id, blocked_by)
);

COMMENT ON TABLE public.contact_blocks IS
  'Bloqueos entre un técnico y una empresa (100). Se crean con block_contact(); sólo los quita soporte.';

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_blocks ENABLE ROW LEVEL SECURITY;

-- Los clientes no leen ni escriben estas tablas: pasan por las funciones de
-- abajo. Sólo el admin de la plataforma las lee y gestiona.
CREATE POLICY content_reports_all_admin ON public.content_reports FOR ALL USING (public.is_admin());
CREATE POLICY contact_blocks_all_admin ON public.contact_blocks FOR ALL USING (public.is_admin());
REVOKE ALL ON public.content_reports, public.contact_blocks FROM anon;


-- ── 2. ¿Hay bloqueo entre esta empresa y este técnico? ──────
-- Responde sólo a las partes (el técnico o un miembro de la empresa); a
-- cualquier otro le dice false, para que no sirva para averiguar bloqueos
-- ajenos. La usan las reglas del chat y la app.

CREATE FUNCTION public.contact_blocked(p_company_id uuid, p_technician_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
  SELECT COALESCE(
    (public.my_technician_id() = p_technician_id
      OR EXISTS (SELECT 1 FROM company_members m
                  WHERE m.user_id = auth.uid() AND m.company_id = p_company_id))
    AND EXISTS (SELECT 1 FROM contact_blocks b
                 WHERE b.company_id = p_company_id AND b.technician_id = p_technician_id),
    false)
$$;
REVOKE ALL ON FUNCTION public.contact_blocked(uuid, uuid) FROM PUBLIC;
-- anon también: las reglas del chat valen para el rol public y la llaman.
GRANT EXECUTE ON FUNCTION public.contact_blocked(uuid, uuid) TO anon, authenticated;


-- ── 3. Bloquear ─────────────────────────────────────────────
-- El técnico llama con (empresa, su id); la empresa, con (su id, técnico).
-- Repetir no falla ni duplica.

CREATE FUNCTION public.block_contact(p_company_id uuid, p_technician_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_side text;
BEGIN
  IF NOT COALESCE(public.is_active_user(), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only active accounts can block.';
  END IF;
  IF p_company_id IS NULL OR p_technician_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id)
     OR NOT EXISTS (SELECT 1 FROM technician_profiles WHERE id = p_technician_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unknown company or technician.';
  END IF;

  IF public.my_technician_id() = p_technician_id THEN
    v_side := 'technician';
  ELSIF COALESCE(public.can_act_for_company(p_company_id), false) THEN
    v_side := 'company';
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'You cannot block this contact.';
  END IF;

  INSERT INTO contact_blocks (technician_id, company_id, blocked_by, blocked_by_user_id)
  VALUES (p_technician_id, p_company_id, v_side, auth.uid())
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.block_contact(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_contact(uuid, uuid) TO authenticated;


-- ── 4. Denunciar ────────────────────────────────────────────
-- Qué puede denunciar cada uno, lo mismo que ve en la app:
--   - technician_profile: un usuario de empresa, de un técnico con cuenta
--     activa o pendiente (los que muestra technician_public_view);
--   - offer: un técnico, de una oferta publicada o con la que tiene relación;
--   - chat_message: una parte del chat, de un mensaje de la OTRA parte. Vale
--     también con bloqueo: se puede denunciar después de bloquear.
-- Devuelve la denuncia y si ya existía (la misma persona, el mismo contenido).

CREATE FUNCTION public.report_content(p_target_type text, p_target_id uuid, p_reason text)
RETURNS TABLE (report_id uuid, already_reported boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tid uuid := public.my_technician_id();
  v_ok  boolean := false;
  v_id  uuid;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.is_active_user(), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only active accounts can report content.';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('offensive', 'harassment', 'spam_scam', 'misleading', 'other') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unknown report reason.';
  END IF;

  IF p_target_type = 'technician_profile' THEN
    v_ok := public.auth_role() = 'company_user' AND EXISTS (
      SELECT 1 FROM technician_profiles tp JOIN profiles p ON p.id = tp.user_id
       WHERE tp.id = p_target_id AND p.status IN ('active', 'pending_verification'));
  ELSIF p_target_type = 'offer' THEN
    v_ok := v_tid IS NOT NULL AND EXISTS (
      SELECT 1 FROM offers o
       WHERE o.id = p_target_id
         AND ((o.status = 'published' AND o.visible)
              OR EXISTS (SELECT 1 FROM offer_applications a WHERE a.offer_id = o.id AND a.technician_id = v_tid)
              OR EXISTS (SELECT 1 FROM offer_requests r WHERE r.offer_id = o.id AND r.technician_id = v_tid)));
  ELSIF p_target_type = 'chat_message' THEN
    v_ok := EXISTS (
      SELECT 1 FROM chat_messages cm JOIN chat_rooms cr ON cr.id = cm.chat_room_id
       WHERE cm.id = p_target_id
         AND ((v_tid IS NOT NULL AND cr.technician_id = v_tid AND cm.sender_role = 'company')
              OR (cm.sender_role = 'technician' AND EXISTS (
                    SELECT 1 FROM company_members m WHERE m.user_id = v_uid AND m.company_id = cr.company_id))));
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unknown report target.';
  END IF;

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This content cannot be reported.';
  END IF;

  INSERT INTO content_reports AS cr (reporter_user_id, target_type, target_id, reason)
  VALUES (v_uid, p_target_type, p_target_id, p_reason)
  ON CONFLICT (reporter_user_id, target_type, target_id) DO NOTHING
  RETURNING cr.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, false;
  ELSE
    RETURN QUERY SELECT r.id, true FROM content_reports r
      WHERE r.reporter_user_id = v_uid AND r.target_type = p_target_type AND r.target_id = p_target_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.report_content(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_content(text, uuid, text) TO authenticated;


-- ── 5. El chat desaparece y nadie escribe ───────────────────
-- Las cinco reglas de siempre (034) con una condición más. El admin
-- (cr_all_admin, cm_msg_all_admin) no cambia.

ALTER POLICY cr_select_company ON public.chat_rooms
  USING (is_active_user() AND company_id = my_company_id()
         AND NOT public.contact_blocked(company_id, technician_id));

ALTER POLICY cr_select_technician ON public.chat_rooms
  USING (is_active_user() AND technician_id = my_technician_id()
         AND NOT public.contact_blocked(company_id, technician_id));

ALTER POLICY cm_msg_select_participant ON public.chat_messages
  USING (is_active_user() AND EXISTS (
    SELECT 1 FROM chat_rooms cr
     WHERE cr.id = chat_messages.chat_room_id
       AND (cr.technician_id = my_technician_id() OR cr.company_id = my_company_id())
       AND NOT public.contact_blocked(cr.company_id, cr.technician_id)));

ALTER POLICY cm_msg_insert_company ON public.chat_messages
  WITH CHECK (is_active_user() AND sender_user_id = auth.uid() AND sender_role = 'company'::sender_role
    AND EXISTS (
      SELECT 1 FROM chat_rooms cr
        JOIN company_members mem ON mem.company_id = cr.company_id AND mem.user_id = auth.uid()
       WHERE cr.id = chat_messages.chat_room_id
         AND cr.company_id = my_company_id()
         AND can_act_for_company(cr.company_id)
         AND (chat_messages.sender_company_member_id IS NULL OR chat_messages.sender_company_member_id = mem.id)
         AND NOT public.contact_blocked(cr.company_id, cr.technician_id)));

ALTER POLICY cm_msg_insert_technician ON public.chat_messages
  WITH CHECK (is_active_user() AND sender_user_id = auth.uid() AND sender_role = 'technician'::sender_role
    AND sender_company_member_id IS NULL
    AND EXISTS (
      SELECT 1 FROM chat_rooms cr
       WHERE cr.id = chat_messages.chat_room_id
         AND cr.technician_id = my_technician_id()
         AND NOT public.contact_blocked(cr.company_id, cr.technician_id)));


-- ── 6. Ni enviar ni aceptar candidaturas u ofertas directas ──
-- Rechaza crear la relación y pasarla a 'pending' (re-aplicar) o 'accepted'.
-- Retirar, rechazar y caducar siguen libres. Vale para todos, también para el
-- mantenimiento: con el bloqueo puesto no hay relación nueva entre ellos.
-- En una candidatura se mira también la empresa de la OFERTA: company_id lo
-- manda el cliente en el INSERT.
-- Se llama "enforce_c…" para dispararse antes que la elegibilidad (080): con
-- las dos cosas a la vez, el motivo que se ve es el bloqueo.

CREATE FUNCTION public.enforce_contact_not_blocked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('pending', 'accepted')) THEN
    IF EXISTS (
      SELECT 1 FROM contact_blocks b
       WHERE b.technician_id = NEW.technician_id
         AND (b.company_id = NEW.company_id
              OR b.company_id = (SELECT o.company_id FROM offers o WHERE o.id = NEW.offer_id))) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT403',
        MESSAGE = 'Contact between this technician and this company is blocked.',
        DETAIL = 'contact_blocked';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_contact_not_blocked() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_contact_not_blocked
  BEFORE INSERT OR UPDATE OF status ON public.offer_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contact_not_blocked();
CREATE TRIGGER enforce_contact_not_blocked
  BEFORE INSERT OR UPDATE OF status ON public.offer_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contact_not_blocked();


-- ── 7. Autoprueba ───────────────────────────────────────────

CREATE FUNCTION pg_temp.attempt_100(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_detail text;
BEGIN
  EXECUTE statement;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || ':' || SQLERRM || ':' || COALESCE(v_detail, '');
END $$;

-- >>> selftest 100
DO $selftest$
DECLARE
  v_country text; v_ctype text; v_contract text;
  tu uuid := gen_random_uuid();  -- técnico
  ou uuid := gen_random_uuid();  -- otro técnico, sin bloqueo
  au uuid := gen_random_uuid();  -- admin de la empresa
  ru uuid := gen_random_uuid();  -- recruiter
  vu uuid := gen_random_uuid();  -- viewer
  xu uuid := gen_random_uuid();  -- admin de otra empresa
  pu uuid := gen_random_uuid();  -- admin de la plataforma
  t uuid; other_t uuid; cid uuid; xcid uuid; rm uuid;
  offer_a uuid; offer_b uuid; offer_c uuid; offer_d uuid;
  app_room uuid; app_accept uuid; req uuid; room uuid; msg_company uuid; msg_tech uuid;
  v_report uuid; v_again uuid; v_flag boolean;
  names text[] := '{}'; oks boolean[] := '{}'; seen text[] := '{}';
  observed text; n bigint; failures text := '';
  i int;
BEGIN
  -- Estructura: siempre, haya datos o no.
  IF to_regclass('public.content_reports') IS NULL OR to_regclass('public.contact_blocks') IS NULL THEN
    RAISE EXCEPTION '100 self-test failed: missing tables';
  END IF;
  IF NOT (SELECT bool_and(relrowsecurity) FROM pg_class
           WHERE oid IN ('public.content_reports'::regclass, 'public.contact_blocks'::regclass)) THEN
    RAISE EXCEPTION '100 self-test failed: RLS disabled';
  END IF;
  IF has_function_privilege('anon', 'public.report_content(text,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.block_contact(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.enforce_contact_not_blocked()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.report_content(text,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.block_contact(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '100 self-test failed: function privileges';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
       AND policyname IN ('cr_select_company', 'cr_select_technician', 'cm_msg_select_participant',
                          'cm_msg_insert_company', 'cm_msg_insert_technician')
       AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%contact_blocked%') <> 5 THEN
    RAISE EXCEPTION '100 self-test failed: chat policies without the block condition';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'enforce_contact_not_blocked' AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '100 self-test failed: relation triggers missing';
  END IF;

  -- Comportamiento: con datos propios. Sólo necesita catálogos.
  SELECT code INTO v_country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
  SELECT code INTO v_ctype FROM company_types ORDER BY code LIMIT 1;
  SELECT code INTO v_contract FROM contract_types ORDER BY code LIMIT 1;
  IF v_country IS NULL OR v_ctype IS NULL OR v_contract IS NULL
     OR NOT EXISTS (SELECT 1 FROM technician_types WHERE code = 'mechanic') THEN
    RAISE NOTICE '100 self-test: catalogs are empty (countries, company or contract types, mechanic), behaviour checks skipped; structure checked.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO profiles (id, email, role, status) VALUES
      (tu, 'selftest-100-t@example.invalid', 'technician', 'active'),
      (ou, 'selftest-100-o@example.invalid', 'technician', 'active'),
      (au, 'selftest-100-a@example.invalid', 'company_user', 'active'),
      (ru, 'selftest-100-r@example.invalid', 'company_user', 'active'),
      (vu, 'selftest-100-v@example.invalid', 'company_user', 'active'),
      (xu, 'selftest-100-x@example.invalid', 'company_user', 'active'),
      (pu, 'selftest-100-p@example.invalid', 'admin', 'active');
    INSERT INTO technician_profiles (user_id, anonymous_code, first_name, last_name, email, birth_date,
                                     technician_type, location_country_code)
    VALUES (tu, 'TS100' || left(replace(gen_random_uuid()::text, '-', ''), 6), 'Self', 'Test',
            'selftest-100-t@example.invalid', DATE '1990-01-01', 'mechanic', v_country)
    RETURNING id INTO t;
    INSERT INTO technician_profiles (user_id, anonymous_code, first_name, last_name, email, birth_date,
                                     technician_type, location_country_code)
    VALUES (ou, 'TS100' || left(replace(gen_random_uuid()::text, '-', ''), 6), 'Other', 'Test',
            'selftest-100-o@example.invalid', DATE '1990-01-01', 'mechanic', v_country)
    RETURNING id INTO other_t;
    INSERT INTO companies (name, company_type, email, location_country_code, verification_status)
    VALUES ('selftest-100', v_ctype, 'selftest-100-c@example.invalid', v_country, 'verified') RETURNING id INTO cid;
    INSERT INTO companies (name, company_type, email, location_country_code, verification_status)
    VALUES ('selftest-100-x', v_ctype, 'selftest-100-xc@example.invalid', v_country, 'verified') RETURNING id INTO xcid;
    INSERT INTO company_members (company_id, user_id, role) VALUES (cid, au, 'admin'), (cid, vu, 'viewer'), (xcid, xu, 'admin');
    INSERT INTO company_members (company_id, user_id, role) VALUES (cid, ru, 'recruiter') RETURNING id INTO rm;
    INSERT INTO offers (company_id, title, description, contract_type, product_type, technician_type,
                        requires_certification, location_country, location_country_code, status, visible)
    VALUES (cid, 'selftest-100-a', 'rollback', v_contract, 'Aeroplane', 'mechanic', false, 'Selftest', v_country, 'published', true)
    RETURNING id INTO offer_a;
    INSERT INTO offers (company_id, title, description, contract_type, product_type, technician_type,
                        requires_certification, location_country, location_country_code, status, visible)
    VALUES (cid, 'selftest-100-b', 'rollback', v_contract, 'Aeroplane', 'mechanic', false, 'Selftest', v_country, 'published', true)
    RETURNING id INTO offer_b;
    INSERT INTO offers (company_id, title, description, contract_type, product_type, technician_type,
                        requires_certification, location_country, location_country_code, status, visible)
    VALUES (cid, 'selftest-100-c', 'rollback', v_contract, 'Aeroplane', 'mechanic', false, 'Selftest', v_country, 'published', true)
    RETURNING id INTO offer_c;
    INSERT INTO offers (company_id, title, description, contract_type, product_type, technician_type,
                        requires_certification, location_country, location_country_code, status, visible)
    VALUES (cid, 'selftest-100-d', 'rollback', v_contract, 'Aeroplane', 'mechanic', false, 'Selftest', v_country, 'draft', false)
    RETURNING id INTO offer_d;
    -- Las candidaturas sólo las crea el propio técnico (080).
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', tu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO offer_applications (technician_id, offer_id, company_id) VALUES (t, offer_a, cid) RETURNING id INTO app_room;
    INSERT INTO offer_applications (technician_id, offer_id, company_id) VALUES (t, offer_b, cid) RETURNING id INTO app_accept;
    RESET ROLE;
    INSERT INTO offer_requests (company_id, technician_id, offer_id) VALUES (cid, t, offer_c) RETURNING id INTO req;
    INSERT INTO chat_rooms (offer_application_id, technician_id, company_id) VALUES (app_room, t, cid) RETURNING id INTO room;
    INSERT INTO chat_messages (chat_room_id, sender_user_id, sender_company_member_id, sender_role, body)
    VALUES (room, ru, rm, 'company', 'selftest company message') RETURNING id INTO msg_company;
    INSERT INTO chat_messages (chat_room_id, sender_user_id, sender_role, body)
    VALUES (room, tu, 'technician', 'selftest technician message') RETURNING id INTO msg_tech;

    -- Antes del bloqueo.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', tu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM chat_rooms WHERE id = room;
    names := array_append(names, 'technician sees the chat before blocking'); oks := oks || (n = 1); seen := seen || n::text;
    v_flag := public.contact_blocked(cid, t);
    names := array_append(names, 'no block reported before blocking'); oks := oks || (v_flag = false); seen := seen || v_flag::text;

    -- El técnico bloquea a la empresa (dos veces: no falla ni duplica).
    observed := pg_temp.attempt_100(format('SELECT public.block_contact(%L, %L)', cid, t));
    names := array_append(names, 'technician blocks the company'); oks := oks || (observed = 'OK'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.block_contact(%L, %L)', cid, t));
    names := array_append(names, 'blocking twice is harmless'); oks := oks || (observed = 'OK'); seen := seen || observed;

    v_flag := public.contact_blocked(cid, t);
    names := array_append(names, 'technician sees the block'); oks := oks || v_flag; seen := seen || v_flag::text;
    SELECT count(*) INTO n FROM chat_rooms WHERE id = room;
    names := array_append(names, 'chat hidden from technician'); oks := oks || (n = 0); seen := seen || n::text;
    SELECT count(*) INTO n FROM chat_messages WHERE chat_room_id = room;
    names := array_append(names, 'messages hidden from technician'); oks := oks || (n = 0); seen := seen || n::text;
    observed := pg_temp.attempt_100(format(
      'INSERT INTO chat_messages (chat_room_id, sender_user_id, sender_role, body) VALUES (%L, %L, %L, %L)',
      room, tu, 'technician', 'blocked'));
    names := array_append(names, 'technician cannot write'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('UPDATE offer_requests SET status = %L WHERE id = %L', 'accepted', req));
    names := array_append(names, 'technician cannot accept a direct offer'); oks := oks || (observed LIKE 'PT403:%:contact_blocked'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('INSERT INTO offer_applications (technician_id, offer_id, company_id) VALUES (%L, %L, %L)', t, offer_c, cid));
    names := array_append(names, 'technician cannot apply'); oks := oks || (observed LIKE 'PT403:%:contact_blocked'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('INSERT INTO offer_applications (technician_id, offer_id, company_id) VALUES (%L, %L, %L)', t, offer_c, xcid));
    names := array_append(names, 'block follows the offer company'); oks := oks || (observed LIKE 'PT403:%:contact_blocked'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('UPDATE offer_applications SET status = %L WHERE id = %L', 'withdrawn', app_accept));
    names := array_append(names, 'technician can still withdraw'); oks := oks || (observed = 'OK'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('UPDATE offer_applications SET status = %L WHERE id = %L', 'pending', app_accept));
    names := array_append(names, 'technician cannot reapply'); oks := oks || (observed LIKE 'PT403:%:contact_blocked'); seen := seen || observed;
    SELECT count(*) INTO n FROM contact_blocks;
    names := array_append(names, 'technician cannot read blocks'); oks := oks || (n = 0); seen := seen || n::text;
    observed := pg_temp.attempt_100(format('DELETE FROM contact_blocks WHERE technician_id = %L', t));
    names := array_append(names, 'technician delete of a block is a no-op'); oks := oks || (observed = 'OK'); seen := seen || observed;
    observed := pg_temp.attempt_100(format(
      'INSERT INTO contact_blocks (technician_id, company_id, blocked_by) VALUES (%L, %L, %L)', t, xcid, 'technician'));
    names := array_append(names, 'technician cannot insert blocks directly'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;

    -- Denuncias del técnico.
    SELECT r.report_id, r.already_reported INTO v_report, v_flag
      FROM public.report_content('chat_message', msg_company, 'harassment') r;
    names := array_append(names, 'technician reports a company message'); oks := oks || (v_report IS NOT NULL AND NOT v_flag); seen := seen || coalesce(v_flag::text, 'null');
    SELECT r.report_id, r.already_reported INTO v_again, v_flag
      FROM public.report_content('chat_message', msg_company, 'offensive') r;
    names := array_append(names, 'reporting again returns the same report'); oks := oks || (v_again = v_report AND v_flag); seen := seen || coalesce(v_flag::text, 'null');
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'chat_message', msg_tech, 'offensive'));
    names := array_append(names, 'own message cannot be reported'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'offer', offer_a, 'spam_scam'));
    names := array_append(names, 'technician reports a published offer'); oks := oks || (observed = 'OK'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'technician_profile', other_t, 'offensive'));
    names := array_append(names, 'technician cannot report a technician'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'offer', offer_a, 'nope'));
    names := array_append(names, 'unknown reason rejected'); oks := oks || (observed LIKE '22023:%'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'company', cid, 'other'));
    names := array_append(names, 'unknown target rejected'); oks := oks || (observed LIKE '22023:%'); seen := seen || observed;
    SELECT count(*) INTO n FROM content_reports;
    names := array_append(names, 'technician cannot read reports'); oks := oks || (n = 0); seen := seen || n::text;

    -- Empresa.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', ru, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO n FROM chat_rooms WHERE id = room;
    names := array_append(names, 'chat hidden from company'); oks := oks || (n = 0); seen := seen || n::text;
    observed := pg_temp.attempt_100(format(
      'INSERT INTO chat_messages (chat_room_id, sender_user_id, sender_company_member_id, sender_role, body) VALUES (%L, %L, %L, %L, %L)',
      room, ru, rm, 'company', 'blocked'));
    names := array_append(names, 'company cannot write'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('INSERT INTO offer_requests (company_id, technician_id) VALUES (%L, %L)', cid, t));
    names := array_append(names, 'company cannot send a direct offer'); oks := oks || (observed LIKE 'PT403:%:contact_blocked'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.block_contact(%L, %L)', cid, other_t));
    names := array_append(names, 'recruiter can block'); oks := oks || (observed = 'OK'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'chat_message', msg_tech, 'offensive'));
    names := array_append(names, 'company reports a technician message after the block'); oks := oks || (observed = 'OK'); seen := seen || observed;

    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', au, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO n FROM chat_messages WHERE chat_room_id = room;
    names := array_append(names, 'messages hidden from company admin'); oks := oks || (n = 0); seen := seen || n::text;

    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', vu, 'role', 'authenticated')::text, true);
    v_flag := public.contact_blocked(cid, t);
    names := array_append(names, 'viewer sees the block'); oks := oks || v_flag; seen := seen || v_flag::text;
    observed := pg_temp.attempt_100(format('SELECT public.block_contact(%L, %L)', cid, t));
    names := array_append(names, 'viewer cannot block'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'technician_profile', t, 'misleading'));
    names := array_append(names, 'viewer reports a technician profile'); oks := oks || (observed = 'OK'); seen := seen || observed;

    -- Ajenos.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', xu, 'role', 'authenticated')::text, true);
    v_flag := public.contact_blocked(cid, t);
    names := array_append(names, 'outsider cannot learn the block'); oks := oks || (v_flag = false); seen := seen || v_flag::text;
    observed := pg_temp.attempt_100(format('SELECT public.block_contact(%L, %L)', cid, other_t));
    names := array_append(names, 'outsider cannot block for another company'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'chat_message', msg_tech, 'offensive'));
    names := array_append(names, 'outsider cannot report a chat message'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;

    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', ou, 'role', 'authenticated')::text, true);
    v_flag := public.contact_blocked(cid, t);
    names := array_append(names, 'other technician cannot learn the block'); oks := oks || (v_flag = false); seen := seen || v_flag::text;
    observed := pg_temp.attempt_100(format('SELECT public.block_contact(%L, %L)', xcid, t));
    names := array_append(names, 'technician cannot block for someone else'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'offer', offer_d, 'other'));
    names := array_append(names, 'unrelated draft offer cannot be reported'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('INSERT INTO offer_applications (technician_id, offer_id, company_id) VALUES (%L, %L, %L)', other_t, offer_c, xcid));
    names := array_append(names, 'company block of other technician stops applications'); oks := oks || (observed LIKE 'PT403:%:contact_blocked'); seen := seen || observed;

    -- El admin de la plataforma sigue viendo el chat y las denuncias.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pu, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO n FROM chat_messages WHERE chat_room_id = room;
    names := array_append(names, 'platform admin still sees the chat'); oks := oks || (n = 2); seen := seen || n::text;
    SELECT count(*) INTO n FROM content_reports WHERE reporter_user_id IN (tu, ru, vu);
    names := array_append(names, 'platform admin reads reports'); oks := oks || (n = 4); seen := seen || n::text;

    -- Sin sesión.
    RESET ROLE;
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    observed := pg_temp.attempt_100(format('SELECT public.report_content(%L, %L, %L)', 'offer', offer_a, 'other'));
    names := array_append(names, 'anonymous cannot report'); oks := oks || (observed LIKE '42501:%'); seen := seen || observed;
    SELECT count(*) INTO n FROM chat_rooms WHERE id = room;
    names := array_append(names, 'anonymous sees no chat'); oks := oks || (n = 0); seen := seen || n::text;
    RESET ROLE;

    -- Lo guardado.
    SELECT count(*) INTO n FROM contact_blocks WHERE technician_id = t AND company_id = cid AND blocked_by = 'technician' AND blocked_by_user_id = tu;
    names := array_append(names, 'one technician block row with its author'); oks := oks || (n = 1); seen := seen || n::text;
    SELECT count(*) INTO n FROM contact_blocks WHERE technician_id = other_t AND company_id = cid AND blocked_by = 'company' AND blocked_by_user_id = ru;
    names := array_append(names, 'one company block row with its author'); oks := oks || (n = 1); seen := seen || n::text;
    SELECT count(*) INTO n FROM content_reports WHERE id = v_report AND reporter_user_id = tu AND reason = 'harassment' AND notified_at IS NULL;
    names := array_append(names, 'report keeps first reason and is not notified'); oks := oks || (n = 1); seen := seen || n::text;

    -- Soporte quita el bloqueo: todo vuelve como estaba.
    DELETE FROM contact_blocks WHERE technician_id = t AND company_id = cid;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', tu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM chat_messages WHERE chat_room_id = room;
    names := array_append(names, 'unblock restores the chat'); oks := oks || (n = 2); seen := seen || n::text;
    observed := pg_temp.attempt_100(format(
      'INSERT INTO chat_messages (chat_room_id, sender_user_id, sender_role, body) VALUES (%L, %L, %L, %L)',
      room, tu, 'technician', 'back again'));
    names := array_append(names, 'unblock restores writing'); oks := oks || (observed = 'OK'); seen := seen || observed;
    observed := pg_temp.attempt_100(format('UPDATE offer_requests SET status = %L WHERE id = %L', 'accepted', req));
    names := array_append(names, 'unblock restores accepting'); oks := oks || (observed = 'OK'); seen := seen || observed;
    RESET ROLE;

    RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'undo selftest 100';
  EXCEPTION WHEN SQLSTATE 'P0100' THEN
    NULL;
  END;

  -- Fuera del bloque revertido: el ensayo deja preparada esta tabla temporal
  -- para leer cada caso; al aplicar la migración no existe.
  IF to_regclass('pg_temp.selftest_100_results') IS NOT NULL THEN
    EXECUTE 'INSERT INTO pg_temp.selftest_100_results (test, passed, observed) SELECT * FROM unnest($1, $2, $3)'
      USING names, oks, seen;
  END IF;
  FOR i IN 1 .. coalesce(array_length(names, 1), 0) LOOP
    IF oks[i] IS NOT TRUE THEN
      failures := failures || names[i] || ' [' || coalesce(seen[i], 'null') || ']; ';
    END IF;
  END LOOP;
  IF coalesce(array_length(names, 1), 0) <> 50 THEN
    failures := failures || 'expected 50 cases, ran ' || coalesce(array_length(names, 1), 0) || '; ';
  END IF;
  IF failures <> '' THEN
    RAISE EXCEPTION '100 self-test failed: %', failures;
  END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE name LIKE 'selftest-100%')
     OR EXISTS (SELECT 1 FROM profiles WHERE email LIKE 'selftest-100-%@example.invalid') THEN
    RAISE EXCEPTION '100 self-test failed: fixtures were left behind';
  END IF;
  RAISE NOTICE '100 self-test: % cases passed', array_length(names, 1);
END $selftest$;
-- <<< selftest 100

DROP FUNCTION pg_temp.attempt_100(text);

NOTIFY pgrst, 'reload schema';
