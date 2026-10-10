// Los documentos de un técnico que una empresa puede abrir (rediseño, fase 3;
// maquetas W-Candidate y C-Tech): icono del tipo de fichero, nombre, tipo y
// caducidad, estado y botón de descarga.
//
// Sólo pinta. Qué documentos llegan lo decide la base (sólo con la identidad
// desbloqueada) y cómo se abren, cada pantalla con su handler de siempre.
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Download } from 'lucide-react-native';
import { Text } from '../ui';
import { colors } from '../../theme';
import { TOUCH_TARGET } from '../../theme/ui';
import type { Document } from '../../types/document';
import { CARD_BORDER, StatusPill } from './CompanyPage';

const DOC_TYPE_LABELS: Record<string, string> = {
  license: 'License',
  medical: 'Medical',
  id: 'ID',
  training: 'Training',
  resume: 'Resume',
  other: 'Other',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fileKind(fileName: string): string {
  const ext = fileName.split('.').pop()?.toUpperCase() ?? '';
  return ext && ext.length <= 4 && ext !== fileName.toUpperCase() ? ext : 'DOC';
}

function statusTone(status: string) {
  if (status === 'verified') return 'success' as const;
  if (status === 'pending') return 'warning' as const;
  return 'error' as const;
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function TechnicianDocumentList({
  documents,
  viewingId,
  onView,
  emptyText,
}: {
  documents: Document[];
  /** El documento cuyo enlace se está generando (spinner y resto desactivados). */
  viewingId: string | null;
  onView: (doc: Document) => void;
  emptyText: string;
}) {
  if (documents.length === 0) return <Text style={styles.empty}>{emptyText}</Text>;
  return (
    <View style={styles.list}>
      {documents.map((doc) => (
        <View key={doc.id} style={styles.row}>
          <View style={styles.kind}>
            <Text style={styles.kindText}>{fileKind(doc.fileName)}</Text>
          </View>
          <View style={styles.copy}>
            <Text style={styles.name} numberOfLines={1}>{doc.fileName}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {DOC_TYPE_LABELS[doc.type] ?? doc.type}
              {doc.expiresAt ? ` · Expires ${formatDate(doc.expiresAt)}` : ''}
            </Text>
          </View>
          <StatusPill label={statusLabel(doc.status)} tone={statusTone(doc.status)} />
          {doc.storagePath ? (
            <Pressable
              onPress={() => onView(doc)}
              disabled={viewingId !== null}
              style={({ pressed, hovered }: any) => [styles.download, (pressed || hovered) && styles.downloadPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${doc.fileName}`}
            >
              {viewingId === doc.id
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Download color={colors.primary} size={18} strokeWidth={2.2} />}
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  kind: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  kindText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.error,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  download: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  empty: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
