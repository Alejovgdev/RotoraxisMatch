import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { TechnicianCard, techUi } from './TechnicianUI';
import { AircraftTypeRatingPicker } from '../AircraftTypeRatingPicker';
import { AircraftRatingIndex, getAircraftTypeRatingLabel } from '../../constants/aircraftTypeRatings';
import { AircraftTypeRatingCatalog } from '../../types/catalog';

export interface AircraftExperienceRow {
  id?: string;
  aircraftTypeRatingId: string;
  years?: number;
  /** 094: ha firmado trabajo en esta aeronave. Sólo con FAA A o A&P. */
  signed?: boolean;
}

interface Props {
  value: AircraftExperienceRow[];
  onChange: (next: AircraftExperienceRow[]) => void;
  /**
   * 094: la etiqueta del check de firma (signOffLabel), o null. Sólo hay
   * etiqueta si el técnico tiene FAA A o A&P (guardada o no); sin ella ni el
   * check ni la nota aparecen, y la base rechaza la firma igualmente.
   */
  signOffLabel: string | null;
  /**
   * Ratings en los que el técnico YA tiene habilitación (Fase 6 tanda E).
   *
   * No se ofrecen aquí: una habilitación ya demuestra experiencia en esa
   * aeronave (regla "la licencia cuenta también como experiencia"), así que
   * declararla otra vez no añade nada y sí crea la ambigüedad de tener DOS
   * cifras de años para el mismo avión. Cortarlo en el editor hace que esa
   * ambigüedad casi nunca llegue a existir; la regla de desempate del scorer
   * queda sólo para los datos que ya la tuvieran.
   */
  habilitatedRatingIds: readonly string[];
  /** Resuelve labels de los ratings referenciados, activos e inactivos. Propiedad del padre, igual que en HabilitationsEditor. */
  ratingsById: AircraftRatingIndex;
  onRatingResolved: (rating: AircraftTypeRatingCatalog) => void;
  onRequestCatalog: () => void;
}

// Fase 6 tanda B — la contrapartida sin licencia de HabilitationsEditor.
//
// Deliberadamente MÁS POBRE que aquél, y ésa es la feature: sólo aeronave y
// años. Sin categoría de licencia, sin fechas de emisión/caducidad y sin
// interruptor de vigencia, porque ninguna de esas cosas existe cuando no hay
// licencia detrás. Añadirlas "por simetría" sería pedirle al técnico datos
// que no tiene — el mismo error que cometía el eje Part-66 cuando se le
// enseñaba a un pintor.
//
// SIN `categoryHint` NI `lockedProductType` en el picker, a propósito: el
// catálogo entero está disponible. Un técnico puede haber trabajado en
// aviones Y en helicópteros, y acotar el producto aquí sería confundir una
// restricción de la OFERTA (que sí es de un producto, migración 047) con una
// propiedad de la PERSONA, que no lo es.
export function AircraftExperienceEditor({
  value,
  onChange,
  signOffLabel,
  habilitatedRatingIds,
  ratingsById,
  onRatingResolved,
  onRequestCatalog,
}: Props) {
  const [newRating, setNewRating] = useState<string | null>(null);
  const [newYears, setNewYears] = useState('');

  const alreadyHabilitated = newRating !== null && habilitatedRatingIds.includes(newRating);

  function addExperience() {
    if (!newRating || alreadyHabilitated) return;
    // La UNIQUE (technician_id, aircraft_type_rating_id) rechazaría el
    // duplicado en Postgres; se corta aquí para que el técnico vea que no
    // pasa nada en vez de un error al guardar, mucho después del gesto.
    if (value.some((e) => e.aircraftTypeRatingId === newRating)) return;
    const trimmed = newYears.trim();
    onChange([...value, { aircraftTypeRatingId: newRating, years: trimmed ? Number(trimmed) : undefined }]);
    setNewRating(null);
    setNewYears('');
  }

  function removeExperience(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function toggleSigned(index: number) {
    onChange(value.map((e, i) => (i === index ? { ...e, signed: !e.signed } : e)));
  }

  const alreadyDeclared = newRating !== null && value.some((e) => e.aircraftTypeRatingId === newRating);

  return (
    <TechnicianCard style={styles.card}>
      <Text style={styles.title}>Aircraft experience</Text>
      <Text style={styles.subtitle}>
        Aircraft you have worked on. No licence needed — this says you know the work, not that you
        are authorised to sign it off.
      </Text>
      {/* Dónde cuenta la firma, sin invitar a marcarla. */}
      {signOffLabel ? (
        <Text style={styles.note}>
          Sign-off only counts on EASA, UK CAA, CASA or UAE GCAA offers that also accept the FAA: there, an aircraft you
          have signed off on counts as a type rating. FAA offers count your type ratings and all your declared aircraft
          experience, signed off or not.
        </Text>
      ) : null}

      {value.length === 0 ? <Text style={styles.emptyValue}>Not specified</Text> : null}

      {value.map((e, index) => (
        <View key={e.id ?? `new-${e.aircraftTypeRatingId}`} style={styles.item}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemRating}>{getAircraftTypeRatingLabel(e.aircraftTypeRatingId, ratingsById)}</Text>
            {/* `!= null` y no un truthy check: 0 años declarados es una
                declaración y se muestra; "no declarado" es undefined. */}
            <Text style={styles.itemYears}>
              {e.years != null ? `${e.years} years` : 'Years not specified'}
            </Text>
            {/* 094: sólo con FAA A o A&P. */}
            {signOffLabel ? (
              <TouchableOpacity
                style={styles.signedRow}
                onPress={() => toggleSigned(index)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: Boolean(e.signed) }}
                accessibilityLabel={signOffLabel}
                activeOpacity={0.75}
              >
                <View style={[styles.signedBox, e.signed && styles.signedBoxOn]}>
                  {e.signed ? <Text style={styles.signedMark}>✓</Text> : null}
                </View>
                <Text style={styles.signedLabel}>{signOffLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity onPress={() => removeExperience(index)} accessibilityRole="button">
            <Text style={styles.itemRemove}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={styles.fieldGap} />
      <Text style={styles.fieldLabel}>Add aircraft</Text>
      <AircraftTypeRatingPicker
        value={newRating}
        onSelect={(r) => {
          setNewRating(r.id);
          onRatingResolved(r);
        }}
      />
      {alreadyDeclared ? (
        <Text style={styles.warning}>Already in your list. Remove it above to change the years.</Text>
      ) : null}
      {alreadyHabilitated ? (
        <Text style={styles.warning}>
          You already hold a type rating on this aircraft, which already proves you have worked on it. Add it above,
          under Habilitations, if you want to record the years.
        </Text>
      ) : null}

      <View style={styles.fieldGap} />
      <Text style={styles.fieldLabel}>Years on this aircraft (optional)</Text>
      <TextInput
        style={styles.input}
        value={newYears}
        onChangeText={(v) => setNewYears(v.replace(/[^0-9]/g, ''))}
        placeholder="e.g. 15"
        placeholderTextColor={techUi.textMuted}
        keyboardType="numeric"
        maxLength={2}
      />

      <View style={styles.fieldGap} />
      <TouchableOpacity
        style={[styles.addButton, (!newRating || alreadyDeclared || alreadyHabilitated) && styles.addButtonDisabled]}
        onPress={addExperience}
        disabled={!newRating || alreadyDeclared || alreadyHabilitated}
        activeOpacity={0.75}
      >
        <Text style={styles.addButtonText}>Add aircraft</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onRequestCatalog} style={styles.linkRow}>
        <Text style={styles.linkText}>Can&apos;t find your aircraft? Request it.</Text>
      </TouchableOpacity>
    </TechnicianCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: techUi.text },
  subtitle: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: techUi.textSoft },
  note: { fontSize: 11, lineHeight: 15, fontWeight: '500', color: techUi.textMuted },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.textSoft, marginTop: spacing.xs },
  fieldGap: { height: spacing.sm },
  emptyValue: { fontSize: 13, lineHeight: 18, fontWeight: '500', color: techUi.textMuted },
  warning: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: techUi.textMuted, marginTop: spacing.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: techUi.borderSoft,
  },
  itemInfo: { flex: 1, minWidth: 0, gap: 3 },
  itemRating: { fontSize: 13, lineHeight: 17, fontWeight: '700', color: techUi.text },
  itemYears: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: techUi.textSoft },
  itemRemove: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.red },
  signedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2, alignSelf: 'flex-start' },
  signedBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: techUi.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: techUi.surfaceSoft,
  },
  signedBoxOn: { borderColor: techUi.accent, backgroundColor: techUi.accent },
  signedMark: { fontSize: 11, lineHeight: 13, fontWeight: '800', color: colors.white },
  signedLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: techUi.textSoft },
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
