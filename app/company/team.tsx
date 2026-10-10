import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { useCompanyNav } from '../../src/state/CompanyNavContext';
import { CompanyTeamManagement } from '../../src/components/company/CompanyTeamManagement';
import { CompanyScreen } from '../../src/components/company/CompanyUI';
import { PageBody, useIsWide } from '../../src/components/company/CompanyPage';
import { AccountLayout, CompanyAccountNav } from '../../src/components/company/CompanyAccount';

// Equipo (rediseño, fases 2 y 3; maquetas W-Team y W-D-Team; respuesta 8):
// pantalla propia con CompanyTeamManagement, cuya lógica no cambia. Llegan
// aquí el círculo Team de la Home, la fila Team access de You y la sección
// Team de escritorio, los tres sólo para admin.
//
// Quien no es admin vuelve a /company/profile, como antes.
export default function CompanyTeamScreen() {
  const goBack = useGoBack();
  const wide = useIsWide();
  const { company, isAdmin } = useCompanyNav();

  if (!isAdmin) return <Redirect href="/company/profile" />;

  const companyName = company?.name ?? 'your company';

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      {wide ? (
        <PageBody wide>
          <AccountLayout nav={<CompanyAccountNav active="team" isAdmin />}>
            <CompanyTeamManagement companyName={companyName} wide />
          </AccountLayout>
        </PageBody>
      ) : (
        <CompanyTeamManagement companyName={companyName} wide={false} onBack={goBack} />
      )}
    </CompanyScreen>
  );
}
