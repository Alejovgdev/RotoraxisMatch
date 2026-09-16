-- ============================================================
-- AviationJobTalent V2 — Migration 068: motores en el perfil del técnico
-- ============================================================
-- Created: 2026-09-15 (Fase 10, paso 2)
--
-- Motores en los que el técnico ha trabajado. Abierto a CUALQUIER técnico,
-- tenga licencia o no y sea del oficio que sea.
--
-- ⚠ NOMBRE PARALELO A technician_aircraft_experience (050), Y NO ES LO MISMO.
--   Las diferencias, escritas para que no se descubran tarde:
--     1. No cuelga de ningún type rating: apunta a `engines` (067).
--     2. SÍ PUNTÚA, y sólo en ofertas de motor: el motor declarado es el
--        escalón más alto. La 050 nació sin puntuar.
--     3. Los AÑOS NO PUNTÚAN nunca. Son display-only, igual que en la 050, y
--        hay un test que lo fija (1 año = 20 años).
--
-- El "motor implícito en un type rating" NO se escribe aquí. Se calcula en
-- lectura desde technician_habilitations -> aircraft_type_ratings.engine_id,
-- por el mismo motivo que la 050 no copia habilitaciones a su tabla: una fila
-- copiada es un duplicado que se queda huérfano cuando la habilitación se borra.
--
-- Arranca VACÍA. No se copian años desde habilitaciones ni desde experiencia de
-- aeronave: decisión tomada.
-- ============================================================


CREATE TABLE IF NOT EXISTS public.technician_engine_experience (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL
    REFERENCES public.technician_profiles(id) ON DELETE CASCADE,
  engine_id     UUID NOT NULL
    REFERENCES public.engines(id),
  -- NULL = NO DECLARADO, distinto de 0. Misma regla y mismo rango que
  -- technician_aircraft_experience.years.
  years         NUMERIC(4,1)
    CHECK (years IS NULL OR (years >= 0 AND years <= 70)),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (technician_id, engine_id)
);

COMMENT ON TABLE public.technician_engine_experience IS
  'Motores en los que el técnico ha trabajado (Fase 10), abierto a cualquier técnico. '
  'Puntúa en ofertas de motor; los años son display-only y nunca puntúan.';

CREATE INDEX IF NOT EXISTS idx_technician_engine_experience_technician
  ON public.technician_engine_experience (technician_id);

-- Dirección "quién ha trabajado en este motor": la de oferta -> técnicos.
CREATE INDEX IF NOT EXISTS idx_technician_engine_experience_engine
  ON public.technician_engine_experience (engine_id);


-- ── RLS: calcada de technician_aircraft_experience ─────────
--
-- Mismos cinco predicados que tae_* (verificados contra pg_policies el
-- 2026-09-15), incluida la ausencia de política de UPDATE: se guarda con la
-- misma semántica de reemplazo (borrar + insertar).

ALTER TABLE public.technician_engine_experience ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tee_all_admin ON public.technician_engine_experience;
CREATE POLICY tee_all_admin ON public.technician_engine_experience
  FOR ALL USING (is_admin());

DROP POLICY IF EXISTS tee_select_own ON public.technician_engine_experience;
CREATE POLICY tee_select_own ON public.technician_engine_experience
  FOR SELECT USING (technician_id = my_technician_id() AND is_active_user());

DROP POLICY IF EXISTS tee_select_company ON public.technician_engine_experience;
CREATE POLICY tee_select_company ON public.technician_engine_experience
  FOR SELECT USING (auth_role() = 'company_user' AND is_active_user());

DROP POLICY IF EXISTS tee_insert_own ON public.technician_engine_experience;
CREATE POLICY tee_insert_own ON public.technician_engine_experience
  FOR INSERT WITH CHECK (technician_id = my_technician_id() AND is_active_user());

DROP POLICY IF EXISTS tee_delete_own ON public.technician_engine_experience;
CREATE POLICY tee_delete_own ON public.technician_engine_experience
  FOR DELETE USING (technician_id = my_technician_id());


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE
  v_policies INT;
  v_rows     INT;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.technician_engine_experience'::regclass) THEN
    RAISE EXCEPTION 'RLS no está activo en technician_engine_experience.';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'technician_engine_experience';
  IF v_policies <> 5 THEN
    RAISE EXCEPTION 'Esperaba 5 políticas RLS, encontré %.', v_policies;
  END IF;

  SELECT count(*) INTO v_rows FROM public.technician_engine_experience;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'technician_engine_experience debe arrancar vacía, tiene % filas.', v_rows;
  END IF;

  RAISE NOTICE 'technician_engine_experience creada vacía, con RLS y 5 políticas.';
END $$;

NOTIFY pgrst, 'reload schema';
