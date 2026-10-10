import React, { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { Avatar, Text } from '../../../src/components/ui';
import { TechnicianScreen } from '../../../src/components/technician/TechnicianUI';
import {
  AvatarDot,
  DesktopTitle,
  EmptyBlock,
  FilterChipRow,
  PageBar,
  PageBody,
  PageSubtitle,
  PillButton,
  RowList,
  StatusPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { OfferApplication } from '../../../src/types/offerRequest';
import { Offer } from '../../../src/types/offer';
import { CompanyProfileView } from '../../../src/types/company';
import { ChatRoom } from '../../../src/types/chat';
import { formatLocation } from '../../../src/utils/formatLocation';
import {
  TECHNICIAN_APPLICATION_FILTERS,
  TECHNICIAN_APPLICATION_FILTER_LABELS,
  applicationFilterCounts,
  applicationOfferStatusLook,
  isFinishedStatus,
  matchesApplicationFilter,
  sortApplications,
  technicianApplicationListLook,
  type TechnicianApplicationFilter,
} from '../../../src/utils/technicianRelations';
import { technicianOfferHref } from '../../../src/utils/technicianNavigation';
import { colors } from '../../../src/theme';

// Candidaturas del técnico (rediseño, fase 5B; el patrón de Applications de
// empresa, maquetas W-Applications y W-D-Applications). Cambia el aspecto; la
// carga, el orden, los estados y los filtros (All, Pending, Accepted, Closed)
// son los de antes (src/utils/technicianRelations.ts).
//
// El detalle de una candidatura es la página de su oferta: allí se ve el
// estado y se retira, con la confirmación de siempre.

type AppEntry = {
  app: OfferApplication;
  offer: Offer | null;
  company: CompanyProfileView | null;
  chatRoom: ChatRoom | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ApplicationHistoryScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const wide = useIsWide();
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;

  const [entries, setEntries] = useState<AppEntry[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TechnicianApplicationFilter>('all');

  const load = useCallback(async (signal: { active: boolean }) => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    const [apps, rooms, unreadEntityIds] = await Promise.all([
      offerApplicationRepository.getForTechnician(technicianId),
      chatRepository.getRoomsForTechnician(technicianId),
      activityRepository.getUnseenApplicationResponseIds(technicianId),
    ]);

    const roomByAppId = new Map(
      rooms.filter((r) => r.offerApplicationId).map((r) => [r.offerApplicationId!, r]),
    );

    const uniqueOfferIds = [...new Set(apps.map((a) => a.offerId))];
    const uniqueCompanyIds = [...new Set(apps.map((a) => a.companyId))];

    const [offerResults, companyResults] = await Promise.all([
      Promise.all(uniqueOfferIds.map((id) => offerRepository.getById(id))),
      Promise.all(uniqueCompanyIds.map((id) => companyRepositoryV2.getById(id))),
    ]);

    const offersMap: Record<string, Offer> = {};
    uniqueOfferIds.forEach((id, i) => { if (offerResults[i]) offersMap[id] = offerResults[i]!; });

    const companiesMap: Record<string, CompanyProfileView> = {};
    uniqueCompanyIds.forEach((id, i) => { if (companyResults[i]) companiesMap[id] = companyResults[i]!; });

    const built: AppEntry[] = apps.map((app) => ({
      app,
      offer: offersMap[app.offerId] ?? null,
      company: companiesMap[app.companyId] ?? null,
      chatRoom: roomByAppId.get(app.id) ?? null,
    }));

    if (!signal.active) return;
    setEntries(sortApplications(built, (id) => unreadEntityIds.has(id)));
    setUnreadIds(unreadEntityIds);
  }, [technicianId]);

  // Señal de cancelacion compartida por el efecto de foco y el refresco.
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

  const filtered = entries.filter((e) => matchesApplicationFilter(e.app.status, statusFilter));
  const counts = applicationFilterCounts(entries.map((e) => e.app.status));
  // El título cuenta lo mismo que el número de Applications: respuestas sin ver
  // (los puntos rojos de la lista), no las pendientes (fase 8).
  const unseenCount = entries.filter((e) => unreadIds.has(e.app.id)).length;
  const subtitle = `${entries.length} application${entries.length !== 1 ? 's' : ''}${unseenCount > 0 ? ` · ${unseenCount} new` : ''}`;

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="technician" />
      </>
    );
  }

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      {!wide ? (
        <>
          <PageBar title="My applications" large onBack={goBack} />
          <PageSubtitle>{subtitle}</PageSubtitle>
        </>
      ) : null}
      <PageBody
        wide={wide}
        gap={wide ? 18 : 12}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {wide ? <DesktopTitle title="My applications" subtitle={subtitle} /> : null}

        <FilterChipRow
          wide={wide}
          options={TECHNICIAN_APPLICATION_FILTERS.map((key) => ({
            key,
            label: TECHNICIAN_APPLICATION_FILTER_LABELS[key],
            count: counts[key],
          }))}
          value={statusFilter}
          onChange={setStatusFilter}
        />

        {filtered.length === 0 ? (
          <EmptyBlock
            title={statusFilter === 'all' ? 'No applications yet' : 'No applications in this category'}
            text={statusFilter === 'all'
              ? 'Browse offers and apply to start your application history.'
              : 'Try a different filter.'}
          />
        ) : (
          <RowList wide={wide}>
            {filtered.map((entry) => (
              <ApplicationRow
                key={entry.app.id}
                entry={entry}
                wide={wide}
                isUnread={unreadIds.has(entry.app.id)}
                onOpen={() => router.push(technicianOfferHref(entry.app.offerId) as never)}
                onOpenChat={entry.app.status === 'accepted' && entry.chatRoom
                  ? () => router.push(`/technician/chats/${entry.chatRoom!.id}` as never)
                  : undefined}
              />
            ))}
          </RowList>
        )}
      </PageBody>
    </TechnicianScreen>
  );
}

function ApplicationRow({
  entry,
  wide,
  isUnread,
  onOpen,
  onOpenChat,
}: {
  entry: AppEntry;
  wide: boolean;
  isUnread: boolean;
  onOpen: () => void;
  onOpenChat?: () => void;
}) {
  const { app, offer, company } = entry;
  const status = technicianApplicationListLook(app.status);
  const offerStatus = applicationOfferStatusLook(offer?.status);
  const title = offer?.title ?? 'Offer unavailable';
  const companyName = company?.name ?? null;
  const place = offer ? formatLocation(offer.locationCity, offer.locationCountry) : null;
  const meta = [`Applied ${formatDate(app.createdAt)}`, place].filter(Boolean).join(' · ');
  const faded = isFinishedStatus(app.status);
  const hasActions = wide || Boolean(onOpenChat);

  // La fila son DOS pulsables, uno al lado del otro y nunca uno dentro de
  // otro (en web serían <button> dentro de <button>): la zona principal abre
  // la oferta, donde se ve y se retira la candidatura; "Open chat" va aparte.
  return (
    <View style={wide ? styles.rowWide : styles.row}>
      <Pressable
        onPress={onOpen}
        style={({ pressed, hovered }: any) => [wide ? styles.mainWide : styles.main, (pressed || hovered) && styles.mainPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${companyName ?? ''}. ${status.label}${isUnread ? '. New' : ''}`}
      >
        <View style={[styles.avatar, faded && styles.faded]}>
          <Avatar kind="company" size={wide ? 48 : 52} name={companyName} logoPath={company?.logoPath} />
          {isUnread ? <AvatarDot size={wide ? 12 : 13} /> : null}
        </View>

        <View style={wide ? styles.copyWide : styles.copy}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {companyName ? <Text style={styles.company} numberOfLines={1}>{companyName}</Text> : null}
          <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        </View>

        <View style={styles.pills}>
          <StatusPill label={status.label} tone={status.tone} large={wide} />
          {offerStatus ? <StatusPill label={offerStatus.label} tone={offerStatus.tone} /> : null}
        </View>
      </Pressable>

      {hasActions ? (
        <View style={wide ? styles.actionsWide : styles.actions}>
          {wide ? <PillButton label="View offer" variant="outline" size="sm" onPress={onOpen} /> : null}
          {onOpenChat ? <PillButton label="Open chat" size="sm" onPress={onOpenChat} /> : null}
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
    alignItems: 'center',
    gap: 18,
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
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  pills: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 6,
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
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  company: {
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  meta: {
    fontSize: 12.5,
    color: colors.textMuted,
  },
});
