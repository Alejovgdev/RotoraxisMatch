-- ============================================================
-- AviationJobTalent V2 — Migration 078: activar el oficio engine_technician
-- ============================================================
-- Created: 2026-09-16 (Fase 10, paso 5b)
--
-- La 076 creó la fila INACTIVA a propósito: `useTechnicianTypes` (alta y
-- perfil) lista las filas activas, y el paso 5a no tenía pantallas de motores.
-- Con el paso 5b ya existen —editor de motores del perfil, formulario de oferta
-- de motor, filtro de elegibilidad cableado en todas las pantallas— así que se
-- activa, a la vez que TECHNICIAN_TYPES en src/constants/technicianTypes.ts.
--
-- Sólo `is_active`. Etiqueta, requires_license (false) y sort_order (7) se
-- quedan como los dejó la 076. Una UPDATE sobre una fila de catálogo, sin datos
-- de nadie: ningún técnico la tiene todavía (verificado el 2026-09-16).
-- ============================================================

UPDATE public.technician_types
   SET is_active = true
 WHERE code = 'engine_technician'
   AND is_active IS DISTINCT FROM true;

DO $$
DECLARE v_row public.technician_types%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.technician_types WHERE code = 'engine_technician';
  IF NOT FOUND THEN
    RAISE EXCEPTION '078: no existe la fila engine_technician (¿falta la 076?).';
  END IF;
  IF NOT v_row.is_active THEN
    RAISE EXCEPTION '078: engine_technician sigue inactiva.';
  END IF;
  IF v_row.requires_license THEN
    RAISE EXCEPTION '078: engine_technician no debe exigir licencia.';
  END IF;
  RAISE NOTICE '078: engine_technician activa (sin licencia, sort_order %).', v_row.sort_order;
END $$;