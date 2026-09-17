import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { TechnicianCard, techUi } from './TechnicianUI';
import { EnginePicker } from '../EnginePicker';
import { getEngineLabel } from '../../constants/engines';
import { useEnginesCatalog } from '../../state/useEnginesCatalog';

export interface EngineExperienceRow {
  id?: string;
  engineId: string;
  years?: number;
}

interface Props {
  value: EngineExperienceRow[];
  onChange: (next: EngineExperienceRow[]) => void;
}

// Fase 10, paso 5b — los motores en los que el técnico ha trabajado
// (technician_engine_experience, migración 068).
//
// Misma forma que AircraftExperienceEditor, y por lo mismo: motor y años, sin
// licencia, sin fechas. Abierto a cualquier técnico. Declarar un motor es lo
// que hace a un técnico elegible para CUALQUIER oferta de motor (vía (a)) y el
// escalón más alto de la escalera cuando es el motor pedido. Los años se
// guardan y se enseñan, pero no puntúan.
//
// No hace falta declarar aquí el motor de un type rating B1: ése ya cuenta
// solo (vía (b) y escalón "por type rating"). Declararlo lo sube al escalón
// de "declarado", que es la diferencia entre decir "lo tengo en la licencia" y
// "he trabajado en él".
export function EngineExperienceEditor({ value, onChange }: Props) {
  const { engineIndex } = useEnginesCatalog();
  const [newEngine, setNewEngine] = useState<string | null>(null);
  const [newYears, setNewYears] = useState('');

  const alreadyDeclared = newEngine !== null && value.some((e) => e.engineId === newEngine);
  const invalidYears = newYears.trim() !== '' && (!Number.isFinite(Number(newYears)) || Number(newYears) < 0 || Number(newYears) > 70);

  function addEngine() {
    // UNIQUE (technician_id, engine_id) en la 068: se corta aquí para que el
    // duplicado no llegue como error al guardar.
    if (!newEngine || alreadyDeclared || invalidYears) return;
    const trimmed = newYears.trim();
    onChange([...value, { engineId: newEngine, years: trimmed ? Number(trimmed) : undefined }]);
    setNewEngine(null);
    setNewYears('');
  }

  function removeEngine(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <TechnicianCard style={styles.card}>
      <Text style={styles.title}>Engine experience</Text>
      <Text style={styles.subtitle}>
        Engines you have worked on, with or without a licence. Engine offers are matched on these — and on the
        engines of your B1 type ratings.
      </Text>

      {value.length === 0 ? <Text style={styles.emptyValue}>Not specified</Text> : null}

      {value.map((e, index) => (
        <View key={e.id ?? `new-${e.engineId}`} style={styles.item}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemEngine}>{getEngineLabel(e.engineId, engineIndex)}</Text>
            <Text style={styles.itemYears}>{e.years != null ? `${e.years} years` : 'Years not specified'}</Text>
          </View>
          <TouchableOpacity onPress={() => removeEngine(index)} accessibilityRole="button">
            <Text style={styles.itemRemove}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={styles.fieldGap} />
      <Text style={styles.fieldLabel}>Add engine</Text>
      <EnginePicker value={newEngine} onSelect={(engine) => setNewEngine(engine.id)} excludeIds={value.map((e) => e.engineId)} />
      {alreadyDeclared ? <Text style={styles.warning}>Already in your list. Remove it above to change the years.</Text> : null}

      <View style={styles.fieldGap} />
      <Text style={styles.fieldLabel}>Years on this engine (optional)</Text>
      <TextInput
        style={styles.input}
        value={newYears}
        onChangeText={(v) => setNewYears(v.replace(/[^0-9]/g, ''))}
        placeholder="e.g. 6"
        placeholderTextColor={techUi.textMuted}
        keyboardType="numeric"
        maxLength={2}
      />
      {invalidYears ? <Text style={styles.warning}>Enter a number of years between 0 and 70.</Text> : null}
      <View style={styles.fieldGap} />
      <TouchableOpacity
        style={[styles.addButton, (!newEngine || alreadyDeclared || invalidYears) && styles.addButtonDisabled]}
        onPress={addEngine}
        disabled={!newEngine || alreadyDeclared || invalidYears}
        activeOpacity={0.75}
        accessibilityRole="button"
      >
        <Text style={styles.addButtonText}>Add engine</Text>
      </TouchableOpacity>
    </TechnicianCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: techUi.text },
  subtitle: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: techUi.textSoft },
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
  itemEngine: { fontSize: 13, lineHeight: 17, fontWeight: '700', color: techUi.text },
  itemYears: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: techUi.textSoft },
  itemRemove: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.red },
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
});
