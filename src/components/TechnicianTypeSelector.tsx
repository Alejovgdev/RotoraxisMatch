import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { notify } from '../utils/platformAlert';
import { TechnicianTypeOption } from '../auth/useCatalogOptions';

/**
 * Selección MÚLTIPLE de tipos de perfil de técnico (Fase 6 tanda A).
 *
 * Un único componente para el alta (`app/auth/signup/technician.tsx`) y para
 * el perfil (`app/technician/profile.tsx`), a propósito: son el mismo campo
 * en dos momentos distintos, y cuando cada pantalla tenía su propio control
 * (picker de un solo valor en el alta, chips en el perfil) también tenían su
 * propia idea de qué es válido. La regla del mínimo de uno vive AQUÍ DENTRO,
 * no en cada pantalla, para que no pueda divergir.
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
  text: '#1A2332',
  muted: '#94A3B8',
  border: '#E2E8F0',
  surface: '#FFFFFF',
  accent: '#2563EB',
  accentText: '#2563EB',
  accentSurface: '#2563EB1A',
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

  function toggle(code: string) {
    const isSelected = selected.includes(code);
    if (!isSelected) {
      onChange([...selected, code]);
      return;
    }
    // Implicado por una licencia declarada. Se avisa por el mismo motivo que
    // el mínimo de uno, justo abajo: el chip está deshabilitado, pero un
    // toque sin respuesta parece la app rota y no una regla — y aquí además
    // hay que decir DÓNDE se quita, que no es en esta sección.
    if (locked.has(code)) {
      const label = options.find((o) => o.code === code)?.label ?? code;
      notify(
        `${label} comes from your licences`,
        'You hold a licence of this trade, so the type stays while you declare it. Remove that licence in the Licenses section and this comes off with it.',
      );
      return;
    }
    // Mínimo uno. Se avisa en vez de dejar el toque sin efecto: un chip que
    // no responde parece la app rota, no una regla.
    if (selected.length === 1) {
      notify(
        'Keep at least one profile type',
        'Your profile needs at least one type. Select another one first, then remove this.',
      );
      return;
    }
    onChange(selected.filter((c) => c !== code));
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
