import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { CompanyCard, companyUi } from './CompanyUI';
import { AircraftTypeRatingPicker } from '../AircraftTypeRatingPicker';
import { useAircraftTypeRatingsCatalog } from '../../state/useAircraftTypeRatingsCatalog';
import { catalogRepository } from '../../repositories/v2/catalogRepository';
import { AircraftRatingIndex, buildAircraftRatingIndex, getAircraftTypeRatingLabel } from '../../constants/aircraftTypeRatings';
import { getOfferProductTypeLabel } from '../../constants/offerProductTypes';
import { AuthorityLicenseCode } from '../../types/catalog';
import { OfferProductType } from '../../types/offer';
import { AircraftRequirementsCopy } from '../../utils/offerFormRules';

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
  // Sesión 2: bajo la FAA las aeronaves son experiencia, no type ratings de la
  // licencia (offerAircraftAreExperience). Quita el prefijo "A&P + " de las
  // filas, que prometería un rating que la FAA no emite.
  asExperience?: boolean;
  // Título, subtítulo y etiqueta de fila según con qué se compara cada
  // aeronave (aircraftRequirementsCopy).
  copy: AircraftRequirementsCopy;
  // ¿Basta con una de las aeronaves, o hacen falta todas? La casilla vive
  // BAJO la lista (paso 6 del formulario), no como un paso propio.
  requiresAll: boolean;
  onChangeRequiresAll: (next: boolean) => void;
}

// Fase 3b screen 1 — the PRIMARY requirements block on the offer form
// (shared by new.tsx and edit.tsx so the two screens can no longer drift,
// which they had — see commit message). Search-and-add via
// AircraftTypeRatingPicker, locked to the offer's product type. Each row is
// one aircraft with a small tag saying what it is matched against ("Type
// rating" or "Experience", from aircraftRequirementsCopy) and a Remove
// action. Whether ONE aircraft is enough or ALL are needed is a single
// offer-level checkbox under the list (requiresAllAircraft), not a per-row
// level: Fase 6 tanda D removed the per-row Mandatory/Preferred badge.
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
  asExperience = false,
  copy,
  requiresAll,
  onChangeRequiresAll,
}: Props) {
  const rowLicense = asExperience ? undefined : licenseCode;
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
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.subtitle}>{copy.subtitle}</Text>

      {value.map((h, index) => (
        <View key={h.aircraftTypeRatingId} style={styles.row}>
          <View style={styles.rowInfo}>
            <Text style={styles.rowText}>
              {rowLicense ? `${rowLicense} + ` : ''}
              {getAircraftTypeRatingLabel(h.aircraftTypeRatingId, labelIndex)}
            </Text>
            {h.notes ? <Text style={styles.rowNotes}>{h.notes}</Text> : null}
          </View>
          <View style={styles.rowTag}>
            <Text style={styles.rowTagText}>{copy.rowTag}</Text>
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
        <Text style={styles.fieldLabel}>{copy.pickerLabel}</Text>
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
  rowTag: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surfaceSoft,
  },
  rowTagText: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: companyUi.textSoft },
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
  removeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: companyUi.red },
  emptyText: { fontSize: 13, lineHeight: 18, fontWeight: '500', color: companyUi.textMuted },
  addBlock: { gap: spacing.xs, marginTop: spacing.xs },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: companyUi.textSoft, marginTop: spacing.xs },
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
