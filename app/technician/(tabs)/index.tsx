import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  BriefcaseBusiness,
  ClipboardCheck,
  Inbox,
  MapPin,
  Search,
} from 'lucide-react-native';
import { Avatar, ShortcutCircle, Text } from '../../../src/components/ui';
import { TechnicianScreen } from '../../../src/components/technician/TechnicianUI';
import { OfferListRow, OfferResultCard } from '../../../src/components/technician/OfferCards';
import { BestMatchCard } from '../../../src/components/technician/BestMatchCard';
import { StatusPill, VerificationPill, useCardGrid } from '../../../src/components/company/CompanyPage';
import { useTechnicianNav } from '../../../src/state/TechnicianNavContext';
import { useTechnicianHome } from '../../../src/state/useTechnicianHome';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import type { TechnicianInboxEntry } from '../../../src/state/technicianInbox';
import type { OfferMatchResult } from '../../../src/utils/matchingV2';
import { HOME_OFFER_CARDS, HOME_OFFER_ROWS, summarizeTechnicianHome } from '../../../src/utils/technicianHome';
import { offerRequirementChips } from '../../../src/utils/offerRequirementsText';
import {
  TECHNICIAN_DOCUMENTS_ROUTE,
  TECHNICIAN_PROFILE_ROUTES,
  TECHNICIAN_SECTION_ROUTES,
  TECHNICIAN_TAB_ROUTES,
} from '../../../src/utils/technicianNavigation';
import { colors } from '../../../src/theme';
import { fonts } from '../../../src/theme/fonts';
import { TOUCH_TARGET, WIDE_BREAKPOINT } from '../../../src/theme/ui';

// Home del técnico (rediseño, fase 5A; maqueta T-Home, y en escritorio el
// patrón de W-D-Home).
//
// Desaparecen la tarjeta de perfil, el bloque de números y la lista de
// navegación de antes; la navegación la llevan ahora las barras y los círculos.
// "Best match for you" es lo que antes mostraba "Your next opportunity", con la
// misma regla (src/utils/technicianHome.ts). Todos los números salen de datos
// que la app ya tenía; no hay campana (respuesta 12).

const INBOX_PREVIEW_ROWS = 3;
const CARD_GAP = 16;
/** Ancho mínimo de las tarjetas de oferta de escritorio. */
const CARD_MIN_WIDTH = 230;

export default function TechnicianHome() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const { technicianId, technician, displayName, unseenApplicationResponses, pendingDirectOffers, refreshCounts } = useTechnicianNav();
  const { data, loading, failed, inboxLoading, inboxError, reload, reloadAside } = useTechnicianHome(technicianId, wide);
  const { engineIndex } = useEnginesCatalog();
  const [refreshing, setRefreshing] = useState(false);

  const summary = summarizeTechnicianHome(data.matches, data.relatedOfferIds, wide ? HOME_OFFER_CARDS : HOME_OFFER_ROWS);
  const companyName = (companyId: string) => data.companies[companyId]?.name ?? null;
  const openOffer = (id: string) => router.push(`/technician/offers/${id}` as never);
  const browseOffers = () => router.navigate(TECHNICIAN_TAB_ROUTES.offers as never);

  async function onRefresh() {
    setRefreshing(true);
    refreshCounts();
    await Promise.all([reload(), reloadAside()]);
    setRefreshing(false);
  }

  const bestBlock = (
    <BestMatchCard
      wide={wide}
      loading={loading}
      failed={failed}
      featured={summary.featured}
      bestEligible={summary.bestEligible}
      companyName={summary.featured ? companyName(summary.featured.offer.companyId) : null}
      logoPath={summary.featured ? data.companies[summary.featured.offer.companyId]?.logoPath : null}
      onOpen={openOffer}
      onBrowse={browseOffers}
      onCompleteProfile={() => router.navigate(TECHNICIAN_TAB_ROUTES.you as never)}
    />
  );

  const offersBlock = loading || failed ? null : (
    <OffersForYou
      wide={wide}
      items={summary.offersForYou}
      anyPublished={data.matches.length > 0}
      companyName={companyName}
      companyLogo={(id) => data.companies[id]?.logoPath ?? null}
      requirementLine={(item) => offerRequirementChips(item.offer, engineIndex).join(' · ')}
      onOpen={openOffer}
      onSeeAll={browseOffers}
    />
  );

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={wide ? styles.wideContent : styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={wide}
      >
        {wide ? (
          <View style={styles.wideRow}>
            <View style={styles.wideMain}>
              {bestBlock}
              {offersBlock}
            </View>
            <View style={styles.wideAside}>
              <InboxPreview
                entries={data.inbox.slice(0, INBOX_PREVIEW_ROWS)}
                loading={inboxLoading}
                error={inboxError}
                onRetry={reloadAside}
                onSeeAll={() => router.navigate(TECHNICIAN_TAB_ROUTES.inbox as never)}
                onOpen={(roomId) => router.push(`/technician/chats/${roomId}` as never)}
              />
              <YouPanel
                name={displayName}
                photoPath={technician?.photoPath}
                code={technician?.anonymousCode ?? ''}
                verificationStatus={technician?.verificationStatus}
                documentCount={data.documentCount}
                onOpenWork={() => router.push(TECHNICIAN_PROFILE_ROUTES.work as never)}
                onOpenDocuments={() => router.push(TECHNICIAN_DOCUMENTS_ROUTE as never)}
              />
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.logo} accessibilityRole="header">Aviation Job Talent</Text>

            <Pressable
              onPress={browseOffers}
              style={styles.searchPill}
              accessibilityRole="button"
              accessibilityLabel="Search offers"
            >
              <Search color={colors.textSecondary} size={20} strokeWidth={2} />
              <Text style={styles.searchLabel}>Search offers</Text>
            </Pressable>

            {bestBlock}

            <View style={styles.shortcuts} accessibilityRole="menu">
              <ShortcutCircle
                label="Applications"
                icon={ClipboardCheck}
                bg="#FDE7B5"
                fg="#8A4A0C"
                badge={unseenApplicationResponses}
                badgeLabel="new"
                onPress={() => router.push(TECHNICIAN_SECTION_ROUTES.applications as never)}
              />
              <ShortcutCircle
                label="Direct offers"
                icon={Inbox}
                bg="#D6ECF8"
                fg="#0B5E8C"
                badge={pendingDirectOffers}
                onPress={() => router.push(TECHNICIAN_SECTION_ROUTES.direct as never)}
              />
              <ShortcutCircle
                label="Map"
                icon={MapPin}
                bg="#D5F2E4"
                fg="#0B6B45"
                onPress={() => router.push(TECHNICIAN_SECTION_ROUTES.map as never)}
              />
              <ShortcutCircle
                label="My work"
                icon={BriefcaseBusiness}
                bg="#E3E8EE"
                fg="#33465A"
                onPress={() => router.push(TECHNICIAN_PROFILE_ROUTES.work as never)}
              />
            </View>

            {offersBlock}
          </>
        )}
      </ScrollView>
    </TechnicianScreen>
  );
}

// ── "Offers for you" ────────────────────────────────────────────────────────

function OffersForYou({
  wide,
  items,
  anyPublished,
  companyName,
  companyLogo,
  requirementLine,
  onOpen,
  onSeeAll,
}: {
  wide: boolean;
  items: OfferMatchResult[];
  anyPublished: boolean;
  companyName: (companyId: string) => string | null;
  companyLogo: (companyId: string) => string | null;
  requirementLine: (item: OfferMatchResult) => string;
  onOpen: (id: string) => void;
  onSeeAll: () => void;
}) {
  // Escritorio: todas las tarjetas del mismo ancho, también las de la última
  // fila (fase 8, I; como la Home de empresa y Your offers).
  const grid = useCardGrid(CARD_MIN_WIDTH, CARD_GAP);
  return (
    <View style={wide ? styles.offersWide : undefined}>
      <View style={styles.sectionHead}>
        <Text style={wide ? styles.sectionTitleWide : styles.sectionTitle} accessibilityRole="header">Offers for you</Text>
        <Pressable onPress={onSeeAll} hitSlop={10} accessibilityRole="link" accessibilityLabel="See all offers">
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>
          {anyPublished ? 'No other offers to suggest right now.' : 'There are no published offers at the moment.'}
        </Text>
      ) : wide ? (
        <View style={styles.cardGrid} onLayout={grid.onLayout}>
          {items.map((item) => (
            <View key={item.offer.id} style={[styles.gridCell, grid.itemStyle]}>
              <OfferResultCard
                offer={item.offer}
                score={item.score}
                companyName={companyName(item.offer.companyId)}
                logoPath={companyLogo(item.offer.companyId)}
                requirementLine={requirementLine(item)}
                status={null}
                onPress={() => onOpen(item.offer.id)}
              />
            </View>
          ))}
        </View>
      ) : (
        <View>
          {items.map((item, i) => (
            <OfferListRow
              key={item.offer.id}
              offer={item.offer}
              score={item.score}
              companyName={companyName(item.offer.companyId)}
                logoPath={companyLogo(item.offer.companyId)}
              last={i === items.length - 1}
              onPress={() => onOpen(item.offer.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Escritorio: Inbox y "You" ───────────────────────────────────────────────

function InboxPreview({
  entries,
  loading,
  error,
  onRetry,
  onSeeAll,
  onOpen,
}: {
  entries: TechnicianInboxEntry[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSeeAll: () => void;
  onOpen: (roomId: string) => void;
}) {
  return (
    <View style={styles.asideCard}>
      <View style={styles.sectionHead}>
        <Text style={styles.asideTitle} accessibilityRole="header">Inbox</Text>
        <Pressable onPress={onSeeAll} hitSlop={10} accessibilityRole="link" accessibilityLabel="See all conversations">
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : error ? (
        <View style={styles.asideState}>
          <Text style={styles.stateText}>Could not load conversations.</Text>
          <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      ) : entries.length === 0 ? (
        <Text style={styles.stateText}>No conversations yet. Chat opens after an accepted application or direct offer.</Text>
      ) : (
        entries.map((entry) => (
          <Pressable
            key={entry.room.id}
            onPress={() => onOpen(entry.room.id)}
            style={({ hovered }: any) => [styles.inboxRow, hovered && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${entry.companyName}${entry.isUnread ? ', new messages' : ''}`}
          >
            <Avatar kind="company" size={42} name={entry.companyName} logoPath={entry.logoPath} />
            <View style={styles.inboxCopy}>
              <Text style={styles.inboxName} numberOfLines={1}>{entry.companyName}</Text>
              <Text style={styles.inboxSub} numberOfLines={1}>
                {[entry.offerTitle, entry.isUnread ? 'New messages' : null].filter(Boolean).join(' · ') || 'Conversation'}
              </Text>
            </View>
            {entry.isUnread ? <View style={styles.unreadDot} /> : null}
          </Pressable>
        ))
      )}
    </View>
  );
}

/**
 * La tarjeta "You" de escritorio, como la de la empresa en W-D-Home. En
 * escritorio no hay círculos: My work y Documents se abren desde aquí. You
 * está en la barra superior.
 */
function YouPanel({
  photoPath,
  name,
  code,
  verificationStatus,
  documentCount,
  onOpenWork,
  onOpenDocuments,
}: {
  name: string;
  photoPath?: string | null;
  code: string;
  verificationStatus: string | undefined;
  documentCount: number | null;
  onOpenWork: () => void;
  onOpenDocuments: () => void;
}) {
  return (
    <View style={styles.asideCard}>
      <View style={styles.youHead}>
        <Avatar kind="person" size={48} name={name || null} photoPath={photoPath} />
        <View style={styles.youCopy}>
          <Text style={styles.youName} numberOfLines={1}>{name || ' '}</Text>
          {code ? <Text style={styles.youCode} numberOfLines={1}>{code}</Text> : null}
        </View>
      </View>
      <View style={styles.chips}>
        {verificationStatus ? <VerificationPill status={verificationStatus} /> : null}
        {documentCount != null ? (
          <StatusPill label={`${documentCount} document${documentCount === 1 ? '' : 's'}`} tone="muted" />
        ) : null}
      </View>
      <View style={styles.youActions}>
        <Pressable
          onPress={onOpenWork}
          style={({ hovered }: any) => [styles.panelButton, hovered && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.panelButtonText}>My work</Text>
        </Pressable>
        <Pressable
          onPress={onOpenDocuments}
          style={({ hovered }: any) => [styles.panelButton, hovered && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.panelButtonText}>Documents</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 20,
  },
  wideContent: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    padding: 32,
  },
  wideRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 32,
  },
  wideMain: {
    flexGrow: 999,
    flexShrink: 1,
    flexBasis: 560,
    minWidth: 0,
    gap: 28,
  },
  wideAside: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 300,
    minWidth: 0,
    gap: 16,
  },
  pressed: {
    backgroundColor: colors.surfaceSoft,
  },

  logo: {
    fontFamily: fonts.logo,
    fontSize: 21,
    letterSpacing: -0.2,
    color: colors.logo,
  },
  searchPill: {
    marginTop: -6,
    height: 50,
    paddingHorizontal: 18,
    borderRadius: 25,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchLabel: {
    fontSize: 15,
    color: colors.textSecondary,
  },

  stateText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },

  shortcuts: {
    flexDirection: 'row',
    gap: 8,
  },

  offersWide: {
    gap: 16,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  sectionTitleWide: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  link: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  emptyText: {
    paddingVertical: 12,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
  },
  // Hasta medir la rejilla se reparten la fila sin pasar de 360; después, todas
  // con el ancho que da useCardGrid.
  gridCell: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 230,
    minWidth: 230,
    maxWidth: 360,
  },

  asideCard: {
    borderWidth: 1,
    borderColor: '#E1E8EE',
    borderRadius: 18,
    padding: 18,
    gap: 14,
  },
  asideTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  asideState: {
    gap: 8,
    alignItems: 'flex-start',
  },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: TOUCH_TARGET,
    borderRadius: 12,
  },
  inboxCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  inboxName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.text,
  },
  inboxSub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  youHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  youCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  youName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  youCode: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  youActions: {
    flexDirection: 'row',
    gap: 8,
  },
  panelButton: {
    flex: 1,
    height: TOUCH_TARGET,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D9E2EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelButtonText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: colors.text,
  },
});
