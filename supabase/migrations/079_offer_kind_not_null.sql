-- ============================================================
-- AviationJobTalent V2 — Migration 079: offers.offer_kind NOT NULL
-- ============================================================
-- Created: 2026-09-16 (Fase 10, paso 5c)
--
-- La 070 creó offer_kind en fase EXPAND: con DEFAULT 'aircraft' pero nullable.
-- El código la escribe siempre (offerRepository.create manda 'aircraft' si no
-- se dice otra cosa) y el scorer ramifica sobre ella, así que un NULL no tiene
-- significado propio: el mapper lo leía como 'aircraft' y la 077 tuvo que
-- escribir su CHECK con IS NOT DISTINCT FROM para que un NULL no se colara.
-- Aquí se cierra.
--
-- Datos: 0 ofertas con offer_kind NULL (verificado el 2026-09-16, las 8 vivas
-- son 'aircraft'). Aun así se rellenan por regla y no a mano: una oferta sin
-- clase y SIN required_engine_id es de aeronave. Una sin clase y CON motor no
-- se puede deducir con seguridad —podría ser una oferta de motor a medio
-- escribir— y la migración PARA en vez de adivinar.
--
-- La autocomprobación intenta insertar una oferta con offer_kind NULL y exige
-- que Postgres la rechace por NOT NULL; y una sin nombrar la columna, que debe
-- entrar como 'aircraft' por el DEFAULT. Nada queda escrito.
-- ============================================================


DO $$
DECLARE v_ambiguous INT; v_filled INT;
BEGIN
  SELECT count(*) INTO v_ambiguous FROM public.offers
   WHERE offer_kind IS NULL AND required_engine_id IS NOT NULL;
  IF v_ambiguous <> 0 THEN
    RAISE EXCEPTION '079: % ofertas con offer_kind NULL nombran un motor; su clase no se puede deducir. Revísalas antes de aplicar.', v_ambiguous;
  END IF;

  UPDATE public.offers
     SET offer_kind = 'aircraft'
   WHERE offer_kind IS NULL
     AND required_engine_id IS NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;
  RAISE NOTICE '079: % ofertas rellenadas como aircraft.', v_filled;
END $$;

ALTER TABLE public.offers ALTER COLUMN offer_kind SET DEFAULT 'aircraft';
ALTER TABLE public.offers ALTER COLUMN offer_kind SET NOT NULL;


-- ── Post-condiciones y autocomprobación ─────────────────────

DO $$
DECLARE
  v_src    public.offers%ROWTYPE;
  v_state  TEXT;
  v_column TEXT;
  v_kind   TEXT;
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'offer_kind') <> 'NO' THEN
    RAISE EXCEPTION '079: offers.offer_kind sigue siendo nullable.';
  END IF;

  SELECT * INTO v_src FROM public.offers LIMIT 1;
  IF v_src.id IS NULL THEN
    RAISE NOTICE '079: sin ofertas de las que copiar; autocomprobación omitida.';
    RETURN;
  END IF;

  -- 1. offer_kind NULL explícito: rechazada por NOT NULL.
  v_state := NULL;
  BEGIN
    INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
      requires_certification, location_country, location_country_code, min_years_experience, status, visible, offer_kind)
    VALUES (v_src.company_id, 'selftest-079', 'selftest', v_src.contract_type, v_src.product_type, 'sheet_metal_worker',
      false, v_src.location_country, v_src.location_country_code, 0, 'draft', false, NULL);
  EXCEPTION WHEN not_null_violation THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_column = COLUMN_NAME;
  END;
  IF v_state IS DISTINCT FROM '23502' OR v_column IS DISTINCT FROM 'offer_kind' THEN
    RAISE EXCEPTION '079: una oferta con offer_kind NULL no la rechazó el NOT NULL de offer_kind (sqlstate %, columna %).', v_state, v_column;
  END IF;

  -- 2. Control: sin nombrar la columna entra como 'aircraft'. Se deshace.
  v_kind := NULL;
  BEGIN
    INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
      requires_certification, location_country, location_country_code, min_years_experience, status, visible)
    VALUES (v_src.company_id, 'selftest-079', 'selftest', v_src.contract_type, v_src.product_type, 'sheet_metal_worker',
      false, v_src.location_country, v_src.location_country_code, 0, 'draft', false)
    RETURNING offer_kind INTO v_kind;
    RAISE EXCEPTION USING ERRCODE = 'P0079', MESSAGE = 'deshacer control';
  EXCEPTION WHEN SQLSTATE 'P0079' THEN
    NULL;
  END;
  IF v_kind IS DISTINCT FROM 'aircraft' THEN
    RAISE EXCEPTION '079: una oferta sin offer_kind no entró como aircraft (entró como %).', v_kind;
  END IF;

  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-079') THEN
    RAISE EXCEPTION '079: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '079: offer_kind NOT NULL; un NULL se rechaza y la omisión entra como aircraft.';
END $$;

NOTIFY pgrst, 'reload schema';