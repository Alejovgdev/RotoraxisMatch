-- ============================================================
-- AviationJobTalent V2 — Migration 094: aeronave firmada (FAA) en la
-- experiencia del técnico
-- ============================================================
-- Created: 2026-09-29 (parte 2 de la firma FAA). Requiere la 093.
--
-- Un técnico con licencia FAA A o A&P puede marcar que ha FIRMADO trabajo en
-- una aeronave de su experiencia declarada (technician_aircraft_experience).
-- En una oferta FAA con aeronaves que pide A o A&P, sólo cuenta la
-- experiencia firmada; eso lo decide el scorer (TS, offerMatchExplain.ts),
-- que es donde vive la puntuación: ninguna función SQL puntúa ni filtra por
-- esta tabla, así que no hay espejo que tocar.
--
-- ── LO QUE HACE ─────────────────────────────────────────────────────────
--   1. Columna `signed boolean NOT NULL DEFAULT false`. Las filas existentes
--      (1 el 2026-09-29) quedan sin firmar.
--   2. Invariante de la BASE, mismo patrón que la 091:
--        - un trigger sobre la tabla rechaza signed = true de un técnico sin
--          FAA A ni A&P. Hace falta en la tabla y no sólo en la RPC porque
--          la política tae_insert_own (050) deja insertar desde el cliente;
--        - un trigger sobre technician_licenses pone a false las firmas del
--          técnico cuando se queda sin FAA A y sin A&P (DELETE, o UPDATE de
--          autoridad, código o técnico), en la misma operación. Se mira el
--          estado resultante: tener la A y quitar la A&P no borra nada.
--        - Los dos triggers bloquean la fila de technician_profiles, como la
--          091, para que una firma y una retirada de licencia simultáneas no
--          dejen firmas sueltas.
--      Con sólo la P no se firma: la firma es de célula (A) o de las dos (A&P).
--   3. replace_technician_aircraft_experience (084) acepta `signed` (false si
--      no viene) y rechaza antes de borrar nada, con el mismo error.
--
-- technician_can_sign_off_aircraft(uuid) es SECURITY DEFINER y SIN EXECUTE
-- para clientes: preguntar por cualquier técnico sería un oráculo de sus
-- licencias. La RPC (INVOKER) mira las del propio técnico directamente.
--
-- Aplicación única, como 064–093.
-- ============================================================


-- ── 1. La columna ───────────────────────────────────────────

ALTER TABLE public.technician_aircraft_experience
  ADD COLUMN IF NOT EXISTS signed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.technician_aircraft_experience.signed IS
  '094: el técnico ha firmado trabajo en esta aeronave. Sólo con licencia FAA A o A&P (trigger); '
  'se pone a false al perder las dos. En ofertas FAA A o A&P con aeronaves sólo cuenta la experiencia firmada.';


-- ── 2. ¿Puede firmar? ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.technician_can_sign_off_aircraft(p_technician_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
  SELECT EXISTS (SELECT 1 FROM public.technician_licenses
                  WHERE technician_id = p_technician_id AND authority = 'FAA' AND license_code IN ('A', 'A&P'))
$$;
REVOKE ALL ON FUNCTION public.technician_can_sign_off_aircraft(UUID) FROM PUBLIC, anon, authenticated;


-- ── 3a. Sin FAA A ni A&P no se firma ────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_signed_aircraft_requires_faa_license()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  IF NEW.signed THEN
    -- KEY SHARE: choca con el FOR UPDATE de la retirada de licencia (abajo).
    PERFORM 1 FROM public.technician_profiles WHERE id = NEW.technician_id FOR KEY SHARE;
    IF NOT public.technician_can_sign_off_aircraft(NEW.technician_id) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Only a technician with an FAA A or A&P licence can mark an aircraft as signed off.',
        DETAIL  = 'not_faa_sign_off_licensed';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_signed_aircraft_requires_faa_license() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_signed_aircraft_requires_faa_license ON public.technician_aircraft_experience;
CREATE TRIGGER enforce_signed_aircraft_requires_faa_license
  BEFORE INSERT OR UPDATE OF signed, technician_id ON public.technician_aircraft_experience
  FOR EACH ROW EXECUTE FUNCTION public.enforce_signed_aircraft_requires_faa_license();


-- ── 3b. Perder la licencia se lleva las firmas ──────────────

CREATE OR REPLACE FUNCTION public.clear_signed_aircraft_without_faa_license()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  IF OLD.authority = 'FAA' AND OLD.license_code IN ('A', 'A&P') THEN
    -- Serializa con la firma (3a) y con la RPC. En una cascada desde
    -- technician_profiles la fila ya no existe: no bloquea nada y sigue.
    PERFORM 1 FROM public.technician_profiles WHERE id = OLD.technician_id FOR UPDATE;
    IF NOT public.technician_can_sign_off_aircraft(OLD.technician_id) THEN
      UPDATE public.technician_aircraft_experience SET signed = false
       WHERE technician_id = OLD.technician_id AND signed;
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.clear_signed_aircraft_without_faa_license() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_signed_aircraft_without_faa_license ON public.technician_licenses;
CREATE TRIGGER clear_signed_aircraft_without_faa_license
  AFTER DELETE OR UPDATE OF authority, license_code, technician_id ON public.technician_licenses
  FOR EACH ROW EXECUTE FUNCTION public.clear_signed_aircraft_without_faa_license();


-- ── 4. La RPC de reemplazo guarda la firma ──────────────────
-- Idéntica a la 084 salvo lo marcado con 094.

CREATE OR REPLACE FUNCTION public.replace_technician_aircraft_experience(p_technician_id uuid, p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE entry record; seen uuid[] := '{}'; any_signed boolean := false;
BEGIN
  IF NOT public.is_active_user() OR p_technician_id IS DISTINCT FROM public.my_technician_id() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
  END IF;
  PERFORM 1 FROM public.technician_profiles WHERE id=p_technician_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' THEN RAISE EXCEPTION 'Expected an aircraft array'; END IF;
  FOR entry IN SELECT * FROM jsonb_to_recordset(p_entries) AS x(aircraft_type_rating_id uuid, years numeric, signed boolean) LOOP
    PERFORM 1 FROM public.aircraft_type_ratings WHERE id=entry.aircraft_type_rating_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown aircraft type rating'; END IF;
    IF entry.years IS NOT NULL AND (entry.years<0 OR entry.years>70 OR entry.years='NaN'::numeric) THEN
      RAISE EXCEPTION 'Experience years must be between 0 and 70';
    END IF;
    IF entry.aircraft_type_rating_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate aircraft type rating'; END IF;
    seen:=array_append(seen,entry.aircraft_type_rating_id);
    any_signed := any_signed OR COALESCE(entry.signed, false);  -- 094
  END LOOP;
  -- 094: firmar exige FAA A o A&P. Las licencias del propio técnico (RLS
  -- tl_select_own), no la función SECURITY DEFINER: ésa no es de clientes.
  IF any_signed AND NOT EXISTS (SELECT 1 FROM public.technician_licenses
       WHERE technician_id=p_technician_id AND authority='FAA' AND license_code IN ('A','A&P')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Only a technician with an FAA A or A&P licence can mark an aircraft as signed off.',
      DETAIL='not_faa_sign_off_licensed';
  END IF;
  DELETE FROM public.technician_aircraft_experience WHERE technician_id=p_technician_id;
  INSERT INTO public.technician_aircraft_experience(technician_id,aircraft_type_rating_id,years,signed)
    SELECT p_technician_id,x.aircraft_type_rating_id,x.years,COALESCE(x.signed,false)
    FROM jsonb_to_recordset(p_entries) AS x(aircraft_type_rating_id uuid, years numeric, signed boolean);
END $$;


-- ── Post-condiciones y autocomprobación ─────────────────────
--
-- Mismo patrón que la 092/093: el técnico actúa con su sesión y el rol
-- `authenticated`; cada paso se registra (OK o SQLSTATE) y todo se deshace
-- al final (P0094).

CREATE FUNCTION pg_temp.attempt_094(statement TEXT) RETURNS TEXT LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE statement;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $f$;

DO $$
DECLARE
  v_t   UUID;  v_tu UUID;
  v_r1  UUID;  v_r2 UUID;
  v_results TEXT := '';
  v_signed  INT;
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('enforce_signed_aircraft_requires_faa_license', 'clear_signed_aircraft_without_faa_license') AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '094: faltan triggers.';
  END IF;
  IF has_function_privilege('authenticated', 'public.technician_can_sign_off_aircraft(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.technician_can_sign_off_aircraft(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '094: technician_can_sign_off_aircraft no debe ser ejecutable por clientes.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.technician_aircraft_experience WHERE signed) THEN
    RAISE EXCEPTION '094: hay filas firmadas recién creada la columna.';
  END IF;

  SELECT tp.id, tp.user_id INTO v_t, v_tu FROM public.technician_profiles tp
    JOIN public.profiles p ON p.id = tp.user_id
   WHERE p.status = 'active' ORDER BY tp.id LIMIT 1;
  SELECT id INTO v_r1 FROM public.aircraft_type_ratings WHERE is_active ORDER BY id LIMIT 1;
  SELECT id INTO v_r2 FROM public.aircraft_type_ratings WHERE is_active AND id <> v_r1 ORDER BY id LIMIT 1;
  IF v_t IS NULL OR v_r1 IS NULL OR v_r2 IS NULL THEN
    RAISE EXCEPTION '094: faltan fixtures (técnico activo y dos ratings).';
  END IF;

  BEGIN
    -- Punto de partida controlado: sin licencias FAA y sin experiencia.
    DELETE FROM public.technician_aircraft_experience WHERE technician_id = v_t;
    DELETE FROM public.technician_licenses WHERE technician_id = v_t AND authority = 'FAA';

    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_tu, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    -- 1. Sin licencia FAA: la RPC y el INSERT directo rechazan la firma.
    v_results := v_results || '1:' || pg_temp.attempt_094(format(
      'SELECT public.replace_technician_aircraft_experience(%L, %L::jsonb)', v_t,
      jsonb_build_array(jsonb_build_object('aircraft_type_rating_id', v_r1, 'signed', true))))
      || '/' || pg_temp.attempt_094(format(
      'INSERT INTO public.technician_aircraft_experience (technician_id, aircraft_type_rating_id, signed) VALUES (%L, %L, true)', v_t, v_r1)) || ' ';

    -- 2. Con sólo la P, tampoco.
    INSERT INTO public.technician_licenses (technician_id, authority, license_code) VALUES (v_t, 'FAA', 'P');
    v_results := v_results || '2:' || pg_temp.attempt_094(format(
      'SELECT public.replace_technician_aircraft_experience(%L, %L::jsonb)', v_t,
      jsonb_build_array(jsonb_build_object('aircraft_type_rating_id', v_r1, 'signed', true)))) || ' ';

    -- 3. Con la A&P, sí; la que no se marca queda sin firmar, y sin la clave, false.
    INSERT INTO public.technician_licenses (technician_id, authority, license_code) VALUES (v_t, 'FAA', 'A&P');
    v_results := v_results || '3:' || pg_temp.attempt_094(format(
      'SELECT public.replace_technician_aircraft_experience(%L, %L::jsonb)', v_t,
      jsonb_build_array(jsonb_build_object('aircraft_type_rating_id', v_r1, 'signed', true),
                        jsonb_build_object('aircraft_type_rating_id', v_r2))));
    SELECT count(*) FILTER (WHERE signed) INTO v_signed FROM public.technician_aircraft_experience WHERE technician_id = v_t;
    v_results := v_results || '/' || v_signed || ' ';

    -- 4. Quitar la A&P (con la P aún puesta) borra las firmas en la misma sentencia.
    DELETE FROM public.technician_licenses WHERE technician_id = v_t AND authority = 'FAA' AND license_code = 'A&P';
    SELECT count(*) FILTER (WHERE signed) INTO v_signed FROM public.technician_aircraft_experience WHERE technician_id = v_t;
    v_results := v_results || '4:' || v_signed || ' ';

    -- 5. Con la A sola se firma. Se mira el estado resultante: con la A
    --    puesta, quitar la A&P no toca las firmas, ni quitar la P; quitar la
    --    última (la A), sí.
    INSERT INTO public.technician_licenses (technician_id, authority, license_code) VALUES (v_t, 'FAA', 'A');
    v_results := v_results || '5:' || pg_temp.attempt_094(format(
      'SELECT public.replace_technician_aircraft_experience(%L, %L::jsonb)', v_t,
      jsonb_build_array(jsonb_build_object('aircraft_type_rating_id', v_r1, 'signed', true))));
    INSERT INTO public.technician_licenses (technician_id, authority, license_code) VALUES (v_t, 'FAA', 'A&P');
    DELETE FROM public.technician_licenses WHERE technician_id = v_t AND authority = 'FAA' AND license_code = 'A&P';
    SELECT count(*) FILTER (WHERE signed) INTO v_signed FROM public.technician_aircraft_experience WHERE technician_id = v_t;
    v_results := v_results || '/' || v_signed;
    DELETE FROM public.technician_licenses WHERE technician_id = v_t AND authority = 'FAA' AND license_code = 'P';
    SELECT count(*) FILTER (WHERE signed) INTO v_signed FROM public.technician_aircraft_experience WHERE technician_id = v_t;
    v_results := v_results || '/' || v_signed;
    DELETE FROM public.technician_licenses WHERE technician_id = v_t AND authority = 'FAA' AND license_code = 'A';
    SELECT count(*) FILTER (WHERE signed) INTO v_signed FROM public.technician_aircraft_experience WHERE technician_id = v_t;
    v_results := v_results || '/' || v_signed || ' ';
    RESET ROLE;

    RAISE EXCEPTION USING ERRCODE = 'P0094', MESSAGE = 'deshacer autocomprobación';
  EXCEPTION WHEN SQLSTATE 'P0094' THEN
    NULL;
  END;

  IF v_results IS DISTINCT FROM '1:23514/23514 2:23514 3:OK/1 4:0 5:OK/1/1/0 ' THEN
    RAISE EXCEPTION '094: la autocomprobación no dio lo esperado: %', v_results;
  END IF;

  RAISE NOTICE '094: %', v_results;
END $$;

DROP FUNCTION pg_temp.attempt_094(TEXT);

NOTIFY pgrst, 'reload schema';
