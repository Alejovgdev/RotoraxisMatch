import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './ui/Text';
import { notify } from '../utils/platformAlert';
import { toggleProfileType } from '../utils/profileTypes';
import { TechnicianTypeOption } from '../auth/useCatalogOptions';

/**
 * Selección MÚLTIPLE de tipos de perfil de técnico (Fase 6 tanda A).
 *
 * Lo usa el alta (`app/auth/signup/technician.tsx`). El perfil lo usó hasta el
 * rediseño (fase 6A): desde entonces My work pinta sus propios chips
 * (ProfileTypeChips), pero con LA MISMA regla, `toggleProfileType`
 * (src/utils/profileTypes.ts). Cuando cada pantalla tenía su propio control
 * también tenía su propia idea de qué es válido; por eso la regla del mínimo
 * de uno vive en una función compartida y no en cada pantalla.
 *
 * Sin restricción de mezcla: se puede ser aviónico y pintor a la vez. Y el
 * tipo NUNCA limita lo que se puede declarar: el eje Part-66 se muestra
 * siempre, tenga el técnico los tipos que tenga.
 *
 * La relación con las licencias va en la dirección contraria y sólo en ésa
 * (2026-08-13): una licencia declarada IMPLICA su oficio, y ese tipo llega
 * aquí en `lockedCodes` — marcado y no desmarcable, porque se quita quitando
 * la licencia. Los tipos sin licencia (chapa, pintura, composite) siguen
 * siendo enteramente libres. El alta no pide licencias, así que allí
 * `lockedCodes` no llega nunca y el componente se comporta igual que antes.
 *
 * La `palette` es el mismo patrón que DateField: el alta es tema oscuro
 * (navy) y el perfil claro, y un componente compartido no puede traer sus
 * propios colores sin desentonar en uno de los dos.
 */

export interface TechnicianTypeSelectorPalette {
  text: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
  accentText: string;
  accentSurface: string;
}

export const DEFAULT_TECHNICIAN_TYPE_PALETTE: TechnicianTypeSelectorPalette = {
  text: '#0E1A2B',
  muted: '#66768A',
  border: '#D5DEE6',
  surface: '#FFFFFF',
  accent: '#0B6A9E',
  accentText: '#0B6A9E',
  accentSurface: '#E6F1F8',
};

export interface TechnicianTypeSelectorProps {
  options: TechnicianTypeOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  loading?: boolean;
  /**
   * Tipos IMPLICADOS por una licencia que el técnico sigue declarando: van
   * marcados y no se pueden desmarcar desde aquí. Quien los calcula es el
   * llamante (`typesImpliedByLicenses`), no este componente: aquí no se sabe
   * qué licencias hay, y duplicar el mapa Part-66 en la UI sería una segunda
   * definición que podría separarse de la primera.
   */
  lockedCodes?: readonly string[];
  /**
   * Una nota más, debajo de las de siempre, que decide el llamante (el perfil
   * la usa para la FAA A o A&P, que marcan Mechanic sin bloquearlo:
   * faaMechanicTypeNote). Sin ella, el componente se pinta igual que antes.
   */
  extraNote?: string | null;
  palette?: Partial<TechnicianTypeSelectorPalette>;
}

export function TechnicianTypeSelector({
  options,
  selected,
  onChange,
  loading = false,
  lockedCodes,
  extraNote,
  palette,
}: TechnicianTypeSelectorProps) {
  const p = { ...DEFAULT_TECHNICIAN_TYPE_PALETTE, ...palette };
  const locked = new Set(lockedCodes ?? []);

  // La regla (bloqueo por licencia y mínimo de uno) vive en
  // src/utils/profileTypes.ts, compartida con los chips de My work.
  function toggle(code: string) {
    const result = toggleProfileType(selected, code, [...locked], (c) => options.find((o) => o.code === c)?.label ?? c);
    if (result.kind === 'notice') {
      notify(result.title, result.message);
      return;
    }
    onChange(result.next);
  }

  if (loading) {
    return <Text style={[styles.note, { color: p.muted }]}>Loading profile types...</Text>;
  }

  // Catálogo vacío = fallo de carga, no "no hay tipos". Decirlo importa: sin
  // esto la pantalla enseña un hueco silencioso y el técnico no sabe si el
  // campo es opcional o está roto.
  if (options.length === 0) {
    return (
      <Text style={[styles.note, { color: p.muted }]}>
        Could not load the profile types. Check your connection and reload.
      </Text>
    );
  }

  return (
    <View>
      <View style={styles.row}>
        {options.map((opt) => {
          const isSelected = selected.includes(opt.code);
          const isLocked = locked.has(opt.code);
          return (
            <TouchableOpacity key={opt.code} onPress={() => toggle(opt.code)} activeOpacity={0.75}>
              <View
                style={[
                  styles.chip,
                  { borderColor: p.border, backgroundColor: p.surface },
                  isSelected && { borderColor: p.accent, backgroundColor: p.accentSurface },
                  isLocked && styles.chipLocked,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: p.muted },
                    isSelected && { color: p.accentText, fontWeight: '700' },
                  ]}
                >
                  {opt.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.note, { color: p.muted }]}>
        Select every type that describes your work — you can pick more than one. This does not
        limit what you can declare: licences and type ratings are always available.
      </Text>
      {locked.size > 0 ? (
        <Text style={[styles.note, { color: p.muted }]}>
          Types you hold a licence for are ticked and locked — remove the licence below and the
          type comes off with it.
        </Text>
      ) : null}
      {extraNote ? <Text style={[styles.note, { color: p.muted }]}>{extraNote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  // Deshabilitado, no apagado: el chip sigue marcado (el tipo ES suyo) y sólo
  // se atenúa para decir que no se toca desde aquí.
  chipLocked: { opacity: 0.7 },
  chipText: { fontSize: 13, fontWeight: '600' },
  note: { fontSize: 12, lineHeight: 17, marginTop: 8 },
});
