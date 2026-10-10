import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Upload } from 'lucide-react-native';
import { useGoBack } from '../../../src/state/useGoBack';
import { Chip, Text } from '../../../src/components/ui';
import { DateField } from '../../../src/components/DateField';
import { ProfileLoadGate } from '../../../src/components/technician/ProfileParts';
import { LicenceTile, WorkNote, workStyles } from '../../../src/components/technician/WorkParts';
import {
  AddsNote,
  CategoryGrid,
  CategoryTile,
  DoneItem,
  DoneNotice,
  WizardDone,
  WizardFrame,
  WizardHeading,
  WizardLabel,
} from '../../../src/components/technician/WizardParts';
import { useOwnTechnicianProfile } from '../../../src/state/useOwnTechnicianProfile';
import { saveTechnicianProfile } from '../../../src/usecases/technicianProfile';
import { AUTHORITIES, credentialLabel } from '../../../src/constants/licenses';
import { HeldLicense, updateHeldLicenseDates } from '../../../src/utils/profileLicenses';
import { licenceCategoryText } from '../../../src/utils/technicianWork';
import {
  licenceAddsNote,
  licenceChoices,
  licenceDateBlocks,
  licenceTypeNotices,
  togglePickedLicence,
} from '../../../src/utils/technicianAdd';
import {
  TECHNICIAN_ADD_ROUTES,
  TECHNICIAN_PROFILE_ROUTES,
  TECHNICIAN_TAB_ROUTES,
  technicianDocumentsUploadHref,
} from '../../../src/utils/technicianNavigation';
import { colors } from '../../../src/theme';
import type { AuthorityCode } from '../../../src/types/catalog';
import type { EditableTechnicianProfile } from '../../../src/types/technicianProfileEdit';

// Añadir una licencia (rediseño, fase 6B; maquetas T-Lic, T-LicDates y
// T-LicDone; T5 y respuestas 26 y 27).
//
//   1. Autoridad y categorías (varias). Lo que ya tiene sale "✓ Added" y lleva
//      a My work. Si lo elegido añade un tipo de perfil, se dice aquí.
//   2. Fechas, un bloque por categoría. "Expires" sólo donde la licencia caduca
//      (no FAA ni CASA). El documento es un atajo a la subida normal: no queda
//      ligado a la licencia.
//   3. Hecho: lo añadido y, si añadió un tipo, por qué se queda (o, con una FAA
//      A o A&P, el texto de hoy).
//
// Guarda sólo las licencias nuevas (y los tipos que añaden) por el caso de uso:
// las que ya tenía no se reescriben y ninguna se retira.
export default function AddLicenceScreen() {
  const goBack = useGoBack();
  const state = useOwnTechnicianProfile();
  return (
    <ProfileLoadGate state={state} title="Add licence" onBack={goBack}>
      {(profile) => <AddLicenceWizard profile={profile} reload={state.reload} onExit={goBack} />}
    </ProfileLoadGate>
  );
}

type Done = { picked: HeldLicense[]; typesBefore: string[]; heldBefore: HeldLicense[] };

function AddLicenceWizard({
  profile,
  reload,
  onExit,
}: {
  profile: EditableTechnicianProfile;
  reload: () => Promise<EditableTechnicianProfile | null>;
  onExit: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [authority, setAuthority] = useState<AuthorityCode>(profile.licenses[0]?.authority ?? 'EASA');
  const [picked, setPicked] = useState<HeldLicense[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const openMyWork = () => router.dismissTo(TECHNICIAN_PROFILE_ROUTES.work as never);

  async function save() {
    if (saving || picked.length === 0) return;
    setSaving(true);
    setError(null);
    // El perfil de ahora mismo, no el de cuando se abrió el asistente.
    const fresh = await reload();
    if (!fresh) {
      setSaving(false);
      setError('Could not load your profile. Check your connection and try again.');
      return;
    }
    const result = await saveTechnicianProfile(fresh.id, { newLicences: { licenses: picked, profile: fresh } });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone({ picked, typesBefore: fresh.technicianTypes, heldBefore: fresh.licenses });
    void reload();
  }

  // ── Hecho ─────────────────────────────────────────────────────────────────
  if (done) {
    const notices = licenceTypeNotices(done.typesBefore, done.heldBefore, done.picked);
    const many = done.picked.length > 1;
    return (
      <WizardDone
        title={many ? 'Licences added' : 'Licence added'}
        text={`Companies will see ${many ? 'them' : 'it'} when they look at your profile.`}
        primary={{ label: 'See offers for you', onPress: () => router.navigate(TECHNICIAN_TAB_ROUTES.offers as never) }}
        secondary={{ label: 'Add something else', onPress: () => router.dismissTo(TECHNICIAN_ADD_ROUTES.menu as never) }}
      >
        {done.picked.map((l) => (
          <DoneItem
            key={`${l.authority}-${l.code}`}
            tile={<LicenceTile authority={l.authority} code={l.code} size={44} onWhite />}
            title={credentialLabel(l.authority, l.code)}
            subtitle={licenceCategoryText(l.code)}
            onPress={openMyWork}
          />
        ))}
        {notices.map((n) => <DoneNotice key={n.type} title={n.title} text={n.text} />)}
      </WizardDone>
    );
  }

  // ── Paso 2: fechas y documento ────────────────────────────────────────────
  if (step === 2) {
    return (
      <WizardFrame
        title="Add licence"
        step={2}
        total={2}
        onBack={() => { setError(null); setStep(1); }}
        primary={{ label: picked.length > 1 ? 'Add licences' : 'Add licence', onPress: () => void save(), loading: saving }}
        error={error}
      >
        <WizardHeading title="Dates and proof" text="Both are optional. You can add them later." />
        {licenceDateBlocks(picked).map(({ license, showsExpiry }) => (
          <View key={`${license.authority}-${license.code}`} style={styles.dateCard}>
            <View style={styles.dateHead}>
              <LicenceTile authority={license.authority} code={license.code} size={44} onWhite />
              <View style={styles.flexCopy}>
                <Text style={styles.dateTitle}>{credentialLabel(license.authority, license.code)}</Text>
                <Text style={styles.dateSub}>{licenceCategoryText(license.code)}</Text>
              </View>
            </View>
            <View style={workStyles.dates}>
              <View style={workStyles.dateField}>
                <Text style={workStyles.dateLabel}>Issued</Text>
                <DateField
                  value={license.issuedAt}
                  onChange={(v) => setPicked((p) => updateHeldLicenseDates(p, license.authority, license.code, { issuedAt: v }))}
                  placeholder="Not set"
                />
              </View>
              {/* La caducidad del documento depende de su autoridad (no FAA ni CASA). */}
              {showsExpiry ? (
                <View style={workStyles.dateField}>
                  <Text style={workStyles.dateLabel}>Expires</Text>
                  <DateField
                    value={license.expiresAt}
                    onChange={(v) => setPicked((p) => updateHeldLicenseDates(p, license.authority, license.code, { expiresAt: v }))}
                    placeholder="Not set"
                  />
                </View>
              ) : null}
            </View>
          </View>
        ))}

        {/* Atajo a la subida normal de Documents (respuesta 26): el documento
            no queda ligado a la licencia. */}
        <Pressable
          onPress={() => router.push(technicianDocumentsUploadHref('license') as never)}
          style={({ pressed, hovered }: any) => [styles.docButton, (pressed || hovered) && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Photo or PDF of the licence. Opens Documents"
        >
          <View style={styles.docIcon}>
            <Upload color={colors.primary} size={20} strokeWidth={2.2} />
          </View>
          <View style={styles.flexCopy}>
            <Text style={styles.docTitle}>Photo or PDF of the licence</Text>
            <Text style={styles.docSub}>Needed to verify it. Uploads in Documents.</Text>
          </View>
        </Pressable>
      </WizardFrame>
    );
  }

  // ── Paso 1: autoridad y categorías ────────────────────────────────────────
  const choices = licenceChoices(authority, profile.licenses, picked);
  const elsewhere = picked.filter((l) => l.authority !== authority);
  const addsNote = licenceAddsNote(profile.technicianTypes, profile.licenses, picked);
  const n = picked.length;

  return (
    <WizardFrame
      title="Add licence"
      step={1}
      total={2}
      onBack={onExit}
      primary={{
        label: n > 0 ? `Continue with ${n} ${n === 1 ? 'licence' : 'licences'}` : 'Pick at least one',
        onPress: () => setStep(2),
        disabled: n === 0,
      }}
    >
      <WizardHeading title="Which licence do you hold?" text="Pick the authority, then every category it issued you." />

      <View style={styles.group}>
        <WizardLabel>Authority</WizardLabel>
        <View style={workStyles.chipRow}>
          {AUTHORITIES.map((a) => (
            <Chip key={a.code} label={a.label} selected={a.code === authority} onPress={() => setAuthority(a.code)} />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <WizardLabel>Categories · pick all you hold</WizardLabel>
        <CategoryGrid>
          {choices.map((c) => (
            <CategoryTile
              key={c.code}
              code={c.code}
              picked={c.picked}
              added={c.added}
              onToggle={() => setPicked((p) => togglePickedLicence(p, profile.licenses, c.authority, c.code))}
              onOpenAdded={openMyWork}
            />
          ))}
        </CategoryGrid>
        {/* Lo elegido en otra autoridad no se esconde. */}
        {elsewhere.length > 0 ? (
          <WorkNote>{`Also picked: ${elsewhere.map((l) => credentialLabel(l.authority, l.code)).join(', ')}`}</WorkNote>
        ) : null}
        {addsNote ? <AddsNote>{addsNote}</AddsNote> : null}
      </View>
    </WizardFrame>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: 10,
  },
  flexCopy: {
    flex: 1,
    minWidth: 0,
  },
  dateCard: {
    gap: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E1E8EE',
  },
  dateHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  dateSub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  docButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#B8C8D9',
    backgroundColor: '#F7FAFC',
  },
  pressed: {
    backgroundColor: colors.surfaceSoft,
  },
  docIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  docSub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
