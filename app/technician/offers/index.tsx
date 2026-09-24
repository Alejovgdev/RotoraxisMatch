import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { MapPinned } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { formatOfferSalary } from '../../../src/utils/offerSalary';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { MatchBadge } from '../../../src/components/MatchBadge';
import {
  ActivityDot,
  EmptyPanel,
  TechnicianBadge,
  TechnicianCard,
  TechnicianChip,
  TechnicianPageHeader,
  TechnicianScreen,
  techStyles,
  techUi,
} from '../../../src/components/technician/TechnicianUI';
import { getOfferMatchesForTechnician, OfferMatchResult, getMatchDisplayLabel } from '../../../src/utils/matchingV2';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { CompanyProfileView } from '../../../src/types/company';
import { OfferApplication } from '../../../src/types/offerRequest';
import { ContractTypeCode } from '../../../src/types/catalog';
import { OfferProductType } from '../../../src/types/offer';
import { OFFER_PRODUCT_TYPES, getOfferProductTypeLabel } from '../../../src/constants/offerProductTypes';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { ONLY_UNLICENSED_TEXT, offerEngineText, offerLicenseText } from '../../../src/utils/offerRequirementsText';
import { formatLocation } from '../../../src/utils/formatLocation';

function formatPublishedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const CONTRACT_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  long_term: 'Long-term',
  short_term: 'Short-term',
};

const COMPANY_TYPE_LABELS: Record<string, string> = {
  MRO: 'MRO',
  airline: 'Airline',
  recruitment_agency: 'Recruitment',
  helicopter_operator: 'Helicopter Operator',
  other: 'Other',
};

function scoreColor(total: number): string {
  if (total >= 80) return colors.success;
  if (total >= 60) return colors.blue;
  if (total >= 40) return colors.warning;
  return colors.textMuted;
}

function scoreTone(total: number): 'success' | 'info' | 'warning' | 'muted' {
  if (total >= 80) return 'success';
  if (total >= 60) return 'info';
  if (total >= 40) return 'warning';
  return 'muted';
}

function appStatusInfo(status: string): { label: string; tone: 'success' | 'warning' | 'error' | 'muted' } {
  switch (status) {
    case 'pending': return { label: 'Applied - pending', tone: 'warning' };
    case 'accepted': return { label: 'Accepted', tone: 'success' };
    case 'rejected': return { label: 'Not selected', tone: 'error' };
    case 'expired': return { label: 'Offer expired', tone: 'muted' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'muted' };
    default: return { label: status, tone: 'muted' };
  }
}

type ContractFilter = ContractTypeCode | 'all';

// Migración 047 — filtro y badge Airplanes/Helicopters restaurados, ahora
// sobre `offer.productType` (declarado por la empresa, NOT NULL) en vez de
// derivarlos del catálogo. El filtro es una comparación directa contra la
// columna: no hay family keys que resolver, ni estado 'mixed' que representar
// — una oferta es de un producto o del otro, y la base lo garantiza.
type ProductFilter = OfferProductType | 'all';

export default function BrowseOffersScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { state: catalogState } = useAircraftTypeRatingsCatalog();
  // Paso 5b: sólo para el nombre del motor en las tarjetas de ofertas de motor.
  const { engineIndex } = useEnginesCatalog();

  const [matches, setMatches] = useState<OfferMatchResult[]>([]);
  const [companyMap, setCompanyMap] = useState<Record<string, CompanyProfileView>>({});
  const [applications, setApplications] = useState<OfferApplication[]>([]);
  const [unreadAppIds, setUnreadAppIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [contractFilter, setContractFilter] = useState<ContractFilter>('all');
  const [productFilter, setProductFilter] = useState<ProductFilter>('all');
  const [searchText, setSearchText] = useState('');

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    const [offerMatches, companies, apps, unreadIds] = await Promise.all([
      getOfferMatchesForTechnician(technicianId),
      companyRepositoryV2.getAll(),
      offerApplicationRepository.getForTechnician(technicianId),
      activityRepository.getUnreadEntityIds('technician', technicianId, [
        'application_accepted',
        'application_rejected',
      ]),
    ]);
    setMatches(offerMatches);
    const map: Record<string, CompanyProfileView> = {};
    companies.forEach((c) => { map[c.id] = c; });
    setCompanyMap(map);
    setApplications(apps);
    setUnreadAppIds(unreadIds);
  }, [technicianId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      load().finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function getApp(offerId: string): OfferApplication | null {
    return applications.find((a) => a.offerId === offerId) ?? null;
  }

  function getAppStatus(offerId: string): string | null {
    return getApp(offerId)?.status ?? null;
  }

  function isOfferUnread(offerId: string): boolean {
    const app = getApp(offerId);
    return app ? unreadAppIds.has(app.id) : false;
  }

  const filtered = matches
    .filter(({ offer }) => {
      if (contractFilter !== 'all' && offer.contractType !== contractFilter) return false;
      if (productFilter !== 'all' && offer.productType !== productFilter) return false;
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const haystack = [offer.title, offer.locationCity, offer.locationCountry, offer.locationBaseAirport ?? '']
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aUnread = isOfferUnread(a.offer.id) ? 0 : 1;
      const bUnread = isOfferUnread(b.offer.id) ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      return b.score.total - a.score.total;
    });

  if (loading || catalogState === 'loading') {
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TechnicianPageHeader
          eyebrow="Offer marketplace"
          title="Browse Offers"
          subtitle={`${filtered.length} offer${filtered.length !== 1 ? 's' : ''} ranked by match`}
          onBack={goBack}
          right={(
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Open offer map"
              activeOpacity={0.75}
              onPress={() => router.push('/technician/map' as any)}
              style={styles.mapButton}
            >
              <MapPinned color={techUi.accent} size={17} strokeWidth={2.2} />
              <Text style={styles.mapButtonText}>Map</Text>
            </TouchableOpacity>
          )}
        />

        <TextInput
          style={styles.search}
          placeholder="Search by title, city or country..."
          placeholderTextColor={techUi.textMuted}
          value={searchText}
          onChangeText={setSearchText}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
        >
          {(['all', 'permanent', 'long_term', 'short_term'] as ContractFilter[]).map((f) => (
            <TechnicianChip
              key={f}
              label={f === 'all' ? 'All contracts' : CONTRACT_LABELS[f]}
              selected={contractFilter === f}
              onPress={() => setContractFilter(f)}
            />
          ))}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
        >
          <TechnicianChip
            label="All aircraft"
            selected={productFilter === 'all'}
            onPress={() => setProductFilter('all')}
          />
          {OFFER_PRODUCT_TYPES.map((p) => (
            <TechnicianChip
              key={p.code}
              label={p.label}
              selected={productFilter === p.code}
              onPress={() => setProductFilter(p.code)}
            />
          ))}
        </ScrollView>

        {filtered.length === 0 && (
          <EmptyPanel
            title="No offers found"
            subtitle={matches.length === 0
              ? 'There are no published offers at the moment.'
              : 'Try adjusting your filters.'}
          />
        )}

        {filtered.map(({ offer, score }) => {
          const company = companyMap[offer.companyId];
          const appStatus = getAppStatus(offer.id);
          const accent = scoreColor(score.total);
          const unread = isOfferUnread(offer.id);
          const status = appStatus ? appStatusInfo(appStatus) : null;

          return (
            <TouchableOpacity
              key={offer.id}
              style={styles.cardTouchable}
              onPress={() => router.push(`/technician/offers/${offer.id}` as any)}
              activeOpacity={0.75}
            >
              <TechnicianCard style={[styles.card, { borderLeftColor: accent }, unread && styles.cardUnread]}>
                {unread && <ActivityDot />}
                <View style={styles.cardTop}>
                  <View style={styles.cardTitleBlock}>
                    <Text style={styles.cardTitle} numberOfLines={2}>{offer.title}</Text>
                    {company && (
                      <Text style={styles.cardCompany}>
                        {company.name}
                        {company.companyType ? ` - ${COMPANY_TYPE_LABELS[company.companyType] ?? company.companyType}` : ''}
                      </Text>
                    )}
                  </View>
                  <MatchBadge score={score.total} context="match" notEligible={score.blockers.length > 0} />
                </View>

                <Text style={styles.cardLocation}>
                  {formatLocation(offer.locationCity, offer.locationCountry)}
                  {offer.locationBaseAirport ? ` - ${offer.locationBaseAirport}` : ''}
                </Text>
                <Text style={styles.cardDate}>Published {formatPublishedDate(offer.createdAt)}</Text>

                <View style={styles.metaRow}>
                  <TechnicianBadge label={getOfferProductTypeLabel(offer.productType)} tone="info" small />
                  <TechnicianBadge label={CONTRACT_LABELS[offer.contractType] ?? offer.contractType} tone="muted" small />
                  {offer.salary ? <TechnicianBadge label={formatOfferSalary(offer.salary)!} tone="success" small /> : null}
                  {offer.minYearsExperience > 0 && (
                    <TechnicianBadge label={`${offer.minYearsExperience}+ yrs exp`} tone="muted" small />
                  )}
                  <TechnicianBadge label={getMatchDisplayLabel(offer, score)} tone={scoreTone(score.total)} small />
                </View>

                {(offer.licenseCode || offer.offerKind === 'engine' || offer.onlyUnlicensed) && (
                  <View style={styles.reqRow}>
                    {offer.offerKind === 'engine' ? <TechnicianChip label={`Engine: ${offerEngineText(offer, engineIndex) ?? 'not specified'}`} /> : null}
                    {offer.licenseCode ? <TechnicianChip label={offerLicenseText(offer)!} /> : null}
                    {offer.onlyUnlicensed ? <TechnicianChip label={ONLY_UNLICENSED_TEXT} /> : null}
                  </View>
                )}

                <View style={styles.cardFooter}>
                  {status ? (
                    <TechnicianBadge label={status.label} tone={status.tone} />
                  ) : (
                    <Text style={styles.viewLink}>View</Text>
                  )}
                </View>
              </TechnicianCard>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </TechnicianScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  search: {
    backgroundColor: techUi.surface,
    borderWidth: 1,
    borderColor: techUi.border,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
    color: techUi.text,
    marginBottom: spacing.sm,
  },
  mapButton: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: techUi.accent,
    backgroundColor: techUi.accentSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  mapButtonText: { fontSize: 12, fontWeight: '800', color: techUi.accent },
  filterRow: { marginBottom: spacing.md, flexGrow: 0 },
  filterContent: { gap: spacing.xs, paddingRight: spacing.lg },
  cardTouchable: { marginBottom: spacing.md },
  card: {
    borderLeftWidth: 4,
    position: 'relative',
  },
  cardUnread: {
    borderColor: techUi.redSoft,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 7,
    gap: spacing.sm,
  },
  cardTitleBlock: { flex: 1, minWidth: 0 },
  cardTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: techUi.text,
    marginBottom: 3,
  },
  cardCompany: { fontSize: 12, color: techUi.textSoft, fontWeight: '500' },
  cardLocation: { fontSize: 12, color: techUi.textMuted, marginBottom: 3, fontWeight: '500' },
  cardDate: { fontSize: 11, color: techUi.textMuted, marginBottom: spacing.sm, fontWeight: '500' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  reqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  cardFooter: {
    marginTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  viewLink: { fontSize: 13, fontWeight: '700', color: techUi.accent },
});
