import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AddRow, ExperienceItem, RemoveLink, WorkNote, WorkSectionHeader } from './WorkParts';
import { getEngineLabel } from '../../constants/engines';
import { useEnginesCatalog } from '../../state/useEnginesCatalog';
import type { EngineExperienceRow } from '../../types/technicianProfileEdit';

// La fila vivía aquí; ahora vive en src/types/technicianProfileEdit.ts.
export type { EngineExperienceRow } from '../../types/technicianProfileEdit';

interface Props {
  value: EngineExperienceRow[];
  onChange: (next: EngineExperienceRow[]) => void;
  /** "Add engine experience": abre el asistente del "+" (fase 6B). */
  onAdd: () => void;
}

// Fase 10, paso 5b — los motores en los que el técnico ha trabajado
// (technician_engine_experience, migración 068). Con el estilo del rediseño
// desde la fase 6A (maqueta T-Quals).
//
// Desde la 6B aquí sólo se ven y se QUITAN; añadir es el asistente del "+"
// (app/technician/add/engine.tsx), con las reglas que tenía este editor: el
// mismo motor no dos veces, años vacíos o de 0 a 70.
//
// Sólo para perfiles Engine Technician desde la sesión 4 (091): My work no lo
// pinta a nadie más (enseña la fila bloqueada), y la base rechaza los motores
// de quien no tenga el tipo. Un motor declarado es el escalón más alto de la
// escalera cuando es el motor pedido; los años se guardan y se enseñan, pero
// no puntúan.
export function EngineExperienceEditor({ value, onChange, onAdd }: Props) {
  const { engineIndex } = useEnginesCatalog();

  function removeEngine(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <View style={styles.section}>
      <WorkSectionHeader
        title="Engine experience"
        subtitle="Engines you have worked on, with or without a licence. Engine offers are matched on these — and on the engines of your B1 type ratings."
      />

      {value.length === 0 ? <WorkNote>None added yet.</WorkNote> : null}

      {value.map((e, index) => {
        const label = getEngineLabel(e.engineId, engineIndex);
        return (
          <ExperienceItem
            key={e.id ?? `new-${e.engineId}`}
            tile="ENG"
            title={label}
            subtitle={e.years != null ? `${e.years} years` : 'Years not specified'}
            trailing={<RemoveLink onPress={() => removeEngine(index)} accessibilityLabel={`Remove ${label}`} />}
          />
        );
      })}

      <AddRow label="Add engine experience" onPress={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
});
