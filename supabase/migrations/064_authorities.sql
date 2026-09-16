-- ============================================================
-- AviationJobTalent V2 — Migration 064: autoridades de licencia
-- ============================================================
-- Created: 2026-09-15 (Fase 10, paso 2 — sólo esquema y datos)
--
-- Qué abre:
--   Hasta hoy toda licencia era EASA sin decirlo. La plataforma pasa a cinco
--   autoridades: EASA, UK CAA, CASA (Australia), UAE GCAA y FAA. Esta tabla es
--   el catálogo; qué códigos admite cada una lo dice `authority_licenses`
--   (migración 066).
--
--   `has_type_ratings` es false SÓLO en FAA: el certificado A&P (14 CFR 65) no
--   lleva habilitaciones de tipo. Las cuatro Part-66 comparten el catálogo de
--   aeronaves.
--
-- Qué NO hace:
--   No toca `technician_licenses` ni `technician_habilitations`. La autoridad
--   pegada a cada licencia y el cambio del UNIQUE son el paso 3.
--
-- ⚠ El `label` se pinta crudo: las etiquetas de catálogo viven en Postgres
--   (ver migración 046). "CASA (Australia)" y no "CASA" a secas porque CASA es
--   también un fabricante que aparece en aircraft_type_ratings (CASA C-212).
-- ============================================================


CREATE TABLE IF NOT EXISTS public.authorities (
  code             TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  has_type_ratings BOOLEAN NOT NULL DEFAULT true,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.authorities IS
  'Autoridades que emiten licencias de mantenimiento (Fase 10). has_type_ratings=false '
  'sólo en FAA: sin habilitaciones de tipo.';

-- DO NOTHING y no DO UPDATE: re-ejecutar no pisa una etiqueta corregida a mano.
INSERT INTO public.authorities (code, label, has_type_ratings, is_active, sort_order) VALUES
  ('EASA',   'EASA',             true,  true, 1),
  ('UK_CAA', 'UK CAA',           true,  true, 2),
  ('CASA',   'CASA (Australia)', true,  true, 3),
  ('GCAA',   'UAE GCAA',         true,  true, 4),
  ('FAA',    'FAA',              false, true, 5)
ON CONFLICT (code) DO NOTHING;


-- ── RLS: calcada de license_categories (cat_lc_read / cat_lc_admin) ──

ALTER TABLE public.authorities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cat_auth_read ON public.authorities;
CREATE POLICY cat_auth_read ON public.authorities
  FOR SELECT USING (true);

DROP POLICY IF EXISTS cat_auth_admin ON public.authorities;
CREATE POLICY cat_auth_admin ON public.authorities
  FOR ALL USING (is_admin());


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE
  v_count   INT;
  v_without TEXT;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.authorities WHERE code IN ('EASA', 'UK_CAA', 'CASA', 'GCAA', 'FAA');
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'Esperaba las 5 autoridades, encontré %.', v_count;
  END IF;

  SELECT string_agg(code, ',' ORDER BY code) INTO v_without
  FROM public.authorities WHERE NOT has_type_ratings;
  IF v_without IS DISTINCT FROM 'FAA' THEN
    RAISE EXCEPTION 'has_type_ratings=false debe estar SÓLO en FAA, está en: %.', v_without;
  END IF;

  RAISE NOTICE 'authorities: 5 filas, sin type ratings sólo FAA.';
END $$;

NOTIFY pgrst, 'reload schema';
