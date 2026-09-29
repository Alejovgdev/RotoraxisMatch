-- Real database regression tests. Everything, including failure injection,
-- rolls back. Invoke through an administrative SQL connection.
BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE transaction_results(test text,passed boolean);
GRANT ALL ON transaction_results TO authenticated;
DO $test$
DECLARE t uuid; tu uuid; other_t uuid; cu uuid; cid uuid; lic uuid; engine uuid; rating uuid; product text;
  src offers%ROWTYPE; o uuid; saved jsonb; payload jsonb; failed boolean;
BEGIN
  SELECT tp.id,tp.user_id INTO t,tu FROM technician_profiles tp JOIN profiles p ON p.id=tp.user_id WHERE p.status='active' LIMIT 1;
  SELECT id INTO other_t FROM technician_profiles WHERE id<>t LIMIT 1;
  SELECT m.user_id,m.company_id INTO cu,cid FROM company_members m JOIN profiles p ON p.id=m.user_id WHERE p.status='active' AND m.role IN ('admin','recruiter') LIMIT 1;
  SELECT * INTO src FROM offers LIMIT 1;
  SELECT id INTO engine FROM engines WHERE is_active LIMIT 1;
  SELECT id,product_type INTO rating,product FROM aircraft_type_ratings WHERE is_active AND product_type='Aeroplane' LIMIT 1;
  IF t IS NULL OR other_t IS NULL OR cu IS NULL OR engine IS NULL OR rating IS NULL THEN RAISE EXCEPTION 'Missing transactional test fixtures'; END IF;
  INSERT INTO technician_licenses(technician_id,authority,license_code) VALUES(t,'EASA','B1.1')
    ON CONFLICT(technician_id,authority,license_code) DO UPDATE SET authority=excluded.authority RETURNING id INTO lic;
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,location_country,location_country_code)
    VALUES(cid,'selftest-082','rollback',src.contract_type,product,'mechanic',false,src.location_country,src.location_country_code) RETURNING id INTO o;
  -- 091: el técnico arranca SIN el tipo Engine Technician, y sin motores.
  DELETE FROM technician_profile_types WHERE technician_id=t AND type_code='engine_technician';
  -- 094: y sin licencias FAA (la firma de aeronaves depende de ellas).
  DELETE FROM technician_licenses WHERE technician_id=t AND authority='FAA';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  -- 091: sin el tipo, la RPC rechaza motores antes de borrar nada; la lista vacía pasa.
  failed:=false;
  BEGIN PERFORM replace_technician_engines(t,jsonb_build_array(jsonb_build_object('engine_id',engine)));
    EXCEPTION WHEN check_violation THEN failed:=SQLERRM='Only an Engine Technician profile can declare engines.'; END;
  PERFORM replace_technician_engines(t,'[]');
  INSERT INTO transaction_results SELECT 'non-engine technician cannot save engines',failed AND NOT EXISTS(SELECT 1 FROM technician_engine_experience WHERE technician_id=t);
  INSERT INTO technician_profile_types(technician_id,type_code) VALUES(t,'engine_technician');
  payload:=jsonb_build_array(jsonb_build_object('authority','EASA','license_code','B1.1','aircraft_type_rating_id',rating,'experience_years',5));
  PERFORM replace_technician_habilitations(t,payload);
  SELECT jsonb_agg(to_jsonb(h) ORDER BY id) INTO saved FROM technician_habilitations h WHERE technician_id=t;
  failed:=false;
  BEGIN PERFORM replace_technician_habilitations(t,jsonb_build_array(jsonb_build_object('authority','FAA','license_code','B1.1','aircraft_type_rating_id',rating)));
    EXCEPTION WHEN OTHERS THEN failed:=SQLERRM LIKE '%credential is missing%'; END;
  INSERT INTO transaction_results SELECT 'missing credential preserves exact rows',failed AND saved=(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM technician_habilitations h WHERE technician_id=t);
  failed:=false;
  BEGIN PERFORM replace_technician_habilitations(t,payload || payload); EXCEPTION WHEN OTHERS THEN failed:=SQLERRM LIKE '%Duplicate%'; END;
  INSERT INTO transaction_results SELECT 'duplicate rating preserves exact rows',failed AND saved=(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM technician_habilitations h WHERE technician_id=t);
  PERFORM replace_technician_engines(t,jsonb_build_array(jsonb_build_object('engine_id',engine,'years',70)));
  SELECT jsonb_agg(to_jsonb(e) ORDER BY id) INTO saved FROM technician_engine_experience e WHERE technician_id=t;
  failed:=false;
  BEGIN PERFORM replace_technician_engines(t,jsonb_build_array(jsonb_build_object('engine_id',engine,'years',71))); EXCEPTION WHEN OTHERS THEN failed:=SQLERRM LIKE '%between 0 and 70%'; END;
  INSERT INTO transaction_results SELECT '71 engine years rejected without data loss',failed AND saved=(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM technician_engine_experience e WHERE technician_id=t);
  failed:=false;
  BEGIN PERFORM replace_technician_engines(other_t,'[]'); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
  INSERT INTO transaction_results VALUES('cannot replace another technician engines',failed);
  failed:=false;
  BEGIN PERFORM replace_technician_habilitations(other_t,'[]'); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
  INSERT INTO transaction_results VALUES('cannot replace another technician ratings',failed);
  PERFORM replace_technician_engines(t,jsonb_build_array(jsonb_build_object('engine_id',engine,'years',0)));
  INSERT INTO transaction_results SELECT 'zero engine years preserved',years=0 FROM technician_engine_experience WHERE technician_id=t AND engine_id=engine;
  -- 091: quitar el tipo (como el técnico, por su política) se lleva los motores.
  DELETE FROM technician_profile_types WHERE technician_id=t AND type_code='engine_technician';
  INSERT INTO transaction_results SELECT 'removing engine technician type deletes engines',NOT EXISTS(SELECT 1 FROM technician_engine_experience WHERE technician_id=t);
  -- Se repone para que la inyección de fallos de abajo parta de una fila guardada.
  INSERT INTO technician_profile_types(technician_id,type_code) VALUES(t,'engine_technician');
  PERFORM replace_technician_engines(t,jsonb_build_array(jsonb_build_object('engine_id',engine,'years',0)));
  -- 084: la experiencia en aeronaves, el último reemplazo que borraba desde el cliente.
  PERFORM replace_technician_aircraft_experience(t,jsonb_build_array(jsonb_build_object('aircraft_type_rating_id',rating,'years',70)));
  SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO saved FROM technician_aircraft_experience a WHERE technician_id=t;
  failed:=false;
  BEGIN PERFORM replace_technician_aircraft_experience(t,jsonb_build_array(jsonb_build_object('aircraft_type_rating_id',rating,'years',71))); EXCEPTION WHEN OTHERS THEN failed:=SQLERRM LIKE '%between 0 and 70%'; END;
  INSERT INTO transaction_results SELECT '71 aircraft experience years rejected without data loss',failed AND saved=(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM technician_aircraft_experience a WHERE technician_id=t);
  failed:=false;
  BEGIN PERFORM replace_technician_aircraft_experience(other_t,'[]'); EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
  INSERT INTO transaction_results VALUES('cannot replace another technician aircraft experience',failed);
  -- 094: firmar una aeronave exige FAA A o A&P; perderla se lleva las firmas.
  SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO saved FROM technician_aircraft_experience a WHERE technician_id=t;
  failed:=false;
  BEGIN PERFORM replace_technician_aircraft_experience(t,jsonb_build_array(jsonb_build_object('aircraft_type_rating_id',rating,'signed',true)));
    EXCEPTION WHEN check_violation THEN failed:=SQLERRM LIKE 'Only a technician with an FAA A or A&P licence%'; END;
  INSERT INTO transaction_results SELECT 'signed aircraft without FAA A or A&P rejected without data loss',
    failed AND saved=(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM technician_aircraft_experience a WHERE technician_id=t);
  INSERT INTO technician_licenses(technician_id,authority,license_code) VALUES(t,'FAA','A&P');
  PERFORM replace_technician_aircraft_experience(t,jsonb_build_array(jsonb_build_object('aircraft_type_rating_id',rating,'years',70,'signed',true)));
  INSERT INTO transaction_results SELECT 'FAA A&P technician saves a signed aircraft',signed FROM technician_aircraft_experience WHERE technician_id=t AND aircraft_type_rating_id=rating;
  DELETE FROM technician_licenses WHERE technician_id=t AND authority='FAA' AND license_code='A&P';
  INSERT INTO transaction_results SELECT 'removing FAA A&P clears signed aircraft',
    EXISTS(SELECT 1 FROM technician_aircraft_experience WHERE technician_id=t) AND NOT EXISTS(SELECT 1 FROM technician_aircraft_experience WHERE technician_id=t AND signed);
  RESET ROLE;
  -- Fail AFTER the delete in each RPC: the original rows must survive exactly.
  EXECUTE $fn$CREATE FUNCTION pg_temp.fail_insert() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN RAISE EXCEPTION 'INJECTED_INSERT_FAILURE'; END $body$$fn$;
  CREATE TRIGGER selftest_082_failure BEFORE INSERT ON technician_habilitations FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_insert();
  CREATE TRIGGER selftest_082_failure BEFORE INSERT ON technician_engine_experience FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_insert();
  CREATE TRIGGER selftest_082_failure BEFORE INSERT ON technician_aircraft_experience FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_insert();
  SET LOCAL ROLE authenticated;
  SELECT jsonb_agg(to_jsonb(h) ORDER BY id) INTO saved FROM technician_habilitations h WHERE technician_id=t;
  failed:=false;
  BEGIN PERFORM replace_technician_habilitations(t,payload); EXCEPTION WHEN OTHERS THEN failed:=SQLERRM='INJECTED_INSERT_FAILURE'; END;
  INSERT INTO transaction_results SELECT 'rating insert failure rolls back delete',failed AND saved=(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM technician_habilitations h WHERE technician_id=t);
  SELECT jsonb_agg(to_jsonb(e) ORDER BY id) INTO saved FROM technician_engine_experience e WHERE technician_id=t;
  failed:=false;
  BEGIN PERFORM replace_technician_engines(t,jsonb_build_array(jsonb_build_object('engine_id',engine))); EXCEPTION WHEN OTHERS THEN failed:=SQLERRM='INJECTED_INSERT_FAILURE'; END;
  INSERT INTO transaction_results SELECT 'engine insert failure rolls back delete',failed AND saved=(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM technician_engine_experience e WHERE technician_id=t);
  SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO saved FROM technician_aircraft_experience a WHERE technician_id=t;
  failed:=false;
  BEGIN PERFORM replace_technician_aircraft_experience(t,jsonb_build_array(jsonb_build_object('aircraft_type_rating_id',rating))); EXCEPTION WHEN OTHERS THEN failed:=SQLERRM='INJECTED_INSERT_FAILURE'; END;
  INSERT INTO transaction_results SELECT 'aircraft experience insert failure rolls back delete',failed AND saved=(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM technician_aircraft_experience a WHERE technician_id=t);
  PERFORM replace_technician_habilitations(t,'[]');
  PERFORM replace_technician_engines(t,'[]');
  INSERT INTO transaction_results SELECT 'empty lists clear both sets',NOT EXISTS(SELECT 1 FROM technician_habilitations WHERE technician_id=t) AND NOT EXISTS(SELECT 1 FROM technician_engine_experience WHERE technician_id=t);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  payload:=jsonb_build_array(jsonb_build_object('aircraft_type_rating_id',rating));
  PERFORM update_offer_with_habilitations(o,'{}',payload);
  SELECT jsonb_agg(to_jsonb(h)) INTO saved FROM offer_required_habilitations h WHERE offer_id=o;
  failed:=false;
  BEGIN PERFORM update_offer_with_habilitations(o,'{"title":null,"product_type":"Helicopter"}', '[]'); EXCEPTION WHEN not_null_violation THEN failed:=true; END;
  INSERT INTO transaction_results SELECT 'invalid offer preserves aircraft and product',failed AND saved=(SELECT jsonb_agg(to_jsonb(h)) FROM offer_required_habilitations h WHERE offer_id=o) AND (SELECT product_type=product FROM offers WHERE id=o);
  failed:=false;
  BEGIN PERFORM update_offer_with_habilitations(o,'{"title":"changed"}',jsonb_build_array(jsonb_build_object('aircraft_type_rating_id',gen_random_uuid()))); EXCEPTION WHEN OTHERS THEN failed:=SQLERRM LIKE '%does not match%'; END;
  INSERT INTO transaction_results SELECT 'invalid aircraft preserves offer and requirements',failed AND saved=(SELECT jsonb_agg(to_jsonb(h)) FROM offer_required_habilitations h WHERE offer_id=o) AND (SELECT title='selftest-082' FROM offers WHERE id=o);
  RESET ROLE;
  CREATE TRIGGER selftest_082_failure BEFORE INSERT ON offer_required_habilitations FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_insert();
  SET LOCAL ROLE authenticated;
  failed:=false;
  BEGIN PERFORM update_offer_with_habilitations(o,'{"title":"changed"}',payload); EXCEPTION WHEN OTHERS THEN failed:=SQLERRM='INJECTED_INSERT_FAILURE'; END;
  INSERT INTO transaction_results SELECT 'aircraft insert failure rolls back offer and delete',failed AND saved=(SELECT jsonb_agg(to_jsonb(h)) FROM offer_required_habilitations h WHERE offer_id=o) AND (SELECT title='selftest-082' FROM offers WHERE id=o);
  -- 086: certificar bajo la FAA ya no vacía las aeronaves (son experiencia).
  -- NULL a propósito: es el caso que la 082 vaciaba en silencio, y el trigger
  -- de fallo inyectado sigue puesto, así que ninguna fila se reinserta.
  PERFORM update_offer_with_habilitations(o,'{"requires_certification":true,"license_code":"A&P","license_authority":"FAA"}',NULL);
  PERFORM update_offer_with_habilitations(o,'{"title":"faa-renamed"}',NULL);
  INSERT INTO transaction_results SELECT 'FAA offer keeps aircraft as experience',
    EXISTS(SELECT 1 FROM offer_required_habilitations WHERE offer_id=o) AND (SELECT license_authority='FAA' FROM offers WHERE id=o);
  PERFORM update_offer_with_habilitations(o,'{"requires_certification":false,"license_code":null,"license_authority":null}',NULL);
  -- 091: la clase va con el tipo. Motor sin Engine Technician: la RPC lo rechaza
  -- antes de tocar las aeronaves.
  failed:=false;
  BEGIN PERFORM update_offer_with_habilitations(o,jsonb_build_object('offer_kind','engine','required_engine_id',engine),NULL);
    EXCEPTION WHEN check_violation THEN failed:=SQLERRM LIKE '%chk_offers_kind_matches_technician_type%'; END;
  INSERT INTO transaction_results SELECT 'engine kind without engine technician type rejected',
    failed AND EXISTS(SELECT 1 FROM offer_required_habilitations WHERE offer_id=o) AND (SELECT offer_kind='aircraft' AND technician_type='mechanic' FROM offers WHERE id=o);
  PERFORM update_offer_with_habilitations(o,jsonb_build_object('offer_kind','engine','required_engine_id',engine,'technician_type','engine_technician'),NULL);
  INSERT INTO transaction_results SELECT 'engine transition clears aircraft atomically',NOT EXISTS(SELECT 1 FROM offer_required_habilitations WHERE offer_id=o) AND (SELECT offer_kind='engine' FROM offers WHERE id=o);
  RESET ROLE;
END $test$;
SELECT * FROM transaction_results ORDER BY test;
ROLLBACK;
