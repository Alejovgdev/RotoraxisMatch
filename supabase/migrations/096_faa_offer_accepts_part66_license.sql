-- ============================================================
-- AviationJobTalent V2 — Migration 096: una oferta FAA acepta una licencia
-- Part-66 equivalente
-- ============================================================
-- Created: 2026-10-02. Requiere la 095.
--
-- Hasta aquí una oferta FAA no aceptaba a nadie (CHECK de la 088, mantenido
-- en la 095). Desde esta migración la empresa puede marcar, en una oferta FAA,
-- una o varias autoridades Part-66 (EASA, UK CAA, CASA, UAE GCAA) y UNA
-- categoría: cumple quien tenga esa categoría emitida por cualquiera de las
-- marcadas. Por defecto, nada: sólo cuenta la licencia FAA.
--
-- No es la dirección de la 095 al revés. Allí la FAA no emite una B1.1 y hace
-- falta una tabla (qué certificado FAA cuenta por cada categoría). Aquí lo que
-- se acepta SÍ es una categoría Part-66 y la elige la empresa, así que se
-- guarda tal cual: `accepted_license_code`, junto a `accepted_authorities`.
--
-- Qué categorías puede elegir: las mismas que vería en una oferta Part-66 del
-- mismo oficio y producto, sin la C. Es el filtro de los chips del formulario
-- (licensesSelectableForOffer + isLicenseCompatibleWithProductType en TS), que
-- hasta ahora sólo vivía en TypeScript: la base no comprueba esa regla en la
-- licencia principal de una oferta de aeronave, y esta migración no la añade
-- ahí. Para la categoría aceptada sí, así que el filtro pasa a tener un espejo
-- SQL, y `npm run validate:authority-licenses` compara los dos en todas las
-- combinaciones de clase, oficio y producto.
--
-- Lo que la categoría decide al puntuar (cuenta como 'equivalent', con el 20 %
-- menos en licencia y aeronave) vive en el scorer (TS, offerMatchExplain.ts):
-- ninguna función SQL puntúa, y el núcleo de elegibilidad no mira licencias
-- salvo la vía (b) de motor, que no cambia.
--
-- ── LO QUE HACE ─────────────────────────────────────────────────────────
--   1. offers.accepted_license_code TEXT, con FK a license_categories.
--   2. public.faa_offer_acceptable_license_codes(clase, oficio, producto): el
--      filtro. Lee catálogos públicos; ejecutable por clientes (la usan el
--      trigger, que corre como quien escribe la oferta, y el validador).
--   3. chk_offers_accepted_authorities (095) se sustituye: una oferta FAA puede
--      aceptar autoridades Part-66 (nunca la FAA). Lo de las Part-66 no cambia.
--   4. chk_offers_accepted_license_code, nuevo: la categoría existe
--      exactamente cuando una oferta FAA acepta alguna autoridad. Autoridades
--      sin categoría, o categoría sin autoridades, se rechazan.
--   5. enforce_offer_accepted_authorities (095) añade la rama FAA: sin
--      repetidas, la categoría pasa el filtro y la emite cada autoridad
--      marcada. Salta también al cambiar la clase, el oficio o el producto, de
--      los que depende el filtro. Rechaza, no corrige: limpiar lo que deja de
--      aplicar lo hacen el formulario y el repositorio.
--   6. update_offer_with_habilitations admite la clave 'accepted_license_code'.
--      El resto del cuerpo es el de la 088, sin cambios.
--
-- Nada que migrar: el 2026-10-02 ninguna oferta FAA acepta autoridades (el
-- CHECK lo prohibía). Aplicación única, como 064–095.
-- ============================================================


-- ── 1. La columna ───────────────────────────────────────────

ALTER TABLE public.offers
  ADD COLUMN accepted_license_code TEXT REFERENCES public.license_categories(code);

COMMENT ON COLUMN public.offers.accepted_license_code IS
  '096: en una oferta FAA, la categoría Part-66 que también cuenta, emitida por cualquiera de accepted_authorities. '
  'NULL en cualquier otra oferta (chk_offers_accepted_license_code).';


-- ── 2. El filtro ────────────────────────────────────────────
-- Espejo de faaOfferAcceptableLicenseCodes (src/constants/licenses.ts):
--   motor     B1.1–B1.4 (ENGINE_OFFER_LICENSE_CODES, la parte Part-66)
--   aeronave  la rama del oficio: mecánico A1–A4, B1.1–B1.4, B3, L; aviónico
--             B2, B2L; oficio sin licencias, ninguna; oficio con licencias sin
--             rama (pilot), todas
--   producto  A1, A2, B1.1, B1.2, B3, L sólo en aviones; A3, A4, B1.3, B1.4
--             sólo en helicópteros (getOfferProductTypeRestriction)
-- Siempre sin la C, y sólo códigos que emite alguna autoridad Part-66.

CREATE OR REPLACE FUNCTION public.faa_offer_acceptable_license_codes(
  p_offer_kind TEXT, p_technician_type TEXT, p_product_type TEXT)
RETURNS TEXT[] LANGUAGE sql STABLE PARALLEL SAFE SET search_path TO public AS $$
  SELECT COALESCE(array_agg(lc.code ORDER BY lc.sort_order, lc.code), ARRAY[]::TEXT[])
    FROM public.license_categories lc
   WHERE lc.code <> 'C'
     AND EXISTS (SELECT 1 FROM public.authority_licenses al
                  WHERE al.license_code = lc.code AND al.authority IN ('EASA', 'UK_CAA', 'CASA', 'GCAA'))
     AND CASE
           WHEN p_offer_kind = 'engine' THEN lc.code IN ('B1.1', 'B1.2', 'B1.3', 'B1.4')
           WHEN NOT COALESCE((SELECT tt.requires_license FROM public.technician_types tt WHERE tt.code = p_technician_type), true)
             THEN false
           WHEN p_technician_type = 'mechanic' THEN lc.code IN ('A1', 'A2', 'A3', 'A4', 'B1.1', 'B1.2', 'B1.3', 'B1.4', 'B3', 'L')
           WHEN p_technician_type = 'avionic' THEN lc.code IN ('B2', 'B2L')
           ELSE true
         END
     AND CASE
           WHEN lc.code IN ('A1', 'A2', 'B1.1', 'B1.2', 'B3', 'L') THEN p_product_type = 'Aeroplane'
           WHEN lc.code IN ('A3', 'A4', 'B1.3', 'B1.4') THEN p_product_type = 'Helicopter'
           ELSE true
         END
$$;
GRANT EXECUTE ON FUNCTION public.faa_offer_acceptable_license_codes(TEXT, TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.faa_offer_acceptable_license_codes(TEXT, TEXT, TEXT) IS
  '096: las categorías Part-66 que una oferta FAA de esta clase, oficio y producto puede aceptar como equivalente. '
  'Las de una oferta Part-66 del mismo oficio y producto, sin la C. Espejo: faaOfferAcceptableLicenseCodes (TS).';


-- ── 3. El CHECK de autoridades admite ofertas FAA ───────────

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
      OR (license_code IS NOT NULL
          AND license_authority = 'FAA'
          AND accepted_authorities <@ ARRAY['EASA', 'UK_CAA', 'CASA', 'GCAA']::TEXT[])
    )
  );

COMMENT ON CONSTRAINT chk_offers_accepted_authorities ON public.offers IS
  'Fase 10 (088, 095, 096): en una oferta Part-66, otras Part-66 o la FAA, nunca la exigida; en una oferta FAA, sólo '
  'Part-66; vacía sin licencia. Que cada una emita el código (o la categoría aceptada) lo vigila el trigger '
  'enforce_offer_accepted_authorities.';


-- ── 4. La categoría va con las autoridades, sólo en ofertas FAA ─

ALTER TABLE public.offers
  ADD CONSTRAINT chk_offers_accepted_license_code
  CHECK (
    (accepted_license_code IS NOT NULL)
    = (license_authority IS NOT DISTINCT FROM 'FAA' AND cardinality(accepted_authorities) > 0)
  );

COMMENT ON CONSTRAINT chk_offers_accepted_license_code ON public.offers IS
  '096: una oferta FAA que acepta autoridades Part-66 nombra UNA categoría, y ninguna otra oferta la nombra. '
  'Que la categoría pase el filtro y la emitan las autoridades lo vigila enforce_offer_accepted_authorities.';


-- ── 5. El trigger, con la rama FAA ──────────────────────────
-- Idéntico a la 095 salvo el bloque marcado con 096 y la primera guarda, que
-- ya no deja pasar las ofertas FAA.

CREATE OR REPLACE FUNCTION public.enforce_offer_accepted_authorities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_missing TEXT;
BEGIN
  -- Los triggers BEFORE corren ANTES que los CHECK. Lo que es forma de la fila
  -- (sin licencia, una autoridad que no es Part-66, una oferta FAA sin
  -- categoría) se deja al CHECK, que lo dice con su nombre; aquí sólo lo que
  -- necesita el catálogo.
  IF cardinality(NEW.accepted_authorities) = 0
     OR NEW.license_code IS NULL
     OR NEW.license_authority NOT IN ('EASA', 'UK_CAA', 'CASA', 'GCAA', 'FAA') THEN
    RETURN NEW;
  END IF;

  IF cardinality(NEW.accepted_authorities) <> (SELECT count(DISTINCT a) FROM unnest(NEW.accepted_authorities) AS a) THEN
    RAISE EXCEPTION 'Offer % lists an accepted authority twice.', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 096: una oferta FAA acepta UNA categoría Part-66, de las que su clase,
  -- oficio y producto pueden pedir (sin la C), emitida por cada autoridad
  -- marcada.
  IF NEW.license_authority = 'FAA' THEN
    IF NEW.accepted_license_code IS NULL THEN
      RETURN NEW;
    END IF;
    IF NOT (NEW.accepted_license_code = ANY (
              public.faa_offer_acceptable_license_codes(NEW.offer_kind, NEW.technician_type, NEW.product_type))) THEN
      RAISE EXCEPTION 'FAA offer % cannot accept a % licence: it is not one this kind of offer, trade and product can accept.',
        NEW.id, NEW.accepted_license_code
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT string_agg(a, ', ') INTO v_missing
      FROM unnest(NEW.accepted_authorities) AS a
     WHERE a IN ('EASA', 'UK_CAA', 'CASA', 'GCAA')
       AND NOT EXISTS (SELECT 1 FROM public.authority_licenses al
                        WHERE al.authority = a AND al.license_code = NEW.accepted_license_code);
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION '% does not issue a % licence, so offer % cannot accept it as equivalent.', v_missing, NEW.accepted_license_code, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
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

-- 096: también al cambiar la categoría, la clase, el oficio o el producto.
DROP TRIGGER IF EXISTS enforce_offer_accepted_authorities ON public.offers;
CREATE TRIGGER enforce_offer_accepted_authorities
  BEFORE INSERT OR UPDATE OF accepted_authorities, license_code, license_authority,
    accepted_license_code, offer_kind, technician_type, product_type ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_offer_accepted_authorities();


-- ── 6. La RPC de edición admite la columna nueva ────────────

CREATE OR REPLACE FUNCTION public.update_offer_with_habilitations(p_offer_id uuid, p_patch jsonb, p_habilitations jsonb DEFAULT NULL)
RETURNS public.offers LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE old_offer public.offers; next_offer public.offers; entry record; check_row record;
  valid boolean; assignments text; null_keys text; equal_keys text;
  replacement jsonb:=p_habilitations; seen uuid[]:='{}';
BEGIN
  SELECT * INTO old_offer FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_active_user() OR
     NOT (public.is_admin() OR public.can_act_for_company(old_offer.company_id)) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' THEN RAISE EXCEPTION 'Expected an offer patch'; END IF;
  -- 088: 'accepted_authorities' entra; 'accepts_equivalent' se queda mientras dure la ventana.
  -- 096: 'accepted_license_code' entra.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) AS k(key) WHERE key<>ALL(ARRAY[
    'title','description','contract_type','salary_amount','salary_currency','salary_period','product_type','technician_type',
    'requires_certification','license_code','license_authority','accepts_equivalent','accepted_authorities','accepted_license_code','only_unlicensed','requires_all_aircraft',
    'offer_kind','required_engine_id','location_country','location_country_code','location_city_name','location_city_lat',
    'location_city_lng','location_city_geoname_id','min_years_experience','status','visible','expires_at'])) THEN
    RAISE EXCEPTION 'Unsupported offer field';
  END IF;
  next_offer:=jsonb_populate_record(old_offer,p_patch);
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.offers'::regclass AND attnum>0
    AND attnotnull AND NOT attisdropped AND (to_jsonb(next_offer)->attname)='null'::jsonb) THEN
    RAISE EXCEPTION 'Missing required offer field' USING ERRCODE='23502';
  END IF;
  -- Validate existing CHECKs against the candidate without mutating a row.
  -- This includes shape, salary, years, licence/authority and location rules.
  FOR check_row IN SELECT conname,pg_get_expr(conbin,conrelid) AS expression FROM pg_constraint
    WHERE conrelid='public.offers'::regclass AND contype='c'
  LOOP
    EXECUTE format('SELECT (%s) IS NOT FALSE FROM jsonb_populate_record(NULL::public.offers,$1)',check_row.expression)
      INTO valid USING to_jsonb(next_offer);
    IF NOT valid THEN RAISE EXCEPTION 'Invalid offer: %',check_row.conname USING ERRCODE='23514'; END IF;
  END LOOP;
  -- Check every FK, including composite licence/authority pairs, before delete.
  FOR check_row IN SELECT * FROM pg_constraint WHERE conrelid='public.offers'::regclass AND contype='f' LOOP
    SELECT string_agg(format('candidate.%I IS NULL',a.attname),' OR '),
      string_agg(format('candidate.%I=referenced.%I',a.attname,b.attname),' AND ')
      INTO null_keys,equal_keys
      FROM unnest(check_row.conkey,check_row.confkey) AS k(local_key,foreign_key)
      JOIN pg_attribute a ON a.attrelid=check_row.conrelid AND a.attnum=k.local_key
      JOIN pg_attribute b ON b.attrelid=check_row.confrelid AND b.attnum=k.foreign_key;
    EXECUTE format('SELECT (%s) OR EXISTS(SELECT 1 FROM %s referenced WHERE %s) FROM jsonb_populate_record(NULL::public.offers,$1) candidate',
      null_keys,check_row.confrelid::regclass,equal_keys) INTO valid USING to_jsonb(next_offer);
    IF NOT valid THEN RAISE EXCEPTION 'Invalid offer reference: %',check_row.conname USING ERRCODE='23503'; END IF;
  END LOOP;
  -- 086: sin la cláusula FAA. Bajo la FAA las aeronaves son experiencia.
  IF replacement IS NULL AND (old_offer.product_type IS DISTINCT FROM next_offer.product_type OR next_offer.offer_kind='engine') THEN
    replacement:='[]';
  END IF;
  IF replacement IS NOT NULL THEN
    IF jsonb_typeof(replacement)<>'array' THEN RAISE EXCEPTION 'Expected an aircraft array'; END IF;
    FOR entry IN SELECT * FROM jsonb_to_recordset(replacement) AS x(aircraft_type_rating_id uuid,notes text) LOOP
      PERFORM 1 FROM public.aircraft_type_ratings WHERE id=entry.aircraft_type_rating_id AND product_type=next_offer.product_type;
      IF NOT FOUND THEN RAISE EXCEPTION 'Aircraft type rating does not match offer product'; END IF;
      IF entry.aircraft_type_rating_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate aircraft type rating'; END IF;
      seen:=array_append(seen,entry.aircraft_type_rating_id);
    END LOOP;
    IF jsonb_array_length(replacement)>0 AND next_offer.offer_kind='engine' THEN RAISE EXCEPTION 'Engine offers cannot require aircraft'; END IF;
    DELETE FROM public.offer_required_habilitations WHERE offer_id=p_offer_id;
  END IF;
  SELECT string_agg(format('%I=next.%I',key,key),',') INTO assignments FROM jsonb_object_keys(p_patch) AS k(key);
  IF assignments IS NOT NULL THEN
    EXECUTE format('UPDATE public.offers SET %s FROM jsonb_populate_record(NULL::public.offers,$1) AS next WHERE offers.id=$2 RETURNING offers.*',assignments)
      INTO next_offer USING to_jsonb(next_offer),p_offer_id;
    IF next_offer.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not authorized.'; END IF;
  END IF;
  IF replacement IS NOT NULL THEN
    INSERT INTO public.offer_required_habilitations(offer_id,product_type,aircraft_type_rating_id,notes)
      SELECT p_offer_id,next_offer.product_type,x.aircraft_type_rating_id,x.notes
      FROM jsonb_to_recordset(replacement) AS x(aircraft_type_rating_id uuid,notes text);
  END IF;
  RETURN next_offer;
END $$;

REVOKE ALL ON FUNCTION public.update_offer_with_habilitations(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_offer_with_habilitations(uuid,jsonb,jsonb) TO authenticated;


-- ── Post-condiciones y autocomprobación ─────────────────────
--
-- Mismo patrón que la 088 y la 095: cada caso intenta escribir una oferta y se
-- registra quién la rechaza (el CHECK por su nombre, el trigger por su
-- mensaje) u 'OK'. Todo se deshace (P0096).

DO $$
DECLARE
  v_src        public.offers%ROWTYPE;
  v_engine     UUID;
  v_offer      UUID;
  v_case       RECORD;
  v_constraint TEXT;
  v_message    TEXT;
  v_got        TEXT;
  v_results    TEXT := '';
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.faa_offer_acceptable_license_codes(text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.faa_offer_acceptable_license_codes(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '096: faa_offer_acceptable_license_codes debe ser ejecutable por clientes.';
  END IF;
  IF public.faa_offer_acceptable_license_codes('aircraft', 'avionic', 'Aeroplane') IS DISTINCT FROM ARRAY['B2', 'B2L']
     OR public.faa_offer_acceptable_license_codes('aircraft', 'mechanic', 'Helicopter') IS DISTINCT FROM ARRAY['A3', 'A4', 'B1.3', 'B1.4']
     OR public.faa_offer_acceptable_license_codes('aircraft', 'mechanic', 'Aeroplane') IS DISTINCT FROM ARRAY['A1', 'A2', 'B1.1', 'B1.2', 'B3', 'L']
     OR public.faa_offer_acceptable_license_codes('engine', 'engine_technician', 'Aeroplane') IS DISTINCT FROM ARRAY['B1.1', 'B1.2']
     OR public.faa_offer_acceptable_license_codes('aircraft', 'painter', 'Aeroplane') IS DISTINCT FROM ARRAY[]::TEXT[]
     OR public.faa_offer_acceptable_license_codes('aircraft', 'pilot', 'Helicopter') IS DISTINCT FROM ARRAY['A3', 'A4', 'B1.3', 'B1.4', 'B2', 'B2L'] THEN
    RAISE EXCEPTION '096: el filtro de categorías no dice lo esperado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE license_authority = 'FAA' AND cardinality(accepted_authorities) > 0) THEN
    RAISE EXCEPTION '096: ya hay ofertas FAA con autoridades aceptadas; esta migración se escribió sin ninguna.';
  END IF;
  IF position('accepted_license_code' IN pg_get_functiondef('public.update_offer_with_habilitations(uuid,jsonb,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '096: la RPC no admite accepted_license_code.';
  END IF;

  SELECT * INTO v_src FROM public.offers ORDER BY created_at LIMIT 1;
  SELECT id INTO v_engine FROM public.engines WHERE is_active AND NOT is_generic ORDER BY id LIMIT 1;
  IF v_src.id IS NULL OR v_engine IS NULL THEN
    RAISE EXCEPTION '096: faltan fixtures (una oferta de la que copiar y un motor activo).';
  END IF;

  BEGIN
    FOR v_case IN SELECT * FROM (VALUES
        -- n, autoridad, código, aceptadas, categoría aceptada, oficio, producto
        (1,  'FAA',  'A&P',  ARRAY['EASA', 'UK_CAA'], 'B2',   'avionic',           'Aeroplane'),
        (2,  'FAA',  'A&P',  ARRAY['EASA'],           NULL,   'mechanic',          'Aeroplane'),
        (3,  'FAA',  'A&P',  ARRAY[]::TEXT[],         'B1.1', 'mechanic',          'Aeroplane'),
        (4,  'FAA',  'A&P',  ARRAY['EASA'],           'C',    'mechanic',          'Aeroplane'),
        (5,  'FAA',  'A&P',  ARRAY['EASA'],           'B2',   'mechanic',          'Aeroplane'),
        (6,  'FAA',  'A&P',  ARRAY['CASA'],           'B2L',  'avionic',           'Aeroplane'),
        (7,  'FAA',  'A&P',  ARRAY['EASA', 'EASA'],   'B1.1', 'mechanic',          'Aeroplane'),
        (8,  'FAA',  'A&P',  ARRAY['FAA'],            'B1.1', 'mechanic',          'Aeroplane'),
        (9,  'FAA',  'A',    ARRAY['EASA'],           'B1.3', 'mechanic',          'Aeroplane'),
        (10, 'FAA',  'P',    ARRAY['UK_CAA'],         'B1.1', 'engine_technician', 'Aeroplane'),
        (11, 'FAA',  'P',    ARRAY['UK_CAA'],         'B2',   'engine_technician', 'Aeroplane'),
        (12, 'EASA', 'B1.1', ARRAY['UK_CAA'],         'B1.1', 'mechanic',          'Aeroplane'),
        (13, 'EASA', 'B1.1', ARRAY['UK_CAA', 'FAA'],  NULL,   'mechanic',          'Aeroplane'),
        (14, 'FAA',  'A&P',  ARRAY['EASA'],           'A&P',  'mechanic',          'Aeroplane'),
        (15, 'FAA',  'A&P',  ARRAY['GCAA', 'EASA'],   'B3',   'mechanic',          'Aeroplane'),
        (16, 'FAA',  'A&P',  ARRAY['EASA'],           'B1.3', 'mechanic',          'Helicopter')
      ) AS t(n, authority, code, accepted, accepted_code, technician_type, product)
    LOOP
      v_constraint := NULL; v_message := NULL;
      BEGIN
        INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
          requires_certification, license_code, license_authority, accepted_authorities, accepted_license_code,
          location_country, location_country_code, min_years_experience, status, visible, offer_kind, required_engine_id)
        VALUES (v_src.company_id, 'selftest-096', 'selftest', v_src.contract_type, v_case.product, v_case.technician_type,
          true, v_case.code, v_case.authority, v_case.accepted, v_case.accepted_code,
          v_src.location_country, v_src.location_country_code, 0, 'draft', false,
          CASE WHEN v_case.technician_type = 'engine_technician' THEN 'engine' ELSE 'aircraft' END,
          CASE WHEN v_case.technician_type = 'engine_technician' THEN v_engine END);
        v_got := 'OK';
      EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME, v_message = MESSAGE_TEXT;
        v_got := CASE
          WHEN COALESCE(v_constraint, '') <> '' THEN v_constraint
          WHEN v_message LIKE '%cannot accept a % licence: it is not one%' THEN 'trigger-filter'
          WHEN v_message LIKE '%lists an accepted authority twice%' THEN 'trigger-dup'
          WHEN v_message LIKE '%does not issue%' THEN 'trigger-code'
          ELSE 'trigger?' END;
      END;
      v_results := v_results || v_case.n || ':' || v_got || ' ';
    END LOOP;

    -- 17. Cambiar el oficio de una oferta FAA que acepta B1.1 a aviónico: la
    -- B1.1 deja de pasar el filtro. Se rechaza, no se corrige.
    v_message := NULL;
    BEGIN
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, license_code, license_authority, accepted_authorities, accepted_license_code,
        location_country, location_country_code, min_years_experience, status, visible, offer_kind)
      VALUES (v_src.company_id, 'selftest-096', 'selftest', v_src.contract_type, 'Aeroplane', 'mechanic',
        true, 'A&P', 'FAA', ARRAY['EASA'], 'B1.1', v_src.location_country, v_src.location_country_code,
        0, 'draft', false, 'aircraft')
      RETURNING id INTO v_offer;
      UPDATE public.offers SET technician_type = 'avionic' WHERE id = v_offer;
      v_got := 'OK';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_got := CASE WHEN v_message LIKE '%cannot accept a B1.1 licence: it is not one%' THEN 'trigger-filter' ELSE 'otro' END;
    END;
    v_results := v_results || '17:' || v_got || ' ';

    -- 18. Pasar a Part-66 una oferta FAA con categoría aceptada: la categoría
    -- sobra. La rechaza el CHECK nuevo.
    v_constraint := NULL;
    BEGIN
      INSERT INTO public.offers (company_id, title, description, contract_type, product_type, technician_type,
        requires_certification, license_code, license_authority, accepted_authorities, accepted_license_code,
        location_country, location_country_code, min_years_experience, status, visible, offer_kind)
      VALUES (v_src.company_id, 'selftest-096', 'selftest', v_src.contract_type, 'Aeroplane', 'mechanic',
        true, 'A&P', 'FAA', ARRAY['UK_CAA'], 'B1.1', v_src.location_country, v_src.location_country_code,
        0, 'draft', false, 'aircraft')
      RETURNING id INTO v_offer;
      UPDATE public.offers SET license_authority = 'EASA', license_code = 'B1.1' WHERE id = v_offer;
      v_got := 'OK';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      v_got := COALESCE(NULLIF(v_constraint, ''), 'trigger?');
    END;
    v_results := v_results || '18:' || v_got;

    RAISE EXCEPTION USING ERRCODE = 'P0096', MESSAGE = 'deshacer autocomprobación';
  EXCEPTION WHEN SQLSTATE 'P0096' THEN
    NULL;
  END;

  IF v_results IS DISTINCT FROM
     '1:OK 2:chk_offers_accepted_license_code 3:chk_offers_accepted_license_code 4:trigger-filter '
     '5:trigger-filter 6:trigger-code 7:trigger-dup 8:chk_offers_accepted_authorities 9:trigger-filter '
     '10:OK 11:trigger-filter 12:chk_offers_accepted_license_code 13:OK 14:trigger-filter 15:OK '
     '16:OK 17:trigger-filter 18:chk_offers_accepted_license_code' THEN
    RAISE EXCEPTION '096: la autocomprobación no dio lo esperado: %', v_results;
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE title = 'selftest-096') THEN
    RAISE EXCEPTION '096: la autocomprobación dejó filas escritas.';
  END IF;

  RAISE NOTICE '096: %', v_results;
END $$;

NOTIFY pgrst, 'reload schema';
