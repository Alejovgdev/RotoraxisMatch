-- ============================================================
-- AviationJobTalent V2 — Migration 087: licencia opcional en ofertas de motor
-- ============================================================
-- Created: 2026-09-18 (Fase 10, sesión 2, punto 2)
--
-- La 076 ató la oferta de motor a "sin licencia, sin certificación, con motor"
-- (chk_offers_engine_kind_shape). Desde la sesión 2 una oferta de motor PUEDE
-- pedir una licencia, pero sólo una que certifique el motor:
--
--   Part-66 B1.1–B1.4  la rama mecánica, que certifica célula y motor;
--   FAA P o A&P        Powerplant.
--
-- No B2, C ni FAA A: ninguna dice nada del motor. El motor sigue siendo
-- obligatorio y las aeronaves siguen prohibidas (los dos triggers de la 076 no
-- se tocan). La 077 tampoco: "sólo sin licencia" sigue sin poder combinarse con
-- una licencia exigida.
--
-- El CHECK nuevo sólo nombra CÓDIGOS. Qué autoridad emite cada uno lo decide la
-- FK compuesta fk_offers_authority_license (075): B1.x sólo existe en las
-- cuatro Part-66 y P / A&P sólo en la FAA, así que no hace falta repetirlo. Y
-- `requires_certification` lo ata a license_code la 053: una oferta de motor
-- con licencia certifica, una sin licencia no.
--
-- Mismo nombre de constraint: sigue siendo "la forma de la oferta de motor", y
-- el espejo en TypeScript (src/utils/offerShape.ts, ENGINE_OFFER_LICENSE_CODES)
-- lo cita por ese nombre.
--
-- Es MÁS PERMISIVO que el de la 076: toda fila que cumplía aquél cumple éste.
-- Datos: 0 ofertas de motor (verificado el 2026-09-18). La comprobación previa
-- lo repite igualmente.
-- ============================================================

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad FROM public.offers
   WHERE offer_kind = 'engine'
     AND NOT (required_engine_id IS NOT NULL
              AND (license_code IS NULL OR license_code IN ('B1.1', 'B1.2', 'B1.3', 'B1.4', 'P', 'A&P')));
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% ofertas de motor sin motor o con una licencia que no certifica motor: corrígelas antes de aplicar la 087.', v_bad;
  END IF;
END $$;

ALTER TABLE public.offers DROP CONSTRAINT chk_offers_engine_kind_shape;

ALTER TABLE public.offers
  ADD CONSTRAINT chk_offers_engine_kind_shape
  CHECK (
    offer_kind IS DISTINCT FROM 'engine'
    OR (required_engine_id IS NOT NULL
        AND (license_code IS NULL OR license_code IN ('B1.1', 'B1.2', 'B1.3', 'B1.4', 'P', 'A&P')))
  );

COMMENT ON CONSTRAINT chk_offers_engine_kind_shape ON public.offers IS
  'Fase 10 (076, 087): una oferta de motor nombra un motor; la licencia es opcional y sólo B1.1–B1.4 o FAA P / A&P. '
  'Las aeronaves, que viven en otra tabla, las vigilan dos triggers (076).';


-- ── Post-condiciones y autocomprobación ─────────────────────
--
-- Intenta escribir las filas prohibidas y exige que las rechace ESTE
-- constraint; escribe las permitidas de control y las deshace. Nada queda
-- escrito. Necesita una oferta existente de la que copiar company_id y
-- localización, y un motor activo: en una base vacía se omite con aviso.

DO $$
DECLARE
  v_src        public.offers%ROWTYPE;
  v_engine     UUID;
  v_constraint TEXT;
  v_case       RECORD;
  v_ok         BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.offers'::regclass
                   AND conname = 'chk_offers_engine_kind_shape' AND convalidated) THEN
    RAISE EXCEPTION '087: chk_offers_engine_kind_shape no existe o no está validada.';
  END IF;

  SELECT * INTO v_src FROM public.offers LIMIT 1;
  SELECT id INTO v_engine FROM public.engines WHERE is_active ORDER BY id LIMIT 1;
  IF v_src.id IS NULL OR v_engine IS NULL THEN
    RAISE NOTICE '087: sin ofertas o sin motores de los que copiar; autocomprobación omitida.';
    RETURN;
  END IF;

  -- 1. Prohibidas: licencias que no certifican motor, y motor sin motor.
  FOR v_case IN SELECT * FROM (VALUES
      ('EASA', 'B2', true), ('EASA', 'C', true), ('FAA', 'A', true), (NULL, NULL, false)
    ) AS t(authority, code, with_engine)
  LOOP
    v_constraint := NULL;
    BEGIN
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, license_code, license_authority, location_country, location_country_code,
        min_years_experience, status, visible, offer_kind, required_engine_id)
      VALUES (v_src.company_id, 'selftest-087', 'selftest', v_src.contract_type, 'Aeroplane', 'engine_technician',
        v_case.code IS NOT NULL, v_case.code, v_case.authority, v_src.location_country, v_src.location_country_code,
        0, 'draft', false, 'engine', CASE WHEN v_case.with_engine THEN v_engine END);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    END;
    IF v_constraint IS DISTINCT FROM 'chk_offers_engine_kind_shape' THEN
      RAISE EXCEPTION '087: motor con % % (motor: %) no lo rechazó chk_offers_engine_kind_shape (constraint: %).',
        v_case.authority, v_case.code, v_case.with_engine, v_constraint;
    END IF;
  END LOOP;

  -- 2. Permitidas: sin licencia, EASA B1.1, UK CAA B1.3, FAA P y FAA A&P. Se
  -- escriben y se deshacen lanzando una excepción propia dentro del bloque.
  FOR v_case IN SELECT * FROM (VALUES
      (NULL, NULL), ('EASA', 'B1.1'), ('UK_CAA', 'B1.3'), ('FAA', 'P'), ('FAA', 'A&P')
    ) AS t(authority, code)
  LOOP
    v_ok := false;
    BEGIN
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, license_code, license_authority, location_country, location_country_code,
        min_years_experience, status, visible, offer_kind, required_engine_id)
      VALUES (v_src.company_id, 'selftest-087', 'selftest', v_src.contract_type, 'Aeroplane', 'engine_technician',
        v_case.code IS NOT NULL, v_case.code, v_case.authority, v_src.location_country, v_src.location_country_code,
        0, 'draft', false, 'engine', v_engine);
      v_ok := true;
      RAISE EXCEPTION USING ERRCODE = 'P0087', MESSAGE = 'deshacer control';
    EXCEPTION WHEN SQLSTATE 'P0087' THEN
      NULL;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '087: la oferta de motor de control con % % no se pudo escribir.', v_case.authority, v_case.code;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-087') THEN
    RAISE EXCEPTION '087: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '087: motor con B2, C o FAA A, y motor sin motor, rechazados; sin licencia, B1.x, P y A&P aceptados y deshechos.';
END $$;

NOTIFY pgrst, 'reload schema';
