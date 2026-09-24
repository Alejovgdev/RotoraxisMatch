// "Ciudad, país" en UN sitio (ajustes finales de Fase 10).
//
// La ciudad es opcional en las tres tablas —sólo el país es NOT NULL—, y cada
// pantalla la pegaba a mano con `${city}, ${country}`: sin ciudad salía
// ", Spain" en las ofertas y ", ES" en los técnicos (que llevan el código ISO).
// Las partes vacías o sólo con espacios se saltan; sin ninguna, cadena vacía,
// y el llamador decide si pinta un "Location not specified".
export function formatLocation(city: string | null | undefined, country: string | null | undefined): string {
  return [city, country]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(', ');
}
