import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { colors, spacing } from '../../../src/theme';
import { CompanyScreen, EmptyPanel } from '../../../src/components/company/CompanyUI';
import { OfferWizard } from '../../../src/components/company/OfferWizard';
import { useConfirmDialog } from '../../../src/components/ui';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { technicianTypeLabel } from '../../../src/constants/technicianTypes';
import { getOfferProductTypeLabel } from '../../../src/constants/offerProductTypes';
import { authorityLabel } from '../../../src/constants/licenses';
import { describeDropped, droppedByTransition } from '../../../src/utils/offerFormRules';
import { offerKindForTechnicianType } from '../../../src/utils/offerShape';
import { OfferStatus } from '../../../src/types/enums';
import { Offer, OfferWithRequirements } from '../../../src/types/offer';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { notify } from '../../../src/utils/platformAlert';
import { salaryFromForm } from '../../../src/utils/offerSalary';
import { OfferRequirementChange, OfferWizardForm, offerWizardFormFromOffer } from '../../../src/utils/offerWizard';

// Editar una oferta (rediseño, fase 4): el mismo asistente que al crearla, con
// la oferta cargada. Lo que se puede editar no cambia (todo, en cualquier
// estado en que la pantalla de la oferta deje entrar aquí), ni cómo se guarda:
// offerRepository.update, igual que antes, y de vuelta a donde se vino.
//
// Paso 5b: los campos de requisitos son OfferRequirementsForm y sus
// transiciones viven en offerFormRules, las mismas que usa la pantalla de
// creación. Esta pantalla sólo añade la pregunta previa.
export default function EditOfferScreen() {
  const goBack = useGoBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { confirm, dialog } = useConfirmDialog();

  const [offer, setOffer] = useState<OfferWithRequirements | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialForm, setInitialForm] = useState<OfferWizardForm | null>(null);

  useEffect(() => {
    if (!id) return;
    offerRepository.getWithRequirements(id).then((o) => {
      setOffer(o);
      if (o) setInitialForm(offerWizardFormFromOffer(o));
      setLoading(false);
    });
  }, [id]);

  /**
   * Editando una oferta que YA existe, toda transición que descarte algo
   * guardado —licencia, aeronaves, motor— pregunta antes. Lo que se descarta
   * lo calcula `droppedByTransition` comparando antes y después, así que no
   * hay que acordarse de qué limpia cada cambio: lo dice offerFormRules.
   *
   * Si la empresa cancela, el formulario NO se mueve (el asistente no lo
   * toca hasta que esto devuelve true). Y sólo se pregunta cuando hay algo
   * que perder.
   */
  async function confirmChange(prev: OfferWizardForm, next: OfferWizardForm, change: OfferRequirementChange): Promise<boolean> {
    const dropped = describeDropped(droppedByTransition(prev, next));
    const dropsEngine = Boolean(prev.requiredEngineId && !next.requiredEngineId);
    const dropsEngineNotes = Boolean(prev.requiredEngineNotes?.trim() && !next.requiredEngineNotes?.trim());
    const lost = [dropped, dropsEngine ? 'the engine requirement' : null, dropsEngineNotes ? 'the engine note' : null].filter(Boolean).join(' and ');
    if (!lost) return true;
    const text = changeDialog(prev, change);
    return confirm({
      title: text.title,
      message: `${text.why} This clears ${lost}.${text.keeps ? `\n\n${text.keeps}` : ''}`,
      confirmLabel: 'Continue and clear',
      destructive: true,
    });
  }

  // El guardado de siempre. El asistente ya ha validado toda la oferta.
  async function handleSave(form: OfferWizardForm, overrideStatus: OfferStatus | undefined): Promise<Offer | null> {
    if (!id || !offer) return null;
    const status = overrideStatus ?? offer.status;
    try {
      await offerRepository.update(id, {
        title: form.title.trim(),
        description: form.description.trim(),
        contractType: form.contractType,
        salary: salaryFromForm(form.salary),
        // Va en el update(), no en replaceRequirements(): el repositorio tiene
        // que retirar las filas de requisitos ANTES de mover esta columna
        // (orh_matches_offer lo impone), y hace justo eso cuando ve que
        // cambia.
        productType: form.productType,
        technicianType: form.technicianType,
        licenseAuthority: form.licenseAuthority,
        licenseCode: form.licenseCode,
        acceptedAuthorities: form.acceptedAuthorities,
        acceptedLicenseCode: form.acceptedLicenseCode,
        requiresAllAircraft: form.requiresAllAircraft,
        // Paso 5b: el motor. La RPC retira las aeronaves en la misma
        // transacción al pasar a motor (los triggers de la 076 lo exigen),
        // igual que con el producto. Sesión 4 (091): la clase no se manda; el
        // repositorio la deriva de technicianType, arriba.
        requiredEngineId: form.requiredEngineId,
        requiredEngineNotes: form.requiredEngineNotes?.trim() || null,
        onlyUnlicensed: form.onlyUnlicensed,
        // Igual que productType: va en el update() y no en
        // replaceRequirements(), y el repositorio limpia los requisitos
        // Part-66 si ve que se apaga — la invariante lo exige aunque aquí no
        // haya ninguna FK que fuerce el orden.
        requiresCertification: form.requiresCertification,
        locationCountryCode: form.location.country?.code,
        locationCountry: form.location.country?.name,
        locationCityName: form.location.city?.name,
        locationCityLat: form.location.city?.kind === 'directory' ? form.location.city.latitude : undefined,
        locationCityLng: form.location.city?.kind === 'directory' ? form.location.city.longitude : undefined,
        locationCityGeonameId: form.location.city?.kind === 'directory' ? form.location.city.geonameId : undefined,
        minYearsExperience: form.minYearsExperience,
        status,
        visible: status === 'published',
      }, form.requiredHabilitations);
      goBack();
    } catch (e: any) {
      notify('Error', e?.message ?? 'Could not save offer.');
    }
    return null;
  }

  if (loading || (offer && !initialForm)) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.blue} role="company" />
      </>
    );
  }

  if (!offer || !initialForm) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.notFound}>
          <EmptyPanel title="Offer not found" subtitle="This offer is no longer available." />
        </View>
      </CompanyScreen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <OfferWizard
        mode="edit"
        initialForm={initialForm}
        savedStatus={offer.status}
        confirmChange={confirmChange}
        onSubmit={handleSave}
        onExit={goBack}
      />
      {dialog}
    </>
  );
}

/**
 * El título y el porqué del diálogo de cada cambio: los textos de antes. `why`
 * explica por qué ese cambio no puede conservarlo, y `keeps` lo que se queda
 * cuando conviene decirlo (apagar la certificación conserva las aeronaves).
 */
function changeDialog(form: OfferWizardForm, change: OfferRequirementChange): { title: string; why: string; keeps?: string } {
  switch (change.kind) {
    case 'engine':
      return { title: 'Change the engine?', why: 'The current note belongs to the previous engine.' };
    case 'certification':
      // Encenderla nunca pregunta: no destruye nada (desmarca "sólo sin
      // licencia", que no es un requisito que se pierda sino una
      // contradicción que se evita).
      return {
        title: `Drop the ${form.licenseCode ?? ''} licence requirement?`,
        why: 'An offer that does not need certified work cannot require a licence.',
        // Fase 6 tanda E: las aeronaves se quedan.
        keeps: 'The aircraft stay: the role is still for that work, and it opens up to technicians who have done it without holding the licence.',
      };
    case 'technicianType': {
      // Sesión 4 (091): cambiar el tipo puede cambiar la clase, y lo que se
      // pierde entonces no es por la licencia sino por la clase. El diálogo
      // lo dice.
      const next = change.value;
      const nextKind = offerKindForTechnicianType(next);
      const why =
        nextKind === form.offerKind
          ? 'The current licence is not one that trade can require.'
          : nextKind === 'engine'
            ? 'An Engine Technician offer is an engine offer: it names one engine and no aircraft. A licence is optional there, and only a Part-66 B1 or an FAA P or A&P.'
            : `An offer for ${technicianTypeLabel(next).toLowerCase()} work is an aircraft offer and does not name an engine.`;
      return { title: `Switch this offer to ${technicianTypeLabel(next).toLowerCase()}?`, why };
    }
    case 'authority': {
      const next = change.value;
      return {
        title: `Switch the authority to ${authorityLabel(next)}?`,
        why: next === 'FAA'
          ? 'The licence has to be one the FAA issues, and the aircraft were added under the previous licence. On an FAA offer, an aircraft counts through a type rating or declared experience, signed off or not.'
          : `The licence has to be one ${authorityLabel(next)} issues.`,
      };
    }
    case 'license':
      return {
        title: `Switch the licence to ${change.value}?`,
        why: `The aircraft on this offer were added under ${form.licenseCode ?? 'the previous licence'}; you will need to add them again under the new one.`,
      };
    case 'productType': {
      const label = getOfferProductTypeLabel(change.value).toLowerCase();
      return {
        title: `Switch this offer to ${label}?`,
        why: `Type ratings and some licences cannot apply to ${label}.`,
      };
    }
  }
}

const styles = StyleSheet.create({
  notFound: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
});
