import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { MatchScore, MatchDisplayLabel } from '../types/matching';
import { MatchScoreWeights } from '../utils/offerMatchExplain';
import { QUALIFICATION_FIRST_ORDER, visibleBreakdownRows } from '../utils/matchBreakdownRows';

const LEVEL_LABEL: Record<MatchScore['level'], string> = {
  exact: 'Exact match',
  related: 'Related — needs confirmation',
  legacy: 'Match found',
  not_met: 'No clear match',
};

const LEVEL_COLOR: Record<MatchScore['level'], string> = {
  exact: colors.success,
  related: colors.warning,
  legacy: colors.blue,
  not_met: colors.textMuted,
};

// Qué filas salen, con qué rótulo y en qué orden: src/utils/matchBreakdownRows.ts,
// compartido con los cuatro desgloses de barras. Un eje que la oferta no ha
// pedido tiene máximo 0 y NO se pinta — "Habilitation 0/0" en una oferta de
// motor se leía como nota baja y no lo era.

// Renders the explainable part of a MatchScore — the numeric breakdown per
// criterion, what matches, what needs clarification, which mandatory
// requirements are unmet, and — when the total was capped below the raw
// breakdown sum — why. Never used to hide or exclude the technician/offer;
// purely explanatory.
//
// hideBreakdown: set by callers that already render their own per-criterion
// breakdown (e.g. a bar chart with real denominators from
// getMatchScoreWeights) — avoids showing the same numbers twice. The cap
// note, matches, clarifications and mandatory-missing sections always
// render regardless, since those are never duplicated elsewhere.
// weights: los máximos de ESTA oferta (getMatchScoreWeights). Sin ellos no se
// puede saber qué fila sobra, así que el bloque entero se calla en vez de
// pintar seis filas con denominadores que nadie ha comprobado. Los llamadores
// con hideBreakdown no lo necesitan.
// displayLabel: overrides the band label ("Excellent match", …) next to the
// score. Passed by callers that know the offer targets non-licensed trades,
// where there is no Part-66 requirement to have matched and the honest
// wording is "General compatibility" — see getMatchDisplayLabel. Defaults to
// the score's own label.
export function MatchExplanation({
  score,
  hideBreakdown = false,
  displayLabel,
  weights,
}: {
  score: MatchScore;
  hideBreakdown?: boolean;
  displayLabel?: MatchDisplayLabel;
  weights?: MatchScoreWeights | null;
}) {
  const breakdownRows = visibleBreakdownRows(weights, QUALIFICATION_FIRST_ORDER);
  const rawSum = Object.values(score.breakdown).reduce((sum, v) => sum + v, 0);
  const wasCapped = rawSum > score.total;

  if (
    score.matches.length === 0 &&
    score.clarifications.length === 0 &&
    score.vigenciaNotices.length === 0 &&
    score.missingRequirements.length === 0 &&
    score.blockers.length === 0
  ) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      {/* Blockers render ABOVE the score row on purpose: a blocked pair must
          never be read as a percentage first and a disqualification second.
          See MatchScore.blockers for why this is not the same as an unmet
          mandatory requirement (which stays below, with the rest). */}
      {score.blockers.length > 0 && (
        <View style={styles.blockerBox}>
          <Text style={styles.blockerTitle}>Not eligible</Text>
          {score.blockers.map((b, i) => (
            <Text key={i} style={styles.blockerLine}>• {b}</Text>
          ))}
        </View>
      )}

      <View style={styles.levelRow}>
        <View style={[styles.levelDot, { backgroundColor: LEVEL_COLOR[score.level] }]} />
        <Text style={[styles.levelText, { color: LEVEL_COLOR[score.level] }]}>{LEVEL_LABEL[score.level]}</Text>
        <Text style={styles.scoreText}>{score.total}/100 — {displayLabel ?? score.label}</Text>
      </View>

      {!hideBreakdown && breakdownRows.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Score breakdown</Text>
          {breakdownRows.map((row) => (
            <View key={row.key} style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>{row.label}</Text>
              <Text style={styles.breakdownValue}>{score.breakdown[row.key]}</Text>
            </View>
          ))}
        </View>
      )}
      {wasCapped && (
        <Text style={styles.cappedNote}>
          {score.blockers.length > 0
            ? 'Score capped: this profile does not meet a hard requirement of the offer (see above).'
            : score.profileTypeMismatch
              ? 'Score capped: the offer is looking for a different profile type (see below).'
            : score.missingRequirements.length > 0
              ? 'Score capped: this offer states a requirement this profile does not meet (see below).'
              : 'Score capped: this offer requires certified work and the profile does not hold the licence for it.'}
        </Text>
      )}

      {score.vigenciaNotices.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Validity</Text>
          {score.vigenciaNotices.map((n, i) => (
            <View key={i} style={styles.vigenciaRow}>
              <View style={styles.vigenciaBadge}>
                <Text style={styles.vigenciaBadgeText}>{n.label}</Text>
              </View>
              <Text style={styles.vigenciaDetail}>{n.detail}</Text>
            </View>
          ))}
        </View>
      )}

      {score.matches.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Matches</Text>
          {score.matches.map((m, i) => (
            <Text key={i} style={styles.matchLine}>• {m}</Text>
          ))}
        </View>
      )}

      {score.clarifications.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>To confirm</Text>
          {score.clarifications.map((c, i) => (
            <Text key={i} style={styles.clarificationLine}>• {c}</Text>
          ))}
        </View>
      )}

      {score.missingRequirements.length > 0 && (
        <View style={styles.block}>
          {/* Fase 6 tanda D: el título ya no dice "mandatory" porque el
              concepto no existe. Cubre las DOS fuentes del campo: una
              aeronave que falta cuando la oferta las exige todas, y la
              licencia de la oferta que el perfil no tiene. */}
          <Text style={styles.blockTitle}>Requirements not met</Text>
          {score.missingRequirements.map((m, i) => (
            <Text key={i} style={styles.missingLine}>• {m}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  levelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  levelText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scoreText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    marginLeft: 'auto',
  },
  block: {
    gap: 2,
  },
  blockerBox: {
    gap: 2,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.error + '14',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  blockerTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  blockerLine: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.error,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownLabel: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.text,
  },
  breakdownValue: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: colors.text,
  },
  cappedNote: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 15,
    fontStyle: 'italic',
    color: colors.warning,
  },
  blockTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  matchLine: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.success,
  },
  clarificationLine: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.warning,
  },
  missingLine: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.error,
  },
  vigenciaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 3,
  },
  vigenciaBadge: {
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warning + '18',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  vigenciaBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.warning,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  vigenciaDetail: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: colors.text,
  },
});
