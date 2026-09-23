import React, { useState, useCallback, useRef } from 'react';
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
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import {
  ActivityDot,
  EmptyPanel,
  InitialAvatar,
  TechnicianBadge,
  TechnicianCard,
  TechnicianPageHeader,
  TechnicianScreen,
  techStyles,
  techUi,
} from '../../../src/components/technician/TechnicianUI';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { matchPairs, PairMatch } from '../../../src/utils/matchingV2';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { OfferRequest } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';

type RequestEntry = {
  request: OfferRequest;
  companyName: string;
  offerTitle: string | null;
  contractType: string | null;
  location: string | null;
  // null = sin puntuar. Un par que el filtro saca llega como { eligible: false }.
  match: PairMatch | null;
};

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  accepted: 1,
  rejected: 2,
  expired: 3,
  withdrawn: 4,
};

const STATUS_INFO: Record<string, { label: string; tone: 'success' | 'warning' | 'error' | 'muted' }> = {
  pending: { label: 'Pending', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Declined', tone: 'error' },
  expired: { label: 'Expired', tone: 'muted' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' },
};

const CONTRACT_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  long_term: 'Long-term',
  short_term: 'Short-term',
};

function scoreColor(total: number): string {
  if (total >= 80) return colors.success;
  if (total >= 60) return colors.blue;
  if (total >= 40) return colors.warning;
  return colors.textMuted;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function DirectOffersListScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [entries, setEntries] = useState<RequestEntry[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (signal: { active: boolean }) => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    const [requests, techWithRelations] = await Promise.all([
      offerRequestRepository.getForTechnician(technicianId),
      technicianRepositoryV2.getWithRelations(technicianId),
    ]);

    const loaded = await Promise.all(
      requests.map(async (req) => {
        const [company, offer] = await Promise.all([
          companyRepositoryV2.getById(req.companyId),
          req.offerId ? offerRepository.getWithRequirements(req.offerId) : Promise.resolve(null),
        ]);
        return { req, company, offer };
      }),
    );

    // Paso 5b: filtro + scorer con los dos catálogos, en el servicio y de una
    // vez para todas. Si los catálogos no cargan, sin porcentajes.
    const withOffer = techWithRelations
      ? loaded.filter((entry): entry is typeof entry & { offer: OfferWithRequirements } => Boolean(entry.offer))
      : [];
    const pairResults = techWithRelations
      ? await matchPairs(withOffer.map(({ offer }) => ({ offer, technician: techWithRelations }))).catch(() => null)
      : null;
    const matchByRequestId = new Map(withOffer.map(({ req }, i) => [req.id, pairResults?.[i] ?? null]));

    const built: RequestEntry[] = loaded.map(({ req, company, offer }) => ({
      request: req,
      companyName: company?.name ?? 'Company',
      offerTitle: offer?.title ?? null,
      contractType: offer ? (CONTRACT_LABELS[offer.contractType] ?? offer.contractType) : null,
      location: offer ? `${offer.locationCity}, ${offer.locationCountry}` : null,
      match: matchByRequestId.get(req.id) ?? null,
    }));

    const ids = await activityRepository.getUnreadEntityIds(
      'technician',
      technicianId,
      ['direct_offer_received', 'direct_offer_accepted', 'direct_offer_rejected'],
    );

    built.sort((a, b) => {
      const aUnread = ids.has(a.request.id) ? 0 : 1;
      const bUnread = ids.has(b.request.id) ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      const so = (STATUS_ORDER[a.request.status] ?? 9) - (STATUS_ORDER[b.request.status] ?? 9);
      if (so !== 0) return so;
      return b.request.createdAt.localeCompare(a.request.createdAt);
    });

    if (!signal.active) return;
    setUnreadIds(ids);
    setEntries(built);
  }, [technicianId]);

  // Señal de cancelacion compartida por el efecto de foco y el refresco. load()
  // la comprueba ANTES de cada setState, no solo en el .finally: si el foco vuelve
  // o se refresca con una carga aun en vuelo, sin esta señal habria dos load()
  // escribiendo y ganaria el que terminase el ultimo, de forma no determinista.
  const loadSignal = useRef<{ active: boolean }>({ active: false });

  useFocusEffect(
    useCallback(() => {
      const signal = { active: true };
      loadSignal.current = signal;
      setLoading(true);
      load(signal).finally(() => {
        if (signal.active) setLoading(false);
      });
      return () => {
        signal.active = false;
      };
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    setRefreshing(false);
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.technician} role="technician" />
      </>
    );
  }

  const pendingCount = entries.filter((e) => e.request.status === 'pending').length;

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[techStyles.content, isWide && techStyles.contentWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <TechnicianPageHeader
          eyebrow="Company outreach"
          title="Direct Offers"
          subtitle={`Offers sent directly to you${pendingCount > 0 ? ` - ${pendingCount} pending` : ''}`}
          onBack={goBack}
        />

        {entries.length === 0 && (
          <EmptyPanel
            title="No direct offers yet"
            subtitle="Companies can send you direct offers when your profile matches their needs."
          />
        )}

        {entries.map(({ request, companyName, offerTitle, contractType, location, match }) => {
          const score = match?.eligible ? match.score : null;
          const notEligible = Boolean(match && (!match.eligible || match.score.blockers.length > 0));
          const status = STATUS_INFO[request.status] ?? { label: request.status, tone: 'muted' as const };
          const isUnread = unreadIds.has(request.id);

          return (
            <TouchableOpacity
              key={request.id}
              style={styles.cardTouchable}
              onPress={() => router.push(`/technician/direct-offers/${request.id}` as any)}
              activeOpacity={0.75}
            >
              <TechnicianCard style={[styles.card, isUnread && styles.cardUnread]}>
                {isUnread && <ActivityDot />}
                <View style={styles.cardHeader}>
                  <InitialAvatar label={companyName} />
                  <View style={styles.cardMeta}>
                    <Text style={styles.companyName} numberOfLines={1}>{companyName}</Text>
                    <Text style={styles.offerTitle} numberOfLines={1}>
                      {offerTitle ?? 'Direct message'}
                    </Text>
                  </View>
                  <TechnicianBadge label={status.label} tone={status.tone} small />
                </View>

                {(location || contractType || match) && (
                  <View style={styles.detailsRow}>
                    {location ? <TechnicianBadge label={location} tone="muted" small /> : null}
                    {contractType ? <TechnicianBadge label={contractType} tone="muted" small /> : null}
                    {match ? (
                      <Text
                        style={[
                          styles.matchText,
                          { color: notEligible || !score ? colors.error : scoreColor(score.total) },
                        ]}
                      >
                        {notEligible || !score ? 'Not eligible' : `${score.total}% match`}
                      </Text>
                    ) : null}
                  </View>
                )}

                {request.message ? (
                  <Text style={styles.messagePreview} numberOfLines={2}>
                    "{request.message}"
                  </Text>
                ) : null}

                <View style={styles.footer}>
                  <Text style={styles.dateText}>{formatDate(request.createdAt)}</Text>
                  <Text style={styles.viewLink}>View</Text>
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
  cardTouchable: { marginBottom: spacing.md },
  card: {
    position: 'relative',
  },
  cardUnread: {
    borderColor: techUi.redSoft,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardMeta: { flex: 1, minWidth: 0 },
  companyName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: techUi.text,
    marginBottom: 2,
  },
  offerTitle: { fontSize: 12, color: techUi.accent, fontWeight: '600' },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  matchText: { fontSize: 12, fontWeight: '700', paddingVertical: 4 },
  messagePreview: {
    fontSize: 13,
    color: techUi.textSoft,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dateText: { fontSize: 11, color: techUi.textMuted, fontWeight: '500' },
  viewLink: { fontSize: 13, fontWeight: '700', color: techUi.accent },
});
