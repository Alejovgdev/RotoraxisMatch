// "What they ask vs. your profile" (rediseño, fase 5A; maqueta T-Offer, T7 y
// respuesta 24). Sólo pinta: las filas, su estado y los avisos los decide
// src/utils/offerChecklist.ts a partir del mismo score que da el %.
//
//   ✓ verde   — el criterio da todos sus puntos;
//   – ámbar   — da parte;
//   ✕ gris    — no da ninguno;
//   sin icono — no hay score con el que compararlo (la fila dice lo que pide).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, Minus, X } from 'lucide-react-native';
import { Text } from '../ui';
import { NoticeBox } from '../company/CompanyPage';
import { colors } from '../../theme';
import {
  checklistRowAccessibilityLabel,
  type ChecklistNotice,
  type ChecklistRow,
  type ChecklistState,
} from '../../utils/offerChecklist';

const STATE_LOOK: Record<Exclude<ChecklistState, 'unknown'>, { bg: string; fg: string; Icon: typeof Check }> = {
  full: { bg: '#E5F4EC', fg: colors.success, Icon: Check },
  partial: { bg: colors.warningSoft, fg: colors.warning, Icon: Minus },
  none: { bg: '#EEF1F4', fg: colors.textMuted, Icon: X },
};

export function OfferChecklist({ rows }: { rows: readonly ChecklistRow[] }) {
  return (
    <View>
      {rows.map((row, i) => {
        const look = row.state === 'unknown' ? null : STATE_LOOK[row.state];
        return (
          <View
            key={row.key}
            style={[styles.row, i < rows.length - 1 && styles.rowLine]}
            accessible
            accessibilityLabel={checklistRowAccessibilityLabel(row)}
          >
            {look ? (
              <View style={[styles.icon, { backgroundColor: look.bg }]}>
                <look.Icon color={look.fg} size={16} strokeWidth={3} />
              </View>
            ) : (
              <View style={[styles.icon, styles.iconUnknown]} />
            )}
            <View style={styles.copy}>
              <Text style={styles.label}>
                {row.label}
                {row.caption ? <Text style={styles.caption}>{` · ${row.caption}`}</Text> : null}
              </Text>
              {row.values.map((value, j) => (
                <Text key={`${value}-${j}`} style={styles.value}>{value}</Text>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Los avisos de hoy, debajo de la checklist y sin repetirla. */
export function OfferChecklistNotices({ notices }: { notices: readonly ChecklistNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <View style={styles.notices}>
      {notices.map((notice) => {
        switch (notice.kind) {
          case 'blockers':
            return (
              <NoticeBox key="blockers" tone="error" title="Not eligible">
                <Lines lines={notice.lines} color={colors.error} />
              </NoticeBox>
            );
          case 'cap':
            return <NoticeBox key="cap" tone="warning">{notice.text}</NoticeBox>;
          case 'validity':
            return (
              <NoticeBox key="validity" tone="warning" title="Validity">
                <View style={styles.lines}>
                  {notice.notices.map((n, i) => (
                    <Text key={i} style={[styles.line, { color: colors.warning }]}>
                      <Text style={styles.lineStrong}>{n.label}</Text>
                      {` · ${n.detail}`}
                    </Text>
                  ))}
                </View>
              </NoticeBox>
            );
          case 'authority':
            return <NoticeBox key="authority" title="Authority">{notice.text}</NoticeBox>;
          case 'clarifications':
            return (
              <NoticeBox key="clarifications" tone="warning" title="To confirm">
                <Lines lines={notice.lines} color={colors.warning} />
              </NoticeBox>
            );
          case 'missing':
            return (
              <NoticeBox key="missing" tone="error" title="Requirements not met">
                <Lines lines={notice.lines} color={colors.error} />
              </NoticeBox>
            );
          default:
            return null;
        }
      })}
    </View>
  );
}

function Lines({ lines, color }: { lines: readonly string[]; color: string }) {
  return (
    <View style={styles.lines}>
      {lines.map((line, i) => (
        <Text key={i} style={[styles.line, { color }]}>• {line}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  rowLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F4',
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconUnknown: {
    borderWidth: 2,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.textMuted,
  },
  caption: {
    fontWeight: '800',
    color: '#33465A',
  },
  value: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.text,
  },
  notices: {
    gap: 10,
  },
  lines: {
    gap: 3,
  },
  line: {
    fontSize: 13.5,
    lineHeight: 19,
  },
  lineStrong: {
    fontWeight: '800',
  },
});
