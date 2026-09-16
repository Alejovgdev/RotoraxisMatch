-- ============================================================
-- AviationJobTalent V2 — Migration 076: oficio engine_technician y forma de
-- la oferta de motor
-- ============================================================
-- Created: 2026-09-16 (Fase 10, paso 5a)
--
-- Dos cosas, las dos pendientes desde la 070 y ninguna con datos que mover
-- (las 8 ofertas vivas son offer_kind = 'aircraft', verificado el 2026-09-16).
--
-- ── 1. Fila `engine_technician` en technician_types ─────────────────────
-- Es el oficio que hace ELEGIBLE para una oferta de motor aunque el técnico no
-- declare ningún motor (isTechnicianEligibleForOffer, offerMatchExplain.ts).
-- El filtro ya lo lee desde el paso 5a; sin la fila, la FK de
-- technician_profile_types impide que nadie lo tenga.
--
--   requires_license = false. Una oferta de motor no certifica (ver el CHECK
--     de abajo), y `isLicensedTechnicianType` decide con esta columna si el
--     formulario de oferta pregunta por licencia. Un técnico de motores puede
--     tener licencia —el oficio no la prohíbe—, lo mismo que un pintor.
--
--   is_active = false, DE MOMENTO. `useTechnicianTypes` (alta y perfil) lista
--     las filas activas, así que activarla la pondría hoy en los selectores de
--     técnico, antes de que exista el editor de motores del perfil o el
--     formulario de oferta de motor. El paso 5a es sin UI; el 5b la activa
--     junto a esas pantallas. Inactiva no impide nada de lo que el matching
--     necesita: la FK no mira is_active.
--
--   sort_order = 7, detrás de `pilot` (6). Renumerar filas existentes no toca
--     aquí.
--
-- ── 2. offer_kind = 'engine' ⇒ sin licencia, sin aeronaves, con motor ──────
-- La 070 dejó el CHECK de dominio y aplazó el cruzado "hasta que el código
-- escriba estas columnas". Ése es el paso 5b, pero el scorer ya da por hecha
-- esta forma (ENGINE_WEIGHTS pone licencia y habilitación a 0), así que la
-- base la exige antes de que ninguna pantalla pueda escribir una oferta de
-- motor.
--
--   Licencia y motor: CHECK sobre la propia fila. `license_authority` no hace
--     falta nombrarla: chk_offers_license_authority_pairing (075) la ata a
--     license_code. `requires_certification = false` sí se escribe aunque la
--     053 ya lo derive de license_code NULL: dice qué forma tiene una oferta de
--     motor sin obligar a quien lea a reconstruirlo desde otra migración.
--
--   Aeronaves: NO cabe en un CHECK, porque viven en otra tabla
--     (offer_required_habilitations). Van dos triggers, uno por cada lado por
--     el que se puede romper:
--       - añadir una aeronave a una oferta que ya es de motor;
--       - convertir en oferta de motor una que ya tiene aeronaves.
--     El primero bloquea la fila de la oferta (FOR SHARE), y eso serializa las
--     dos escrituras: sin el bloqueo, una aeronave insertada en una transacción
--     y el cambio de offer_kind en otra podrían cruzarse sin verse.
--
-- Sólo la dirección que pide el paso. La contraria (oferta de aeronave ⇒ sin
-- required_engine_id, y `only_unlicensed` sólo en ofertas de motor) queda
-- fuera a propósito: es una decisión de producto por tomar, no un cabo suelto.
-- ============================================================


-- ── 1. technician_types ─────────────────────────────────────

INSERT INTO public.technician_types (code, label, requires_license, is_active, sort_order)
VALUES ('engine_technician', 'Engine Technician', false, false, 7)
ON CONFLICT (code) DO NOTHING;


-- ── 2a. CHECK: licencia y motor ─────────────────────────────

DO $$
DECLARE v_bad INT;
BEGIN
  -- Antes de añadirlo, y con un mensaje que diga qué filas: un ADD CONSTRAINT
  -- que falla sólo dice el nombre de la restricción.
  SELECT count(*) INTO v_bad FROM public.offers
   WHERE offer_kind = 'engine'
     AND (license_code IS NOT NULL OR requires_certification OR required_engine_id IS NULL);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% ofertas de motor con licencia, con certificación o sin motor: corrígelas antes de aplicar la 076.', v_bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.offers'::regclass
                   AND conname = 'chk_offers_engine_kind_shape') THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT chk_offers_engine_kind_shape
      CHECK (
        offer_kind IS DISTINCT FROM 'engine'
        OR (license_code IS NULL AND requires_certification = false AND required_engine_id IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT chk_offers_engine_kind_shape ON public.offers IS
  'Fase 10 (076): una oferta de motor no pide licencia ni certificación y sí nombra un motor. '
  'Las aeronaves, que viven en otra tabla, las vigilan dos triggers.';


-- ── 2b. Triggers: sin aeronaves ─────────────────────────────

-- Lado de la aeronave: no se puede colgar una de una oferta de motor.
CREATE OR REPLACE FUNCTION public.enforce_aircraft_requirement_not_on_engine_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_kind TEXT;
BEGIN
  -- FOR SHARE: bloquea la oferta contra un cambio de offer_kind concurrente
  -- (ver la cabecera). SECURITY DEFINER para que la comprobación no dependa de
  -- lo que RLS deje ver a quien escribe.
  SELECT offer_kind INTO v_kind FROM public.offers WHERE id = NEW.offer_id FOR SHARE;
  IF v_kind = 'engine' THEN
    RAISE EXCEPTION 'Offer % is an engine offer: it cannot require aircraft type ratings.', NEW.offer_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_aircraft_requirement_not_on_engine_offer ON public.offer_required_habilitations;
CREATE TRIGGER enforce_aircraft_requirement_not_on_engine_offer
  BEFORE INSERT OR UPDATE OF offer_id ON public.offer_required_habilitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_aircraft_requirement_not_on_engine_offer();

-- Lado de la oferta: no se puede pasar a motor con aeronaves colgando.
CREATE OR REPLACE FUNCTION public.enforce_engine_offer_without_aircraft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.offer_kind = 'engine'
     AND EXISTS (SELECT 1 FROM public.offer_required_habilitations WHERE offer_id = NEW.id) THEN
    RAISE EXCEPTION 'Offer % still requires aircraft type ratings: remove them before making it an engine offer.', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_engine_offer_without_aircraft ON public.offers;
CREATE TRIGGER enforce_engine_offer_without_aircraft
  BEFORE INSERT OR UPDATE OF offer_kind ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_engine_offer_without_aircraft();


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE
  v_row     public.technician_types%ROWTYPE;
  v_bad     INT;
  v_trigger INT;
BEGIN
  SELECT * INTO v_row FROM public.technician_types WHERE code = 'engine_technician';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'technician_types no tiene la fila engine_technician.';
  END IF;
  IF v_row.requires_license THEN
    RAISE EXCEPTION 'engine_technician debe tener requires_license = false.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.offers'::regclass
                   AND conname = 'chk_offers_engine_kind_shape' AND convalidated) THEN
    RAISE EXCEPTION 'chk_offers_engine_kind_shape no existe o no está validada.';
  END IF;

  SELECT count(*) INTO v_trigger FROM pg_trigger
   WHERE NOT tgisinternal
     AND ((tgrelid = 'public.offers'::regclass AND tgname = 'enforce_engine_offer_without_aircraft')
       OR (tgrelid = 'public.offer_required_habilitations'::regclass AND tgname = 'enforce_aircraft_requirement_not_on_engine_offer'));
  IF v_trigger <> 2 THEN
    RAISE EXCEPTION 'Esperaba 2 triggers de forma de oferta de motor, hay %.', v_trigger;
  END IF;

  SELECT count(*) INTO v_bad FROM public.offers o
   WHERE o.offer_kind = 'engine'
     AND EXISTS (SELECT 1 FROM public.offer_required_habilitations r WHERE r.offer_id = o.id);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% ofertas de motor con aeronaves.', v_bad;
  END IF;

  RAISE NOTICE 'engine_technician (inactiva, sin licencia) + forma de oferta de motor: CHECK y 2 triggers.';
END $$;

NOTIFY pgrst, 'reload schema';
