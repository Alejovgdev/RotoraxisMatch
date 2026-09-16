-- ============================================================
-- AviationJobTalent V2 — Migration 067: catálogo de motores (tabla vacía)
-- ============================================================
-- Created: 2026-09-15 (Fase 10, paso 2)
--
-- Sólo la tabla. El seed va en una migración aparte, cuando el borrador del
-- catálogo esté aprobado.
--
-- Qué representa una fila: UN MOTOR tal como lo declara un técnico o lo pide
-- una oferta ("CFM56", "Arriel 2", "PT6A"). Las dos columnas de agrupación son
-- los escalones del matching de motores:
--
--   mismo id            -> motor exacto
--   mismo `family`      -> misma familia (Arriel 1 / Arriel 2)
--   mismo `engine_type` -> mismo tipo (dos turbofanes cualesquiera)
--
-- Por eso `family` se repite entre filas y la clave natural es
-- (manufacturer, display_name), no (manufacturer, family).
--
-- `engine_type` incluye 'apu': las APU (GTCP131-9, APS…) son motores que un
-- técnico declara y una oferta pide, aunque no cuelguen de ningún type rating.
-- ============================================================


CREATE TABLE IF NOT EXISTS public.engines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer TEXT NOT NULL,
  family       TEXT NOT NULL,
  engine_type  TEXT NOT NULL
    CHECK (engine_type IN ('turbofan', 'turbojet', 'turboprop', 'turboshaft', 'piston', 'apu')),
  display_name TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (manufacturer, display_name)
);

COMMENT ON TABLE public.engines IS
  'Catálogo de motores (Fase 10). family y engine_type son los escalones "misma familia" y '
  '"mismo tipo" del matching de motores. Se desactiva (is_active=false), no se borra.';

CREATE INDEX IF NOT EXISTS idx_engines_family ON public.engines (family);


-- ── RLS: catálogo público, escritura sólo admin ─────────────

ALTER TABLE public.engines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cat_eng_read ON public.engines;
CREATE POLICY cat_eng_read ON public.engines
  FOR SELECT USING (true);

DROP POLICY IF EXISTS cat_eng_admin ON public.engines;
CREATE POLICY cat_eng_admin ON public.engines
  FOR ALL USING (is_admin());


DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.engines'::regclass) THEN
    RAISE EXCEPTION 'RLS no está activo en engines.';
  END IF;
  RAISE NOTICE 'engines creada (vacía) con RLS.';
END $$;

NOTIFY pgrst, 'reload schema';
