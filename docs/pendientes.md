# Pendientes vistos de pasada

Una línea por hallazgo fuera del alcance de la tarea en curso. No investigados ni arreglados.

- `app/technician/profile.tsx` carga licencias, habilitaciones, tipos, experiencia en aeronaves y motores con `supabase.from(...)` directamente desde la pantalla, en vez de por un repositorio (regla de arquitectura de CLAUDE.md). Visto en la parte 2 de la firma FAA (2026-09-29).
