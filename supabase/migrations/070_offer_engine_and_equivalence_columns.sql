-- ============================================================
-- AviationJobTalent V2 — Migration 070: columnas nuevas de offers
-- ============================================================
-- Created: 2026-09-15 (Fase 10, paso 2)
--
-- Fase EXPAND: todas nullable o con default, ninguna NOT NULL todavía. Ningún
-- código las lee ni las escribe hoy, y las filas existentes quedan con el
-- comportamiento de siempre (oferta de aeronave, sin equivalencias).
--
--   accepts_equivalent  DEFAULT false
--     Ensancha la licencia de la oferta a otras autoridades Part-66 con el
--     mismo código. El exacto puntúa por encima del equivalente. FAA nunca
--     cruza.
--
--   offer_kind          DEFAULT 'aircraft'
--     'engine' = la oferta pide un motor y nada más: ni licencia ni aeronaves.
--     CHECK de dominio sí (un valor mal escrito no puede entrar en silencio);
--     CHECK cruzado con licencia/aeronaves/motor todavía NO, llega cuando el
--     código escriba estas columnas.
--
--   required_engine_id  NULL, FK a engines
--     El motor de una oferta de motor.
--
--   only_unlicensed     DEFAULT false
--     "Sólo técnicos sin licencia" en ofertas de motor. DESMARCADA POR
--     DEFECTO: es una decisión tomada, no un descuido.
-- ============================================================


ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS accepts_equivalent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS offer_kind TEXT DEFAULT 'aircraft',
  ADD COLUMN IF NOT EXISTS required_engine_id UUID REFERENCES public.engines(id),
  ADD COLUMN IF NOT EXISTS only_unlicensed BOOLEAN DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.offers'::regclass AND conname = 'chk_offers_offer_kind'
  ) THEN
    ALTER TABLE public.offers ADD CONSTRAINT chk_offers_offer_kind
      CHECK (offer_kind IN ('aircraft', 'engine'));
  END IF;
END $$;

COMMENT ON COLUMN public.offers.accepts_equivalent IS
  'Fase 10: acepta la misma categoría emitida por otra autoridad Part-66. FAA nunca cruza.';
COMMENT ON COLUMN public.offers.offer_kind IS
  'Fase 10: aircraft (licencia y/o aeronaves) o engine (sólo un motor).';
COMMENT ON COLUMN public.offers.required_engine_id IS
  'Fase 10: motor que pide una oferta de motor.';
COMMENT ON COLUMN public.offers.only_unlicensed IS
  'Fase 10: sólo técnicos sin licencia. Desmarcada por defecto (decisión tomada).';

CREATE INDEX IF NOT EXISTS idx_offers_required_engine
  ON public.offers (required_engine_id) WHERE required_engine_id IS NOT NULL;


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE
  v_default TEXT;
  v_bad     INT;
BEGIN
  SELECT column_default INTO v_default FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'only_unlicensed';
  IF v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'offers.only_unlicensed debe tener DEFAULT false, tiene %.', v_default;
  END IF;

  SELECT column_default INTO v_default FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'accepts_equivalent';
  IF v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'offers.accepts_equivalent debe tener DEFAULT false, tiene %.', v_default;
  END IF;

  -- Las ofertas existentes no cambian de significado.
  SELECT count(*) INTO v_bad FROM public.offers
  WHERE offer_kind IS DISTINCT FROM 'aircraft'
     OR accepts_equivalent IS DISTINCT FROM false
     OR only_unlicensed IS DISTINCT FROM false
     OR required_engine_id IS NOT NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% ofertas existentes no quedaron como aircraft / sin equivalencias / sin filtro.', v_bad;
  END IF;

  RAISE NOTICE 'offers: 4 columnas nuevas; las existentes siguen siendo aircraft sin equivalencias.';
END $$;

NOTIFY pgrst, 'reload schema';
