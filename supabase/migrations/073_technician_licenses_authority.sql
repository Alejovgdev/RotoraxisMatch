-- ============================================================
-- AviationJobTalent V2 — Migration 073: la licencia lleva su autoridad
-- ============================================================
-- Created: 2026-09-16 (Fase 10, paso 3 — cambio de identidad)
--
-- Hoy una licencia se identifica por (technician_id, license_code). Con dos
-- B1.1 de autoridades distintas eso es ambiguo: el sistema puede coger la
-- caducidad de una y las habilitaciones de la otra.
--
-- A partir de aquí:
--   - `technician_licenses.id` identifica la CREDENCIAL concreta.
--   - (authority, license_code) identifica el TIPO, con FK compuesta contra
--     `authority_licenses` (PK sobre ese par, migración 066): una combinación
--     que no existe —FAA + B2— deja de poder guardarse.
--   - El UNIQUE pasa a (technician_id, authority, license_code).
--
-- EXPAND, no contract: no se borra ninguna columna. El UNIQUE viejo y la FK
-- vieja de habilitaciones siguen en pie hasta la 074, que los sustituye
-- DESPUÉS de que exista el reemplazo.
--
-- ⚠ SIN DEFAULT, decidido el 2026-09-16. La base está en pruebas y nadie la
-- usa, así que no hay ventana entre migración y despliegue que proteger. Un
-- DEFAULT 'EASA' rellenaría en silencio la autoridad que el código se olvide
-- de mandar; sin él, ese olvido falla a la vista. Y no deja deuda que retirar
-- en la contracción.
-- ============================================================

ALTER TABLE public.technician_licenses
  ADD COLUMN IF NOT EXISTS authority TEXT;

-- Backfill: toda licencia existente es EASA. Se conservan id, fechas y
-- created_at: esto es un UPDATE de una columna nueva, nunca un re-insert.
UPDATE public.technician_licenses SET authority = 'EASA' WHERE authority IS NULL;

DO $$
DECLARE v_null INT; v_total INT;
BEGIN
  SELECT count(*) FILTER (WHERE authority IS NULL), count(*) INTO v_null, v_total
  FROM public.technician_licenses;
  IF v_null <> 0 THEN
    RAISE EXCEPTION '% licencias sin autoridad tras el backfill. No se endurece nada.', v_null;
  END IF;
  RAISE NOTICE 'technician_licenses: % filas, todas con autoridad.', v_total;
END $$;

ALTER TABLE public.technician_licenses ALTER COLUMN authority SET NOT NULL;

COMMENT ON COLUMN public.technician_licenses.authority IS
  'Autoridad emisora (Fase 10). Con license_code forma el TIPO; `id` es la credencial concreta.';

-- El par tiene que existir en el catálogo: FAA+B2 o CASA+B2L dejan de ser
-- guardables, en vez de sólo no ofrecerse en el selector.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technician_licenses'::regclass
                   AND conname='fk_technician_licenses_authority_license') THEN
    ALTER TABLE public.technician_licenses
      ADD CONSTRAINT fk_technician_licenses_authority_license
      FOREIGN KEY (authority, license_code) REFERENCES public.authority_licenses(authority, license_code);
  END IF;

  -- La identidad nueva. El UNIQUE viejo (technician_id, license_code) sigue
  -- vivo hasta la 074: mientras exista, la FK vieja de habilitaciones tiene a
  -- qué apuntar.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technician_licenses'::regclass
                   AND conname='uq_technician_licenses_authority_code') THEN
    ALTER TABLE public.technician_licenses
      ADD CONSTRAINT uq_technician_licenses_authority_code UNIQUE (technician_id, authority, license_code);
  END IF;

  -- Objetivo de la FK compuesta de habilitaciones de la 074: sin este UNIQUE,
  -- (technician_id, technician_license_id) no es referenciable aunque `id` sea
  -- PK.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technician_licenses'::regclass
                   AND conname='uq_technician_licenses_technician_id_id') THEN
    ALTER TABLE public.technician_licenses
      ADD CONSTRAINT uq_technician_licenses_technician_id_id UNIQUE (technician_id, id);
  END IF;

  -- Objetivo de la FK anti-deriva de la 074, mientras `license_code` siga
  -- existiendo en habilitaciones.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technician_licenses'::regclass
                   AND conname='uq_technician_licenses_id_code') THEN
    ALTER TABLE public.technician_licenses
      ADD CONSTRAINT uq_technician_licenses_id_code UNIQUE (id, license_code);
  END IF;
END $$;

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad FROM public.technician_licenses l
  WHERE NOT EXISTS (SELECT 1 FROM public.authority_licenses a
                    WHERE a.authority = l.authority AND a.license_code = l.license_code);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% licencias con un par autoridad+código que no existe en el catálogo.', v_bad;
  END IF;
  RAISE NOTICE 'technician_licenses: autoridad NOT NULL, FK al catálogo y UNIQUE (technician_id, authority, license_code) en pie.';
END $$;

NOTIFY pgrst, 'reload schema';
