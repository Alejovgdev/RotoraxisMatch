// La tarjeta "Best match for you" de la Home del técnico (rediseño, fase 5A;
// maqueta T-Home). Muestra lo que antes mostraba "Your next opportunity": la
// oferta, su %, hasta tres motivos y, por debajo de 60, qué mirar antes de
// aplicar. Sin oferta que recomendar, las pistas para mejorar el perfil de
// antes. Qué oferta va aquí lo decide src/utils/technicianHome.ts.
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { CircleCheck, Clock } from 'lucide-react-native';
import { Avatar, Text } from '../ui';
import { PillButton } from '../company/CompanyPage';
import { MatchPill } from './OfferCards';
import { colors } from '../../theme';
import { radius, TOUCH_TARGET } from '../../theme/ui';
import { getMatchDisplayLabel } from '../../utils/offerMatchExplain';
import type { OfferMatchResult } from '../../utils/matchingService';
import {
  STRONG_MATCH,
  bestMatchKicker,
  opportunityCaution,
  opportunityReasons,
  profileImprovementHints,
} from '../../utils/technicianHome';
import { contractLabel, offerCompanyPlaceLine } from '../../utils/technicianOffers';

export function BestMatchCard({
  wide,
  loading,
  failed,
  featured,
  bestEligible,
  companyName,
  logoPath,
  onOpen,
  onBrowse,
  onCompleteProfile,
}: {
  wide: boolean;
  loading: boolean;
  failed: boolean;
  featured: OfferMatchResult | null;
  bestEligible: OfferMatchResult | null;
  companyName: string | null;
  logoPath?: string | null;
  onOpen: (id: string) => void;
  onBrowse: () => void;
  onCompleteProfile: () => void;
}) {
  if (loading) {
    return (
      <View style={[styles.softCard, styles.stateCard]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.stateText}>Comparing published offers with your profile...</Text>
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.softCard}>
        <Text style={styles.kicker}>Opportunities unavailable</Text>
        <Text style={styles.stateText}>We could not compare your profile with published offers right now.</Text>
        <View style={styles.actions}>
          <PillButton label="Browse all offers" variant="outline" size="md" onPress={onBrowse} />
        </View>
      </View>
    );
  }

  if (!featured) {
    // Como antes: sin una oferta que merezca recomendarse, qué tocar del perfil.
    return (
      <View style={styles.softCard}>
        <Text style={styles.kicker}>Improve your matches</Text>
        <Text style={styles.improveTitle}>No strong opportunities yet</Text>
        <Text style={styles.stateText}>Update the details that most influence your matches with published offers.</Text>
        <View style={styles.hints}>
          {profileImprovementHints(bestEligible).map((hint) => (
            <View key={hint} style={styles.hintRow}>
              <View style={styles.hintDot} />
              <Text style={styles.hintText}>{hint}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.actions, styles.actionsRow]}>
          <PillButton label="Complete profile" size="md" onPress={onCompleteProfile} />
          <PillButton label="Browse all offers" variant="outline" size="md" onPress={onBrowse} />
        </View>
      </View>
    );
  }

  const { offer, score } = featured;
  const reasons = opportunityReasons(featured);
  const meta = [offerCompanyPlaceLine(companyName, offer), contractLabel(offer.contractType)].join(' · ');

  return (
    <Pressable
      onPress={() => onOpen(offer.id)}
      style={({ pressed, hovered }: any) => [styles.card, wide && styles.cardWide, (pressed || hovered) && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${bestMatchKicker(score.total)}: ${offer.title}, ${score.total}% match. View offer`}
    >
      <View style={styles.head}>
        <Text style={styles.kicker}>{bestMatchKicker(score.total)}</Text>
        <MatchPill total={score.total} label={getMatchDisplayLabel(offer, score)} />
      </View>
      <View style={styles.offer}>
        <Avatar kind="company" size={52} name={companyName} logoPath={logoPath} />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>{offer.title}</Text>
          <Text style={styles.meta} numberOfLines={2}>{meta}</Text>
        </View>
      </View>
      <View style={styles.reasons}>
        {reasons.map((reason) => (
          <View key={reason} style={styles.reasonRow}>
            <CircleCheck size={15} color={colors.success} strokeWidth={2.2} />
            <Text style={styles.reasonText}>{reason}</Text>
          </View>
        ))}
        {score.total < STRONG_MATCH ? (
          <View style={styles.reasonRow}>
            <Clock size={15} color={colors.warning} strokeWidth={2.2} />
            <Text style={[styles.reasonText, styles.cautionText]}>Check before applying: {opportunityCaution(featured)}</Text>
          </View>
        ) : null}
      </View>
      {/* Parece un botón pero es parte de la tarjeta: toda ella abre la oferta. */}
      <View style={styles.button}>
        <Text style={styles.buttonText}>View offer</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  softCard: {
    padding: 16,
    borderRadius: 20,
    backgroundColor: colors.surfaceSoft,
    gap: 8,
  },
  stateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stateText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  kicker: {
    flexShrink: 1,
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#2E4C66',
  },
  actions: {
    marginTop: 6,
    alignItems: 'flex-start',
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  improveTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  hints: {
    gap: 6,
    marginTop: 2,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  hintDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: colors.primary,
  },
  hintText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },

  card: {
    padding: 16,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    gap: 12,
  },
  cardWide: {
    padding: 20,
  },
  cardPressed: {
    backgroundColor: '#DCEBF5',
  },
  head: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  meta: {
    fontSize: 13.5,
    color: '#2E4C66',
  },
  reasons: {
    gap: 6,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  reasonText: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.text,
  },
  cautionText: {
    color: colors.warning,
    fontWeight: '700',
  },
  button: {
    height: TOUCH_TARGET,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.white,
  },
});
