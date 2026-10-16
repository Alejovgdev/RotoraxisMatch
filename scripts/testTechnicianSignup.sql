-- Run through testTechnicianSignup.cjs. All fixtures and audit reproductions
-- are rolled back; no real signup, email or app login is performed.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE signup_results(kind text, test text, passed boolean, observed text);
GRANT ALL ON signup_results TO authenticated;
CREATE TEMP TABLE signup_fixture(user_id uuid, technician_id uuid);
CREATE FUNCTION pg_temp.check_signup(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Signup test failed: %', label; END IF;
  INSERT INTO signup_results VALUES ('test', label, true, 'OK');
END $$;
CREATE FUNCTION pg_temp.attempt_signup(statement text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

DO $test$
DECLARE
  secure boolean:=coalesce(current_setting('app.signup_roles_secure',true),'false')::boolean;
  tu uuid := gen_random_uuid(); cu uuid := gen_random_uuid(); au uuid := gen_random_uuid();
  fallback_u uuid := gen_random_uuid(); old_u uuid := gen_random_uuid();
  active_company_u uuid := gen_random_uuid(); spoof_u uuid := gen_random_uuid();
  tid uuid; old_tid uuid; company_tid uuid; fallback_tid uuid; cid uuid; bypass_cid uuid;
  country text; company_type text; contract text; observed text; n integer;
BEGIN
  SELECT code INTO country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
  SELECT code INTO company_type FROM company_types ORDER BY code LIMIT 1;
  SELECT code INTO contract FROM contract_types ORDER BY code LIMIT 1;
  IF country IS NULL OR company_type IS NULL OR contract IS NULL THEN
    RAISE EXCEPTION 'Signup tests require country, company type and contract catalogs';
  END IF;

  -- Exercise the actual auth.users INSERT trigger, including untrusted metadata.
  INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
    (tu, tu || '@example.invalid', '{"role":"technician","status":"suspended"}'),
    (cu, cu || '@example.invalid', jsonb_build_object('role',CASE WHEN secure THEN 'company' ELSE 'company_user' END,'status','active')),
    (fallback_u, fallback_u || '@example.invalid', CASE WHEN secure THEN '{"role":"technician"}'::jsonb ELSE '{}'::jsonb END);
  IF secure THEN
    observed:=pg_temp.attempt_signup(format('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(%L,%L,%L)',
      spoof_u,spoof_u||'@example.invalid','{"role":"admin"}'));
  ELSE
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(spoof_u,spoof_u||'@example.invalid','{"role":"admin"}');
  END IF;
  PERFORM pg_temp.check_signup('new technician account is active',
    (SELECT role='technician' AND status='active' FROM profiles WHERE id=tu));
  PERFORM pg_temp.check_signup('new company account stays pending even with active metadata',
    (SELECT role='company_user' AND status='pending_verification' FROM profiles WHERE id=cu));
  PERFORM pg_temp.check_signup('explicit technician or legacy fallback keeps technician access',
    (SELECT role='technician' AND status='active' FROM profiles WHERE id=fallback_u));
  PERFORM pg_temp.check_signup('non-technician role is not auto-activated',
    CASE WHEN secure THEN observed LIKE '22023:%' AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=spoof_u)
    ELSE (SELECT status='pending_verification' FROM profiles WHERE id=spoof_u) END);

  INSERT INTO profiles(id,email,role,status) VALUES
    (au, au || '@example.invalid', 'admin', 'active'),
    (old_u, old_u || '@example.invalid', 'technician', 'pending_verification'),
    (active_company_u, active_company_u || '@example.invalid', 'company_user', 'active');

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  tid := signup_technician('Signup','Test',DATE '1990-01-01','mechanic',country);
  PERFORM pg_temp.check_signup('technician profile is verified on creation',
    (SELECT verification_status='verified' FROM technician_profiles WHERE id=tid));
  PERFORM pg_temp.check_signup('signup retry returns the existing profile',
    signup_technician('Signup','Test',DATE '1990-01-01','mechanic',country)=tid);
  UPDATE technician_profiles SET first_name='Edited' WHERE id=tid;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.check_signup('new technician can edit their profile', n=1);
  PERFORM pg_temp.check_signup('new technician passes the active-user access check',is_active_user());
  UPDATE profiles SET role='company_user' WHERE id=tu;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.check_signup('client cannot change stored account role',n=0);
  observed := pg_temp.attempt_signup(format(
    'UPDATE technician_profiles SET verification_status=''pending'' WHERE id=%L',tid));
  PERFORM pg_temp.check_signup('technician cannot change protected verification state',
    observed LIKE '%Updating technician_profiles.verification_status is not permitted%');
  RESET ROLE;
  -- Bypass RLS as the test connection, but retain the user's JWT: the separate
  -- UPDATE trigger must still reject changes to protected fields.
  observed := pg_temp.attempt_signup(format('UPDATE profiles SET role=''company_user'' WHERE id=%L',tu));
  PERFORM pg_temp.check_signup('protected-field trigger also rejects role changes',
    observed LIKE '%Updating profiles.role is not permitted%');
  observed := pg_temp.attempt_signup(format('UPDATE profiles SET status=''suspended'' WHERE id=%L',tu));
  PERFORM pg_temp.check_signup('protected-field trigger still protects account status',
    observed LIKE '%Updating profiles.status is not permitted%');

  -- Auth metadata can change without changing the authoritative profiles row.
  UPDATE auth.users SET raw_user_meta_data='{"role":"company_user"}' WHERE id=tu;
  PERFORM pg_temp.check_signup('changing auth metadata does not change stored role or active status',
    (SELECT role='technician' AND status='active' FROM profiles WHERE id=tu));

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',fallback_u,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO technician_profiles(user_id,anonymous_code,first_name,last_name,email,birth_date,
    technician_type,location_country_code,verification_status)
  VALUES(fallback_u,'T'||left(replace(fallback_u::text,'-',''),9),'Forced','Defaults',
    fallback_u||'@example.invalid',DATE '1990-01-01','mechanic',country,'rejected') RETURNING id INTO fallback_tid;
  PERFORM pg_temp.check_signup('server forces verified for a new active technician regardless of client input',
    (SELECT verification_status='verified' FROM technician_profiles WHERE id=fallback_tid));
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  cid := signup_company('Signup company',company_type,country);
  PERFORM pg_temp.check_signup('company account fails the active-user access check',NOT is_active_user());
  RESET ROLE;
  PERFORM pg_temp.check_signup('company profile remains pending',
    (SELECT verification_status='pending' FROM companies WHERE id=cid));

  -- Old pending accounts may only create their role profile after a delayed
  -- email confirmation. They must not acquire automatic verification then.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',old_u,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  old_tid := signup_technician('Old','Pending',DATE '1990-01-01','mechanic',country);
  RESET ROLE;
  PERFORM pg_temp.check_signup('older pending technician account stays pending',
    (SELECT status='pending_verification' FROM profiles WHERE id=old_u));
  PERFORM pg_temp.check_signup('delayed profile of an older pending technician stays pending',
    (SELECT verification_status='pending' FROM technician_profiles WHERE id=old_tid));

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',active_company_u,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  IF secure THEN
    observed:=pg_temp.attempt_signup(format(
      'INSERT INTO technician_profiles(user_id,anonymous_code,first_name,last_name,email,birth_date,technician_type,location_country_code,verification_status) VALUES(%L,%L,''Company'',''Role'',%L,''1990-01-01'',''mechanic'',%L,''verified'')',
      active_company_u,'T'||left(replace(active_company_u::text,'-',''),9),active_company_u||'@example.invalid',country));
  ELSE
  INSERT INTO technician_profiles(user_id,anonymous_code,first_name,last_name,email,birth_date,
    technician_type,location_country_code,verification_status)
  VALUES(active_company_u,'T'||left(replace(active_company_u::text,'-',''),9),'Company','Role',
    active_company_u||'@example.invalid',DATE '1990-01-01','mechanic',country,'verified') RETURNING id INTO company_tid;
  END IF;
  RESET ROLE;
  PERFORM pg_temp.check_signup('active company role does not get an auto-verified technician profile',
    CASE WHEN secure THEN observed LIKE '42501:%' AND NOT EXISTS(SELECT 1 FROM technician_profiles WHERE user_id=active_company_u)
    ELSE (SELECT verification_status='pending' FROM technician_profiles WHERE id=company_tid) END);

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check_signup('admin can see the auto-verified technician',
    EXISTS(SELECT 1 FROM technician_profiles WHERE id=tid));
  PERFORM admin_update_technician_verification(tid,'rejected');
  PERFORM pg_temp.check_signup('admin rejection suspends the new technician',
    (SELECT status='suspended' FROM profiles WHERE id=tu));
  PERFORM pg_temp.check_signup('admin rejection changes verification to rejected',
    (SELECT verification_status='rejected' FROM technician_profiles WHERE id=tid));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check_signup('suspended technician fails the access check',NOT is_active_user());
  PERFORM pg_temp.check_signup('signup retry does not reactivate a suspended technician',
    signup_technician('Signup','Test',DATE '1990-01-01','mechanic',country)=tid AND NOT is_active_user());
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM admin_update_technician_verification(tid,'verified');
  PERFORM pg_temp.check_signup('admin can restore technician access',
    (SELECT status='active' FROM profiles WHERE id=tu));
  RESET ROLE;
  INSERT INTO signup_fixture VALUES(tu,tid);

  -- Historical audit observations, only on the pre-102 behaviour.
  IF NOT secure THEN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',spoof_u,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO signup_results VALUES('audit','client-supplied admin role is trusted by is_admin()',NULL,is_admin()::text);
  UPDATE profiles SET status='active' WHERE id=spoof_u;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO signup_results VALUES('audit','client-supplied admin can self-activate through profiles RLS',NULL,(n=1 AND is_active_user())::text);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed := pg_temp.attempt_signup(format('SELECT signup_company(''Role audit'',%L,%L)',company_type,country));
  RESET ROLE;
  SELECT company_id INTO bypass_cid FROM company_members WHERE user_id=tu LIMIT 1;
  INSERT INTO signup_results VALUES('audit','active technician can call signup_company()',NULL,observed);
  SET LOCAL ROLE authenticated;
  IF bypass_cid IS NOT NULL THEN
    observed := pg_temp.attempt_signup(format(
      'INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,location_country,location_country_code) VALUES(%L,''Role audit'',''rollback'',%L,''Aeroplane'',''mechanic'',false,''Test'',%L)',
      bypass_cid,contract,country));
    INSERT INTO signup_results VALUES('audit','technician can write an offer for that pending company',NULL,observed);
  END IF;
  RESET ROLE;
  END IF;
END $test$;

SELECT kind,test,passed,observed FROM signup_results;
ROLLBACK;
