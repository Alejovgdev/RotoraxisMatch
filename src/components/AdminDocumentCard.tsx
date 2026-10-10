import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, TextInput } from './ui/Text';
import { Calendar, CheckCircle, Clock, Download, FileCheck, FileText, UserRound, XCircle } from 'lucide-react-native';
import { getDocumentSignedUrl, openDocumentPreWindow, openDocumentUrl } from '../lib/documentStorage';
import type { LucideProps } from 'lucide-react-native';
import type { DocumentStatus, DocumentType, TechnicianDocument } from '../types';
import {
  AdminBadge,
  AdminCard,
  AdminIconBox,
  adminUi,
} from './admin/AdminUI';
import type { AdminTone } from './admin/AdminUI';
import { spacing } from '../theme';
import { notify, confirmAction } from '../utils/platformAlert';

interface Props {
  document: TechnicianDocument;
  technicianName?: string;
  expiresAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  storagePath?: string;
  onUpdateStatus: (id: string, status: DocumentStatus, rejectionReason?: string) => Promise<void>;
}

type ActionConfig = {
  status: DocumentStatus;
  label: string;
  color: string;
  icon: React.ComponentType<LucideProps>;
};

const ACTIONS: ActionConfig[] = [
  { status: 'verified', label: 'Verify', color: adminUi.green, icon: CheckCircle },
  { status: 'pending', label: 'Set pending', color: adminUi.amber, icon: Clock },
  { status: 'rejected', label: 'Reject', color: adminUi.red, icon: XCircle },
  { status: 'expired', label: 'Mark expired', color: adminUi.red, icon: Clock },
];

function statusTone(status: DocumentStatus): AdminTone {
  if (status === 'verified') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'rejected') return 'error';
  return 'error';
}

function statusLabel(status: DocumentStatus): string {
  if (status === 'verified') return 'Verified';
  if (status === 'pending') return 'Pending review';
  if (status === 'rejected') return 'Rejected';
  return 'Expired';
}

function typeTone(type: DocumentType): AdminTone {
  if (type === 'license') return 'navy';
  if (type === 'medical') return 'info';
  if (type === 'training') return 'cyan';
  if (type === 'id') return 'warning';
  return 'muted';
}

function typeLabel(type: DocumentType): string {
  const map: Record<DocumentType, string> = {
    license: 'License',
    medical: 'Medical',
    training: 'Training',
    id: 'Identity',
    resume: 'Resume',
    other: 'Other',
  };
  return map[type];
}

function formatDate(iso?: string): string {
  if (!iso) return 'Not set';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function AdminDocumentCard({
  document,
  technicianName,
  expiresAt,
  reviewedAt,
  rejectionReason,
  storagePath,
  onUpdateStatus,
}: Props) {
  const [loadingStatus, setLoadingStatus] = useState<DocumentStatus | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  async function handleAction(status: DocumentStatus) {
    if (status === 'rejected') {
      setShowRejectForm(true);
      return;
    }
    setLoadingStatus(status);
    try {
      await onUpdateStatus(document.id, status);
    } finally {
      setLoadingStatus(null);
    }
  }

  async function handleConfirmReject() {
    if (!rejectReason.trim()) {
      notify('Reason required', 'Please explain why this document is rejected.');
      return;
    }
    setLoadingStatus('rejected');
    setShowRejectForm(false);
    try {
      await onUpdateStatus(document.id, 'rejected', rejectReason.trim());
    } finally {
      setLoadingStatus(null);
      setRejectReason('');
    }
  }

  async function handleViewFile() {
    if (!storagePath) return;
    const win = openDocumentPreWindow();
    setViewLoading(true);
    const { url, error } = await getDocumentSignedUrl(storagePath, 120, false);
    setViewLoading(false);
    if (error || !url) {
      win?.close();
      notify('Error', error ?? 'Could not generate download link.');
      return;
    }
    openDocumentUrl(url, win);
  }

  const availableActions = ACTIONS.filter((action) => action.status !== document.status);

  return (
    <AdminCard
      style={[
        styles.card,
        document.status === 'pending' && styles.cardPending,
        (document.status === 'rejected' || document.status === 'expired') && styles.cardRejected,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <View style={styles.badgeRow}>
            <AdminBadge label={typeLabel(document.type)} tone={typeTone(document.type)} small />
            <AdminBadge label={statusLabel(document.status)} tone={statusTone(document.status)} small />
          </View>
          <Text style={styles.fileName}>{document.fileName}</Text>
        </View>
        <AdminIconBox
          icon={document.status === 'verified' ? FileCheck : FileText}
          size={19}
          color={document.status === 'pending' ? adminUi.amber : adminUi.accent}
          backgroundColor={document.status === 'pending' ? adminUi.amberSoft : adminUi.accentSoft}
        />
      </View>

      <View style={styles.metaGrid}>
        <InfoPill icon={UserRound} label={technicianName ?? document.technicianId} />
        <InfoPill icon={Calendar} label={`Uploaded ${formatDate(document.uploadedAt)}`} />
        {expiresAt ? <InfoPill icon={Clock} label={`Expires ${formatDate(expiresAt)}`} /> : null}
        {reviewedAt ? <InfoPill icon={FileCheck} label={`Reviewed ${formatDate(reviewedAt)}`} /> : null}
      </View>

      {document.status === 'rejected' && rejectionReason ? (
        <View style={styles.rejectionNote}>
          <Text style={styles.rejectionLabel}>Reason</Text>
          <Text style={styles.rejectionText}>{rejectionReason}</Text>
        </View>
      ) : null}

      {showRejectForm ? (
        <View style={styles.rejectForm}>
          <Text style={styles.rejectFormLabel}>Rejection reason</Text>
          <TextInput
            style={styles.rejectInput}
            placeholder="Explain why this document is rejected…"
            placeholderTextColor={adminUi.textSoft}
            value={rejectReason}
            onChangeText={setRejectReason}
            multiline
            numberOfLines={3}
            autoFocus
          />
          <View style={styles.rejectFormActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={() => { setShowRejectForm(false); setRejectReason(''); }}
              activeOpacity={0.78}
            >
              <Text style={[styles.actionBtnText, { color: adminUi.textSoft }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.confirmRejectBtn]}
              onPress={handleConfirmReject}
              activeOpacity={0.78}
            >
              <XCircle size={15} color={adminUi.red} strokeWidth={2.2} />
              <Text style={[styles.actionBtnText, { color: adminUi.red }]}>Confirm rejection</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        {storagePath ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.viewBtn, (viewLoading || loadingStatus !== null) && styles.actionBtnDisabled]}
            onPress={handleViewFile}
            disabled={viewLoading || loadingStatus !== null}
            activeOpacity={0.78}
          >
            {viewLoading ? (
              <ActivityIndicator size="small" color={adminUi.accent} />
            ) : (
              <>
                <Download size={15} color={adminUi.accent} strokeWidth={2.2} />
                <Text style={[styles.actionBtnText, { color: adminUi.accent }]}>View file</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
        {availableActions.map((action) => (
          <StatusActionButton
            key={action.status}
            action={action}
            loading={loadingStatus === action.status}
            disabled={loadingStatus !== null || viewLoading}
            onPress={() => handleAction(action.status)}
          />
        ))}
      </View>
    </AdminCard>
  );
}

function InfoPill({
  icon,
  label,
}: {
  icon: React.ComponentType<LucideProps>;
  label: string;
}) {
  return (
    <View style={styles.infoPill}>
      <AdminIconBox icon={icon} size={16} color={adminUi.accent} backgroundColor={adminUi.accentSoft} />
      <Text style={styles.infoText} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function StatusActionButton({
  action,
  loading,
  disabled,
  onPress,
}: {
  action: ActionConfig;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = action.icon;
  return (
    <TouchableOpacity
      style={[
        styles.actionBtn,
        { borderColor: action.color + '55', backgroundColor: action.color + '0F' },
        disabled && styles.actionBtnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.78}
    >
      {loading ? (
        <ActivityIndicator size="small" color={action.color} />
      ) : (
        <>
          <Icon size={15} color={action.color} strokeWidth={2.2} />
          <Text style={[styles.actionBtnText, { color: action.color }]}>{action.label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cardPending: {
    borderColor: '#F3DDA4',
    borderLeftWidth: 3,
  },
  cardRejected: {
    borderColor: '#F3C2C2',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  fileName: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: adminUi.text,
  },
  metaGrid: {
    gap: spacing.sm,
  },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 14,
    backgroundColor: adminUi.surfaceSoft,
    borderWidth: 1,
    borderColor: adminUi.borderSoft,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: adminUi.textSoft,
  },
  rejectionNote: {
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F3C2C2',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rejectionLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: adminUi.red,
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rejectionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: adminUi.textSoft,
  },
  rejectForm: {
    backgroundColor: '#FDECEC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F3C2C2',
    padding: spacing.md,
    gap: spacing.sm,
  },
  rejectFormLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: adminUi.red,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rejectInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F3C2C2',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    lineHeight: 19,
    color: adminUi.text,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  rejectFormActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cancelBtn: {
    borderColor: adminUi.borderSoft,
    backgroundColor: adminUi.surfaceSoft,
  },
  confirmRejectBtn: {
    flex: 1,
    borderColor: '#F3C2C2',
    backgroundColor: '#FDECEC',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: adminUi.borderSoft,
  },
  actionBtn: {
    flexGrow: 1,
    flexBasis: 112,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  actionBtnDisabled: {
    opacity: 0.55,
  },
  viewBtn: {
    borderColor: adminUi.accent + '55',
    backgroundColor: adminUi.accentSoft,
  },
  actionBtnText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
});
