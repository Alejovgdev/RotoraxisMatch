# Auditoría final de Fase 10

Informe de referencia de la auditoría anterior, trasladado de la conversación al
repositorio por petición del usuario durante el paso 5d. Describe el estado
auditado en `f7d9275`, **antes de las correcciones del paso 5d**. Los identificadores
H1–H16 se conservan para relacionar correcciones y tareas pendientes.

## 1. Dictamen y alcance

No aprobar el merge en el estado auditado. Hay fallos de seguridad, pérdida de
datos y selección de credenciales que deben corregirse antes. No se confirmó
ningún hallazgo de severidad crítica.

La auditoría fue de solo lectura, sobre `fase-10-motores-autoridades`, comparando
los cambios de `1c6300c`, `121f75f` y `61119ea` con `main`. Se revisaron código,
migraciones 064–080, documentación y catálogos vivos. No se aplicaron migraciones
ni se intentaron explotaciones mediante escrituras durante aquella auditoría.

## 2. Construcción y comprobaciones verificadas

- `npm run ts`: limpio.
- Matching: 229 tests; formulario: 20 tests; salario, URL, mapa y ubicación: PASS.
- `validate:authority-licenses`: 51 combinaciones, cero errores.
- `validate:application-eligibility`: 386 casos sin divergencias TS/SQL.
- Motores: 164 filas, 147 activas y 17 genéricas inactivas.
- Type ratings: 606 activos; 337 enlazados a motores activos, 268 a genéricos
  inactivos y uno sin motor (Grumman G-164 con PW R Series).
- Las 268 referencias genéricas coinciden con el JSON de origen EASA. De ellas,
  102 tienen un único alias y 166 varios. Las primeras son una prioridad de
  investigación; no se afirmó que todas pudieran resolverse de forma unívoca.
- La RPC privada de hechos rechazaba ejecución anónima con 42501. Esta protección
  no bastaba para impedir el oráculo a través del trigger (H5).

## 3. Hallazgos

### H1 — Alta: reemplazos con pérdida de datos

`technicianRepositoryV2.replaceHabilitations` borra antes de resolver la
credencial. Una referencia ausente o un fallo posterior deja la lista vacía.
`replaceEngineExperience` y `offerRepository.replaceRequiredHabilitations`
separan DELETE e INSERT; `offerRepository.update` puede borrar aeronaves antes de
que falle el UPDATE. El editor de motores admite 71–99 años y la base solo 0–70.
Se requiere guardado transaccional con validación previa y control de rango.

### H2 — Alta: añadir una credencial puede bajar el porcentaje

`selectLicenseForOffer` compara cobertura sin vigencia de las habilitaciones y
sitúa fecha de caducidad antes que autoridad exacta. Reproducciones: una EASA
vigente pasa de 100 a 87 al añadir una UK CAA con fecha más lejana; si esta tiene
el rating caducado, el resultado pasa de 100 a 39. Elegir por cobertura efectiva
de la oferta completa, conservando una sola credencial para todos sus requisitos.

### H3 — Alta: se admiten habilitaciones fuera del alcance de la licencia

El selector permite ratings individuales en A, B2L, B3 y L; el filtro de producto
no impide, por ejemplo, una B1 de pistón con aeronave de turbina. Las FK de la
074 aseguran pertenencia e integridad, pero no el alcance normativo. Se necesita
validación por autoridad en UI y servidor y un inventario previo de filas
existentes, sin borrado automático.

### H4 — Alta: cambio de participantes elude elegibilidad

La 080 solo dispara elegibilidad en INSERT y UPDATE de `status`. Cambiar
`offer_id` manteniendo `pending` evita el control. Las RLS de candidaturas y el
trigger de transición no congelan `offer_id`, `technician_id` ni `company_id`.
Hallazgo estático en la auditoría; requería reproducción real con rollback.

### H5 — Alta: oráculo de cualificaciones mediante trigger

El trigger SECURITY DEFINER consulta los datos del técnico indicado antes de
verificar que sea el usuario autenticado. Un INSERT ajeno puede producir un
motivo específico en lugar del error genérico de RLS. PostgreSQL ejecuta los
BEFORE triggers antes de WITH CHECK. Debe autorizar antes de leer hechos privados.
Hallazgo estático; no se explotó escribiendo en producción durante la auditoría.

### H6 — Alta: CFM56 demasiado agregado para el matching exacto

El catálogo vivo solo contiene `CFM56`, sin separar -5B y -7B. A320 y 737NG
acaban en el mismo motor y reciben el mismo crédito implícito (52 en el eje;
87 total en el caso reproducido). Los tests usaban variantes sintéticas que no
reflejaban esta limitación. Requiere otra fase de catálogo.

### H7 — Alta: CASA se trata incorrectamente como licencia que caduca

`authorityLicenseCanExpire` excluye únicamente FAA. La guía oficial CASA describe
la licencia Part-66 como perpetua, con requisitos de ejercicio reciente separados.
Una fecha antigua guardada no debe invalidarla y la UI no debe pedir esa fecha.

### H8 — Alta: cobertura de categorías incompleta

`licenseCodeSatisfies` usa igualdad para Part-66 y solo añade A&P → A/P. Omite
B1.x → A.x correspondiente. Tampoco considera FAA A y P en dos filas como A&P:
en la reproducción, A+P dio 35 y A&P dio 100. La cobertura de categorías debe
respetar la autoridad y mantener separadas las credenciales Part-66.

### H9 — Media: catálogo de licencias incompleto

Faltan B1.E de EASA, subcategorías L y sistemas B2L. L no tiene el mismo alcance
en todas las autoridades. FAA tiene además IA y repairman con alcances distintos.
No se debe propagar automáticamente una categoría nueva de EASA a UK/CASA/GCAA.
La propuesta FAA de sustituir IA por Inspection Rating no se trató como norma
vigente. Completar catálogos queda fuera de las correcciones mínimas.

### H10 — Media: familias de motor demasiado amplias

Continental agrupa tecnologías diferentes. PT6 reúne turboprop y turboshaft,
aunque existe herencia técnica entre variantes. Debe distinguirse similitud
profesional de autorización para certificar o realizar overhaul de componentes.

### H11 — Media: los escalones del motor no garantizan el orden total

Los factores 1 / .8 / .55 / .3 / .12 / .05 ordenan el componente motor. No
garantizan que un motor declarado siempre supere a uno implícito en el total:
otros ejes pueden invertirlo (80 frente a 87 en la reproducción). Ajustar el
texto o adoptar otra regla de producto explícita.

### H12 — Media: carga de relaciones sin paginación

`loadTechnicianRelations` carga relaciones de varios técnicos sin paginar ni
verificar completitud. Un límite de respuesta puede dejar licencias o motores
fuera y cambiar puntuación/elegibilidad. El validador del núcleo no cubre el
transporte. Corrección diferida a una fase de paginación.

### H13 — Media: búsqueda continúa sin filtro si falla matching

La búsqueda de empresa convierte el fallo de `matchPairs` en `null` y sigue
mostrando resultados sin exclusiones. Debe mostrar error. También hay diferencias
de filtrado previo entre direcciones (años/visibilidad/verificación); no todas
las exclusiones viven en el núcleo de elegibilidad.

### H14 — Media: 064–080 no son reejecutables

Varias postcondiciones exigen datos de la primera aplicación: tabla de motores
vacía (068), ofertas originales (070), ausencia de multi-autoridad (074), todas
las equivalencias desactivadas (075). El autotest de 077 espera un CHECK donde
079 ya impone NOT NULL. Documentar aplicación única; no volver a aplicar esos
archivos ni usar `supabase db push` con el historial de prefijos actual.

### H15 — Media: RLS de cualificaciones más amplia que la del perfil

Las políticas de empresa de licencias, habilitaciones y motores solo exigen
usuario de empresa activo. Pueden exponer cualificaciones de perfiles que la
vista pública oculta. Alinear con visibilidad o relación existente. No se
demostró reidentificación de personas a partir de patrones de cualificaciones.

### H16 — Baja: documentación y textos contradictorios

CLAUDE.md aún dice que experiencia de aeronaves no puntúa, que la edad sigue
expuesta y que solo existen dos filtros en toda la plataforma. Describe como
correcta la igualdad Part-66 y confunde prioridad del eje motor con ranking
total. El texto de equivalencias enumera UK/CASA/GCAA incluso cuando la elegida
es una de ellas y omite EASA. También se confunde motor inactivo con genérico.

## 4. Decisiones de producto que deben permanecer explícitas

- Autoridad equivalente es una preferencia de búsqueda, no reconocimiento legal
  automático. UK y EASA no son intercambiables por defecto tras Brexit.
- Vigencia del documento, habilitación, experiencia reciente y autorización de
  empresa son conceptos distintos. EASA y UK: cinco años administrativos;
  GCAA: ocho; CASA y FAA: sin caducidad del documento.
- FAA carece de type ratings en el certificado, pero se puede requerir experiencia
  en aeronaves. FAA A puede ser relevante para trabajo de aviónica. Ambas
  decisiones de oferta se reservan para fases siguientes.
- Una licencia requerida en oferta de motor es otra decisión pendiente; una B1
  con rating no acredita por sí sola autorización de taller de componentes.
- `only_unlicensed` excluye cualquier licencia declarada, incluso caducada.
- Ofertas directas y cambios posteriores de una oferta no reevalúan las
  candidaturas existentes. Hay que decidir cuándo reevaluar y qué conservar
  como historial.

## 5. Qué está bien

Identidad de credenciales por fila y autoridad; FK compuestas y unicidad por
credencial; retirada selectiva de licencias; `PairMatch` compartido por pantallas;
catálogo de motores con inactivos para mantener la evidencia histórica; códigos
FAA A/P distintos de A1–A4; RPC privada revocada; tests de reglas puras y validador
TS/SQL como protección frente a divergencias.

## 6. Pruebas prioritarias

P0: dos regresiones de selección de credencial; pérdida de habilitaciones por
credencial ausente; motores con 71 años; fallos de red/escritura tras borrado;
edición de oferta atómica; modificación de participantes; oráculo sobre terceros;
ratings incompatibles con categoría o tipo de motor. Las pruebas de base deben
ejecutarse con rol real y rollback.

P1: FAA A/P/A&P; CASA con fecha histórica; B1 frente a B2 para evidencia de motor;
solo sin licencia; retirada de una autoridad; transiciones del formulario; fallo
de catálogo. P2: lotes grandes de relaciones, perfiles ocultos, escritorio/móvil.

## 7. Límites de aquella auditoría y fuentes

No se probaron mutaciones/ataques en producción, instalación desde cero, ni
interacciones manuales completas en UI. No se contrastaron individualmente los
606 ratings con cada autoridad ni se resolvieron los 268 genéricos. Los tests
verdes no certifican esos extremos.

Fuentes oficiales consultadas para las conclusiones normativas:

- [EASA / Reglamento 1321/2014 consolidado, 7 agosto 2026](https://eur-lex.europa.eu/eli/reg/2014/1321/2026-08-07/eng/pdf): 66.A.3, 66.A.20, 66.A.40 y 66.A.45.
- [Reglamento 2025/111](https://eur-lex.europa.eu/eli/reg_impl/2025/111/oj/eng/pdf): categoría B1.E y fechas de aplicación.
- [EASA Part-66 FAQ](https://www.easa.europa.eu/en/the-agency/faqs/part-66): alcance y categorías.
- [UK CAA Part-66 general guidance](https://www.caa.co.uk/commercial-industry/aircraft/airworthiness/engineer-licences/uk-part-66/part-66-general-guidance/).
- [CASA, guía de carrera del ingeniero de mantenimiento](https://www.casa.gov.au/sites/default/files/2021-12/aircraft-maintenance-engineer-careers-guide.pdf): licencia perpetua y experiencia reciente.
- [GCAA CAR-66 Issue 06](https://www.gcaa.gov.ae/en/epublication/EPublications/Civil%20Aviation%20Regulations%20%28CARs%29/CAR%20II%20-%20LICENSING%20AND%20TRAINING%20ORGANISATION%20REGULATIONS/CAR-66%20-%20AIRCRAFT%20MAINTENANCE%20ENGINEER%20LICENSING%20-%20ISSUE%2006.pdf): categorías y validez de ocho años.
- [FAA, 14 CFR Part 65 Subpart D](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-65/subpart-D) y [FAA FAQ](https://www.faa.gov/mechanics/become/faq): ratings A/P, privilegios y experiencia reciente.
- [CFM, motores históricos](https://www.cfmaeroengines.com/cfm56/legacy-engines): variantes de CFM56.
- [PostgreSQL 17, CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html): orden de BEFORE triggers y WITH CHECK.
