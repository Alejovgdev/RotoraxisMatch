import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGoBack } from '../../../../src/state/useGoBack';
import { Text, useConfirmDialog } from '../../../../src/components/ui';
import { DateField } from '../../../../src/components/DateField';
import { PillButton } from '../../../../src/components/company/CompanyPage';
import { ProfileLoadGate, ProfileScreenFrame, SaveFooter } from '../../../../src/components/technician/ProfileParts';
import {
  AddRow,
  InlineLink,
  LicenceCard,
  LockedRow,
  RemoveLink,
  WhatYouDo,
  WorkNote,
  WorkSectionHeader,
  workStyles,
} from '../../../../src/components/technician/WorkParts';
import { HabilitationItem } from '../../../../src/components/technician/HabilitationsEditor';
import { AircraftExperienceEditor } from '../../../../src/components/technician/AircraftExperienceEditor';
import { EngineExperienceEditor } from '../../../../src/components/technician/EngineExperienceEditor';
import { CatalogRequestPanel } from '../../../../src/components/technician/CatalogRequestPanel';
import { useOwnTechnicianProfile } from '../../../../src/state/useOwnTechnicianProfile';
import { useProfileTypesEditor } from '../../../../src/state/useProfileTypesEditor';
import { useEnginesCatalog } from '../../../../src/state/useEnginesCatalog';
import { useTechnicianTypes } from '../../../../src/auth/useCatalogOptions';
import { saveTechnicianProfile } from '../../../../src/usecases/technicianProfile';
import { authorityLicenseCanExpire, credentialLabel } from '../../../../src/constants/licenses';
import { AircraftRatingIndex } from '../../../../src/constants/aircraftTypeRatings';
import { technicianTypeLabel } from '../../../../src/constants/technicianTypes';
import {
  heldLicenseCodes,
  licensesForHabilitations,
  signOffLabel,
  updateHeldLicenseDates,
} from '../../../../src/utils/profileLicenses';
import { showsEngineExperience } from '../../../../src/utils/profileEngines';
import { blockingHabilitationIssues, profileHabilitationIssues } from '../../../../src/utils/profileHabilitationValidation';
import { licenseAllowsIndividualTypeRatings } from '../../../../src/utils/individualTypeRatingScope';
import {
  WorkDraft,
  habilitationsOfLicence,
  habilitationsWithoutLicence,
  licenceCategoryText,
  licenceDatesText,
  licencesChanged,
  toggleDraftLicense,
  whatYouDoFacts,
  workDraftDirty,
  workDraftFromProfile,
  workSnapshotKey,
} from '../../../../src/utils/technicianWork';
import { TECHNICIAN_ADD_ROUTES, technicianTypeRatingHref } from '../../../../src/utils/technicianNavigation';
import type { AuthorityCode, AuthorityLicenseCode } from '../../../../src/types/catalog';
import type {
  AircraftExperienceRow,
  EditableTechnicianProfile,
  EngineExperienceRow,
  HabilitationRow,
} from '../../../../src/types/technicianProfileEdit';

// My work (rediseño, fases 6A y 6B; maqueta T-Quals; T3, T4 y respuesta 25).
//
//   - "What you do": los tipos de perfil. Se guardan al tocarlos. Los que pone
//     una licencia llevan candado y una línea que dice cuál; quitar Engine
//     Technician teniendo motores avisa antes, como siempre.
//   - Licencias como tarjetas, con sus type ratings dentro.
//   - Experiencia en aeronaves y en motores; motores, bloqueado sin Engine
//     Technician.
//
// Añadir es cosa de los asistentes del "+" (fase 6B): el botón de añadir de
// cada sección abre el suyo. La cabecera ya no lleva "+ Add" (2026-10-09); el
// de las barras de navegación sigue llevando al "+". Aquí se sigue
// EDITANDO y QUITANDO lo que ya hay —fechas, vigencia, firma, quitar una
// licencia, un rating, una aeronave o un motor—, en un borrador que se guarda
// con "Save" por el caso de uso (el guardado de My work de la 6A). Mientras
// haya licencias sin guardar, los tipos no se tocan: se guardarían contra unas
// licencias que todavía no están en la base.
//
// El borrador parte de un perfil (`base`). Si el perfil cambia por debajo —un
// asistente añadió algo mientras había cambios sin guardar— guardar el
// borrador lo pisaría (quitaría, p. ej., la licencia recién añadida), así que
// "Save" se para y se ofrece descartar los cambios.
export default function MyWorkScreen() {
  const goBack = useGoBack();
  // Al volver de un asistente se vuelve a leer, para enseñar lo añadido.
  const state = useOwnTechnicianProfile({ refreshOnFocus: true });
  return (
    <ProfileLoadGate state={state} title="My work" onBack={goBack}>
      {(profile) => <MyWork saved={profile} ratings={state.ratingsById} reload={state.reload} onBack={goBack} />}
    </ProfileLoadGate>
  );
}

function licenceKey(l: { authority: string; code: string }): string {
  return `${l.authority}|${l.code}`;
}

function MyWork({
  saved,
  ratings,
  reload,
  onBack,
}: {
  saved: EditableTechnicianProfile;
  ratings: AircraftRatingIndex;
  reload: () => Promise<EditableTechnicianProfile | null>;
  onBack: () => void;
}) {
  const router = useRouter();
  const { options: typeOptions, loading: typesLoading } = useTechnicianTypes();
  const { engineIndex, state: engineState } = useEnginesCatalog();
  const { confirm, dialog } = useConfirmDialog();

  // El perfil del que parte el borrador, y el borrador.
  const [base, setBase] = useState<EditableTechnicianProfile>(saved);
  const [draft, setDraft] = useState<WorkDraft>(() => workDraftFromProfile(saved));
  // Los ratings que nombra el perfil (activos e inactivos): sin ellos se
  // pintaría un UUID.
  const [ratingsById, setRatingsById] = useState<AircraftRatingIndex>(ratings);
  useEffect(() => {
    setRatingsById((prev) => new Map([...prev, ...ratings]));
  }, [ratings]);

  const [expandedLicence, setExpandedLicence] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removalWarning, setRemovalWarning] = useState<string | null>(null);

  const dirty = workDraftDirty(base, draft);
  const licencesDirty = licencesChanged(base.licenses, draft.licenses);
  // El perfil cambió por debajo de un borrador sin guardar.
  const stale = dirty && workSnapshotKey(base) !== workSnapshotKey(saved);

  // Sin cambios pendientes, el borrador sigue al perfil guardado (al volver
  // de un asistente, tras una recarga…).
  useEffect(() => {
    if (!workDraftDirty(base, draft)) {
      setBase(saved);
      setDraft(workDraftFromProfile(saved));
    }
    // Sólo cuando llega un perfil nuevo; el borrador manda mientras se edita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const facts = whatYouDoFacts(draft.licenses);
  // Sólo lo que de verdad impide guardar (blockingHabilitationIssues): una
  // habilitación que no se puede verificar mientras el catálogo carga no es
  // un aviso si no se han tocado las habilitaciones.
  const blockingIssues = blockingHabilitationIssues(
    profileHabilitationIssues(draft.habilitations, draft.licenses, ratingsById, engineIndex),
    draft.habDirty,
  );
  const orphans = habilitationsWithoutLicence(draft.habilitations, draft.licenses);

  // ── Tipos: se guardan al tocarlos (respuesta 25) ──────────────────────────
  const labelOf = useCallback(
    (code: string) => typeOptions.find((o) => o.code === code)?.label ?? technicianTypeLabel(code),
    [typeOptions],
  );
  const onTypesSaved = useCallback((next: string[], enginesRemoved: boolean) => {
    // La base ha borrado los motores al quitar el tipo (091): la lista,
    // guardada o no, se va con él. El perfil de partida también, para que no
    // parezca que el perfil cambió por debajo.
    setDraft((d) => ({ ...d, types: next, ...(enginesRemoved ? { engines: [], enginesDirty: false } : {}) }));
    setBase((b) => ({ ...b, technicianTypes: next, ...(enginesRemoved ? { engines: [] } : {}) }));
    void reload();
  }, [reload]);
  const typesEditor = useProfileTypesEditor({
    technicianId: saved.id,
    types: draft.types,
    lockedTypes: facts.locked,
    // Las licencias GUARDADAS (mientras difieran del borrador, los chips están apagados).
    licenseCodes: heldLicenseCodes(base.licenses),
    engineCount: draft.engines.length,
    labelOf,
    confirm,
    onSaved: onTypesSaved,
  });

  // ── Editar y quitar: borrador + "Save" ─────────────────────────────────────
  function edit(apply: (d: WorkDraft) => WorkDraft) {
    setError(null);
    setRemovalWarning(null);
    setDraft(apply);
  }

  function removeLicence(authority: AuthorityCode, code: AuthorityLicenseCode) {
    edit((d) => toggleDraftLicense(d, authority, code));
  }

  function updateLicenceDates(authority: string, code: string, patch: { issuedAt?: string; expiresAt?: string }) {
    edit((d) => ({ ...d, licenses: updateHeldLicenseDates(d.licenses, authority, code, patch) }));
  }

  function setHabilitations(next: HabilitationRow[]) {
    edit((d) => ({ ...d, habilitations: next, habDirty: true }));
  }

  function patchHabilitation(target: HabilitationRow, patch: Partial<HabilitationRow>) {
    setHabilitations(draft.habilitations.map((h) => (h === target ? { ...h, ...patch } : h)));
  }

  function removeHabilitation(target: HabilitationRow) {
    setHabilitations(draft.habilitations.filter((h) => h !== target));
  }

  function setAircraftExperience(next: AircraftExperienceRow[]) {
    edit((d) => ({ ...d, aircraftExperience: next, experienceDirty: true }));
  }

  function setEngines(next: EngineExperienceRow[]) {
    edit((d) => ({ ...d, engines: next, enginesDirty: true }));
  }

  function discardChanges() {
    setError(null);
    setRemovalWarning(null);
    setBase(saved);
    setDraft(workDraftFromProfile(saved));
  }

  // ── Añadir: los asistentes del "+" ────────────────────────────────────────
  // Un asistente guarda en la base; un borrador sin guardar se quedaría viejo
  // y, al guardarlo, pisaría lo añadido. Se pregunta antes.
  async function openAdd(href: string) {
    if (dirty) {
      const discard = await confirm({
        title: 'Unsaved changes',
        message: 'Save or discard your changes in My work before adding something new.',
        confirmLabel: 'Discard changes',
        destructive: true,
      });
      if (!discard) return;
      discardChanges();
    }
    router.push(href as never);
  }

  async function save() {
    if (!dirty || saving || stale) return;
    setSaving(true);
    setError(null);
    setRemovalWarning(null);
    const result = await saveTechnicianProfile(saved.id, {
      work: {
        types: draft.types,
        licenses: draft.licenses,
        habilitations: draft.habilitations,
        habDirty: draft.habDirty,
        aircraftExperience: draft.aircraftExperience,
        experienceDirty: draft.experienceDirty,
        engines: draft.engines,
        enginesDirty: draft.enginesDirty,
        ratingsById,
        engineIndex,
      },
    });
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    // Se recarga siempre: las filas nuevas traen su id, y una licencia que no
    // se pudo retirar vuelve a la pantalla (con su tipo) en vez de parecer
    // quitada.
    const fresh = await reload();
    if (fresh) {
      setBase(fresh);
      setDraft(workDraftFromProfile(fresh));
    } else {
      // Sin recarga, lo guardado es el borrador: pasa a ser el punto de partida.
      setBase((b) => ({
        ...b,
        technicianTypes: draft.types,
        licenses: draft.licenses,
        habilitations: draft.habilitations,
        aircraftExperience: draft.aircraftExperience,
        engines: draft.engines,
      }));
      setDraft((d) => ({ ...d, habDirty: false, experienceDirty: false, enginesDirty: false }));
    }
    setRemovalWarning(result.licenseRemovalWarning);
    setSaving(false);
  }

  const ratingLicences = licensesForHabilitations(draft.licenses);
  const habilitationProps = { ratingsById, engineIndex, engineState };

  return (
    <ProfileScreenFrame
      title="My work"
      unsaved={dirty}
      onDiscard={discardChanges}
      subtitle="What you do, your licences and the aircraft and engines you know."
      onBack={onBack}
      footer={
        dirty || error ? (
          <SaveFooter
            onSave={save}
            saving={saving}
            disabled={!dirty || stale}
            error={error}
            status={dirty ? 'Unsaved changes' : null}
          />
        ) : undefined
      }
    >
      {stale ? (
        <View style={styles.stale}>
          <WorkNote tone="error">
            Your profile changed in another screen since you started editing here. Saving now would undo that change, so
            discard your changes here and edit again.
          </WorkNote>
          <View style={workStyles.buttons}>
            <PillButton label="Discard my changes" variant="danger" size="sm" onPress={discardChanges} />
          </View>
        </View>
      ) : null}

      {/* ── What you do ─────────────────────────────────────────────────── */}
      <WhatYouDo
        subtitle="Tap all that apply. Changes are saved straight away."
        options={typeOptions}
        loading={typesLoading}
        types={draft.types}
        locked={facts.locked}
        lockLines={facts.lockLines}
        faaNote={facts.faaNote}
        disabled={licencesDirty || stale}
        disabledNote={stale ? null : 'Save your licence changes first to change what you do.'}
        savingCode={typesEditor.savingCode}
        error={typesEditor.error}
        onToggle={(code) => void typesEditor.toggle(code)}
      />

      {/* ── Licences ────────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <WorkSectionHeader
          title="Licences"
          subtitle="Each licence ticks the profile type it certifies — mechanical or avionics — and unticks it again if you remove it. Leave empty if you hold none."
        />
        {removalWarning ? <WorkNote tone="warning">{removalWarning}</WorkNote> : null}
        {blockingIssues.length > 0 ? (
          <WorkNote tone="warning">{blockingIssues.map((issue) => issue.message).join('\n')}</WorkNote>
        ) : null}

        {draft.licenses.map((license) => {
          const key = licenceKey(license);
          const licenceRatings = habilitationsOfLicence(draft.habilitations, license);
          const allowsRatings = licenseAllowsIndividualTypeRatings(license.authority, license.code);
          return (
            <LicenceCard
              key={key}
              authority={license.authority}
              code={license.code}
              title={credentialLabel(license.authority, license.code)}
              subtitle={licenceCategoryText(license.code)}
              meta={licenceDatesText(license)}
              expanded={expandedLicence === key}
              onToggle={() => setExpandedLicence((current) => (current === key ? null : key))}
              details={
                <>
                  <Text style={workStyles.fieldHint}>Validity dates (optional)</Text>
                  <View style={workStyles.dates}>
                    <View style={workStyles.dateField}>
                      <Text style={workStyles.dateLabel}>Issued</Text>
                      <DateField
                        value={license.issuedAt}
                        onChange={(v) => updateLicenceDates(license.authority, license.code, { issuedAt: v })}
                        placeholder="Not set"
                      />
                    </View>
                    {/* La caducidad del documento depende de su autoridad. */}
                    {authorityLicenseCanExpire(license.authority) ? (
                      <View style={workStyles.dateField}>
                        <Text style={workStyles.dateLabel}>Expires</Text>
                        <DateField
                          value={license.expiresAt}
                          onChange={(v) => updateLicenceDates(license.authority, license.code, { expiresAt: v })}
                          placeholder="Not set"
                        />
                      </View>
                    ) : null}
                  </View>
                  <RemoveLink
                    label="Remove licence"
                    onPress={() => removeLicence(license.authority, license.code)}
                    accessibilityLabel={`Remove ${credentialLabel(license.authority, license.code)}`}
                  />
                </>
              }
            >
              {licenceRatings.map((h) => (
                <HabilitationItem
                  key={h.id ?? `new-${h.authority}-${h.licenseCode}-${h.aircraftTypeRatingId}`}
                  habilitation={h}
                  {...habilitationProps}
                  onChange={(patch) => patchHabilitation(h, patch)}
                  onRemove={() => removeHabilitation(h)}
                />
              ))}
              {allowsRatings ? (
                <AddRow inCard label={`Add a type rating on ${license.code}`} onPress={() => void openAdd(technicianTypeRatingHref(license))} />
              ) : null}
            </LicenceCard>
          );
        })}

        {/* Una licencia quitada que aún sostiene type ratings: siguen aquí,
            nunca se borran solas, y el guardado se para hasta que se quiten
            (o vuelva la licencia). */}
        {orphans.length > 0 ? (
          <View style={styles.orphans}>
            <View style={styles.orphansHead}>
              <Text style={styles.orphansTitle}>Type ratings without their licence</Text>
            </View>
            {orphans.map((h) => (
              <HabilitationItem
                key={h.id ?? `new-${h.authority}-${h.licenseCode}-${h.aircraftTypeRatingId}`}
                habilitation={h}
                {...habilitationProps}
                showCredential
                onChange={(patch) => patchHabilitation(h, patch)}
                onRemove={() => removeHabilitation(h)}
              />
            ))}
          </View>
        ) : null}

        {draft.licenses.length > 0 && ratingLicences.length === 0 ? (
          <WorkNote>Individual type ratings require a B1, B2 or C licence. Aircraft experience can be declared separately.</WorkNote>
        ) : null}

        <AddRow label="Add a licence" onPress={() => void openAdd(TECHNICIAN_ADD_ROUTES.licence)} />
      </View>

      {/* ── Aircraft experience ─────────────────────────────────────────── */}
      {/* Lista SEPARADA de las habilitaciones: declarar una aeronave sin
          licencia no es una habilitación a la que le falta un campo. */}
      <AircraftExperienceEditor
        value={draft.aircraftExperience}
        onChange={setAircraftExperience}
        signOffLabel={signOffLabel(draft.licenses)}
        ratingsById={ratingsById}
        onAdd={() => void openAdd(TECHNICIAN_ADD_ROUTES.aircraft)}
      />

      {/* ── Engine experience ───────────────────────────────────────────── */}
      {/* Sesión 4 (091): sólo para Engine Technician — la base rechaza los
          motores de cualquier otro tipo. Sin el tipo, la fila bloqueada dice
          por qué (no se oculta). */}
      {showsEngineExperience(draft.types) ? (
        <EngineExperienceEditor value={draft.engines} onChange={setEngines} onAdd={() => void openAdd(TECHNICIAN_ADD_ROUTES.engine)} />
      ) : (
        <View style={styles.section}>
          <WorkSectionHeader title="Engine experience" />
          <LockedRow tile="ENG" title="Only for Engine Technicians" subtitle="Tick Engine Technician above to add engines" />
        </View>
      )}

      <View style={styles.request}>
        <InlineLink
          label={requestOpen ? 'Hide the catalog request' : "Can't find your aircraft, rating or engine? Request it"}
          onPress={() => setRequestOpen((v) => !v)}
        />
      </View>
      {requestOpen ? <CatalogRequestPanel /> : null}

      {dialog}
    </ProfileScreenFrame>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  stale: {
    gap: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#FDECEC',
  },
  orphans: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F3DDA4',
    overflow: 'hidden',
  },
  orphansHead: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF6E2',
  },
  orphansTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#7A3F06',
  },
  request: {
    alignItems: 'center',
  },
});
