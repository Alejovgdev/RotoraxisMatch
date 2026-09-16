-- ============================================================
-- AviationJobTalent V2 — Migration 066: qué códigos admite cada autoridad
-- ============================================================
-- Created: 2026-09-15 (Fase 10, paso 2)
--
-- 51 filas exactas:
--   EASA    13  todas las Part-66
--   UK CAA  13  todas las Part-66
--   CASA    10  sin B2L, B3 ni L
--   GCAA    12  sin B2L
--   FAA      3  A, P, A&P
--
-- La clave es PRIMARY KEY (authority, license_code): cubre el UNIQUE pedido y
-- deja el par listo para que el paso 3 apunte a él con una FK compuesta desde
-- technician_licenses — así una combinación inexistente (FAA + B2) no se puede
-- guardar, en vez de sólo no poder elegirse.
--
-- El seed lista los 13 códigos Part-66 a mano, sin CROSS JOIN contra
-- license_categories: desde la 065 esa tabla tiene también los FAA, y un filtro
-- por grupo haría depender este recuento de lo que otra migración meta ahí.
--
-- Nombres de columna: `authority` y `license_code`, los que asume
-- scripts/validateAuthorityLicenses.ts (npm run validate:authority-licenses).
-- El espejo en TS (AUTHORITY_LICENSES) llega con el código que lo usa.
-- ============================================================


CREATE TABLE IF NOT EXISTS public.authority_licenses (
  authority    TEXT NOT NULL REFERENCES public.authorities(code),
  license_code TEXT NOT NULL REFERENCES public.license_categories(code),
  PRIMARY KEY (authority, license_code)
);

COMMENT ON TABLE public.authority_licenses IS
  'Códigos de licencia que admite cada autoridad (Fase 10). 51 filas: 13 EASA, 13 UK CAA, '
  '10 CASA (sin B2L/B3/L), 12 GCAA (sin B2L), 3 FAA (A/P/A&P).';

INSERT INTO public.authority_licenses (authority, license_code)
SELECT a.code, p.code
FROM (VALUES ('EASA'), ('UK_CAA'), ('CASA'), ('GCAA')) AS a(code)
CROSS JOIN (VALUES
  ('A1'), ('A2'), ('A3'), ('A4'),
  ('B1.1'), ('B1.2'), ('B1.3'), ('B1.4'),
  ('B2'), ('B2L'), ('B3'), ('L'), ('C')
) AS p(code)
WHERE NOT (a.code = 'CASA' AND p.code IN ('B2L', 'B3', 'L'))
  AND NOT (a.code = 'GCAA' AND p.code = 'B2L')
UNION ALL
SELECT 'FAA', f.code
FROM (VALUES ('A'), ('P'), ('A&P')) AS f(code)
ON CONFLICT (authority, license_code) DO NOTHING;


-- ── RLS: catálogo público, escritura sólo admin ─────────────

ALTER TABLE public.authority_licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cat_al_read ON public.authority_licenses;
CREATE POLICY cat_al_read ON public.authority_licenses
  FOR SELECT USING (true);

DROP POLICY IF EXISTS cat_al_admin ON public.authority_licenses;
CREATE POLICY cat_al_admin ON public.authority_licenses
  FOR ALL USING (is_admin());


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE
  v_total  INT;
  v_counts TEXT;
  v_faa    TEXT;
BEGIN
  SELECT count(*) INTO v_total FROM public.authority_licenses;
  IF v_total <> 51 THEN
    RAISE EXCEPTION 'Esperaba 51 filas, encontré %.', v_total;
  END IF;

  SELECT string_agg(authority || '=' || n, ',' ORDER BY authority) INTO v_counts
  FROM (SELECT authority, count(*) AS n FROM public.authority_licenses GROUP BY authority) t;
  IF v_counts <> 'CASA=10,EASA=13,FAA=3,GCAA=12,UK_CAA=13' THEN
    RAISE EXCEPTION 'Reparto por autoridad incorrecto: %.', v_counts;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.authority_licenses
    WHERE (authority = 'CASA' AND license_code IN ('B2L', 'B3', 'L'))
       OR (authority = 'GCAA' AND license_code = 'B2L')
  ) THEN
    RAISE EXCEPTION 'CASA o GCAA tienen un código que no admiten.';
  END IF;

  SELECT string_agg(license_code, ',' ORDER BY license_code) INTO v_faa
  FROM public.authority_licenses WHERE authority = 'FAA';
  IF v_faa <> 'A,A&P,P' THEN
    RAISE EXCEPTION 'FAA debe tener exactamente A, P y A&P; tiene %.', v_faa;
  END IF;

  RAISE NOTICE 'authority_licenses: 51 filas (13/13/10/12/3).';
END $$;

NOTIFY pgrst, 'reload schema';
