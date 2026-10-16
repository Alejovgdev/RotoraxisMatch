-- ============================================================
-- AviationJobTalent V2 — Migration 106: cuentas de prueba para los revisores
-- ============================================================
-- Created: 2026-10-16.
--
-- Los revisores de Apple y Google necesitan cuentas de prueba en producción
-- (un técnico, una empresa y una cuenta desechable para probar el borrado) que
-- los usuarios reales no deben ver.
--
-- Decisiones del dueño (2026-10-16):
--
--   - Una marca, profiles.is_test_account, que sólo se pone o se quita por SQL
--     desde el panel de Supabase. Desde la app no la cambia nadie: ni el propio
--     usuario, ni el admin de la plataforma, ni las funciones (service_role).
--   - Técnico de prueba: su cuenta tiene la marca. Empresa de prueba: alguno de
--     sus miembros la tiene, y entonces todos sus miembros cuentan como de
--     prueba (también los que se inviten después).
--   - Dos mundos separados en los dos sentidos: las cuentas reales no ven las
--     de prueba y las de prueba no ven las reales. Vale para la búsqueda y el
--     mapa de técnicos, los técnicos de una oferta, las ofertas publicadas (y
--     sus aeronaves) y las empresas.
--   - El admin de la plataforma lo sigue viendo todo: sus políticas no cambian.
--   - Sin guarda en candidaturas ni ofertas directas: para crearlas hay que ver
--     a la otra parte. Las relaciones que ya existieran al marcar una cuenta
--     siguen viéndose; se marcan cuentas recién creadas.
--
-- Piezas:
--   1. profiles.is_test_account (false por defecto).
--   2. guard_profiles_test_account: rechaza cambiarla con una identidad de la
--      app (rol de la API o sesión de usuario).
--   3. is_test_company(company) e is_test_viewer(): quién es de prueba.
--   4. technician_public_view: sólo técnicos del mismo mundo que quien mira. De
--      ella salen la búsqueda, el mapa, los técnicos de una oferta y la lectura
--      de cualificaciones (company_can_read_technician_qualifications la
--      consulta).
--   5. offers_select_published y companies_select_all: lo mismo. Los
--      requisitos de aeronave de una oferta siguen a la oferta (su política
--      lee offers con RLS).
--
-- No cambia datos existentes: al aplicarse no queda nadie marcado, así que
-- todo se ve igual que antes. La app no cambia. Ensayo:
-- `node scripts/rehearseTestAccounts.cjs` (todo con ROLLBACK).
-- Deshacer: ../rollbacks/106_test_accounts.down.sql.
--
-- La autoprueba del final crea sus propias cuentas, empresas y ofertas dentro
-- de un bloque que se revierte, así que funciona en una base sin usuarios (lo
-- avisa con un NOTICE). Sin catálogos (un país activo, un tipo de empresa, un
-- tipo de contrato, el oficio 'mechanic' y un type rating de avión activo)
-- avisa con un NOTICE, salta el comportamiento y comprueba la estructura. Lo
-- que va entre ">>> selftest 106" y "<<< selftest 106" lo reutiliza el ensayo
-- con la base ya instalada.
-- ============================================================


-- ── 1. La marca ─────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN is_test_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_test_account IS
  'Store-review test account (106). Set only from the Supabase SQL editor. Test and real accounts do not see each other; a company is a test company when any of its members is marked.';


-- ── 2. Sólo desde el SQL editor ─────────────────────────────

CREATE FUNCTION public.guard_profiles_test_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_test_account)
     OR (TG_OP = 'UPDATE' AND NEW.is_test_account IS DISTINCT FROM OLD.is_test_account) THEN
    -- Identidad de la app: un rol de la API, o el JWT de una petición (sigue
    -- puesto dentro de una función SECURITY DEFINER). El SQL editor no tiene
    -- ninguna de las dos.
    IF current_user IN ('anon', 'authenticated', 'service_role')
       OR auth.uid() IS NOT NULL
       OR COALESCE(auth.jwt() ->> 'role', '') <> '' THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'profiles.is_test_account can only be changed from the Supabase SQL editor.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_profiles_test_account() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_profiles_test_account
  BEFORE INSERT OR UPDATE OF is_test_account ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_test_account();


-- ── 3. Quién es de prueba ───────────────────────────────────

CREATE FUNCTION public.is_test_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.company_members m
      JOIN public.profiles p ON p.id = m.user_id
     WHERE m.company_id = p_company_id
       AND p.is_test_account
  )
$$;

-- Quien mira: su cuenta está marcada, o es miembro de una empresa de prueba.
-- Un visitante sin sesión, false.
CREATE FUNCTION public.is_test_viewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_test_account)
      OR EXISTS (SELECT 1 FROM public.company_members m
                  WHERE m.user_id = auth.uid() AND public.is_test_company(m.company_id))
$$;

-- Las evalúan las políticas y la vista con el rol de quien consulta, también
-- anon (que no ve filas, pero no debe recibir un error de permisos).
REVOKE ALL ON FUNCTION public.is_test_company(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_test_viewer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_test_company(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_test_viewer() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_test_company(uuid) IS
  'true when any member of the company has profiles.is_test_account (106).';
COMMENT ON FUNCTION public.is_test_viewer() IS
  'true when the current user is a test account or belongs to a test company (106). Test and real accounts do not see each other.';


-- ── 4. Búsqueda y mapa de técnicos ──────────────────────────
-- Igual que antes, columna por columna; sólo cambia la última condición.

CREATE OR REPLACE VIEW public.technician_public_view AS
 SELECT tp.id,
    tp.anonymous_code,
    tp.technician_type,
    lc.name AS country,
    tp.location_city_name AS city,
    tp.location_city_lat AS latitude,
    tp.location_city_lng AS longitude,
    tp.location_country_code,
    tp.location_city_name,
    tp.location_city_lat,
    tp.location_city_lng,
    tp.location_city_geoname_id,
    tp.availability,
    tp.verification_status,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.first_name
            ELSE NULL::text
        END AS first_name,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.last_name
            ELSE NULL::text
        END AS last_name,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.email
            ELSE NULL::text
        END AS email,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.phone
            ELSE NULL::text
        END AS phone,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.social_links
            ELSE NULL::jsonb
        END AS social_links,
    tp.years_experience,
        CASE
            WHEN offer_accepted_between(my_company_id(), tp.id) THEN tp.photo_path
            ELSE NULL::text
        END AS photo_path
   FROM technician_profiles tp
     JOIN location_countries lc ON lc.code = tp.location_country_code
     JOIN profiles p ON p.id = tp.user_id
  WHERE is_active_user() AND (p.status = ANY (ARRAY['active'::user_status, 'pending_verification'::user_status]))
    AND p.is_test_account = (SELECT public.is_test_viewer());


-- ── 5. Ofertas publicadas y empresas ────────────────────────

ALTER POLICY offers_select_published ON public.offers
  USING (is_active_user() AND status = 'published'::offer_status AND visible = true
         AND public.is_test_company(company_id) = (SELECT public.is_test_viewer()));

ALTER POLICY companies_select_all ON public.companies
  USING (is_active_user() AND verification_status = 'verified'::verification_status
         AND public.is_test_company(id) = (SELECT public.is_test_viewer()));


-- ── 6. Autoprueba ───────────────────────────────────────────

CREATE FUNCTION pg_temp.attempt_106(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_value text;
BEGIN
  EXECUTE statement INTO v_value;
  RETURN COALESCE(v_value, 'no rows');
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

-- Ejecuta una consulta como un usuario de la app (p_user NULL: sin sesión).
CREATE FUNCTION pg_temp.as_106(p_user uuid, p_role text, statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_result text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN jsonb_build_object('role', p_role)
         ELSE jsonb_build_object('sub', p_user, 'role', p_role) END::text, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  v_result := pg_temp.attempt_106(statement);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_result;
END $$;

-- >>> selftest 106
DO $selftest$
DECLARE
  v_country text; v_ctype text; v_contract text; v_rating uuid; v_accounts bigint;
  rtu uuid := gen_random_uuid();  -- técnico real
  ttu uuid := gen_random_uuid();  -- técnico de prueba (marcado)
  rcu uuid := gen_random_uuid();  -- admin de una empresa real
  tcu uuid := gen_random_uuid();  -- admin de una empresa de prueba (marcado)
  tvu uuid := gen_random_uuid();  -- viewer de la empresa de prueba, SIN marca
  adu uuid := gen_random_uuid();  -- admin de la plataforma
  sgu uuid := gen_random_uuid();  -- alta que intenta marcarse por metadatos
  rt uuid; tt uuid; rc uuid; tc uuid; ro uuid; tor uuid;
  q_techs text; q_offers text; q_reqs text; q_companies text; q_own text;
  names text[] := '{}'; oks boolean[] := '{}'; seen text[] := '{}';
  observed text; n bigint; failures text := ''; v_expected int := 0;
  i int;
BEGIN
  -- Estructura: siempre, haya datos o no.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'profiles'
                    AND column_name = 'is_test_account' AND is_nullable = 'NO'
                    AND data_type = 'boolean' AND column_default = 'false') THEN
    RAISE EXCEPTION '106 self-test failed: profiles.is_test_account is not boolean NOT NULL DEFAULT false';
  END IF;
  IF to_regprocedure('public.is_test_company(uuid)') IS NULL
     OR to_regprocedure('public.is_test_viewer()') IS NULL
     OR to_regprocedure('public.guard_profiles_test_account()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_profiles_test_account'
                       AND tgrelid = 'public.profiles'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION '106 self-test failed: missing functions or guard trigger';
  END IF;
  IF has_function_privilege('anon', 'public.guard_profiles_test_account()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_profiles_test_account()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.guard_profiles_test_account()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.is_test_company(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_test_company(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.is_test_viewer()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_test_viewer()', 'EXECUTE') THEN
    RAISE EXCEPTION '106 self-test failed: function privileges';
  END IF;
  IF position('is_test_viewer' IN pg_get_viewdef('public.technician_public_view'::regclass)) = 0
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'offers'
                       AND policyname = 'offers_select_published' AND qual LIKE '%is_test_company(company_id)%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'companies'
                       AND policyname = 'companies_select_all' AND qual LIKE '%is_test_company(id)%') THEN
    RAISE EXCEPTION '106 self-test failed: view or policies do not separate test accounts';
  END IF;

  SELECT count(*) INTO v_accounts FROM public.profiles;
  IF v_accounts = 0 THEN
    RAISE NOTICE '106 self-test: no accounts in this database, nothing to hide; behaviour is checked with the self-test''s own accounts.';
  ELSE
    RAISE NOTICE '106 self-test: % accounts in this database, % marked as test accounts.',
      v_accounts, (SELECT count(*) FROM public.profiles WHERE is_test_account);
  END IF;

  -- Comportamiento: con cuentas propias. Sólo necesita catálogos.
  SELECT code INTO v_country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
  SELECT code INTO v_ctype FROM company_types ORDER BY code LIMIT 1;
  SELECT code INTO v_contract FROM contract_types ORDER BY code LIMIT 1;
  SELECT id INTO v_rating FROM aircraft_type_ratings WHERE is_active AND product_type = 'Aeroplane' ORDER BY id LIMIT 1;
  IF v_country IS NULL OR v_ctype IS NULL OR v_contract IS NULL OR v_rating IS NULL
     OR NOT EXISTS (SELECT 1 FROM technician_types WHERE code = 'mechanic') THEN
    RAISE NOTICE '106 self-test: catalogs are empty (countries, company or contract types, mechanic, aeroplane ratings), behaviour checks skipped; structure checked.';
  ELSE
    v_expected := 22;
    BEGIN
      INSERT INTO auth.users (id, email, raw_user_meta_data, last_sign_in_at) VALUES
        (rtu, 'selftest-106-rt@example.invalid', '{"role":"technician"}', now()),
        (ttu, 'selftest-106-tt@example.invalid', '{"role":"technician"}', now()),
        (rcu, 'selftest-106-rc@example.invalid', '{"role":"company"}',    now()),
        (tcu, 'selftest-106-tc@example.invalid', '{"role":"company"}',    now()),
        (tvu, 'selftest-106-tv@example.invalid', '{"role":"company"}',    now()),
        (adu, 'selftest-106-ad@example.invalid', '{"role":"company"}',    now()),
        (sgu, 'selftest-106-sg@example.invalid', '{"role":"technician","is_test_account":true}', now());
      -- Las cuentas de empresa nacen pendientes: activarlas, como haría el
      -- admin, y convertir una en admin de la plataforma.
      UPDATE profiles SET status = 'active' WHERE id IN (rcu, tcu, tvu, adu);
      UPDATE profiles SET role = 'admin' WHERE id = adu;

      INSERT INTO technician_profiles (user_id, anonymous_code, first_name, last_name, email, birth_date,
                                       technician_type, location_country_code)
      VALUES (rtu, 'TS106' || left(replace(gen_random_uuid()::text, '-', ''), 6), 'Real', 'Selftest',
              'selftest-106-rt@example.invalid', DATE '1990-01-01', 'mechanic', v_country)
      RETURNING id INTO rt;
      INSERT INTO technician_profiles (user_id, anonymous_code, first_name, last_name, email, birth_date,
                                       technician_type, location_country_code)
      VALUES (ttu, 'TS106' || left(replace(gen_random_uuid()::text, '-', ''), 6), 'Test', 'Selftest',
              'selftest-106-tt@example.invalid', DATE '1990-01-01', 'mechanic', v_country)
      RETURNING id INTO tt;

      INSERT INTO companies (name, company_type, email, location_country_code, verification_status)
      VALUES ('selftest-106-real', v_ctype, 'selftest-106-c1@example.invalid', v_country, 'verified') RETURNING id INTO rc;
      INSERT INTO companies (name, company_type, email, location_country_code, verification_status)
      VALUES ('selftest-106-test', v_ctype, 'selftest-106-c2@example.invalid', v_country, 'verified') RETURNING id INTO tc;
      INSERT INTO company_members (company_id, user_id, role) VALUES
        (rc, rcu, 'admin'), (tc, tcu, 'admin'), (tc, tvu, 'viewer');

      INSERT INTO offers (company_id, title, description, contract_type, product_type, technician_type,
                          requires_certification, location_country, location_country_code, status, visible)
      VALUES (rc, 'selftest-106-real', 'rollback', v_contract, 'Aeroplane', 'mechanic', false, 'Selftest', v_country, 'published', true)
      RETURNING id INTO ro;
      INSERT INTO offers (company_id, title, description, contract_type, product_type, technician_type,
                          requires_certification, location_country, location_country_code, status, visible)
      VALUES (tc, 'selftest-106-test', 'rollback', v_contract, 'Aeroplane', 'mechanic', false, 'Selftest', v_country, 'published', true)
      RETURNING id INTO tor;
      INSERT INTO offer_required_habilitations (offer_id, aircraft_type_rating_id, product_type) VALUES
        (ro, v_rating, 'Aeroplane'), (tor, v_rating, 'Aeroplane');

      -- Marcar, como se hará desde el SQL editor (sin identidad de la app).
      UPDATE profiles SET is_test_account = true WHERE id IN (ttu, tcu);

      -- Cada consulta devuelve "lo real/lo de prueba": 1 = lo ve, 0 = no.
      q_techs := format('SELECT (SELECT count(*) FROM technician_public_view WHERE id = %L) || ''/'' || (SELECT count(*) FROM technician_public_view WHERE id = %L)', rt, tt);
      q_offers := format('SELECT (SELECT count(*) FROM offers WHERE id = %L) || ''/'' || (SELECT count(*) FROM offers WHERE id = %L)', ro, tor);
      q_reqs := format('SELECT (SELECT count(*) FROM offer_required_habilitations WHERE offer_id = %L) || ''/'' || (SELECT count(*) FROM offer_required_habilitations WHERE offer_id = %L)', ro, tor);
      q_companies := format('SELECT (SELECT count(*) FROM companies WHERE id = %L) || ''/'' || (SELECT count(*) FROM companies WHERE id = %L)', rc, tc);

      -- Empresa real.
      observed := pg_temp.as_106(rcu, 'authenticated', q_techs);
      names := array_append(names, 'search: a real company sees real technicians, not test ones');
      oks := oks || (observed = '1/0'); seen := seen || observed;
      observed := pg_temp.as_106(rcu, 'authenticated', format(
        'SELECT company_can_read_technician_qualifications(%L) || ''/'' || company_can_read_technician_qualifications(%L)', rt, tt));
      names := array_append(names, 'qualifications: a real company reads a real technician, not a test one');
      oks := oks || (observed = 'true/false'); seen := seen || observed;

      -- Empresa de prueba.
      observed := pg_temp.as_106(tcu, 'authenticated', q_techs);
      names := array_append(names, 'search: a test company sees test technicians, not real ones');
      oks := oks || (observed = '0/1'); seen := seen || observed;
      observed := pg_temp.as_106(tcu, 'authenticated', format(
        'SELECT company_can_read_technician_qualifications(%L) || ''/'' || company_can_read_technician_qualifications(%L)', rt, tt));
      names := array_append(names, 'qualifications: a test company reads a test technician, not a real one');
      oks := oks || (observed = 'false/true'); seen := seen || observed;
      observed := pg_temp.as_106(tvu, 'authenticated', q_techs);
      names := array_append(names, 'an unmarked member of a test company counts as test');
      oks := oks || (observed = '0/1'); seen := seen || observed;

      -- Técnico real.
      observed := pg_temp.as_106(rtu, 'authenticated', q_offers);
      names := array_append(names, 'offers: a real technician sees real offers, not test ones');
      oks := oks || (observed = '1/0'); seen := seen || observed;
      observed := pg_temp.as_106(rtu, 'authenticated', q_reqs);
      names := array_append(names, 'offer aircraft: a real technician reads real requirements, not test ones');
      oks := oks || (observed = '1/0'); seen := seen || observed;
      observed := pg_temp.as_106(rtu, 'authenticated', q_companies);
      names := array_append(names, 'companies: a real technician sees real companies, not test ones');
      oks := oks || (observed = '1/0'); seen := seen || observed;

      -- Técnico de prueba.
      observed := pg_temp.as_106(ttu, 'authenticated', q_offers);
      names := array_append(names, 'offers: a test technician sees test offers, not real ones');
      oks := oks || (observed = '0/1'); seen := seen || observed;
      observed := pg_temp.as_106(ttu, 'authenticated', q_reqs);
      names := array_append(names, 'offer aircraft: a test technician reads test requirements, not real ones');
      oks := oks || (observed = '0/1'); seen := seen || observed;
      observed := pg_temp.as_106(ttu, 'authenticated', q_companies);
      names := array_append(names, 'companies: a test technician sees test companies, not real ones');
      oks := oks || (observed = '0/1'); seen := seen || observed;

      -- Cada empresa sigue viendo lo suyo: "su oferta/su empresa".
      q_own := 'SELECT (SELECT count(*) FROM offers WHERE company_id = my_company_id()) || ''/'' || (SELECT count(*) FROM companies WHERE id = my_company_id())';
      observed := pg_temp.as_106(rcu, 'authenticated', q_own);
      names := array_append(names, 'a real company still sees its own offer and company');
      oks := oks || (observed = '1/1'); seen := seen || observed;
      observed := pg_temp.as_106(tcu, 'authenticated', q_own) || '|' || pg_temp.as_106(tvu, 'authenticated', q_own);
      names := array_append(names, 'a test company (marked and unmarked members) sees its own offer and company');
      oks := oks || (observed = '1/1|1/1'); seen := seen || observed;

      -- El admin de la plataforma ve los dos mundos.
      observed := pg_temp.as_106(adu, 'authenticated', format(
        'SELECT (SELECT count(*) FROM offers WHERE id IN (%L, %L)) || ''/'' || (SELECT count(*) FROM companies WHERE id IN (%L, %L)) || ''/'' || (SELECT count(*) FROM technician_profiles WHERE id IN (%L, %L))',
        ro, tor, rc, tc, rt, tt));
      names := array_append(names, 'platform admin sees both worlds');
      oks := oks || (observed = '2/2/2'); seen := seen || observed;

      -- Sin sesión: nada, y sin errores de permisos.
      observed := pg_temp.as_106(NULL, 'anon', format(
        'SELECT (SELECT count(*) FROM technician_public_view WHERE id IN (%L, %L)) || ''/'' || (SELECT count(*) FROM offers WHERE id IN (%L, %L)) || ''/'' || (SELECT count(*) FROM companies WHERE id IN (%L, %L))',
        rt, tt, ro, tor, rc, tc));
      names := array_append(names, 'anonymous visitors get no rows and no error');
      oks := oks || (observed = '0/0/0'); seen := seen || observed;

      -- La marca no se cambia desde la app.
      observed := pg_temp.as_106(adu, 'authenticated', format(
        'UPDATE profiles SET is_test_account = true WHERE id = %L RETURNING ''updated''', rtu));
      names := array_append(names, 'guard: a platform admin cannot change the mark from the app');
      oks := oks || (observed LIKE '42501:profiles.is_test_account can only be changed%'); seen := seen || observed;
      observed := pg_temp.as_106(NULL, 'service_role', format(
        'UPDATE profiles SET is_test_account = false WHERE id = %L RETURNING ''updated''', ttu));
      names := array_append(names, 'guard: the service role (edge functions) cannot change the mark');
      oks := oks || (observed LIKE '42501:profiles.is_test_account can only be changed%'); seen := seen || observed;
      observed := pg_temp.as_106(ttu, 'authenticated', format(
        'UPDATE profiles SET is_test_account = false WHERE id = %L RETURNING ''updated''', ttu))
        || '|' || pg_temp.as_106(rcu, 'authenticated', format(
        'UPDATE profiles SET is_test_account = true WHERE id = %L RETURNING ''updated''', rcu));
      SELECT count(*) INTO n FROM profiles WHERE (id = ttu AND is_test_account) OR (id = rcu AND NOT is_test_account);
      names := array_append(names, 'guard: an account cannot mark or unmark itself');
      oks := oks || (observed = 'no rows|no rows' AND n = 2); seen := seen || (observed || ' ' || n::text);
      SELECT count(*) INTO n FROM profiles WHERE id = sgu AND NOT is_test_account;
      names := array_append(names, 'guard: signup metadata cannot mark an account');
      oks := oks || (n = 1); seen := seen || n::text;
      SELECT count(*) INTO n FROM profiles WHERE id IN (rtu, ttu, rcu, tcu, tvu, adu, sgu) AND is_test_account;
      names := array_append(names, 'new accounts start unmarked: only the two marked by SQL are test accounts');
      oks := oks || (n = 2); seen := seen || n::text;

      -- Desde el SQL editor se quita y se vuelve a poner.
      UPDATE profiles SET is_test_account = false WHERE id = ttu;
      observed := split_part(pg_temp.as_106(rcu, 'authenticated', q_techs), '/', 2);
      UPDATE profiles SET is_test_account = true WHERE id = ttu;
      observed := observed || '/' || split_part(pg_temp.as_106(rcu, 'authenticated', q_techs), '/', 2);
      names := array_append(names, 'SQL editor: unmarking shows a technician to real companies, marking hides it again');
      oks := oks || (observed = '1/0'); seen := seen || observed;
      UPDATE profiles SET is_test_account = false WHERE id = tcu;
      observed := split_part(pg_temp.as_106(rtu, 'authenticated', q_companies), '/', 2);
      UPDATE profiles SET is_test_account = true WHERE id = tcu;
      observed := observed || '/' || split_part(pg_temp.as_106(rtu, 'authenticated', q_companies), '/', 2);
      names := array_append(names, 'a company is a test company only while one of its members is marked');
      oks := oks || (observed = '1/0'); seen := seen || observed;

      RAISE EXCEPTION USING ERRCODE = 'P0106', MESSAGE = 'undo selftest 106';
    EXCEPTION WHEN SQLSTATE 'P0106' THEN
      NULL;
    END;
  END IF;

  -- Fuera del bloque revertido: el ensayo deja preparada esta tabla temporal
  -- para leer cada caso; al aplicar la migración no existe.
  IF to_regclass('pg_temp.selftest_106_results') IS NOT NULL THEN
    EXECUTE 'INSERT INTO pg_temp.selftest_106_results (test, passed, observed) SELECT * FROM unnest($1, $2, $3)'
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
    RAISE EXCEPTION '106 self-test failed: %', failures;
  END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE name LIKE 'selftest-106%')
     OR EXISTS (SELECT 1 FROM profiles WHERE email LIKE 'selftest-106-%@example.invalid')
     OR EXISTS (SELECT 1 FROM auth.users WHERE email LIKE 'selftest-106-%@example.invalid') THEN
    RAISE EXCEPTION '106 self-test failed: fixtures were left behind';
  END IF;
  RAISE NOTICE '106 self-test: % cases passed', coalesce(array_length(names, 1), 0);
END $selftest$;
-- <<< selftest 106

DROP FUNCTION pg_temp.as_106(uuid, text, text);
DROP FUNCTION pg_temp.attempt_106(text);

NOTIFY pgrst, 'reload schema';
