import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { TechnicianCard, TechnicianChip, TechnicianBadge, techUi } from './TechnicianUI';
import { AircraftTypeRatingPicker } from '../AircraftTypeRatingPicker';
import { DateField } from '../DateField';
import type { DateFieldPalette } from '../DateField.types';
import { AircraftRatingIndex, getAircraftTypeRatingLabel } from '../../constants/aircraftTypeRatings';
import { individualTypeRatingScopeError } from '../../utils/individualTypeRatingScope';
import { useEnginesCatalog } from '../../state/useEnginesCatalog';
import { AircraftTypeRatingCatalog, AuthorityCode } from '../../types/catalog';
import { credentialLabel } from '../../constants/licenses';
import { HeldLicense, licensesForHabilitations, sortHeldLicenses } from '../../utils/profileLicenses';

export interface HabilitationRow {
  id?: string;
  // Paso 5b: la CREDENCIAL de la que cuelga, autoridad incluida. Con una B1.1
  // EASA y otra UK CAA el código no dice de cuál es, y el repositorio resuelve
  // technician_license_id por el par (ver replaceHabilitations).
  authority: AuthorityCode;
  licenseCode: string;
  aircraftTypeRatingId: string;
  experienceYears?: number;
  // Optional vigencia (Fase 3). Absent issuedAt/expiresAt and isCurrent
  // undefined/true are all neutral for matching — only an explicit
  // isCurrent === false or a past expiresAt degrade a match, never exclude
  // it. See offerMatchExplain.ts.
  issuedAt?: string;
  expiresAt?: string;
  isCurrent?: boolean;
}

// Fase 5.3 (2026-07-28): LegacyHabilitationRow and the read-only "Legacy" /
// "Needs review" section that rendered it are GONE, together with the
// pre-Part-66 aircraft_types catalog they described. Every habilitation is
// now an editable HabilitationRow with a real catalog rating — there is no
// second, unerasable kind of row anymore.

interface Props {
  value: HabilitationRow[];
  onChange: (next: HabilitationRow[]) => void;
  // Las credenciales que el técnico tiene AHORA — una habilitación sólo puede
  // colgar de una licencia que existe. Paso 5b: credenciales (autoridad +
  // código), no códigos; las de la FAA no se ofrecen, no llevan type ratings.
  heldLicenses: readonly HeldLicense[];
  // Resolves labels for every rating referenced by `value`, including
  // inactive ones — owned by the parent (profile.tsx also needs it at save
  // time, para los mensajes de validacion), passed down read-only.
  ratingsById: AircraftRatingIndex;
  // Called the moment the picker resolves a NEW rating (before "Add" is
  // even pressed) so the parent's own index stays in sync — mirrors the
  // inline behavior this replaces.
  onRatingResolved: (rating: AircraftTypeRatingCatalog) => void;
  onRequestCatalog: () => void;
  dateFieldPalette: DateFieldPalette;
}

// H3: new individual ratings must fit their credential. Existing rows stay
// visible, without automatic removal. Migration 083 also guards direct writes.
export function HabilitationsEditor({
  value,
  onChange,
  heldLicenses,
  ratingsById,
  onRatingResolved,
  onRequestCatalog,
  dateFieldPalette,
}: Props) {
  const [newHabLicense, setNewHabLicense] = useState<HeldLicense | null>(null);
  const selectable = sortHeldLicenses(licensesForHabilitations(heldLicenses));
  const [newHabRating, setNewHabRating] = useState<string | null>(null);
  const [newHabExperienceYears, setNewHabExperienceYears] = useState('');

  const { engineIndex, state: engineState, retry: retryEngines } = useEnginesCatalog();
  const activeLicense = newHabLicense && selectable.find(
    (l) => l.authority === newHabLicense.authority && l.code === newHabLicense.code,
  );
  function isRatingAllowed(rating: AircraftTypeRatingCatalog): boolean {
    return Boolean(activeLicense && !individualTypeRatingScopeError(activeLicense.authority, activeLicense.code, rating, engineIndex));
  }
  const selectedRating = newHabRating ? ratingsById.get(newHabRating) : undefined;
  const canAdd = Boolean(selectedRating && isRatingAllowed(selectedRating));

  function selectCategory(license: HeldLicense) {
    setNewHabLicense(license);
    setNewHabRating(null); // a rating picked for a different category may no longer make sense, especially once the pre-filter kicks in
  }

  function addHabilitation() {
    if (!activeLicense || !newHabRating || !canAdd) return;
    if (
      value.some(
        (h) => h.authority === newHabLicense.authority && h.licenseCode === newHabLicense.code && h.aircraftTypeRatingId === newHabRating,
      )
    ) return;
    const trimmedYears = newHabExperienceYears.trim();
    const experienceYears = trimmedYears ? Number(trimmedYears) : undefined;
    onChange([
      ...value,
      { authority: newHabLicense.authority, licenseCode: newHabLicense.code, aircraftTypeRatingId: newHabRating, experienceYears },
    ]);
    setNewHabLicense(null);
    setNewHabRating(null);
    setNewHabExperienceYears('');
  }

  function removeHabilitation(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function updateHabilitationField(index: number, patch: Partial<Pick<HabilitationRow, 'issuedAt' | 'expiresAt' | 'isCurrent'>>) {
    onChange(value.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  }

  return (
    <TechnicianCard style={styles.card}>
      <Text style={styles.title}>Habilitations</Text>
      <Text style={styles.subtitle}>Each rating is linked to the licence category it was issued under — never guessed.</Text>

      {value.length === 0 ? <Text style={styles.emptyValue}>Not specified</Text> : null}

      {value.map((h, index) => {
        const rating = ratingsById.get(h.aircraftTypeRatingId);
        const scopeError = rating ? individualTypeRatingScopeError(h.authority, h.licenseCode, rating, engineIndex) : null;
        return (
          <View key={h.id ?? `new-${h.authority}-${h.licenseCode}-${h.aircraftTypeRatingId}`} style={styles.habItem}>
            <View style={styles.habTopRow}>
              <View style={styles.habInfo}>
                <Text style={styles.habLicense}>{credentialLabel(h.authority, h.licenseCode)}</Text>
                <Text style={styles.habRating}>
                  {getAircraftTypeRatingLabel(h.aircraftTypeRatingId, ratingsById)}
                  {h.experienceYears ? ` · ${h.experienceYears} years` : ''}
                </Text>
                <View style={styles.chipRow}>
                  <TechnicianBadge label="Declared" tone="cyan" small />
                  {rating?.isActive === false ? <TechnicianBadge label="Inactive catalog entry" tone="warning" small /> : null}
                  {scopeError && engineState === 'success' ? <TechnicianBadge label="Review licence / aircraft scope" tone="warning" small /> : null}
                </View>
              </View>
              <TouchableOpacity onPress={() => removeHabilitation(index)} accessibilityRole="button">
                <Text style={styles.habRemove}>Remove</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.habVigenciaRow}>
              <View style={styles.habVigenciaField}>
                <Text style={styles.fieldLabelXs}>Issued</Text>
                <DateField
                  value={h.issuedAt}
                  onChange={(v) => updateHabilitationField(index, { issuedAt: v })}
                  placeholder="Not set"
                  palette={dateFieldPalette}
                />
              </View>
              <View style={styles.habVigenciaField}>
                <Text style={styles.fieldLabelXs}>Expires</Text>
                <DateField
                  value={h.expiresAt}
                  onChange={(v) => updateHabilitationField(index, { expiresAt: v })}
                  placeholder="Not set"
                  palette={dateFieldPalette}
                />
              </View>
            </View>
            <View style={styles.chipRow}>
              <TechnicianChip label="Current" selected={h.isCurrent !== false} onPress={() => updateHabilitationField(index, { isCurrent: true })} />
              <TechnicianChip label="Not current" selected={h.isCurrent === false} onPress={() => updateHabilitationField(index, { isCurrent: false })} />
            </View>
          </View>
        );
      })}

      <View style={styles.fieldGap} />
      <Text style={styles.fieldLabel}>Add habilitation — category</Text>
      {selectable.length === 0 ? (
        <Text style={styles.emptyValue}>
          {heldLicenses.length === 0
            ? 'Add a license above first.'
            : 'Individual type ratings require a B1, B2 or C licence. Aircraft experience can be declared separately.'}
        </Text>
      ) : (
        <View style={styles.chipRow}>
          {selectable.map((license) => (
            <TechnicianChip
              key={`${license.authority}-${license.code}`}
              label={credentialLabel(license.authority, license.code)}
              selected={newHabLicense?.authority === license.authority && newHabLicense?.code === license.code}
              onPress={() => selectCategory(license)}
            />
          ))}
        </View>
      )}

      <View style={styles.fieldGap} />
      <Text style={styles.fieldLabel}>Add habilitation — aircraft + engine rating</Text>
      <Text style={styles.subtitle}>Only aircraft and propulsion covered by the selected licence are available.</Text>
      {engineState === 'error' || engineState === 'empty' ? (
        <View>
          <Text accessibilityRole="alert" style={styles.emptyValue}>Engine catalog unavailable. B1 propulsion cannot be checked.</Text>
          <TouchableOpacity onPress={retryEngines} accessibilityRole="button"><Text style={styles.linkText}>Retry engine catalog</Text></TouchableOpacity>
        </View>
      ) : null}
      <AircraftTypeRatingPicker
        value={newHabRating}
        onSelect={(r) => {
          if (!isRatingAllowed(r)) return;
          setNewHabRating(r.id);
          onRatingResolved(r);
        }}
        isRatingAllowed={isRatingAllowed}
      />

      <View style={styles.fieldGap} />
      <Text style={styles.fieldLabel}>Years of experience on this rating (optional)</Text>
      <TextInput
        style={styles.input}
        value={newHabExperienceYears}
        onChangeText={setNewHabExperienceYears}
        placeholder="e.g. 4"
        placeholderTextColor={techUi.textMuted}
        keyboardType="numeric"
      />

      <View style={styles.fieldGap} />
      <TouchableOpacity
        style={[styles.addButton, !canAdd && styles.addButtonDisabled]}
        onPress={addHabilitation}
        disabled={!canAdd}
        activeOpacity={0.75}
      >
        <Text style={styles.addButtonText}>Add habilitation</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onRequestCatalog} style={styles.linkRow}>
        <Text style={styles.linkText}>Can&apos;t find your habilitation? Request it.</Text>
      </TouchableOpacity>
    </TechnicianCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: techUi.text },
  subtitle: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: techUi.textSoft },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.textSoft, marginTop: spacing.xs },
  fieldLabelXs: { fontSize: 10, lineHeight: 13, fontWeight: '700', color: techUi.textMuted, marginBottom: 3 },
  fieldGap: { height: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  emptyValue: { fontSize: 13, lineHeight: 18, fontWeight: '500', color: techUi.textMuted },
  habItem: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: techUi.borderSoft,
  },
  habTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  habVigenciaRow: { flexDirection: 'row', gap: spacing.sm },
  habVigenciaField: { flex: 1, minWidth: 0 },
  habInfo: { flex: 1, minWidth: 0, gap: 4 },
  habLicense: { fontSize: 13, lineHeight: 17, fontWeight: '700', color: techUi.text },
  habRating: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: techUi.textSoft },
  habRemove: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.red },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: techUi.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: techUi.text,
    backgroundColor: techUi.surfaceSoft,
  },
  addButton: {
    marginTop: spacing.xs,
    borderRadius: 14,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: techUi.accentSoft,
  },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { fontSize: 13, fontWeight: '700', color: techUi.accent },
  linkRow: { marginTop: spacing.sm },
  linkText: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.accent },
});
