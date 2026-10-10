-- Run through rehearseOfferEngineNotes.cjs; no application login or auth users.
BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE engine_note_results(test text, passed boolean);
GRANT ALL ON engine_note_results TO authenticated;
DO $test$
DECLARE
  cu uuid; cid uuid; tu uuid; other_c uuid; engine uuid; engine2 uuid;
  src public.offers; saved public.offers; o uuid; empty_o uuid; foreign_o uuid;
  failed boolean; note text := E'Experiencia reciente en taller — CFM56\nInspección y montaje.';
BEGIN
  SELECT m.user_id,m.company_id INTO cu,cid FROM company_members m
    JOIN profiles p ON p.id=m.user_id
    WHERE p.status='active' AND m.role IN ('admin','recruiter') ORDER BY m.user_id LIMIT 1;
  SELECT tp.user_id INTO tu FROM technician_profiles tp JOIN profiles p ON p.id=tp.user_id
    WHERE p.status='active' ORDER BY tp.id LIMIT 1;
  SELECT id INTO other_c FROM companies WHERE id<>cid LIMIT 1;
  SELECT * INTO src FROM offers ORDER BY id LIMIT 1;
  SELECT id INTO engine FROM engines WHERE is_active AND NOT is_generic ORDER BY id LIMIT 1;
  SELECT id INTO engine2 FROM engines WHERE is_active AND NOT is_generic AND id<>engine ORDER BY id LIMIT 1;
  IF cu IS NULL OR tu IS NULL OR other_c IS NULL OR src.id IS NULL OR engine2 IS NULL THEN
    RAISE EXCEPTION '097: missing existing fixtures';
  END IF;

  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,
    requires_certification,location_country,location_country_code,status,visible,offer_kind,required_engine_id,required_engine_notes)
    VALUES(other_c,'selftest-097-foreign','rollback',src.contract_type,'Aeroplane','engine_technician',
      false,src.location_country,src.location_country_code,'published',true,'engine',engine,'Foreign note') RETURNING id INTO foreign_o;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,
    requires_certification,location_country,location_country_code,status,visible,offer_kind,required_engine_id,required_engine_notes)
    VALUES(cid,'selftest-097','rollback',src.contract_type,'Aeroplane','engine_technician',
      false,src.location_country,src.location_country_code,'published',true,'engine',engine,note) RETURNING * INTO saved;
  o:=saved.id;
  INSERT INTO engine_note_results VALUES('create returns the engine note',saved.required_engine_notes IS NOT DISTINCT FROM note);
  INSERT INTO engine_note_results SELECT 'company reads exact Unicode and multiline note',required_engine_notes IS NOT DISTINCT FROM note FROM offers WHERE id=o;

  -- Old clients omit the field on creation; the default remains NULL.
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,
    requires_certification,location_country,location_country_code,offer_kind,required_engine_id)
    VALUES(cid,'selftest-097-empty','rollback',src.contract_type,'Aeroplane','engine_technician',
      false,src.location_country,src.location_country_code,'engine',engine) RETURNING id INTO empty_o;
  INSERT INTO engine_note_results SELECT 'create without note stays optional',required_engine_notes IS NULL FROM offers WHERE id=empty_o;

  saved:=update_offer_with_habilitations(o,'{"required_engine_notes":"Updated note"}');
  INSERT INTO engine_note_results VALUES('RPC edit returns the new note',saved.required_engine_notes='Updated note');
  INSERT INTO engine_note_results SELECT 'reload reads the edited note',required_engine_notes='Updated note' FROM offers WHERE id=o;
  saved:=update_offer_with_habilitations(o,'{"title":"selftest-097-edited"}');
  INSERT INTO engine_note_results VALUES('unrelated legacy patch preserves note',saved.required_engine_notes='Updated note');
  saved:=update_offer_with_habilitations(o,jsonb_build_object('required_engine_id',engine));
  INSERT INTO engine_note_results VALUES('same engine preserves omitted note',saved.required_engine_notes='Updated note');
  saved:=update_offer_with_habilitations(o,'{"required_engine_notes":null}');
  INSERT INTO engine_note_results SELECT 'explicit null clears note in response and reload',saved.required_engine_notes IS NULL AND required_engine_notes IS NULL FROM offers WHERE id=o;

  PERFORM update_offer_with_habilitations(o,jsonb_build_object('required_engine_notes',note));
  saved:=update_offer_with_habilitations(o,jsonb_build_object('required_engine_id',engine2));
  INSERT INTO engine_note_results SELECT 'legacy engine change clears stale note',saved.required_engine_notes IS NULL AND required_engine_notes IS NULL FROM offers WHERE id=o;
  saved:=update_offer_with_habilitations(o,jsonb_build_object('required_engine_id',engine,'required_engine_notes',note));
  INSERT INTO engine_note_results VALUES('engine change accepts an explicit new note',saved.required_engine_notes IS NOT DISTINCT FROM note);

  failed:=false;
  BEGIN
    PERFORM update_offer_with_habilitations(o,'{"required_engine_notes":"Must roll back","required_engine_id":null}');
  EXCEPTION WHEN check_violation THEN failed:=true; END;
  INSERT INTO engine_note_results SELECT 'invalid edit preserves engine and note',failed AND required_engine_id=engine AND required_engine_notes IS NOT DISTINCT FROM note FROM offers WHERE id=o;

  saved:=update_offer_with_habilitations(o,'{"offer_kind":"aircraft","technician_type":"mechanic","required_engine_id":null}');
  INSERT INTO engine_note_results SELECT 'legacy switch to aircraft clears note atomically',saved.required_engine_notes IS NULL AND offer_kind='aircraft' AND required_engine_notes IS NULL FROM offers WHERE id=o;
  failed:=false;
  BEGIN UPDATE offers SET required_engine_notes='Not an engine' WHERE id=o;
  EXCEPTION WHEN check_violation THEN failed:=true; END;
  INSERT INTO engine_note_results VALUES('direct aircraft write rejects engine note',failed);
  failed:=false;
  BEGIN PERFORM update_offer_with_habilitations(o,'{"required_engine_notes":"Not an engine"}');
  EXCEPTION WHEN check_violation THEN failed:=true; END;
  INSERT INTO engine_note_results VALUES('RPC aircraft write rejects engine note',failed);

  saved:=update_offer_with_habilitations(o,jsonb_build_object('offer_kind','engine','technician_type','engine_technician','required_engine_id',engine,'required_engine_notes',note));
  INSERT INTO engine_note_results VALUES('switch back to engine accepts note',saved.required_engine_notes IS NOT DISTINCT FROM note);
  failed:=false;
  BEGIN PERFORM update_offer_with_habilitations(foreign_o,'{"required_engine_notes":"Hijacked"}');
  EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
  INSERT INTO engine_note_results VALUES('company cannot edit another company note',failed);

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO engine_note_results SELECT 'technician reads published engine note',required_engine_notes IS NOT DISTINCT FROM note FROM offers WHERE id=o;
  failed:=false;
  BEGIN PERFORM update_offer_with_habilitations(o,'{"required_engine_notes":"Hijacked"}');
  EXCEPTION WHEN insufficient_privilege THEN failed:=true; END;
  INSERT INTO engine_note_results VALUES('technician cannot edit engine note via RPC',failed);
  UPDATE offers SET required_engine_notes='Hijacked directly' WHERE id=o;
  INSERT INTO engine_note_results SELECT 'technician direct update cannot change note',required_engine_notes IS NOT DISTINCT FROM note FROM offers WHERE id=o;
  RESET ROLE;
  INSERT INTO engine_note_results SELECT 'foreign note survives denied edit',required_engine_notes='Foreign note' FROM offers WHERE id=foreign_o;
END $test$;
SELECT test,passed FROM engine_note_results;
ROLLBACK;
