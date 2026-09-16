-- ============================================================
-- AviationJobTalent V2 — Migration 069: aircraft_type_ratings.engine_id
-- ============================================================
-- Created: 2026-09-15 (Fase 10, paso 2)
--
-- La ÚNICA fuente del "motor implícito en un type rating": un técnico con una
-- habilitación en un rating tiene experiencia en el motor que ese rating lleva
-- en esta columna.
--
-- ⚠ engine_manufacturer y engine_family NO se usan para eso, nunca. Son el texto
--   de la fuente EASA y están sucios (verificado 2026-09-15):
--     - `Rolls-Royce | Corp 250` (22 ratings) es el Model 250 mal partido, que
--       también aparece como `250` (3) y `M250` (1).
--     - 12 filas con el modelo escrito en engine_manufacturer y engine_family
--       NULL (`PW307`, `HF120`, `TPE331`…).
--   Un matching que los leyera como texto daría falsos positivos. El test
--   'el escalón "motor implícito en un type rating" no se apoya en filas
--   sucias' de scripts/testMatching.ts lo fija.
--
-- Nullable, y un rating sin motor se queda en NULL: no aporta motor implícito,
-- que es lo correcto cuando no se sabe cuál es. Las dos columnas de texto se
-- conservan como dato de origen.
--
-- El backfill va en una migración aparte, con el seed de `engines`.
-- ============================================================


ALTER TABLE public.aircraft_type_ratings
  ADD COLUMN IF NOT EXISTS engine_id UUID REFERENCES public.engines(id);

COMMENT ON COLUMN public.aircraft_type_ratings.engine_id IS
  'Motor del rating (Fase 10). Única fuente del motor implícito en el matching; '
  'engine_manufacturer/engine_family son texto de origen y no se usan para inferirlo.';

CREATE INDEX IF NOT EXISTS idx_aircraft_type_ratings_engine
  ON public.aircraft_type_ratings (engine_id);


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.aircraft_type_ratings'::regclass
      AND confrelid = 'public.engines'::regclass
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'Falta la FK aircraft_type_ratings.engine_id -> engines.';
  END IF;
  RAISE NOTICE 'aircraft_type_ratings.engine_id añadida (nullable, FK a engines).';
END $$;

NOTIFY pgrst, 'reload schema';
