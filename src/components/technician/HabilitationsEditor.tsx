import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Chip, StatusChip, Text } from '../ui';
import { colors } from '../../theme';
import { TOUCH_TARGET } from '../../theme/ui';
import { DateField } from '../DateField';
import { RemoveLink, workStyles } from './WorkParts';
import { AircraftRatingIndex, getAircraftTypeRatingLabel } from '../../constants/aircraftTypeRatings';
import { individualTypeRatingScopeError } from '../../utils/individualTypeRatingScope';
import { EngineIndex } from '../../constants/engines';
import { EnginesLoadState } from '../../state/useEnginesCatalog';
import { credentialLabel } from '../../constants/licenses';
import { formatProfileDate } from '../../utils/technicianWork';
import type { HabilitationRow } from '../../types/technicianProfileEdit';

// Las habilitaciones del técnico (type ratings), con el estilo del rediseño
// (fase 6A; maqueta T-Quals). Antes era UN editor —lista y formulario de
// añadir en la misma tarjeta—. Desde la 6B queda HabilitationItem, que My work
// pone DENTRO de la tarjeta de su licencia: una habilitación; al tocarla se
// abren sus fechas, "Current / Not current" y "Remove". Añadir es el asistente
// del "+" (app/technician/add/type-rating.tsx), con las reglas que tenía el
// formulario: cada rating va con la credencial de la que cuelga —nunca
// adivinada—, sólo se ofrecen aeronaves y propulsión que esa credencial cubre
// (individualTypeRatingScope; la 083 lo vigila también en la base) y no se
// añade dos veces el mismo. Una habilitación existente fuera de alcance se
// queda visible con su aviso, sin borrarse sola.
//
// Paso 5b: la fila vivía aquí; ahora vive en src/types/technicianProfileEdit.ts.
export type { HabilitationRow } from '../../types/technicianProfileEdit';

// Fase 5.3 (2026-07-28): LegacyHabilitationRow and the read-only "Legacy" /
// "Needs review" section that rendered it are GONE, together with the
// pre-Part-66 aircraft_types catalog they described.

function itemLine(h: HabilitationRow): string {
  const parts: string[] = [];
  if (h.issuedAt) parts.push(`Issued ${formatProfileDate(h.issuedAt)}`);
  if (h.expiresAt) parts.push(`Expires ${formatProfileDate(h.expiresAt)}`);
  if (h.experienceYears) parts.push(`${h.experienceYears} years`);
  return parts.join(' · ');
}

/** Una habilitación dentro de la tarjeta de su licencia. */
export function HabilitationItem({
  habilitation: h,
  ratingsById,
  engineIndex,
  engineState,
  onChange,
  onRemove,
  showCredential = false,
}: {
  habilitation: HabilitationRow;
  ratingsById: AircraftRatingIndex;
  engineIndex: EngineIndex;
  engineState: EnginesLoadState;
  onChange: (patch: Partial<Pick<HabilitationRow, 'issuedAt' | 'expiresAt' | 'isCurrent'>>) => void;
  onRemove: () => void;
  /** Fuera de su tarjeta (licencia quitada): dice de qué credencial cuelga. */
  showCredential?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rating = ratingsById.get(h.aircraftTypeRatingId);
  const scopeError = rating ? individualTypeRatingScopeError(h.authority, h.licenseCode, rating, engineIndex) : null;
  const label = getAircraftTypeRatingLabel(h.aircraftTypeRatingId, ratingsById);
  const line = itemLine(h);
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <View style={styles.item}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed, hovered }: any) => [styles.itemHead, (pressed || hovered) && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}. ${open ? 'Hide details' : 'Edit dates or remove'}`}
      >
        <View style={styles.itemCopy}>
          {showCredential ? <Text style={styles.itemCredential}>{credentialLabel(h.authority, h.licenseCode)}</Text> : null}
          <Text style={styles.itemTitle}>{label}</Text>
          <View style={styles.badges}>
            <StatusChip label={h.isCurrent === false ? 'Not current' : 'Current'} tone={h.isCurrent === false ? 'closed' : 'success'} />
            <StatusChip label="Declared" tone="muted" />
            {rating?.isActive === false ? <StatusChip label="Inactive catalog entry" tone="warning" /> : null}
            {scopeError && engineState === 'success' ? <StatusChip label="Review licence / aircraft scope" tone="warning" /> : null}
          </View>
          {line ? <Text style={styles.itemLine}>{line}</Text> : null}
        </View>
        <Chevron color={colors.textMuted} size={18} strokeWidth={2} />
      </Pressable>

      {open ? (
        <View style={styles.itemDetails}>
          <View style={workStyles.dates}>
            <View style={workStyles.dateField}>
              <Text style={workStyles.dateLabel}>Issued</Text>
              <DateField value={h.issuedAt} onChange={(v) => onChange({ issuedAt: v })} placeholder="Not set" />
            </View>
            <View style={workStyles.dateField}>
              <Text style={workStyles.dateLabel}>Expires</Text>
              <DateField value={h.expiresAt} onChange={(v) => onChange({ expiresAt: v })} placeholder="Not set" />
            </View>
          </View>
          <View style={workStyles.chipRow}>
            <Chip label="Current" selected={h.isCurrent !== false} onPress={() => onChange({ isCurrent: true })} />
            <Chip label="Not current" selected={h.isCurrent === false} onPress={() => onChange({ isCurrent: false })} />
          </View>
          <RemoveLink label="Remove type rating" onPress={onRemove} accessibilityLabel={`Remove ${label}`} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  itemHead: {
    minHeight: TOUCH_TARGET + 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  pressed: {
    backgroundColor: colors.surfaceSoft,
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  itemCredential: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  itemTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.text,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemLine: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  itemDetails: {
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
});
