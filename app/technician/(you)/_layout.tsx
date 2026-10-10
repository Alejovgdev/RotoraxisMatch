import { Slot, Stack } from 'expo-router';
import { useIsWide } from '../../../src/components/company/CompanyPage';
import { YouDesktopShell } from '../../../src/components/technician/ProfileParts';
import { techUi } from '../../../src/components/technician/TechnicianUI';

// Los apartados de You (rediseño, fase 8): My work, Personal details,
// Location, Contract types, Professional links y Documents. El grupo (you) no
// cambia ninguna URL: /technician/profile/work, /technician/documents… son las
// de siempre, así que F5, atrás y los enlaces siguen igual.
//
//   - Escritorio: una sola página. El menú lateral, la tarjeta del técnico y la
//     disponibilidad (YouDesktopShell) se quedan montados y sólo cambia el
//     apartado de debajo (<Slot />), con una entrada corta. You
//     (/technician/profile) lleva aquí, a My work.
//   - Móvil: como antes, cada apartado se apila encima de You con su flecha.
export default function YouSectionsLayout() {
  const wide = useIsWide();
  if (wide) {
    return (
      <YouDesktopShell>
        <Slot />
      </YouDesktopShell>
    );
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: techUi.page } }} />;
}
