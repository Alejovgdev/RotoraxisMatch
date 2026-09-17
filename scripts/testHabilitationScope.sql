-- Embedded by testHabilitationScopeDatabase.cjs in a BEGIN/ROLLBACK wrapper.
CREATE TEMP TABLE scope_results(test text,passed boolean);
GRANT ALL ON scope_results TO authenticated;
DO $test$
DECLARE t uuid; tu uuid; lic uuid; r uuid; valid_rating uuid; h_id uuid; saved jsonb; changed integer;
  a record; c record; accepted boolean; rejected boolean; expected boolean;
  baseline boolean:=current_setting('app.scope_baseline')='true';
BEGIN
  SELECT tp.id,tp.user_id INTO t,tu FROM technician_profiles tp JOIN profiles p ON p.id=tp.user_id WHERE p.status='active' LIMIT 1;
  IF t IS NULL THEN RAISE EXCEPTION 'Missing active technician fixture'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  FOR a IN SELECT authority,license_code FROM authority_licenses ORDER BY 1,2 LOOP
    INSERT INTO technician_licenses(technician_id,authority,license_code) VALUES(t,a.authority,a.license_code)
      ON CONFLICT(technician_id,authority,license_code) DO NOTHING;
    SELECT id INTO lic FROM technician_licenses WHERE technician_id=t AND authority=a.authority AND license_code=a.license_code;
    FOR c IN SELECT DISTINCT ON (ar.product_type,e.engine_type) ar.id,ar.product_type,e.engine_type
      FROM aircraft_type_ratings ar LEFT JOIN engines e ON e.id=ar.engine_id WHERE ar.is_active
      ORDER BY ar.product_type,e.engine_type,ar.id
    LOOP
      expected:=a.license_code IN ('B2','C') OR (
        a.license_code IN ('B1.1','B1.2','B1.3','B1.4')
        AND c.product_type=CASE WHEN a.license_code IN ('B1.1','B1.2') THEN 'Aeroplane' ELSE 'Helicopter' END
        AND CASE WHEN a.license_code IN ('B1.2','B1.4') THEN c.engine_type='piston'
          ELSE c.engine_type IN ('turbofan','turbojet','turboprop','turboshaft') END);
      expected:=coalesce(expected,false);
      accepted:=false; rejected:=false;
      -- RPC replacement bypasses duplicate fixtures. Its temporary deletion
      -- and insertion are undone even for an accepted control case.
      SELECT jsonb_agg(to_jsonb(h) ORDER BY id) INTO saved FROM technician_habilitations h WHERE technician_id=t;
      BEGIN
        PERFORM replace_technician_habilitations(t,jsonb_build_array(jsonb_build_object(
          'authority',a.authority,'license_code',a.license_code,'aircraft_type_rating_id',c.id)));
        RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='Accepted control; undo';
      EXCEPTION WHEN SQLSTATE 'ZX001' THEN accepted:=true;
        WHEN check_violation THEN rejected:=SQLERRM='Individual type rating is outside the licence scope.';
      END;
      INSERT INTO scope_results SELECT format('RPC %s/%s/%s/%s',a.authority,a.license_code,c.product_type,coalesce(c.engine_type,'unknown')),
        (CASE WHEN baseline OR expected THEN accepted ELSE rejected END)
        AND saved IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM technician_habilitations h WHERE technician_id=t);
    END LOOP;
  END LOOP;
  SELECT ar.id INTO valid_rating FROM aircraft_type_ratings ar JOIN engines e ON e.id=ar.engine_id
    WHERE ar.is_active AND ar.product_type='Aeroplane' AND e.engine_type='turbofan' LIMIT 1;
  SELECT ar.id INTO r FROM aircraft_type_ratings ar JOIN engines e ON e.id=ar.engine_id
    WHERE ar.is_active AND ar.product_type='Aeroplane' AND e.engine_type='piston' LIMIT 1;
  IF valid_rating IS NULL OR r IS NULL THEN RAISE EXCEPTION 'Missing piston/turbine controls'; END IF;
  PERFORM replace_technician_habilitations(t,jsonb_build_array(jsonb_build_object('authority','EASA','license_code','B1.1','aircraft_type_rating_id',valid_rating)));
  SELECT id INTO h_id FROM technician_habilitations WHERE technician_id=t;
  SELECT id INTO lic FROM technician_licenses WHERE technician_id=t AND authority='EASA' AND license_code='B1.1';
  rejected:=false;
  BEGIN
    INSERT INTO technician_habilitations(technician_id,technician_license_id,license_code,aircraft_type_rating_id) VALUES(t,lic,'B1.1',r);
    RAISE EXCEPTION USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    WHEN check_violation THEN rejected:=SQLERRM='Individual type rating is outside the licence scope.';
  END;
  INSERT INTO scope_results VALUES('direct INSERT rejects piston under turbine B1',rejected=NOT baseline);
  UPDATE technician_habilitations SET aircraft_type_rating_id=r WHERE id=h_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  INSERT INTO scope_results VALUES('technician UPDATE already blocked by RLS',changed=0);
  RESET ROLE;
  rejected:=false;
  BEGIN
    UPDATE technician_habilitations SET aircraft_type_rating_id=r WHERE id=h_id;
    RAISE EXCEPTION USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    WHEN check_violation THEN rejected:=SQLERRM='Individual type rating is outside the licence scope.';
  END;
  INSERT INTO scope_results VALUES('maintenance UPDATE rejects piston under turbine B1',rejected=NOT baseline);
  SET LOCAL ROLE authenticated;
  IF NOT baseline THEN
    rejected:=false;
    BEGIN UPDATE technician_licenses SET license_code='A1' WHERE id=lic;
    EXCEPTION WHEN check_violation THEN rejected:=SQLERRM='Existing type rating is outside the new licence scope.'; END;
    INSERT INTO scope_results VALUES('parent credential change guarded',rejected);
  END IF;
  RESET ROLE;
END $test$;
SELECT count(*)::int AS cases, count(*) FILTER (WHERE NOT passed)::int AS failures,
  coalesce(jsonb_agg(test) FILTER (WHERE NOT passed),'[]') AS failed_tests FROM scope_results;
