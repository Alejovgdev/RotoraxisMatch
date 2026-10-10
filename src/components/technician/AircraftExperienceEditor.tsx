import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Plane } from 'lucide-react-native';
import {
  AddRow,
  CheckboxRow,
  ExperienceItem,
  RemoveLink,
  WorkNote,
  WorkSectionHeader,
} from './WorkParts';
import { AircraftRatingIndex, getAircraftTypeRatingLabel } from '../../constants/aircraftTypeRatings';
import type { AircraftExperienceRow } from '../../types/technicianProfileEdit';

// La fila vivía aquí; ahora vive en src/types/technicianProfileEdit.ts.
export type { AircraftExperienceRow } from '../../types/technicianProfileEdit';

interface Props {
  value: AircraftExperienceRow[];
  onChange: (next: AircraftExperienceRow[]) => void;
  /**
   * 094: la etiqueta del check de firma (signOffLabel), o null. Sólo hay
   * etiqueta si el técnico tiene FAA A o A&P (guardada o no); sin ella ni el
   * check ni la nota aparecen, y la base rechaza la firma igualmente.
   */
  signOffLabel: string | null;
  /** Resuelve labels de los ratings referenciados, activos e inactivos. Propiedad del padre. */
  ratingsById: AircraftRatingIndex;
  /** "Add aircraft experience": abre el asistente del "+" (fase 6B). */
  onAdd: () => void;
}

// Fase 6 tanda B — la contrapartida sin licencia de las habilitaciones. Con el
// estilo del rediseño desde la fase 6A (maqueta T-Quals).
//
// Desde la 6B aquí sólo se EDITA lo que hay (la firma) y se QUITA; añadir es
// el asistente del "+" (app/technician/add/aircraft.tsx), con las mismas
// reglas que tenía este editor: ni la misma aeronave dos veces ni una en la que
// ya hay type rating.
//
// Deliberadamente MÁS POBRE que las habilitaciones, y ésa es la feature: sólo
// aeronave y años. Sin categoría de licencia, sin fechas de emisión/caducidad y
// sin interruptor de vigencia, porque ninguna de esas cosas existe cuando no
// hay licencia detrás.
export function AircraftExperienceEditor({ value, onChange, signOffLabel, ratingsById, onAdd }: Props) {
  function removeExperience(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function toggleSigned(index: number) {
    onChange(value.map((e, i) => (i === index ? { ...e, signed: !e.signed } : e)));
  }

  return (
    <View style={styles.section}>
      <WorkSectionHeader
        title="Aircraft experience"
        subtitle="Aircraft you have worked on. No licence needed — this says you know the work, not that you are authorised to sign it off."
      />
      {/* Dónde cuenta la firma, sin invitar a marcarla. */}
      {signOffLabel ? (
        <WorkNote>
          Sign-off only counts on EASA, UK CAA, CASA or UAE GCAA offers that also accept the FAA: there, an aircraft you
          have signed off on counts as a type rating. FAA offers count your type ratings and all your declared aircraft
          experience, signed off or not.
        </WorkNote>
      ) : null}

      {value.length === 0 ? <WorkNote>None added yet.</WorkNote> : null}

      {value.map((e, index) => {
        const label = getAircraftTypeRatingLabel(e.aircraftTypeRatingId, ratingsById);
        // `!= null` y no un truthy check: 0 años declarados es una
        // declaración y se muestra; "no declarado" es undefined.
        const years = e.years != null ? `${e.years} years` : 'Years not specified';
        return (
          <ExperienceItem
            key={e.id ?? `new-${e.aircraftTypeRatingId}`}
            icon={Plane}
            title={label}
            subtitle={years}
            trailing={<RemoveLink onPress={() => removeExperience(index)} accessibilityLabel={`Remove ${label}`} />}
          >
            {/* 094: sólo con FAA A o A&P. */}
            {signOffLabel ? (
              <CheckboxRow label={signOffLabel} checked={Boolean(e.signed)} onPress={() => toggleSigned(index)} />
            ) : null}
          </ExperienceItem>
        );
      })}

      <AddRow label="Add aircraft experience" onPress={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
});
