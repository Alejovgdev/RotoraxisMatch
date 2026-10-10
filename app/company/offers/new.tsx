import React, { useState } from 'react';
import { Stack } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { OfferWizard } from '../../../src/components/company/OfferWizard';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { useCompanySession } from '../../../src/state/SessionContext';
import { OfferStatus } from '../../../src/types/enums';
import { OfferWithRequirements } from '../../../src/types/offer';
import { notify } from '../../../src/utils/platformAlert';
import { salaryFromForm } from '../../../src/utils/offerSalary';
import { OfferWizardForm, newOfferWizardForm } from '../../../src/utils/offerWizard';

// Publicar una oferta (rediseño, fase 4): el asistente por pasos sustituye al
// formulario de una página, con los mismos campos y las mismas reglas (ver
// src/components/company/OfferWizard.tsx). Lo que se guarda y cómo no cambia:
// esta pantalla sigue llamando a offerRepository.create igual que antes.
//
// Paso 5b: los campos de requisitos (clase, motor, oficio, certificación,
// autoridad, licencia, equivalencias, "sólo sin licencia", aeronaves) son
// OfferRequirementsForm, y sus transiciones viven en offerFormRules — las
// mismas que usa la pantalla de edición. Creando se aplican SOBRE LA MARCHA y
// sin aviso: nada de lo que se descarta está guardado todavía.
export default function NewOfferScreen() {
  const goBack = useGoBack();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const [initialForm] = useState(newOfferWizardForm);

  // El asistente ya ha validado toda la oferta antes de llamar aquí.
  async function handleSave(form: OfferWizardForm, status: OfferStatus | undefined): Promise<OfferWithRequirements | null> {
    if (!companyId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return null;
    }
    try {
      return await offerRepository.create({
        companyId,
        title: form.title.trim(),
        description: form.description.trim(),
        contractType: form.contractType,
        salary: salaryFromForm(form.salary),
        productType: form.productType,
        location: form.location,
        minYearsExperience: form.minYearsExperience,
        status: status ?? 'draft',
        technicianType: form.technicianType,
        requiresCertification: form.requiresCertification,
        licenseAuthority: form.licenseAuthority,
        licenseCode: form.licenseCode,
        acceptedAuthorities: form.acceptedAuthorities,
        acceptedLicenseCode: form.acceptedLicenseCode,
        requiresAllAircraft: form.requiresAllAircraft,
        requiredHabilitations: form.requiredHabilitations,
        requiredEngineId: form.requiredEngineId,
        requiredEngineNotes: form.requiredEngineNotes?.trim() || null,
        onlyUnlicensed: form.onlyUnlicensed,
      });
    } catch (e: any) {
      notify('Error', e?.message ?? 'Could not save offer.');
      return null;
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <OfferWizard mode="new" initialForm={initialForm} onSubmit={handleSave} onExit={goBack} />
    </>
  );
}
