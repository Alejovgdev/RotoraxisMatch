-- ============================================================
-- AviationJobTalent V2 — Migration 074: la habilitación cuelga de UNA licencia
-- ============================================================
-- Created: 2026-09-16 (Fase 10, paso 3 — cambio de identidad)
--
-- `technician_habilitations` se ataba a la licencia por CÓDIGO
-- (fk_technician_habilitations_license sobre (technician_id, license_code)).
-- Con dos B1.1 de autoridades distintas ese par deja de ser único, así que la
-- habilitación pasa a apuntar a la FILA: `technician_license_id`.
--
-- Se conserva `technician_id` en la FK compuesta —(technician_id,
-- technician_license_id) contra (technician_id, id)— para que una habilitación
-- NO pueda colgar de la licencia de otro técnico. Un FK sólo sobre el id lo
-- permitiría.
--
-- ── Tres cosas que NO están en el enunciado y hacen falta aquí ──
--
-- 1. `uq_technician_habilitations_rating` es UNIQUE (technician_id,
--    license_code, aircraft_type_rating_id). En cuanto existan dos B1.1 de
--    autoridades distintas, ese índice IMPIDE declarar el A320 bajo las dos:
--    mismo técnico, mismo código, mismo rating. Se sustituye por el mismo
--    índice sobre (technician_license_id, aircraft_type_rating_id), que es la
--    misma regla — "una aeronave una vez por credencial" — sobre la identidad
--    nueva. Sin esto, el cambio queda a medias: el modelo admite las dos
--    licencias y el índice no.
--
-- 2. `license_code` SE QUEDA (nada de DROP en este paso), y queda redundante
--    con la fila apuntada. Para que no derive, una segunda FK compuesta
--    (technician_license_id, license_code) contra (id, license_code): el
--    código de la habilitación tiene que ser el de SU licencia, o no entra.
--    Esta FK desaparece con la columna, en la sesión de contracción.
--
-- 3. El UNIQUE viejo de `technician_licenses` y la FK vieja por código se
--    retiran AQUÍ, y no en la 073, porque hasta este punto son lo único que
--    protege la integridad. Se sustituyen primero y se retiran después.
-- ============================================================

ALTER TABLE public.technician_habilitations
  ADD COLUMN IF NOT EXISTS technician_license_id UUID;

-- Backfill determinista: hoy (technician_id, license_code) es ÚNICO en
-- technician_licenses, así que el join no puede devolver dos candidatas. La
-- guarda de abajo lo comprueba en vez de darlo por supuesto.
UPDATE public.technician_habilitations h
   SET technician_license_id = l.id
  FROM public.technician_licenses l
 WHERE l.technician_id = h.technician_id
   AND l.license_code  = h.license_code
   AND h.technician_license_id IS NULL;

DO $$
DECLARE
  v_total INT; v_sin_id INT; v_ambiguas INT; v_cruzadas INT;
BEGIN
  SELECT count(*) INTO v_total FROM public.technician_habilitations;

  SELECT count(*) INTO v_sin_id
  FROM public.technician_habilitations WHERE technician_license_id IS NULL;
  IF v_sin_id <> 0 THEN
    RAISE EXCEPTION '% habilitaciones sin technician_license_id. Backfill incompleto: NO se endurece.', v_sin_id;
  END IF;

  -- Exactamente UNA licencia candidata por habilitación.
  SELECT count(*) INTO v_ambiguas FROM (
    SELECT h.id FROM public.technician_habilitations h
    JOIN public.technician_licenses l
      ON l.technician_id = h.technician_id AND l.license_code = h.license_code
    GROUP BY h.id HAVING count(*) <> 1
  ) t;
  IF v_ambiguas <> 0 THEN
    RAISE EXCEPTION '% habilitaciones con un número de licencias candidatas distinto de 1.', v_ambiguas;
  END IF;

  -- Ninguna colgando de la licencia de otro técnico.
  SELECT count(*) INTO v_cruzadas
  FROM public.technician_habilitations h
  JOIN public.technician_licenses l ON l.id = h.technician_license_id
  WHERE l.technician_id <> h.technician_id;
  IF v_cruzadas <> 0 THEN
    RAISE EXCEPTION '% habilitaciones apuntan a la licencia de otro técnico.', v_cruzadas;
  END IF;

  RAISE NOTICE 'technician_habilitations: % filas, todas con su licencia, sin ambigüedad ni cruces.', v_total;
END $$;

ALTER TABLE public.technician_habilitations ALTER COLUMN technician_license_id SET NOT NULL;

COMMENT ON COLUMN public.technician_habilitations.technician_license_id IS
  'La credencial concreta de la que cuelga esta habilitación (Fase 10). Sustituye al enlace por código.';

DO $$
BEGIN
  -- (1) La FK nueva: misma fila Y mismo técnico.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technician_habilitations'::regclass
                   AND conname='fk_technician_habilitations_license_row') THEN
    ALTER TABLE public.technician_habilitations
      ADD CONSTRAINT fk_technician_habilitations_license_row
      FOREIGN KEY (technician_id, technician_license_id)
      REFERENCES public.technician_licenses(technician_id, id);
  END IF;

  -- (2) Anti-deriva mientras license_code siga existiendo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technician_habilitations'::regclass
                   AND conname='fk_technician_habilitations_license_code_matches') THEN
    ALTER TABLE public.technician_habilitations
      ADD CONSTRAINT fk_technician_habilitations_license_code_matches
      FOREIGN KEY (technician_license_id, license_code)
      REFERENCES public.technician_licenses(id, license_code);
  END IF;
END $$;

-- (3) La unicidad de aeronave, sobre la identidad nueva.
CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_habilitations_license_rating
  ON public.technician_habilitations (technician_license_id, aircraft_type_rating_id)
  WHERE aircraft_type_rating_id IS NOT NULL;

DROP INDEX IF EXISTS public.uq_technician_habilitations_rating;

CREATE INDEX IF NOT EXISTS idx_technician_habilitations_license
  ON public.technician_habilitations (technician_license_id);

-- (4) Ahora sí: fuera el enlace por código y el UNIQUE que lo sostenía.
ALTER TABLE public.technician_habilitations
  DROP CONSTRAINT IF EXISTS fk_technician_habilitations_license;

ALTER TABLE public.technician_licenses
  DROP CONSTRAINT IF EXISTS technician_licenses_technician_id_license_code_key;


-- ── Post-condiciones ───────────────────────────────────────
DO $$
DECLARE v_n INT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technician_licenses'::regclass
               AND conname='technician_licenses_technician_id_license_code_key') THEN
    RAISE EXCEPTION 'El UNIQUE viejo (technician_id, license_code) sigue en pie: dos autoridades seguirían sin poder convivir.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.technician_licenses'::regclass
                   AND conname='uq_technician_licenses_authority_code') THEN
    RAISE EXCEPTION 'Falta el UNIQUE nuevo (technician_id, authority, license_code).';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_technician_habilitations_rating') THEN
    RAISE EXCEPTION 'El índice viejo por código sigue vivo: bloquearía la misma aeronave bajo dos autoridades.';
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
  WHERE conrelid='public.technician_habilitations'::regclass
    AND conname IN ('fk_technician_habilitations_license_row','fk_technician_habilitations_license_code_matches');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Esperaba las 2 FK nuevas de habilitaciones, encontré %.', v_n;
  END IF;

  RAISE NOTICE 'Habilitaciones atadas a la fila de licencia; enlace por código retirado.';
END $$;

NOTIFY pgrst, 'reload schema';
