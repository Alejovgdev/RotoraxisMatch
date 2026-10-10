// La nota de un par oferta + técnico y sus barras, como en las maquetas
// W-Candidate y W-D-Candidate: "92% Excellent match" y una barra por eje con
// sus puntos ("Type rating 45/45").
//
// Sólo pinta: el score llega ya calculado por matchPair / las funciones de
// ranking, y las filas (qué ejes, con qué rótulo y qué máximo) las decide
// visibleBreakdownRows (src/utils/matchBreakdownRows.ts), como antes.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui';
import { colors } from '../../theme';
import { fonts } from '../../theme/fonts';
import type { MatchScore } from '../../types/matching';
import type { BreakdownRowSpec } from '../../utils/matchBreakdownRows';

const FULL = '#1F9D62';
const NONE = '#A9B6C3';
const TRACK = '#E6ECF1';

/** Los mismos umbrales que antes del rediseño (InlineScore, MatchBadge). */
export function matchScoreColor(total: number): string {
  if (total >= 80) return colors.success;
  if (total >= 60) return colors.info;
  if (total >= 40) return colors.warning;
  return colors.textMuted;
}

export function ScoreHeadline({
  total,
  label,
  notEligible = false,
  reason,
  wide = false,
}: {
  total: number;
  label: string;
  /** Requisito duro sin cumplir o par fuera del filtro: no se lee un porcentaje. */
  notEligible?: boolean;
  reason?: string;
  wide?: boolean;
}) {
  if (notEligible) {
    return (
      <View style={styles.headline}>
        <Text style={[styles.notEligible, wide && styles.notEligibleWide]}>Not eligible</Text>
        <Text style={styles.reason}>{reason ?? 'Does not meet a hard requirement of the offer'}</Text>
      </View>
    );
  }
  const color = matchScoreColor(total);
  return (
    <View style={styles.headlineRow}>
      <Text style={[styles.percent, wide && styles.percentWide, { color }]}>{total}%</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function BreakdownBars({ rows, score }: { rows: readonly BreakdownRowSpec[]; score: MatchScore }) {
  return (
    <View style={styles.bars}>
      {rows.map((row) => {
        const value = score.breakdown[row.key];
        const pct = row.max > 0 ? Math.max(0, Math.min(100, (value / row.max) * 100)) : 0;
        const color = value >= row.max && row.max > 0 ? FULL : value > 0 ? colors.primary : NONE;
        return (
          <View key={row.key} style={styles.bar} accessibilityLabel={`${row.label}: ${value} of ${row.max}`}>
            <Text style={styles.barLabel} numberOfLines={1}>{row.label}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
            </View>
            <Text style={[styles.barValue, { color }]}>{value}/{row.max}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  headline: {
    gap: 2,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: 10,
  },
  percent: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
  },
  percentWide: {
    fontSize: 40,
    lineHeight: 44,
  },
  label: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  notEligible: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.error,
  },
  notEligibleWide: {
    fontSize: 28,
    lineHeight: 34,
  },
  reason: {
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  bars: {
    gap: 10,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barLabel: {
    width: 104,
    flexShrink: 0,
    fontSize: 13.5,
    color: '#33465A',
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: TRACK,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
  barValue: {
    width: 48,
    flexShrink: 0,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '800',
  },
});
