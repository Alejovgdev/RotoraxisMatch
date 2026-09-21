-- ============================================================
-- AviationJobTalent V2 — Migration 090: CFM56 y V2500 en variantes
-- ============================================================
-- Created: 2026-09-21 (Fase 10, sesión 3, punto 2). Requiere la 089.
--
-- El seed de la 071 tenía UNA fila por familia: "CFM56" y "V2500". Con eso un
-- 737NG y un A320 CFM daban el MISMO motor exacto frente a cualquier oferta de
-- CFM56, cuando uno lleva el -7B y el otro el -5A o el -5B. Esta migración:
--
--   1. Crea las variantes, una fila por serie certificada.
--   2. Deja "CFM56" y "V2500" como genéricas de su familia (is_generic, 089):
--      sólo dan crédito de familia. Siguen activas —son el motor de un type
--      rating vigente—; los selectores no las ofrecen porque son genéricas.
--   3. Enlaza a su variante los type ratings que admiten UNA sola. Los que
--      admiten varias (A320 CFM: -5A o -5B; A320 IAE: -A1 o -A5) se quedan en
--      la genérica: dan familia, no exacto. Sin tabla rating↔motores múltiple
--      (pendiente en docs/fase-10.md).
--
-- Motores declarados y ofertas que apuntan a "CFM56" o "V2500" NO se
-- reasignan: siguen en la fila de familia, ahora genérica. El 2026-09-21 eran
-- 0 y 0 (y 0 motores declarados y 0 ofertas de motor en toda la base).
--
-- ── Fuentes (TCDS oficiales de EASA, consultadas el 2026-09-21) ─────────
-- Variantes:
--   CFM56-2, CFM56-3  E.066 issue 02 (17-03-2023), "CFM56-2 & CFM56-3 series":
--                     modelos CFM56-2, -2A, -2B, -3, -3B, -3C.
--   CFM56-5A          E.067 issue 02 (17-04-2018), "CFM56-5 series": CFM56-5,
--                     -5-A1/F, -5A3, -5A4, -5A4/F, -5A5, -5A5/F.
--   CFM56-5B, -5C     E.003 issue 06 (09-01-2023), "CFM56-5B and CFM56-5C".
--   CFM56-7B          E.004 issue 07 (09-01-2023), "CFM56-7B series" (incluye
--                     los -7B/2, -7B/3 y -7BE).
--   V2500-A5, -D5, -E5  IM.E.069 issue 05 (20-12-2022): V2522/V2524/V2527/
--                     V2527E/V2527M/V2530/V2533-A5, V2525/V2528-D5, V2531-E5.
--   V2500-A1          A.064 issue 62 (26-06-2026), Airbus A318–A321: el
--                     A320-231 lleva "V2500-A1 jet engines (MOD 20165)". La
--                     IM.E.069 vigente ya no lista la serie A1.
-- Type ratings enlazados a UNA variante:
--   B737-600/700/800/900 -> CFM56-7B  IM.A.120 issue 29 (16-12-2025), sección
--                     NG: "2 CFM 56-7B or -7B/2 or -7B/3 or -7BE Series".
--   B737-300/400/500  -> CFM56-3   E.066, tabla de aplicación: -3-B1, -3B-2 y
--                     -3C-1 en 737-300/-400/-500.
--   DC-8 (CFM56)      -> CFM56-2   E.066, tabla de aplicación: -2-C1/-C5 en
--                     DC8-71/-72/-72F/-73, -2-C3/-C6 en DC8-72F.
--   A340 (CFM56)      -> CFM56-5C  A.015 issue 28 (15-01-2026): sólo modelos
--                     CFM56-5C2/-5C3/-5C4 (el A340-500/600 es Trent 500).
--   MD-90 (IAE V2500) -> V2500-D5  IM.A.211 issue 3.0 (04-07-2025): "2 IAE
--                     V2525-D5 or V2528-D5 engines".
-- Type ratings que se quedan en la genérica (más de una variante):
--   A318/A319/A320/A321 (CFM56)  -5A (E.067) y -5B (E.003 nota 9; A.064).
--   A319/A320/A321 (IAE V2500)   -A1 (A320-231) y -A5 (A.064).
--
-- Granularidad: una fila por SERIE del TCDS (CFM56-7B cubre -7B26, -7B27/3,
-- -7BE…), no por modelo de empuje: es lo que un técnico declara y lo que
-- distingue un motor de otro en mantenimiento.
--
-- Propulsión: todas turbofán, igual que la fila agregada. El alcance de la 083
-- resuelve la propulsión por engine_id; reenlazar un rating de "CFM56" a
-- "CFM56-7B" no la cambia, y la autocomprobación lo exige.
--
-- Aplicación única, como 064–089: las post-condiciones cuentan el estado de
-- la primera aplicación (164 motores de la 071, dos agregadas, siete ratings).
-- ============================================================


-- ── 0. Referencias existentes a las agregadas, para comprobar que no se mueven

CREATE TEMP TABLE _090_before AS
SELECT e.display_name,
       (SELECT count(*) FROM public.technician_engine_experience t WHERE t.engine_id = e.id) AS declared,
       (SELECT count(*) FROM public.offers o WHERE o.required_engine_id = e.id) AS offers
  FROM public.engines e
 WHERE (e.manufacturer, e.display_name) IN (('CFM International', 'CFM56'), ('International Aero Engines', 'V2500'));


-- ── 1. Variantes ───────────────────────────────────────────

CREATE TEMP TABLE _engine_variant (
  manufacturer TEXT NOT NULL,
  family       TEXT NOT NULL,
  display_name TEXT NOT NULL
);

INSERT INTO _engine_variant (manufacturer, family, display_name) VALUES
  ('CFM International',          'CFM56', 'CFM56-2'),
  ('CFM International',          'CFM56', 'CFM56-3'),
  ('CFM International',          'CFM56', 'CFM56-5A'),
  ('CFM International',          'CFM56', 'CFM56-5B'),
  ('CFM International',          'CFM56', 'CFM56-5C'),
  ('CFM International',          'CFM56', 'CFM56-7B'),
  ('International Aero Engines', 'V2500', 'V2500-A1'),
  ('International Aero Engines', 'V2500', 'V2500-A5'),
  ('International Aero Engines', 'V2500', 'V2500-D5'),
  ('International Aero Engines', 'V2500', 'V2500-E5');

INSERT INTO public.engines (manufacturer, family, engine_type, display_name, is_active, is_generic)
SELECT manufacturer, family, 'turbofan', display_name, true, false FROM _engine_variant
ON CONFLICT (manufacturer, display_name) DO NOTHING;


-- ── 2. Las agregadas pasan a genéricas de su familia ─────────

UPDATE public.engines
   SET is_generic = true
 WHERE (manufacturer, display_name) IN (('CFM International', 'CFM56'), ('International Aero Engines', 'V2500'));


-- ── 3. Type ratings de una sola variante ────────────────────
-- Por la clave natural (easa_endorsement, UNIQUE) y sólo si siguen en la
-- agregada: un rating que alguien ya hubiera movido no se pisa.

CREATE TEMP TABLE _rating_variant (
  easa_endorsement TEXT NOT NULL,
  manufacturer     TEXT NOT NULL,
  generic_name     TEXT NOT NULL,
  variant_name     TEXT NOT NULL
);

INSERT INTO _rating_variant (easa_endorsement, manufacturer, generic_name, variant_name) VALUES
  ('Boeing 737-600/700/800/900 (CFM56)', 'CFM International',          'CFM56', 'CFM56-7B'),
  ('Boeing 737-300/400/500 (CFM56)',     'CFM International',          'CFM56', 'CFM56-3'),
  ('DC-8 (CFM56)',                       'CFM International',          'CFM56', 'CFM56-2'),
  ('Airbus A340 (CFM56)',                'CFM International',          'CFM56', 'CFM56-5C'),
  ('MD-90 (IAE V2500)',                  'International Aero Engines', 'V2500', 'V2500-D5');

UPDATE public.aircraft_type_ratings r
   SET engine_id = v.id
  FROM _rating_variant rv
  JOIN public.engines g ON g.manufacturer = rv.manufacturer AND g.display_name = rv.generic_name
  JOIN public.engines v ON v.manufacturer = rv.manufacturer AND v.display_name = rv.variant_name
 WHERE r.easa_endorsement = rv.easa_endorsement
   AND r.engine_id = g.id;


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE
  v_count   INT;
  v_bad     TEXT;
  v_cfm     UUID;
  v_v2500   UUID;
  v_7b      UUID;
  v_d5      UUID;
  v_737ng   UUID;
  v_a320cfm UUID;
  v_a320iae UUID;
  v_md90    UUID;
  v_reason  TEXT;
BEGIN
  -- Las diez variantes, con sus atributos. Un ON CONFLICT DO NOTHING contra una
  -- fila previa distinta pasaría en silencio sin esto.
  SELECT count(*) INTO v_count
    FROM _engine_variant s
    JOIN public.engines e ON e.manufacturer = s.manufacturer AND e.display_name = s.display_name
   WHERE e.family = s.family AND e.engine_type = 'turbofan' AND e.is_active AND NOT e.is_generic;
  IF v_count <> 10 THEN
    RAISE EXCEPTION '090: sólo % de las 10 variantes están con sus atributos.', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.engines;
  IF v_count <> 174 THEN
    RAISE EXCEPTION '090: esperaba 174 motores (164 + 10), hay %.', v_count;
  END IF;

  -- Las dos agregadas: genéricas, activas, misma familia y tipo que antes.
  SELECT id INTO v_cfm FROM public.engines
   WHERE manufacturer = 'CFM International' AND display_name = 'CFM56'
     AND family = 'CFM56' AND engine_type = 'turbofan' AND is_generic AND is_active;
  SELECT id INTO v_v2500 FROM public.engines
   WHERE manufacturer = 'International Aero Engines' AND display_name = 'V2500'
     AND family = 'V2500' AND engine_type = 'turbofan' AND is_generic AND is_active;
  IF v_cfm IS NULL OR v_v2500 IS NULL THEN
    RAISE EXCEPTION '090: CFM56 o V2500 no quedaron como genéricas activas de su familia.';
  END IF;

  SELECT count(*) INTO v_count FROM public.engines WHERE is_generic;
  IF v_count <> 19 THEN
    RAISE EXCEPTION '090: esperaba 19 genéricas (17 de la 089 + CFM56 + V2500), hay %.', v_count;
  END IF;

  -- Cada rating de una sola variante, en su variante.
  SELECT string_agg(rv.easa_endorsement, ', ') INTO v_bad
    FROM _rating_variant rv
    LEFT JOIN public.aircraft_type_ratings r ON r.easa_endorsement = rv.easa_endorsement
    LEFT JOIN public.engines e ON e.id = r.engine_id
   WHERE e.display_name IS DISTINCT FROM rv.variant_name OR e.manufacturer IS DISTINCT FROM rv.manufacturer;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '090: ratings sin su variante: %.', v_bad;
  END IF;

  -- En las genéricas sólo quedan los dos A320, uno en cada una.
  SELECT id INTO v_a320cfm FROM public.aircraft_type_ratings
   WHERE easa_endorsement = 'Airbus A318/A319/A320/A321 (CFM56)' AND engine_id = v_cfm;
  SELECT id INTO v_a320iae FROM public.aircraft_type_ratings
   WHERE easa_endorsement = 'Airbus A319/A320/A321 (IAE V2500)' AND engine_id = v_v2500;
  SELECT count(*) INTO v_count FROM public.aircraft_type_ratings WHERE engine_id IN (v_cfm, v_v2500);
  IF v_a320cfm IS NULL OR v_a320iae IS NULL OR v_count <> 2 THEN
    RAISE EXCEPTION '090: en CFM56/V2500 genéricas deberían quedar sólo los dos A320 (hay % ratings).', v_count;
  END IF;

  -- La propulsión de los ratings de estas familias no cambia (alcance 083).
  SELECT count(*) INTO v_count
    FROM public.aircraft_type_ratings r JOIN public.engines e ON e.id = r.engine_id
   WHERE e.family IN ('CFM56', 'V2500') AND e.engine_type <> 'turbofan';
  IF v_count <> 0 THEN
    RAISE EXCEPTION '090: % ratings CFM56/V2500 cambiaron de propulsión.', v_count;
  END IF;

  -- Declarados y ofertas: ni se reasignan ni aparecen en las variantes.
  SELECT string_agg(b.display_name, ', ') INTO v_bad
    FROM _090_before b
    JOIN public.engines e ON e.display_name = b.display_name AND e.id IN (v_cfm, v_v2500)
   WHERE b.declared <> (SELECT count(*) FROM public.technician_engine_experience t WHERE t.engine_id = e.id)
      OR b.offers   <> (SELECT count(*) FROM public.offers o WHERE o.required_engine_id = e.id);
  IF v_bad IS NOT NULL OR (SELECT count(*) FROM _090_before) <> 2 THEN
    RAISE EXCEPTION '090: cambiaron las referencias a las agregadas: %.', coalesce(v_bad, 'faltan filas previas');
  END IF;
  IF EXISTS (SELECT 1 FROM public.technician_engine_experience t
               JOIN public.engines e ON e.id = t.engine_id
               JOIN _engine_variant s ON s.manufacturer = e.manufacturer AND s.display_name = e.display_name)
     OR EXISTS (SELECT 1 FROM public.offers o
               JOIN public.engines e ON e.id = o.required_engine_id
               JOIN _engine_variant s ON s.manufacturer = e.manufacturer AND s.display_name = e.display_name) THEN
    RAISE EXCEPTION '090: hay declaraciones u ofertas en variantes recién creadas.';
  END IF;

  -- El núcleo de elegibilidad (080) con los enlaces nuevos: la B1 del 737NG
  -- entra por el exacto, la del A320 CFM por la familia; la B2 y otra familia
  -- no. Es el mismo núcleo que valida validate:application-eligibility.
  SELECT id INTO v_7b FROM public.engines WHERE manufacturer = 'CFM International' AND display_name = 'CFM56-7B';
  SELECT id INTO v_d5 FROM public.engines WHERE manufacturer = 'International Aero Engines' AND display_name = 'V2500-D5';
  SELECT id INTO v_737ng FROM public.aircraft_type_ratings WHERE easa_endorsement = 'Boeing 737-600/700/800/900 (CFM56)';
  SELECT id INTO v_md90 FROM public.aircraft_type_ratings WHERE easa_endorsement = 'MD-90 (IAE V2500)';

  v_reason := public.offer_eligibility_reason('engine', v_7b, false, 1, 0, ARRAY['mechanic'], ARRAY['B1.1'], ARRAY[v_737ng]);
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION '090: B1.1 + 737NG ante CFM56-7B no es elegible (%).', v_reason; END IF;
  v_reason := public.offer_eligibility_reason('engine', v_7b, false, 1, 0, ARRAY['mechanic'], ARRAY['B1.1'], ARRAY[v_a320cfm]);
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION '090: B1.1 + A320 CFM ante CFM56-7B no es elegible (%).', v_reason; END IF;
  v_reason := public.offer_eligibility_reason('engine', v_d5, false, 1, 0, ARRAY['mechanic'], ARRAY['B1.1'], ARRAY[v_a320iae]);
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION '090: B1.1 + A320 IAE ante V2500-D5 no es elegible (%).', v_reason; END IF;
  v_reason := public.offer_eligibility_reason('engine', v_7b, false, 1, 0, ARRAY['avionic'], ARRAY['B2'], ARRAY[v_737ng]);
  IF v_reason IS DISTINCT FROM 'no_engine_experience' THEN RAISE EXCEPTION '090: B2 + 737NG ante CFM56-7B debería quedar fuera (%).', v_reason; END IF;
  v_reason := public.offer_eligibility_reason('engine', v_7b, false, 1, 0, ARRAY['mechanic'], ARRAY['B1.1'], ARRAY[v_md90]);
  IF v_reason IS DISTINCT FROM 'no_engine_experience' THEN RAISE EXCEPTION '090: B1.1 + MD-90 ante CFM56-7B debería quedar fuera (%).', v_reason; END IF;

  RAISE NOTICE '090: 10 variantes CFM56/V2500, 2 genéricas nuevas, 5 ratings enlazados a variante, 2 en genérica.';
END $$;

DROP TABLE _090_before;
DROP TABLE _engine_variant;
DROP TABLE _rating_variant;

NOTIFY pgrst, 'reload schema';
