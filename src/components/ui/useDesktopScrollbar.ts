// Barra de desplazamiento (fase 8, decisión F): visible en escritorio, donde
// con el ratón hace falta ver que la página sigue; oculta en teléfono y tablet,
// como siempre. Para `showsVerticalScrollIndicator` de las pantallas que no
// tienen ya un `wide` a mano.
import { useWindowDimensions } from 'react-native';
import { WIDE_BREAKPOINT } from '../../theme/ui';

export function useDesktopScrollbar(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}
