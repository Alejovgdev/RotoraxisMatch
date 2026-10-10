-- Metadata-only fixtures; no Storage files, auth login or persistent changes.
BEGIN;
-- Same session flag used by Storage API; ONLY metadata created in this rollback
-- transaction is deleted. RLS remains enabled and tested under each actual role.
SET LOCAL storage.allow_delete_query='true';
CREATE TEMP TABLE image_results(test text, passed boolean);
GRANT ALL ON image_results TO authenticated,anon;
CREATE FUNCTION pg_temp.check_image(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO image_results VALUES(label,coalesce(ok,false))
$$;
CREATE FUNCTION pg_temp.image_attempt(statement text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
DO $test$
DECLARE
  t uuid; tu uuid; t2 uuid; tu2 uuid; cu uuid; cid uuid; other_c uuid; admin_u uuid;
  photo text; replacement text; foreign_photo text; logo text; other_logo text; new_logo text;
  rq uuid; ap uuid; off_id uuid; src public.offers; original_role public.company_member_role;
  op text; member_role public.company_member_role;
BEGIN
  SELECT tp.id,tp.user_id INTO t,tu FROM technician_profiles tp JOIN profiles p ON p.id=tp.user_id
    WHERE p.status='active' ORDER BY tp.id LIMIT 1;
  SELECT tp.id,tp.user_id INTO t2,tu2 FROM technician_profiles tp JOIN profiles p ON p.id=tp.user_id
    WHERE p.status='active' AND tp.id<>t ORDER BY tp.id LIMIT 1;
  SELECT m.user_id,m.company_id,m.role INTO cu,cid,original_role FROM company_members m JOIN profiles p ON p.id=m.user_id
    WHERE p.status='active' AND m.role='admin' ORDER BY m.user_id LIMIT 1;
  SELECT id INTO other_c FROM companies WHERE id<>cid LIMIT 1;
  SELECT id INTO admin_u FROM profiles WHERE role='admin' AND status='active' LIMIT 1;
  SELECT * INTO src FROM offers LIMIT 1;
  IF t2 IS NULL OR cu IS NULL OR other_c IS NULL OR admin_u IS NULL OR src.id IS NULL THEN
    RAISE EXCEPTION '098 tests need two active technicians, company admin, second company, platform admin and offer';
  END IF;
  photo:=t||'/'||gen_random_uuid()||'.jpg';
  replacement:=t||'/'||gen_random_uuid()||'.jpg';
  foreign_photo:=t2||'/'||gen_random_uuid()||'.jpg';
  logo:=cid||'/'||gen_random_uuid()||'.png';
  new_logo:=cid||'/'||gen_random_uuid()||'.png';
  other_logo:=other_c||'/'||gen_random_uuid()||'.png';
  -- Reset this pair inside the rollback only, so pre-existing acceptance cannot mask a bug.
  DELETE FROM offer_applications WHERE company_id=cid AND technician_id=t;
  DELETE FROM offer_requests WHERE company_id=cid AND technician_id=t;
  INSERT INTO storage.objects(bucket_id,name) VALUES('technician-photos',foreign_photo),('company-logos',other_logo);
  INSERT INTO offers(company_id,title,description,contract_type,product_type,technician_type,requires_certification,
    location_country,location_country_code,status,visible)
    VALUES(cid,'selftest-098','rollback',src.contract_type,'Aeroplane','mechanic',false,src.location_country,src.location_country_code,'published',true)
    RETURNING id INTO off_id;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('storage.operation','storage.object.upload',true);
  INSERT INTO storage.objects(bucket_id,name) VALUES('technician-photos',photo),('technician-photos',replacement);
  UPDATE technician_profiles SET photo_path=photo WHERE id=t;
  PERFORM pg_temp.check_image('owner uploads and saves photo',(SELECT photo_path=photo FROM technician_profiles WHERE id=t));
  PERFORM pg_temp.check_image('foreign folder upload denied',pg_temp.image_attempt(format(
    'INSERT INTO storage.objects(bucket_id,name) VALUES(''technician-photos'',%L)',t2||'/'||gen_random_uuid()||'.jpg'))='42501');
  PERFORM pg_temp.check_image('non image filename denied',pg_temp.image_attempt(format(
    'INSERT INTO storage.objects(bucket_id,name) VALUES(''technician-photos'',%L)',t||'/evil.svg'))='42501');
  PERFORM pg_temp.check_image('foreign photo pointer denied',pg_temp.image_attempt(format(
    'UPDATE technician_profiles SET photo_path=%L WHERE id=%L',foreign_photo,t))='23514');
  PERFORM pg_temp.check_image('missing photo object denied',pg_temp.image_attempt(format(
    'UPDATE technician_profiles SET photo_path=%L WHERE id=%L',t||'/'||gen_random_uuid()||'.jpg',t))='23514');
  PERFORM set_config('storage.operation','storage.object.get_authenticated',true);
  PERFORM pg_temp.check_image('owner reads own photo',(SELECT count(*)=1 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  PERFORM pg_temp.check_image('technician cannot read another photo',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=foreign_photo));
  FOREACH op IN ARRAY ARRAY['object.sign','object.sign_many','render.image_sign','object.copy','s3.object.get',''] LOOP
    PERFORM set_config('storage.operation',op,true);
    PERFORM pg_temp.check_image('owner denied operation '||op,(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  END LOOP;
  RESET ROLE;

  -- An acceptance with ANOTHER company must not reveal this pair.
  INSERT INTO offer_requests(company_id,technician_id) VALUES(other_c,t) RETURNING id INTO rq;
  UPDATE offer_requests SET status='accepted' WHERE id=rq;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('storage.operation','storage.object.get_authenticated',true);
  PERFORM pg_temp.check_image('locked view hides photo and name',(SELECT photo_path IS NULL AND first_name IS NULL FROM technician_public_view WHERE id=t));
  PERFORM pg_temp.check_image('known path still denied to locked company',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  PERFORM pg_temp.check_image('company cannot bypass view with base table',(SELECT count(*)=0 FROM technician_profiles WHERE id=t));
  INSERT INTO offer_requests(company_id,technician_id) VALUES(cid,t) RETURNING id INTO rq;
  PERFORM pg_temp.check_image('pending direct offer keeps view locked',(SELECT photo_path IS NULL FROM technician_public_view WHERE id=t));
  PERFORM pg_temp.check_image('pending direct offer keeps storage locked',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE offer_requests SET status='accepted' WHERE id=rq;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO offer_requests(company_id,technician_id,offer_id) VALUES(cid,t,off_id);
  PERFORM pg_temp.check_image('prior direct acceptance unlocks name and photo despite new pending',(SELECT photo_path=photo AND first_name IS NOT NULL FROM technician_public_view WHERE id=t));
  PERFORM pg_temp.check_image('accepted direct offer unlocks actual storage row',(SELECT count(*)=1 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  PERFORM pg_temp.check_image('unselected upload inaccessible to company',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=replacement));
  FOREACH op IN ARRAY ARRAY['object.sign','object.sign_many','render.image_sign','object.list','object.copy',''] LOOP
    PERFORM set_config('storage.operation',op,true);
    PERFORM pg_temp.check_image('unlocked company denied operation '||op,(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  END LOOP;
  PERFORM set_config('storage.operation','storage.object.upload',true);
  PERFORM pg_temp.check_image('company cannot upload technician photo',pg_temp.image_attempt(format(
    'INSERT INTO storage.objects(bucket_id,name) VALUES(''technician-photos'',%L)',t||'/'||gen_random_uuid()||'.jpg'))='42501');
  PERFORM set_config('storage.operation','storage.object.delete_many',true);
  DELETE FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo;
  RESET ROLE;
  PERFORM pg_temp.check_image('company cannot delete photo',(SELECT count(*)=1 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));

  -- Exercise the independent application path with the real acceptance trigger.
  DELETE FROM offer_requests WHERE company_id=cid AND technician_id=t;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO offer_applications(company_id,technician_id,offer_id) VALUES(cid,t,off_id) RETURNING id INTO ap;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('storage.operation','storage.object.get_authenticated',true);
  PERFORM pg_temp.check_image('pending application keeps photo locked',(SELECT photo_path IS NULL FROM technician_public_view WHERE id=t)
    AND (SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  UPDATE offer_applications SET status='accepted' WHERE id=ap;
  PERFORM pg_temp.check_image('accepted application unlocks view',(SELECT photo_path=photo AND first_name IS NOT NULL FROM technician_public_view WHERE id=t));
  PERFORM pg_temp.check_image('accepted application unlocks storage',(SELECT count(*)=1 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  RESET ROLE;

  -- Same company in each team role. Platform admin authorizes temporary role changes.
  FOREACH member_role IN ARRAY ARRAY['viewer','recruiter','admin']::public.company_member_role[] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_u,'role','authenticated')::text,true);
    UPDATE company_members SET role=member_role WHERE user_id=cu;
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    PERFORM set_config('storage.operation','storage.object.upload',true);
    PERFORM pg_temp.check_image(member_role||' logo upload permissions',pg_temp.image_attempt(format(
      'INSERT INTO storage.objects(bucket_id,name) VALUES(''company-logos'',%L)',logo))=CASE WHEN member_role='admin' THEN 'OK' ELSE '42501' END);
    -- Existing object, right folder: isolate column permission from upload denial.
    UPDATE companies SET logo_path=NULL WHERE id=cid;
    PERFORM set_config('storage.operation','storage.object.get_authenticated',true);
    PERFORM pg_temp.check_image(member_role||' reads unlocked technician photo',(SELECT count(*)=1 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE companies SET logo_path=logo WHERE id=cid;
  PERFORM pg_temp.check_image('admin saves logo',(SELECT logo_path=logo FROM companies WHERE id=cid));
  INSERT INTO storage.objects(bucket_id,name) VALUES('company-logos',new_logo);
  UPDATE companies SET logo_path=new_logo WHERE id=cid;
  PERFORM pg_temp.check_image('admin replaces logo',(SELECT logo_path=new_logo FROM companies WHERE id=cid));
  UPDATE companies SET logo_path=logo WHERE id=cid;
  DELETE FROM storage.objects WHERE bucket_id='company-logos' AND name=new_logo;
  PERFORM pg_temp.check_image('admin deletes obsolete logo',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='company-logos' AND name=new_logo));
  PERFORM pg_temp.check_image('missing logo object denied',pg_temp.image_attempt(format(
    'UPDATE companies SET logo_path=%L WHERE id=%L',new_logo,cid))='23514');
  PERFORM pg_temp.check_image('admin cannot point to another company logo',pg_temp.image_attempt(format(
    'UPDATE companies SET logo_path=%L WHERE id=%L',other_logo,cid))='23514');
  PERFORM pg_temp.check_image('admin cannot upload to another company',pg_temp.image_attempt(format(
    'INSERT INTO storage.objects(bucket_id,name) VALUES(''company-logos'',%L)',other_c||'/'||gen_random_uuid()||'.png'))='42501');
  DELETE FROM storage.objects WHERE bucket_id='company-logos' AND name=other_logo;
  RESET ROLE;
  PERFORM pg_temp.check_image('admin cannot delete another company logo',(SELECT count(*)=1 FROM storage.objects WHERE bucket_id='company-logos' AND name=other_logo));
  SET LOCAL ROLE authenticated;
  UPDATE companies SET logo_path=NULL WHERE id=cid;
  PERFORM pg_temp.check_image('admin removes logo pointer',(SELECT logo_path IS NULL FROM companies WHERE id=cid));
  UPDATE companies SET logo_path=logo WHERE id=cid;
  RESET ROLE;
  FOREACH member_role IN ARRAY ARRAY['viewer','recruiter']::public.company_member_role[] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_u,'role','authenticated')::text,true);
    UPDATE company_members SET role=member_role WHERE user_id=cu;
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    UPDATE companies SET logo_path=NULL WHERE id=cid;
    UPDATE companies SET logo_path=other_logo WHERE id=cid;
    DELETE FROM storage.objects WHERE bucket_id='company-logos' AND name=logo;
    RESET ROLE;
    PERFORM pg_temp.check_image(member_role||' cannot remove logo pointer',(SELECT logo_path=logo FROM companies WHERE id=cid));
    PERFORM pg_temp.check_image(member_role||' cannot delete logo file',(SELECT count(*)=1 FROM storage.objects WHERE bucket_id='company-logos' AND name=logo));
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_u,'role','authenticated')::text,true);
  UPDATE company_members SET role=original_role WHERE user_id=cu;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE technician_profiles SET photo_path=replacement WHERE id=t;
  PERFORM pg_temp.check_image('owner changes photo',(SELECT photo_path=replacement FROM technician_profiles WHERE id=t));
  UPDATE companies SET logo_path=NULL WHERE id=cid;
  PERFORM pg_temp.check_image('technician cannot upload company logo',pg_temp.image_attempt(format(
    'INSERT INTO storage.objects(bucket_id,name) VALUES(''company-logos'',%L)',new_logo))='42501');
  RESET ROLE;
  PERFORM pg_temp.check_image('technician cannot change company logo',(SELECT logo_path=logo FROM companies WHERE id=cid));
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check_image('old photo inaccessible after replacement',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  PERFORM pg_temp.check_image('replacement visible after save',(SELECT count(*)=1 FROM storage.objects WHERE bucket_id='technician-photos' AND name=replacement));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE technician_profiles SET photo_path=NULL WHERE id=t;
  PERFORM pg_temp.check_image('owner removes photo pointer',(SELECT photo_path IS NULL FROM technician_profiles WHERE id=t));
  PERFORM set_config('storage.operation','storage.object.delete_many',true);
  DELETE FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo;
  RESET ROLE;
  PERFORM pg_temp.check_image('owner deletes obsolete file',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=photo));
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('storage.operation','storage.object.get_authenticated',true);
  PERFORM pg_temp.check_image('removal preserves name for initials but clears photo',(SELECT photo_path IS NULL AND first_name IS NOT NULL FROM technician_public_view WHERE id=t));
  PERFORM pg_temp.check_image('removed photo inaccessible even if bytes remain',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=replacement));
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',tu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE technician_profiles SET photo_path=replacement WHERE id=t;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_u,'role','authenticated')::text,true);
  UPDATE profiles SET status='suspended' WHERE id=tu;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check_image('suspended technician hidden in view',(SELECT count(*)=0 FROM technician_public_view WHERE id=t));
  PERFORM pg_temp.check_image('suspended technician photo denied',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=replacement));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_u,'role','authenticated')::text,true);
  UPDATE profiles SET status='active' WHERE id=tu;
  UPDATE profiles SET status='blocked' WHERE id=cu;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.check_image('blocked company cannot download',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=replacement));
  PERFORM pg_temp.check_image('blocked company view empty',(SELECT count(*)=0 FROM technician_public_view WHERE id=t));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_u,'role','authenticated')::text,true);
  UPDATE profiles SET status='active' WHERE id=cu;
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  SET LOCAL ROLE anon;
  PERFORM pg_temp.check_image('anonymous known photo path denied',(SELECT count(*)=0 FROM storage.objects WHERE bucket_id='technician-photos' AND name=replacement));
  PERFORM pg_temp.check_image('anonymous view empty',(SELECT count(*)=0 FROM technician_public_view WHERE id=t));
  RESET ROLE;
  -- Actual auth deletion runs 039 and the new tombstone extension; rolls back.
  DELETE FROM auth.users WHERE id=tu;
  PERFORM pg_temp.check_image('account deletion clears photo pointer',(SELECT photo_path IS NULL FROM technician_profiles WHERE id=t));
  PERFORM pg_temp.check_image('private photos public logos and size limits',(SELECT NOT public AND file_size_limit=2097152 AND allowed_mime_types=ARRAY['image/jpeg'] FROM storage.buckets WHERE id='technician-photos')
    AND (SELECT public AND file_size_limit=2097152 AND allowed_mime_types=ARRAY['image/png'] FROM storage.buckets WHERE id='company-logos'));
END $test$;
SELECT test,passed FROM image_results;
ROLLBACK;
