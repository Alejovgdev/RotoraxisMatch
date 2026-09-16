-- ============================================================
-- AviationJobTalent V2 — Migration 071: seed del catálogo de motores
-- ============================================================
-- Created: 2026-09-15 (Fase 10, paso 2). Borrador aprobado el mismo día.
--
-- 164 filas. De dónde sale cada una:
--
--   catálogo   Derivadas de aircraft_type_ratings.engine_family, con su
--              granularidad (PT6, TFE731, CFM56, Arriel 1/2…). Se FUSIONAN las
--              grafías duplicadas (`TPE 331`/`TPE-331`/`TPE331`, `4000`/`PW4000`,
--              `FJ 44`/`FJ44`…) y se CONSERVAN las variantes que el catálogo
--              distingue (Arriel 2C, Arrius 2B, PW308C, CT7-8…).
--   limpiadas  Las filas sucias: el Model 250 (`Corp 250` 22 + `250` 3 + `M250`
--              1) y las 12 con el modelo escrito en engine_manufacturer.
--   partidas   Una familia que el catálogo junta pero que es turbohélice en
--              avión y turboeje en helicóptero (PT6, CT7, Astazou, M250): una
--              fila por tipo, misma familia. Los 5 PT6 de helicóptero van a
--              PT6B/PT6C/PT6T rating a rating (072).
--   combinadas PW530/PW535, PW125/PW127, PW206/PW207: cada una es UN rating que
--              cubre dos modelos. Mejor crédito de familia que dejarlos en NULL.
--   deducidas  Tres ratings cuyo texto no nombra el motor pero la aeronave lo
--              fija sin ambigüedad: Ka-32 -> TV3-117, An-28 -> TVD-10B, Wilga ->
--              AI-14. El G-164 ("PW R Series", R-985 o R-1340) NO: se queda en
--              NULL, porque un enlace inventado se propaga a todo el matching.
--   a mano     Lo que el catálogo no puede tener: modelos de pistón Lycoming,
--              Continental y Rotax, y APUs. Sin ratings detrás.
--   genéricas  17 filas "<fabricante> (model not specified)", INACTIVAS. Los
--              ~270 ratings de pistón traen el fabricante pero no el modelo; se
--              enlazan aquí para que den crédito de FAMILIA. Inactivas para que
--              nadie pueda declararlas ni pedirlas. El matching mira is_active:
--              un rating enlazado a una genérica nunca da motor exacto (test
--              "genérico INACTIVO" en scripts/testMatching.ts).
--
-- Criterios de columna:
--   - `family` en turbinas es la serie (PT6, Arriel, PW300); en pistón, la
--     línea del fabricante (Lycoming, Continental, P&W radial).
--   - Fabricantes normalizados: Turbomeca/Safran -> Safran Helicopter Engines;
--     LTS101/LTP101 -> Honeywell (venían como Lycoming); Rolls-Royce
--     Deutschland -> Rolls-Royce; Ivchenko -> Ivchenko-Progress.
--
-- Idempotente: clave natural (manufacturer, display_name), ON CONFLICT DO
-- NOTHING. Sin ids fijos; el backfill (072) enlaza por la clave natural.
-- ============================================================


CREATE TEMP TABLE _engine_seed (
  manufacturer TEXT NOT NULL,
  family       TEXT NOT NULL,
  engine_type  TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL
);

INSERT INTO _engine_seed (manufacturer, family, engine_type, display_name, is_active) VALUES
  -- ── Turbofán ──
  ('CFE Company',                'CFE738',  'turbofan', 'CFE738',          true),
  ('CFM International',          'CFM56',   'turbofan', 'CFM56',           true),
  ('CFM International',          'LEAP',    'turbofan', 'LEAP-1A',         true),
  ('CFM International',          'LEAP',    'turbofan', 'LEAP-1B',         true),
  ('Engine Alliance',            'GP7200',  'turbofan', 'GP7200',          true),
  ('GE Honda Aero Engines',      'HF120',   'turbofan', 'HF120',           true),
  ('General Electric',           'CF34',    'turbofan', 'CF34',            true),
  ('General Electric',           'CF6',     'turbofan', 'CF6',             true),
  ('General Electric',           'CF700',   'turbofan', 'CF700',           true),
  ('General Electric',           'GE90',    'turbofan', 'GE90',            true),
  ('General Electric',           'GEnx',    'turbofan', 'GEnx',            true),
  ('General Electric',           'Passport','turbofan', 'Passport 20',     true),
  ('Honeywell',                  'ALF502',  'turbofan', 'ALF502',          true),
  ('Honeywell',                  'ATF3',    'turbofan', 'ATF3-6',          true),
  ('Honeywell',                  'HTF7000', 'turbofan', 'HTF7000 (AS907)', true),
  ('Honeywell',                  'TFE731',  'turbofan', 'TFE731',          true),
  ('International Aero Engines', 'V2500',   'turbofan', 'V2500',           true),
  ('Ivchenko-Progress',          'D-436',   'turbofan', 'D-436TP',         true),
  ('PowerJet',                   'SaM146',  'turbofan', 'SaM146',          true),
  ('Pratt & Whitney',            'JT3D',    'turbofan', 'JT3D',            true),
  ('Pratt & Whitney',            'JT8D',    'turbofan', 'JT8D',            true),
  ('Pratt & Whitney',            'JT9D',    'turbofan', 'JT9D',            true),
  ('Pratt & Whitney',            'PW1000G', 'turbofan', 'PW1100G',         true),
  ('Pratt & Whitney',            'PW1000G', 'turbofan', 'PW1500G',         true),
  ('Pratt & Whitney',            'PW1000G', 'turbofan', 'PW1900G',         true),
  ('Pratt & Whitney',            'PW2000',  'turbofan', 'PW2000',          true),
  ('Pratt & Whitney',            'PW4000',  'turbofan', 'PW4000',          true),
  ('Pratt & Whitney',            'PW6000',  'turbofan', 'PW6000',          true),
  ('Pratt & Whitney Canada',     'JT15D',   'turbofan', 'JT15D',           true),
  ('Pratt & Whitney Canada',     'PW300',   'turbofan', 'PW305',           true),
  ('Pratt & Whitney Canada',     'PW300',   'turbofan', 'PW306',           true),
  ('Pratt & Whitney Canada',     'PW300',   'turbofan', 'PW307',           true),
  ('Pratt & Whitney Canada',     'PW300',   'turbofan', 'PW308',           true),
  ('Pratt & Whitney Canada',     'PW300',   'turbofan', 'PW308C',          true),
  ('Pratt & Whitney Canada',     'PW500',   'turbofan', 'PW530/PW535',     true),
  ('Pratt & Whitney Canada',     'PW500',   'turbofan', 'PW535',           true),
  ('Pratt & Whitney Canada',     'PW500',   'turbofan', 'PW545',           true),
  ('Pratt & Whitney Canada',     'PW600',   'turbofan', 'PW610',           true),
  ('Pratt & Whitney Canada',     'PW600',   'turbofan', 'PW615',           true),
  ('Pratt & Whitney Canada',     'PW600',   'turbofan', 'PW617',           true),
  ('Pratt & Whitney Canada',     'PW800',   'turbofan', 'PW800',           true),
  ('Rolls-Royce',                'AE3007',  'turbofan', 'AE3007A',         true),
  ('Rolls-Royce',                'AE3007',  'turbofan', 'AE3007C',         true),
  ('Rolls-Royce',                'BR700',   'turbofan', 'BR710',           true),
  ('Rolls-Royce',                'BR700',   'turbofan', 'BR715',           true),
  ('Rolls-Royce',                'BR700',   'turbofan', 'BR725',           true),
  ('Rolls-Royce',                'Conway',  'turbofan', 'Conway',          true),
  ('Rolls-Royce',                'RB211',   'turbofan', 'RB211',           true),
  ('Rolls-Royce',                'Spey',    'turbofan', 'Spey',            true),
  ('Rolls-Royce',                'Tay',     'turbofan', 'Tay',             true),
  ('Rolls-Royce',                'Trent',   'turbofan', 'Trent 500',       true),
  ('Rolls-Royce',                'Trent',   'turbofan', 'Trent 700',       true),
  ('Rolls-Royce',                'Trent',   'turbofan', 'Trent 800',       true),
  ('Rolls-Royce',                'Trent',   'turbofan', 'Trent 900',       true),
  ('Rolls-Royce',                'Trent',   'turbofan', 'Trent 1000',      true),
  ('Rolls-Royce',                'Trent',   'turbofan', 'Trent 7000',      true),
  ('Rolls-Royce',                'Trent',   'turbofan', 'Trent XWB',       true),
  ('Williams International',     'FJ33',    'turbofan', 'FJ33',            true),
  ('Williams International',     'FJ44',    'turbofan', 'FJ44',            true),
  -- ── Turborreactor ──
  ('General Electric',           'CJ610',   'turbojet', 'CJ610',           true),
  ('Pratt & Whitney',            'JT12',    'turbojet', 'JT12',            true),
  ('Pratt & Whitney',            'JT4',     'turbojet', 'JT4A',            true),
  ('Rolls-Royce',                'Viper',   'turbojet', 'Viper',           true),
  -- ── Turbohélice ──
  ('Europrop International',     'TP400',   'turboprop', 'TP400',               true),
  ('General Electric',           'CT7',     'turboprop', 'CT7 (turboprop)',     true),
  ('General Electric',           'H80',     'turboprop', 'H80',                 true),
  ('Glushenkov',                 'TVD-10',  'turboprop', 'TVD-10B',             true),
  ('Honeywell',                  'LTS101',  'turboprop', 'LTP101',              true),
  ('Honeywell',                  'TPE331',  'turboprop', 'TPE331',              true),
  ('Ivchenko-Progress',          'AI-24',   'turboprop', 'AI-24',               true),
  ('Pratt & Whitney Canada',     'PT6',     'turboprop', 'PT6A',                true),
  ('Pratt & Whitney Canada',     'PW100',   'turboprop', 'PW110 series',        true),
  ('Pratt & Whitney Canada',     'PW100',   'turboprop', 'PW119',               true),
  ('Pratt & Whitney Canada',     'PW100',   'turboprop', 'PW120',               true),
  ('Pratt & Whitney Canada',     'PW100',   'turboprop', 'PW123',               true),
  ('Pratt & Whitney Canada',     'PW100',   'turboprop', 'PW125/PW127',         true),
  ('Pratt & Whitney Canada',     'PW100',   'turboprop', 'PW127',               true),
  ('Pratt & Whitney Canada',     'PW100',   'turboprop', 'PW150',               true),
  ('Rolls-Royce',                'AE2100',  'turboprop', 'AE2100',              true),
  ('Rolls-Royce',                'Dart',    'turboprop', 'Dart',                true),
  ('Rolls-Royce',                'M250',    'turboprop', 'M250 (turboprop)',    true),
  ('Rolls-Royce',                'T56/501', 'turboprop', '501-D',               true),
  ('Safran Helicopter Engines',  'Astazou', 'turboprop', 'Astazou (turboprop)', true),
  ('Walter',                     'M601',    'turboprop', 'M601',                true),
  -- ── Turboeje ──
  ('General Electric',           'CT58',    'turboshaft', 'CT58',                 true),
  ('General Electric',           'CT7',     'turboshaft', 'CT7 (turboshaft)',     true),
  ('General Electric',           'CT7',     'turboshaft', 'CT7-8',                true),
  ('Honeywell',                  'LTS101',  'turboshaft', 'LTS101',               true),
  ('Honeywell',                  'T53',     'turboshaft', 'T53',                  true),
  ('Honeywell',                  'T53',     'turboshaft', 'T53-17',               true),
  ('Honeywell',                  'T55',     'turboshaft', 'T5508',                true),
  ('Klimov',                     'TV3-117', 'turboshaft', 'TV3-117',              true),
  ('Pratt & Whitney',            'JFTD12',  'turboshaft', 'JFTD12',               true),
  ('Pratt & Whitney Canada',     'PT6',     'turboshaft', 'PT6B',                 true),
  ('Pratt & Whitney Canada',     'PT6',     'turboshaft', 'PT6C',                 true),
  ('Pratt & Whitney Canada',     'PT6',     'turboshaft', 'PT6T Twin-Pac',        true),
  ('Pratt & Whitney Canada',     'PW200',   'turboshaft', 'PW206',                true),
  ('Pratt & Whitney Canada',     'PW200',   'turboshaft', 'PW206/PW207',          true),
  ('Pratt & Whitney Canada',     'PW200',   'turboshaft', 'PW207D',               true),
  ('Pratt & Whitney Canada',     'PW200',   'turboshaft', 'PW210',                true),
  ('Pratt & Whitney Canada',     'PW200',   'turboshaft', 'PW210S',               true),
  ('Rolls-Royce',                'M250',    'turboshaft', 'M250 (turboshaft)',    true),
  ('Safran Helicopter Engines',  'Arriel',  'turboshaft', 'Arriel 1',             true),
  ('Safran Helicopter Engines',  'Arriel',  'turboshaft', 'Arriel 2',             true),
  ('Safran Helicopter Engines',  'Arriel',  'turboshaft', 'Arriel 2C',            true),
  ('Safran Helicopter Engines',  'Arrius',  'turboshaft', 'Arrius 1',             true),
  ('Safran Helicopter Engines',  'Arrius',  'turboshaft', 'Arrius 2',             true),
  ('Safran Helicopter Engines',  'Arrius',  'turboshaft', 'Arrius 2B',            true),
  ('Safran Helicopter Engines',  'Arrius',  'turboshaft', 'Arrius 2F',            true),
  ('Safran Helicopter Engines',  'Arrius',  'turboshaft', 'Arrius 2R',            true),
  ('Safran Helicopter Engines',  'Artouste','turboshaft', 'Artouste',             true),
  ('Safran Helicopter Engines',  'Astazou', 'turboshaft', 'Astazou (turboshaft)', true),
  ('Safran Helicopter Engines',  'Astazou', 'turboshaft', 'Astazou XIV',          true),
  ('Safran Helicopter Engines',  'Makila',  'turboshaft', 'Makila 1A/1A1',        true),
  ('Safran Helicopter Engines',  'Makila',  'turboshaft', 'Makila 1A2',           true),
  ('Safran Helicopter Engines',  'Makila',  'turboshaft', 'Makila 2A',            true),
  ('Safran Helicopter Engines',  'Turmo',   'turboshaft', 'Turmo',                true),
  ('WSK PZL-Rzeszów',            'PZL-10',  'turboshaft', 'PZL-10W',              true),
  -- ── Pistón con modelo (catálogo, limpiadas y deducida) ──
  ('Austro Engine',              'Austro Engine',   'piston', 'AE300',              true),
  ('Ivchenko-Progress',          'Ivchenko radial', 'piston', 'AI-14',              true),
  ('JPX',                        'JPX',             'piston', '4T60',               true),
  ('Limbach',                    'Limbach',         'piston', 'L2000',              true),
  ('Pratt & Whitney',            'P&W radial',      'piston', 'R-985 Wasp Junior',  true),
  ('Pratt & Whitney',            'P&W radial',      'piston', 'R-1340 Wasp',        true),
  ('Pratt & Whitney',            'P&W radial',      'piston', 'R-2800 Double Wasp', true),
  ('PZL',                        'PZL',             'piston', 'PZL-3S',             true),
  ('Walter',                     'Walter',          'piston', 'Minor / M337',       true),
  ('Wright',                     'Wright radial',   'piston', 'R-1820 Cyclone',     true),
  -- ── Pistón a mano (sin ratings detrás) ──
  ('Lycoming',                   'Lycoming',        'piston', 'O-235 series',             true),
  ('Lycoming',                   'Lycoming',        'piston', 'O-320 series',             true),
  ('Lycoming',                   'Lycoming',        'piston', 'O-360 series',             true),
  ('Lycoming',                   'Lycoming',        'piston', 'O-540 series',             true),
  ('Continental',                'Continental',     'piston', 'O-200 series',             true),
  ('Continental',                'Continental',     'piston', 'O-470 series',             true),
  ('Continental',                'Continental',     'piston', 'IO-520 series',            true),
  ('Continental',                'Continental',     'piston', 'IO-550 series',            true),
  ('Continental',                'Continental',     'piston', 'CD-135 / CD-155 (diesel)', true),
  ('Rotax',                      'Rotax',           'piston', '912 series',               true),
  ('Rotax',                      'Rotax',           'piston', '914 series',               true),
  ('Rotax',                      'Rotax',           'piston', '915 iS',                   true),
  ('Rotax',                      'Rotax',           'piston', '916 iS',                   true),
  -- ── APU a mano ──
  ('Honeywell',                  'GTCP85',          'apu', 'GTCP85',    true),
  ('Honeywell',                  'GTCP131',         'apu', 'GTCP131-9', true),
  ('Honeywell',                  'GTCP331',         'apu', 'GTCP331',   true),
  ('Pratt & Whitney Canada',     'APS',             'apu', 'APS2300',   true),
  ('Pratt & Whitney Canada',     'APS',             'apu', 'APS3200',   true),
  ('Pratt & Whitney Canada',     'APS',             'apu', 'APS5000',   true),
  -- ── Genéricas: INACTIVAS, sólo crédito de familia ──
  ('Continental', 'Continental', 'piston', 'Continental (model not specified)',        false),
  ('Continental', 'Continental', 'piston', 'Continental diesel (model not specified)', false),
  ('Franklin',    'Franklin',    'piston', 'Franklin (model not specified)',           false),
  ('Jabiru',      'Jabiru',      'piston', 'Jabiru (model not specified)',             false),
  ('Jacobs',      'Jacobs',      'piston', 'Jacobs (model not specified)',             false),
  ('Limbach',     'Limbach',     'piston', 'Limbach (model not specified)',            false),
  ('LOM Praha',   'LOM',         'piston', 'LOM (model not specified)',                false),
  ('Lycoming',    'Lycoming',    'piston', 'Lycoming (model not specified)',           false),
  ('Porsche',     'Porsche',     'piston', 'Porsche (model not specified)',            false),
  ('Potez',       'Potez',       'piston', 'Potez (model not specified)',              false),
  ('PZL',         'PZL',         'piston', 'PZL (model not specified)',                false),
  ('Rectimo',     'Rectimo',     'piston', 'Rectimo (model not specified)',            false),
  ('Rotax',       'Rotax',       'piston', 'Rotax (model not specified)',              false),
  ('SMA',         'SMA',         'piston', 'SMA (model not specified)',                false),
  ('Superior',    'Superior',    'piston', 'Superior (model not specified)',           false),
  ('Vedeneyev',   'Vedeneyev',   'piston', 'Vedeneyev M-14 (model not specified)',     false),
  ('Volkswagen',  'Volkswagen',  'piston', 'Volkswagen (model not specified)',         false);

INSERT INTO public.engines (manufacturer, family, engine_type, display_name, is_active)
SELECT manufacturer, family, engine_type, display_name, is_active FROM _engine_seed
ON CONFLICT (manufacturer, display_name) DO NOTHING;


-- ── Post-condiciones ───────────────────────────────────────

DO $$
DECLARE
  v_seed      INT;
  v_present   INT;
  v_generic   INT;
  v_bad_flags INT;
BEGIN
  SELECT count(*) INTO v_seed FROM _engine_seed;
  IF v_seed <> 164 THEN
    RAISE EXCEPTION 'El seed debería tener 164 filas, tiene %.', v_seed;
  END IF;

  -- Cada fila del seed está en engines CON LOS MISMOS atributos. Un ON CONFLICT
  -- DO NOTHING contra una fila previa distinta pasaría en silencio sin esto.
  SELECT count(*) INTO v_present
  FROM _engine_seed s
  JOIN public.engines e
    ON e.manufacturer = s.manufacturer AND e.display_name = s.display_name
   AND e.family = s.family AND e.engine_type = s.engine_type AND e.is_active = s.is_active;
  IF v_present <> 164 THEN
    RAISE EXCEPTION 'Sólo % de las 164 filas del seed están en engines con sus atributos.', v_present;
  END IF;

  SELECT count(*) INTO v_generic FROM _engine_seed WHERE display_name LIKE '%(model not specified)';
  IF v_generic <> 17 THEN
    RAISE EXCEPTION 'Esperaba 17 genéricas en el seed, encontré %.', v_generic;
  END IF;

  -- Genérica <=> inactiva, en las dos direcciones. Sobre el seed y no sobre
  -- toda la tabla: desactivar después un motor real es legítimo.
  SELECT count(*) INTO v_bad_flags FROM _engine_seed
  WHERE (display_name LIKE '%(model not specified)') <> (NOT is_active);
  IF v_bad_flags <> 0 THEN
    RAISE EXCEPTION '% motores rompen "genérica <=> inactiva".', v_bad_flags;
  END IF;

  RAISE NOTICE 'engines: 164 filas sembradas (17 genéricas inactivas).';
END $$;

DROP TABLE _engine_seed;

NOTIFY pgrst, 'reload schema';
