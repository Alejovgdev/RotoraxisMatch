import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Text } from '../ui';
import { Section, StatusPill } from './CompanyPage';
import type { OfferInboxRecord } from '../../types/offerRequest';
import type { Offer } from '../../types/offer';
import { applicationStatusLook, directOfferStatusLook } from '../../utils/companyStatus';
import { companyRelationPath } from '../../utils/companyTechnicianRelations';
import { relativeTime } from '../../utils/companyHome';
import { colors } from '../../theme';

/** Navigation only. Detail screens retain their existing Viewer permissions. */
export function CompanyTechnicianHistory({ relations, offers }: { relations: OfferInboxRecord[]; offers: Offer[] }) {
  const router = useRouter();
  return (
    <Section title="With your company">
      {relations.length === 0 ? <Text style={styles.meta}>No applications or direct offers with your company.</Text> : null}
      {relations.map((row) => {
        const kind = row.kind === 'application' ? 'Application' : 'Direct offer';
        const look = row.kind === 'application' ? applicationStatusLook(row.status) : directOfferStatusLook(row.status);
        const title = row.offerId ? offers.find((offer) => offer.id === row.offerId)?.title ?? 'Offer unavailable' : 'No linked offer';
        return (
          <Pressable key={`${row.kind}:${row.id}`} onPress={() => router.push(companyRelationPath(row) as never)}
            style={({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && styles.pressed]}
            accessibilityRole="button" accessibilityLabel={`${kind}: ${title}, ${look.label}, ${relativeTime(row.createdAt)}`}>
            <View style={styles.copy}>
              <Text style={styles.meta}>{kind} · {relativeTime(row.createdAt)}</Text>
              <Text style={styles.title}>{title}</Text>
              <View style={styles.status}><StatusPill label={look.label} tone={look.tone} /></View>
            </View>
            <ChevronRight size={20} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 44, borderWidth: 1, borderColor: colors.borderLight, borderRadius: 16 },
  pressed: { backgroundColor: colors.surfaceSoft },
  copy: { flex: 1, gap: 6 },
  meta: { fontSize: 13, color: colors.textSecondary },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  status: { alignItems: 'flex-start' },
});
