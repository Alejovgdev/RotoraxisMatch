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

## Estado

Puntos 7–9 en curso. Ninguna migración de esta segunda parte aplicada en producción.
