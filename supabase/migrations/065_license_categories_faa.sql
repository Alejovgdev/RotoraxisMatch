-- ============================================================
-- AviationJobTalent V2 — Migration 065: categorías FAA (A, P, A&P)
-- ============================================================
-- Created: 2026-09-15 (Fase 10, paso 2)
--
-- Añade al catálogo GLOBAL de categorías las tres de la FAA. El catálogo es
-- global y no por autoridad porque las cuatro Part-66 comparten códigos: qué
-- autoridad admite qué código lo dice `authority_licenses` (066), no esta tabla.
--
-- `category_group = 'FAA'`, no 'A': el grupo 'A' ya es el de A1–A4 Part-66, y
-- la `A` de la FAA (Airframe) no tiene nada que ver con ellas.
--
-- ⚠ EXPOSICIÓN TEMPORAL, asumida. Tres FKs apuntan a license_categories(code):
--   technician_licenses, technician_habilitations y offers. Desde esta
--   migración las tres aceptan 'A', 'P' y 'A&P' sin autoridad al lado — la
--   columna `authority` llega en el paso 3. Ninguna pantalla puede escribirlos:
--   los selectores leen LICENSE_CATEGORIES en TS (catalogRepository no consulta
--   esta tabla). Sólo una llamada directa a la API podría, y el resultado sería
--   una fila que el paso 3 tiene que validar igual que las demás.
-- ============================================================


INSERT INTO public.license_categories (code, label, category_group, sort_order) VALUES
  ('A',   'A — Airframe (FAA)',                 'FAA', 14),
  ('P',   'P — Powerplant (FAA)',               'FAA', 15),
  ('A&P', 'A&P — Airframe and Powerplant (FAA)', 'FAA', 16)
ON CONFLICT (code) DO NOTHING;


DO $$
DECLARE
  v_faa    INT;
  v_part66 INT;
BEGIN
  SELECT count(*) INTO v_faa
  FROM public.license_categories WHERE code IN ('A', 'P', 'A&P') AND category_group = 'FAA';
  IF v_faa <> 3 THEN
    RAISE EXCEPTION 'Esperaba A, P y A&P con grupo FAA, encontré %.', v_faa;
  END IF;

  -- Las 13 Part-66 intactas.
  SELECT count(*) INTO v_part66
  FROM public.license_categories
  WHERE code IN ('A1','A2','A3','A4','B1.1','B1.2','B1.3','B1.4','B2','B2L','B3','L','C');
  IF v_part66 <> 13 THEN
    RAISE EXCEPTION 'Esperaba las 13 categorías Part-66, encontré %.', v_part66;
  END IF;

  RAISE NOTICE 'license_categories: 13 Part-66 + 3 FAA.';
END $$;

NOTIFY pgrst, 'reload schema';
