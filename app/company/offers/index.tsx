import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import {
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  Edit3,
  ListChecks,
  MapPin,
  Plus,
} from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { Button } from '../../../src/components/Button';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import {
  CompanyBadge,
  CompanyCard,
  CompanyChip,
  CompanyPageHeader,
  CompanyScreen,
  EmptyPanel,
  IconBox,
  companyStyles,
  companyUi,
} from '../../../src/components/company/CompanyUI';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { formatOfferSalary } from '../../../src/utils/offerSalary';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { OfferWithRequirements } from '../../../src/types/offer';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { offerRequirementChips } from '../../../src/utils/offerRequirementsText';
import { useCompanySession, useSession } from '../../../src/state/SessionContext';
import { canManageOffers } from '../../../src/utils/companyPermissionsV2';

type OfferCounts = {
  applications: number;
  directOffers: number;
};

type StatusTone = 'success' | 'warning' | 'error' | 'muted' | 'navy';

function statusTone(status: OfferWithRequirements['status']): StatusTone {
  if (status === 'published') return 'success';
  if (status === 'draft') return 'warning';
  if (status === 'expired') return 'error';
  if (status === 'closed') return 'navy';
  return 'muted';
}

function statusAccent(status: OfferWithRequirements['status']): string {
  if (status === 'published') return companyUi.green;
  if (status === 'draft') return companyUi.amber;
  if (status === 'expired') return companyUi.red;
  return companyUi.textMuted;
}

const CONTRACT_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  long_term: 'Long-term',
  short_term: 'Short-term',
};

function formatPublishedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Paso 5b: la tira sale de offerRequirementChips, la misma que usa la
// moderación de admin — con autoridad ("EASA B1.1"), motor y "sólo sin
// licencia". Sigue anunciando "No licence needed" sólo cuando lo es: "Licence
// required" es el caso normal y llenaría la tira de ruido (Fase 6 tanda C).
const MAX_REQUIREMENT_CHIPS = 5;

export default function OffersListScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberRole = companySession?.companyMemberRole;
  const { sessionLoading } = useSession();
  const canManage = canManageOffers(companyMemberRole);
  // Paso 5b: sólo para el nombre del motor en las tarjetas de ofertas de motor.
  const { engineIndex } = useEnginesCatalog();

  const [offers, setOffers] = useState<OfferWithRequirements[]>([]);
  const [counts, setCounts] = useState<Record<string, OfferCounts>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // companyId hydrates asynchronously in SessionContext, independently of
  // the auth guard CompanyLayout already waits for — a screen that reads
  // companyId as soon as it mounts (e.g. right after router.replace() from
  // another screen, before that fetch resolves) can otherwise call
  // getForCompany('') and crash on the Postgres UUID cast. Guarded here the
  // same way app/company/index.tsx already guards its own companyId reads.
  const load = useCallback(async () => {
    if (!companyId) return;
    const [allOffers, apps, requests] = await Promise.all([
      offerRepository.getAllWithRequirements(),
      offerApplicationRepository.getForCompany(companyId),
      offerRequestRepository.getForCompany(companyId),
    ]);

    const companyOffers = allOffers
      .filter((offer) => offer.companyId === companyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const nextCounts: Record<string, OfferCounts> = {};
    companyOffers.forEach((offer) => {
      nextCounts[offer.id] = {
        applications: apps.filter((app) => app.offerId === offer.id).length,
        directOffers: requests.filter((req) => req.offerId === offer.id).length,
      };
    });

    setOffers(companyOffers);
    setCounts(nextCounts);
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      if (!companyId) return;
      let active = true;
      setLoading(true);
      load().finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [load, companyId]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const published = offers.filter((o) => o.status === 'published');
  const drafts = offers.filter((o) => o.status === 'draft');

  if (loading || sessionLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.blue} role="company" />
      </>
    );
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[companyStyles.content, isWide && companyStyles.contentWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <CompanyPageHeader
          eyebrow="Offer management"
          title="Job Offers"
          subtitle={`${offers.length} total · ${published.length} published · ${drafts.length} draft${drafts.length !== 1 ? 's' : ''}`}
          onBack={goBack}
          right={canManage ? (
            <TouchableOpacity
              style={styles.newButton}
              onPress={() => router.push('/company/offers/new' as any)}
              activeOpacity={0.75}
            >
              <Plus color={colors.white} size={17} strokeWidth={2.2} />
              <Text style={styles.newButtonText}>New</Text>
            </TouchableOpacity>
          ) : undefined}
        />

        {offers.length === 0 ? (
          <EmptyPanel
            title="No offers yet"
            subtitle="Create your first job offer to start matching with technicians."
          />
        ) : null}

        {offers.length === 0 && canManage ? (
          <Button
            label="Create offer"
            onPress={() => router.push('/company/offers/new' as any)}
            variant="primary"
            fullWidth
            style={styles.emptyButton}
          />
        ) : null}

        {offers.map((offer) => {
          const offerCounts = counts[offer.id] ?? { applications: 0, directOffers: 0 };
          const allRequirements = offerRequirementChips(offer, engineIndex);
          const requirements = allRequirements.slice(0, MAX_REQUIREMENT_CHIPS);
          // Se cuenta sobre la MISMA lista que se recorta, o el "+N más" mentiría.
          const hiddenReqs = allRequirements.length - requirements.length;

          return (
            <CompanyCard key={offer.id} style={[styles.offerCard, { borderLeftColor: statusAccent(offer.status) }]}>
              <View style={styles.cardTop}>
                <IconBox
                  icon={BriefcaseBusiness}
                  color={statusAccent(offer.status)}
                  backgroundColor={offer.status === 'published' ? companyUi.greenSoft : companyUi.surfaceSoft}
                />
                <View style={styles.cardTitleBlock}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{offer.title}</Text>
                  <View style={styles.locationRow}>
                    <MapPin color={companyUi.textMuted} size={14} strokeWidth={2} />
                    <Text style={styles.locationText} numberOfLines={1}>
                      {offer.locationCity}, {offer.locationCountry}
                      {offer.locationBaseAirport ? ` - ${offer.locationBaseAirport}` : ''}
                    </Text>
                  </View>
                  <View style={styles.locationRow}>
                    <CalendarDays color={companyUi.textMuted} size={14} strokeWidth={2} />
                    <Text style={styles.locationText}>
                      {offer.status === 'draft' ? 'Created' : 'Published'} {formatPublishedDate(offer.createdAt)}
                    </Text>
                  </View>
                </View>
                <CompanyBadge label={offer.status} tone={statusTone(offer.status)} small />
              </View>

              <View style={styles.metaRow}>
                <CompanyBadge label={CONTRACT_LABELS[offer.contractType] ?? offer.contractType} tone="muted" small />
                {offer.salary ? <CompanyBadge label={formatOfferSalary(offer.salary)!} tone="success" small /> : null}
                {offer.minYearsExperience > 0 ? (
                  <CompanyBadge label={`${offer.minYearsExperience}+ yrs`} tone="muted" small />
                ) : null}
                <CompanyBadge label={`${offerCounts.applications} applications`} tone={offerCounts.applications > 0 ? 'info' : 'muted'} small />
                <CompanyBadge label={`${offerCounts.directOffers} direct offers`} tone={offerCounts.directOffers > 0 ? 'cyan' : 'muted'} small />
              </View>

              {requirements.length > 0 ? (
                <View style={styles.requirementsBlock}>
                  <View style={styles.requirementsLabel}>
                    <ListChecks color={companyUi.textMuted} size={14} strokeWidth={2} />
                    <Text style={styles.requirementsText}>Requirements</Text>
                  </View>
                  <View style={styles.chipRow}>
                    {requirements.map((req) => <CompanyChip key={req} label={req} />)}
                    {hiddenReqs > 0 ? <CompanyChip label={`+${hiddenReqs}`} /> : null}
                  </View>
                </View>
              ) : null}

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => router.push(`/company/offers/edit?id=${offer.id}` as any)}
                  activeOpacity={0.75}
                >
                  <Edit3 color={companyUi.textSoft} size={15} strokeWidth={2} />
                  <Text style={styles.secondaryButtonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => router.push(`/company/offers/${offer.id}` as any)}
                  activeOpacity={0.75}
                >
                  <ClipboardCheck color={colors.white} size={16} strokeWidth={2} />
                  <Text style={styles.primaryButtonText}>View</Text>
                </TouchableOpacity>
              </View>
            </CompanyCard>
          );
        })}
      </ScrollView>
    </CompanyScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  newButton: {
    minHeight: 38,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: companyUi.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  newButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.white,
  },
  emptyButton: {
    marginTop: spacing.md,
    backgroundColor: companyUi.accent,
    borderRadius: 16,
  },
  offerCard: {
    gap: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 4,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: companyUi.text,
  },
  locationRow: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  locationText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  requirementsBlock: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
  },
  requirementsLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  requirementsText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: companyUi.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: companyUi.textSoft,
  },
  primaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: companyUi.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.white,
  },
});
