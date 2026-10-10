// Las ofertas tal como las ve el técnico en las listas del rediseño (fase 5A;
// maquetas T-Search y T-Home):
//   - OfferResultCard: la tarjeta de la rejilla de Offers (y de la Home de
//     escritorio): logo de la empresa, % arriba a la izquierda, título, empresa,
//     sitio, requisitos, contrato y, si ya hay candidatura, su estado.
//   - OfferListRow: la fila de "Offers for you" en la Home de móvil.
//   - MatchPill: el % en una píldora blanca, con los colores de siempre; si hay
//     un bloqueo, "Not eligible" en vez del número (MatchBadge hacía lo mismo).
//
// El logo es el avatar con las iniciales de la empresa: las fotos y los logos
// llegan en la fase 7. Sólo presentación: el % llega ya calculado.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar, AvatarFrame, Text } from '../ui';
import { StatusPill } from '../company/CompanyPage';
import { matchScoreColor } from '../company/MatchBreakdownBars';
import { colors } from '../../theme';
import { TOUCH_TARGET } from '../../theme/ui';
import type { OfferWithRequirements } from '../../types/offer';
import type { MatchScore } from '../../types/matching';
import type { TechnicianStatusLook } from '../../utils/technicianOffers';
import { offerCardFacts, offerCompanyPlaceLine, offerPlaceLine, offerSalaryLine } from '../../utils/technicianOffers';

export function MatchPill({
  total,
  notEligible = false,
  label,
  large = false,
}: {
  total: number;
  notEligible?: boolean;
  /** "Excellent match": tras el número, "95% · Excellent match". */
  label?: string;
  large?: boolean;
}) {
  const text = notEligible ? 'Not eligible' : label ? `${total}% · ${label}` : `${total}%`;
  return (
    <View style={[styles.pill, large && styles.pillLarge]}>
      <Text
        style={[styles.pillText, large && styles.pillTextLarge, { color: notEligible ? colors.error : matchScoreColor(total) }]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

function scoreAccessibility(score: Pick<MatchScore, 'total' | 'blockers'>): string {
  return score.blockers.length > 0 ? 'Not eligible' : `${score.total}% match`;
}

export function OfferResultCard({
  offer,
  score,
  companyName,
  logoPath,
  requirementLine,
  status,
  unread = false,
  width,
  onPress,
}: {
  offer: OfferWithRequirements;
  score: Pick<MatchScore, 'total' | 'blockers'>;
  companyName: string | null;
  logoPath?: string | null;
  /** "Mechanic · EASA B1.1": lo que pide (offerRequirementChips). */
  requirementLine: string;
  /** La candidatura del técnico a esta oferta, si existe. */
  status: TechnicianStatusLook | null;
  /** Hay novedades sin leer en su candidatura (aceptada o rechazada). */
  unread?: boolean;
  width?: number;
  onPress: () => void;
}) {
  const salary = offerSalaryLine(offer);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [styles.card, width != null && { width }, (pressed || hovered) && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={[offer.title, companyName, scoreAccessibility(score), unread ? 'New update' : null].filter(Boolean).join('. ')}
    >
      {/* La franja gris sólo con iniciales; con logo, el logo solo (fase 8, H). */}
      <AvatarFrame image={{ logoPath }} style={styles.cardTop}>
        <View style={styles.cardPill}>
          <MatchPill total={score.total} notEligible={score.blockers.length > 0} />
        </View>
        {unread ? <View style={styles.unreadDot} /> : null}
        <Avatar kind="company" size={56} name={companyName} logoPath={logoPath} />
      </AvatarFrame>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{offer.title}</Text>
        {companyName ? <Text style={styles.cardMeta} numberOfLines={1}>{companyName}</Text> : null}
        <Text style={styles.cardMeta} numberOfLines={1}>{offerPlaceLine(offer)}</Text>
        {requirementLine ? <Text style={styles.cardStrong} numberOfLines={2}>{requirementLine}</Text> : null}
        <Text style={styles.cardStrong} numberOfLines={2}>{offerCardFacts(offer)}</Text>
        {salary ? <Text style={styles.cardSalary} numberOfLines={1}>{salary}</Text> : null}
        {status ? (
          <View style={styles.cardStatus}>
            <StatusPill label={status.label} tone={status.tone} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function OfferListRow({
  offer,
  score,
  companyName,
  logoPath,
  last,
  onPress,
}: {
  offer: OfferWithRequirements;
  score: Pick<MatchScore, 'total' | 'blockers'>;
  companyName: string | null;
  logoPath?: string | null;
  last: boolean;
  onPress: () => void;
}) {
  const blocked = score.blockers.length > 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [styles.row, !last && styles.rowLine, (pressed || hovered) && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={[offer.title, companyName, scoreAccessibility(score)].filter(Boolean).join('. ')}
    >
      <Avatar kind="company" size={52} name={companyName} logoPath={logoPath} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>{offer.title}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>{offerCompanyPlaceLine(companyName, offer)}</Text>
      </View>
      {blocked
        ? <Text style={styles.rowBlocked}>Not eligible</Text>
        : <Text style={[styles.rowScore, { color: matchScoreColor(score.total) }]}>{score.total}%</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    flexShrink: 1,
  },
  pillLarge: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  pillText: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  pillTextLarge: {
    fontSize: 14,
  },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardPressed: {
    borderColor: colors.border,
  },
  cardTop: {
    height: 108,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPill: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 30,
    zIndex: 1,
  },
  unreadDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.notify,
    zIndex: 1,
  },
  cardBody: {
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 2,
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    color: colors.text,
  },
  cardMeta: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  cardStrong: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#33465A',
  },
  cardSalary: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.success,
  },
  cardStatus: {
    marginTop: 6,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: TOUCH_TARGET,
    paddingVertical: 12,
  },
  rowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  rowMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  rowScore: {
    fontSize: 17,
    fontWeight: '800',
  },
  rowBlocked: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.error,
  },
});
