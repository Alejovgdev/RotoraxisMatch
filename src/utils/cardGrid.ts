// Rejillas de tarjetas de escritorio con el mismo ancho para todas (fase 8).
//
// Con `flexGrow` y un `maxWidth`, la última fila, si quedaba incompleta,
// estiraba sus tarjetas y no medían como las de arriba. Search y Offers ya lo
// evitaban calculando el ancho de cada tarjeta; esto es ese cálculo, para las
// rejillas que miden su propio contenedor (Home de empresa, Your offers).

/**
 * El ancho de cada tarjeta en una rejilla de `width`: tantas columnas como
 * quepan de al menos `minWidth`, separadas por `gap`. Sin ancho (aún sin
 * medir), null.
 */
export function cardGridItemWidth(width: number, minWidth: number, gap: number): number | null {
  if (!(width > 0)) return null;
  const columns = Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
  return Math.floor((width - (columns - 1) * gap) / columns);
}
