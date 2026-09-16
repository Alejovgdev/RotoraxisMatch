import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { TechnicianCard, TechnicianChip, TechnicianBadge, techUi } from './TechnicianUI';
import { AircraftTypeRatingPicker } from '../AircraftTypeRatingPicker';
import { DateField } from '../DateField';
import type { DateFieldPalette } from '../DateField.types';
import { AircraftRatingIndex, getAircraftTypeRatingLabel } from '../../constants/aircraftTypeRatings';
import { getLicenseRatingProductType, isUnusualCombination } from '../../utils/licenseCategoryProductType';
import { AircraftTypeRatingCatalog, AuthorityCode, LicenseCode } from '../../types/catalog';
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

// Fase 3b screen 2 — the technician-side counterpart to
// TypeRatingRequirementsEditor/ApproximateFilterSection (Fase 3b screen 1):
// same pattern — search-and-add via AircraftTypeRatingPicker, chips only
// for the closed set of license categories, catalog displayName for every
// label, categoryHint pre-filter with a "Show all" escape hatch (never a
// hard block — see AircraftTypeRatingPicker/getLicenseRatingProductType).
//
// Two distinct, deliberately different behaviors for the same
// license<->productType mismatch (confirmed with the user 2026-07-22):
//   - NEW row: the picker's categoryHint hides incompatible ratings by
//     default, so creating the mismatch takes an explicit "Show all" —
//     prevents the casual/accidental case without ever hard-blocking a
//     real one (e.g. a dual-rated technician).
//   - EXISTING row: never hidden, edited, or auto-removed — just an
//     "Unusual combination for <license>" badge alongside "Declared" /
//     "Inactive catalog entry", using the SAME getLicenseRatingProductType()
//     mapping (isUnusualCombination(), licenseCategoryProductType.ts) so
//     las dos rutas de esta pantalla contestan a la misma pregunta con la
//     misma tabla. Ojo: "la misma" es la del lado TÉCNICO. La tabla del
//     lado oferta (getOfferProductTypeRestriction) es otra a propósito y no
//     pinta nada aquí — ver la cabecera de licenseCategoryProductType.ts.
//
// Vigencia fields (Fase 3: issued/expires DateFields + Current/Not current
// toggle) are unchanged from before this redesign — same fields, same
// onChange shape, just relocated here. The row shape this emits via
// onChange (HabilitationRow) is byte-for-byte what profile.tsx already fed
// into technicianRepositoryV2.replaceHabilitations(), so the save path
// needed no changes.
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

  const categoryHint = useMemo(() => {
    if (!newHabLicense) return undefined;
    const productType = getLicenseRatingProductType(newHabLicense.code as LicenseCode);
    return productType ? { productType, licenseCode: credentialLabel(newHabLicense.authority, newHabLicense.code) } : undefined;
  }, [newHabLicense]);

  function selectCategory(license: HeldLicense) {
    setNewHabLicense(license);
    setNewHabRating(null); // a rating picked for a different category may no longer make sense, especially once the pre-filter kicks in
  }

  function addHabilitation() {
    if (!newHabLicense || !newHabRating) return;
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
        const unusual = isUnusualCombination(h.licenseCode as LicenseCode, rating?.productType);
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
                  {unusual ? <TechnicianBadge label={`Unusual combination for ${h.licenseCode}`} tone="warning" small /> : null}
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
            : 'Your licences carry no aircraft type ratings (FAA certificates do not). Add a Part-66 licence first.'}
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
      <AircraftTypeRatingPicker
        value={newHabRating}
        onSelect={(r) => {
          setNewHabRating(r.id);
          onRatingResolved(r);
        }}
        categoryHint={categoryHint}
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
        style={[styles.addButton, (!newHabLicense || !newHabRating) && styles.addButtonDisabled]}
        onPress={addHabilitation}
        disabled={!newHabLicense || !newHabRating}
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
