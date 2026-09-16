import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';

function scoreColor(total: number): string {
  if (total >= 80) return colors.success;
  if (total >= 60) return colors.blue;
  if (total >= 40) return colors.warning;
  return colors.textMuted;
}

interface InlineScoreProps {
  score: number;
  quality: string;
  context: string;
  // Hard blockers describe eligibility, not score quality. In that state the
  // UI must lead with an explicit label instead of inviting the user to
  // interpret a deliberately capped percentage.
  notEligible?: boolean;
  // Paso 5b: por qué no es elegible, cuando NO es un requisito duro sino el
  // filtro de la oferta (oferta de motor sin experiencia de motor, "sólo sin
  // licencia" con licencia). Sustituye a la línea genérica de abajo.
  notEligibleReason?: string;
}

export function InlineScore({ score, quality, context, notEligible = false, notEligibleReason }: InlineScoreProps) {
  const color = notEligible ? colors.error : scoreColor(score);
  return (
    <View style={[styles.wrap, { borderLeftColor: color }]}>
      <View style={styles.row}>
        {notEligible ? (
          <Text style={[styles.number, { color }]}>Not eligible</Text>
        ) : (
          <>
            <Text style={[styles.number, { color }]}>{score}%</Text>
            <Text style={[styles.quality, { color }]}>{quality}</Text>
          </>
        )}
      </View>
      <Text style={styles.context}>
        {notEligible ? (notEligibleReason ?? 'Does not meet a hard requirement of the offer') : context}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderLeftWidth: 3,
    paddingLeft: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginBottom: 2,
  },
  number: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  quality: {
    fontSize: 13,
    fontWeight: '600',
  },
  context: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
