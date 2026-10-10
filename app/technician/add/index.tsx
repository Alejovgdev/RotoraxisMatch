import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { useConfirmDialog } from '../../../src/components/ui';
import { ProfileLoadGate } from '../../../src/components/technician/ProfileParts';
import { WhatYouDo, WorkSectionHeader } from '../../../src/components/technician/WorkParts';
import { AddMenuRow, WizardFrame } from '../../../src/components/technician/WizardParts';
import { useOwnTechnicianProfile } from '../../../src/state/useOwnTechnicianProfile';
import { useProfileTypesEditor } from '../../../src/state/useProfileTypesEditor';
import { useTechnicianTypes } from '../../../src/auth/useCatalogOptions';
import { technicianTypeLabel } from '../../../src/constants/technicianTypes';
import { heldLicenseCodes } from '../../../src/utils/profileLicenses';
import { whatYouDoFacts } from '../../../src/utils/technicianWork';
import { addMenuOptions } from '../../../src/utils/technicianAdd';
import type { EditableTechnicianProfile } from '../../../src/types/technicianProfileEdit';

// El "+" del técnico (rediseño, fase 6B; maqueta T-Add; T2). Lo abre "+ Add" de
// las dos barras y de My work.
//
//   - Arriba, "What you do": los tipos de perfil, que se guardan al tocarlos
//     con las mismas reglas que en My work (candado si los pone una licencia,
//     aviso al quitar Engine Technician con motores).
//   - Debajo, lo que se puede añadir. Lo que necesita algo antes sale en gris
//     con lo que falta: Type rating sin licencia, Engine experience sin Engine
//     Technician (addMenuOptions).
export default function AddToProfileScreen() {
  const goBack = useGoBack();
  // Al volver de un asistente se vuelve a leer: una licencia nueva habilita
  // Type rating, por ejemplo.
  const state = useOwnTechnicianProfile({ refreshOnFocus: true });
  return (
    <ProfileLoadGate state={state} title="Add to your profile" onBack={goBack}>
      {(profile) => <AddMenu profile={profile} reload={state.reload} onClose={goBack} />}
    </ProfileLoadGate>
  );
}

function AddMenu({
  profile,
  reload,
  onClose,
}: {
  profile: EditableTechnicianProfile;
  reload: () => Promise<unknown>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { options: typeOptions, loading: typesLoading } = useTechnicianTypes();
  const { confirm, dialog } = useConfirmDialog();
  const [types, setTypes] = useState(profile.technicianTypes);
  useEffect(() => {
    setTypes(profile.technicianTypes);
  }, [profile.technicianTypes]);

  const facts = whatYouDoFacts(profile.licenses);
  const labelOf = useCallback(
    (code: string) => typeOptions.find((o) => o.code === code)?.label ?? technicianTypeLabel(code),
    [typeOptions],
  );
  const onSaved = useCallback((next: string[]) => {
    setTypes(next);
    void reload();
  }, [reload]);
  const typesEditor = useProfileTypesEditor({
    technicianId: profile.id,
    types,
    lockedTypes: facts.locked,
    licenseCodes: heldLicenseCodes(profile.licenses),
    engineCount: profile.engines.length,
    labelOf,
    confirm,
    onSaved,
  });

  const options = addMenuOptions({ licenses: profile.licenses, technicianTypes: types });

  return (
    <WizardFrame title="Add to your profile" onBack={onClose} backIcon="close" largeTitle>
      <WhatYouDo
        subtitle="Tap all that apply. Changes are saved straight away."
        options={typeOptions}
        loading={typesLoading}
        types={types}
        locked={facts.locked}
        lockLines={facts.lockLines}
        faaNote={facts.faaNote}
        savingCode={typesEditor.savingCode}
        error={typesEditor.error}
        onToggle={(code) => void typesEditor.toggle(code)}
      />

      <View style={styles.section}>
        <WorkSectionHeader title="Add" />
        {options.map((option) => (
          <AddMenuRow
            key={option.key}
            optionKey={option.key}
            tile={option.tile}
            title={option.title}
            hint={option.hint}
            disabledReason={option.disabledReason}
            onPress={() => router.push(option.href as never)}
          />
        ))}
      </View>
      {dialog}
    </WizardFrame>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
});
