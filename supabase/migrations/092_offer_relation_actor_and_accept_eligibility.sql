-- ============================================================
-- AviationJobTalent V2 — Migration 092: quién cambia el estado de una
-- relación, y aceptar una candidatura vuelve a comprobar la elegibilidad
-- ============================================================
-- Created: 2026-09-29 (Fase 10, sesión 5). Requiere la 091.
--
-- ── EL FALLO ────────────────────────────────────────────────────────────
-- La máquina de estados (assert_offer_relation_transition, 033) decía QUÉ
-- transición es válida, pero nadie comprobaba QUIÉN la hacía. Las dos partes
-- de una relación tienen política de UPDATE sobre su fila (oa_update_company,
-- oa_update_technician, or_update_company, or_update_technician), así que con
-- un UPDATE directo, saltándose la app:
--   - una empresa aceptaba su propia oferta directa y veía la identidad del
--     técnico (offer_accepted_between) y sus documentos (documents_unlocked)
--     sin que el técnico aceptara nada;
--   - un técnico se aceptaba su propia candidatura: identidad y documentos
--     visibles para la empresa y sala de chat creada, sin que la empresa
--     decidiera.
-- Comprobado en vivo el 2026-09-29, dentro de transacciones revertidas.
--
-- ── LO QUE HACE ─────────────────────────────────────────────────────────
-- 1. Quién puede hacer cada transición. Un núcleo puro,
--    offer_relation_transition_actor(tabla, de, a), devuelve la parte:
--
--      tabla               transición                 parte
--      offer_applications  pending -> accepted        company
--                          pending -> rejected        company
--                          pending -> withdrawn       technician
--                          withdrawn -> pending       technician
--      offer_requests      pending -> accepted        technician
--                          pending -> rejected        technician
--                          pending -> withdrawn       company
--      las dos             pending -> expired         system
--
--    handle_offer_relation_status_transition (el trigger de transición de las
--    dos tablas) lo hace cumplir: un usuario de la app (rol anon o
--    authenticated) sólo hace la transición que le toca a SU parte de ESA
--    fila —empresa: can_act_for_company, admin o recruiter; técnico: el de la
--    fila—. Si no, 42501 'Not authorized.'. Un admin de la plataforma no es
--    ninguna de las dos partes: no acepta, rechaza ni retira en nombre de
--    nadie (decisión del 2026-09-29). 'system' sólo lo hace el mantenimiento
--    (service_role o SQL sin rol de la app), igual que la exención de
--    guard_application_participants (081).
--    El espejo en TS es TRANSITION_ACTORS (src/utils/offerRelationStateMachine.ts)
--    y validate:state-machine compara los dos sobre las 40 combinaciones.
--
-- 2. Aceptar una candidatura vuelve a comprobar la elegibilidad
--    (enforce_offer_application_eligibility). Una oferta puede cambiar
--    después de recibir candidaturas —p. ej. cambiar de tipo y de clase, o
--    pasar a "sólo sin licencia"— y hasta ahora aceptar no lo miraba. Se
--    autoriza a la empresa ANTES de leer cualificaciones (regla H5) y, si el
--    técnico ya no es elegible, PT403 con el motivo en DETAIL, los mismos
--    códigos que al aplicar. Rechazar y retirar no se bloquean nunca. Las
--    ofertas directas no comprueban elegibilidad (decisión del 2026-09-29: la
--    empresa elige al técnico a propósito).
--
-- 3. Quién y cuándo cambió el estado: status_changed_by (el usuario, NULL si
--    fue mantenimiento) y status_changed_at, en las dos tablas. Los escribe
--    SÓLO la base: al insertar (force_offer_relation_defaults) y en cada
--    cambio de estado (el trigger de transición); cualquier otro UPDATE
--    conserva los valores anteriores, así que no se pueden falsear. Las filas
--    anteriores a esta migración quedan a NULL: no consta quién las cambió.
--
-- Fuera de esta migración, a propósito (lista en docs/fase-10.md): los
-- participantes de offer_requests siguen siendo mutables (081 sólo protegió
-- offer_applications), y cada parte puede reescribir el texto de la otra
-- (cover_note, message).
--
-- Aplicación única, como 064–091.
-- ============================================================


-- ── 1. Columnas de auditoría ────────────────────────────────

ALTER TABLE public.offer_applications
  ADD COLUMN IF NOT EXISTS status_changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

ALTER TABLE public.offer_requests
  ADD COLUMN IF NOT EXISTS status_changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.offer_applications.status_changed_by IS
  '092: usuario que hizo el último cambio de estado (o creó la fila). NULL = mantenimiento, o fila anterior a la 092. Lo escribe sólo la base.';
COMMENT ON COLUMN public.offer_applications.status_changed_at IS
  '092: cuándo se hizo el último cambio de estado (o se creó la fila). NULL = fila anterior a la 092. Lo escribe sólo la base.';
COMMENT ON COLUMN public.offer_requests.status_changed_by IS
  '092: usuario que hizo el último cambio de estado (o creó la fila). NULL = mantenimiento, o fila anterior a la 092. Lo escribe sólo la base.';
COMMENT ON COLUMN public.offer_requests.status_changed_at IS
  '092: cuándo se hizo el último cambio de estado (o se creó la fila). NULL = fila anterior a la 092. Lo escribe sólo la base.';


-- ── 2. El núcleo: qué parte hace cada transición ────────────

CREATE OR REPLACE FUNCTION public.offer_relation_transition_actor(
  relation_table TEXT,
  old_status offer_request_status,
  new_status offer_request_status
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN old_status = new_status THEN NULL
    WHEN relation_table = 'offer_applications' THEN CASE
      WHEN old_status = 'pending'   AND new_status IN ('accepted', 'rejected') THEN 'company'
      WHEN old_status = 'pending'   AND new_status = 'withdrawn'               THEN 'technician'
      WHEN old_status = 'withdrawn' AND new_status = 'pending'                 THEN 'technician'
      WHEN old_status = 'pending'   AND new_status = 'expired'                 THEN 'system'
    END
    WHEN relation_table = 'offer_requests' THEN CASE
      WHEN old_status = 'pending'   AND new_status IN ('accepted', 'rejected') THEN 'technician'
      WHEN old_status = 'pending'   AND new_status = 'withdrawn'               THEN 'company'
      WHEN old_status = 'pending'   AND new_status = 'expired'                 THEN 'system'
    END
  END
$function$;

COMMENT ON FUNCTION public.offer_relation_transition_actor(TEXT, offer_request_status, offer_request_status) IS
  '092: qué parte (company, technician, system) hace cada transición válida; NULL si no hay cambio o la transición no existe. '
  'Espejo de TRANSITION_ACTORS en TS, comprobado por validate:state-machine.';

-- El validador lo llama con la clave publicable, como assert_offer_relation_transition.
GRANT EXECUTE ON FUNCTION public.offer_relation_transition_actor(TEXT, offer_request_status, offer_request_status) TO anon, authenticated;


-- ── 3. El trigger de transición: quién, y quién consta ──────
-- Idéntico a la 033 salvo lo marcado con 092.

CREATE OR REPLACE FUNCTION public.handle_offer_relation_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor TEXT;
BEGIN
  IF OLD.status = NEW.status THEN
    NEW.identity_revealed  := OLD.identity_revealed;
    NEW.documents_unlocked := OLD.documents_unlocked;
    -- 092: la auditoría sólo la escribe un cambio de estado.
    NEW.status_changed_by  := OLD.status_changed_by;
    NEW.status_changed_at  := OLD.status_changed_at;
    RETURN NEW;
  END IF;

  PERFORM assert_offer_relation_transition(OLD.status, NEW.status, TG_TABLE_NAME);

  -- 092: un usuario de la app sólo hace la transición de SU parte de esta
  -- fila. Se mira la fila ANTERIOR: la relación era de quien era.
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    v_actor := offer_relation_transition_actor(TG_TABLE_NAME, OLD.status, NEW.status);
    IF NOT COALESCE(
         (v_actor = 'company'    AND is_active_user() AND can_act_for_company(OLD.company_id))
      OR (v_actor = 'technician' AND is_active_user() AND OLD.technician_id = my_technician_id()),
         false) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized.';
    END IF;
  END IF;

  NEW.status_changed_by := auth.uid();  -- NULL si lo hace el mantenimiento
  NEW.status_changed_at := now();

  IF NEW.status = 'accepted' THEN
    NEW.identity_revealed  := true;
    NEW.documents_unlocked := true;

    IF TG_TABLE_NAME = 'offer_requests' THEN
      INSERT INTO chat_rooms (offer_request_id, technician_id, company_id)
      VALUES (NEW.id, NEW.technician_id, NEW.company_id)
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO chat_rooms (offer_application_id, technician_id, company_id)
      VALUES (NEW.id, NEW.technician_id, NEW.company_id)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    NEW.identity_revealed  := false;
    NEW.documents_unlocked := false;
  END IF;

  RETURN NEW;
END;
$function$;


-- ── 4. Al crear la fila, también consta quién ───────────────
-- Idéntico a la 011 salvo las dos líneas de 092.

CREATE OR REPLACE FUNCTION public.force_offer_relation_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.status             := 'pending';
  NEW.identity_revealed  := false;
  NEW.documents_unlocked := false;
  NEW.status_changed_by  := auth.uid();  -- 092
  NEW.status_changed_at  := now();       -- 092
  RETURN NEW;
END;
$$;


-- ── 5. Aceptar una candidatura vuelve a comprobar la elegibilidad ──
-- Idéntico a la 081 salvo el bloque de 092.

CREATE OR REPLACE FUNCTION public.enforce_offer_application_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_reason text;
BEGIN
  -- 092: aceptar vuelve a comprobarla. La oferta pudo cambiar después de
  -- recibir la candidatura. Autoriza a la empresa antes de leer nada del
  -- técnico (H5); el mantenimiento no pasa por esa autorización pero sí por
  -- la elegibilidad.
  IF TG_OP='UPDATE' AND NEW.status='accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    -- COALESCE: can_act_for_company es NULL, no false, para quien no es
    -- miembro de la empresa, y NOT NULL no entraría en el IF.
    IF current_setting('role', true) IN ('anon', 'authenticated') AND
       NOT COALESCE(public.is_active_user() AND public.can_act_for_company(OLD.company_id), false) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
    END IF;
    v_reason:=public.offer_application_ineligibility_reason(NEW.offer_id,NEW.technician_id);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='PT403', MESSAGE='The technician is no longer eligible for this offer.', DETAIL=v_reason;
    END IF;
    RETURN NEW;
  END IF;
  -- Reject/withdraw do not read qualifications and retain their RLS.
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


-- ── Post-condiciones y autocomprobación ─────────────────────
--
-- Todo lo que escribe va en un bloque que se deshace al final (P0092). Cada
-- parte actúa con su sesión (request.jwt.claims) y con el rol
-- `authenticated`, que es el camino que la regla nueva vigila; el
-- mantenimiento, sin rol de la app. Cada paso se registra —OK o el
-- SQLSTATE, con el motivo si lo hay— en vez de abortar: si una pieza falta,
-- la comparación final dice cuál.

CREATE FUNCTION pg_temp.attempt_092(statement TEXT) RETURNS TEXT LANGUAGE plpgsql AS $f$
DECLARE v_detail TEXT;
BEGIN
  EXECUTE statement;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || CASE WHEN COALESCE(v_detail, '') <> '' THEN '=' || v_detail ELSE '' END;
END $f$;

DO $$
DECLARE
  v_t      UUID;  v_tu UUID;   -- técnico
  v_cu     UUID;  v_cid UUID;  -- empresa (admin o recruiter)
  v_admin  UUID;               -- admin de la plataforma
  v_src    public.offers%ROWTYPE;
  v_o      UUID[] := '{}';
  v_oid    UUID;
  v_app    UUID[] := '{}';
  v_aid    UUID;
  v_req1   UUID;  v_req2 UUID;
  v_results TEXT := '';
BEGIN
  -- Estructura.
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name IN ('offer_applications', 'offer_requests') AND column_name IN ('status_changed_by', 'status_changed_at')) <> 4 THEN
    RAISE EXCEPTION '092: faltan columnas de auditoría.';
  END IF;
  IF NOT has_function_privilege('anon', 'public.offer_relation_transition_actor(text, offer_request_status, offer_request_status)', 'EXECUTE') THEN
    RAISE EXCEPTION '092: el validador llama al núcleo con la clave publicable; anon debe poder ejecutarlo.';
  END IF;
  IF offer_relation_transition_actor('offer_applications', 'pending', 'accepted') IS DISTINCT FROM 'company'
     OR offer_relation_transition_actor('offer_requests', 'pending', 'accepted') IS DISTINCT FROM 'technician'
     OR offer_relation_transition_actor('offer_requests', 'pending', 'withdrawn') IS DISTINCT FROM 'company'
     OR offer_relation_transition_actor('offer_applications', 'withdrawn', 'pending') IS DISTINCT FROM 'technician'
     OR offer_relation_transition_actor('offer_applications', 'pending', 'expired') IS DISTINCT FROM 'system'
     OR offer_relation_transition_actor('offer_requests', 'withdrawn', 'pending') IS NOT NULL THEN
    RAISE EXCEPTION '092: el núcleo de actores no dice lo esperado.';
  END IF;

  -- Fixtures: un técnico y una empresa activos, y un admin de la plataforma.
  SELECT m.user_id, m.company_id INTO v_cu, v_cid FROM public.company_members m
    JOIN public.profiles p ON p.id = m.user_id
   WHERE p.status = 'active' AND m.role IN ('admin', 'recruiter') ORDER BY m.user_id LIMIT 1;
  SELECT tp.id, tp.user_id INTO v_t, v_tu FROM public.technician_profiles tp
    JOIN public.profiles p ON p.id = tp.user_id
   WHERE p.status = 'active' ORDER BY tp.id LIMIT 1;
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1;
  SELECT * INTO v_src FROM public.offers ORDER BY id LIMIT 1;
  IF v_cu IS NULL OR v_t IS NULL OR v_admin IS NULL OR v_src.id IS NULL THEN
    RAISE EXCEPTION '092: faltan fixtures (empresa, técnico, admin u oferta de la que copiar).';
  END IF;

  BEGIN
    -- Cuatro ofertas de aeronave de la empresa, abiertas a cualquiera, y una
    -- licencia para el técnico (para poder dejarlo fuera con "sólo sin licencia").
    FOR i IN 1..4 LOOP
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, location_country, location_country_code, min_years_experience, status, visible)
      VALUES (v_cid, 'selftest-092', 'selftest', v_src.contract_type, v_src.product_type, 'mechanic',
        false, v_src.location_country, v_src.location_country_code, 0, 'published', true)
      RETURNING id INTO v_oid;
      v_o := v_o || v_oid;
    END LOOP;
    INSERT INTO public.technician_licenses (technician_id, authority, license_code) VALUES (v_t, 'EASA', 'B1.1')
      ON CONFLICT (technician_id, authority, license_code) DO NOTHING;

    -- El técnico aplica a las cuatro (con su sesión, como en la app).
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_tu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    FOR i IN 1..4 LOOP
      INSERT INTO public.offer_applications (technician_id, offer_id, company_id) VALUES (v_t, v_o[i], v_cid)
      RETURNING id INTO v_aid;
      v_app := v_app || v_aid;
    END LOOP;
    RESET ROLE;
    v_results := v_results || '0:' || (SELECT (status_changed_by = v_tu AND status_changed_at IS NOT NULL)::text
      FROM public.offer_applications WHERE id = v_app[1]) || ' ';

    -- La oferta 2 cambia después: "sólo sin licencia". Su candidatura ya no es elegible.
    UPDATE public.offers SET only_unlicensed = true WHERE id = v_o[2];

    -- Empresa.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_cu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    -- 1. Aceptar la que ya no es elegible: PT403 con el motivo.
    v_results := v_results || '1:' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'accepted', v_app[2])) || ' ';
    -- 2. Rechazarla sí se puede.
    v_results := v_results || '2:' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'rejected', v_app[2])) || ' ';
    -- 3. Aceptar una elegible.
    v_results := v_results || '3:' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'accepted', v_app[1])) || ' ';
    -- 4. Lo que no le toca a la empresa: retirar una candidatura, caducarla.
    v_results := v_results || '4:' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'withdrawn', v_app[3]))
      || '/' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'expired', v_app[3])) || ' ';
    -- 5. Falsear la auditoría sin cambiar el estado (se comprueba abajo, en a1).
    PERFORM pg_temp.attempt_092(format('UPDATE public.offer_applications SET status_changed_by = %L, status_changed_at = now() - interval %L WHERE id = %L', v_tu, '1 year', v_app[1]));
    -- 6. Oferta directa: la empresa la envía y no puede aceptarla ella.
    INSERT INTO public.offer_requests (technician_id, offer_id, company_id) VALUES (v_t, v_o[3], v_cid) RETURNING id INTO v_req1;
    INSERT INTO public.offer_requests (technician_id, offer_id, company_id) VALUES (v_t, v_o[4], v_cid) RETURNING id INTO v_req2;
    v_results := v_results || '6:' || pg_temp.attempt_092(format('UPDATE public.offer_requests SET status = %L WHERE id = %L', 'accepted', v_req1)) || ' ';
    -- 7. La empresa sí retira la suya.
    v_results := v_results || '7:' || pg_temp.attempt_092(format('UPDATE public.offer_requests SET status = %L WHERE id = %L', 'withdrawn', v_req2)) || ' ';
    RESET ROLE;

    -- Técnico.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_tu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    -- 8. No puede aceptarse una candidatura.
    v_results := v_results || '8:' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'accepted', v_app[3])) || ' ';
    -- 9. Sí puede retirarla y volver a aplicar.
    v_results := v_results || '9:' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'withdrawn', v_app[3]))
      || '/' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'pending', v_app[3])) || ' ';
    -- 10. No puede retirar la oferta directa de la empresa; sí aceptarla.
    v_results := v_results || '10:' || pg_temp.attempt_092(format('UPDATE public.offer_requests SET status = %L WHERE id = %L', 'withdrawn', v_req1))
      || '/' || pg_temp.attempt_092(format('UPDATE public.offer_requests SET status = %L WHERE id = %L', 'accepted', v_req1)) || ' ';
    RESET ROLE;

    -- 11. Un admin de la plataforma no acepta en nombre de la empresa.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_results := v_results || '11:' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'accepted', v_app[4])) || ' ';
    RESET ROLE;

    -- 12. El mantenimiento (sin rol de la app, sin sesión) caduca una.
    PERFORM set_config('request.jwt.claims', '', true);
    v_results := v_results || '12:' || pg_temp.attempt_092(format('UPDATE public.offer_applications SET status = %L WHERE id = %L', 'expired', v_app[4])) || ' ';

    -- Cómo quedó cada fila: estado, quién (t = técnico, c = empresa, - = nadie) e identidad.
    v_results := v_results || '| ' || (
      SELECT string_agg(x.k || '=' || x.status || '/' || x.who || '/' || x.ident, ' ' ORDER BY x.n)
        FROM (
          SELECT u.n, 'a' || u.n AS k, a.status::text AS status,
                 CASE a.status_changed_by WHEN v_tu THEN 't' WHEN v_cu THEN 'c' ELSE '-' END AS who,
                 a.identity_revealed::text AS ident
            FROM unnest(v_app) WITH ORDINALITY AS u(id, n) JOIN public.offer_applications a ON a.id = u.id
          UNION ALL
          SELECT 4 + u.n, 'r' || u.n, r.status::text,
                 CASE r.status_changed_by WHEN v_tu THEN 't' WHEN v_cu THEN 'c' ELSE '-' END,
                 r.identity_revealed::text
            FROM unnest(ARRAY[v_req1, v_req2]) WITH ORDINALITY AS u(id, n) JOIN public.offer_requests r ON r.id = u.id
        ) x
    ) || ' chat_a1=' || (EXISTS (SELECT 1 FROM public.chat_rooms WHERE offer_application_id = v_app[1]))::text;

    RAISE EXCEPTION USING ERRCODE = 'P0092', MESSAGE = 'deshacer autocomprobación';
  EXCEPTION WHEN SQLSTATE 'P0092' THEN
    NULL;
  END;

  IF v_results IS DISTINCT FROM
     '0:true 1:PT403=licensed_technician 2:OK 3:OK 4:42501/42501 6:42501 7:OK 8:42501 9:OK/OK 10:42501/OK 11:42501 12:OK '
     || '| a1=accepted/c/true a2=rejected/c/false a3=pending/t/false a4=expired/-/false r1=accepted/t/true r2=withdrawn/c/false chat_a1=true' THEN
    RAISE EXCEPTION '092: la autocomprobación no dio lo esperado: %', v_results;
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-092') THEN
    RAISE EXCEPTION '092: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '092: %', v_results;
END $$;

DROP FUNCTION pg_temp.attempt_092(TEXT);

NOTIFY pgrst, 'reload schema';
