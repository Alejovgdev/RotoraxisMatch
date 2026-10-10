// Bloques de una oferta tal como los ve el técnico (rediseño, fases 5A y 5B),
// compartidos por la página de oferta y el detalle de una oferta directa:
//   - OfferTags: aviones o helicópteros, contrato, salario y años mínimos;
//   - OfferChecklistSection: "What they ask vs. your profile" con sus avisos
//     (src/utils/offerChecklist.ts, el mismo score que da el %);
//   - OfferAboutRole: lo que la oferta pide sin puntuar (tipo de perfil,
//     trabajo certificado, "sólo sin licencia") y la descripción.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui';
import { KeyValueRow, Section } from '../company/CompanyPage';
import { OfferChecklist, OfferChecklistNotices } from './OfferChecklist';
import { colors } from '../../theme';
import { formatOfferSalary } from '../../utils/offerSalary';
import { getOfferProductTypeLabel } from '../../constants/offerProductTypes';
import { technicianTypeLabel } from '../../constants/technicianTypes';
import { ONLY_UNLICENSED_TEXT, offerCertificationText } from '../../utils/offerRequirementsText';
import { offerChecklistNotices, offerChecklistRows } from '../../utils/offerChecklist';
import { contractLabel } from '../../utils/technicianOffers';
import type { AircraftRatingIndex } from '../../constants/aircraftTypeRatings';
import type { EngineIndex } from '../../constants/engines';
import type { OfferWithRequirements } from '../../types/offer';
import type { MatchScore } from '../../types/matching';

/** Las etiquetas bajo el título (maqueta T-Offer: "Airplanes", "Permanent", "Salary not specified"). */
export function OfferTags({ offer }: { offer: OfferWithRequirements }) {
  const salary = formatOfferSalary(offer.salary);
  return (
    <View style={styles.tags}>
      <Tag label={getOfferProductTypeLabel(offer.productType)} tone="product" />
      <Tag label={contractLabel(offer.contractType)} />
      <Tag label={salary ?? 'Salary not specified'} tone={salary ? 'default' : 'muted'} />
      {offer.minYearsExperience > 0 ? <Tag label={`${offer.minYearsExperience}+ yrs exp`} /> : null}
    </View>
  );
}

function Tag({ label, tone = 'default' }: { label: string; tone?: 'default' | 'product' | 'muted' }) {
  return (
    <View style={[styles.tag, tone === 'product' && styles.tagProduct]}>
      <Text
        style={[styles.tagText, tone === 'product' && styles.tagTextProduct, tone === 'muted' && styles.tagTextMuted]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * La checklist y, debajo, los avisos de hoy. Sin score (no se pudo calcular),
 * las filas dicen lo que pide la oferta, sin estado ni avisos.
 */
export function OfferChecklistSection({
  offer,
  score,
  wide,
  ratingIndex,
  engineIndex,
}: {
  offer: OfferWithRequirements;
  score: MatchScore | null;
  wide: boolean;
  ratingIndex: AircraftRatingIndex;
  engineIndex: EngineIndex;
}) {
  return (
    <>
      <Section title="What they ask vs. your profile" wide={wide} gap={2}>
        <OfferChecklist rows={offerChecklistRows(offer, score, ratingIndex, engineIndex)} />
      </Section>
      {score ? <OfferChecklistNotices notices={offerChecklistNotices(score)} /> : null}
    </>
  );
}

export function OfferAboutRole({ offer, wide }: { offer: OfferWithRequirements; wide: boolean }) {
  const rows: { label: string; value: string }[] = [
    // En una oferta de motor el tipo no se decía (la fila del motor lo cubre).
    ...(offer.offerKind !== 'engine' ? [{ label: 'Profile type', value: technicianTypeLabel(offer.technicianType) }] : []),
    { label: 'Certified work', value: offerCertificationText(offer) },
    ...(offer.onlyUnlicensed ? [{ label: 'Candidates', value: ONLY_UNLICENSED_TEXT }] : []),
  ];
  return (
    <Section title="About the role" wide={wide}>
      <View>
        {rows.map((row, i) => (
          <KeyValueRow key={row.label} label={row.label} value={row.value} last={i === rows.length - 1} />
        ))}
      </View>
      {offer.description ? <Text style={styles.description}>{offer.description}</Text> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  tag: {
    minHeight: 28,
    paddingHorizontal: 11,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  tagProduct: {
    backgroundColor: '#DCE7FB',
  },
  tagText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  tagTextProduct: {
    color: '#1E4FB8',
  },
  tagTextMuted: {
    fontWeight: '700',
    color: colors.textSecondary,
  },
  description: {
    marginTop: 6,
    fontSize: 14.5,
    lineHeight: 22,
    color: '#33465A',
  },
});
