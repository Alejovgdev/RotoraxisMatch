-- Fixture-only RLS tests; run with testCompanyOfferWrites.cjs.
BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE company_offer_results(test text,passed boolean,observed text);
GRANT ALL ON company_offer_results TO authenticated;
CREATE FUNCTION pg_temp.check_company_offer(label text,ok boolean,detail text DEFAULT 'OK')
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Company offer test failed: % (%)',label,detail; END IF;
  INSERT INTO company_offer_results VALUES(label,true,detail);
END $$;
CREATE FUNCTION pg_temp.attempt_company_offer(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE statement; GET DIAGNOSTICS n=ROW_COUNT; RETURN 'OK:'||n;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM; END $$;

DO $test$
DECLARE
  secure boolean:=coalesce(current_setting('app.company_offer_guard_secure',true),'true')::boolean;
  au uuid:=gen_random_uuid(); vu uuid:=gen_random_uuid(); ru uuid:=gen_random_uuid(); xu uuid:=gen_random_uuid();
  owner_u uuid; cid uuid; approved_cid uuid; approved_o uuid; draft_o uuid; published_o uuid;
  rating uuid; country text; ctype text; contract text; company_status verification_status; offer_status text;
  observed text; insert_sql text; saved jsonb; requirements jsonb; new_offer uuid; n integer;
BEGIN
  SELECT code INTO country FROM location_countries WHERE is_active ORDER BY code LIMIT 1;
  SELECT code INTO ctype FROM company_types ORDER BY code LIMIT 1;
  SELECT code INTO contract FROM contract_types ORDER BY code LIMIT 1;
  SELECT id INTO rating FROM aircraft_type_ratings WHERE is_active AND product_type='Aeroplane' ORDER BY id LIMIT 1;
  IF country IS NULL OR ctype IS NULL OR contract IS NULL OR rating IS NULL THEN RAISE EXCEPTION 'Missing offer write catalogs'; END IF;
  INSERT INTO profiles(id,email,role,status) VALUES
    (au,au||'@example.invalid','admin','active'),
    (vu,vu||'@example.invalid','company_user','active'),
    (ru,ru||'@example.invalid','company_user','active'),
    (xu,xu||'@example.invalid','company_user','active');
  INSERT INTO companies(name,company_type,email,location_country_code,verification_status)
  VALUES('Offer guard approved',ctype,au||'@example.invalid',country,'verified') RETURNING id INTO approved_cid;
  INSERT INTO company_members(company_id,user_id,role) VALUES(approved_cid,ru,'recruiter'),(approved_cid,vu,'viewer');
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,location_country,location_country_code,status,visible)
  VALUES(approved_cid,'Approved fixture','rollback',contract,'Aeroplane','mechanic',false,'Test',country,'draft',false)
  RETURNING id INTO approved_o;
  INSERT INTO offer_required_habilitations(offer_id,product_type,aircraft_type_rating_id,notes)
  VALUES(approved_o,'Aeroplane',rating,'Approved requirement');

  FOREACH company_status IN ARRAY ARRAY['pending','rejected']::verification_status[] LOOP
    owner_u:=gen_random_uuid();
    INSERT INTO profiles(id,email,role,status) VALUES(owner_u,owner_u||'@example.invalid','company_user','active');
    INSERT INTO companies(name,company_type,email,location_country_code,verification_status)
    VALUES('Offer guard '||company_status::text,ctype,owner_u||'@example.invalid',country,company_status) RETURNING id INTO cid;
    INSERT INTO company_members(company_id,user_id,role) VALUES(cid,owner_u,'admin');
    -- Privileged fixture setup represents offers created before company rejection.
    INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,location_country,location_country_code,status,visible)
    VALUES(cid,'Existing draft','rollback',contract,'Aeroplane','mechanic',false,'Test',country,'draft',false) RETURNING id INTO draft_o;
    INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,location_country,location_country_code,status,visible)
    VALUES(cid,'Existing published','rollback',contract,'Aeroplane','mechanic',false,'Test',country,'published',true) RETURNING id INTO published_o;
    INSERT INTO offer_required_habilitations(offer_id,product_type,aircraft_type_rating_id,notes)
    VALUES(draft_o,'Aeroplane',rating,'Original requirement');
    SELECT jsonb_agg(to_jsonb(o) ORDER BY id) INTO saved FROM offers o WHERE id IN (draft_o,published_o);
    SELECT jsonb_agg(to_jsonb(h) ORDER BY offer_id,aircraft_type_rating_id) INTO requirements FROM offer_required_habilitations h WHERE offer_id IN (draft_o,published_o);

    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_u,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.check_company_offer(company_status||': account is active independently of company',is_active_user());
    PERFORM pg_temp.check_company_offer(company_status||': existing offers remain readable to their owner',
      (SELECT count(*)=2 FROM offers WHERE id IN (draft_o,published_o)));
    FOREACH offer_status IN ARRAY ARRAY['draft','published'] LOOP
      insert_sql:=format('INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,location_country,location_country_code,status,visible) VALUES(%L,''New attack'',''rollback'',%L,''Aeroplane'',''mechanic'',false,''Test'',%L,%L,true)',cid,contract,country,offer_status);
      observed:=pg_temp.attempt_company_offer(insert_sql);
      PERFORM pg_temp.check_company_offer(company_status||': cannot create '||offer_status,
        CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed='OK:1' END,observed);
    END LOOP;
    observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET title=''Changed'' WHERE id=%L',draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': cannot directly edit existing draft',
      observed=CASE WHEN secure THEN 'OK:0' ELSE 'OK:1' END,observed);
    observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET status=''published'',visible=true WHERE id=%L',draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': cannot directly publish existing draft',
      observed=CASE WHEN secure THEN 'OK:0' ELSE 'OK:1' END,observed);
    observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET description=''Changed published offer'' WHERE id=%L',published_o));
    PERFORM pg_temp.check_company_offer(company_status||': cannot edit an already published offer',
      observed=CASE WHEN secure THEN 'OK:0' ELSE 'OK:1' END,observed);
    observed:=pg_temp.attempt_company_offer(format('SELECT update_offer_with_habilitations(%L,''{"title":"RPC edit"}'')',draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': edit RPC is denied explicitly',
      CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed LIKE '23503:%' END,observed);
    observed:=pg_temp.attempt_company_offer(format('SELECT update_offer_with_habilitations(%L,''{"status":"published","visible":true}'')',draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': publish RPC is denied explicitly',
      CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed LIKE '23503:%' END,observed);
    observed:=pg_temp.attempt_company_offer(format('SELECT update_offer_with_habilitations(%L,''{}'',''[]'')',draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': replacing requirements via RPC is denied',
      CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed LIKE '23503:%' END,observed);
    observed:=pg_temp.attempt_company_offer(format('INSERT INTO offer_required_habilitations(offer_id,product_type,aircraft_type_rating_id) VALUES(%L,''Aeroplane'',%L)',published_o,rating));
    PERFORM pg_temp.check_company_offer(company_status||': cannot directly add requirements',
      CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed='OK:1' END,observed);
    observed:=pg_temp.attempt_company_offer(format('DELETE FROM offer_required_habilitations WHERE offer_id=%L',draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': cannot directly remove requirements',
      observed=CASE WHEN secure THEN 'OK:0' ELSE 'OK:1' END,observed);
    RESET ROLE;

    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
    -- Restore the baseline fixture after the intentionally successful attack.
    IF NOT secure THEN
      DELETE FROM offer_required_habilitations WHERE offer_id=published_o;
      INSERT INTO offer_required_habilitations(offer_id,product_type,aircraft_type_rating_id,notes)
      VALUES(draft_o,'Aeroplane',rating,'Original requirement');
    END IF;
    SET LOCAL ROLE authenticated;
    observed:=pg_temp.attempt_company_offer(insert_sql);
    PERFORM pg_temp.check_company_offer(company_status||': platform admin also cannot create unapproved-company offers',
      CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed='OK:1' END,observed);
    observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET title=''Admin edit'' WHERE id=%L',draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': admin ALL policy cannot bypass edit approval',
      observed=CASE WHEN secure THEN 'OK:0' ELSE 'OK:1' END,observed);
    observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET status=''published'',visible=true WHERE id=%L',draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': admin ALL policy cannot bypass publication approval',
      observed=CASE WHEN secure THEN 'OK:0' ELSE 'OK:1' END,observed);
    observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET company_id=%L WHERE id=%L',cid,approved_o));
    PERFORM pg_temp.check_company_offer(company_status||': cannot move approved offer to unapproved company',
      CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed='OK:1' END,observed);
    RESET ROLE;
    IF NOT secure THEN UPDATE offers SET company_id=approved_cid WHERE id=approved_o; END IF;
    SET LOCAL ROLE authenticated;
    observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET company_id=%L WHERE id=%L',approved_cid,draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': cannot bypass old-row approval by moving offer away',
      observed=CASE WHEN secure THEN 'OK:0' ELSE 'OK:1' END,observed);
    RESET ROLE;
    IF NOT secure THEN UPDATE offers SET company_id=cid WHERE id=draft_o; END IF;
    SET LOCAL ROLE authenticated;
    observed:=pg_temp.attempt_company_offer(format('UPDATE offer_required_habilitations SET notes=''Admin requirement edit'' WHERE offer_id=%L',draft_o));
    PERFORM pg_temp.check_company_offer(company_status||': cannot update requirements through admin ALL policy',
      observed=CASE WHEN secure THEN 'OK:0' ELSE 'OK:1' END,observed);
    observed:=pg_temp.attempt_company_offer(format('UPDATE offer_required_habilitations SET offer_id=%L WHERE offer_id=%L',published_o,approved_o));
    PERFORM pg_temp.check_company_offer(company_status||': cannot move approved requirements to unapproved offer',
      CASE WHEN secure THEN observed LIKE '42501:%' ELSE observed='OK:1' END,observed);
    RESET ROLE;
    IF NOT secure THEN UPDATE offer_required_habilitations SET offer_id=approved_o WHERE offer_id=published_o; END IF;
    IF secure THEN
      PERFORM pg_temp.check_company_offer(company_status||': denied writes leave existing offers byte-for-byte unchanged',
        saved=(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM offers o WHERE id IN (draft_o,published_o)));
      PERFORM pg_temp.check_company_offer(company_status||': denied writes leave existing requirements unchanged',
        requirements=(SELECT jsonb_agg(to_jsonb(h) ORDER BY offer_id,aircraft_type_rating_id) FROM offer_required_habilitations h WHERE offer_id IN (draft_o,published_o)));
    END IF;
  END LOOP;

  -- Positive controls: approval is necessary, and old role/user gates remain.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ru,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,location_country,location_country_code,status,visible)
  VALUES(approved_cid,'Recruiter new draft','rollback',contract,'Aeroplane','mechanic',false,'Test',country,'draft',false) RETURNING id INTO new_offer;
  PERFORM pg_temp.check_company_offer('approved company recruiter can create draft',new_offer IS NOT NULL);
  UPDATE offers SET title='Recruiter edited' WHERE id=new_offer;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM pg_temp.check_company_offer('approved company recruiter can edit directly',n=1);
  PERFORM update_offer_with_habilitations(new_offer,'{"title":"RPC edited"}',
    jsonb_build_array(jsonb_build_object('aircraft_type_rating_id',rating,'notes','Valid replacement')));
  PERFORM pg_temp.check_company_offer('approved company edit RPC and requirements still work',
    EXISTS(SELECT 1 FROM offers WHERE id=new_offer AND title='RPC edited')
    AND EXISTS(SELECT 1 FROM offer_required_habilitations WHERE offer_id=new_offer));
  PERFORM update_offer_with_habilitations(new_offer,'{"status":"published","visible":true}');
  PERFORM pg_temp.check_company_offer('approved company can publish through RPC',
    EXISTS(SELECT 1 FROM offers WHERE id=new_offer AND status='published' AND visible));
  UPDATE offers SET status='draft' WHERE id=new_offer;
  UPDATE offers SET status='published',visible=true WHERE id=new_offer;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM pg_temp.check_company_offer('approved company can publish directly',n=1);
  DELETE FROM offer_required_habilitations WHERE offer_id=new_offer;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM pg_temp.check_company_offer('approved company can remove requirements',n=1);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',vu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET title=''Viewer attack'' WHERE id=%L',new_offer));
  PERFORM pg_temp.check_company_offer('approval does not grant editing to a viewer',observed='OK:0',observed);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',xu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET title=''Outsider attack'' WHERE id=%L',new_offer));
  PERFORM pg_temp.check_company_offer('approval does not grant editing to an outsider',observed='OK:0',observed);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE offers SET title='Approved admin edit' WHERE id=approved_o;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM pg_temp.check_company_offer('platform admin can still edit approved-company offers',n=1);
  UPDATE offer_required_habilitations SET notes='Approved admin requirement edit' WHERE offer_id=approved_o;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM pg_temp.check_company_offer('platform admin can still edit approved-company requirements',n=1);
  RESET ROLE;
  UPDATE profiles SET status='suspended' WHERE id=ru;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ru,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt_company_offer(format('UPDATE offers SET title=''Suspended attack'' WHERE id=%L',new_offer));
  PERFORM pg_temp.check_company_offer('company approval does not bypass suspended account',observed='OK:0',observed);
  RESET ROLE;
END $test$;
SELECT test,passed,observed FROM company_offer_results;
ROLLBACK;
