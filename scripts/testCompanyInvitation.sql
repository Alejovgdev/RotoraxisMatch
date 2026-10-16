-- Run through testCompanyInvitation.cjs. Simula la invitación a un email nuevo
-- (lo que hacen GoTrue y la función invite-company-member) y el PRIMER inicio
-- de sesión del invitado, todo dentro de esta transacción, que se revierte. No
-- envía correos ni inicia sesión en la app.
--
-- app.invite_signup_role: el rol que la función manda en los metadatos al
-- invitar; el runner lo lee del código de la función.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE invite_results(test text, passed boolean, observed text);
GRANT ALL ON invite_results TO authenticated, service_role;
CREATE FUNCTION pg_temp.check_invite(label text, ok boolean, observed text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO invite_results VALUES (label, coalesce(ok, false), observed)
$$;
CREATE FUNCTION pg_temp.attempt_invite(statement text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

DO $test$
DECLARE
  invite_role text := current_setting('app.invite_signup_role');
  admin_u uuid := gen_random_uuid();   -- admin que invita (ya ha entrado)
  inv_u   uuid := gen_random_uuid();   -- invitado: email nuevo
  legacy_u uuid := gen_random_uuid();  -- lo que mandaba la función antes del arreglo
  tech_u  uuid := gen_random_uuid();   -- controles de la 102
  comp_u  uuid := gen_random_uuid();
  cid uuid; v_ctype text; v_country text;
  observed text; st text; n bigint; companies_before bigint;
BEGIN
  SELECT code INTO v_ctype FROM company_types ORDER BY code LIMIT 1;
  SELECT code INTO v_country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
  IF v_ctype IS NULL OR v_country IS NULL THEN
    RAISE EXCEPTION 'Invitation tests require company type and country catalogs';
  END IF;

  -- La empresa que invita, verificada, con su admin.
  INSERT INTO auth.users (id, email, raw_user_meta_data, last_sign_in_at)
  VALUES (admin_u, 'invite-test-admin@example.invalid', '{"role":"company"}', now());
  INSERT INTO companies (name, company_type, email, location_country_code, verification_status)
  VALUES ('invite-test-company', v_ctype, 'invite-test-company@example.invalid', v_country, 'verified') RETURNING id INTO cid;
  INSERT INTO company_members (company_id, user_id, role) VALUES (cid, admin_u, 'admin');
  SELECT count(*) INTO companies_before FROM companies;

  -- 1. El fallo de hoy: la 102 rechaza el rol antiguo (y lo sigue rechazando).
  observed := pg_temp.attempt_invite(format(
    'INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%L, %L, %L)',
    legacy_u, 'invite-test-legacy@example.invalid', '{"role":"company_user"}'));
  PERFORM pg_temp.check_invite('the database still rejects the old company_user signup role (102)',
    observed LIKE '22023:%', observed);

  -- 2. GoTrue crea la cuenta del invitado con los metadatos que manda la función.
  observed := pg_temp.attempt_invite(format(
    'INSERT INTO auth.users (id, email, raw_user_meta_data, invited_at) VALUES (%L, %L, %L, now())',
    inv_u, 'invite-test-member@example.invalid', jsonb_build_object('role', invite_role)));
  PERFORM pg_temp.check_invite(format('the invitation signup role "%s" is accepted', invite_role),
    observed = 'OK', observed);
  SELECT role || '/' || status INTO st FROM profiles WHERE id = inv_u;
  PERFORM pg_temp.check_invite('the invited account starts as a pending company account',
    st = 'company_user/pending_verification', coalesce(st, 'no profile'));

  -- 3. La función, con service_role: activa el perfil y lo añade al equipo.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  observed := pg_temp.attempt_invite(format(
    'INSERT INTO profiles (id, email, role, status) VALUES (%L, %L, %L, %L) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, status = EXCLUDED.status',
    inv_u, 'invite-test-member@example.invalid', 'company_user', 'active'));
  PERFORM pg_temp.check_invite('the function activates the invited profile', observed = 'OK', observed);
  observed := pg_temp.attempt_invite(format(
    'INSERT INTO company_members (company_id, user_id, role) VALUES (%L, %L, %L)', cid, inv_u, 'recruiter'));
  PERFORM pg_temp.check_invite('the function adds the invited member to the inviting company', observed = 'OK', observed);
  RESET ROLE;

  -- 4. Primer inicio de sesión del invitado, con su propia sesión.
  UPDATE auth.users SET last_sign_in_at = now(), email_confirmed_at = now() WHERE id = inv_u;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', inv_u, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- AuthContext.ensureRoleProfile: con metadatos de empresa busca su fila en
  -- company_members y sólo llama a signup_company si NO la encuentra.
  SELECT count(*) INTO n FROM company_members WHERE user_id = inv_u;
  PERFORM pg_temp.check_invite('first sign-in finds the membership, so the app skips company signup', n = 1, n::text);
  -- El destino lo decide el perfil (routeForProfile / roleHomeRoute).
  SELECT role || '/' || status INTO st FROM profiles WHERE id = inv_u;
  PERFORM pg_temp.check_invite('first sign-in profile is an active company account (goes to /company)',
    st = 'company_user/active', coalesce(st, 'not visible'));
  -- El área de empresa carga la empresa por la membresía.
  SELECT c.name || '/' || m.role INTO st
    FROM company_members m JOIN companies c ON c.id = m.company_id WHERE m.user_id = inv_u;
  PERFORM pg_temp.check_invite('the invited member lands in the inviting company with the invited role',
    st = 'invite-test-company/recruiter', coalesce(st, 'not visible'));
  -- Aunque la app llamara al alta de empresa, no puede darle otra.
  observed := pg_temp.attempt_invite(format('SELECT public.signup_company(%L, %L, %L)', 'Second company', v_ctype, v_country));
  PERFORM pg_temp.check_invite('company signup cannot give the invited member a second company',
    observed <> 'OK', observed);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO n FROM companies;
  PERFORM pg_temp.check_invite('no company was created by the invitation or the first sign-in',
    n = companies_before, (n - companies_before)::text);
  SELECT count(*) INTO n FROM company_members WHERE user_id = inv_u;
  PERFORM pg_temp.check_invite('the invited member still belongs only to the inviting company', n = 1, n::text);

  -- 5. Lo que hizo la 102 no cambia.
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (tech_u, 'invite-test-tech@example.invalid', '{"role":"technician"}'),
    (comp_u, 'invite-test-signup@example.invalid', '{"role":"company"}');
  SELECT role || '/' || status INTO st FROM profiles WHERE id = tech_u;
  PERFORM pg_temp.check_invite('a new technician still starts active (102)', st = 'technician/active', coalesce(st, 'none'));
  SELECT role || '/' || status INTO st FROM profiles WHERE id = comp_u;
  PERFORM pg_temp.check_invite('a new company signup still waits for verification (102)',
    st = 'company_user/pending_verification', coalesce(st, 'none'));
END $test$;

SELECT test, passed, observed FROM invite_results;
ROLLBACK;
