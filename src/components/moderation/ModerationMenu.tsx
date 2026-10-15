// El "⋯" de denunciar y bloquear (migración 100), con el mismo aspecto que el
// menú de la página de oferta de la empresa: hoja inferior en móvil, diálogo
// centrado en escritorio. Bloquear pide confirmación; no se deshace desde la
// app (lo quita soporte), así que con un bloqueo puesto el elemento queda como
// "Blocked", desactivado.
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ban, Ellipsis, Flag } from 'lucide-react-native';
import { BottomSheet, Text, useConfirmDialog } from '../ui';
import { useIsWide } from '../company/CompanyPage';
import { ReportSheet } from './ReportSheet';
import { colors } from '../../theme';
import { notify } from '../../utils/platformAlert';
import { blockContact, isContactBlocked } from '../../usecases/moderation';
import {
  BLOCK_FAILED_TITLE,
  BLOCKED_NOTICE,
  blockConfirmOptions,
  moderationMenuItems,
  type BlockCounterpart,
  type ModerationMenuItem,
  type ReportTarget,
} from '../../utils/moderation';

// iOS no abre un Modal mientras se cierra otro.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 350 : 0;

export interface BlockTarget {
  companyId: string;
  technicianId: string;
  /** La otra parte, vista desde quien bloquea. */
  counterpart: BlockCounterpart;
  /** Para la confirmación ("Block Acme MRO?"); sin nombre, "this company". */
  name?: string | null;
}

export function ModerationMenu({
  report,
  block,
  hint,
  onBlocked,
  overlay = false,
}: {
  report?: ReportTarget | null;
  /** null para quien no puede bloquear (un viewer). */
  block?: BlockTarget | null;
  /** Una línea bajo las opciones (en el chat: cómo se denuncia un mensaje). */
  hint?: string;
  onBlocked?: () => void;
  /** Sobre la franja de color de la cabecera (oferta del técnico en móvil). */
  overlay?: boolean;
}) {
  const wide = useIsWide();
  const { confirm, dialog } = useConfirmDialog();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [blocked, setBlocked] = useState<boolean | null>(null);

  const items = moderationMenuItems({
    report: report?.type ?? null,
    block: block ? { counterpart: block.counterpart, blocked } : null,
  });
  if (items.length === 0) return null;

  function openMenu() {
    setMenuOpen(true);
    if (block && blocked !== true) {
      isContactBlocked(block.companyId, block.technicianId).then(setBlocked).catch(() => {});
    }
  }

  async function handleBlock() {
    if (!block) return;
    if (!(await confirm(blockConfirmOptions(block.counterpart, block.name)))) return;
    try {
      await blockContact(block.companyId, block.technicianId);
      setBlocked(true);
      notify(BLOCKED_NOTICE.title, BLOCKED_NOTICE.message);
      onBlocked?.();
    } catch (e: any) {
      notify(BLOCK_FAILED_TITLE, e?.message ?? 'Please try again.');
    }
  }

  function choose(item: ModerationMenuItem) {
    if (item.key === 'block' && item.disabled) return;
    setMenuOpen(false);
    if (item.key === 'report') {
      if (report) setTimeout(() => setReportTarget(report), AFTER_SHEET_MS);
    } else {
      setTimeout(() => { void handleBlock(); }, AFTER_SHEET_MS);
    }
  }

  return (
    <>
      <Pressable
        onPress={openMenu}
        hitSlop={4}
        style={({ pressed, hovered }: any) => [
          overlay ? styles.buttonOverlay : wide ? styles.buttonWide : styles.button,
          (pressed || hovered) && (overlay ? styles.buttonOverlayPressed : styles.buttonPressed),
        ]}
        accessibilityRole="button"
        accessibilityLabel="More actions"
      >
        <Ellipsis color={colors.text} size={wide ? 22 : 24} strokeWidth={2.6} />
      </Pressable>

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={wide ? 'More actions' : undefined}>
        <View>
          {items.map((item) => {
            const disabled = item.key === 'block' && item.disabled;
            const Icon = item.key === 'report' ? Flag : Ban;
            const tint = disabled ? colors.disabledText : item.key === 'block' ? colors.error : colors.text;
            return (
              <Pressable
                key={item.key}
                onPress={() => choose(item)}
                disabled={disabled}
                style={({ pressed, hovered }: any) => [styles.item, (pressed || hovered) && !disabled && styles.itemPressed]}
                accessibilityRole="menuitem"
                accessibilityState={{ disabled }}
              >
                <Icon color={tint} size={20} strokeWidth={2} />
                <Text style={[styles.itemText, { color: tint }]}>{item.label}</Text>
              </Pressable>
            );
          })}
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
      </BottomSheet>

      <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonWide: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  buttonOverlay: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  buttonOverlayPressed: {
    backgroundColor: colors.white,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  itemPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  itemText: {
    fontSize: 16,
    fontWeight: '800',
  },
  hint: {
    marginTop: 8,
    paddingHorizontal: 6,
    fontSize: 13.5,
    color: colors.textSecondary,
  },
});
