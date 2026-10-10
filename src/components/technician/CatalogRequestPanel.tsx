// "Request a catalog addition" (rediseño, fase 6A): el panel que vivía al final
// del formulario del perfil, ahora en My work con el estilo nuevo. Misma
// lógica: lo que se pide va al equipo de la plataforma (catalog_requests) y no
// cuenta para el matching hasta que se añade al catálogo.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Text, TextInput } from '../ui';
import { colors } from '../../theme';
import { PillButton } from '../company/CompanyPage';
import { WorkNote, WorkSectionHeader, workStyles } from './WorkParts';
import { useAuth } from '../../auth/AuthContext';
import { catalogRequestRepository } from '../../repositories/v2/catalogRequestRepository';
import { LICENSE_CATEGORIES } from '../../constants/licenses';

export function CatalogRequestPanel() {
  const { profile } = useAuth();
  const [requestLicense, setRequestLicense] = useState<string | null>(null);
  const [requestAircraft, setRequestAircraft] = useState('');
  const [requestLabel, setRequestLabel] = useState('');
  const [requestNotes, setRequestNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!profile?.id || !requestLabel.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await catalogRequestRepository.create({
        requestedBy: profile.id,
        rawText: requestLabel.trim(),
        context: [
          requestLicense && `License: ${requestLicense}`,
          requestAircraft.trim() && `Aircraft/family: ${requestAircraft.trim()}`,
          requestNotes.trim(),
        ]
          .filter(Boolean)
          .join(' — ') || undefined,
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message ?? 'Could not send the request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.panel}>
      <WorkSectionHeader
        title="Request a catalog addition"
        subtitle="Sent to the platform team for review — it will not be used for matching until added."
      />
      <Text style={workStyles.fieldLabel}>Category</Text>
      <View style={workStyles.chipRow}>
        {LICENSE_CATEGORIES.map((lic) => (
          <Chip key={lic.code} label={lic.code} selected={requestLicense === lic.code} onPress={() => setRequestLicense(lic.code)} />
        ))}
      </View>
      <Text style={workStyles.fieldLabel}>Aircraft or family</Text>
      <TextInput
        style={workStyles.input}
        value={requestAircraft}
        onChangeText={setRequestAircraft}
        placeholder="e.g. AW169"
        placeholderTextColor={colors.placeholder}
        accessibilityLabel="Aircraft or family"
      />
      <Text style={workStyles.fieldLabel}>Name as it appears on your license</Text>
      <TextInput
        style={workStyles.input}
        value={requestLabel}
        onChangeText={setRequestLabel}
        placeholder="e.g. AW169 (PWC 210)"
        placeholderTextColor={colors.placeholder}
        accessibilityLabel="Name as it appears on your license"
      />
      <Text style={workStyles.fieldLabel}>Notes (optional)</Text>
      <TextInput
        style={[workStyles.input, styles.textarea]}
        value={requestNotes}
        onChangeText={setRequestNotes}
        placeholder="Anything else that helps identify it"
        placeholderTextColor={colors.placeholder}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        accessibilityLabel="Notes"
      />
      {error ? <WorkNote tone="error">{error}</WorkNote> : null}
      {submitted ? (
        <WorkNote>Request pending catalog addition.</WorkNote>
      ) : (
        <View style={workStyles.buttons}>
          <PillButton
            label="Send request"
            variant="accent"
            size="sm"
            loading={submitting}
            disabled={!requestLabel.trim() || submitting}
            onPress={submit}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.surfaceSoft,
  },
  textarea: {
    minHeight: 88,
    paddingTop: 12,
  },
});
