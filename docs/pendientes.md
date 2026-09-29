# Pendientes vistos de pasada

Una línea por hallazgo fuera del alcance de la tarea en curso. No investigados ni arreglados.

- `app/technician/profile.tsx` carga licencias, habilitaciones, tipos, experiencia en aeronaves y motores con `supabase.from(...)` directamente desde la pantalla, en vez de por un repositorio (regla de arquitectura de CLAUDE.md). Visto en la parte 2 de la firma FAA (2026-09-29).
- Un técnico FAA A&P en una oferta Part-66 que NO acepta la FAA ve "Required license: B1.1" en vez de "…holds FAA A&P, which this offer doesn't accept": `firstRejectedByAuthority` (offerMatchExplain.ts) filtra por `licenseCodeSatisfies`, que no conoce la tabla FAA. Visto en la parte 3 (2026-09-29).
- El detalle de oferta que ve el técnico (`offerLicenseDetailText`, src/utils/offerRequirementsText.ts) dice "also accepts FAA" sin decir qué certificado FAA cuenta (A&P, o A o A&P para A1–A4). Visto en la parte 3 (2026-09-29).
