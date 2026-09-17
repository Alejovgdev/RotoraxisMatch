# Paso 5d — cierre de puntos 1–4

Fecha: 17 septiembre 2026. Rama: `fase-10-motores-autoridades`.
Se usa el corte autorizado por el usuario: puntos 1–4 completos; puntos 5–9
pendientes para otra sesión. Cuatro commits, uno por punto, sin merge ni push.

## Cambios y reproducción previa

| Punto | Reproducción antes de corregir | Resultado |
|---|---|---|
| 1 — H4/H5/H15 | En producción con rollback: tres cambios de participantes aceptados, lecturas privadas desde el trigger antes de autorizar y tres cualificaciones visibles con perfil oculto sin relación | Participantes inmutables para clientes; autorización previa a hechos privados; cambio de oferta vuelve a comprobar elegibilidad; RLS por visibilidad o relación |
| 2 — H1 | Tres tests de los repositorios reales con transporte inyectado: credencial ausente, motor con 71 años y fallo al cambiar producto vacían los datos anteriores | RPC transaccionales para habilitaciones, motores y edición conjunta de oferta/aeronaves; UI limita años a 0–70 |
| 3 — H2 | Tests fallan con 100→87 y 100→39; falla la propiedad de añadir credencial | Selección por resultado efectivo de la oferta completa, incluida vigencia; autoridad exacta antes de fecha, una credencial por par |
| 4 — H8 | B1.x→A.x devuelve falso; FAA A+P obtiene 35 frente a 100 | B1.x cubre A.x de la misma autoridad; A/P FAA en filas separadas se proyectan como A&P solo para matching |

Todos los hallazgos abordados se reprodujeron. No se descartó ninguno por no
reproducible. La regla SQL de elegibilidad no requiere cambio por H8: sigue
contando licencias declaradas y evidencia de motor B1; no compara la licencia
exigida por una oferta. El validador confirma que TS y SQL siguen coincidiendo.

## Producción

- 081: `20260917071326`, `081_application_participants_and_qualification_privacy`.
- 082: `20260917071907`, `082_transactional_qualification_and_offer_writes`.
- Ambas se probaron primero dentro de una transacción con rollback y después
  de instalarlas. Se aplicaron con el endpoint oficial de migraciones de la
  Management API, ya que no había herramienta MCP Supabase en la sesión. Ese
  endpoint registró las dos entradas anteriores en `schema_migrations`.
- El código cliente usa las RPC después de que existan en la base. No se
  desplegó una nueva versión del cliente.
- La inspección final confirmó cero ofertas de prueba, cero triggers de fallo
  inyectado y restauración de la función privada de elegibilidad.

## Verificación

- `npm run ts`: limpio.
- `test:matching`: 234/234; incluye 6.912 casos de propiedad y comprobación del
  orden de credenciales, además de conservar los tests de no mezclar aeronaves
  bajo autoridades diferentes.
- `test:offer-form`: 20/20; `test:transactions`: 3/3.
- `test:database`: 26/26, sobre la base real con rol `authenticated`, más el
  caso de cambio de oferta por mantenimiento. Todo se deshace.
- `test:offer-salary`, `test:url-validation`, `test:offer-map-markers`,
  `test:location`: PASS.
- `validate:authority-licenses`: PASS, 51 filas, cero errores.
- `validate:application-eligibility`: PASS, 386 casos, cero divergencias.

`test:database` ejecuta únicamente los dos archivos SQL de regresión. Necesita
la URL del proyecto y un token Management API de pruebas (`SUPABASE_TEST_ACCESS_TOKEN`
o el del `.env`). No aplica migraciones. Si faltan fixtures o resultados, falla;
no omite pruebas silenciosamente. No se debe ejecutar en paralelo consigo mismo:
las suites inyectan triggers y una función privada dentro de su transacción.

## Pendiente y límites

5. H7: comprobar nuevamente fuente CASA, política de caducidad y UI.
6. H3: inventario completo de incompatibilidades antes de reglas por autoridad.
   La consulta preliminar dio **cero** habilitaciones en A1–A4/B2L/B3/L; no se
   completó el recuento de incompatibilidades de propulsión ni se aplicó H3.
7. H13: error visible al fallar los catálogos de la búsqueda.
8. Incorporar `validate:application-eligibility` al script general de tests.
9. H16/H14: corregir CLAUDE.md y textos, documentar 064–080 como aplicación única.

No se tocaron los catálogos, licencia de ofertas de motor, FAA con aeronaves ni
paginación. La atomicidad implementada abarca cada conjunto de cualificaciones
y la edición de oferta con sus aeronaves; no convierte todo el formulario de
perfil ni la creación inicial de oferta en una única transacción.

No se detectó pérdida de acceso en las consultas de cualificaciones para
perfiles visibles o relacionados; ambos casos están probados contra RLS. No se
realizó una comprobación manual completa de pantallas en web, Android e iOS.

No hay una discrepancia de producto que bloquee estos cuatro puntos. La unión
FAA A+P es una proyección de lectura de los dos ratings del certificado, no
una autorización para combinar credenciales Part-66 de distintas autoridades.
El merge sigue pendiente de los puntos restantes.
