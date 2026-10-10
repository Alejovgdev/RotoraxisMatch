import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { CheckCircle, Clock, Send } from 'lucide-react-native';
import type { SafeTechnicianView } from '../../types';
import type { MapOfferMatchOption } from '../../types/mapOffers';
import type { TechnicianMapMarkerGroup } from '../../utils/technicianMapMarkers';
import { colors, spacing } from '../../theme';
import { MapBottomSheet } from '../map/MapBottomSheet';
import { techUi } from '../technician/TechnicianUI';
import { formatLocation } from '../../utils/formatLocation';

// El panel de filtros del mapa ya no vive aquí: búsqueda y mapa comparten
// TechnicianFiltersSheet (src/components/company/TechnicianFiltersPanel.tsx,
// rediseño fase 3B). Aquí quedan la hoja del técnico y la de sus ofertas, sin cambios.

export function TechnicianMapDetailSheet({
  group,
  tradeLabelsById,
  typeRatingLabelsById,
  onClose,
  onViewProfile,
  onStartDirectOffer,
}: {
  group: TechnicianMapMarkerGroup<SafeTechnicianView> | null;
  tradeLabelsById: Record<string, string[]>;
  typeRatingLabelsById: Record<string, string[]>;
  onClose: () => void;
  onViewProfile?: (technicianId: string) => void;
  onStartDirectOffer: (technicianId: string) => void;
}) {
  const representative = group?.technicians[0];
  const grouped = (group?.technicians.length ?? 0) > 1;
  const location = representative ? formatLocation(representative.city, representative.country) : undefined;

  return (
    <MapBottomSheet
      closeLabel="Close technician details"
      contentContainerStyle={styles.detailContent}
      onClose={onClose}
      subtitle={location}
      title={grouped ? `${group?.technicians.length} technicians at this location` : 'Technician details'}
      visible={group !== null}
    >
      {group?.technicians.map((technician) => {
        const trades = tradeLabelsById[technician.id] ?? [];
        const ratings = typeRatingLabelsById[technician.id] ?? [];
        const availability = technician.availability.status ?? 'unavailable';
        return (
          <View key={technician.id} style={styles.technicianCard}>
            <Avatar kind="person" size={44} photoPath={technician.fullName ? technician.photoPath : null} anonymous={!technician.fullName} name={technician.fullName} />
            <Text style={styles.technicianName}>{technician.fullName ?? technician.anonymousCode}</Text>
            <Text style={styles.technicianMeta}>
              {formatLocation(technician.city, technician.country)}
              {technician.baseAirport ? ` · ${technician.baseAirport}` : ''}
              {' · '}{technician.yearsExperience} yrs exp
            </Text>

            <View style={styles.chipRow}>
              {trades.length > 0
                ? trades.map((label) => <DetailChip key={label} label={label} tone="accent" />)
                : <Text style={styles.emptyDetailText}>Trade not specified</Text>}
            </View>

            <View style={styles.chipRow}>
              <DetailChip
                label={availability === 'open_to_offers' ? 'Open to offers' : 'Unavailable'}
                tone={availability === 'open_to_offers' ? 'success' : 'muted'}
              />
              <DetailChip
                label={technician.verificationStatus}
                tone={technician.verificationStatus === 'verified' ? 'success' : technician.verificationStatus === 'pending' ? 'warning' : 'muted'}
              />
            </View>

            {technician.licenseCategories.length > 0 ? (
              <DetailBlock label="Licenses" value={technician.licenseCategories.join(' · ')} />
            ) : null}
            {ratings.length > 0 ? (
              <DetailBlock
                label="Type ratings"
                value={`${ratings.slice(0, 4).join(' · ')}${ratings.length > 4 ? ` +${ratings.length - 4}` : ''}`}
              />
            ) : null}

            <View style={styles.detailActions}>
              {technician.fullName && onViewProfile ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.75}
                  onPress={() => {
                    onClose();
                    onViewProfile(technician.id);
                  }}
                  style={styles.secondaryAction}
                >
                  <Text style={styles.secondaryActionText}>View profile</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.78}
                onPress={() => onStartDirectOffer(technician.id)}
                style={styles.primaryAction}
              >
                <Text style={styles.primaryActionText}>Send direct offer</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </MapBottomSheet>
  );
}

function DetailChip({ label, tone }: { label: string; tone: 'accent' | 'success' | 'warning' | 'muted' }) {
  const palette = tone === 'accent'
    ? { background: techUi.accentSoft, color: techUi.accent }
    : tone === 'success'
      ? { background: techUi.greenSoft, color: techUi.green }
      : tone === 'warning'
        ? { background: techUi.amberSoft, color: techUi.amber }
        : { background: techUi.surface, color: techUi.textMuted };
  return (
    <View style={[styles.detailChip, { backgroundColor: palette.background }]}>
      <Text style={[styles.detailChipText, { color: palette.color }]}>{label}</Text>
    </View>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailBlock}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function offerScoreColor(score: number): string {
  if (score >= 80) return colors.success;
  if (score >= 60) return colors.blue;
  if (score >= 40) return colors.warning;
  return colors.textMuted;
}

function requestStatusLabel(status?: string): string {
  if (status === 'pending') return 'Pending';
  if (status === 'accepted') return 'Accepted';
  if (status === 'rejected' || status === 'withdrawn') return 'Send again';
  return 'Send';
}

function isRequestLocked(status?: string): boolean {
  return status === 'pending' || status === 'accepted';
}

export function TechnicianOfferSelectionSheet({
  technician,
  options,
  loading,
  sendingOfferId,
  error,
  onSend,
  onClose,
}: {
  technician: SafeTechnicianView | null;
  options: MapOfferMatchOption[];
  loading: boolean;
  sendingOfferId: string | null;
  error?: string | null;
  onSend: (offerId: string) => void;
  onClose: () => void;
}) {
  return (
    <MapBottomSheet
      closeLabel="Close direct offer panel"
      contentContainerStyle={styles.offerSelectionContent}
      onClose={onClose}
      subtitle={technician ? technician.fullName ?? technician.anonymousCode : undefined}
      title="Send direct offer"
      visible={technician !== null}
    >
      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={techUi.accent} size="large" />
          <Text style={styles.stateText}>Calculating offer matches...</Text>
        </View>
      ) : null}

      {!loading && error ? <Text style={styles.errorText}>{error}</Text> : null}

      {!loading && options.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No published offers</Text>
          <Text style={styles.stateText}>Publish a job offer before sending direct offers from the map.</Text>
        </View>
      ) : null}

      {!loading && options.map((option) => {
        const locked = isRequestLocked(option.requestStatus);
        const sending = sendingOfferId === option.offerId;
        const accent = offerScoreColor(option.score);
        return (
          <View key={option.offerId} style={styles.offerOption}>
            <View style={styles.offerTopRow}>
              <View style={styles.offerCopy}>
                <Text style={styles.offerTitle}>{option.title}</Text>
                <Text style={styles.offerMeta}>{option.location} · {option.contractType.replace(/_/g, ' ')}</Text>
              </View>
              <View style={[styles.scoreBadge, { borderColor: accent }]}>
                <Text style={[styles.scoreValue, { color: accent }]}>{option.score}%</Text>
                <Text style={styles.scoreLabel}>match</Text>
              </View>
            </View>
            <View style={styles.offerBottomRow}>
              <Text style={styles.matchLabel}>{option.label}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.75}
                disabled={locked || sending}
                onPress={() => onSend(option.offerId)}
                style={[styles.sendButton, (locked || sending) && styles.sendButtonDisabled]}
              >
                {sending ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : locked ? (
                  option.requestStatus === 'accepted'
                    ? <CheckCircle color={colors.white} size={15} strokeWidth={2.2} />
                    : <Clock color={colors.white} size={15} strokeWidth={2.2} />
                ) : (
                  <Send color={colors.white} size={15} strokeWidth={2.2} />
                )}
                <Text style={styles.sendButtonText}>
                  {sending ? 'Sending...' : requestStatusLabel(option.requestStatus)}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </MapBottomSheet>
  );
}

const styles = StyleSheet.create({
  detailContent: { gap: spacing.sm },
  technicianCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: techUi.borderSoft,
    backgroundColor: techUi.surfaceSoft,
  },
  technicianName: { fontSize: 15, lineHeight: 20, fontWeight: '800', color: techUi.text },
  technicianMeta: { marginTop: 3, fontSize: 12, lineHeight: 17, fontWeight: '600', color: techUi.textMuted },
  chipRow: { marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  emptyDetailText: { fontSize: 11, lineHeight: 15, fontWeight: '600', color: techUi.textMuted },
  detailChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 11 },
  detailChipText: { fontSize: 11, lineHeight: 14, fontWeight: '800', textTransform: 'capitalize' },
  detailBlock: { marginTop: 10 },
  detailLabel: { fontSize: 10, lineHeight: 13, fontWeight: '800', color: techUi.textMuted, textTransform: 'uppercase' },
  detailValue: { marginTop: 3, fontSize: 12, lineHeight: 17, fontWeight: '600', color: techUi.textSoft },
  detailActions: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  secondaryAction: {
    minHeight: 48,
    minWidth: 132,
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: techUi.accent,
    backgroundColor: techUi.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: { color: techUi.accent, fontSize: 13, fontWeight: '800' },
  primaryAction: {
    minHeight: 48,
    minWidth: 156,
    flexGrow: 1,
    borderRadius: 14,
    backgroundColor: techUi.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  offerSelectionContent: { gap: spacing.sm },
  loadingState: { minHeight: 112, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyState: { padding: spacing.lg, borderRadius: 16, borderWidth: 1, borderColor: techUi.borderSoft, backgroundColor: techUi.surfaceSoft },
  emptyTitle: { marginBottom: 5, fontSize: 15, fontWeight: '800', color: techUi.text },
  stateText: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: techUi.textMuted },
  errorText: { padding: 12, borderRadius: 12, fontSize: 12, lineHeight: 17, fontWeight: '700', color: techUi.red, backgroundColor: techUi.redSoft },
  offerOption: { padding: 13, borderRadius: 16, borderWidth: 1, borderColor: techUi.borderSoft, backgroundColor: techUi.surfaceSoft },
  offerTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  offerCopy: { flex: 1, minWidth: 0 },
  offerTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800', color: techUi.text },
  offerMeta: { marginTop: 3, fontSize: 12, lineHeight: 16, fontWeight: '600', color: techUi.textMuted, textTransform: 'capitalize' },
  scoreBadge: { minWidth: 58, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 14, borderWidth: 1, backgroundColor: techUi.surface, alignItems: 'center' },
  scoreValue: { fontSize: 15, lineHeight: 18, fontWeight: '900' },
  scoreLabel: { fontSize: 9, lineHeight: 11, fontWeight: '800', color: techUi.textMuted, textTransform: 'uppercase' },
  offerBottomRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  matchLabel: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '700', color: techUi.textSoft },
  sendButton: { minHeight: 44, paddingHorizontal: 12, borderRadius: 999, backgroundColor: techUi.navy, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sendButtonDisabled: { backgroundColor: techUi.textMuted },
  sendButtonText: { color: colors.white, fontSize: 12, fontWeight: '800' },
});
