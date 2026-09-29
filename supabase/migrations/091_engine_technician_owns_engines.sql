-- ============================================================
-- AviationJobTalent V2 — Migration 091: los motores son del Engine Technician
-- ============================================================
-- Created: 2026-09-29 (Fase 10, sesión 4). Requiere la 090.
--
-- Todo lo de motores pasa a colgar del tipo de perfil `engine_technician`:
--
--   1. Técnico. Sólo un Engine Technician puede tener filas en
--      technician_engine_experience, y quitar el tipo las borra en la misma
--      operación. Es invariante de la BASE, no de la pantalla:
--        - un trigger sobre la tabla rechaza cualquier INSERT o cambio de
--          técnico de quien no tenga el tipo. Hace falta en la tabla y no sólo
--          en la RPC porque la política tee_insert_own (068) deja insertar
--          directamente desde el cliente;
--        - replace_technician_engines lo comprueba antes de borrar nada, para
--          devolver el mismo error sin llegar al trigger. Una lista VACÍA sí
--          pasa: es la que manda el perfil después de quitar el tipo;
--        - un trigger sobre technician_profile_types borra los motores cuando
--          el técnico se queda sin `engine_technician` (DELETE, o UPDATE del
--          admin). Los dos triggers bloquean la fila de technician_profiles
--          —igual que ya hace la RPC— para que un alta de motor y una retirada
--          del tipo simultáneas no dejen motores sueltos.
--
--   2. Oferta. La clase se deriva del tipo: `offer_kind = 'engine'` si y sólo
--      si `technician_type = 'engine_technician'` (CHECK nuevo). El 29-09-2026
--      las 12 ofertas lo cumplían (1 de motor, con engine_technician; ninguna
--      de aeronave con él), así que el CHECK valida sin tocar filas. Los
--      triggers de la 076 (motor ⇒ sin aeronaves) no cambian.
--
--   3. Elegibilidad en ofertas de motor. Se retira la vía (a), "ha declarado
--      algún motor": con el punto 1, declarar motores exige ser Engine
--      Technician, así que (a) ya está dentro de (c). Quedan (b), un type rating
--      colgado de una B1 cuyo motor es el pedido o de su familia, y (c), ser
--      Engine Technician. `p_engine_count` sale de la firma del núcleo en vez de
--      quedarse como un parámetro que no se lee. Sus dos llamantes cambian a la
--      vez: offer_application_ineligibility_reason, aquí, y el validador
--      (scripts/validateApplicationEligibility.ts), en el mismo cambio.
--      El techo de 19 para quien entra por (b) sin ser Engine Technician vive en
--      el scorer (TS); no es elegibilidad y aquí no se replica.
--
-- El borrado de cuenta no pasa por aquí: handle_deleted_user (039/042) conserva
-- las cualificaciones de la lápida y no toca technician_profile_types, y nada
-- hace cascada desde auth.users hasta el perfil. Un DELETE de
-- technician_profiles sí dispara la cascada; el trigger del punto 1 la tolera
-- (la fila del perfil ya no está y no hay nada que bloquear).
--
-- Aplicación única, como 064–090: las post-condiciones dependen de que no haya
-- motores declarados fuera del tipo ni ofertas incoherentes.
-- ============================================================


-- ── 1a. Sólo un Engine Technician declara motores ───────────

CREATE OR REPLACE FUNCTION public.enforce_engine_experience_requires_engine_technician()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- KEY SHARE: choca con el FOR UPDATE de la retirada del tipo (abajo) y de la
  -- RPC, no con las ediciones normales del perfil.
  PERFORM 1 FROM public.technician_profiles WHERE id = NEW.technician_id FOR KEY SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.technician_profile_types
                  WHERE technician_id = NEW.technician_id AND type_code = 'engine_technician') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Only an Engine Technician profile can declare engines.',
      DETAIL  = 'not_engine_technician',
      HINT    = 'Add Engine Technician to the profile types first.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_engine_experience_requires_engine_technician() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_engine_experience_requires_engine_technician ON public.technician_engine_experience;
CREATE TRIGGER enforce_engine_experience_requires_engine_technician
  BEFORE INSERT OR UPDATE OF technician_id ON public.technician_engine_experience
  FOR EACH ROW EXECUTE FUNCTION public.enforce_engine_experience_requires_engine_technician();


-- ── 1b. La RPC de reemplazo lo dice antes de borrar ─────────
-- Idéntica a la 082 salvo el bloque marcado.

CREATE OR REPLACE FUNCTION public.replace_technician_engines(p_technician_id uuid, p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE entry record; seen uuid[] := '{}';
BEGIN
  IF NOT public.is_active_user() OR p_technician_id IS DISTINCT FROM public.my_technician_id() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
  END IF;
  PERFORM 1 FROM public.technician_profiles WHERE id=p_technician_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' THEN RAISE EXCEPTION 'Expected an engines array'; END IF;
  -- 091: sólo un Engine Technician declara motores. La lista vacía pasa.
  IF jsonb_array_length(p_entries)>0 AND NOT EXISTS (SELECT 1 FROM public.technician_profile_types
       WHERE technician_id=p_technician_id AND type_code='engine_technician') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Only an Engine Technician profile can declare engines.',
      DETAIL='not_engine_technician', HINT='Add Engine Technician to the profile types first.';
  END IF;
  FOR entry IN SELECT * FROM jsonb_to_recordset(p_entries) AS x(engine_id uuid,years numeric) LOOP
    PERFORM 1 FROM public.engines WHERE id=entry.engine_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown engine'; END IF;
    IF entry.years IS NOT NULL AND (entry.years<0 OR entry.years>70 OR entry.years='NaN'::numeric) THEN
      RAISE EXCEPTION 'Engine years must be between 0 and 70';
    END IF;
    IF entry.engine_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate engine'; END IF;
    seen:=array_append(seen,entry.engine_id);
  END LOOP;
  DELETE FROM public.technician_engine_experience WHERE technician_id=p_technician_id;
  INSERT INTO public.technician_engine_experience(technician_id,engine_id,years)
    SELECT p_technician_id,x.engine_id,x.years FROM jsonb_to_recordset(p_entries) AS x(engine_id uuid,years numeric);
END $$;


-- ── 1c. Quitar el tipo se lleva los motores ─────────────────

CREATE OR REPLACE FUNCTION public.clear_engines_without_engine_technician()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.type_code = 'engine_technician' THEN
    -- Serializa con el alta de motores (trigger 1a y la RPC). En una cascada
    -- desde technician_profiles la fila ya no existe: no bloquea nada y sigue.
    PERFORM 1 FROM public.technician_profiles WHERE id = OLD.technician_id FOR UPDATE;
    -- Se mira el estado resultante, no la operación: un UPDATE que deja el
    -- tipo donde estaba no borra nada.
    IF NOT EXISTS (SELECT 1 FROM public.technician_profile_types
                    WHERE technician_id = OLD.technician_id AND type_code = 'engine_technician') THEN
      DELETE FROM public.technician_engine_experience WHERE technician_id = OLD.technician_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_engines_without_engine_technician() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_engines_without_engine_technician ON public.technician_profile_types;
CREATE TRIGGER clear_engines_without_engine_technician
  AFTER DELETE OR UPDATE OF technician_id, type_code ON public.technician_profile_types
  FOR EACH ROW EXECUTE FUNCTION public.clear_engines_without_engine_technician();

COMMENT ON TABLE public.technician_engine_experience IS
  'Motores en los que el técnico ha trabajado (Fase 10). Sólo para perfiles Engine Technician (091): '
  'un trigger rechaza al resto y quitar el tipo borra estas filas. '
  'Puntúa en ofertas de motor; los años son display-only y nunca puntúan.';


-- ── 2. La clase de la oferta sale del tipo ──────────────────

ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS chk_offers_kind_matches_technician_type;
ALTER TABLE public.offers ADD CONSTRAINT chk_offers_kind_matches_technician_type
  CHECK ((offer_kind = 'engine') = (technician_type = 'engine_technician'));

COMMENT ON CONSTRAINT chk_offers_kind_matches_technician_type ON public.offers IS
  '091: una oferta es de motor si y sólo si es para Engine Technician. El formulario deriva la clase del tipo.';


-- ── 3. El núcleo de elegibilidad, sin la vía (a) ────────────

DROP FUNCTION IF EXISTS public.offer_eligibility_reason(TEXT, UUID, BOOLEAN, INTEGER, INTEGER, TEXT[], TEXT[], UUID[]);

CREATE FUNCTION public.offer_eligibility_reason(
  p_offer_kind TEXT,
  p_required_engine_id UUID,
  p_only_unlicensed BOOLEAN,
  p_license_count INTEGER,
  p_type_codes TEXT[],
  p_habilitation_license_codes TEXT[],
  p_habilitation_rating_ids UUID[]
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_offer_kind = 'engine' AND NOT (
       'engine_technician' = ANY (COALESCE(p_type_codes, '{}'::TEXT[]))  -- (c)
    OR (p_required_engine_id IS NOT NULL AND EXISTS (                     -- (b)
          SELECT 1
            FROM unnest(COALESCE(p_habilitation_license_codes, '{}'::TEXT[]),
                        COALESCE(p_habilitation_rating_ids, '{}'::UUID[])) AS h(license_code, rating_id)
            JOIN public.license_categories lc ON lc.code = h.license_code AND lc.category_group = 'B1'
            JOIN public.aircraft_type_ratings r ON r.id = h.rating_id AND r.is_active
            JOIN public.engines held ON held.id = r.engine_id
            JOIN public.engines req ON req.id = p_required_engine_id
           WHERE held.id = req.id OR held.family = req.family))
  ) THEN
    RETURN 'no_engine_experience';
  END IF;

  IF COALESCE(p_only_unlicensed, false) AND COALESCE(p_license_count, 0) > 0 THEN
    RETURN 'licensed_technician';
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.offer_eligibility_reason(TEXT, UUID, BOOLEAN, INTEGER, TEXT[], TEXT[], UUID[]) IS
  'Fase 10 (080, 091): espejo SQL de isTechnicianEligibleForOffer. NULL = elegible. Comprobado contra TS por validate:application-eligibility.';

GRANT EXECUTE ON FUNCTION public.offer_eligibility_reason(TEXT, UUID, BOOLEAN, INTEGER, TEXT[], TEXT[], UUID[]) TO anon, authenticated;

-- Idéntica a la 080 salvo que ya no cuenta motores declarados.
CREATE OR REPLACE FUNCTION public.offer_application_ineligibility_reason(p_offer_id UUID, p_technician_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_offer   public.offers%ROWTYPE;
  v_codes   TEXT[];
  v_ratings UUID[];
BEGIN
  SELECT * INTO v_offer FROM public.offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RETURN NULL; -- la FK de offer_applications rechaza la fila igualmente
  END IF;

  -- Las dos listas en la MISMA consulta y con el mismo orden: son pares.
  SELECT array_agg(license_code ORDER BY id), array_agg(aircraft_type_rating_id ORDER BY id)
    INTO v_codes, v_ratings
    FROM public.technician_habilitations
   WHERE technician_id = p_technician_id;

  RETURN public.offer_eligibility_reason(
    v_offer.offer_kind,
    v_offer.required_engine_id,
    v_offer.only_unlicensed,
    (SELECT count(*)::INTEGER FROM public.technician_licenses WHERE technician_id = p_technician_id),
    COALESCE((SELECT array_agg(type_code) FROM public.technician_profile_types WHERE technician_id = p_technician_id), '{}'::TEXT[]),
    COALESCE(v_codes, '{}'::TEXT[]),
    COALESCE(v_ratings, '{}'::UUID[])
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.offer_application_ineligibility_reason(UUID, UUID) FROM PUBLIC, anon, authenticated;


-- ── Post-condiciones y autocomprobación ─────────────────────
--
-- Las pruebas que escriben van dentro de un bloque que se deshace al final
-- (P0091). Usa un técnico activo y una oferta existentes para copiar sus
-- campos; si faltan, la migración falla: una autocomprobación que se omite no
-- comprueba nada.

DO $$
DECLARE
  v_t        UUID;
  v_tu       UUID;
  v_src      public.offers%ROWTYPE;
  v_7b       UUID;
  v_737ng    UUID;
  v_md90     UUID;
  v_reason   TEXT;
  v_state    TEXT;
  v_detail   TEXT;
  v_con      TEXT;
  v_count    INT;
  v_results  TEXT := '';
BEGIN
  -- Estructura.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.technician_engine_experience'::regclass
                   AND tgname = 'enforce_engine_experience_requires_engine_technician' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.technician_profile_types'::regclass
                   AND tgname = 'clear_engines_without_engine_technician' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '091: falta alguno de los dos triggers.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.offers'::regclass
                   AND conname = 'chk_offers_kind_matches_technician_type' AND convalidated) THEN
    RAISE EXCEPTION '091: falta el CHECK chk_offers_kind_matches_technician_type validado.';
  END IF;
  IF to_regprocedure('public.offer_eligibility_reason(text,uuid,boolean,integer,integer,text[],text[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION '091: la firma antigua del núcleo sigue existiendo.';
  END IF;
  IF has_function_privilege('authenticated', 'public.offer_application_ineligibility_reason(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.offer_application_ineligibility_reason(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '091: offer_application_ineligibility_reason no debe ser ejecutable por clientes.';
  END IF;
  IF NOT has_function_privilege('anon', 'public.offer_eligibility_reason(text, uuid, boolean, integer, text[], text[], uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '091: el validador llama al núcleo con la clave publicable; anon debe poder ejecutarlo.';
  END IF;

  -- Datos de partida: el invariante ya se cumple.
  SELECT count(*) INTO v_count FROM public.technician_engine_experience e
   WHERE NOT EXISTS (SELECT 1 FROM public.technician_profile_types t
                      WHERE t.technician_id = e.technician_id AND t.type_code = 'engine_technician');
  IF v_count <> 0 THEN
    RAISE EXCEPTION '091: % filas de motores de técnicos que no son Engine Technician.', v_count;
  END IF;

  -- Fixtures.
  SELECT tp.id, tp.user_id INTO v_t, v_tu FROM public.technician_profiles tp
    JOIN public.profiles p ON p.id = tp.user_id WHERE p.status = 'active' ORDER BY tp.id LIMIT 1;
  SELECT * INTO v_src FROM public.offers ORDER BY id LIMIT 1;
  SELECT id INTO v_7b FROM public.engines WHERE manufacturer = 'CFM International' AND display_name = 'CFM56-7B';
  SELECT id INTO v_737ng FROM public.aircraft_type_ratings WHERE easa_endorsement = 'Boeing 737-600/700/800/900 (CFM56)';
  SELECT id INTO v_md90 FROM public.aircraft_type_ratings WHERE easa_endorsement = 'MD-90 (IAE V2500)';
  IF v_t IS NULL OR v_src.id IS NULL OR v_7b IS NULL OR v_737ng IS NULL OR v_md90 IS NULL THEN
    RAISE EXCEPTION '091: faltan fixtures (técnico activo, oferta, CFM56-7B, 737NG o MD-90).';
  END IF;

  -- El núcleo: (c) y (b) entran, lo demás no; la vía (a) ya no existe.
  v_reason := public.offer_eligibility_reason('engine', v_7b, false, 0, ARRAY['engine_technician'], '{}', '{}');
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION '091: Engine Technician sin motores debería entrar (%).', v_reason; END IF;
  v_reason := public.offer_eligibility_reason('engine', v_7b, false, 1, ARRAY['mechanic'], ARRAY['B1.1'], ARRAY[v_737ng]);
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION '091: B1.1 + 737NG ante CFM56-7B debería entrar por (b) (%).', v_reason; END IF;
  v_reason := public.offer_eligibility_reason('engine', v_7b, false, 0, ARRAY['mechanic'], '{}', '{}');
  IF v_reason IS DISTINCT FROM 'no_engine_experience' THEN RAISE EXCEPTION '091: mecánico sin nada de motores debería quedar fuera (%).', v_reason; END IF;
  v_reason := public.offer_eligibility_reason('engine', v_7b, false, 1, ARRAY['avionic'], ARRAY['B2'], ARRAY[v_737ng]);
  IF v_reason IS DISTINCT FROM 'no_engine_experience' THEN RAISE EXCEPTION '091: B2 + 737NG debería quedar fuera (%).', v_reason; END IF;
  v_reason := public.offer_eligibility_reason('engine', v_7b, false, 1, ARRAY['mechanic'], ARRAY['B1.1'], ARRAY[v_md90]);
  IF v_reason IS DISTINCT FROM 'no_engine_experience' THEN RAISE EXCEPTION '091: B1.1 + MD-90 ante CFM56-7B debería quedar fuera (%).', v_reason; END IF;

  BEGIN
    DELETE FROM public.technician_profile_types WHERE technician_id = v_t AND type_code = 'engine_technician';
    DELETE FROM public.technician_engine_experience WHERE technician_id = v_t;

    -- 1. INSERT directo sin el tipo: rechazado.
    v_detail := NULL;
    BEGIN
      INSERT INTO public.technician_engine_experience (technician_id, engine_id) VALUES (v_t, v_7b);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    END;
    v_results := v_results || '1:' || COALESCE(v_detail, 'ACEPTADO') || ' ';

    -- 2. La RPC, como el técnico, sin el tipo: rechazada con el mismo motivo.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_tu, 'role', 'authenticated')::text, true);
    v_detail := NULL;
    BEGIN
      PERFORM public.replace_technician_engines(v_t, jsonb_build_array(jsonb_build_object('engine_id', v_7b)));
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    END;
    v_results := v_results || '2:' || COALESCE(v_detail, 'ACEPTADA') || ' ';

    -- 3. La lista vacía pasa sin el tipo.
    PERFORM public.replace_technician_engines(v_t, '[]'::jsonb);
    v_results := v_results || '3:vacia ';

    -- 4. Con el tipo, la RPC guarda.
    INSERT INTO public.technician_profile_types (technician_id, type_code) VALUES (v_t, 'engine_technician');
    PERFORM public.replace_technician_engines(v_t, jsonb_build_array(jsonb_build_object('engine_id', v_7b)));
    SELECT count(*) INTO v_count FROM public.technician_engine_experience WHERE technician_id = v_t;
    v_results := v_results || '4:' || v_count || ' ';

    -- 5. Quitar el tipo borra los motores en la misma sentencia.
    DELETE FROM public.technician_profile_types WHERE technician_id = v_t AND type_code = 'engine_technician';
    SELECT count(*) INTO v_count FROM public.technician_engine_experience WHERE technician_id = v_t;
    v_results := v_results || '5:' || v_count || ' ';

    -- 6. Oferta de motor para otro tipo: la rechaza el CHECK nuevo, no otro.
    v_con := NULL;
    BEGIN
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, location_country, location_country_code, min_years_experience, status, visible,
        offer_kind, required_engine_id)
      VALUES (v_src.company_id, 'selftest-091', 'selftest', v_src.contract_type, v_src.product_type, 'mechanic',
        false, v_src.location_country, v_src.location_country_code, 0, 'draft', false, 'engine', v_7b);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    END;
    v_results := v_results || '6:' || COALESCE(v_con, 'ACEPTADA') || ' ';

    -- 7. Oferta de aeronave para Engine Technician: la misma.
    v_con := NULL;
    BEGIN
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, location_country, location_country_code, min_years_experience, status, visible)
      VALUES (v_src.company_id, 'selftest-091', 'selftest', v_src.contract_type, v_src.product_type, 'engine_technician',
        false, v_src.location_country, v_src.location_country_code, 0, 'draft', false);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    END;
    v_results := v_results || '7:' || COALESCE(v_con, 'ACEPTADA') || ' ';

    -- 8. Y la forma buena entra.
    INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
      requires_certification, location_country, location_country_code, min_years_experience, status, visible,
      offer_kind, required_engine_id)
    VALUES (v_src.company_id, 'selftest-091', 'selftest', v_src.contract_type, v_src.product_type, 'engine_technician',
      false, v_src.location_country, v_src.location_country_code, 0, 'draft', false, 'engine', v_7b);
    v_results := v_results || '8:ok ';

    RAISE EXCEPTION USING ERRCODE = 'P0091', MESSAGE = 'deshacer autocomprobación';
  EXCEPTION WHEN SQLSTATE 'P0091' THEN
    NULL;
  END;

  IF v_results IS DISTINCT FROM
     '1:not_engine_technician 2:not_engine_technician 3:vacia 4:1 5:0 6:chk_offers_kind_matches_technician_type 7:chk_offers_kind_matches_technician_type 8:ok ' THEN
    RAISE EXCEPTION '091: la autocomprobación no dio lo esperado: %', v_results;
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-091') THEN
    RAISE EXCEPTION '091: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '091: %', v_results;
END $$;

NOTIFY pgrst, 'reload schema';
