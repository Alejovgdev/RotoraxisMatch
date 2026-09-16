-- ============================================================
-- AviationJobTalent V2 — Migration 075: la oferta nombra la autoridad
-- ============================================================
-- Created: 2026-09-16 (Fase 10, paso 3 — cambio de identidad)
--
-- La oferta pedía `license_code` a secas. Con cinco autoridades eso ya no
-- identifica nada: "B1.1" sin decir de quién no se puede cruzar con la
-- licencia de un técnico.
--
-- `license_authority` viaja junto a `license_code` con la MISMA FK compuesta
-- contra `authority_licenses` que las licencias del técnico (073), así que una
-- oferta no puede pedir un par que no existe.
--
-- Backfill: toda oferta certificada pasa a EASA; las que no certifican siguen
-- sin licencia y por tanto sin autoridad. `accepts_equivalent` se queda en
-- false en todas (migración 070) — el matching no cambia en este paso.
--
-- ⚠ SIN DEFAULT, al revés que en technician_licenses. Aquí el default sería
-- veneno: una oferta sin certificar tiene license_code NULL, y un
-- 'EASA' por defecto rompería el CHECK de emparejamiento en cada inserción.
-- Lo escribe el repositorio (offerRepository), en este mismo paso.
--
-- `offers.license_code` NO se toca: sigue siendo la columna del código.
-- ============================================================

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS license_authority TEXT;

UPDATE public.offers
   SET license_authority = 'EASA'
 WHERE license_code IS NOT NULL
   AND license_authority IS NULL;

DO $$
DECLARE v_sin_auth INT; v_sin_code INT; v_cert INT;
BEGIN
  SELECT count(*) INTO v_sin_auth FROM public.offers
   WHERE license_code IS NOT NULL AND license_authority IS NULL;
  IF v_sin_auth <> 0 THEN
    RAISE EXCEPTION '% ofertas con licencia y sin autoridad tras el backfill.', v_sin_auth;
  END IF;

  SELECT count(*) INTO v_sin_code FROM public.offers
   WHERE license_authority IS NOT NULL AND license_code IS NULL;
  IF v_sin_code <> 0 THEN
    RAISE EXCEPTION '% ofertas con autoridad y sin licencia: el par no se sostiene.', v_sin_code;
  END IF;

  SELECT count(*) INTO v_cert FROM public.offers WHERE requires_certification;
  RAISE NOTICE 'offers: % certificadas, todas con autoridad EASA.', v_cert;
END $$;

DO $$
BEGIN
  -- Las dos mitades del par, atadas en las dos direcciones. Mismo criterio que
  -- chk_offers_license_matches_certification (053).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.offers'::regclass
                   AND conname='chk_offers_license_authority_pairing') THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT chk_offers_license_authority_pairing
      CHECK ((license_code IS NULL) = (license_authority IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.offers'::regclass
                   AND conname='fk_offers_authority_license') THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT fk_offers_authority_license
      FOREIGN KEY (license_authority, license_code)
      REFERENCES public.authority_licenses(authority, license_code);
  END IF;
END $$;

COMMENT ON COLUMN public.offers.license_authority IS
  'Autoridad de la licencia que pide la oferta (Fase 10). Presente exactamente cuando license_code lo está.';


DO $$
DECLARE v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad FROM public.offers o
  WHERE o.license_code IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.authority_licenses a
                    WHERE a.authority = o.license_authority AND a.license_code = o.license_code);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% ofertas piden un par autoridad+código que no existe.', v_bad;
  END IF;

  IF EXISTS (SELECT 1 FROM public.offers WHERE accepts_equivalent IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'Alguna oferta tiene accepts_equivalent distinto de false: el matching cambiaría en este paso.';
  END IF;

  RAISE NOTICE 'offers: license_authority lista, emparejada y contra catálogo.';
END $$;

NOTIFY pgrst, 'reload schema';
