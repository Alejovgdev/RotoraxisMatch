-- ============================================================
-- AviationJobTalent V2 — Migration 104: edad mínima de 18 años del técnico
-- ============================================================
-- Created: 2026-10-16.
--
-- Un perfil de técnico no puede guardar una fecha de nacimiento de alguien
-- menor de 18 años, ni al darse de alta (signup_technician, INSERT directo)
-- ni al cambiarla después (UPDATE de birth_date, también el de un admin o el
-- de service_role). Lo impone el trigger enforce_technician_minimum_age; el
-- formulario de alta pide lo mismo antes de enviar (src/auth/birthDateRules.ts).
--
--   - Se cuenta con el día de HOY en UTC, igual que el formulario.
--   - "18 cumplidos" es `fecha <= hoy - 18 años`: quien nace un 29 de febrero
--     los cumple el 1 de marzo en los años no bisiestos. La regla vive en
--     meets_minimum_technician_age(nacimiento, hoy), inmutable, para poder
--     probarla con fechas fijas; los casos de la autoprueba son los mismos que
--     los de scripts/testBirthDateRules.ts (lo comprueba ese test).
--   - Error: SQLSTATE 23514, DETAIL 'under_minimum_age'.
--   - El trigger sólo salta al escribir birth_date: editar otro campo de un
--     perfil no vuelve a comprobar la edad. La lápida del borrado de cuenta
--     (handle_deleted_user, birth_date = '1900-01-01') sigue pasando.
--
-- No cambia datos. Antes de crear nada comprueba los perfiles existentes: si
-- alguno incumple, PARA sin cambiar nada y dice cuántos son; sin técnicos,
-- avisa con un NOTICE y sigue.
--
-- Ensayo: `node scripts/rehearseTechnicianMinimumAge.cjs` (todo dentro de
-- transacciones con ROLLBACK). Deshacer:
-- ../rollbacks/104_technician_minimum_age.down.sql.
--
-- La autoprueba del final crea sus propios usuarios dentro de un bloque que se
-- revierte, así que funciona en una base sin usuarios. Sin un país activo o sin
-- el oficio 'mechanic' avisa con un NOTICE, salta las pruebas de comportamiento
-- y comprueba igualmente la regla y la estructura. Lo que va entre los
-- marcadores ">>> selftest 104" y "<<< selftest 104" lo reutiliza el ensayo
-- para comprobar la base ya instalada.
-- ============================================================


-- ── 1. Datos existentes ─────────────────────────────────────

DO $precheck$
DECLARE
  v_total bigint;
  v_under bigint;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE birth_date > ((now() AT TIME ZONE 'UTC')::date - interval '18 years')::date)
    INTO v_total, v_under
    FROM public.technician_profiles;
  IF v_total = 0 THEN
    RAISE NOTICE '104: there are no technician profiles yet; nothing existing to check.';
  ELSIF v_under > 0 THEN
    RAISE EXCEPTION '104 stopped: % technician profile(s) have a birth date under 18. Nothing was changed.', v_under;
  ELSE
    RAISE NOTICE '104: % technician profile(s) checked, all 18 or older.', v_total;
  END IF;
END $precheck$;


-- ── 2. La regla ─────────────────────────────────────────────

CREATE FUNCTION public.meets_minimum_technician_age(p_birth_date date, p_today date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT p_birth_date <= (p_today - interval '18 years')::date
$$;

COMMENT ON FUNCTION public.meets_minimum_technician_age(date, date) IS
  'true if someone born on p_birth_date is 18 or older on p_today. Mirrored by meetsMinimumTechnicianAge in src/auth/birthDateRules.ts.';


-- ── 3. El trigger ───────────────────────────────────────────

CREATE FUNCTION public.enforce_technician_minimum_age()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- NULL lo rechaza el NOT NULL de la columna, con su propio mensaje.
  IF NEW.birth_date IS NOT NULL
     AND NOT public.meets_minimum_technician_age(NEW.birth_date, (now() AT TIME ZONE 'UTC')::date) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Technicians must be at least 18 years old.',
      DETAIL  = 'under_minimum_age';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_technician_minimum_age() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_technician_minimum_age
  BEFORE INSERT OR UPDATE OF birth_date ON public.technician_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_technician_minimum_age();


-- ── 4. Autoprueba ───────────────────────────────────────────

CREATE FUNCTION pg_temp.attempt_104(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_detail text;
BEGIN
  EXECUTE statement;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || ':' || SQLERRM || ':' || COALESCE(v_detail, '');
END $$;

-- >>> selftest 104
DO $selftest$
DECLARE
  v_country text;
  tu uuid := gen_random_uuid();  -- técnico que se da de alta con 18 recién cumplidos
  mu uuid := gen_random_uuid();  -- técnico al que le falta un día
  t uuid;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_adult date;
  v_minor date;
  r record;
  names text[] := '{}'; oks boolean[] := '{}'; seen text[] := '{}';
  observed text; v_flag boolean; n bigint; failures text := ''; v_expected int := 10;
  i int;
BEGIN
  v_adult := (v_today - interval '18 years')::date;
  v_minor := v_adult + 1;

  -- Estructura: siempre, haya datos o no.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'enforce_technician_minimum_age' AND NOT tgisinternal
                    AND tgrelid = 'public.technician_profiles'::regclass) THEN
    RAISE EXCEPTION '104 self-test failed: trigger missing';
  END IF;
  IF has_function_privilege('anon', 'public.enforce_technician_minimum_age()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.enforce_technician_minimum_age()', 'EXECUTE') THEN
    RAISE EXCEPTION '104 self-test failed: trigger function is executable by clients';
  END IF;

  -- La regla, con fechas fijas: no necesita datos.
  FOR r IN SELECT c.birth::date AS birth, c.today::date AS today, c.expected FROM (VALUES
    ('2008-10-16', '2026-10-16', true),
    ('2008-10-17', '2026-10-16', false),
    ('2008-12-31', '2026-01-01', false),
    ('2007-12-31', '2026-01-01', true),
    ('2008-02-29', '2026-02-28', false),
    ('2008-02-29', '2026-03-01', true),
    ('2010-02-28', '2028-02-29', true),
    ('2010-03-01', '2028-02-29', false),
    ('1900-01-01', '2026-10-16', true),
    ('2026-10-16', '2026-10-16', false)
  ) AS c(birth, today, expected) LOOP
    v_flag := public.meets_minimum_technician_age(r.birth, r.today);
    names := array_append(names, format('rule: born %s, 18 on %s = %s', r.birth, r.today, r.expected::text));
    oks := oks || (v_flag IS NOT DISTINCT FROM r.expected); seen := seen || coalesce(v_flag::text, 'null');
  END LOOP;

  -- Comportamiento: con usuarios propios. Sólo necesita catálogos.
  SELECT code INTO v_country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
  IF v_country IS NULL OR NOT EXISTS (SELECT 1 FROM technician_types WHERE code = 'mechanic') THEN
    RAISE NOTICE '104 self-test: catalogs are empty (active country, mechanic); behaviour checks skipped, rule and structure checked.';
  ELSE
    v_expected := 18;
    BEGIN
      INSERT INTO profiles (id, email, role, status) VALUES
        (tu, 'selftest-104-t@example.invalid', 'technician', 'active'),
        (mu, 'selftest-104-m@example.invalid', 'technician', 'active');

      -- El alta real: signup_technician como el propio usuario.
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', tu, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      observed := pg_temp.attempt_104(format(
        'SELECT public.signup_technician(%L, %L, %L::date, %L, %L)', 'Self', 'Test', v_minor, 'mechanic', v_country));
      names := array_append(names, 'signup one day before turning 18 is rejected');
      oks := oks || (observed LIKE '23514:%under_minimum_age'); seen := seen || observed;
      observed := pg_temp.attempt_104(format(
        'SELECT public.signup_technician(%L, %L, %L::date, %L, %L)', 'Self', 'Test', v_today + 1, 'mechanic', v_country));
      names := array_append(names, 'signup with a future birth date is rejected');
      oks := oks || (observed LIKE '23514:%under_minimum_age'); seen := seen || observed;
      RESET ROLE;
      SELECT count(*) INTO n FROM technician_profiles WHERE user_id = tu;
      names := array_append(names, 'a rejected signup leaves no profile'); oks := oks || (n = 0); seen := seen || n::text;

      SET LOCAL ROLE authenticated;
      observed := pg_temp.attempt_104(format(
        'SELECT public.signup_technician(%L, %L, %L::date, %L, %L)', 'Self', 'Test', v_adult, 'mechanic', v_country));
      names := array_append(names, 'signup on the 18th birthday is accepted');
      oks := oks || (observed = 'OK'); seen := seen || observed;
      RESET ROLE;
      SELECT id INTO t FROM technician_profiles WHERE user_id = tu;

      -- INSERT directo del cliente (tp_insert_own), sin pasar por la RPC.
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', mu, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      observed := pg_temp.attempt_104(format(
        'INSERT INTO public.technician_profiles (user_id, anonymous_code, first_name, last_name, email, birth_date, technician_type, location_country_code) VALUES (%L, %L, %L, %L, %L, %L::date, %L, %L)',
        mu, 'TS104' || left(replace(gen_random_uuid()::text, '-', ''), 6), 'Minor', 'Test',
        'selftest-104-m@example.invalid', v_minor, 'mechanic', v_country));
      names := array_append(names, 'direct client insert under 18 is rejected');
      oks := oks || (observed LIKE '23514:%under_minimum_age'); seen := seen || observed;
      RESET ROLE;

      -- Cambiarla después, incluso con privilegios (sin RLS).
      observed := pg_temp.attempt_104(format(
        'UPDATE public.technician_profiles SET birth_date = %L::date WHERE id = %L', v_minor, t));
      names := array_append(names, 'privileged update to under 18 is rejected');
      oks := oks || (observed LIKE '23514:%under_minimum_age'); seen := seen || observed;
      observed := pg_temp.attempt_104(format(
        'UPDATE public.technician_profiles SET first_name = %L WHERE id = %L', 'Edited', t));
      names := array_append(names, 'editing another field still works');
      oks := oks || (observed = 'OK'); seen := seen || observed;
      observed := pg_temp.attempt_104(format(
        'UPDATE public.technician_profiles SET birth_date = %L::date WHERE id = %L', '1900-01-01', t));
      names := array_append(names, 'the account-deletion tombstone date is accepted');
      oks := oks || (observed = 'OK'); seen := seen || observed;

      RAISE EXCEPTION USING ERRCODE = 'P0104', MESSAGE = 'undo selftest 104';
    EXCEPTION WHEN SQLSTATE 'P0104' THEN
      NULL;
    END;
  END IF;

  -- Fuera del bloque revertido: el ensayo deja preparada esta tabla temporal
  -- para leer cada caso; al aplicar la migración no existe.
  IF to_regclass('pg_temp.selftest_104_results') IS NOT NULL THEN
    EXECUTE 'INSERT INTO pg_temp.selftest_104_results (test, passed, observed) SELECT * FROM unnest($1, $2, $3)'
      USING names, oks, seen;
  END IF;
  FOR i IN 1 .. coalesce(array_length(names, 1), 0) LOOP
    IF oks[i] IS NOT TRUE THEN
      failures := failures || names[i] || ' [' || coalesce(seen[i], 'null') || ']; ';
    END IF;
  END LOOP;
  IF coalesce(array_length(names, 1), 0) <> v_expected THEN
    failures := failures || 'expected ' || v_expected || ' cases, ran ' || coalesce(array_length(names, 1), 0) || '; ';
  END IF;
  IF failures <> '' THEN
    RAISE EXCEPTION '104 self-test failed: %', failures;
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE email LIKE 'selftest-104-%@example.invalid') THEN
    RAISE EXCEPTION '104 self-test failed: fixtures were left behind';
  END IF;
  RAISE NOTICE '104 self-test: % cases passed', array_length(names, 1);
END $selftest$;
-- <<< selftest 104

DROP FUNCTION pg_temp.attempt_104(text);
