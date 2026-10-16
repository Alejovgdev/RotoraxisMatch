-- Fixture-only security reproductions. Never creates a real Auth session.
BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE role_results(test text,passed boolean,observed text);
GRANT ALL ON role_results TO authenticated;
CREATE FUNCTION pg_temp.check_role(label text,ok boolean,detail text DEFAULT 'OK')
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Role test failed: % (%)',label,detail; END IF;
  INSERT INTO role_results VALUES(label,true,detail);
END $$;
CREATE FUNCTION pg_temp.attempt_role(statement text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE statement; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM; END $$;

DO $test$
DECLARE
  secure boolean:=coalesce(current_setting('app.signup_roles_secure',true),'true')::boolean;
  offer_guard boolean:=coalesce(current_setting('app.company_offer_guard_secure',true),'false')::boolean;
  tu uuid:=gen_random_uuid(); cu uuid:=gen_random_uuid(); au uuid:=gen_random_uuid();
  spoof uuid:=gen_random_uuid(); invalid_u uuid; missing_u uuid:=gen_random_uuid();
  tid uuid; cid uuid; company_tid uuid; offer_id uuid; country text; ctype text; contract text;
  input jsonb; observed text; before_companies bigint; before_members bigint; n integer;
BEGIN
  SELECT code INTO country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
  SELECT code INTO ctype FROM company_types ORDER BY code LIMIT 1;
  SELECT code INTO contract FROM contract_types ORDER BY code LIMIT 1;
  IF country IS NULL OR ctype IS NULL OR contract IS NULL THEN RAISE EXCEPTION 'Missing signup catalogs'; END IF;

  observed:=pg_temp.attempt_role(format('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(%L,%L,%L)',
    spoof,spoof||'@example.invalid','{"role":"admin"}'));
  PERFORM pg_temp.check_role('client admin signup rejected (baseline reproduces acceptance)',
    CASE WHEN secure THEN observed LIKE '22023:%' ELSE observed='OK' END,observed);
  PERFORM pg_temp.check_role('rejected admin signup leaves neither Auth user nor profile',
    CASE WHEN secure THEN NOT EXISTS(SELECT 1 FROM auth.users WHERE id=spoof)
      AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=spoof)
    ELSE EXISTS(SELECT 1 FROM profiles WHERE id=spoof AND role='admin') END);
  IF NOT secure THEN
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',spoof,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    UPDATE profiles SET status='active' WHERE id=spoof;
    GET DIAGNOSTICS n=ROW_COUNT;
    PERFORM pg_temp.check_role('baseline: forged admin can self-activate',n=1 AND is_admin() AND is_active_user());
    RESET ROLE;
  END IF;

  IF secure THEN
    FOR input IN SELECT value FROM jsonb_array_elements('[{}, {"role":null}, {"role":""},
      {"role":"company_user"}, {"role":"ADMIN"}, {"role":"admin "}, {"role":"unknown"},
      {"role":true}, {"role":["technician"]}, {"role":{"name":"technician"}}]'::jsonb) LOOP
      invalid_u:=gen_random_uuid();
      observed:=pg_temp.attempt_role(format('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(%L,%L,%L)',
        invalid_u,invalid_u||'@example.invalid',input));
      PERFORM pg_temp.check_role('invalid signup metadata rejected: '||input::text,observed LIKE '22023:%',observed);
      PERFORM pg_temp.check_role('invalid signup leaves no rows: '||input::text,
        NOT EXISTS(SELECT 1 FROM auth.users WHERE id=invalid_u) AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=invalid_u));
    END LOOP;
  END IF;

  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (tu,tu||'@example.invalid','{"role":"technician"}'),
    (cu,cu||'@example.invalid',jsonb_build_object('role',CASE WHEN secure THEN 'company' ELSE 'company_user' END));
  INSERT INTO profiles(id,email,role,status) VALUES(au,au||'@example.invalid','admin','active');
  PERFORM pg_temp.check_role('technician still starts active',
    (SELECT role='technician' AND status='active' FROM profiles WHERE id=tu));
  PERFORM pg_temp.check_role('company role stored as company_user and stays pending',
    (SELECT role='company_user' AND status='pending_verification' FROM profiles WHERE id=cu));

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  tid:=signup_technician('Role','Test',DATE '1990-01-01','mechanic',country);
  PERFORM pg_temp.check_role('technician remains automatically verified',
    (SELECT verification_status='verified' FROM technician_profiles WHERE id=tid));
  RESET ROLE;
  SELECT count(*) INTO before_companies FROM companies;
  SELECT count(*) INTO before_members FROM company_members;
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt_role(format('SELECT signup_company(''Wrong role'',%L,%L)',ctype,country));
  PERFORM pg_temp.check_role('technician cannot create company (baseline reproduces bypass)',
    CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed='OK' END,observed);
  RESET ROLE;
  PERFORM pg_temp.check_role('rejected company creation leaves no company or membership',
    CASE WHEN secure THEN (SELECT count(*) FROM companies)=before_companies
      AND (SELECT count(*) FROM company_members)=before_members
    ELSE EXISTS(SELECT 1 FROM company_members WHERE user_id=tu) END);

  UPDATE auth.users SET raw_user_meta_data='{"role":"company"}' WHERE id=tu;
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt_role(format('SELECT signup_company(''Metadata bypass'',%L,%L)',ctype,country));
  PERFORM pg_temp.check_role('editing metadata cannot bypass company role check',
    CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed LIKE '23505:%' END,observed);
  RESET ROLE;
  PERFORM pg_temp.check_role('metadata edit leaves authoritative role unchanged',
    (SELECT role='technician' AND status='active' FROM profiles WHERE id=tu));

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  cid:=signup_company('Pending company',ctype,country);
  RESET ROLE;
  PERFORM pg_temp.check_role('legitimate company can create its pending company profile',
    EXISTS(SELECT 1 FROM companies WHERE id=cid AND verification_status='pending')
    AND EXISTS(SELECT 1 FROM company_members WHERE company_id=cid AND user_id=cu AND role='admin'));
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt_role(format('SELECT signup_technician(''Wrong'',''Role'',''1990-01-01'',''mechanic'',%L)',country));
  PERFORM pg_temp.check_role('company cannot create technician profile through RPC',
    CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed='OK' END,observed);
  RESET ROLE;

  -- Owner requested an observation before changing offer authorization.
  -- A pending ACCOUNT cannot create offers. A pending COMPANY with an active
  -- account could before 103. That later migration now blocks it as well.
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt_role(format(
    'INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,location_country,location_country_code) VALUES(%L,''Pending audit'',''rollback'',%L,''Aeroplane'',''mechanic'',false,''Test'',%L)',cid,contract,country));
  PERFORM pg_temp.check_role('pending account cannot create offers',observed LIKE '42501:%',observed);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
  UPDATE profiles SET status='active' WHERE id=cu;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  IF offer_guard THEN
    observed:=pg_temp.attempt_role(format(
      'INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,location_country,location_country_code) VALUES(%L,''Pending audit'',''rollback'',%L,''Aeroplane'',''mechanic'',false,''Test'',%L)',cid,contract,country));
    PERFORM pg_temp.check_role('active account cannot create offers for pending company',observed LIKE '42501:%',observed);
    RESET ROLE;
    -- Existing pre-rejection offer, inserted only by the privileged test setup.
    INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,
      requires_certification,location_country,location_country_code)
    VALUES(cid,'Pending audit','rollback',contract,'Aeroplane','mechanic',false,'Test',country) RETURNING id INTO offer_id;
    SET LOCAL ROLE authenticated;
  ELSE
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,
    requires_certification,location_country,location_country_code)
  VALUES(cid,'Pending audit','rollback',contract,'Aeroplane','mechanic',false,'Test',country) RETURNING id INTO offer_id;
  PERFORM pg_temp.check_role('UNCHANGED: active account can create offers for pending company',offer_id IS NOT NULL);
  END IF;
  observed:=pg_temp.attempt_role(format('SELECT update_offer_with_habilitations(%L,''{"title":"Pending audit edited"}'')',offer_id));
  PERFORM pg_temp.check_role('pending company edit RPC is denied',
    CASE WHEN offer_guard THEN observed LIKE '42501:%' ELSE observed LIKE '23503:%' END,observed);
  IF secure THEN
    observed:=pg_temp.attempt_role(format(
      'INSERT INTO technician_profiles(user_id,anonymous_code,first_name,last_name,email,birth_date,technician_type,location_country_code) VALUES(%L,%L,''Wrong'',''Role'',%L,''1990-01-01'',''mechanic'',%L)',
      cu,'T'||left(replace(cu::text,'-',''),9),cu||'@example.invalid',country));
    PERFORM pg_temp.check_role('company cannot create technician profile by direct INSERT',observed LIKE '42501:%',observed);
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt_role(format('SELECT signup_company(''Admin business role'',%L,%L)',ctype,country));
  IF secure THEN PERFORM pg_temp.check_role('platform admin cannot register a company with its admin account',observed LIKE '42501:%',observed); END IF;
  PERFORM pg_temp.check_role('manually provisioned admin retains admin permissions',is_admin());
  PERFORM admin_update_technician_verification(tid,'rejected');
  PERFORM pg_temp.check_role('admin can still suspend technician',(SELECT status='suspended' FROM profiles WHERE id=tu));
  PERFORM admin_update_technician_verification(tid,'verified');
  PERFORM pg_temp.check_role('admin can still approve technician',(SELECT status='active' FROM profiles WHERE id=tu));
  RESET ROLE;

  IF secure THEN
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',missing_u,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    observed:=pg_temp.attempt_role(format('SELECT signup_company(''Missing profile'',%L,%L)',ctype,country));
    PERFORM pg_temp.check_role('missing authoritative profile cannot create company',observed LIKE '42501:%',observed);
    RESET ROLE;
  END IF;
END $test$;
SELECT test,passed,observed FROM role_results;
ROLLBACK;
