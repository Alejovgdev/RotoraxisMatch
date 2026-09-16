-- ============================================================
-- AviationJobTalent V2 — Migration 077: los dos CHECK inversos de la oferta
-- ============================================================
-- Created: 2026-09-16 (Fase 10, paso 5b)
--
-- La 076 ató la oferta de motor en una dirección (motor ⇒ sin licencia, sin
-- aeronaves, con motor) y dejó fuera, a propósito, las dos que eran decisión
-- de producto. Ya están tomadas:
--
--   chk_offers_aircraft_without_engine
--     Oferta de aeronave ⇒ required_engine_id vacío. Un motor sólo lo nombra
--     una oferta de motor; en una de aeronave no puntúa nada y lo único que
--     haría es mentir en la ficha.
--
--     `offer_kind` sigue siendo nullable (070) y el mapper lee NULL como
--     'aircraft', así que el CHECK lo lee igual: "es motor" se escribe
--     `offer_kind IS NOT DISTINCT FROM 'engine'`. Con `offer_kind = 'engine'`
--     a secas, una fila con offer_kind NULL y motor daría NULL y pasaría (un
--     CHECK sólo rechaza FALSE).
--
--   chk_offers_only_unlicensed_without_license
--     only_unlicensed = true ⇒ la oferta no exige licencia. Vale para las dos
--     clases: "ayudante para el A320, sólo sin licencia" es una oferta de
--     aeronave válida. Pedir una licencia y a la vez excluir a quien la tiene
--     es una oferta que nadie puede cumplir.
--     `requires_certification = false` basta: la 053 ata license_code a él, y
--     la 075 license_authority a license_code. Se escriben los dos para que la
--     regla se lea sin reconstruirla desde otras migraciones.
--
-- Datos: las 8 ofertas vivas son de aeronave, sin motor y sin el filtro
-- (verificado el 2026-09-16). La comprobación previa lo repite y para con un
-- mensaje que diga cuántas filas si alguna no cumple.
--
-- La autocomprobación del final intenta escribir las dos filas prohibidas y
-- exige que Postgres las rechace con ESTOS constraints, y una permitida de
-- control; nada queda escrito (cada intento va en su subtransacción y la de
-- control se deshace a mano). Necesita una oferta existente de la que copiar
-- company_id y localización: en una base vacía (branching) se salta con aviso.
-- ============================================================


DO $$
DECLARE v_engine INT; v_unlicensed INT;
BEGIN
  SELECT count(*) INTO v_engine FROM public.offers
   WHERE offer_kind IS DISTINCT FROM 'engine' AND required_engine_id IS NOT NULL;
  IF v_engine <> 0 THEN
    RAISE EXCEPTION '% ofertas que no son de motor nombran un motor: corrígelas antes de aplicar la 077.', v_engine;
  END IF;

  SELECT count(*) INTO v_unlicensed FROM public.offers
   WHERE only_unlicensed AND (requires_certification OR license_code IS NOT NULL);
  IF v_unlicensed <> 0 THEN
    RAISE EXCEPTION '% ofertas "sólo sin licencia" exigen licencia: corrígelas antes de aplicar la 077.', v_unlicensed;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.offers'::regclass
                   AND conname = 'chk_offers_aircraft_without_engine') THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT chk_offers_aircraft_without_engine
      CHECK (offer_kind IS NOT DISTINCT FROM 'engine' OR required_engine_id IS NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.offers'::regclass
                   AND conname = 'chk_offers_only_unlicensed_without_license') THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT chk_offers_only_unlicensed_without_license
      CHECK (only_unlicensed IS NOT TRUE OR (requires_certification = false AND license_code IS NULL));
  END IF;
END $$;

COMMENT ON CONSTRAINT chk_offers_aircraft_without_engine ON public.offers IS
  'Fase 10 (077): sólo una oferta de motor nombra un motor. offer_kind NULL cuenta como aeronave.';
COMMENT ON CONSTRAINT chk_offers_only_unlicensed_without_license ON public.offers IS
  'Fase 10 (077): "sólo técnicos sin licencia" no puede exigir licencia, en ofertas de aeronave y de motor.';


-- ── Post-condiciones y autocomprobación ─────────────────────

DO $$
DECLARE
  v_src        public.offers%ROWTYPE;
  v_engine     UUID;
  v_constraint TEXT;
  v_ok         BOOLEAN;
BEGIN
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.offers'::regclass AND convalidated
        AND conname IN ('chk_offers_aircraft_without_engine', 'chk_offers_only_unlicensed_without_license')) <> 2 THEN
    RAISE EXCEPTION 'Faltan los CHECK de la 077 o no están validados.';
  END IF;

  SELECT * INTO v_src FROM public.offers LIMIT 1;
  SELECT id INTO v_engine FROM public.engines WHERE is_active LIMIT 1;
  IF v_src.id IS NULL OR v_engine IS NULL THEN
    RAISE NOTICE '077: sin ofertas o sin motores de los que copiar; autocomprobación omitida.';
    RETURN;
  END IF;

  -- 1. Aeronave con motor: prohibido. Dos veces: con 'aircraft' y con
  -- offer_kind NULL, que es el hueco que el IS NOT DISTINCT FROM cierra.
  v_constraint := NULL;
  BEGIN
    INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
      requires_certification, location_country, location_country_code, min_years_experience, status, visible,
      offer_kind, required_engine_id)
    VALUES (v_src.company_id, 'selftest-077', 'selftest', v_src.contract_type, v_src.product_type, 'sheet_metal_worker',
      false, v_src.location_country, v_src.location_country_code, 0, 'draft', false, 'aircraft', v_engine);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF v_constraint IS DISTINCT FROM 'chk_offers_aircraft_without_engine' THEN
    RAISE EXCEPTION '077: una oferta de aeronave con motor no la rechazó chk_offers_aircraft_without_engine (constraint: %).', v_constraint;
  END IF;

  v_constraint := NULL;
  BEGIN
    INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
      requires_certification, location_country, location_country_code, min_years_experience, status, visible,
      offer_kind, required_engine_id)
    VALUES (v_src.company_id, 'selftest-077', 'selftest', v_src.contract_type, v_src.product_type, 'sheet_metal_worker',
      false, v_src.location_country, v_src.location_country_code, 0, 'draft', false, NULL, v_engine);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF v_constraint IS DISTINCT FROM 'chk_offers_aircraft_without_engine' THEN
    RAISE EXCEPTION '077: una oferta con offer_kind NULL y motor no la rechazó chk_offers_aircraft_without_engine (constraint: %).', v_constraint;
  END IF;

  -- 2. "Sólo sin licencia" exigiendo licencia: prohibido.
  v_constraint := NULL;
  BEGIN
    INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
      requires_certification, license_code, license_authority, location_country, location_country_code,
      min_years_experience, status, visible, offer_kind, only_unlicensed)
    VALUES (v_src.company_id, 'selftest-077', 'selftest', v_src.contract_type, v_src.product_type, 'mechanic',
      true, 'B1.1', 'EASA', v_src.location_country, v_src.location_country_code, 0, 'draft', false, 'aircraft', true);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF v_constraint IS DISTINCT FROM 'chk_offers_only_unlicensed_without_license' THEN
    RAISE EXCEPTION '077: "sólo sin licencia" con licencia no la rechazó chk_offers_only_unlicensed_without_license (constraint: %).', v_constraint;
  END IF;

  -- 3. Control: aeronave SIN licencia y "sólo sin licencia" es válida. Se
  -- inserta y se deshace lanzando una excepción propia dentro del bloque.
  v_ok := false;
  BEGIN
    INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
      requires_certification, location_country, location_country_code, min_years_experience, status, visible,
      offer_kind, only_unlicensed)
    VALUES (v_src.company_id, 'selftest-077', 'selftest', v_src.contract_type, v_src.product_type, 'sheet_metal_worker',
      false, v_src.location_country, v_src.location_country_code, 0, 'draft', false, 'aircraft', true);
    v_ok := true;
    RAISE EXCEPTION USING ERRCODE = 'P0077', MESSAGE = 'deshacer control';
  EXCEPTION WHEN SQLSTATE 'P0077' THEN
    NULL;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '077: la fila de control (aeronave sin licencia, sólo sin licencia) no se pudo escribir.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-077') THEN
    RAISE EXCEPTION '077: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '077: los dos CHECK existen y rechazan lo prohibido; la fila de control es válida y no quedó escrita.';
END $$;

NOTIFY pgrst, 'reload schema';