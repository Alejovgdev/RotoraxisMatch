import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { Text, TextInput } from '../../../src/components/ui';
import { ProfileLoadGate } from '../../../src/components/technician/ProfileParts';
import { InlineLink, LockedRow, workStyles } from '../../../src/components/technician/WorkParts';
import { CatalogRequestPanel } from '../../../src/components/technician/CatalogRequestPanel';
import {
  CatalogRowItem,
  CatalogState,
  DoneItem,
  TextTile,
  SearchPill,
  WizardDone,
  WizardFrame,
  WizardHeading,
} from '../../../src/components/technician/WizardParts';
import { useOwnTechnicianProfile } from '../../../src/state/useOwnTechnicianProfile';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { saveTechnicianProfile } from '../../../src/usecases/technicianProfile';
import { engineTypeLabel, getEngineLabel } from '../../../src/constants/engines';
import { showsEngineExperience } from '../../../src/utils/profileEngines';
import { engineRows, parseOptionalYears } from '../../../src/utils/technicianAdd';
import {
  TECHNICIAN_ADD_ROUTES,
  TECHNICIAN_PROFILE_ROUTES,
  TECHNICIAN_TAB_ROUTES,
} from '../../../src/utils/technicianNavigation';
import { colors } from '../../../src/theme';
import type { EngineCatalog } from '../../../src/types/catalog';
import type { EditableTechnicianProfile, EngineExperienceRow } from '../../../src/types/technicianProfileEdit';

// Añadir un motor (rediseño, fase 6B; maqueta T-Eng): una pantalla con el
// buscador y los años opcionales, y la final.
//
// Sólo para Engine Technician (091): sin el tipo, el "+" ya lo enseña en gris;
// aquí, por un enlace directo, se explica y no se ofrece nada. Los ya
// declarados salen "✓ Added". Años: vacío o de 0 a 70, como hoy.
//
// Guarda sólo los motores (los de antes, tal cual, más el nuevo).
export default function AddEngineScreen() {
  const goBack = useGoBack();
  const state = useOwnTechnicianProfile();
  return (
    <ProfileLoadGate state={state} title="Add engine experience" onBack={goBack}>
      {(profile) => <AddEngineWizard profile={profile} reload={state.reload} onExit={goBack} />}
    </ProfileLoadGate>
  );
}

function AddEngineWizard({
  profile,
  reload,
  onExit,
}: {
  profile: EditableTechnicianProfile;
  reload: () => Promise<EditableTechnicianProfile | null>;
  onExit: () => void;
}) {
  const router = useRouter();
  const { engines, engineIndex, state: enginesState, retry } = useEnginesCatalog();
  const [query, setQuery] = useState('');
  const [engine, setEngine] = useState<EngineCatalog | null>(null);
  const [years, setYears] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<EngineExperienceRow | null>(null);

  const parsedYears = parseOptionalYears(years);
  const openMyWork = () => router.dismissTo(TECHNICIAN_PROFILE_ROUTES.work as never);

  async function save() {
    if (saving || !engine || parsedYears.invalid) return;
    setSaving(true);
    setError(null);
    const fresh = await reload();
    if (!fresh) {
      setSaving(false);
      setError('Could not load your profile. Check your connection and try again.');
      return;
    }
    const row: EngineExperienceRow = { engineId: engine.id, years: parsedYears.years };
    const result = await saveTechnicianProfile(fresh.id, { newEngine: { row, profile: fresh } });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(row);
    void reload();
  }

  if (done) {
    return (
      <WizardDone
        title="Added to your profile"
        text="Companies will see it when they look at your profile."
        primary={{ label: 'See offers for you', onPress: () => router.navigate(TECHNICIAN_TAB_ROUTES.offers as never) }}
        secondary={{ label: 'Add something else', onPress: () => router.dismissTo(TECHNICIAN_ADD_ROUTES.menu as never) }}
      >
        <DoneItem
          tile={<TextTile text="ENG" />}
          title={getEngineLabel(done.engineId, engineIndex)}
          subtitle={`Engine experience · ${done.years != null ? `${done.years} years` : 'Years not specified'}`}
          onPress={openMyWork}
        />
      </WizardDone>
    );
  }

  if (!showsEngineExperience(profile.technicianTypes)) {
    return (
      <WizardFrame title="Add engine experience" onBack={onExit}>
        <WizardHeading title="Which engine?" text="Engines you have worked on." />
        <LockedRow tile="ENG" title="Only for Engine Technicians" subtitle="Tick Engine Technician in Add or My work to add engines" />
      </WizardFrame>
    );
  }

  // Pocos resultados (T-Eng enseña seis): los años van debajo y tienen que
  // quedar a la vista; la búsqueda acota.
  const rows = enginesState === 'success' ? engineRows(engines, query, profile.engines, 8) : [];

  return (
    <WizardFrame
      title="Add engine experience"
      onBack={onExit}
      primary={{ label: 'Add engine', onPress: () => void save(), disabled: !engine || parsedYears.invalid, loading: saving }}
      error={error}
    >
      <WizardHeading title="Which engine?" text="Engines you have worked on." />
      <SearchPill
        value={query}
        onChangeText={setQuery}
        placeholder="CFM56, LEAP, PW1100G, Trent…"
        accessibilityLabel="Search engine"
        editable={enginesState === 'success'}
      />
      <CatalogState state={enginesState} what="engines" onRetry={retry} />
      <View accessibilityRole="radiogroup" accessibilityLabel="Engine">
        {rows.map((row) => (
          <CatalogRowItem
            key={row.item.id}
            title={row.item.displayName}
            subtitle={`${row.item.manufacturer} · ${engineTypeLabel(row.item.engineType)}`}
            selected={engine?.id === row.item.id}
            added={row.added}
            onSelect={() => setEngine(row.item)}
            onOpenAdded={openMyWork}
          />
        ))}
      </View>
      {enginesState === 'success' && rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No engine found.</Text>
          <InlineLink label="Request it" onPress={() => setRequestOpen(true)} />
        </View>
      ) : null}
      {requestOpen ? <CatalogRequestPanel /> : null}

      <View style={styles.group}>
        <Text style={workStyles.fieldLabel}>Years on this engine (optional)</Text>
        <TextInput
          style={workStyles.input}
          value={years}
          onChangeText={(v) => setYears(v.replace(/[^0-9]/g, ''))}
          placeholder="e.g. 5"
          placeholderTextColor={colors.placeholder}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Years on this engine"
        />
        {parsedYears.invalid ? <Text style={workStyles.warning}>Enter a number of years between 0 and 70.</Text> : null}
      </View>
    </WizardFrame>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: 8,
  },
  empty: {
    gap: 4,
  },
  emptyText: {
    fontSize: 14.5,
    color: colors.textSecondary,
  },
});
