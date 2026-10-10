import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Plane } from 'lucide-react-native';
import { useGoBack } from '../../../src/state/useGoBack';
import { Text, TextInput } from '../../../src/components/ui';
import { useIsWide } from '../../../src/components/company/CompanyPage';
import { ProfileLoadGate } from '../../../src/components/technician/ProfileParts';
import { CheckboxRow, InlineLink, WorkNote, workStyles } from '../../../src/components/technician/WorkParts';
import { CatalogRequestPanel } from '../../../src/components/technician/CatalogRequestPanel';
import {
  CatalogRowItem,
  CatalogState,
  ChosenCard,
  DoneItem,
  IconTile,
  SearchPill,
  WizardDone,
  WizardFrame,
  WizardHeading,
} from '../../../src/components/technician/WizardParts';
import { useOwnTechnicianProfile } from '../../../src/state/useOwnTechnicianProfile';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { saveTechnicianProfile } from '../../../src/usecases/technicianProfile';
import { AircraftRatingIndex, getAircraftTypeRatingLabel } from '../../../src/constants/aircraftTypeRatings';
import { signOffLabel } from '../../../src/utils/profileLicenses';
import { aircraftExperienceRows } from '../../../src/utils/technicianAdd';
import {
  TECHNICIAN_ADD_ROUTES,
  TECHNICIAN_PROFILE_ROUTES,
  TECHNICIAN_TAB_ROUTES,
} from '../../../src/utils/technicianNavigation';
import { colors } from '../../../src/theme';
import type { AircraftTypeRatingCatalog } from '../../../src/types/catalog';
import type { AircraftExperienceRow, EditableTechnicianProfile } from '../../../src/types/technicianProfileEdit';

// Añadir experiencia en una aeronave (rediseño, fase 6B; sin maqueta propia:
// el asistente de type rating sin el paso de licencia).
//
//   1. La aeronave, del catálogo entero: se puede haber trabajado en aviones y
//      helicópteros. "✓ Added" si ya está en la experiencia o si hay un type
//      rating en ella (una habilitación ya demuestra la experiencia, Tanda E).
//   2. Años (opcionales) y, sólo con FAA A o A&P, la firma (094), con la nota
//      de hoy sobre dónde cuenta.
//   3. Hecho.
//
// Guarda sólo la experiencia en aeronaves (la de antes, tal cual, más la nueva).
export default function AddAircraftExperienceScreen() {
  const goBack = useGoBack();
  const state = useOwnTechnicianProfile();
  return (
    <ProfileLoadGate state={state} title="Add aircraft experience" onBack={goBack}>
      {(profile) => <AddAircraftWizard profile={profile} ratingsById={state.ratingsById} reload={state.reload} onExit={goBack} />}
    </ProfileLoadGate>
  );
}

function AddAircraftWizard({
  profile,
  ratingsById,
  reload,
  onExit,
}: {
  profile: EditableTechnicianProfile;
  ratingsById: AircraftRatingIndex;
  reload: () => Promise<EditableTechnicianProfile | null>;
  onExit: () => void;
}) {
  const router = useRouter();
  const wide = useIsWide();
  const { ratings, state: ratingsState, retry: retryRatings } = useAircraftTypeRatingsCatalog();
  const [query, setQuery] = useState('');
  const [rating, setRating] = useState<AircraftTypeRatingCatalog | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [years, setYears] = useState('');
  const [signed, setSigned] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AircraftExperienceRow | null>(null);

  const allRatings = useMemo(() => {
    const index = new Map(ratingsById);
    if (rating) index.set(rating.id, rating);
    return index;
  }, [ratingsById, rating]);
  // 094: la firma sólo con FAA A o A&P; sin ella ni la casilla ni la nota.
  const signOff = signOffLabel(profile.licenses);
  const openMyWork = () => router.dismissTo(TECHNICIAN_PROFILE_ROUTES.work as never);

  async function save() {
    if (saving || !rating) return;
    setSaving(true);
    setError(null);
    const fresh = await reload();
    if (!fresh) {
      setSaving(false);
      setError('Could not load your profile. Check your connection and try again.');
      return;
    }
    const trimmed = years.trim();
    const row: AircraftExperienceRow = {
      aircraftTypeRatingId: rating.id,
      // `undefined` y no 0: no declarado no es "sin años".
      years: trimmed ? Number(trimmed) : undefined,
      signed: signOffLabel(fresh.licenses) ? signed : false,
    };
    const result = await saveTechnicianProfile(fresh.id, {
      newAircraftExperience: { row, profile: fresh, ratingsById: allRatings },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(row);
    void reload();
  }

  // ── Hecho ─────────────────────────────────────────────────────────────────
  if (done) {
    const yearsText = done.years != null ? `${done.years} years` : 'Years not specified';
    return (
      <WizardDone
        title="Added to your profile"
        text="Companies will see it when they look at your profile."
        primary={{ label: 'See offers for you', onPress: () => router.navigate(TECHNICIAN_TAB_ROUTES.offers as never) }}
        secondary={{ label: 'Add something else', onPress: () => router.dismissTo(TECHNICIAN_ADD_ROUTES.menu as never) }}
      >
        <DoneItem
          tile={<IconTile><Plane color="#33465A" size={20} strokeWidth={2} /></IconTile>}
          title={getAircraftTypeRatingLabel(done.aircraftTypeRatingId, allRatings)}
          subtitle={done.signed && signOff ? `${signOff} · ${yearsText}` : `Aircraft experience · ${yearsText}`}
          onPress={openMyWork}
        />
      </WizardDone>
    );
  }

  // ── Paso 2: años y firma ──────────────────────────────────────────────────
  if (step === 2 && rating) {
    return (
      <WizardFrame
        title="Add aircraft experience"
        step={2}
        total={2}
        onBack={() => { setError(null); setStep(1); }}
        primary={{ label: 'Add aircraft', onPress: () => void save(), loading: saving }}
        error={error}
      >
        <WizardHeading title="A few details" text="Optional. You can add them later." />
        <ChosenCard
          tile={<IconTile><Plane color="#0B5E8C" size={20} strokeWidth={2} /></IconTile>}
          title={rating.displayName}
          subtitle="Aircraft experience · no licence needed"
        />
        <View style={styles.group}>
          <Text style={workStyles.fieldLabel}>Years on this aircraft (optional)</Text>
          <TextInput
            style={workStyles.input}
            value={years}
            onChangeText={(v) => setYears(v.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 15"
            placeholderTextColor={colors.placeholder}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel="Years on this aircraft"
          />
        </View>
        {signOff ? (
          <View style={styles.group}>
            {/* Dónde cuenta la firma, sin invitar a marcarla. */}
            <WorkNote>
              Sign-off only counts on EASA, UK CAA, CASA or UAE GCAA offers that also accept the FAA: there, an aircraft you
              have signed off on counts as a type rating. FAA offers count your type ratings and all your declared aircraft
              experience, signed off or not.
            </WorkNote>
            <CheckboxRow label={signOff} checked={signed} onPress={() => setSigned((v) => !v)} />
          </View>
        ) : null}
      </WizardFrame>
    );
  }

  // ── Paso 1: aeronave ──────────────────────────────────────────────────────
  // En escritorio la tarjeta crece con la lista: tantas filas como en motores;
  // la búsqueda acota.
  const rows = ratingsState === 'success' ? aircraftExperienceRows(ratings, query, profile, wide ? 8 : undefined) : [];

  return (
    <WizardFrame
      title="Add aircraft experience"
      step={1}
      total={2}
      onBack={onExit}
      primary={{ label: 'Continue', onPress: () => setStep(2), disabled: !rating }}
    >
      <WizardHeading
        title="Which aircraft?"
        text="Aircraft you have worked on. No licence needed — this says you know the work, not that you are authorised to sign it off."
      />
      <SearchPill
        value={query}
        onChangeText={setQuery}
        placeholder="A320neo, LEAP, CFM56, H145, Dash 8…"
        accessibilityLabel="Search aircraft or engine"
        editable={ratingsState === 'success'}
      />
      <CatalogState state={ratingsState} what="aircraft ratings" onRetry={retryRatings} />
      <View accessibilityRole="radiogroup" accessibilityLabel="Aircraft">
        {rows.map((row) => (
          <CatalogRowItem
            key={row.item.id}
            title={row.item.displayName}
            subtitle={row.item.easaEndorsement}
            selected={rating?.id === row.item.id}
            added={row.added}
            addedNote={row.addedNote}
            onSelect={() => setRating(row.item)}
            onOpenAdded={openMyWork}
          />
        ))}
      </View>
      {ratingsState === 'success' && rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No aircraft found.</Text>
          <InlineLink label="Request it" onPress={() => setRequestOpen(true)} />
        </View>
      ) : null}
      {ratingsState === 'success' && rows.length > 0 ? (
        <InlineLink label={requestOpen ? 'Hide the catalog request' : "Can't find your aircraft? Request it"} onPress={() => setRequestOpen((v) => !v)} />
      ) : null}
      {requestOpen ? <CatalogRequestPanel /> : null}
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
