// Denunciar un perfil, una oferta o un mensaje (migración 100): la lista corta
// de motivos y "Send report". Hoja inferior en móvil, diálogo en escritorio
// (BottomSheet). Sin texto libre.
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BottomSheet, Text } from '../ui';
import { ButtonRow, PillButton } from '../company/CompanyPage';
import { colors } from '../../theme';
import { HOVER_BG, radius, TOUCH_TARGET } from '../../theme/ui';
import { notify } from '../../utils/platformAlert';
import { submitReport } from '../../usecases/moderation';
import {
  REPORT_ALREADY_SENT,
  REPORT_FAILED_TITLE,
  REPORT_REASONS,
  REPORT_SENT,
  REPORT_SHEET_SUBTITLE,
  REPORT_TITLES,
  type ReportReason,
  type ReportTarget,
} from '../../utils/moderation';

// iOS no enseña un aviso mientras se cierra un Modal.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 350 : 0;

export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (target) setReason(null);
  }, [target]);

  async function send() {
    if (!target || !reason) return;
    setSending(true);
    try {
      const { alreadyReported } = await submitReport(target, reason);
      onClose();
      const done = alreadyReported ? REPORT_ALREADY_SENT : REPORT_SENT;
      setTimeout(() => notify(done.title, done.message), AFTER_SHEET_MS);
    } catch (e: any) {
      notify(REPORT_FAILED_TITLE, e?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <BottomSheet
      visible={target !== null}
      onClose={onClose}
      dismissible={!sending}
      title={target ? REPORT_TITLES[target.type] : undefined}
      subtitle={REPORT_SHEET_SUBTITLE}
      footer={(
        <ButtonRow>
          <PillButton label="Cancel" variant="outline" size="md" onPress={onClose} disabled={sending} grow={1} />
          <PillButton label="Send report" size="md" onPress={send} disabled={!reason} loading={sending} grow={1} />
        </ButtonRow>
      )}
    >
      <View style={styles.list} accessibilityRole="radiogroup">
        {REPORT_REASONS.map((item) => {
          const selected = item.code === reason;
          return (
            <Pressable
              key={item.code}
              onPress={() => setReason(item.code)}
              disabled={sending}
              style={({ pressed, hovered }: any) => [
                styles.row,
                selected && styles.rowSelected,
                (pressed || hovered) && !selected && styles.rowHover,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: sending }}
              accessibilityLabel={item.label}
            >
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
              <Text style={[styles.label, selected && styles.labelSelected]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: TOUCH_TARGET + 4,
    paddingHorizontal: 14,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  rowHover: {
    backgroundColor: HOVER_BG,
  },
  rowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  labelSelected: {
    fontWeight: '800',
  },
});
