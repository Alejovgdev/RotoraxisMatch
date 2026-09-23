import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { supabase } from '../../src/lib/supabase';

const CONSENT_VERSION = '2025-06';
import * as DocumentPicker from 'expo-document-picker';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { Button } from '../../src/components/Button';
import {
  EmptyPanel,
  TechnicianBadge,
  TechnicianCard,
  TechnicianPageHeader,
  TechnicianScreen,
  techStyles,
  techUi,
} from '../../src/components/technician/TechnicianUI';
import { useTechnicianDashboard } from '../../src/state/useTechnicianDashboard';
import { useTechnicianSession } from '../../src/state/SessionContext';
import { documentRepositoryV2 } from '../../src/repositories/v2/documentRepositoryV2';
import {
  validateDocumentFile,
  uploadDocumentToStorage,
  removeDocumentFromStorage,
} from '../../src/lib/documentStorage';
import { colors, spacing } from '../../src/theme';
import type { DocumentStatus, DocumentType, TechnicianDocument } from '../../src/types';

const TYPE_LABELS: Record<DocumentType, string> = {
  license:  'License',
  medical:  'Medical',
  training: 'Training',
  id:       'ID',
  resume:   'Resume',
  other:    'Other',
};

const TYPE_TONES: Record<DocumentType, 'navy' | 'cyan' | 'info' | 'muted'> = {
  license:  'navy',
  medical:  'cyan',
  training: 'info',
  id:       'muted',
  resume:   'muted',
  other:    'muted',
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  verified: 'Verified',
  pending:  'Under review',
  rejected: 'Rejected',
  expired:  'Expired',
};

const STATUS_TONES: Record<DocumentStatus, 'success' | 'warning' | 'error' | 'muted'> = {
  verified: 'success',
  pending:  'warning',
  rejected: 'error',
  expired:  'error',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function DocumentPanel({ document }: { document: TechnicianDocument }) {
  const expiresAt = (document as TechnicianDocument & { expiresAt?: string }).expiresAt;
  const rejectionReason = (document as TechnicianDocument & { rejectionReason?: string }).rejectionReason;

  return (
    <TechnicianCard style={styles.documentCard}>
      <View style={styles.documentTop}>
        <View style={styles.documentInfo}>
          <View style={styles.badgeRow}>
            <TechnicianBadge label={TYPE_LABELS[document.type]} tone={TYPE_TONES[document.type]} small />
          </View>
          <Text style={styles.fileName} numberOfLines={2}>{document.fileName}</Text>
        </View>
        <TechnicianBadge label={STATUS_LABELS[document.status]} tone={STATUS_TONES[document.status]} small />
      </View>

      <View style={styles.documentMeta}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Uploaded</Text>
          <Text style={styles.metaValue}>{formatDate(document.uploadedAt)}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Expiration</Text>
          <Text style={styles.metaValue}>{expiresAt ? formatDate(expiresAt) : 'Not provided'}</Text>
        </View>
      </View>

      {document.status === 'rejected' && rejectionReason ? (
        <View style={styles.rejectionNote}>
          <Text style={styles.rejectionLabel}>Reason for rejection</Text>
          <Text style={styles.rejectionText}>{rejectionReason}</Text>
        </View>
      ) : null}
    </TechnicianCard>
  );
}

export default function TechnicianDocumentsScreen() {
  const goBack = useGoBack();
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const { documents, loading, refresh } = useTechnicianDashboard();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState<DocumentType | null>(null);
  const [pickedFile, setPickedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [medicalConsentAccepted, setMedicalConsentAccepted] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const verifiedCount = documents.filter((d) => d.status === 'verified').length;
  const pendingCount  = documents.filter((d) => d.status === 'pending').length;
  const attentionCount = documents.filter((d) => d.status === 'rejected' || d.status === 'expired').length;

  async function handlePickFile() {
    setUploadError(null);
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
    } catch {
      setUploadError('Could not open file picker. Please try again.');
      return;
    }
    if (result.canceled) return;
    const asset = result.assets[0];
    const validationError = validateDocumentFile(asset.mimeType, asset.name, asset.size);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    setPickedFile(asset);
  }

  async function handleUpload() {
    if (!uploadType || !pickedFile || !technicianId) return;
    if (uploadType === 'medical' && !medicalConsentAccepted) {
      setUploadError('You must provide explicit consent to upload medical documents.');
      return;
    }
    setUploading(true);
    setUploadError(null);

    // A medical file must never leave the device unless its append-only
    // consent record is already present. Recording it after the upload allowed a
    // database failure to leave health data in Storage without the intended
    // audit evidence. If a later file upload fails, the consent record simply
    // records the affirmative action the user already took in this screen.
    if (uploadType === 'medical') {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        setUploadError('Your session could not be verified. No medical document was uploaded.');
        setUploading(false);
        return;
      }

      const { error: consentError } = await supabase.from('user_consents').upsert(
        {
          user_id: user.id,
          consent_type: 'medical_document',
          consent_version: CONSENT_VERSION,
        },
        { onConflict: 'user_id,consent_type,consent_version', ignoreDuplicates: true },
      );
      if (consentError) {
        setUploadError('Could not record your medical-data consent. No document was uploaded.');
        setUploading(false);
        return;
      }
    }

    const { storagePath, error: storageError } = await uploadDocumentToStorage(
      pickedFile.uri,
      pickedFile.mimeType,
      pickedFile.name,
      technicianId,
    );

    if (storageError) {
      setUploadError(`Upload failed: ${storageError}`);
      setUploading(false);
      return;
    }

    try {
      await documentRepositoryV2.add({
        id: '',
        technicianId,
        type: uploadType,
        fileName: pickedFile.name,
        storagePath,
        status: 'pending',
        uploadedAt: new Date().toISOString(),
      });
    } catch (err) {
      const saveError = err instanceof Error ? err.message : 'Failed to save document record.';
      const cleanupError = await removeDocumentFromStorage(storagePath);
      setUploadError(cleanupError
        ? `${saveError} The uploaded file could not be rolled back; please contact support.`
        : saveError);
      setUploading(false);
      return;
    }

    // From this point the file and its database row both exist. A refresh
    // failure must never trigger Storage rollback or it would leave a valid
    // row pointing at a missing private object.
    setUploadOpen(false);
    setUploadType(null);
    setPickedFile(null);
    setMedicalConsentAccepted(false);
    try {
      await refresh();
    } catch (refreshError) {
      console.error('Document uploaded, but the document list could not refresh:', refreshError);
    }
    setUploading(false);
  }

  function handleCancelUpload() {
    setUploadOpen(false);
    setUploadType(null);
    setPickedFile(null);
    setUploadError(null);
    setMedicalConsentAccepted(false);
  }

  if (loading && documents.length === 0) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.technician} role="technician" />
      </>
    );
  }

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[techStyles.content, isWide && techStyles.contentWide]}
        showsVerticalScrollIndicator={false}
      >
        <TechnicianPageHeader
          eyebrow="Verification"
          title="My Documents"
          subtitle="Upload licenses, certificates and verification documents."
          onBack={goBack}
        />

        <TechnicianCard style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: techUi.green }]}>{verifiedCount}</Text>
            <Text style={styles.summaryLabel}>Verified</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: techUi.amber }]}>{pendingCount}</Text>
            <Text style={styles.summaryLabel}>Under review</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: attentionCount > 0 ? techUi.red : techUi.blue }]}>
              {documents.length}
            </Text>
            <Text style={styles.summaryLabel}>Total</Text>
          </View>
        </TechnicianCard>

        {/* ── Upload section ─────────────────────────────── */}
        {uploadOpen ? (
          <TechnicianCard style={styles.uploadCard}>
            <Text style={styles.uploadTitle}>Upload document</Text>

            {/* Type selector */}
            <Text style={styles.uploadLabel}>Document type</Text>
            <View style={styles.typeChips}>
              {(Object.keys(TYPE_LABELS) as DocumentType[]).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeChip, uploadType === type && styles.typeChipSelected]}
                  onPress={() => setUploadType(type)}
                  disabled={uploading}
                >
                  <Text style={[styles.typeChipText, uploadType === type && styles.typeChipTextSelected]}>
                    {TYPE_LABELS[type]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* File picker */}
            <TouchableOpacity
              style={[styles.filePickerBtn, uploading && styles.filePickerBtnDisabled]}
              onPress={handlePickFile}
              disabled={uploading}
              activeOpacity={0.75}
            >
              <Text style={styles.filePickerBtnText} numberOfLines={1}>
                {pickedFile ? pickedFile.name : 'Choose file  ·  PDF, JPG, PNG — max 5 MB'}
              </Text>
            </TouchableOpacity>

            {/* Medical document consent — required for GDPR Art. 9 */}
            {uploadType === 'medical' && (
              <View style={styles.medicalConsentBox}>
                <Text style={styles.medicalConsentTitle}>Medical document consent required</Text>
                <Text style={styles.medicalConsentDesc}>
                  Medical certificates contain health data (special category under GDPR Art. 9). They are used exclusively by our admin team for licence verification and are never shared with companies.
                </Text>
                <TouchableOpacity
                  style={styles.medicalConsentRow}
                  onPress={() => setMedicalConsentAccepted((v) => !v)}
                  activeOpacity={0.75}
                  disabled={uploading}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: medicalConsentAccepted, disabled: uploading }}
                  accessibilityLabel="Consent to process this medical document for verification"
                >
                  <View style={[styles.checkbox, medicalConsentAccepted && styles.checkboxChecked]}>
                    {medicalConsentAccepted ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <Text style={styles.medicalConsentLabel}>
                    I explicitly consent to the processing of this medical document for verification purposes only.
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {uploadError ? (
              <Text style={styles.uploadError}>{uploadError}</Text>
            ) : null}

            {/* Actions */}
            <Button
              label={uploading ? 'Uploading…' : 'Upload'}
              onPress={handleUpload}
              loading={uploading}
              disabled={!uploadType || !pickedFile || uploading || (uploadType === 'medical' && !medicalConsentAccepted)}
              fullWidth
              size="md"
              style={styles.uploadSubmitBtn}
            />
            <TouchableOpacity
              onPress={handleCancelUpload}
              disabled={uploading}
              style={styles.cancelLink}
            >
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </TechnicianCard>
        ) : (
          <Button
            label="Upload Document"
            variant="outline"
            onPress={() => setUploadOpen(true)}
            fullWidth
            style={styles.uploadBtn}
          />
        )}

        {/* ── Document list ──────────────────────────────── */}
        {documents.length === 0 ? (
          <EmptyPanel
            title="No documents on file"
            subtitle="Upload your licenses and certificates to start the verification process."
          />
        ) : (
          <View style={styles.listBlock}>
            <Text style={styles.listTitle}>Documents on file</Text>
            {documents.map((document) => (
              <DocumentPanel key={document.id} document={document} />
            ))}
          </View>
        )}
      </ScrollView>
    </TechnicianScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 3 },
  summaryValue: { fontSize: 25, lineHeight: 31, fontWeight: '700' },
  summaryLabel: {
    fontSize: 11, lineHeight: 15, fontWeight: '600',
    color: techUi.textMuted, textAlign: 'center',
  },
  summaryDivider: { width: 1, height: 40, backgroundColor: techUi.borderSoft },

  // Upload button (collapsed state)
  uploadBtn: {
    marginBottom: spacing.lg,
    borderColor: techUi.accent,
    borderRadius: 16,
  },

  // Upload form card (expanded state)
  uploadCard: { gap: spacing.md, marginBottom: spacing.lg },
  uploadTitle: {
    fontSize: 16, lineHeight: 21, fontWeight: '700', color: techUi.text,
  },
  uploadLabel: {
    fontSize: 12, lineHeight: 16, fontWeight: '600',
    color: techUi.textMuted, marginBottom: -4,
  },
  typeChips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
  },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: techUi.borderSoft,
    backgroundColor: techUi.surfaceSoft,
  },
  typeChipSelected: {
    borderColor: techUi.accent,
    backgroundColor: techUi.accent + '22',
  },
  typeChipText: {
    fontSize: 13, lineHeight: 18, fontWeight: '600', color: techUi.textMuted,
  },
  typeChipTextSelected: { color: techUi.accent },
  filePickerBtn: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed' as const,
    borderColor: techUi.accent,
    backgroundColor: techUi.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filePickerBtnDisabled: { opacity: 0.5 },
  filePickerBtnText: {
    fontSize: 13, lineHeight: 18, fontWeight: '600', color: techUi.accent,
  },
  medicalConsentBox: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    padding: spacing.md,
    gap: spacing.sm,
  },
  medicalConsentTitle: {
    fontSize: 12, lineHeight: 16, fontWeight: '700',
    color: techUi.amber, textTransform: 'uppercase' as const, letterSpacing: 0.4,
  },
  medicalConsentDesc: {
    fontSize: 12, lineHeight: 18, color: techUi.textSoft,
  },
  medicalConsentRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    borderColor: techUi.borderSoft,
    backgroundColor: techUi.surfaceSoft,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  checkboxChecked: {
    borderColor: techUi.accent,
    backgroundColor: techUi.accent + '22',
  },
  checkmark: { fontSize: 13, color: techUi.accent, fontWeight: '700', lineHeight: 16 },
  medicalConsentLabel: {
    flex: 1, fontSize: 13, lineHeight: 19, color: techUi.textSoft,
  },
  uploadError: {
    fontSize: 13, lineHeight: 18, fontWeight: '500',
    color: techUi.red, textAlign: 'center',
  },
  uploadSubmitBtn: { marginTop: 2 },
  cancelLink: { alignSelf: 'center', paddingVertical: 4 },
  cancelLinkText: {
    fontSize: 13, lineHeight: 18, fontWeight: '600', color: techUi.textMuted,
  },

  // Document list
  listBlock: { gap: spacing.sm },
  listTitle: {
    fontSize: 15, lineHeight: 20, fontWeight: '700',
    color: techUi.text, marginBottom: 2,
  },
  documentCard: { gap: spacing.md },
  rejectionNote: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rejectionLabel: {
    fontSize: 11, lineHeight: 14, fontWeight: '700',
    color: techUi.red, marginBottom: 3,
    textTransform: 'uppercase' as const, letterSpacing: 0.5,
  },
  rejectionText: {
    fontSize: 12, lineHeight: 17, fontWeight: '500', color: techUi.textSoft,
  },
  documentTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', gap: spacing.md,
  },
  documentInfo: { flex: 1, minWidth: 0, gap: spacing.xs },
  badgeRow: { flexDirection: 'row' },
  fileName: {
    fontSize: 15, lineHeight: 21, fontWeight: '700', color: techUi.text,
  },
  documentMeta: {
    flexDirection: 'row', gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: techUi.borderSoft,
  },
  metaItem: {
    flex: 1, minWidth: 0, borderRadius: 14,
    backgroundColor: techUi.surfaceSoft,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  metaLabel: {
    fontSize: 11, lineHeight: 14, fontWeight: '600',
    color: techUi.textMuted, marginBottom: 2,
  },
  metaValue: {
    fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.textSoft,
  },
});
