import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { CompanyCard, CompanyChip, companyUi } from './CompanyUI';
import { AircraftTypeRatingPicker } from '../AircraftTypeRatingPicker';
import { useAircraftTypeRatingsCatalog } from '../../state/useAircraftTypeRatingsCatalog';
import { catalogRepository } from '../../repositories/v2/catalogRepository';
import { AircraftRatingIndex, buildAircraftRatingIndex, getAircraftTypeRatingLabel } from '../../constants/aircraftTypeRatings';
import { isLicenseCompatibleWithProductType } from '../../utils/licenseCategoryProductType';
import { LICENSE_CATEGORIES } from '../../constants/licenses';
import { getOfferProductTypeLabel } from '../../constants/offerProductTypes';
import { AuthorityLicenseCode, LicenseCode } from '../../types/catalog';
import { OfferProductType } from '../../types/offer';

// Fase 6 tanda D: una fila es UNA AERONAVE. Perdió `licenseCode` (la licencia
// es de la oferta, una sola) y `requirementLevel` (la exigencia es de la
// oferta, `requiresAllAircraft`).
export interface ExactHabilitationRow {
  aircraftTypeRatingId: string;
  notes?: string;
}

interface Props {
  value: ExactHabilitationRow[];
  onChange: (next: ExactHabilitationRow[]) => void;
  // El producto declarado por la OFERTA. Acota el catálogo de ratings.
  productType: OfferProductType;
  // La licencia de la oferta, sólo para etiquetar las filas: cada aeronave se
  // cruza con ella. El selector de licencia vive en el formulario, no aquí.
  licenseCode?: AuthorityLicenseCode;
  // ¿Basta con una de las aeronaves, o hacen falta todas? La casilla vive
  // BAJO la lista (paso 6 del formulario), no como un paso propio.
  requiresAll: boolean;
  onChangeRequiresAll: (next: boolean) => void;
}

// Fase 3b screen 1 — the PRIMARY requirements block on the offer form
// (shared by new.tsx and edit.tsx so the two screens can no longer drift,
// which they had — see commit message). Search-and-add via
// AircraftTypeRatingPicker (product-type pre-filtered once a category is
// picked) + rows with a per-row Mandatory/Preferred badge, editable in
// place — no separate "Level" step and no remove+re-add just to change a
// level, unlike the previous design.
//
// Resolves rating labels for every referenced id itself (including
// inactive ones an existing offer might reference) — new.tsx/edit.tsx no
// longer need to manage a ratingIndex/ratingsById for this purpose at all.
//
// Migración 047 — el filtro se toma del producto de la OFERTA, no de la
// licencia de cada fila como hasta ahora. La versión anterior derivaba el
// facet de `getCompatibleProductType(newLicense)` (hoy
// `getLicenseRatingProductType`, y entonces B2/B2L/C/L devolvían todas
// undefined): con B2 seleccionada no se filtraba NADA. Por ese agujero
// entraron ofertas tituladas "Helicópteros" con requisitos B1.1/B1.2. Ahora
// el producto lo declara la empresa una sola vez y acota las dos listas.
export function TypeRatingRequirementsEditor({
  value,
  onChange,
  productType,
  licenseCode,
  requiresAll,
  onChangeRequiresAll,
}: Props) {
  const { ratingIndex: activeRatingIndex } = useAircraftTypeRatingsCatalog();
  const [resolvedIndex, setResolvedIndex] = useState<AircraftRatingIndex>(new Map());

  useEffect(() => {
    const ids = value.map((h) => h.aircraftTypeRatingId);
    if (ids.length === 0) {
      setResolvedIndex(new Map());
      return;
    }
    let cancelled = false;
    catalogRepository.getAircraftTypeRatingsByIds(ids).then((ratings) => {
      if (!cancelled) setResolvedIndex(buildAircraftRatingIndex(ratings));
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const labelIndex = useMemo(() => new Map([...activeRatingIndex, ...resolvedIndex]), [activeRatingIndex, resolvedIndex]);

  const [newLicense, setNewLicense] = useState<LicenseCode | null>(null);
  const [newRatingId, setNewRatingId] = useState<string | null>(null);
  const [newNotes, setNewNotes] = useState('');

  // Cambiar el producto deja en la fila en construcción un rating del
  // producto anterior, que ya no aparece en la lista: seleccionado pero
  // invisible, y rechazado por Postgres al guardar. Se limpia. `value` lo
  // limpia el formulario, que es quien pide confirmación cuando hay algo
  // que perder.
  useEffect(() => {
    setNewRatingId(null);
  }, [productType]);

  function addRow() {
    if (!newRatingId) return;
    // La PK (offer_id, aircraft_type_rating_id) que instala la 054 rechazaría
    // el duplicado; se corta aquí para que la empresa vea que no pasa nada en
    // vez de un error al guardar.
    if (value.some((h) => h.aircraftTypeRatingId === newRatingId)) return;
    onChange([...value, { aircraftTypeRatingId: newRatingId, notes: newNotes.trim() || undefined }]);
    setNewRatingId(null);
    setNewNotes('');
  }

  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <CompanyCard style={styles.card}>
      <Text style={styles.title}>Aircraft</Text>
      <Text style={styles.subtitle}>
        {licenseCode
          ? `Search and add the aircraft this role works on. All of them count against the offer's ${licenseCode} licence. Limited to ${getOfferProductTypeLabel(productType).toLowerCase()}, as set above.`
          : `Search and add the aircraft this role works on. Limited to ${getOfferProductTypeLabel(productType).toLowerCase()}, as set above.`}
      </Text>

      {value.map((h, index) => (
        <View key={h.aircraftTypeRatingId} style={styles.row}>
          <View style={styles.rowInfo}>
            <Text style={styles.rowText}>
              {licenseCode ? `${licenseCode} + ` : ''}
              {getAircraftTypeRatingLabel(h.aircraftTypeRatingId, labelIndex)}
            </Text>
            {h.notes ? <Text style={styles.rowNotes}>{h.notes}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => removeRow(index)} accessibilityRole="button">
            <Text style={styles.removeText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}
      {value.length === 0 ? <Text style={styles.emptyText}>No aircraft yet.</Text> : null}

      {/* Paso 6 del formulario: una casilla pequeña BAJO la lista, no un paso
          propio. Sólo tiene sentido con dos o más aeronaves — con una sola,
          "basta con una" y "hacen falta todas" dicen lo mismo, y preguntarlo
          sería pedirle a la empresa que decida algo que no cambia nada. */}
      {value.length > 1 ? (
        <TouchableOpacity
          style={styles.requiresAllRow}
          onPress={() => onChangeRequiresAll(!requiresAll)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: requiresAll }}
        >
          <View style={[styles.checkbox, requiresAll && styles.checkboxOn]}>
            {requiresAll ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.requiresAllText}>
            The technician needs ALL of these aircraft, not just one of them
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.addBlock}>
        <Text style={styles.fieldLabel}>Aircraft + engine rating</Text>
        <AircraftTypeRatingPicker
          value={newRatingId}
          onSelect={(r) => setNewRatingId(r.id)}
          lockedProductType={{ productType, reason: 'this offer is for ' + getOfferProductTypeLabel(productType).toLowerCase() }}
        />

        <Text style={styles.fieldLabel}>Note (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Also considering V2500 or recent A320 experience"
          placeholderTextColor={companyUi.textMuted}
          value={newNotes}
          onChangeText={setNewNotes}
        />

        <TouchableOpacity
          style={[styles.addButton, !newRatingId && styles.addButtonDisabled]}
          onPress={addRow}
          disabled={!newRatingId}
          activeOpacity={0.75}
        >
          <Text style={styles.addButtonText}>Add aircraft</Text>
        </TouchableOpacity>
      </View>
    </CompanyCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: companyUi.text },
  subtitle: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: companyUi.textSoft },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: companyUi.borderSoft,
  },
  rowInfo: { flex: 1, minWidth: 0, gap: 2 },
  rowText: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: companyUi.text },
  rowNotes: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: companyUi.textSoft },
  requiresAllRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: companyUi.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: companyUi.accent, backgroundColor: companyUi.accentSoft },
  checkboxMark: { fontSize: 12, lineHeight: 14, fontWeight: '700', color: companyUi.accent },
  requiresAllText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontWeight: '600', color: companyUi.textSoft },
  levelToggle: { flexDirection: 'row', gap: 6 },
  levelPill: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  levelPillOff: { borderColor: companyUi.border, backgroundColor: companyUi.surfaceSoft },
  levelPillMandatoryOn: { borderColor: companyUi.red, backgroundColor: companyUi.redSoft },
  levelPillPreferredOn: { borderColor: companyUi.blue, backgroundColor: companyUi.blueSoft },
  levelPillText: { fontSize: 11, fontWeight: '700' },
  levelPillTextOff: { color: companyUi.textMuted },
  levelPillTextMandatoryOn: { color: companyUi.red },
  levelPillTextPreferredOn: { color: companyUi.blue },
  removeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: companyUi.red },
  emptyText: { fontSize: 13, lineHeight: 18, fontWeight: '500', color: companyUi.textMuted },
  addBlock: { gap: spacing.xs, marginTop: spacing.xs },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: companyUi.textSoft, marginTop: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: companyUi.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: companyUi.text,
    backgroundColor: companyUi.surfaceSoft,
  },
  addButton: {
    marginTop: spacing.xs,
    borderRadius: 14,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: companyUi.accentSoft,
  },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { fontSize: 13, fontWeight: '700', color: companyUi.accent },
});
