import React, { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { Avatar, Text } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import {
  AvatarDot,
  DesktopTitle,
  EmptyBlock,
  FilterChipRow,
  PageBar,
  PageBody,
  PillButton,
  RowList,
  StatusPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { matchScoreColor } from '../../../src/components/company/MatchBreakdownBars';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { matchPairs, PairMatch } from '../../../src/utils/matchingV2';
import { companyTechnicianName, companyTechnicianPhoto } from '../../../src/utils/companyTechnicianIdentity';
import { useCompanySession } from '../../../src/state/SessionContext';
import { OfferApplication } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';
import { TechnicianWithRelations } from '../../../src/types/technician';
import { isUnlocked, TechnicianView } from '../../../src/types/privacy';
import { technicianProfileLine } from '../../../src/components/company/TechnicianQualifications';
import { relativeTime } from '../../../src/utils/companyHome';
import {
  applicationStatusLook,
  isFinishedRelation,
  matchesRelationFilter,
  relationFilterCounts,
  type RelationFilter,
} from '../../../src/utils/companyStatus';
import { colors } from '../../../src/theme';

// Candidaturas (rediseño, fase 3; maquetas W-Applications y W-D-Applications).
// Cambia el aspecto; la carga, el orden y lo que se enseña de cada candidatura
// son los de antes.

type AppEntry = {
  app: OfferApplication;
  offer: OfferWithRequirements | null;
  safePreview: TechnicianView | null;
  // null = sin puntuar (técnico borrado, oferta desaparecida o catálogos sin
  // cargar). Un par que el filtro saca llega como { eligible: false }: la
  // candidatura existe y se enseña, sin porcentaje.
  match: PairMatch | null;
};

const FILTER_LABELS: Record<RelationFilter, string> = {
  all: 'All',
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

function verificationText(status: string): string {
  if (status === 'verified') return 'Verified';
  if (status === 'pending') return 'Verification pending';
  return 'Not verified';
}

export default function ApplicationsListScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const wide = useIsWide();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;

  const [entries, setEntries] = useState<AppEntry[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RelationFilter>('all');

  const load = useCallback(async (signal: { active: boolean }) => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!companyId) return;

    const apps = await offerApplicationRepository.getForCompany(companyId);

    const allOffers = await offerRepository.getAllWithRequirements();
    const offersMap: Record<string, OfferWithRequirements> = {};
    allOffers.forEach((o) => { offersMap[o.id] = o; });

    const uniqueTechIds = [...new Set(apps.map((a) => a.technicianId))];
    const techResults = await Promise.all(uniqueTechIds.map((id) => technicianRepositoryV2.getWithRelations(id)));
    const views = await Promise.all(uniqueTechIds.map((id) => technicianRepositoryV2.getViewForCompany(id, companyId)));
    const viewsMap = new Map(uniqueTechIds.map((id, i) => [id, views[i]]));
    const techsMap: Record<string, TechnicianWithRelations> = {};
    uniqueTechIds.forEach((id, i) => { if (techResults[i]) techsMap[id] = techResults[i]!; });

    // Paso 5b: los pares se puntúan en el servicio, con los dos catálogos y el
    // filtro de elegibilidad — nunca con calculateOfferTechnicianMatch a pelo.
    // El servicio ESPERA a sus catálogos, así que aquí ya no hay índice vacío
    // que vigilar. Si no cargan, la lista sale sin porcentajes: un score
    // erróneo es peor que ningún score, y perder las candidaturas, peor aún.
    const scorable = apps.filter((app) => offersMap[app.offerId] && techsMap[app.technicianId]);
    const pairResults = await matchPairs(
      scorable.map((app) => ({ offer: offersMap[app.offerId], technician: techsMap[app.technicianId] })),
    ).catch(() => null);
    const matchByAppId = new Map(scorable.map((app, i) => [app.id, pairResults?.[i] ?? null]));

    const built: AppEntry[] = apps.map((app) => {
      const offer = offersMap[app.offerId] ?? null;
      return {
        app,
        offer,
        safePreview: viewsMap.get(app.technicianId) ?? null,
        match: matchByAppId.get(app.id) ?? null,
      };
    });

    const ids = await activityRepository.getUnreadEntityIds(
      'company',
      companyId,
      ['application_received'],
    );

    built.sort((a, b) => {
      const aUnread = ids.has(a.app.id) ? 0 : 1;
      const bUnread = ids.has(b.app.id) ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      const order = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired'];
      const ai = order.indexOf(a.app.status);
      const bi = order.indexOf(b.app.status);
      if (ai !== bi) return ai - bi;
      return new Date(b.app.createdAt).getTime() - new Date(a.app.createdAt).getTime();
    });

    if (!signal.active) return;
    setUnreadIds(ids);
    setEntries(built);
  }, [companyId]);

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
      load(signal).finally(() => { if (signal.active) setLoading(false); });
      return () => { signal.active = false; };
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    setRefreshing(false);
  }

  const filtered = entries.filter((e) => matchesRelationFilter(e.app.status, statusFilter));
  const counts = relationFilterCounts(entries.map((e) => e.app.status));

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="company" />
      </>
    );
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      {!wide ? <PageBar title="Applications" large onBack={goBack} /> : null}
      <PageBody
        wide={wide}
        gap={wide ? 18 : 12}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {wide ? <DesktopTitle title="Applications" /> : null}

        <FilterChipRow
          wide={wide}
          options={(['all', 'pending', 'accepted', 'rejected'] as RelationFilter[]).map((key) => ({
            key,
            label: FILTER_LABELS[key],
            count: counts[key],
          }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />

        {filtered.length === 0 ? (
          <EmptyBlock
            title={entries.length === 0 ? 'No applications yet' : 'No applications in this category'}
            text={entries.length === 0
              ? 'When technicians apply to your offers, their applications will appear here.'
              : 'Try switching to All to see every application.'}
          />
        ) : (
          <RowList wide={wide}>
            {filtered.map((entry) => (
              <ApplicationRow
                key={entry.app.id}
                entry={entry}
                wide={wide}
                isUnread={unreadIds.has(entry.app.id)}
                onOpen={() => router.push(`/company/applications/${entry.app.id}` as any)}
                onViewProfile={() => router.push(`/company/technician/${entry.app.technicianId}` as any)}
              />
            ))}
          </RowList>
        )}
      </PageBody>
    </CompanyScreen>
  );
}

function ApplicationRow({
  entry,
  wide,
  isUnread,
  onOpen,
  onViewProfile,
}: {
  entry: AppEntry;
  wide: boolean;
  isUnread: boolean;
  onOpen: () => void;
  onViewProfile: () => void;
}) {
  const { app, offer, safePreview, match } = entry;
  const status = applicationStatusLook(app.status);
  const score = match?.eligible ? match.score : null;
  // A technician account deleted after applying resolves to null here
  // (technician_public_view excludes non-active profiles, migration 024) —
  // the application itself is real history and stays in the list, just
  // visibly deactivated with no live technician data to show.
  const isDeletedTechnician = !safePreview;
  const faded = isDeletedTechnician || isFinishedRelation(app.status);
  // El nombre sólo llega cuando la base ya ha desbloqueado la identidad
  // (technician_public_view lo deja a NULL hasta un contacto aceptado). Con
  // él, la fila dice el nombre —en pantalla y para el lector de pantalla—, y
  // sin él, el código anónimo con el avatar genérico.
  const name = companyTechnicianName(safePreview);
  const unlockedName = safePreview && isUnlocked(safePreview) ? name : null;
  const profileLine = safePreview
    ? technicianProfileLine(safePreview)
    : '';
  const metaLine = [
    `Applied ${relativeTime(app.createdAt)}`,
    safePreview ? verificationText(safePreview.verificationStatus) : null,
  ].filter(Boolean).join(' · ');

  const matchText = score
    ? <Text style={[styles.match, { color: score.blockers.length > 0 ? colors.error : matchScoreColor(score.total) }]}>
        {score.blockers.length > 0 ? 'Not eligible' : `${score.total}% match`}
      </Text>
    : match && !match.eligible
      ? <Text style={[styles.match, { color: colors.error }]}>Not eligible</Text>
      : null;

  const action = isDeletedTechnician || app.status !== 'pending' ? 'View' : 'Review';
  const showProfile = Boolean(unlockedName);
  const hasActions = wide || showProfile;

  // La fila son DOS pulsables, uno al lado del otro y nunca uno dentro de
  // otro (en web serían <button> dentro de <button>): la zona principal abre
  // la candidatura y las acciones van aparte.
  return (
    <View style={wide ? styles.rowWide : styles.row}>
      <Pressable
        onPress={onOpen}
        style={({ pressed, hovered }: any) => [wide ? styles.mainWide : styles.main, (pressed || hovered) && styles.mainPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${name}. ${offer?.title ?? 'Unknown offer'}. ${status.label}${isUnread ? '. New' : ''}`}
      >
        <View style={[styles.avatar, faded && styles.faded]}>
          {/* Avatar genérico mientras la identidad está oculta (respuesta 4). */}
          <Avatar kind="person" size={wide ? 48 : 52} photoPath={companyTechnicianPhoto(safePreview)} anonymous={!unlockedName} name={unlockedName} />
          {isUnread ? <AvatarDot size={wide ? 12 : 13} /> : null}
        </View>

        <View style={wide ? styles.copyWide : styles.copy}>
          <Text style={[styles.name, isDeletedTechnician && styles.deleted]} numberOfLines={1}>{name}</Text>
          <Text style={styles.offer} numberOfLines={1}>{offer?.title ?? 'Unknown offer'}</Text>
          {profileLine ? <Text style={styles.meta} numberOfLines={1}>{profileLine}</Text> : null}
          {!wide ? <Text style={styles.meta} numberOfLines={1}>{metaLine}</Text> : null}
          {!wide && matchText ? matchText : null}
          {app.coverNote ? <Text style={styles.cover} numberOfLines={2}>{app.coverNote}</Text> : null}
        </View>

        {wide ? (
          <View style={styles.whenWide}>
            <Text style={styles.meta}>{metaLine}</Text>
            {matchText}
          </View>
        ) : null}

        <View style={styles.status}>
          <StatusPill label={status.label} tone={status.tone} large={wide} />
        </View>
      </Pressable>

      {hasActions ? (
        <View style={wide ? styles.actionsWide : styles.actions}>
          {wide ? <PillButton label={action} variant="outline" size="sm" onPress={onOpen} /> : null}
          {showProfile ? <PillButton label="View profile" variant="accent" size="sm" onPress={onViewProfile} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 13,
    gap: 8,
  },
  rowWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    borderRadius: 12,
  },
  mainWide: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 18,
    rowGap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  mainPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  avatar: {
    flexShrink: 0,
  },
  faded: {
    opacity: 0.6,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  copyWide: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 240,
    minWidth: 0,
    gap: 1,
  },
  whenWide: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 220,
    gap: 2,
  },
  status: {
    flexShrink: 0,
  },
  // Móvil: las acciones debajo, alineadas con el texto (avatar 52 + hueco 14).
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingLeft: 66,
  },
  actionsWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  name: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  deleted: {
    fontStyle: 'italic',
    color: colors.textMuted,
  },
  offer: {
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  meta: {
    fontSize: 12.5,
    color: colors.textMuted,
  },
  match: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  cover: {
    marginTop: 4,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
