-- H1, resto: la experiencia en aeronaves era el único reemplazo que seguía
-- separando DELETE e INSERT desde el cliente. El DELETE entra en su propia
-- sentencia, así que un INSERT que falle después (rango de años, rating
-- inexistente, RLS, red) deja al técnico SIN experiencia declarada y la
-- pantalla dice "guardado". Misma forma que replace_technician_engines (082):
-- se valida la carga entera ANTES de borrar y todo va en una transacción.
-- INVOKER para conservar la RLS de la tabla (tae_insert_own / tae_delete_own).
CREATE OR REPLACE FUNCTION public.replace_technician_aircraft_experience(p_technician_id uuid, p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO public AS $$
DECLARE entry record; seen uuid[] := '{}';
BEGIN
  IF NOT public.is_active_user() OR p_technician_id IS DISTINCT FROM public.my_technician_id() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized.';
  END IF;
  PERFORM 1 FROM public.technician_profiles WHERE id=p_technician_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' THEN RAISE EXCEPTION 'Expected an aircraft array'; END IF;
  FOR entry IN SELECT * FROM jsonb_to_recordset(p_entries) AS x(aircraft_type_rating_id uuid, years numeric) LOOP
    PERFORM 1 FROM public.aircraft_type_ratings WHERE id=entry.aircraft_type_rating_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown aircraft type rating'; END IF;
    IF entry.years IS NOT NULL AND (entry.years<0 OR entry.years>70 OR entry.years='NaN'::numeric) THEN
      RAISE EXCEPTION 'Experience years must be between 0 and 70';
    END IF;
    IF entry.aircraft_type_rating_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate aircraft type rating'; END IF;
    seen:=array_append(seen,entry.aircraft_type_rating_id);
  END LOOP;
  DELETE FROM public.technician_aircraft_experience WHERE technician_id=p_technician_id;
  INSERT INTO public.technician_aircraft_experience(technician_id,aircraft_type_rating_id,years)
    SELECT p_technician_id,x.aircraft_type_rating_id,x.years
    FROM jsonb_to_recordset(p_entries) AS x(aircraft_type_rating_id uuid, years numeric);
END $$;

COMMENT ON FUNCTION public.replace_technician_aircraft_experience(uuid,jsonb) IS
  'Fase 10 (084): reemplazo transaccional de technician_aircraft_experience. Valida antes de borrar. Espejo de replace_technician_engines (082).';

REVOKE ALL ON FUNCTION public.replace_technician_aircraft_experience(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_technician_aircraft_experience(uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
