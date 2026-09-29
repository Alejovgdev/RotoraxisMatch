-- ============================================================
-- AviationJobTalent V2 — Migration 095: la FAA como autoridad equivalente
-- en las ofertas Part-66
-- ============================================================
-- Created: 2026-09-29 (parte 3 de la firma FAA). Requiere la 094.
--
-- Una oferta Part-66 (EASA, UK CAA, CASA, GCAA) puede marcar la FAA en
-- "Also accept licences from:". La FAA no es uno a uno como las otras
-- autoridades: no emite una B1.1, así que la equivalencia es una TABLA de qué
-- certificado FAA cuenta por cada categoría Part-66:
--
--   A1–A4                   A o A&P
--   B1.x, B2, B2L, B3, L    A&P
--   C                       ninguno: una oferta C no puede aceptar la FAA
--
-- Lo que la tabla decide al puntuar (qué técnico cuenta, con el 20 % menos, y
-- que en una oferta con aeronaves la aeronave FIRMADA de la 094 haga de type
-- rating) vive en el scorer (TS, offerMatchExplain.ts): ninguna función SQL
-- puntúa. Lo que sí vive aquí es la FORMA de la oferta: qué listas admite la
-- base. Por eso la tabla está en las dos partes, y
-- `npm run validate:authority-licenses` compara la función de abajo con
-- FAA_EQUIVALENT_CODES (src/constants/licenses.ts) código a código.
--
-- ── LO QUE HACE ─────────────────────────────────────────────────────────
--   1. public.faa_equivalent_license_codes(code): la tabla. Pura, sin leer
--      datos; ejecutable por clientes (la usa el trigger, que corre como
--      quien escribe la oferta, y el validador, con la clave publicable).
--   2. chk_offers_accepted_authorities (088) se sustituye: la lista admite
--      'FAA'. Lo demás no cambia: sólo con licencia, sólo si la exigida es
--      Part-66 (una oferta FAA sigue sin aceptadas) y nunca la propia.
--   3. enforce_offer_accepted_authorities (088) añade la regla de la tabla:
--      la FAA sólo si el código tiene equivalente. Con una C se rechaza
--      (23514), igual que CASA con una B3: rechaza, no corrige. El
--      formulario y el repositorio ya la quitan al cambiar a C.
--
-- Nada que migrar: el 2026-09-29 ninguna oferta acepta la FAA (el CHECK de la
-- 088 lo prohibía). Aplicación única, como 064–094.
-- ============================================================


-- ── 1. La tabla de equivalencias ────────────────────────────

CREATE OR REPLACE FUNCTION public.faa_equivalent_license_codes(p_license_code TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO public AS $$
  SELECT CASE
    WHEN p_license_code IN ('A1', 'A2', 'A3', 'A4') THEN ARRAY['A', 'A&P']
    WHEN p_license_code IN ('B1.1', 'B1.2', 'B1.3', 'B1.4', 'B2', 'B2L', 'B3', 'L') THEN ARRAY['A&P']
    ELSE ARRAY[]::TEXT[]
  END
$$;
GRANT EXECUTE ON FUNCTION public.faa_equivalent_license_codes(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.faa_equivalent_license_codes(TEXT) IS
  '095: qué certificados FAA cuentan por esta categoría Part-66 cuando una oferta Part-66 acepta la FAA. '
  'Vacía para C y para cualquier código que no sea Part-66. Espejo: FAA_EQUIVALENT_CODES (TS).';


-- ── 2. El CHECK admite la FAA ───────────────────────────────

ALTER TABLE public.offers DROP CONSTRAINT chk_offers_accepted_authorities;
ALTER TABLE public.offers
  ADD CONSTRAINT chk_offers_accepted_authorities
  CHECK (
    accepted_authorities <@ ARRAY['EASA', 'UK_CAA', 'CASA', 'GCAA', 'FAA']::TEXT[]
    AND (
      cardinality(accepted_authorities) = 0
      OR (license_code IS NOT NULL
          AND license_authority IN ('EASA', 'UK_CAA', 'CASA', 'GCAA')
          AND NOT (license_authority = ANY (accepted_authorities)))
    )
  );

COMMENT ON CONSTRAINT chk_offers_accepted_authorities ON public.offers IS
  'Fase 10 (088, 095): autoridades Part-66 o la FAA, nunca la exigida, y lista vacía sin licencia o con licencia FAA. '
  'Que cada Part-66 emita el código, y que el código tenga equivalente FAA, lo vigila el trigger enforce_offer_accepted_authorities.';


-- ── 3. El trigger aplica la tabla ───────────────────────────
-- Idéntico a la 088 salvo el bloque marcado con 095.

CREATE OR REPLACE FUNCTION public.enforce_offer_accepted_authorities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_missing TEXT;
BEGIN
  -- Los triggers BEFORE corren ANTES que los CHECK. Lo que es forma de la fila
  -- (sin licencia, licencia FAA, una autoridad que no es Part-66) se deja al
  -- CHECK, que lo dice con su nombre; aquí sólo lo que necesita el catálogo.
  IF cardinality(NEW.accepted_authorities) = 0
     OR NEW.license_code IS NULL
     OR NEW.license_authority NOT IN ('EASA', 'UK_CAA', 'CASA', 'GCAA') THEN
    RETURN NEW;
  END IF;

  IF cardinality(NEW.accepted_authorities) <> (SELECT count(DISTINCT a) FROM unnest(NEW.accepted_authorities) AS a) THEN
    RAISE EXCEPTION 'Offer % lists an accepted authority twice.', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(a, ', ') INTO v_missing
    FROM unnest(NEW.accepted_authorities) AS a
   WHERE a IN ('EASA', 'UK_CAA', 'CASA', 'GCAA')
     AND NOT EXISTS (SELECT 1 FROM public.authority_licenses al
                      WHERE al.authority = a AND al.license_code = NEW.license_code);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '% does not issue a % licence, so offer % cannot accept it as equivalent.', v_missing, NEW.license_code, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 095: la FAA no emite el código; cuenta por su tabla. Sin equivalente (C), no.
  IF 'FAA' = ANY (NEW.accepted_authorities)
     AND cardinality(public.faa_equivalent_license_codes(NEW.license_code)) = 0 THEN
    RAISE EXCEPTION 'The FAA has no equivalent for a % licence, so offer % cannot accept it.', NEW.license_code, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;


-- ── Post-condiciones y autocomprobación ─────────────────────
--
-- Mismo patrón que la 088: cada caso intenta escribir una oferta y se
-- registra quién la rechaza (el CHECK por su nombre, el trigger por su
-- mensaje) u 'OK'. Todo se deshace (P0095).

DO $$
DECLARE
  v_src      public.offers%ROWTYPE;
  v_engine   UUID;
  v_offer    UUID;
  v_case     RECORD;
  v_constraint TEXT;
  v_message  TEXT;
  v_got      TEXT;
  v_results  TEXT := '';
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.faa_equivalent_license_codes(text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.faa_equivalent_license_codes(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '095: faa_equivalent_license_codes debe ser ejecutable por clientes.';
  END IF;
  IF public.faa_equivalent_license_codes('A1') IS DISTINCT FROM ARRAY['A', 'A&P']
     OR public.faa_equivalent_license_codes('B2L') IS DISTINCT FROM ARRAY['A&P']
     OR public.faa_equivalent_license_codes('C') IS DISTINCT FROM ARRAY[]::TEXT[]
     OR public.faa_equivalent_license_codes('A&P') IS DISTINCT FROM ARRAY[]::TEXT[] THEN
    RAISE EXCEPTION '095: la tabla de equivalencias FAA no dice lo esperado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE 'FAA' = ANY (accepted_authorities)) THEN
    RAISE EXCEPTION '095: ya hay ofertas que aceptan la FAA; esta migración se escribió sin ninguna.';
  END IF;

  SELECT * INTO v_src FROM public.offers ORDER BY created_at LIMIT 1;
  SELECT id INTO v_engine FROM public.engines WHERE is_active AND NOT is_generic ORDER BY id LIMIT 1;
  IF v_src.id IS NULL OR v_engine IS NULL THEN
    RAISE EXCEPTION '095: faltan fixtures (una oferta de la que copiar y un motor activo).';
  END IF;

  BEGIN
    FOR v_case IN SELECT * FROM (VALUES
        -- n, autoridad, código, aceptadas, oficio
        (1,  'EASA',   'B1.1', ARRAY['FAA'],              'mechanic'),
        (2,  'EASA',   'A1',   ARRAY['UK_CAA', 'FAA'],    'mechanic'),
        (3,  'EASA',   'B2',   ARRAY['FAA'],              'avionic'),
        (4,  'UK_CAA', 'B2L',  ARRAY['EASA', 'FAA'],      'avionic'),
        (5,  'GCAA',   'B3',   ARRAY['FAA'],              'mechanic'),
        (6,  'EASA',   'B1.1', ARRAY['FAA'],              'engine_technician'),
        (7,  'EASA',   'C',    ARRAY['FAA'],              'mechanic'),
        (8,  'EASA',   'C',    ARRAY['UK_CAA'],           'mechanic'),
        (9,  'FAA',    'A&P',  ARRAY['FAA'],              'mechanic'),
        (10, 'FAA',    'A&P',  ARRAY['EASA'],             'mechanic'),
        (11, NULL,     NULL,   ARRAY['FAA'],              'mechanic'),
        (12, 'EASA',   'B1.1', ARRAY['FAA', 'FAA'],       'mechanic'),
        (13, 'EASA',   'B1.1', ARRAY['EASA'],             'mechanic')
      ) AS t(n, authority, code, accepted, technician_type)
    LOOP
      v_constraint := NULL; v_message := NULL;
      BEGIN
        INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
          requires_certification, license_code, license_authority, accepted_authorities, location_country,
          location_country_code, min_years_experience, status, visible, offer_kind, required_engine_id)
        VALUES (v_src.company_id, 'selftest-095', 'selftest', v_src.contract_type, 'Aeroplane', v_case.technician_type,
          v_case.code IS NOT NULL, v_case.code, v_case.authority, v_case.accepted, v_src.location_country,
          v_src.location_country_code, 0, 'draft', false,
          CASE WHEN v_case.technician_type = 'engine_technician' THEN 'engine' ELSE 'aircraft' END,
          CASE WHEN v_case.technician_type = 'engine_technician' THEN v_engine END);
        v_got := 'OK';
      EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME, v_message = MESSAGE_TEXT;
        v_got := CASE
          WHEN COALESCE(v_constraint, '') <> '' THEN v_constraint
          WHEN v_message LIKE '%has no equivalent%' THEN 'trigger-faa'
          WHEN v_message LIKE '%lists an accepted authority twice%' THEN 'trigger-dup'
          WHEN v_message LIKE '%does not issue%' THEN 'trigger-code'
          ELSE 'trigger?' END;
      END;
      v_results := v_results || v_case.n || ':' || v_got || ' ';
    END LOOP;

    -- 14. Cambiar a C una oferta que acepta la FAA: se rechaza, no se corrige.
    v_constraint := NULL; v_message := NULL;
    BEGIN
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, license_code, license_authority, accepted_authorities, location_country,
        location_country_code, min_years_experience, status, visible, offer_kind)
      VALUES (v_src.company_id, 'selftest-095', 'selftest', v_src.contract_type, 'Aeroplane', 'mechanic',
        true, 'B1.1', 'EASA', ARRAY['FAA'], v_src.location_country, v_src.location_country_code,
        0, 'draft', false, 'aircraft')
      RETURNING id INTO v_offer;
      UPDATE public.offers SET license_code = 'C' WHERE id = v_offer;
      v_got := 'OK';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_got := CASE WHEN v_message LIKE '%has no equivalent%' THEN 'trigger-faa' ELSE 'otro' END;
    END;
    v_results := v_results || '14:' || v_got;

    RAISE EXCEPTION USING ERRCODE = 'P0095', MESSAGE = 'deshacer autocomprobación';
  EXCEPTION WHEN SQLSTATE 'P0095' THEN
    NULL;
  END;

  IF v_results IS DISTINCT FROM
     '1:OK 2:OK 3:OK 4:OK 5:OK 6:OK 7:trigger-faa 8:OK 9:chk_offers_accepted_authorities '
     '10:chk_offers_accepted_authorities 11:chk_offers_accepted_authorities 12:trigger-dup '
     '13:chk_offers_accepted_authorities 14:trigger-faa' THEN
    RAISE EXCEPTION '095: la autocomprobación no dio lo esperado: %', v_results;
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-095') THEN
    RAISE EXCEPTION '095: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '095: %', v_results;
END $$;

NOTIFY pgrst, 'reload schema';
