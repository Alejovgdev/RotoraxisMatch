-- ============================================================
-- AviationJobTalent V2 — Migration 072: backfill de aircraft_type_ratings.engine_id
-- ============================================================
-- Created: 2026-09-15 (Fase 10, paso 2). Depende de 067, 069 y 071.
--
-- Enlaza cada rating con su motor del catálogo sembrado en la 071. Las reglas
-- de abajo son la ÚNICA vez que se leen engine_manufacturer y engine_family:
-- se leen aquí, a mano y revisadas, para escribir engine_id. El matching nunca
-- vuelve a mirarlas (ver 069).
--
-- Cómo casa una regla con un rating:
--   src_em   = engine_manufacturer                      (siempre)
--   src_ef   = engine_family, o '∅' para engine_family NULL
--   src_pt   = product_type        (NULL = cualquiera)
--   src_end  = easa_endorsement    (NULL = cualquiera)
-- Si varias casan, gana la más específica (endorsement > product_type >
-- genérica). Dos empatadas en el mismo nivel abortan la migración: sería un
-- rating ambiguo, y un enlace dudoso se propaga a todo el matching.
--
-- Resultado esperado sobre el catálogo del 2026-09-15 (606 ratings): 605
-- enlazados, 1 en NULL — "Grumman G-164 (PW R Series)", que puede ser R-985 o
-- R-1340. No se deduce: decisión tomada.
--
-- Guarda contra doble escritura: sólo se rellenan filas con engine_id NULL.
-- ============================================================


CREATE TEMP TABLE _engine_rules (
  src_em  TEXT NOT NULL,
  src_ef  TEXT NOT NULL,
  src_pt  TEXT,
  src_end TEXT,
  e_man   TEXT NOT NULL,
  e_disp  TEXT NOT NULL
);

INSERT INTO _engine_rules (src_em, src_ef, src_pt, src_end, e_man, e_disp) VALUES
  -- ── Catálogo, tal cual o fusionando grafías ──
  ('CFM International','CFM56',NULL,NULL,'CFM International','CFM56'),
  ('CFM International','LEAP-1A',NULL,NULL,'CFM International','LEAP-1A'),
  ('CFM International','LEAP-1B',NULL,NULL,'CFM International','LEAP-1B'),
  ('Engine Alliance','GP7200',NULL,NULL,'Engine Alliance','GP7200'),
  ('General Electric','CF34',NULL,NULL,'General Electric','CF34'),
  ('General Electric','CF6',NULL,NULL,'General Electric','CF6'),
  ('General Electric','CF700',NULL,NULL,'General Electric','CF700'),
  ('General Electric','CJ610',NULL,NULL,'General Electric','CJ610'),
  ('General Electric','CT58',NULL,NULL,'General Electric','CT58'),
  ('General Electric','CT7','Aeroplane',NULL,'General Electric','CT7 (turboprop)'),
  ('General Electric','CT7','Helicopter',NULL,'General Electric','CT7 (turboshaft)'),
  ('General Electric','CT7-8',NULL,NULL,'General Electric','CT7-8'),
  ('General Electric','GE90',NULL,NULL,'General Electric','GE90'),
  ('General Electric','GEnx',NULL,NULL,'General Electric','GEnx'),
  ('General Electric','H80',NULL,NULL,'General Electric','H80'),
  ('General Electric','Passport 20',NULL,NULL,'General Electric','Passport 20'),
  ('Honeywell','ALF500',NULL,NULL,'Honeywell','ALF502'),
  ('Honeywell','ALF502',NULL,NULL,'Honeywell','ALF502'),
  ('Honeywell','AS907',NULL,NULL,'Honeywell','HTF7000 (AS907)'),
  ('Honeywell','ATF 3-6',NULL,NULL,'Honeywell','ATF3-6'),
  ('Honeywell','LTS 101',NULL,NULL,'Honeywell','LTS101'),
  ('Honeywell','T53',NULL,NULL,'Honeywell','T53'),
  ('Honeywell','T5317',NULL,NULL,'Honeywell','T53-17'),
  ('Honeywell','T5508',NULL,NULL,'Honeywell','T5508'),
  ('Honeywell','TFE731',NULL,NULL,'Honeywell','TFE731'),
  ('Honeywell','TPE 331',NULL,NULL,'Honeywell','TPE331'),
  ('Honeywell','TPE-331',NULL,NULL,'Honeywell','TPE331'),
  ('Honeywell','TPE331',NULL,NULL,'Honeywell','TPE331'),
  ('International Aero Engines','V2500',NULL,NULL,'International Aero Engines','V2500'),
  ('Ivchenko','AI-24',NULL,NULL,'Ivchenko-Progress','AI-24'),
  ('Ivchenko','D-436TP',NULL,NULL,'Ivchenko-Progress','D-436TP'),
  ('JPX','4T60',NULL,NULL,'JPX','4T60'),
  ('Limbach','L2000',NULL,NULL,'Limbach','L2000'),
  ('Lycoming','LTP101',NULL,NULL,'Honeywell','LTP101'),
  ('Lycoming','LTS101',NULL,NULL,'Honeywell','LTS101'),
  ('Pratt & Whitney','4000',NULL,NULL,'Pratt & Whitney','PW4000'),
  ('Pratt & Whitney','6000',NULL,NULL,'Pratt & Whitney','PW6000'),
  ('Pratt & Whitney','JFTD 12',NULL,NULL,'Pratt & Whitney','JFTD12'),
  ('Pratt & Whitney','JT12',NULL,NULL,'Pratt & Whitney','JT12'),
  ('Pratt & Whitney','JT3D',NULL,NULL,'Pratt & Whitney','JT3D'),
  ('Pratt & Whitney','JT4',NULL,NULL,'Pratt & Whitney','JT4A'),
  ('Pratt & Whitney','JT4A',NULL,NULL,'Pratt & Whitney','JT4A'),
  ('Pratt & Whitney','JT8D',NULL,NULL,'Pratt & Whitney','JT8D'),
  ('Pratt & Whitney','JT9D',NULL,NULL,'Pratt & Whitney','JT9D'),
  ('Pratt & Whitney','PW1100G',NULL,NULL,'Pratt & Whitney','PW1100G'),
  ('Pratt & Whitney','PW1500G',NULL,NULL,'Pratt & Whitney','PW1500G'),
  ('Pratt & Whitney','PW1900G',NULL,NULL,'Pratt & Whitney','PW1900G'),
  ('Pratt & Whitney','PW2000',NULL,NULL,'Pratt & Whitney','PW2000'),
  ('Pratt & Whitney','PW4000',NULL,NULL,'Pratt & Whitney','PW4000'),
  ('Pratt & Whitney','R1340',NULL,NULL,'Pratt & Whitney','R-1340 Wasp'),
  ('Pratt & Whitney','R2800',NULL,NULL,'Pratt & Whitney','R-2800 Double Wasp'),
  ('Pratt & Whitney','R985',NULL,NULL,'Pratt & Whitney','R-985 Wasp Junior'),
  -- ('Pratt & Whitney','R Series') a propósito SIN regla: G-164, R-985 o R-1340.
  ('Pratt & Whitney Canada','JT15',NULL,NULL,'Pratt & Whitney Canada','JT15D'),
  ('Pratt & Whitney Canada','JT15D',NULL,NULL,'Pratt & Whitney Canada','JT15D'),
  ('Pratt & Whitney Canada','PT6C',NULL,NULL,'Pratt & Whitney Canada','PT6C'),
  ('Pratt & Whitney Canada','PT6T',NULL,NULL,'Pratt & Whitney Canada','PT6T Twin-Pac'),
  ('Pratt & Whitney Canada','PW110 Series',NULL,NULL,'Pratt & Whitney Canada','PW110 series'),
  ('Pratt & Whitney Canada','PW119',NULL,NULL,'Pratt & Whitney Canada','PW119'),
  ('Pratt & Whitney Canada','PW120',NULL,NULL,'Pratt & Whitney Canada','PW120'),
  ('Pratt & Whitney Canada','PW123',NULL,NULL,'Pratt & Whitney Canada','PW123'),
  ('Pratt & Whitney Canada','PW125/PW127',NULL,NULL,'Pratt & Whitney Canada','PW125/PW127'),
  ('Pratt & Whitney Canada','PW127',NULL,NULL,'Pratt & Whitney Canada','PW127'),
  ('Pratt & Whitney Canada','PW150',NULL,NULL,'Pratt & Whitney Canada','PW150'),
  ('Pratt & Whitney Canada','PW206',NULL,NULL,'Pratt & Whitney Canada','PW206'),
  ('Pratt & Whitney Canada','PW206/207',NULL,NULL,'Pratt & Whitney Canada','PW206/PW207'),
  ('Pratt & Whitney Canada','PW207D',NULL,NULL,'Pratt & Whitney Canada','PW207D'),
  ('Pratt & Whitney Canada','PW210',NULL,NULL,'Pratt & Whitney Canada','PW210'),
  ('Pratt & Whitney Canada','PW305',NULL,NULL,'Pratt & Whitney Canada','PW305'),
  ('Pratt & Whitney Canada','PW306',NULL,NULL,'Pratt & Whitney Canada','PW306'),
  ('Pratt & Whitney Canada','PW308',NULL,NULL,'Pratt & Whitney Canada','PW308'),
  ('Pratt & Whitney Canada','PW308C',NULL,NULL,'Pratt & Whitney Canada','PW308C'),
  ('Pratt & Whitney Canada','PW530/PW535',NULL,NULL,'Pratt & Whitney Canada','PW530/PW535'),
  ('Pratt & Whitney Canada','PW535',NULL,NULL,'Pratt & Whitney Canada','PW535'),
  ('Pratt & Whitney Canada','PW545',NULL,NULL,'Pratt & Whitney Canada','PW545'),
  ('Pratt & Whitney Canada','PW610',NULL,NULL,'Pratt & Whitney Canada','PW610'),
  ('Pratt & Whitney Canada','PW615',NULL,NULL,'Pratt & Whitney Canada','PW615'),
  ('Pratt & Whitney Canada','PW617',NULL,NULL,'Pratt & Whitney Canada','PW617'),
  ('Pratt & Whitney Canada','PW800GA',NULL,NULL,'Pratt & Whitney Canada','PW800'),
  ('Rolls-Royce','AE2100',NULL,NULL,'Rolls-Royce','AE2100'),
  ('Rolls-Royce','AE3007A',NULL,NULL,'Rolls-Royce','AE3007A'),
  ('Rolls-Royce','AE3007C',NULL,NULL,'Rolls-Royce','AE3007C'),
  ('Rolls-Royce','Conway',NULL,NULL,'Rolls-Royce','Conway'),
  ('Rolls-Royce','RB211',NULL,NULL,'Rolls-Royce','RB211'),
  ('Rolls-Royce','Trent 500',NULL,NULL,'Rolls-Royce','Trent 500'),
  ('Rolls-Royce','Trent 700',NULL,NULL,'Rolls-Royce','Trent 700'),
  ('Rolls-Royce','Trent 800',NULL,NULL,'Rolls-Royce','Trent 800'),
  ('Rolls-Royce','Trent 900',NULL,NULL,'Rolls-Royce','Trent 900'),
  ('Rolls-Royce','Trent 1000',NULL,NULL,'Rolls-Royce','Trent 1000'),
  ('Rolls-Royce','Trent 7000',NULL,NULL,'Rolls-Royce','Trent 7000'),
  ('Rolls-Royce','Trent XWB',NULL,NULL,'Rolls-Royce','Trent XWB'),
  ('Rolls-Royce','Viper',NULL,NULL,'Rolls-Royce','Viper'),
  ('Rolls-Royce Deutschland','BR700-715',NULL,NULL,'Rolls-Royce','BR715'),
  ('Rolls-Royce Deutschland','BR710',NULL,NULL,'Rolls-Royce','BR710'),
  ('Rolls-Royce Deutschland','BR725',NULL,NULL,'Rolls-Royce','BR725'),
  ('Rolls-Royce Deutschland','Dart',NULL,NULL,'Rolls-Royce','Dart'),
  ('Rolls-Royce Deutschland','Spey',NULL,NULL,'Rolls-Royce','Spey'),
  ('Rolls-Royce Deutschland','Tay',NULL,NULL,'Rolls-Royce','Tay'),
  ('Safran','Arrius 2R',NULL,NULL,'Safran Helicopter Engines','Arrius 2R'),
  ('Turbomeca','Arriel 1',NULL,NULL,'Safran Helicopter Engines','Arriel 1'),
  ('Turbomeca','Arriel 2',NULL,NULL,'Safran Helicopter Engines','Arriel 2'),
  ('Turbomeca','Arriel 2C',NULL,NULL,'Safran Helicopter Engines','Arriel 2C'),
  ('Turbomeca','Arrius 1',NULL,NULL,'Safran Helicopter Engines','Arrius 1'),
  ('Turbomeca','Arrius 2',NULL,NULL,'Safran Helicopter Engines','Arrius 2'),
  ('Turbomeca','Arrius 2B',NULL,NULL,'Safran Helicopter Engines','Arrius 2B'),
  ('Turbomeca','Arrius 2F',NULL,NULL,'Safran Helicopter Engines','Arrius 2F'),
  ('Turbomeca','Artouste',NULL,NULL,'Safran Helicopter Engines','Artouste'),
  ('Turbomeca','Astazou XIV',NULL,NULL,'Safran Helicopter Engines','Astazou XIV'),
  ('Turbomeca','Makila 1A/1A1',NULL,NULL,'Safran Helicopter Engines','Makila 1A/1A1'),
  ('Turbomeca','Makila 1A2',NULL,NULL,'Safran Helicopter Engines','Makila 1A2'),
  ('Turbomeca','Makila 2A',NULL,NULL,'Safran Helicopter Engines','Makila 2A'),
  ('Turbomeca','Turmo',NULL,NULL,'Safran Helicopter Engines','Turmo'),
  ('Walter','M601',NULL,NULL,'Walter','M601'),
  ('Walter','Minor/AVIA',NULL,NULL,'Walter','Minor / M337'),
  ('Williams International','FJ 44',NULL,NULL,'Williams International','FJ44'),
  ('Williams International','FJ44',NULL,NULL,'Williams International','FJ44'),
  ('Williams International','FJ33',NULL,NULL,'Williams International','FJ33'),
  ('Wright','Cyclone',NULL,NULL,'Wright','R-1820 Cyclone'),
  ('Wright','R-1820',NULL,NULL,'Wright','R-1820 Cyclone'),
  ('Austro Engine','Engine',NULL,NULL,'Austro Engine','AE300'),
  -- ── Partidas por tipo (avión = turbohélice, helicóptero = turboeje) ──
  ('Pratt & Whitney Canada','PT6','Aeroplane',NULL,'Pratt & Whitney Canada','PT6A'),
  ('Pratt & Whitney Canada','PT6','Helicopter','Agusta A119/ Agusta AW119MkII (PWC PT6)','Pratt & Whitney Canada','PT6B'),
  ('Pratt & Whitney Canada','PT6','Helicopter','Sikorsky S-76B (PWC PT6)','Pratt & Whitney Canada','PT6B'),
  ('Pratt & Whitney Canada','PT6','Helicopter','Agusta AB139 / AW139 (PWC PT6)','Pratt & Whitney Canada','PT6C'),
  ('Pratt & Whitney Canada','PT6','Helicopter','Bell 212 / Agusta AB212 (PWC PT6)','Pratt & Whitney Canada','PT6T Twin-Pac'),
  ('Pratt & Whitney Canada','PT6','Helicopter','Bell 412 / Agusta AB412 (PWC PT6)','Pratt & Whitney Canada','PT6T Twin-Pac'),
  ('Turbomeca','Astazou','Aeroplane',NULL,'Safran Helicopter Engines','Astazou (turboprop)'),
  ('Turbomeca','Astazou','Helicopter',NULL,'Safran Helicopter Engines','Astazou (turboshaft)'),
  -- ── El Model 250: tres grafías, dos tipos ──
  ('Rolls-Royce','250',NULL,NULL,'Rolls-Royce','M250 (turboshaft)'),
  ('Rolls-Royce','Corp 250','Helicopter',NULL,'Rolls-Royce','M250 (turboshaft)'),
  ('Rolls-Royce','Corp 250','Aeroplane',NULL,'Rolls-Royce','M250 (turboprop)'),
  ('Rolls-Royce','M250','Aeroplane',NULL,'Rolls-Royce','M250 (turboprop)'),
  ('Rolls-Royce','Corp 501',NULL,NULL,'Rolls-Royce','501-D'),
  -- ── Modelo escrito en engine_manufacturer ──
  ('Allison/RR AE2100','∅',NULL,NULL,'Rolls-Royce','AE2100'),
  ('CFE 738','∅',NULL,NULL,'CFE Company','CFE738'),
  ('EPI TP400','∅',NULL,NULL,'Europrop International','TP400'),
  ('GEAC H80','∅',NULL,NULL,'General Electric','H80'),
  ('HF120','∅',NULL,NULL,'GE Honda Aero Engines','HF120'),
  ('PowerJet SaM146','∅',NULL,NULL,'PowerJet','SaM146'),
  ('PW210S','∅',NULL,NULL,'Pratt & Whitney Canada','PW210S'),
  ('PW307','∅',NULL,NULL,'Pratt & Whitney Canada','PW307'),
  ('PZL-3S','∅',NULL,NULL,'PZL','PZL-3S'),
  ('Wsk PZL-3S','∅',NULL,NULL,'PZL','PZL-3S'),
  ('Rzeszow PZL-10W','∅',NULL,NULL,'WSK PZL-Rzeszów','PZL-10W'),
  ('TPE331','∅',NULL,NULL,'Honeywell','TPE331'),
  -- ── Deducidas por la aeronave (rating a rating) ──
  ('Klimov','∅',NULL,'Kamov Ka 32 (Klimov)','Klimov','TV3-117'),
  ('ТВД','∅',NULL,'Antonov An-28 (ТВД)','Glushenkov','TVD-10B'),
  ('Ivchenko','∅',NULL,'PZL-104A Wilga (Ivchenko)','Ivchenko-Progress','AI-14'),
  -- ── Genéricas inactivas: fabricante sin modelo ──
  ('Lycoming','Piston',NULL,NULL,'Lycoming','Lycoming (model not specified)'),
  ('Lycoming','∅',NULL,NULL,'Lycoming','Lycoming (model not specified)'),
  ('Continental','∅',NULL,NULL,'Continental','Continental (model not specified)'),
  ('Technify','∅',NULL,NULL,'Continental','Continental diesel (model not specified)'),
  ('Thielert','∅',NULL,NULL,'Continental','Continental diesel (model not specified)'),
  ('Rotax','∅',NULL,NULL,'Rotax','Rotax (model not specified)'),
  ('Franklin','∅',NULL,NULL,'Franklin','Franklin (model not specified)'),
  ('LOM','∅',NULL,NULL,'LOM Praha','LOM (model not specified)'),
  ('Porsche','∅',NULL,NULL,'Porsche','Porsche (model not specified)'),
  ('Vedeneyev','∅',NULL,NULL,'Vedeneyev','Vedeneyev M-14 (model not specified)'),
  ('PZL','∅',NULL,NULL,'PZL','PZL (model not specified)'),
  ('Jacobs','∅',NULL,NULL,'Jacobs','Jacobs (model not specified)'),
  ('Potez','∅',NULL,NULL,'Potez','Potez (model not specified)'),
  ('Rectimo','∅',NULL,NULL,'Rectimo','Rectimo (model not specified)'),
  ('SMA','∅',NULL,NULL,'SMA','SMA (model not specified)'),
  ('Superior','∅',NULL,NULL,'Superior','Superior (model not specified)'),
  ('Volkswagen','∅',NULL,NULL,'Volkswagen','Volkswagen (model not specified)'),
  ('Jabiru','∅',NULL,NULL,'Jabiru','Jabiru (model not specified)'),
  ('Limbach','∅',NULL,NULL,'Limbach','Limbach (model not specified)');


-- Todas las reglas apuntan a un motor que existe. Si no, se aborta ANTES de
-- escribir nada.
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(r.e_man || ' / ' || r.e_disp, ', ') INTO v_bad
  FROM _engine_rules r
  WHERE NOT EXISTS (SELECT 1 FROM public.engines e WHERE e.manufacturer = r.e_man AND e.display_name = r.e_disp);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Reglas con motor destino inexistente: %.', v_bad;
  END IF;
END $$;


CREATE TEMP TABLE _engine_match AS
WITH cand AS (
  SELECT atr.id AS rating_id, e.id AS engine_id,
         (CASE WHEN ru.src_end IS NOT NULL THEN 4 ELSE 0 END)
       + (CASE WHEN ru.src_pt  IS NOT NULL THEN 2 ELSE 0 END) AS spec
  FROM public.aircraft_type_ratings atr
  JOIN _engine_rules ru
    ON ru.src_em = atr.engine_manufacturer
   AND ((ru.src_ef = '∅' AND atr.engine_family IS NULL) OR ru.src_ef = atr.engine_family)
   AND (ru.src_pt  IS NULL OR ru.src_pt  = atr.product_type)
   AND (ru.src_end IS NULL OR ru.src_end = atr.easa_endorsement)
  JOIN public.engines e ON e.manufacturer = ru.e_man AND e.display_name = ru.e_disp
),
top AS (
  SELECT rating_id, max(spec) AS spec FROM cand GROUP BY rating_id
)
SELECT c.rating_id, c.engine_id, count(*) OVER (PARTITION BY c.rating_id) AS n_top
FROM cand c JOIN top t ON t.rating_id = c.rating_id AND t.spec = c.spec;


DO $$
DECLARE v_ambiguous INT;
BEGIN
  SELECT count(DISTINCT rating_id) INTO v_ambiguous FROM _engine_match WHERE n_top > 1;
  IF v_ambiguous > 0 THEN
    RAISE EXCEPTION '% ratings casan con dos reglas del mismo nivel. No se enlaza nada.', v_ambiguous;
  END IF;
END $$;


UPDATE public.aircraft_type_ratings atr
SET engine_id = m.engine_id
FROM _engine_match m
WHERE m.rating_id = atr.id
  AND atr.engine_id IS NULL;


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE
  v_unlinked_matched INT;
  v_divergent        INT;
  v_linked           INT;
  v_null             INT;
  v_g164             UUID;
BEGIN
  -- Ningún rating con regla se queda sin motor.
  SELECT count(*) INTO v_unlinked_matched
  FROM _engine_match m JOIN public.aircraft_type_ratings atr ON atr.id = m.rating_id
  WHERE atr.engine_id IS NULL;
  IF v_unlinked_matched <> 0 THEN
    RAISE EXCEPTION '% ratings con regla siguen con engine_id NULL.', v_unlinked_matched;
  END IF;

  -- Ni enlazado a un motor distinto del de su regla.
  SELECT count(*) INTO v_divergent
  FROM _engine_match m JOIN public.aircraft_type_ratings atr ON atr.id = m.rating_id
  WHERE atr.engine_id <> m.engine_id;
  IF v_divergent <> 0 THEN
    RAISE EXCEPTION '% ratings apuntan a un motor distinto del de su regla.', v_divergent;
  END IF;

  -- El G-164 se queda en NULL a propósito.
  SELECT engine_id INTO v_g164 FROM public.aircraft_type_ratings
  WHERE engine_manufacturer = 'Pratt & Whitney' AND engine_family = 'R Series';
  IF v_g164 IS NOT NULL THEN
    RAISE EXCEPTION 'El G-164 (PW R Series) no debe tener motor: R-985 o R-1340 no se puede decidir.';
  END IF;

  SELECT count(*) FILTER (WHERE engine_id IS NOT NULL), count(*) FILTER (WHERE engine_id IS NULL)
  INTO v_linked, v_null FROM public.aircraft_type_ratings;
  RAISE NOTICE 'aircraft_type_ratings: % con engine_id, % en NULL.', v_linked, v_null;
END $$;

DROP TABLE _engine_match;
DROP TABLE _engine_rules;

NOTIFY pgrst, 'reload schema';
