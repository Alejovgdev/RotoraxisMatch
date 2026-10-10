// Qué pasa al tocar un tipo de perfil (Fase 6 tanda A; rediseño, fase 6A).
//
// La regla vivía dentro de TechnicianTypeSelector (alta y perfil de antes). Se
// sacó aquí, igual y sin cambios, porque ahora la usan dos componentes: ese
// selector, que sigue en el alta, y los chips de "What you do" de My work. Si
// cada uno tuviera la suya, el mínimo de uno o el bloqueo por licencia podrían
// separarse.
//
//   - Marcar un tipo: siempre se puede.
//   - Desmarcar uno que bloquea una licencia declarada: no; se explica dónde
//     se quita (quitando la licencia).
//   - Desmarcar el último: no; el perfil necesita al menos uno.
//
// Puro: el que llama pone el aviso (notify) o guarda el cambio.

export type ProfileTypeToggle =
  | { kind: 'change'; next: string[] }
  | { kind: 'notice'; title: string; message: string };

export function toggleProfileType(
  selected: readonly string[],
  code: string,
  lockedCodes: readonly string[],
  labelOf: (code: string) => string,
): ProfileTypeToggle {
  if (!selected.includes(code)) return { kind: 'change', next: [...selected, code] };
  // Implicado por una licencia declarada. Se avisa por el mismo motivo que el
  // mínimo de uno, justo abajo: un toque sin respuesta parece la app rota y no
  // una regla — y aquí además hay que decir DÓNDE se quita.
  if (lockedCodes.includes(code)) {
    return {
      kind: 'notice',
      title: `${labelOf(code)} comes from your licences`,
      message:
        // Fase 6B: también se toca desde el "+", donde no hay sección de
        // licencias; se quitan en My work.
        'You hold a licence of this trade, so the type stays while you declare it. Remove that licence in My work and this comes off with it.',
    };
  }
  // Mínimo uno.
  if (selected.length === 1) {
    return {
      kind: 'notice',
      title: 'Keep at least one profile type',
      message: 'Your profile needs at least one type. Select another one first, then remove this.',
    };
  }
  return { kind: 'change', next: selected.filter((c) => c !== code) };
}
