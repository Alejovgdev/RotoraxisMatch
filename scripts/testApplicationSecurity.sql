-- Run on the real database through an administrative SQL connection.
-- All fixtures, status changes and helper functions roll back. No auth users
-- are created. Missing fixtures are an error, never a silently skipped test.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE security_results (test text, passed boolean, observed text);
GRANT ALL ON security_results TO authenticated;
CREATE FUNCTION pg_temp.attempt(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE detail text;
BEGIN
  EXECUTE statement;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS detail = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || ':' || SQLERRM || ':' || coalesce(detail,'');
END $$;
DO $test$
DECLARE
  t uuid; tu uuid; other_t uuid; other_u uuid; cu uuid; cid uuid; other_c uuid; admin_u uuid;
  src offers%ROWTYPE; o uuid; engine_o uuid; app uuid; other_app uuid; o2 uuid; app2 uuid; rq uuid; rq2 uuid;
  engine uuid; lic uuid; rating uuid; observed text; before_counts bigint[];
BEGIN
  SELECT id INTO admin_u FROM profiles WHERE role='admin' AND status='active' LIMIT 1;
  SELECT m.user_id,m.company_id INTO cu,cid FROM company_members m JOIN profiles p ON p.id=m.user_id
    WHERE p.status='active' AND m.role IN ('admin','recruiter') ORDER BY m.user_id LIMIT 1;
  SELECT tp.id,tp.user_id INTO t,tu FROM technician_profiles tp JOIN profiles p ON p.id=tp.user_id
    WHERE p.status='active' ORDER BY tp.id LIMIT 1;
  SELECT tp.id,tp.user_id INTO other_t,other_u FROM technician_profiles tp JOIN profiles p ON p.id=tp.user_id
    WHERE p.status='active' AND tp.id<>t
      AND NOT EXISTS (SELECT 1 FROM offer_applications a WHERE a.company_id=cid AND a.technician_id=tp.id)
      AND NOT EXISTS (SELECT 1 FROM offer_requests a WHERE a.company_id=cid AND a.technician_id=tp.id)
    ORDER BY tp.id LIMIT 1;
  SELECT id INTO other_c FROM companies WHERE id<>cid LIMIT 1;
  SELECT * INTO src FROM offers LIMIT 1;
  SELECT id INTO engine FROM engines WHERE is_active ORDER BY id LIMIT 1;
  SELECT id INTO rating FROM aircraft_type_ratings WHERE is_active ORDER BY id LIMIT 1;
  IF t IS NULL OR other_t IS NULL OR cu IS NULL OR other_c IS NULL OR src.id IS NULL OR engine IS NULL OR rating IS NULL THEN
    RAISE EXCEPTION 'Security tests require two active technicians, an unrelated active company member, two companies and catalogs';
  END IF;
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,
    location_country,location_country_code,status,visible)
    VALUES(cid,'selftest-081','rollback',src.contract_type,src.product_type,'mechanic',false,src.location_country,src.location_country_code,'published',true)
    RETURNING id INTO o;
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,
    location_country,location_country_code,status,visible,offer_kind,required_engine_id)
    VALUES(cid,'selftest-081-engine','rollback',src.contract_type,src.product_type,'engine_technician',false,src.location_country,src.location_country_code,'published',true,'engine',engine)
    RETURNING id INTO engine_o;

  -- Valid owner INSERT, withdraw and reapply remain possible.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO offer_applications(technician_id,offer_id,company_id) VALUES(t,o,cid) RETURNING id INTO app;
  UPDATE offer_applications SET status='withdrawn' WHERE id=app;
  UPDATE offer_applications SET status='pending' WHERE id=app;
  INSERT INTO security_results VALUES('owner insert and reapply',true,'OK');
  observed:=pg_temp.attempt(format('UPDATE offer_applications SET offer_id=%L WHERE id=%L',engine_o,app));
  INSERT INTO security_results VALUES('H4 offer_id immutable',observed LIKE '42501:Application participants cannot be changed.%',observed);
  observed:=pg_temp.attempt(format('UPDATE offer_applications SET company_id=%L WHERE id=%L',other_c,app));
  INSERT INTO security_results VALUES('H4 company_id immutable',observed LIKE '42501:Application participants cannot be changed.%',observed);
  RESET ROLE;
  -- Restore only the rollback fixture so every pre-fix reproduction is independent.
  UPDATE offer_applications SET offer_id=o,company_id=cid WHERE id=app;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt(format('UPDATE offer_applications SET technician_id=%L WHERE id=%L',other_t,app));
  INSERT INTO security_results VALUES('H4 technician_id immutable for company',observed LIKE '42501:Application participants cannot be changed.%',observed);
  RESET ROLE;
  UPDATE offer_applications SET technician_id=t WHERE id=app;

  -- Real trigger eligibility, not just the public pure SQL kernel.
  DELETE FROM technician_engine_experience WHERE technician_id=t;
  DELETE FROM technician_habilitations WHERE technician_id=t;
  DELETE FROM technician_profile_types WHERE technician_id=t AND type_code='engine_technician';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt(format('INSERT INTO offer_applications(technician_id,offer_id,company_id) VALUES(%L,%L,%L)',t,engine_o,cid));
  INSERT INTO security_results VALUES('engine application rejects missing experience',observed LIKE 'PT403:%:no_engine_experience',observed);
  -- 091: el INSERT directo que permite tee_insert_own no rodea la regla del tipo.
  observed:=pg_temp.attempt(format('INSERT INTO technician_engine_experience(technician_id,engine_id) VALUES(%L,%L)',t,engine));
  INSERT INTO security_results VALUES('direct engine insert requires engine technician',
    observed='23514:Only an Engine Technician profile can declare engines.:not_engine_technician',observed);
  -- 091: la vía (a) ya no existe; entra por (c), el tipo, y lo pierde al quitarlo.
  INSERT INTO technician_profile_types(technician_id,type_code) VALUES(t,'engine_technician');
  INSERT INTO offer_applications(technician_id,offer_id,company_id) VALUES(t,engine_o,cid) RETURNING id INTO other_app;
  UPDATE offer_applications SET status='withdrawn' WHERE id=other_app;
  DELETE FROM technician_profile_types WHERE technician_id=t AND type_code='engine_technician';
  observed:=pg_temp.attempt(format('UPDATE offer_applications SET status=''pending'' WHERE id=%L',other_app));
  INSERT INTO security_results VALUES('engine reapply rechecks experience',observed LIKE 'PT403:%:no_engine_experience',observed);
  RESET ROLE;
  -- A maintenance writer is exempt from client immutability, but changing
  -- offer_id must still run eligibility even when status remains pending.
  observed:=pg_temp.attempt(format('UPDATE offer_applications SET offer_id=%L WHERE id=%L',engine_o,app));
  INSERT INTO security_results VALUES('H4 offer reassignment rechecks eligibility without status change',observed LIKE 'PT403:%:no_engine_experience',observed);

  -- Give an unrelated technician all three kinds of qualification.
  INSERT INTO technician_licenses(technician_id,authority,license_code) VALUES(other_t,'EASA','B1.1')
    ON CONFLICT(technician_id,authority,license_code) DO UPDATE SET authority=excluded.authority RETURNING id INTO lic;
  INSERT INTO technician_habilitations(technician_id,technician_license_id,license_code,aircraft_type_rating_id)
    VALUES(other_t,lic,'B1.1',rating) ON CONFLICT DO NOTHING;
  -- 091: sólo un Engine Technician tiene motores.
  INSERT INTO technician_profile_types(technician_id,type_code) VALUES(other_t,'engine_technician') ON CONFLICT DO NOTHING;
  INSERT INTO technician_engine_experience(technician_id,engine_id) VALUES(other_t,engine) ON CONFLICT DO NOTHING;
  -- 085: las otras dos tablas de cualificación que lee loadTechnicianRelations.
  INSERT INTO technician_aircraft_experience(technician_id,aircraft_type_rating_id) VALUES(other_t,rating) ON CONFLICT DO NOTHING;
  INSERT INTO technician_profile_types(technician_id,type_code) VALUES(other_t,'mechanic') ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT ARRAY[(SELECT count(*) FROM technician_licenses WHERE technician_id=other_t),
    (SELECT count(*) FROM technician_habilitations WHERE technician_id=other_t),
    (SELECT count(*) FROM technician_engine_experience WHERE technician_id=other_t),
    (SELECT count(*) FROM technician_aircraft_experience WHERE technician_id=other_t),
    (SELECT count(*) FROM technician_profile_types WHERE technician_id=other_t)] INTO before_counts;
  INSERT INTO security_results VALUES('H15 visible profile keeps qualifications',
    EXISTS(SELECT 1 FROM technician_public_view WHERE id=other_t) AND 0<ALL(before_counts),before_counts::text);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_u,'role','authenticated')::text,true);
  UPDATE profiles SET status='blocked' WHERE id=other_u;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT (SELECT count(*) FROM technician_licenses WHERE technician_id=other_t)+
    (SELECT count(*) FROM technician_habilitations WHERE technician_id=other_t)+
    (SELECT count(*) FROM technician_engine_experience WHERE technician_id=other_t)+
    (SELECT count(*) FROM technician_aircraft_experience WHERE technician_id=other_t)+
    (SELECT count(*) FROM technician_profile_types WHERE technician_id=other_t) INTO observed;
  INSERT INTO security_results VALUES('H15 hidden unrelated profile hides qualifications',observed='0',observed);
  RESET ROLE;
  INSERT INTO offer_requests(technician_id,offer_id,company_id) VALUES(other_t,o,cid);
  SET LOCAL ROLE authenticated;
  INSERT INTO security_results SELECT 'H15 existing relationship keeps qualifications',
    before_counts=ARRAY[(SELECT count(*) FROM technician_licenses WHERE technician_id=other_t),
    (SELECT count(*) FROM technician_habilitations WHERE technician_id=other_t),
    (SELECT count(*) FROM technician_engine_experience WHERE technician_id=other_t),
    (SELECT count(*) FROM technician_aircraft_experience WHERE technician_id=other_t),
    (SELECT count(*) FROM technician_profile_types WHERE technician_id=other_t)],'relationship';
  -- Company status transitions are still allowed (must not demand technician auth).
  observed:=pg_temp.attempt(format('UPDATE offer_applications SET status=''accepted'' WHERE id=%L',app));
  INSERT INTO security_results VALUES('company can accept application',observed='OK',observed);
  RESET ROLE;

  -- 092: quién hace cada cambio de estado, y aceptar re-comprueba la elegibilidad.
  INSERT INTO security_results SELECT '092 accept records who and when',
    status_changed_by=cu AND status_changed_at IS NOT NULL, coalesce(status_changed_by::text,'null') FROM offer_applications WHERE id=app;
  INSERT INTO technician_licenses(technician_id,authority,license_code) VALUES(t,'EASA','B1.1')
    ON CONFLICT(technician_id,authority,license_code) DO NOTHING;
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,
    location_country,location_country_code,status,visible)
    VALUES(cid,'selftest-092','rollback',src.contract_type,src.product_type,'mechanic',false,src.location_country,src.location_country_code,'published',true)
    RETURNING id INTO o2;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO offer_applications(technician_id,offer_id,company_id) VALUES(t,o2,cid) RETURNING id INTO app2;
  observed:=pg_temp.attempt(format('UPDATE offer_applications SET status=''accepted'' WHERE id=%L',app2));
  INSERT INTO security_results VALUES('092 technician cannot accept own application',observed='42501:Not authorized.:',observed);
  RESET ROLE;
  -- La oferta cambia después de recibir la candidatura.
  UPDATE offers SET only_unlicensed=true WHERE id=o2;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt(format('UPDATE offer_applications SET status=''accepted'' WHERE id=%L',app2));
  INSERT INTO security_results SELECT '092 company accept rechecks eligibility',
    observed LIKE 'PT403:%:licensed_technician' AND status='pending',observed FROM offer_applications WHERE id=app2;
  INSERT INTO offer_requests(technician_id,offer_id,company_id) VALUES(t,engine_o,cid) RETURNING id INTO rq;
  observed:=pg_temp.attempt(format('UPDATE offer_requests SET status=''accepted'' WHERE id=%L',rq));
  INSERT INTO security_results SELECT '092 company cannot accept its own direct offer',
    observed='42501:Not authorized.:' AND NOT identity_revealed,observed FROM offer_requests WHERE id=rq;
  observed:=pg_temp.attempt(format('UPDATE offer_applications SET cover_note=%L WHERE id=%L','reescrita por la empresa',app));
  INSERT INTO security_results VALUES('093 company cannot rewrite cover note',observed='42501:Only the technician can edit the cover note.:',observed);
  RESET ROLE;

  -- 093: participantes de la oferta directa inmutables; cada parte, su texto.
  -- Dos ofertas directas, una por lado, para que un fallo no arrastre al otro
  -- test (si el técnico pudiera llevarse una a otra empresa, la empresa ya no
  -- la vería). El estado final se lee sin RLS.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO offer_requests(technician_id,offer_id,company_id,message) VALUES(t,o2,cid,'mensaje') RETURNING id INTO rq2;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE offer_requests SET status='accepted' WHERE id=rq;
  observed:=pg_temp.attempt(format('UPDATE offer_requests SET company_id=%L WHERE id=%L',other_c,rq2));
  INSERT INTO security_results VALUES('093 technician cannot repoint direct offer',observed='42501:Direct offer participants cannot be changed.:',observed);
  observed:=pg_temp.attempt(format('UPDATE offer_requests SET message=%L WHERE id=%L','reescrito por el tecnico',rq2));
  INSERT INTO security_results VALUES('093 technician cannot rewrite message',observed='42501:Only the company can edit the message.:',observed);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt(format('UPDATE offer_requests SET technician_id=%L WHERE id=%L',other_t,rq));
  RESET ROLE;
  INSERT INTO security_results SELECT '093 company cannot swap technician on accepted direct offer',
    observed='42501:Direct offer participants cannot be changed.:' AND technician_id=t,observed FROM offer_requests WHERE id=rq;

  -- 094: el INSERT directo que permite tae_insert_own no rodea la firma FAA.
  DELETE FROM technician_licenses WHERE technician_id=t AND authority='FAA';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt(format('INSERT INTO technician_aircraft_experience(technician_id,aircraft_type_rating_id,signed) VALUES(%L,%L,true)',t,rating));
  INSERT INTO security_results VALUES('094 direct signed aircraft insert requires FAA A or A&P',
    observed='23514:Only a technician with an FAA A or A&P licence can mark an aircraft as signed off.:not_faa_sign_off_licensed',observed);
  RESET ROLE;

  -- A sentinel proves unauthorized callers never reach private qualification reads.
  EXECUTE $fn$CREATE OR REPLACE FUNCTION public.offer_application_ineligibility_reason(p_offer_id uuid,p_technician_id uuid)
    RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public AS $body$
    BEGIN RAISE EXCEPTION 'PRIVATE_FACTS_READ'; END $body$$fn$;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  observed:=pg_temp.attempt(format('INSERT INTO offer_applications(technician_id,offer_id,company_id) VALUES(%L,%L,%L)',other_t,engine_o,cid));
  INSERT INTO security_results VALUES('H5 unauthorized real technician gets generic error before facts',observed='42501:Not authorized.:',observed);
  observed:=pg_temp.attempt(format('INSERT INTO offer_applications(technician_id,offer_id,company_id) VALUES(%L,%L,%L)',gen_random_uuid(),engine_o,cid));
  INSERT INTO security_results VALUES('H5 nonexistent technician gets identical error',observed='42501:Not authorized.:',observed);
  RESET ROLE;
END $test$;
SELECT * FROM security_results ORDER BY test;
ROLLBACK;
