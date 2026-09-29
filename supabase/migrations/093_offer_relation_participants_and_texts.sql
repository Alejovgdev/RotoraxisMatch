-- ============================================================
-- AviationJobTalent V2 — Migration 093: participantes de las ofertas
-- directas inmutables, y cada parte edita sólo su propio texto
-- ============================================================
-- Created: 2026-09-29 (Fase 10, sesión 6). Requiere la 092.
--
-- ── LOS FALLOS (filas 2–4 de la auditoría de la sesión 5, docs/fase-10.md) ──
-- Comprobados en vivo el 2026-09-29, dentro de transacciones revertidas:
--   2. La empresa cambiaba `technician_id` de una oferta directa YA aceptada
--      y veía identidad (offer_accepted_between) y documentos
--      (documents_unlocked) de otro técnico cualquiera. La 081 hizo
--      inmutables los participantes de las candidaturas, no los de las
--      ofertas directas, y la 092 no lo cubre: ese UPDATE no cambia el estado.
--   3. El técnico cambiaba `company_id`/`offer_id` de una oferta directa
--      pendiente y la aceptaba: relación y chat con una empresa que no le
--      había enviado nada.
--   4. Cada parte reescribía el texto de la otra: la empresa, la carta de
--      presentación del técnico (offer_applications.cover_note); el técnico,
--      el mensaje de la empresa (offer_requests.message).
--
-- ── LO QUE HACE ─────────────────────────────────────────────────────────
--   - guard_offer_request_participants: espejo de
--     guard_application_participants (081) en offer_requests. Un usuario de
--     la app (rol anon o authenticated), sea la parte que sea y también un
--     admin de la plataforma, no cambia offer_id, technician_id ni company_id.
--   - guard_offer_relation_texts, en las dos tablas: cover_note sólo lo
--     cambia el técnico de la fila; message, sólo la empresa de la fila
--     (can_act_for_company: admin o recruiter). Un admin de la plataforma no
--     edita el texto de nadie, igual que en la 092 no decide por nadie.
--   - El mantenimiento (service_role, SQL sin rol de la app, y el borrado de
--     cuenta: handle_deleted_user vacía cover_note al construir la lápida)
--     queda exento, con el mismo criterio que la 081 y la 092.
--
-- Se mira la fila ANTERIOR para decidir de quién es: con los participantes
-- ya inmutables, OLD y NEW coinciden en eso para cualquier usuario de la app.
--
-- Aplicación única, como 064–092.
-- ============================================================


-- ── 1. Participantes de offer_requests: inmutables para la app ──

CREATE OR REPLACE FUNCTION public.guard_offer_request_participants()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') AND
     (NEW.offer_id IS DISTINCT FROM OLD.offer_id OR
      NEW.technician_id IS DISTINCT FROM OLD.technician_id OR
      NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Direct offer participants cannot be changed.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_offer_request_participants() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a_guard_offer_request_participants ON public.offer_requests;
CREATE TRIGGER a_guard_offer_request_participants BEFORE UPDATE ON public.offer_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_offer_request_participants();


-- ── 2. Cada parte, sólo su texto ────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_offer_relation_texts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  -- Los IF van anidados por tabla, no con AND: PL/pgSQL prepara la expresión
  -- entera, y NEW.cover_note en una fila de offer_requests (o NEW.message en
  -- una de offer_applications) es un error 42703 aunque la otra condición ya
  -- sea falsa.
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    -- COALESCE: can_act_for_company y my_technician_id son NULL, no false,
    -- para quien no es la parte (ver la 092).
    IF TG_TABLE_NAME = 'offer_applications' THEN
      IF NEW.cover_note IS DISTINCT FROM OLD.cover_note AND
         NOT COALESCE(is_active_user() AND OLD.technician_id = my_technician_id(), false) THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only the technician can edit the cover note.';
      END IF;
    ELSIF TG_TABLE_NAME = 'offer_requests' THEN
      IF NEW.message IS DISTINCT FROM OLD.message AND
         NOT COALESCE(is_active_user() AND can_act_for_company(OLD.company_id), false) THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only the company can edit the message.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_offer_relation_texts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a_guard_offer_relation_texts ON public.offer_applications;
CREATE TRIGGER a_guard_offer_relation_texts BEFORE UPDATE OF cover_note ON public.offer_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_offer_relation_texts();
DROP TRIGGER IF EXISTS a_guard_offer_relation_texts ON public.offer_requests;
CREATE TRIGGER a_guard_offer_relation_texts BEFORE UPDATE OF message ON public.offer_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_offer_relation_texts();


-- ── Post-condiciones y autocomprobación ─────────────────────
--
-- Mismo patrón que la 092: cada parte con su sesión y el rol
-- `authenticated`; cada paso se registra (OK o SQLSTATE) y todo se deshace
-- al final (P0093).

CREATE FUNCTION pg_temp.attempt_093(statement TEXT) RETURNS TEXT LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $f$;

DO $$
DECLARE
  v_t      UUID;  v_tu UUID;   -- técnico de las relaciones
  v_x      UUID;               -- otro técnico, ajeno
  v_cu     UUID;  v_cid UUID;  -- empresa (admin o recruiter)
  v_cb     UUID;               -- otra empresa
  v_admin  UUID;
  v_src    public.offers%ROWTYPE;
  v_o      UUID[] := '{}';
  v_oid    UUID;
  v_app    UUID;
  v_acc    UUID;  v_pen UUID;  -- oferta directa aceptada / pendiente
  v_results TEXT := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.offer_requests'::regclass AND tgname = 'a_guard_offer_request_participants' AND NOT tgisinternal)
     OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'a_guard_offer_relation_texts' AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '093: faltan triggers.';
  END IF;

  SELECT m.user_id, m.company_id INTO v_cu, v_cid FROM public.company_members m
    JOIN public.profiles p ON p.id = m.user_id
   WHERE p.status = 'active' AND m.role IN ('admin', 'recruiter') ORDER BY m.user_id LIMIT 1;
  SELECT id INTO v_cb FROM public.companies WHERE id <> v_cid ORDER BY id LIMIT 1;
  SELECT tp.id, tp.user_id INTO v_t, v_tu FROM public.technician_profiles tp
    JOIN public.profiles p ON p.id = tp.user_id
   WHERE p.status = 'active' ORDER BY tp.id LIMIT 1;
  SELECT tp.id INTO v_x FROM public.technician_profiles tp
   WHERE tp.id <> v_t AND NOT public.offer_accepted_between(v_cid, tp.id) ORDER BY tp.id LIMIT 1;
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1;
  SELECT * INTO v_src FROM public.offers ORDER BY id LIMIT 1;
  IF v_cu IS NULL OR v_cb IS NULL OR v_t IS NULL OR v_x IS NULL OR v_admin IS NULL OR v_src.id IS NULL THEN
    RAISE EXCEPTION '093: faltan fixtures (empresa y otra empresa, técnico y otro técnico, admin, oferta).';
  END IF;

  BEGIN
    FOR i IN 1..3 LOOP
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, location_country, location_country_code, min_years_experience, status, visible)
      VALUES (v_cid, 'selftest-093', 'selftest', v_src.contract_type, v_src.product_type, 'mechanic',
        false, v_src.location_country, v_src.location_country_code, 0, 'published', true)
      RETURNING id INTO v_oid;
      v_o := v_o || v_oid;
    END LOOP;

    -- El técnico aplica con carta; la empresa le manda dos ofertas directas con mensaje.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_tu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.offer_applications (technician_id, offer_id, company_id, cover_note)
    VALUES (v_t, v_o[1], v_cid, 'carta del tecnico') RETURNING id INTO v_app;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_cu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.offer_requests (technician_id, offer_id, company_id, message)
    VALUES (v_t, v_o[2], v_cid, 'mensaje de la empresa') RETURNING id INTO v_acc;
    INSERT INTO public.offer_requests (technician_id, offer_id, company_id, message)
    VALUES (v_t, v_o[3], v_cid, 'mensaje de la empresa') RETURNING id INTO v_pen;
    RESET ROLE;
    -- El técnico acepta la primera.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_tu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_results := v_results || '0:' || pg_temp.attempt_093(format('UPDATE public.offer_requests SET status = %L WHERE id = %L', 'accepted', v_acc)) || ' ';
    RESET ROLE;

    -- Empresa.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_cu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    -- 1. Cambiar el técnico de la oferta directa aceptada (fila 2).
    v_results := v_results || '1:' || pg_temp.attempt_093(format('UPDATE public.offer_requests SET technician_id = %L WHERE id = %L', v_x, v_acc)) || ' ';
    -- 2. Cambiar su oferta.
    v_results := v_results || '2:' || pg_temp.attempt_093(format('UPDATE public.offer_requests SET offer_id = NULL WHERE id = %L', v_pen)) || ' ';
    -- 3. Reescribir la carta del técnico (fila 4).
    v_results := v_results || '3:' || pg_temp.attempt_093(format('UPDATE public.offer_applications SET cover_note = %L WHERE id = %L', 'reescrita', v_app)) || ' ';
    -- 4. Editar su propio mensaje: sí.
    v_results := v_results || '4:' || pg_temp.attempt_093(format('UPDATE public.offer_requests SET message = %L WHERE id = %L', 'mensaje corregido', v_pen)) || ' ';
    RESET ROLE;

    -- Técnico.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_tu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    -- 5. Llevar la oferta directa pendiente a otra empresa (fila 3).
    v_results := v_results || '5:' || pg_temp.attempt_093(format('UPDATE public.offer_requests SET company_id = %L WHERE id = %L', v_cb, v_pen)) || ' ';
    -- 6. Reescribir el mensaje de la empresa (fila 4).
    v_results := v_results || '6:' || pg_temp.attempt_093(format('UPDATE public.offer_requests SET message = %L WHERE id = %L', 'reescrito', v_pen)) || ' ';
    -- 7. Editar su propia carta: sí.
    v_results := v_results || '7:' || pg_temp.attempt_093(format('UPDATE public.offer_applications SET cover_note = %L WHERE id = %L', 'carta corregida', v_app)) || ' ';
    -- 8. Rechazar la oferta directa pendiente sigue funcionando.
    v_results := v_results || '8:' || pg_temp.attempt_093(format('UPDATE public.offer_requests SET status = %L WHERE id = %L', 'rejected', v_pen)) || ' ';
    RESET ROLE;

    -- 9. Un admin de la plataforma no reasigna ni reescribe.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_results := v_results || '9:' || pg_temp.attempt_093(format('UPDATE public.offer_requests SET technician_id = %L WHERE id = %L', v_x, v_acc))
      || '/' || pg_temp.attempt_093(format('UPDATE public.offer_applications SET cover_note = %L WHERE id = %L', 'admin', v_app)) || ' ';
    RESET ROLE;

    -- 10. El mantenimiento (como el borrado de cuenta) sí vacía la carta.
    PERFORM set_config('request.jwt.claims', '', true);
    v_results := v_results || '10:' || pg_temp.attempt_093(format('UPDATE public.offer_applications SET cover_note = NULL WHERE id = %L', v_app)) || ' ';

    -- Cómo quedó: técnico de la aceptada, identidad del ajeno, empresa de la
    -- pendiente, y los dos textos.
    v_results := v_results || '| acc_tech=' || ((SELECT technician_id FROM public.offer_requests WHERE id = v_acc) = v_t)::text
      || ' x_revealed=' || public.offer_accepted_between(v_cid, v_x)::text
      || ' pen_company=' || ((SELECT company_id FROM public.offer_requests WHERE id = v_pen) = v_cid)::text
      || ' pen_message=' || (SELECT message FROM public.offer_requests WHERE id = v_pen)
      || ' cover_note=' || COALESCE((SELECT cover_note FROM public.offer_applications WHERE id = v_app), 'NULL');

    RAISE EXCEPTION USING ERRCODE = 'P0093', MESSAGE = 'deshacer autocomprobación';
  EXCEPTION WHEN SQLSTATE 'P0093' THEN
    NULL;
  END;

  IF v_results IS DISTINCT FROM
     '0:OK 1:42501 2:42501 3:42501 4:OK 5:42501 6:42501 7:OK 8:OK 9:42501/42501 10:OK '
     || '| acc_tech=true x_revealed=false pen_company=true pen_message=mensaje corregido cover_note=NULL' THEN
    RAISE EXCEPTION '093: la autocomprobación no dio lo esperado: %', v_results;
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-093') THEN
    RAISE EXCEPTION '093: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '093: %', v_results;
END $$;

DROP FUNCTION pg_temp.attempt_093(TEXT);

NOTIFY pgrst, 'reload schema';
