-- ============================================================
-- AviationJobTalent V2 — Migration 080: la base impide aplicar a una oferta
-- para la que el técnico no es elegible
-- ============================================================
-- Created: 2026-09-16 (Fase 10, paso 5c)
--
-- Hasta aquí el filtro de elegibilidad (isTechnicianEligibleForOffer,
-- src/utils/offerMatchExplain.ts) sólo vivía en el cliente: la lista de
-- ofertas no enseñaba una oferta a quien no podía optar y el detalle quitaba
-- el botón de aplicar. Pero la candidatura se INSERTA directamente desde el
-- cliente (política oa_insert_technician), así que cualquiera que saltara la
-- UI podía aplicar igualmente. Esta migración pone el enforcer en la base.
--
-- ── TRIGGER, NO RLS ─────────────────────────────────────────────────────
--   - Hay DOS caminos para quedar como candidatura activa: el INSERT y el
--     UPDATE withdrawn -> pending (re-aplicar, migración 033). Un trigger mira
--     exactamente esa transición sin tocar retirar, aceptar ni rechazar.
--   - Un fallo de RLS sólo dice "violates row-level security policy". El
--     trigger devuelve el MOTIVO en DETAIL (no_engine_experience /
--     licensed_technician), los mismos códigos que IneligibilityReason en TS,
--     y el cliente lo traduce con ineligibilityReasonText: el texto vive en un
--     solo sitio. ERRCODE PT403: PostgREST responde 403.
--   - Aplica a cualquiera que escriba la fila, admin incluido, igual que las
--     otras guardas de esta tabla (force_offer_relation_defaults,
--     handle_offer_relation_status_transition), que también son triggers.
--
-- ── LA REGLA ESTÁ EN DOS SITIOS, Y ESO ES FORZOSO ───────────────────────
-- Postgres no puede ejecutar TypeScript (plv8 no está disponible en el
-- proyecto), así que el enforcer es SQL. Para que no diverja de la función TS
-- el SQL está partido en un NÚCLEO que recibe HECHOS —no filas—
-- (offer_eligibility_reason) y `npm run validate:application-eligibility`
-- ejecuta ese núcleo y isTechnicianEligibleForOffer sobre la misma matriz de
-- casos con el catálogo vivo, y falla si dan motivos distintos. Es el patrón
-- de validate:state-machine con assert_offer_relation_transition.
--
-- Reglas replicadas (ver isTechnicianEligibleForOffer y matchEngineEvidence):
--   oferta de motor: entra con (a) algún motor declarado, (b) una habilitación
--   colgada de una B1 (license_categories.category_group = 'B1') cuyo rating
--   ACTIVO tiene el motor pedido o uno de su familia, o (c) el oficio
--   engine_technician. "Activo" porque el índice de ratings del cliente sólo
--   carga los activos: una habilitación sobre un rating desactivado no aporta
--   motor en TS y tampoco aquí.
--   "sólo sin licencia": fuera quien tenga alguna licencia declarada.
--
-- ── PERMISOS ────────────────────────────────────────────────────────────
--   offer_eligibility_reason: SECURITY INVOKER; sólo lee catálogos públicos
--     (license_categories, aircraft_type_ratings, engines). Ejecutable por
--     anon y authenticated: el validador lo llama con la clave publicable.
--   offer_application_ineligibility_reason: SECURITY DEFINER, lee las tablas
--     del técnico. SIN EXECUTE para PUBLIC, anon ni authenticated: si no, sería
--     una RPC para averiguar si otro técnico tiene licencias o motores.
-- ============================================================


-- ── 1. El núcleo: hechos -> motivo ──────────────────────────

CREATE OR REPLACE FUNCTION public.offer_eligibility_reason(
  p_offer_kind TEXT,
  p_required_engine_id UUID,
  p_only_unlicensed BOOLEAN,
  p_license_count INTEGER,
  p_engine_count INTEGER,
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
       COALESCE(p_engine_count, 0) > 0                                   -- (a)
    OR 'engine_technician' = ANY (COALESCE(p_type_codes, '{}'::TEXT[]))  -- (c)
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

COMMENT ON FUNCTION public.offer_eligibility_reason(TEXT, UUID, BOOLEAN, INTEGER, INTEGER, TEXT[], TEXT[], UUID[]) IS
  'Fase 10 (080): espejo SQL de isTechnicianEligibleForOffer. NULL = elegible. Comprobado contra TS por validate:application-eligibility.';

GRANT EXECUTE ON FUNCTION public.offer_eligibility_reason(TEXT, UUID, BOOLEAN, INTEGER, INTEGER, TEXT[], TEXT[], UUID[]) TO anon, authenticated;


-- ── 2. Los hechos de un par (oferta, técnico) ───────────────

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
    (SELECT count(*)::INTEGER FROM public.technician_engine_experience WHERE technician_id = p_technician_id),
    COALESCE((SELECT array_agg(type_code) FROM public.technician_profile_types WHERE technician_id = p_technician_id), '{}'::TEXT[]),
    COALESCE(v_codes, '{}'::TEXT[]),
    COALESCE(v_ratings, '{}'::UUID[])
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.offer_application_ineligibility_reason(UUID, UUID) FROM PUBLIC, anon, authenticated;


-- ── 3. El trigger ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_offer_application_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_reason TEXT;
BEGIN
  -- En UPDATE sólo importa (re)entrar en pending: re-aplicar tras retirarse.
  -- Retirar, aceptar o rechazar no pasan por aquí.
  IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending') THEN
    RETURN NEW;
  END IF;

  v_reason := public.offer_application_ineligibility_reason(NEW.offer_id, NEW.technician_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PT403',
      MESSAGE = 'The technician is not eligible for this offer.',
      DETAIL  = v_reason;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_offer_application_eligibility ON public.offer_applications;
CREATE TRIGGER enforce_offer_application_eligibility
  BEFORE INSERT OR UPDATE OF status ON public.offer_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_offer_application_eligibility();


-- ── Post-condiciones y autocomprobación ─────────────────────
--
-- Todo dentro de un bloque que se deshace al final (P0080): una oferta de
-- motor de prueba, un motor declarado de prueba y las candidaturas. Usa
-- técnicos existentes que cumplan las precondiciones; si no los hay (base
-- vacía), se omite con aviso.

DO $$
DECLARE
  v_src       public.offers%ROWTYPE;
  v_engine    UUID;
  v_free      UUID;  -- sin licencias, sin motores, sin engine_technician, sin habilitaciones
  v_licensed  UUID;  -- con alguna licencia, sin motores, sin engine_technician
  v_offer     UUID;
  v_app       UUID;
  v_detail    TEXT;
  v_results   TEXT := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.offer_applications'::regclass
                   AND tgname = 'enforce_offer_application_eligibility' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '080: falta el trigger enforce_offer_application_eligibility.';
  END IF;
  IF has_function_privilege('authenticated', 'public.offer_application_ineligibility_reason(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.offer_application_ineligibility_reason(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '080: offer_application_ineligibility_reason no debe ser ejecutable por clientes.';
  END IF;

  SELECT * INTO v_src FROM public.offers LIMIT 1;
  SELECT id INTO v_engine FROM public.engines WHERE is_active ORDER BY id LIMIT 1;
  SELECT tp.id INTO v_free FROM public.technician_profiles tp
   WHERE NOT EXISTS (SELECT 1 FROM public.technician_licenses l WHERE l.technician_id = tp.id)
     AND NOT EXISTS (SELECT 1 FROM public.technician_engine_experience e WHERE e.technician_id = tp.id)
     AND NOT EXISTS (SELECT 1 FROM public.technician_habilitations h WHERE h.technician_id = tp.id)
     AND NOT EXISTS (SELECT 1 FROM public.technician_profile_types t WHERE t.technician_id = tp.id AND t.type_code = 'engine_technician')
   ORDER BY tp.id LIMIT 1;
  SELECT tp.id INTO v_licensed FROM public.technician_profiles tp
   WHERE EXISTS (SELECT 1 FROM public.technician_licenses l WHERE l.technician_id = tp.id)
     AND NOT EXISTS (SELECT 1 FROM public.technician_engine_experience e WHERE e.technician_id = tp.id)
     AND NOT EXISTS (SELECT 1 FROM public.technician_profile_types t WHERE t.technician_id = tp.id AND t.type_code = 'engine_technician')
   ORDER BY tp.id LIMIT 1;

  IF v_src.id IS NULL OR v_engine IS NULL OR v_free IS NULL OR v_licensed IS NULL THEN
    RAISE NOTICE '080: faltan datos de los que partir (oferta, motor o técnicos); autocomprobación omitida.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
      requires_certification, location_country, location_country_code, min_years_experience, status, visible,
      offer_kind, required_engine_id)
    VALUES (v_src.company_id, 'selftest-080', 'selftest', v_src.contract_type, v_src.product_type, 'engine_technician',
      false, v_src.location_country, v_src.location_country_code, 0, 'published', true, 'engine', v_engine)
    RETURNING id INTO v_offer;

    -- 1. No elegible (sin nada de motor): rechazada con su motivo.
    v_detail := NULL;
    BEGIN
      INSERT INTO public.offer_applications (technician_id, offer_id, company_id)
      VALUES (v_free, v_offer, v_src.company_id);
    EXCEPTION WHEN SQLSTATE 'PT403' THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    END;
    v_results := v_results || '1:' || COALESCE(v_detail, 'ACEPTADA') || ' ';

    -- 2. El mismo técnico con un motor declarado: elegible, entra.
    INSERT INTO public.technician_engine_experience (technician_id, engine_id) VALUES (v_free, v_engine);
    INSERT INTO public.offer_applications (technician_id, offer_id, company_id)
    VALUES (v_free, v_offer, v_src.company_id)
    RETURNING id INTO v_app;
    v_results := v_results || '2:aceptada ';

    -- 3. Se retira, pierde el motor y vuelve a aplicar: la reactivación se rechaza.
    UPDATE public.offer_applications SET status = 'withdrawn' WHERE id = v_app;
    DELETE FROM public.technician_engine_experience WHERE technician_id = v_free AND engine_id = v_engine;
    v_detail := NULL;
    BEGIN
      UPDATE public.offer_applications SET status = 'pending' WHERE id = v_app;
    EXCEPTION WHEN SQLSTATE 'PT403' THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    END;
    v_results := v_results || '3:' || COALESCE(v_detail, 'REACTIVADA') || ' ';

    -- 4. "Sólo sin licencia": un técnico con licencia y con el motor, fuera.
    UPDATE public.offers SET only_unlicensed = true WHERE id = v_offer;
    INSERT INTO public.technician_engine_experience (technician_id, engine_id) VALUES (v_licensed, v_engine);
    v_detail := NULL;
    BEGIN
      INSERT INTO public.offer_applications (technician_id, offer_id, company_id)
      VALUES (v_licensed, v_offer, v_src.company_id);
    EXCEPTION WHEN SQLSTATE 'PT403' THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    END;
    v_results := v_results || '4:' || COALESCE(v_detail, 'ACEPTADA') || ' ';

    RAISE EXCEPTION USING ERRCODE = 'P0080', MESSAGE = 'deshacer autocomprobación';
  EXCEPTION WHEN SQLSTATE 'P0080' THEN
    NULL;
  END;

  IF v_results IS DISTINCT FROM '1:no_engine_experience 2:aceptada 3:no_engine_experience 4:licensed_technician ' THEN
    RAISE EXCEPTION '080: la autocomprobación no dio lo esperado: %', v_results;
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-080') THEN
    RAISE EXCEPTION '080: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '080: %', v_results;
END $$;

NOTIFY pgrst, 'reload schema';