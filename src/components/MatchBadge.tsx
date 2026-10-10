import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './ui/Text';
import { colors } from '../theme';

function scoreColor(total: number): string {
  if (total >= 80) return colors.success;
  if (total >= 60) return colors.blue;
  if (total >= 40) return colors.warning;
  return colors.textMuted;
}

interface MatchBadgeProps {
  score: number;
  context?: string;
  // Set when the pair has a hard disqualifier (MatchScore.blockers is not
  // empty) — callers pass `score.blockers.length > 0`. A blocked pair must
  // not be presented as a bare percentage: the number is capped to a low
  // value anyway, and reading it as "18% match" invites the wrong
  // conclusion ("a weak candidate") instead of the right one ("not a
  // candidate"). The reason itself lives in MatchExplanation, not here.
  // Optional so every existing call site keeps its current behaviour.
  notEligible?: boolean;
}

export function MatchBadge({ score, context, notEligible = false }: MatchBadgeProps) {
  const color = scoreColor(score);
  return (
    <View style={styles.wrap}>
      {notEligible ? (
        <Text style={styles.notEligible}>Not eligible</Text>
      ) : (
        <Text style={[styles.number, { color }]}>{score}%</Text>
      )}
      {context ? <Text style={styles.context}>{context}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  number: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  // Smaller than the percentage it replaces — two words at 17pt would push
  // the badge wide enough to reflow the card rows it sits in.
  notEligible: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 22,
    color: colors.error,
    textAlign: 'right',
  },
  context: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'right',
    lineHeight: 14,
  },
});
