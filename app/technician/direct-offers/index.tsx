import React, { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { Avatar, Text, useConfirmDialog } from '../../../src/components/ui';
import { TechnicianScreen } from '../../../src/components/technician/TechnicianUI';
import {
  AvatarDot,
  ButtonRow,
  DesktopTitle,
  EmptyBlock,
  NoticeBox,
  PageBar,
  PageBody,
  PageSubtitle,
  PillButton,
  RowList,
  StatusPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { matchScoreColor } from '../../../src/components/company/MatchBreakdownBars';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { isOfferOpenForTechnicians, offerRepository } from '../../../src/repositories/v2/offerRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { matchPairs, PairMatch } from '../../../src/utils/matchingV2';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { useTechnicianNav } from '../../../src/state/TechnicianNavContext';
import { OfferApplication, OfferRequest } from '../../../src/types/offerRequest';
import { OfferWithRequirements } from '../../../src/types/offer';
import { CompanyProfileView } from '../../../src/types/company';
import {
  canRespondToDirectOffer,
  isDirectOfferBlockedByClosedOffer,
  isFinishedStatus,
  sortDirectOffers,
  technicianDirectOfferStatusLook,
} from '../../../src/utils/technicianRelations';
import { companyCanSeeIdentity, directOfferConfirm } from '../../../src/utils/technicianPrivacy';
import { contractLabel, offerCompanyPlaceLine } from '../../../src/utils/technicianOffers';
import { technicianDirectOfferHref } from '../../../src/utils/technicianNavigation';
import { colors } from '../../../src/theme';

// Ofertas directas recibidas (rediseño, fase 5B; maqueta T-Direct con el patrón
// de las listas de empresa, W-Direct).
//   - Estados, orden y carga de antes (src/utils/technicianRelations.ts).
//   - "Decline" y "Accept" en cada fila pendiente, con las confirmaciones de
//     siempre. Aceptar revela la identidad: se confirma siempre (respuesta 15).
//     Al aceptar, el chat se abre como antes y la fila ofrece "Open chat".
//   - La fila son pulsables uno al lado del otro, nunca uno dentro de otro.

type DirectOfferEntry = {
  request: OfferRequest;
  company: CompanyProfileView | null;
  offer: OfferWithRequirements | null;
  // null = sin puntuar. Un par que el filtro saca llega como { eligible: false }.
  match: PairMatch | null;
  chatRoomId: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DirectOffersListScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const wide = useIsWide();
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const { refreshCounts } = useTechnicianNav();
  const { confirm, dialog } = useConfirmDialog();

  const [entries, setEntries] = useState<DirectOfferEntry[]>([]);
  // Todas las relaciones del técnico: deciden si una empresa ya ve su identidad.
  const [requests, setRequests] = useState<OfferRequest[]>([]);
  const [applications, setApplications] = useState<OfferApplication[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (signal: { active: boolean }) => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    const [reqs, apps, techWithRelations, rooms, ids] = await Promise.all([
      offerRequestRepository.getForTechnician(technicianId),
      offerApplicationRepository.getForTechnician(technicianId),
      technicianRepositoryV2.getWithRelations(technicianId),
      chatRepository.getRoomsForTechnician(technicianId),
      activityRepository.getUnreadEntityIds(
        'technician',
        technicianId,
        ['direct_offer_received', 'direct_offer_accepted', 'direct_offer_rejected'],
      ),
    ]);

    const loaded = await Promise.all(
      reqs.map(async (req) => {
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
    const roomByRequestId = new Map(rooms.filter((r) => r.offerRequestId).map((r) => [r.offerRequestId!, r.id]));

    const built: DirectOfferEntry[] = loaded.map(({ req, company, offer }) => ({
      request: req,
      company,
      offer,
      match: matchByRequestId.get(req.id) ?? null,
      chatRoomId: roomByRequestId.get(req.id) ?? null,
    }));

    if (!signal.active) return;
    setRequests(reqs);
    setApplications(apps);
    setUnreadIds(ids);
    setEntries(sortDirectOffers(built, (id) => ids.has(id)));
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

  async function respond(entry: DirectOfferEntry, action: 'accept' | 'reject') {
    if (!technicianId) return;
    setActionError(null);
    // Las confirmaciones de siempre; si la empresa ya ve la identidad por otro
    // contacto aceptado, el texto lo dice (la misma regla que la base).
    const identityVisible = companyCanSeeIdentity({
      companyId: entry.request.companyId,
      technicianId,
      offerRequests: requests,
      offerApplications: applications,
    });
    const confirmed = await confirm(directOfferConfirm(action, identityVisible));
    if (!confirmed) return;
    setActingId(entry.request.id);
    try {
      const result = await offerRequestRepository.updateStatus(
        entry.request.id,
        action === 'accept' ? 'accepted' : 'rejected',
      );
      if (result === null) {
        setActionError('Could not update offer status. Please try again.');
        return;
      }
      await load(loadSignal.current);
      refreshCounts();
    } catch (e: any) {
      setActionError(e?.message ?? 'An error occurred. Please try again.');
    } finally {
      setActingId(null);
    }
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="technician" />
      </>
    );
  }

  const pendingCount = entries.filter((e) => e.request.status === 'pending').length;
  const subtitle = `Offers sent directly to you${pendingCount > 0 ? ` · ${pendingCount} pending` : ''}`;

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      {!wide ? (
        <>
          <PageBar title="Direct offers" large onBack={goBack} />
          <PageSubtitle>{subtitle}</PageSubtitle>
        </>
      ) : null}
      <PageBody
        wide={wide}
        gap={wide ? 18 : 12}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {wide ? <DesktopTitle title="Direct offers" subtitle={subtitle} /> : null}

        {actionError ? <NoticeBox tone="error">{actionError}</NoticeBox> : null}

        {entries.length === 0 ? (
          <EmptyBlock
            title="No direct offers yet"
            text="Companies can send you direct offers when your profile matches their needs."
          />
        ) : (
          <RowList wide={wide}>
            {entries.map((entry) => (
              <DirectOfferRow
                key={entry.request.id}
                entry={entry}
                wide={wide}
                isUnread={unreadIds.has(entry.request.id)}
                acting={actingId === entry.request.id}
                busy={actingId !== null}
                onOpen={() => router.push(technicianDirectOfferHref(entry.request.id) as never)}
                onAccept={() => respond(entry, 'accept')}
                onDecline={() => respond(entry, 'reject')}
                onOpenChat={entry.chatRoomId ? () => router.push(`/technician/chats/${entry.chatRoomId}` as never) : undefined}
              />
            ))}
          </RowList>
        )}
      </PageBody>
      {dialog}
    </TechnicianScreen>
  );
}

function DirectOfferRow({
  entry,
  wide,
  isUnread,
  acting,
  busy,
  onOpen,
  onAccept,
  onDecline,
  onOpenChat,
}: {
  entry: DirectOfferEntry;
  wide: boolean;
  isUnread: boolean;
  acting: boolean;
  busy: boolean;
  onOpen: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onOpenChat?: () => void;
}) {
  const { request, company, offer, match } = entry;
  const status = technicianDirectOfferStatusLook(request.status);
  const companyName = company?.name ?? 'Company';
  const title = offer?.title ?? 'Direct message';
  const offerOpen = isOfferOpenForTechnicians(offer);
  const canRespond = canRespondToDirectOffer(request, offerOpen);
  const closedOffer = isDirectOfferBlockedByClosedOffer(request, offerOpen);
  const score = match?.eligible ? match.score : null;
  const notEligible = Boolean(match && (!match.eligible || match.score.blockers.length > 0));
  const meta = offer
    ? [offerCompanyPlaceLine(companyName, offer), contractLabel(offer.contractType)].join(' · ')
    : companyName;
  const when = `Received ${formatDate(request.createdAt)}${closedOffer ? ' · Offer closed' : ''}`;
  const faded = isFinishedStatus(request.status);

  const actions = canRespond ? (
    <>
      <PillButton label="Decline" variant="outline" size={wide ? 'sm' : 'md'} onPress={onDecline} disabled={busy} grow={wide ? undefined : 1} />
      <PillButton label="Accept" size={wide ? 'sm' : 'md'} onPress={onAccept} loading={acting} disabled={busy && !acting} grow={wide ? undefined : 1.5} />
    </>
  ) : request.status === 'accepted' && onOpenChat ? (
    <PillButton label="Open chat" size="sm" onPress={onOpenChat} />
  ) : null;

  // La fila son DOS pulsables, uno al lado del otro y nunca uno dentro de
  // otro (en web serían <button> dentro de <button>): la zona principal abre
  // la oferta directa y los botones van aparte.
  return (
    <View style={wide ? styles.rowWide : styles.row}>
      <Pressable
        onPress={onOpen}
        style={({ pressed, hovered }: any) => [wide ? styles.mainWide : styles.main, (pressed || hovered) && styles.mainPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${companyName}. ${status.label}${isUnread ? '. New' : ''}`}
      >
        <View style={[styles.avatar, faded && styles.faded]}>
          <Avatar kind="company" size={wide ? 48 : 52} name={companyName} logoPath={company?.logoPath} />
          {isUnread ? <AvatarDot size={wide ? 12 : 13} /> : null}
        </View>

        <View style={wide ? styles.copyWide : styles.copy}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
          {match ? (
            <Text style={[styles.match, { color: notEligible || !score ? colors.error : matchScoreColor(score.total) }]}>
              {notEligible || !score ? 'Not eligible' : `${score.total}% match`}
            </Text>
          ) : null}
          {request.message ? <Text style={styles.message} numberOfLines={2}>{request.message}</Text> : null}
          <Text style={styles.when} numberOfLines={1}>{when}</Text>
        </View>

        <View style={styles.status}>
          <StatusPill label={status.label} tone={status.tone} large={wide} />
        </View>
      </Pressable>

      {actions ? (
        wide
          ? <View style={styles.actionsWide}>{actions}</View>
          : <View style={styles.actions}><ButtonRow>{actions}</ButtonRow></View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 13,
    gap: 10,
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
  status: {
    flexShrink: 0,
  },
  // Móvil: los botones debajo, alineados con el texto (avatar 52 + hueco 14).
  actions: {
    paddingLeft: 66,
  },
  actionsWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  title: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  match: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  message: {
    marginTop: 4,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  when: {
    marginTop: 2,
    fontSize: 12.5,
    color: colors.textMuted,
  },
});
