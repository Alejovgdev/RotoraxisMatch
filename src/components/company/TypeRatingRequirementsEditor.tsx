import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text, TextInput } from '../ui';
import { colors } from '../../theme';
import { AircraftTypeRatingPicker } from '../AircraftTypeRatingPicker';
import { useAircraftTypeRatingsCatalog } from '../../state/useAircraftTypeRatingsCatalog';
import { catalogRepository } from '../../repositories/v2/catalogRepository';
import { AircraftRatingIndex, buildAircraftRatingIndex, getAircraftTypeRatingLabel } from '../../constants/aircraftTypeRatings';
import { getOfferProductTypeLabel } from '../../constants/offerProductTypes';
import { AuthorityLicenseCode } from '../../types/catalog';
import { OfferProductType } from '../../types/offer';
import { AircraftRequirementsCopy } from '../../utils/offerFormRules';
import { PillButton } from './CompanyPage';
import { WizardHeading, WizardLabel, WizardSwitchCard, wizardInputStyles } from './OfferWizardParts';

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
  /** Escritorio: el título del paso a 26 px (maqueta W-D-Post). */
  large?: boolean;
}

/**
 * Las etiquetas de unas aeronaves: el catálogo activo y, para las que no estén
 * en él (una oferta vieja puede pedir una fila desactivada), una consulta por
 * id. Lo usan el editor y la revisión del asistente.
 */
export function useAircraftRatingLabelIndex(ids: readonly string[]): AircraftRatingIndex {
  const { ratingIndex: activeRatingIndex } = useAircraftTypeRatingsCatalog();
  const [resolvedIndex, setResolvedIndex] = useState<AircraftRatingIndex>(new Map());
  const key = ids.join('|');

  useEffect(() => {
    const wanted = key ? key.split('|') : [];
    if (wanted.length === 0) {
      setResolvedIndex(new Map());
      return;
    }
    let cancelled = false;
    catalogRepository.getAircraftTypeRatingsByIds(wanted).then((ratings) => {
      if (!cancelled) setResolvedIndex(buildAircraftRatingIndex(ratings));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return useMemo(() => new Map([...activeRatingIndex, ...resolvedIndex]), [activeRatingIndex, resolvedIndex]);
}

// Fase 3b screen 1 — the PRIMARY requirements block on the offer form
// (shared by new.tsx and edit.tsx so the two screens can no longer drift,
// which they had — see commit message). Search-and-add via
// AircraftTypeRatingPicker, locked to the offer's product type. Each row is
// one aircraft with a small tag saying what it is matched against ("Type
// rating" or "Experience", from aircraftRequirementsCopy) and a Remove
// action. Whether ONE aircraft is enough or ALL are needed is a single
// offer-level switch under the list (requiresAllAircraft), not a per-row
// level: Fase 6 tanda D removed the per-row Mandatory/Preferred badge.
//
// Resolves rating labels for every referenced id itself (including
// inactive ones an existing offer might reference), through
// useAircraftRatingLabelIndex.
//
// Migración 047 — el filtro se toma del producto de la OFERTA, no de la
// licencia de cada fila como hasta ahora. La versión anterior derivaba el
// facet de `getCompatibleProductType(newLicense)` (hoy
// `getLicenseRatingProductType`, y entonces B2/B2L/C/L devolvían todas
// undefined): con B2 seleccionada no se filtraba NADA. Por ese agujero
// entraron ofertas tituladas "Helicópteros" con requisitos B1.1/B1.2. Ahora
// el producto lo declara la empresa una sola vez y acota las dos listas.
//
// Rediseño, fase 4: es el paso 3 del asistente (maqueta W-Post3). Mismo
// recorrido que antes —elegir, nota opcional y "Add aircraft"—; cambia el
// aspecto.
export function TypeRatingRequirementsEditor({
  value,
  onChange,
  productType,
  licenseCode,
  asExperience = false,
  copy,
  requiresAll,
  onChangeRequiresAll,
  large = false,
}: Props) {
  const rowLicense = asExperience ? undefined : licenseCode;
  const labelIndex = useAircraftRatingLabelIndex(value.map((h) => h.aircraftTypeRatingId));

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
    <View style={styles.wrap}>
      <WizardHeading title={copy.title} helper={copy.subtitle} large={large} />

      <View style={styles.rows}>
        {value.map((h, index) => {
          const label = `${rowLicense ? `${rowLicense} + ` : ''}${getAircraftTypeRatingLabel(h.aircraftTypeRatingId, labelIndex)}`;
          return (
            <View key={h.aircraftTypeRatingId} style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowText}>{label}</Text>
                <Text style={styles.rowTag}>{copy.rowTag}</Text>
                {h.notes ? <Text style={styles.rowNotes}>{h.notes}</Text> : null}
              </View>
              <Pressable
                onPress={() => removeRow(index)}
                style={({ pressed, hovered }: any) => [styles.remove, (pressed || hovered) && styles.removePressed]}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${label}`}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          );
        })}
        {value.length === 0 ? <Text style={styles.emptyText}>No aircraft yet.</Text> : null}
      </View>

      {/* Paso 6 del formulario: un interruptor BAJO la lista, no un paso
          propio. Sólo tiene sentido con dos o más aeronaves — con una sola,
          "basta con una" y "hacen falta todas" dicen lo mismo, y preguntarlo
          sería pedirle a la empresa que decida algo que no cambia nada. */}
      {value.length > 1 ? (
        <WizardSwitchCard
          label="The technician needs ALL of these aircraft, not just one of them"
          value={requiresAll}
          onChange={onChangeRequiresAll}
        />
      ) : null}

      <View style={styles.addBlock}>
        <WizardLabel>{copy.pickerLabel}</WizardLabel>
        <AircraftTypeRatingPicker
          value={newRatingId}
          onSelect={(r) => setNewRatingId(r.id)}
          lockedProductType={{ productType, reason: 'this offer is for ' + getOfferProductTypeLabel(productType).toLowerCase() }}
        />

        <View style={wizardInputStyles.field}>
          <WizardLabel>Note (optional)</WizardLabel>
          <TextInput
            style={wizardInputStyles.input}
            placeholder="e.g. Also considering V2500 or recent A320 experience"
            placeholderTextColor={colors.placeholder}
            value={newNotes}
            onChangeText={setNewNotes}
          />
        </View>

        <View style={styles.addButton}>
          <PillButton label="Add aircraft" variant="accent" size="md" onPress={addRow} disabled={!newRatingId} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  rows: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  rowInfo: { flex: 1, minWidth: 0, gap: 1 },
  rowText: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  rowTag: { fontSize: 12.5, fontWeight: '700', color: '#2E4C66' },
  rowNotes: { fontSize: 12.5, color: colors.textSecondary },
  remove: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  removePressed: { backgroundColor: colors.errorSoft },
  removeText: { fontSize: 13.5, fontWeight: '800', color: colors.error },
  emptyText: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSoft,
    fontSize: 14,
    color: colors.textSecondary,
  },
  addBlock: { gap: 10 },
  addButton: { alignItems: 'flex-start' },
});
