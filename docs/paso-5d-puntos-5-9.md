# Paso 5d — puntos 5–9

Fecha: 17 septiembre 2026. Rama: `fase-10-motores-autoridades`.

## Comprobación inicial

Árbol limpio. Ocho suites de tests PASS (matching 234, formulario 20,
transacciones 3, base 26, ubicación 45, salario, URL y mapa).
`npm run ts` limpio. Validadores: autoridades 51 filas PASS; elegibilidad
386 casos, cero divergencias TS/SQL, PASS.

## 5 — H7: caducidad por autoridad

Verificada antes de cambiar código la [guía oficial CASA, página impresa 7](https://www.casa.gov.au/sites/default/files/2021-12/aircraft-maintenance-engineer-careers-guide.pdf):
licencia perpetua; experiencia reciente separada de la caducidad documental.
FAA y CASA no solicitan caducidad en el perfil ni interpretan una fecha histórica
como vencimiento. La validación de fechas de licencia usa la misma política.
EASA, UK CAA y GCAA mantienen la caducidad. No se borran fechas almacenadas ni
se modifica la vigencia independiente de las habilitaciones.

Reproducción: regresión H7 falla antes del cambio; después compara licencias
con/sin fecha histórica, ofertas con/sin aeronave y las cinco autoridades.

## Inventario previo H3

Consulta de todas las habilitaciones, sin filtro de actividad ni paginación,
uniendo su credencial por ID, rating por ID y motor por `engine_id`:
**8 filas, 0 incompatibilidades de propulsión** (B1.2/B1.4 con turbina y
B1.1/B1.3 con pistón), 0 categorías prohibidas, 0 productos incompatibles,
0 B1 de propulsión desconocida. Comunicado al usuario antes de aplicar reglas.
Distribución: EASA B1.1/turbofan/avión 1; B1.3/turboshaft/helicóptero 2;
B2/turbofan/avión 1; B2/turboshaft/helicóptero 4. Sin borrar filas.

## 6 — H3: alcance de habilitaciones individuales

El selector del perfil ofrece únicamente B1.x, B2 y C en las combinaciones
existentes de autoridad/licencia. B1.x exige producto y propulsión compatibles;
el filtro se aplica antes del límite de resultados y no tiene «Show all».
Una B1 con motor desconocido/APU no permite una habilitación nueva. Los motores
se resuelven por `engine_id`, incluidos los inactivos; no por textos ni familias.
Las filas existentes siguen visibles y no se eliminan automáticamente.

Migración propuesta: `083_individual_type_rating_scope.sql`. Añade el predicado
SQL y dos triggers: escrituras de habilitaciones y cambios de autoridad/categoría
de su credencial. Mantiene RLS mediante SECURITY INVOKER y cubre la RPC 082.
No modifica catálogos, ofertas ni filas históricas. Preparada, **no aplicada**.

Reproducción anterior: 411 controles con rollback; la RPC y el INSERT directo
admitían combinaciones incompatibles. El UPDATE directo del técnico **no se
reprodujo**: RLS ya impide modificar filas por ese camino. El nuevo trigger se
comprueba también en UPDATE de mantenimiento y cambio de credencial.

Verificación: 1.428 combinaciones TS; ensayo de 083 con 412 controles SQL;
las 26 regresiones SQL anteriores también pasan con 083 dentro de la transacción.
El runner compara antes/después todas las licencias, habilitaciones, funciones
y triggers afectados para confirmar rollback. `npm run test:habilitation-scope:database`
es siempre un ensayo; jamás confirma una migración en producción.

Alcance aplicado: habilitaciones del técnico. Las aeronaves pedidas por ofertas
se conservan; cambiar su semántica o añadir endosos de grupo/sistemas es otra
decisión de producto. No se certifica individualmente el reconocimiento del
catálogo EASA por las otras autoridades.

## 7 — H13: búsqueda sin continuación silenciosa

Eliminado el `.catch(() => null)` de matching y el retorno de la lista original
cuando aún no había puntuaciones. Una búsqueda con oferta solo publica un
resultado calculado para esa revisión de oferta y ese lote de técnicos.
Mientras carga, muestra estado de comprobación; si falla, mensaje visible con
reintento. El contador refleja los resultados filtrados.

También se controla el fallo de catálogo inicial del hook de búsqueda (antes
dejaba loading activo). Vacía resultados, publica error y descarta respuestas
de búsquedas antiguas o canceladas al limpiar filtros.

Pruebas: fallo de cada catálogo contra el servicio real con I/O inyectada,
reintento con exclusiones de motor/sin licencia, perfiles ausentes, resultado
incompleto y cambio de oferta/lote. El hook real se ejecuta con adaptador de
estado en memoria para error, reintento y carreras. Matching 236 PASS; hook PASS;
TypeScript limpio. No se ha hecho una prueba manual completa de las pantallas.

## 8 — comprobación general

No existía `npm test` ni otro script agregador en el repositorio. Se añade
`npm test` con las ocho suites anteriores, las tres nuevas y ambos validadores,
incluido `validate:application-eligibility`. Ejecución secuencial y parada ante
fallo; las pruebas de base requieren credenciales de pruebas y usan rollback.
TypeScript se comprueba por separado con `npm run ts`.

## 9 — H16/H14: documentación y textos

CLAUDE.md refleja la edad retirada por 040, la evidencia de experiencia de
aeronave desde Tanda E, la elección efectiva de credencial de H2, la cobertura
B1→A y FAA A+P de H8, caducidad CASA/FAA, atomicidad 082 y seguridad 081.
Distingue los dos filtros del núcleo de otros filtros de repositorios/RLS/UI,
y el componente motor del ranking total. Describe 064–080 como aplicación
única y explica sus postcondiciones incompatibles con una reejecución.

El selector dice «Considerar otras autoridades» y calcula la lista de otras
autoridades que emiten la categoría: excluye la elegida e incluye EASA cuando
corresponde. La preferencia no promete reconocimiento legal automático.
El texto de oferta de motor explica su componente de puntos y los demás
criterios; se retira la promesa de prioridad absoluta del motor declarado.

## Verificación final

- `npm test`: PASS; once suites y ambos validadores, en secuencia.
- Matching: 236 PASS; formulario: 20 PASS; transacciones: 3 PASS; base: 26 PASS;
  ubicación: 45 PASS; salario, URL y mapa: PASS.
- H3: 1.428 combinaciones TS PASS; 412 controles SQL PASS; 26 regresiones
  anteriores con la 083 instalada temporalmente PASS; rollback exacto comprobado.
- H13: fallo de ambos catálogos, resultado incompleto/ausente, reintento,
  cambio de oferta/lote y carreras del hook real: PASS.
- `npm run ts`: limpio; `git diff --check`: limpio.
- `validate:authority-licenses`: 51 filas, 0 errores, PASS.
- `validate:application-eligibility`: 386 casos, 0 divergencias, PASS.

## Reproducción, discusión y límites

H7 se reprodujo con la regresión antes del cambio. H3 se reprodujo por RPC e
INSERT directo; **no** por UPDATE de técnico, ya bloqueado por RLS. El inventario
de producción no encontró incompatibilidades existentes (0 de 8). H13 y H16/H14
se confirmaron en los caminos de código y textos señalados. No se reejecutaron
064–080 para probar sus postcondiciones históricas.

No hay discrepancia que bloquee estas correcciones mínimas. Sí se mantiene
explícita la distinción **inactivo ≠ genérico**: el scorer actual usa la actividad
para negar crédito exacto; separar ambos conceptos requiere trabajo de catálogo
y queda pendiente. H3 aplica al código L agregado actual; no incorpora ni decide
el comportamiento de futuras subcategorías. La preferencia entre autoridades
no certifica reconocimiento legal, ni una B1 acredita por sí sola autorización
de taller de componentes.

No se tocaron H6/H9/H10 (catálogos), H12 (paginación), licencia de ofertas de
motor, FAA con aeronaves, reevaluación histórica de candidaturas ni ofertas
directas. Tampoco se modificó la puntuación para forzar prioridad total del
motor declarado. No se ha validado manualmente toda la UI web/Android/iOS.

## Entrega y producción

Cinco commits locales, uno por punto; sin push ni merge. Puntos 5–8:
`1036ed1`, `b5ce377`, `0a4f8d0`, `2366802`; este cierre forma parte del commit
del punto 9.

**083 pendiente de confirmación del usuario antes de producción.** La única
migración nueva es [083_individual_type_rating_scope.sql](../supabase/migrations/083_individual_type_rating_scope.sql).
Sus funciones y triggers se probaron dentro de transacciones revertidas; no se
registró ni se dejó instalada. H3 en servidor solo será efectivo en producción
tras esa aplicación. No hay despliegue del cliente.

## Anexo — 083 aplicada y avisos del perfil (17 septiembre 2026)

Este anexo sustituye el estado «pendiente» de la entrega inicial anterior.
Tras la confirmación explícita del usuario, se aplicó **exactamente la 083
revisada**, sin editarla, al proyecto `rwauwuremzkizeoginza` mediante el
[endpoint oficial de migraciones](https://supabase.com/docs/reference/api/v1-apply-a-migration).
Registro: `20260917150705`, `083_individual_type_rating_scope`, una sentencia
registrada. SHA256 del archivo enviado:
`35bfabc2086e88878b2aebbada9593d9c74b3bec2795cf870eca7a59b3893a13`.

Se verificaron los dos triggers activos y la igualdad de las filas de licencias
y habilitaciones antes/después. `node scripts/testHabilitationScopeDatabase.cjs --installed`
ejecutó 412 controles y las 26 regresiones anteriores contra las funciones
instaladas, **sin reemplazarlas**; todos PASS y con rollback exacto.

### Qué veía el técnico y qué cambia

- Un rechazo de la 083 llegaba al perfil como `Individual type rating is outside
  the licence scope.` o `Existing type rating is outside the new licence scope.`,
  sin identificar aeronave. El mapper conservaba solo el mensaje de Postgres.
- El caso B1.1 + A320 → seleccionar B1.2 no reasigna una credencial por ID:
  los chips quitan/añaden licencias. El A320 seguía bajo B1.1, cuya retirada se
  bloqueaba al final del guardado con un aviso que solo nombraba la licencia.
- Ahora el perfil muestra un aviso inmediato con **Airbus A320 — CFM56 y EASA
  B1.1** si se desmarca esa licencia. Explica que elegir otra no transfiere la
  habilitación. Guardar se detiene antes de cualquier escritura mientras exista
  esa dependencia. Añadir B1.2 conservando B1.1 y A320 sí se permite.
- Una combinación incompatible que eluda el selector también se comprueba antes
  de guardar: el mensaje nombra la aeronave, la credencial y la limitación
  (por ejemplo, B1.2 cubre pistón). No se borra ni reasigna la habilitación.
- Si los datos locales estaban desactualizados y la base rechaza por 083, el
  cliente consulta el predicado SQL existente para cada habilitación. Solo
  señala las que fallan; las demás no aparecen como culpables. Esto cubre tanto
  la RPC de habilitaciones como el rechazo de credencial durante el guardado.
  No requiere otra migración ni reintenta la escritura automáticamente.
- Si también falla el diagnóstico, se informa de que no se pudo identificar
  cuál y se nombran las habilitaciones a revisar. Sin catálogo de etiquetas se
  usan posiciones legibles, nunca UUIDs ni mensajes SQL. Otros errores de base
  conservan su tratamiento y no se disfrazan como un fallo de alcance.

El perfil y su editor comparten ahora el mismo estado de catálogo de motores,
incluido el reintento, para no validar con dos cargas desincronizadas.

### Pruebas y límites del anexo

`test:profile-habilitations`, incorporado a `npm test`, prueba las reglas, el
repositorio real con transporte inyectado y el **handler real de Save Changes**
extraído mediante AST. Verifica que la retirada dependiente y una combinación
incompatible hacen cero escrituras, que el rechazo del trigger de credencial
termina en el mensaje legible del perfil, y que un fallo de diagnóstico no
oculta ni reintenta el rechazo. También cubre autoridad distinta, catálogo
ausente y conservación de una segunda habilitación compatible.

El formulario completo sigue sin ser una transacción única: si la base rechaza
después del preaviso por datos desactualizados, cambios previos de otros bloques
podrían haberse guardado. Este anexo no cambia ese límite ni afirma un rollback
global del perfil. No se ha realizado una comprobación manual en dispositivo.
No se ha desplegado el cliente, hecho push ni merge. Cambios en un commit aparte.
