import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Upload } from 'lucide-react-native';
import { useGoBack } from '../../../src/state/useGoBack';
import { supabase } from '../../../src/lib/supabase';

const CONSENT_VERSION = '2025-06';
import * as DocumentPicker from 'expo-document-picker';
import { Chip, Text } from '../../../src/components/ui';
import {
  EmptyBlock,
  PillButton,
  SectionTitle,
  StatGrid,
  StatTile,
  StatusPill,
} from '../../../src/components/company/CompanyPage';
import { ProfileScreenFrame, ProfileSectionLoading } from '../../../src/components/technician/ProfileParts';
import { AddPanel, CheckboxRow, workStyles } from '../../../src/components/technician/WorkParts';
import { useTechnicianDashboard } from '../../../src/state/useTechnicianDashboard';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { documentRepositoryV2 } from '../../../src/repositories/v2/documentRepositoryV2';
import {
  validateDocumentFile,
  uploadDocumentToStorage,
  removeDocumentFromStorage,
} from '../../../src/lib/documentStorage';
import { colors } from '../../../src/theme';
import { radius } from '../../../src/theme/ui';
import type { UiTone } from '../../../src/theme/ui';
import type { DocumentStatus, DocumentType, TechnicianDocument } from '../../../src/types';

// Documents (rediseño, fase 6A; maqueta T-Docs). Cambia el aspecto: recuentos,
// el botón grande "Upload a document" y la lista "On file" con su estado. La
// lógica es la de antes, sin cambios: tipos de documento, el selector de
// ficheros con su validación, el consentimiento médico ANTES de subir nada, la
// subida a Storage y su marcha atrás si el registro falla.

const TYPE_LABELS: Record<DocumentType, string> = {
  license:  'License',
  medical:  'Medical',
  training: 'Training',
  id:       'ID',
  resume:   'Resume',
  other:    'Other',
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  verified: 'Verified',
  pending:  'Under review',
  rejected: 'Rejected',
  expired:  'Expired',
};

const STATUS_TONES: Record<DocumentStatus, UiTone> = {
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

/** El cuadrado del fichero (T-Docs): "PDF" en rojo suave; una imagen, "IMG". */
function fileKind(fileName: string): { label: string; bg: string; fg: string } {
  return /\.pdf$/i.test(fileName)
    ? { label: 'PDF', bg: colors.errorSoft, fg: colors.error }
    : { label: 'IMG', bg: colors.primarySoft, fg: colors.info };
}

function DocumentRow({ document }: { document: TechnicianDocument }) {
  const expiresAt = (document as TechnicianDocument & { expiresAt?: string }).expiresAt;
  const rejectionReason = (document as TechnicianDocument & { rejectionReason?: string }).rejectionReason;
  const kind = fileKind(document.fileName);
  const meta = [
    TYPE_LABELS[document.type],
    `uploaded ${formatDate(document.uploadedAt)}`,
    expiresAt ? `expires ${formatDate(expiresAt)}` : 'no expiry date',
  ].join(' · ');

  return (
    <View style={styles.doc}>
      <View style={styles.docRow}>
        <View style={[styles.docTile, { backgroundColor: kind.bg }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[styles.docTileText, { color: kind.fg }]}>{kind.label}</Text>
        </View>
        <View style={styles.docCopy}>
          <Text style={styles.docName} numberOfLines={1}>{document.fileName}</Text>
          <Text style={styles.docMeta}>{meta}</Text>
        </View>
        <StatusPill label={STATUS_LABELS[document.status]} tone={STATUS_TONES[document.status]} />
      </View>
      {document.status === 'rejected' && rejectionReason ? (
        <View style={styles.rejection}>
          <Text style={styles.rejectionLabel}>Reason for rejection</Text>
          <Text style={styles.rejectionText}>{rejectionReason}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function TechnicianDocumentsScreen() {
  const goBack = useGoBack();
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const { documents, loading, refresh } = useTechnicianDashboard();

  // Fase 6B: el "+" y el asistente de licencia llegan con la subida abierta
  // (?upload=1, o ?upload=license con el tipo preelegido). Es sólo el estado
  // inicial de la pantalla: la subida es la de siempre y el documento no queda
  // ligado a ninguna licencia.
  const { upload } = useLocalSearchParams<{ upload?: string }>();
  const [uploadOpen, setUploadOpen] = useState(Boolean(upload));
  const [uploadType, setUploadType] = useState<DocumentType | null>(upload === 'license' ? 'license' : null);
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

  // En móvil, la pantalla de carga de siempre; en el layout de You de
  // escritorio, un hueco con el indicador (fase 8).
  if (loading && documents.length === 0) return <ProfileSectionLoading />;

  return (
    <ProfileScreenFrame title="Documents" subtitle="Licences and certificates to verify your profile" onBack={goBack} backLabel="Back">
      <StatGrid columns={3}>
        <StatTile big label="Verified" value={verifiedCount} valueColor="#0B5B3A" />
        <StatTile big label="Under review" value={pendingCount} valueColor={colors.warning} />
        <StatTile big label="Total" value={documents.length} valueColor={attentionCount > 0 ? colors.error : undefined} />
      </StatGrid>

      {/* ── Subida ─────────────────────────────────────────────── */}
      {uploadOpen ? (
        <AddPanel>
          <Text style={styles.uploadTitle} accessibilityRole="header">Upload a document</Text>

          <Text style={workStyles.fieldLabel}>Document type</Text>
          <View style={workStyles.chipRow}>
            {(Object.keys(TYPE_LABELS) as DocumentType[]).map((type) => (
              <Chip
                key={type}
                label={TYPE_LABELS[type]}
                selected={uploadType === type}
                onPress={() => setUploadType(type)}
                disabled={uploading}
              />
            ))}
          </View>

          <Pressable
            style={({ pressed, hovered }: any) => [styles.filePicker, uploading && styles.disabled, (pressed || hovered) && styles.pressed]}
            onPress={handlePickFile}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel={pickedFile ? `Chosen file: ${pickedFile.name}. Choose another` : 'Choose file'}
          >
            <Text style={styles.filePickerText} numberOfLines={1}>
              {pickedFile ? pickedFile.name : 'Choose file  ·  PDF, JPG, PNG — max 5 MB'}
            </Text>
          </Pressable>

          {/* Medical document consent — required for GDPR Art. 9 */}
          {uploadType === 'medical' && (
            <View style={styles.consent}>
              <Text style={styles.consentTitle}>Medical document consent required</Text>
              <Text style={styles.consentText}>
                Medical certificates contain health data (special category under GDPR Art. 9). They are used exclusively by our admin team for licence verification and are never shared with companies.
              </Text>
              <CheckboxRow
                label="I explicitly consent to the processing of this medical document for verification purposes only."
                checked={medicalConsentAccepted}
                onPress={() => setMedicalConsentAccepted((v) => !v)}
                disabled={uploading}
              />
            </View>
          )}

          {uploadError ? (
            <Text accessibilityRole="alert" style={styles.uploadError}>{uploadError}</Text>
          ) : null}

          <View style={workStyles.buttons}>
            <PillButton label="Cancel" variant="outline" size="md" onPress={handleCancelUpload} disabled={uploading} />
            <PillButton
              label="Upload"
              size="md"
              onPress={handleUpload}
              loading={uploading}
              disabled={!uploadType || !pickedFile || uploading || (uploadType === 'medical' && !medicalConsentAccepted)}
            />
          </View>
        </AddPanel>
      ) : (
        <Pressable
          onPress={() => setUploadOpen(true)}
          style={({ pressed, hovered }: any) => [styles.uploadButton, (pressed || hovered) && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Upload a document. PDF or a photo of your licence"
        >
          <View style={styles.uploadIcon}>
            <Upload color={colors.white} size={22} strokeWidth={2.2} />
          </View>
          <View style={styles.uploadCopy}>
            <Text style={styles.uploadButtonTitle}>Upload a document</Text>
            <Text style={styles.uploadButtonSub}>PDF or a photo of your licence</Text>
          </View>
        </Pressable>
      )}

      {/* ── Lista ──────────────────────────────────────────────── */}
      {documents.length === 0 ? (
        <EmptyBlock
          title="No documents on file"
          text="Upload your licenses and certificates to start the verification process."
        />
      ) : (
        <View style={styles.list}>
          <SectionTitle>On file</SectionTitle>
          {documents.map((document) => (
            <DocumentRow key={document.id} document={document} />
          ))}
        </View>
      )}
    </ProfileScreenFrame>
  );
}

const styles = StyleSheet.create({
  pressed: {
    backgroundColor: colors.surfaceSoft,
  },
  disabled: {
    opacity: 0.5,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#B8C8D9',
    backgroundColor: '#F7FAFC',
  },
  uploadIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  uploadButtonTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  uploadButtonSub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  filePicker: {
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  filePickerText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.primary,
  },
  consent: {
    gap: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFF6E2',
  },
  consentTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.warning,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  consentText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  uploadError: {
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '700',
    color: colors.error,
  },
  list: {
    gap: 8,
  },
  doc: {
    gap: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E1E8EE',
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  docTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  docTileText: {
    fontSize: 11,
    fontWeight: '900',
  },
  docCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  docName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  docMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  rejection: {
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.errorSoft,
  },
  rejectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.error,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rejectionText: {
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
  },
});
