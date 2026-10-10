import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Plane } from 'lucide-react-native';
import { useGoBack } from '../../../src/state/useGoBack';
import { Chip, Text, TextInput } from '../../../src/components/ui';
import { DateField } from '../../../src/components/DateField';
import { SegmentedControl, useIsWide } from '../../../src/components/company/CompanyPage';
import { ProfileLoadGate } from '../../../src/components/technician/ProfileParts';
import { InlineLink, WorkNote, workStyles } from '../../../src/components/technician/WorkParts';
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
  WizardLabel,
} from '../../../src/components/technician/WizardParts';
import { useOwnTechnicianProfile } from '../../../src/state/useOwnTechnicianProfile';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { saveTechnicianProfile } from '../../../src/usecases/technicianProfile';
import { credentialLabel } from '../../../src/constants/licenses';
import { AircraftRatingIndex, getAircraftTypeRatingLabel } from '../../../src/constants/aircraftTypeRatings';
import { licenceFromParam, typeRatingLicenceOptions, typeRatingRows } from '../../../src/utils/technicianAdd';
import {
  TECHNICIAN_ADD_ROUTES,
  TECHNICIAN_PROFILE_ROUTES,
  TECHNICIAN_TAB_ROUTES,
} from '../../../src/utils/technicianNavigation';
import { colors } from '../../../src/theme';
import type { HeldLicense } from '../../../src/utils/profileLicenses';
import type { AircraftTypeRatingCatalog } from '../../../src/types/catalog';
import type { EditableTechnicianProfile, HabilitationRow } from '../../../src/types/technicianProfileEdit';

// Añadir un type rating (rediseño, fase 6B; maquetas T-Rat, T-RatDetails y
// T-Done).
//
//   1. La licencia de la que cuelga (sólo si hay varias que admiten ratings) y
//      la aeronave, buscada sólo entre las que esa licencia cubre (el mismo
//      filtro que la 083 aplica en la base). Las que ya tiene en esa licencia
//      salen "✓ Added" y llevan a My work.
//   2. Los detalles de hoy: vigente o no, fechas y años.
//   3. Hecho.
//
// Guarda sólo las habilitaciones (las de antes, tal cual, más la nueva) por el
// caso de uso, con las comprobaciones de hoy.
export default function AddTypeRatingScreen() {
  const goBack = useGoBack();
  const state = useOwnTechnicianProfile();
  const { licence } = useLocalSearchParams<{ licence?: string }>();
  return (
    <ProfileLoadGate state={state} title="Add type rating" onBack={goBack}>
      {(profile) => (
        <AddTypeRatingWizard
          profile={profile}
          ratingsById={state.ratingsById}
          initialLicence={typeof licence === 'string' ? licence : undefined}
          reload={state.reload}
          onExit={goBack}
        />
      )}
    </ProfileLoadGate>
  );
}

function AddTypeRatingWizard({
  profile,
  ratingsById,
  initialLicence,
  reload,
  onExit,
}: {
  profile: EditableTechnicianProfile;
  ratingsById: AircraftRatingIndex;
  initialLicence?: string;
  reload: () => Promise<EditableTechnicianProfile | null>;
  onExit: () => void;
}) {
  const router = useRouter();
  const wide = useIsWide();
  const { ratings, state: ratingsState, retry: retryRatings } = useAircraftTypeRatingsCatalog();
  const { engineIndex, state: engineState, retry: retryEngines } = useEnginesCatalog();
  const options = typeRatingLicenceOptions(profile.licenses);

  const [licence, setLicence] = useState<HeldLicense | null>(() => licenceFromParam(initialLicence, options) ?? options[0] ?? null);
  const [query, setQuery] = useState('');
  const [rating, setRating] = useState<AircraftTypeRatingCatalog | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [isCurrent, setIsCurrent] = useState(true);
  const [issuedAt, setIssuedAt] = useState<string | undefined>();
  const [expiresAt, setExpiresAt] = useState<string | undefined>();
  const [years, setYears] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<HabilitationRow | null>(null);

  const allRatings = useMemo(() => {
    const index = new Map(ratingsById);
    if (rating) index.set(rating.id, rating);
    return index;
  }, [ratingsById, rating]);

  const openMyWork = () => router.dismissTo(TECHNICIAN_PROFILE_ROUTES.work as never);

  // Sin una licencia que admita ratings individuales no hay de dónde colgarlo
  // (el "+" ya lo enseña en gris; esto cubre un enlace directo).
  if (!licence) {
    return (
      <WizardFrame
        title="Add type rating"
        onBack={onExit}
        primary={{ label: 'Add a licence', onPress: () => router.replace(TECHNICIAN_ADD_ROUTES.licence as never) }}
      >
        <WizardHeading
          title="Add a licence first"
          text={profile.licenses.length === 0
            ? 'A type rating hangs from the licence it was issued under.'
            : 'Individual type ratings require a B1, B2 or C licence. Aircraft experience can be declared separately.'}
        />
      </WizardFrame>
    );
  }

  const credential = credentialLabel(licence.authority, licence.code);

  async function save() {
    if (saving || !licence || !rating) return;
    setSaving(true);
    setError(null);
    const fresh = await reload();
    if (!fresh) {
      setSaving(false);
      setError('Could not load your profile. Check your connection and try again.');
      return;
    }
    const trimmedYears = years.trim();
    const habilitation: HabilitationRow = {
      authority: licence.authority,
      licenseCode: licence.code,
      aircraftTypeRatingId: rating.id,
      experienceYears: trimmedYears ? Number(trimmedYears) : undefined,
      issuedAt,
      expiresAt,
      isCurrent,
    };
    const result = await saveTechnicianProfile(fresh.id, {
      newHabilitation: { habilitation, profile: fresh, ratingsById: allRatings, engineIndex },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(habilitation);
    void reload();
  }

  // ── Hecho ─────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <WizardDone
        title="Added to your profile"
        text="Companies will see it when they look at your profile."
        primary={{ label: 'See offers for you', onPress: () => router.navigate(TECHNICIAN_TAB_ROUTES.offers as never) }}
        secondary={{ label: 'Add something else', onPress: () => router.dismissTo(TECHNICIAN_ADD_ROUTES.menu as never) }}
      >
        <DoneItem
          tile={<IconTile><Plane color="#0B5E8C" size={20} strokeWidth={2} /></IconTile>}
          title={getAircraftTypeRatingLabel(done.aircraftTypeRatingId, allRatings)}
          subtitle={`${credentialLabel(done.authority, done.licenseCode)} · ${done.isCurrent === false ? 'Not current' : 'Current'}`}
          onPress={openMyWork}
        />
      </WizardDone>
    );
  }

  // ── Paso 2: detalles ──────────────────────────────────────────────────────
  if (step === 2 && rating) {
    return (
      <WizardFrame
        title="Add type rating"
        step={2}
        total={2}
        onBack={() => { setError(null); setStep(1); }}
        primary={{ label: 'Add type rating', onPress: () => void save(), loading: saving }}
        error={error}
      >
        <WizardHeading title="A few details" text="Only the status is needed. The rest is optional." />
        <ChosenCard
          tile={<IconTile><Plane color="#0B5E8C" size={20} strokeWidth={2} /></IconTile>}
          title={rating.displayName}
          subtitle={`On your ${credential}`}
        />
        <View style={styles.group}>
          <Text style={workStyles.fieldLabel}>Status</Text>
          <SegmentedControl
            options={[{ value: 'current', label: 'Current' }, { value: 'old', label: 'Not current' }]}
            value={isCurrent ? 'current' : 'old'}
            onChange={(v) => setIsCurrent(v === 'current')}
            accessibilityLabel="Status"
          />
        </View>
        <View style={workStyles.dates}>
          <View style={workStyles.dateField}>
            <Text style={workStyles.dateLabel}>Issued</Text>
            <DateField value={issuedAt} onChange={setIssuedAt} placeholder="Not set" />
          </View>
          <View style={workStyles.dateField}>
            <Text style={workStyles.dateLabel}>Expires</Text>
            <DateField value={expiresAt} onChange={setExpiresAt} placeholder="Not set" />
          </View>
        </View>
        <View style={styles.group}>
          <Text style={workStyles.fieldLabel}>Years of experience on this rating (optional)</Text>
          <TextInput
            style={workStyles.input}
            value={years}
            onChangeText={(v) => setYears(v.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 4"
            placeholderTextColor={colors.placeholder}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel="Years of experience on this rating"
          />
        </View>
      </WizardFrame>
    );
  }

  // ── Paso 1: licencia y aeronave ───────────────────────────────────────────
  // En escritorio la tarjeta crece con la lista: tantas filas como en motores;
  // la búsqueda acota.
  const rows = ratingsState === 'success'
    ? typeRatingRows(ratings, query, licence, profile.habilitations, engineIndex, wide ? 8 : undefined)
    : [];
  const engineCatalogDown = engineState === 'error' || engineState === 'empty';

  return (
    <WizardFrame
      title="Add type rating"
      step={1}
      total={2}
      onBack={onExit}
      primary={{ label: 'Continue', onPress: () => setStep(2), disabled: !rating }}
    >
      <WizardHeading
        title="Which aircraft?"
        text={options.length > 1 ? 'First, the licence it was issued under.' : `On your ${credential}.`}
      />

      {options.length > 1 ? (
        <View style={styles.group}>
          <WizardLabel>Licence</WizardLabel>
          <View style={workStyles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Licence">
            {options.map((l) => (
              <Chip
                key={`${l.authority}-${l.code}`}
                label={credentialLabel(l.authority, l.code)}
                selected={l.authority === licence.authority && l.code === licence.code}
                onPress={() => {
                  // Lo elegido para otra licencia puede no valer para ésta.
                  setLicence(l);
                  setRating(null);
                  setQuery('');
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* Sin catálogo de motores no se puede comprobar la propulsión de una B1. */}
      {engineCatalogDown ? (
        <View>
          <WorkNote tone="error">Engine catalog unavailable. B1 propulsion cannot be checked.</WorkNote>
          <InlineLink label="Retry engine catalog" onPress={retryEngines} />
        </View>
      ) : null}

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
            onSelect={() => setRating(row.item)}
            onOpenAdded={() => router.dismissTo(TECHNICIAN_PROFILE_ROUTES.work as never)}
          />
        ))}
      </View>
      {ratingsState === 'success' && rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Nothing found for this licence.</Text>
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
