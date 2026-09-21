-- ============================================================
-- AviationJobTalent V2 — Migration 089: «genérico» separado de «inactivo»
-- en el catálogo de motores
-- ============================================================
-- Created: 2026-09-21 (Fase 10, sesión 3, punto 1)
--
-- Hasta aquí `engines.is_active = false` decía dos cosas a la vez:
--   - "esta fila no nombra un modelo" (las 17 "<fabricante> (model not
--     specified)" del seed de la 071), y
--   - "esta fila no se ofrece en los selectores".
-- El matching negaba el crédito de motor exacto por is_active, así que
-- desactivar un modelo concreto —retirarlo de los selectores— rebajaba a
-- "misma familia" a quien ya lo había declarado o lo tenía por un type rating
-- B1. Ahora son dos columnas:
--
--   is_generic  la fila no nombra un modelo. Nunca da motor exacto, sólo
--               familia, y ningún selector la ofrece: nadie la declara ni la
--               pide. El scorer lo lee de aquí (matchEngineEvidence).
--   is_active   la fila se ofrece en los selectores. Desactivar un modelo
--               concreto ya no cambia la puntuación de quien lo tiene.
--
-- Las 17 genéricas pasan a is_generic = true y siguen inactivas: no se toca
-- is_active de ninguna fila. Sin CHECK que ate una columna a la otra: una
-- genérica activa (CFM56 y V2500 desde la 090) y un modelo concreto inactivo
-- son justo los casos que esta separación permite.
--
-- ── Elegibilidad: no cambia ─────────────────────────────────────────────
-- El núcleo SQL de la 080 (offer_eligibility_reason) no lee engines.is_active
-- y admite por id o por familia; en TS la vía (b) admite el exacto y la
-- familia. Que un exacto pase a familia no cambia quién entra, así que ni el
-- núcleo ni `validate:application-eligibility` cambian.
--
-- Aplicación única, como 064–088: la autocomprobación cuenta las 17 del seed.
-- ============================================================


ALTER TABLE public.engines
  ADD COLUMN IF NOT EXISTS is_generic BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.engines.is_generic IS
  'Fase 10 (089): la fila no nombra un modelo ("<fabricante> (model not specified)", CFM56 y V2500 '
  'agregados). Nunca da crédito de motor exacto, sólo de familia, y ningún selector la ofrece.';

COMMENT ON COLUMN public.engines.is_active IS
  'La fila se ofrece en los selectores. Desde la 089 no afecta a la puntuación: el crédito exacto '
  'lo niega is_generic.';

UPDATE public.engines
   SET is_generic = true
 WHERE display_name LIKE '%(model not specified)'
   AND NOT is_generic;


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE
  v_generic          INT;
  v_generic_by_name  INT;
  v_generic_inactive INT;
  v_inactive         INT;
  v_ratings_generic  INT;
  v_ratings_inactive INT;
BEGIN
  SELECT count(*) INTO v_generic FROM public.engines WHERE is_generic;
  IF v_generic <> 17 THEN
    RAISE EXCEPTION '089: esperaba 17 motores genéricos, hay %.', v_generic;
  END IF;

  -- Las 17 son exactamente las del patrón de nombre del seed, en las dos
  -- direcciones.
  SELECT count(*) INTO v_generic_by_name FROM public.engines
   WHERE is_generic = (display_name LIKE '%(model not specified)');
  IF v_generic_by_name <> (SELECT count(*) FROM public.engines) THEN
    RAISE EXCEPTION '089: is_generic no coincide con el patrón "(model not specified)" en % filas.',
      (SELECT count(*) FROM public.engines) - v_generic_by_name;
  END IF;

  -- is_active no se ha tocado: las 17 siguen inactivas y no hay más inactivas.
  SELECT count(*) FILTER (WHERE is_generic AND NOT is_active), count(*) FILTER (WHERE NOT is_active)
    INTO v_generic_inactive, v_inactive
    FROM public.engines;
  IF v_generic_inactive <> 17 OR v_inactive <> 17 THEN
    RAISE EXCEPTION '089: is_active cambió (genéricas inactivas %, inactivas %; esperaba 17 y 17).',
      v_generic_inactive, v_inactive;
  END IF;

  -- Los ratings que daban sólo familia por is_active la siguen dando por
  -- is_generic: el mismo conjunto.
  SELECT count(*) INTO v_ratings_generic
    FROM public.aircraft_type_ratings r JOIN public.engines e ON e.id = r.engine_id WHERE e.is_generic;
  SELECT count(*) INTO v_ratings_inactive
    FROM public.aircraft_type_ratings r JOIN public.engines e ON e.id = r.engine_id WHERE NOT e.is_active;
  IF v_ratings_generic <> v_ratings_inactive THEN
    RAISE EXCEPTION '089: % ratings en genéricas frente a % en inactivas; deberían ser el mismo conjunto.',
      v_ratings_generic, v_ratings_inactive;
  END IF;

  RAISE NOTICE '089: 17 motores genéricos (siguen inactivos), % ratings enlazados a ellos.', v_ratings_generic;
END $$;

NOTIFY pgrst, 'reload schema';
