import React, { useState } from 'react';
import { isUnlocked } from '../../../src/types/privacy';
import { companyTechnicianName, companyTechnicianPhoto } from '../../../src/utils/companyTechnicianIdentity';
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
  BadgeCheck,
  ClipboardCheck,
  Inbox,
  MapPin,
  Search,
  Users,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import type { ViewStyle } from 'react-native';
import { Avatar, AvatarFrame, Text } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import { useCardGrid } from '../../../src/components/company/CompanyPage';
import { useCompanySession } from '../../../src/state/SessionContext';
import { useCompanyNav } from '../../../src/state/CompanyNavContext';
import { useCompanyHome } from '../../../src/state/useCompanyHome';
import { canReviewApplications } from '../../../src/utils/companyPermissionsV2';
import {
  applicantsLabel,
  offerMetaLine,
  offerTile,
  relativeTime,
  type CompanyHomeOffer,
  type CompanyHomePending,
} from '../../../src/utils/companyHome';
import { COMPANY_POST_OFFER_ROUTE } from '../../../src/utils/companyNavigation';
import type { CompanyInboxEntry } from '../../../src/state/companyInbox';
import { colors } from '../../../src/theme';
import { fonts } from '../../../src/theme/fonts';
import { MOBILE_COLUMN, radius, TOUCH_TARGET, UI_TONES, WIDE_BREAKPOINT } from '../../../src/theme/ui';

// Home de empresa (rediseño, fase 2; maquetas W-Home y W-D-Home).
//
// Desaparecen la tarjeta de perfil, el bloque de números y la lista de
// navegación de antes; la navegación la llevan ahora las barras. Todos los
// números salen de datos que la app ya tenía (src/state/useCompanyHome.ts).

const MOBILE_OFFER_ROWS = 5;
const DESKTOP_OFFER_CARDS = 6;
/** Ancho mínimo y separación de las tarjetas de oferta de escritorio. */
const OFFER_CARD_MIN_WIDTH = 230;
const OFFER_CARD_GAP = 16;
const INBOX_PREVIEW_ROWS = 3;

const AMBER_BG = '#FFF6E2';
const AMBER_BORDER = '#F3DDA4';
const AMBER_ICON = '#8A4A0C';

const ROLE_LABELS: Record<string, string> = { admin: 'Admin', recruiter: 'Recruiter', viewer: 'Viewer' };

function verificationChip(status: string | undefined): { label: string; tone: 'success' | 'warning' | 'error' | 'muted' } {
  if (status === 'verified') return { label: 'Verified', tone: 'success' };
  if (status === 'rejected') return { label: 'Rejected', tone: 'error' };
  if (status === 'pending') return { label: 'Pending verification', tone: 'warning' };
  return { label: 'Not verified', tone: 'muted' };
}

export default function CompanyHome() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const session = useCompanySession();
  const { company, role, isAdmin, canPostOffers, refreshCounts } = useCompanyNav();
  const { data, loading, error, inboxLoading, inboxError, reload, reloadInbox } = useCompanyHome(session?.companyId, wide);
  const [refreshing, setRefreshing] = useState(false);

  const canReview = canReviewApplications(role);
  const pending = data.pending;

  async function onRefresh() {
    setRefreshing(true);
    refreshCounts();
    await Promise.all([reload(), reloadInbox()]);
    setRefreshing(false);
  }

  function reviewPending() {
    const latest = pending.latest;
    if (pending.count === 1 && latest) router.push(`/company/applications/${latest.application.id}` as never);
    else router.push('/company/applications' as never);
  }

  const me = data.members.find((m) => m.userId === session?.profileId);
  const memberName = me?.displayName?.trim() || me?.email || '';

  const offersBlock = (
    <OffersSection
      wide={wide}
      offers={data.offers}
      loading={loading}
      error={error}
      canPostOffers={canPostOffers}
      onRetry={reload}
      onOpen={(id) => router.push(`/company/offers/${id}` as never)}
      onSeeAll={() => router.navigate('/company/offers' as never)}
      onPost={() => router.push(COMPANY_POST_OFFER_ROUTE as never)}
    />
  );

  return (
    <CompanyScreen>
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
              {pending.count > 0 ? (
                <PendingCard pending={pending} wide canReview={canReview} onReview={reviewPending} />
              ) : null}
              {offersBlock}
            </View>
            <View style={styles.wideAside}>
              <InboxPreview
                entries={data.inbox.slice(0, INBOX_PREVIEW_ROWS)}
                loading={inboxLoading}
                error={inboxError}
                onRetry={reloadInbox}
                onSeeAll={() => router.navigate('/company/chats' as never)}
                onOpen={(roomId) => router.push(`/company/chats/${roomId}` as never)}
              />
              <CompanyCardPanel
                name={company?.name ?? ''}
                logoPath={company?.logoPath}
                memberLine={[memberName, role ? ROLE_LABELS[role] : null].filter(Boolean).join(' · ')}
                verificationStatus={company?.verificationStatus}
                memberCount={data.members.length}
                loading={loading}
                onOpenProfile={() => router.navigate('/company/profile' as never)}
              />
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.logo} accessibilityRole="header">Aviation Job Talent</Text>

            <Pressable
              onPress={() => router.navigate('/company/search' as never)}
              style={styles.searchPill}
              accessibilityRole="button"
              accessibilityLabel="Search technicians"
            >
              <Search color={colors.textSecondary} size={20} strokeWidth={2} />
              <Text style={styles.searchLabel}>Search technicians</Text>
            </Pressable>

            {pending.count > 0 ? (
              <PendingCard pending={pending} canReview={canReview} onReview={reviewPending} />
            ) : null}

            <View style={styles.shortcuts} accessibilityRole="menu">
              <Shortcut
                label="Applications"
                icon={ClipboardCheck}
                bg="#FDE7B5"
                fg={AMBER_ICON}
                badge={pending.count}
                onPress={() => router.push('/company/applications' as never)}
              />
              <Shortcut
                label="Direct offers"
                icon={Inbox}
                bg="#D6ECF8"
                fg="#0B5E8C"
                onPress={() => router.push('/company/direct-offers' as never)}
              />
              <Shortcut
                label="Map"
                icon={MapPin}
                bg="#D5F2E4"
                fg="#0B6B45"
                onPress={() => router.push('/company/map' as never)}
              />
              {isAdmin ? (
                <Shortcut
                  label="Team"
                  icon={Users}
                  bg="#E3E8EE"
                  fg="#33465A"
                  onPress={() => router.push('/company/team' as never)}
                />
              ) : null}
            </View>

            {offersBlock}
          </>
        )}
      </ScrollView>
    </CompanyScreen>
  );
}

// ── Tarjeta "pendiente" ─────────────────────────────────────────────────────

function PendingCard({
  pending,
  wide = false,
  canReview,
  onReview,
}: {
  pending: CompanyHomePending;
  wide?: boolean;
  canReview: boolean;
  onReview: () => void;
}) {
  const one = pending.count === 1;
  const title = `${pending.count} new application${one ? '' : 's'}${wide ? ' waiting' : ''}`;
  const latest = pending.latest;
  const technician = latest?.technician;
  const name = technician === undefined ? null : companyTechnicianName(technician);
  const unlocked = Boolean(technician && isUnlocked(technician));
  const offerTitle = latest?.offerTitle ?? 'One of your offers';
  const subtitle = one
    ? wide && latest ? `${offerTitle} · applied ${relativeTime(latest.application.createdAt)}` : offerTitle
    : `Latest for ${offerTitle}`;
  // Un Viewer puede ver las candidaturas pero no aceptarlas ni rechazarlas:
  // el botón dice "View", como decía la acción de antes.
  const action = canReview ? 'Review' : 'View';

  return (
    <View style={[styles.pending, wide && styles.pendingWide]}>
      {/* El recuadro ámbar sólo con iniciales o el icono; con foto, la foto sola (fase 8, H). */}
      <AvatarFrame
        image={name ? { photoPath: companyTechnicianPhoto(technician ?? null), anonymous: !unlocked } : {}}
        style={[styles.pendingIcon, wide && styles.pendingIconWide]}
      >
        {name ? <Avatar kind="person" size={wide ? 48 : 42} photoPath={companyTechnicianPhoto(technician ?? null)} anonymous={!unlocked} name={unlocked ? name : null} />
          : <ClipboardCheck color={AMBER_ICON} size={wide ? 24 : 22} strokeWidth={2} />}
      </AvatarFrame>
      <View style={styles.pendingCopy}>
        <Text style={[styles.pendingTitle, wide && styles.pendingTitleWide]}>{title}</Text>
        {name ? <Text style={styles.pendingSub} numberOfLines={1}>{name}</Text> : null}
        <Text style={[styles.pendingSub, wide && styles.pendingSubWide]} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Pressable
        onPress={onReview}
        style={[styles.primaryPill, wide && styles.primaryPillWide]}
        accessibilityRole="button"
        accessibilityLabel={`${action} ${one ? 'application' : 'applications'}`}
      >
        <Text style={styles.primaryPillText}>{action}</Text>
      </Pressable>
    </View>
  );
}

// ── Círculos de acceso directo ──────────────────────────────────────────────

function Shortcut({
  label,
  icon: Icon,
  bg,
  fg,
  badge,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<LucideProps>;
  bg: string;
  fg: string;
  badge?: number;
  onPress: () => void;
}) {
  const count = badge && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null;
  return (
    <Pressable
      onPress={onPress}
      style={styles.shortcut}
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count} pending` : label}
    >
      <View style={[styles.shortcutCircle, { backgroundColor: bg }]}>
        <Icon color={fg} size={26} strokeWidth={2} />
        {count ? (
          <View style={styles.shortcutBadge}>
            <Text style={styles.shortcutBadgeText}>{count}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.shortcutLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// ── "Your offers" ───────────────────────────────────────────────────────────

function OffersSection({
  wide,
  offers,
  loading,
  error,
  canPostOffers,
  onRetry,
  onOpen,
  onSeeAll,
  onPost,
}: {
  wide: boolean;
  offers: CompanyHomeOffer[];
  loading: boolean;
  error: string | null;
  canPostOffers: boolean;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onSeeAll: () => void;
  onPost: () => void;
}) {
  const shown = offers.slice(0, wide ? DESKTOP_OFFER_CARDS : MOBILE_OFFER_ROWS);
  // Escritorio: todas las tarjetas del mismo ancho, también las de la última fila (fase 8).
  const grid = useCardGrid(OFFER_CARD_MIN_WIDTH, OFFER_CARD_GAP);
  return (
    <View style={wide ? styles.offersWide : styles.offers}>
      <View style={styles.sectionHead}>
        <Text style={wide ? styles.sectionTitleWide : styles.sectionTitle} accessibilityRole="header">
          Your offers{!loading && !error ? <Text style={styles.sectionCount}> {offers.length}</Text> : null}
        </Text>
        <Pressable onPress={onSeeAll} hitSlop={10} accessibilityRole="link" accessibilityLabel="See all offers">
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>Could not load your offers.</Text>
          <Pressable onPress={onRetry} style={styles.outlinePill} accessibilityRole="button">
            <Text style={styles.outlinePillText}>Retry</Text>
          </Pressable>
        </View>
      ) : offers.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>{canPostOffers ? 'Publish your first job offer' : 'No active job offers'}</Text>
          <Text style={styles.emptyText}>
            {canPostOffers
              ? 'Create a role to receive applications and start matching with qualified technicians.'
              : 'An admin or recruiter needs to publish an offer before the team can start finding candidates.'}
          </Text>
          {canPostOffers ? (
            <Pressable onPress={onPost} style={[styles.primaryPill, styles.emptyButton]} accessibilityRole="button">
              <Text style={styles.primaryPillText}>Post offer</Text>
            </Pressable>
          ) : null}
        </View>
      ) : wide ? (
        <View style={styles.cardGrid} onLayout={grid.onLayout}>
          {shown.map((item) => <OfferCard key={item.offer.id} item={item} style={grid.itemStyle} onPress={() => onOpen(item.offer.id)} />)}
        </View>
      ) : (
        <View>
          {shown.map((item, i) => (
            <OfferRow key={item.offer.id} item={item} last={i === shown.length - 1} onPress={() => onOpen(item.offer.id)} />
          ))}
        </View>
      )}
    </View>
  );
}

function tileFontSize(code: string, big: boolean): number {
  if (big) return code.length <= 3 ? 34 : code.length <= 4 ? 28 : 24;
  return code.length <= 2 ? 19 : code.length <= 3 ? 16 : 13;
}

function NewChip({ count }: { count: number }) {
  return (
    <View style={styles.newChip}>
      <Text style={styles.newChipText}>{count} new</Text>
    </View>
  );
}

function OfferRow({ item, last, onPress }: { item: CompanyHomeOffer; last: boolean; onPress: () => void }) {
  const tile = offerTile(item.offer);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [styles.offerRow, !last && styles.offerRowLine, (pressed || hovered) && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${item.offer.title}. ${item.pending > 0 ? `${item.pending} new` : applicantsLabel(item.applicants, 'No applicants')}`}
    >
      <View style={[styles.tile, { backgroundColor: tile.bg }]}>
        <Text style={[styles.tileCode, { color: tile.fg, fontSize: tileFontSize(tile.code, false) }]} numberOfLines={1}>
          {tile.code}
        </Text>
      </View>
      <View style={styles.offerCopy}>
        <Text style={styles.offerTitle} numberOfLines={1}>{item.offer.title}</Text>
        <Text style={styles.offerMeta} numberOfLines={1}>{offerMetaLine(item.offer)}</Text>
      </View>
      {item.pending > 0
        ? <NewChip count={item.pending} />
        : <Text style={styles.offerCount}>{applicantsLabel(item.applicants, '0 applicants')}</Text>}
    </Pressable>
  );
}

function OfferCard({ item, style, onPress }: { item: CompanyHomeOffer; style?: ViewStyle; onPress: () => void }) {
  const tile = offerTile(item.offer);
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered }: any) => [styles.offerCard, style, hovered && styles.offerCardHover]}
      accessibilityRole="button"
      accessibilityLabel={`${item.offer.title}. ${applicantsLabel(item.applicants)}`}
    >
      <View style={[styles.offerCardTop, { backgroundColor: tile.bg }]}>
        {item.pending > 0 ? <View style={styles.offerCardNew}><NewChip count={item.pending} /></View> : null}
        <Text style={[styles.tileCodeBig, { color: tile.fg, fontSize: tileFontSize(tile.code, true) }]} numberOfLines={1}>
          {tile.code}
        </Text>
        <Text style={[styles.tileType, { color: tile.fg }]} numberOfLines={1}>{tile.typeLabel}</Text>
      </View>
      <View style={styles.offerCardBody}>
        <Text style={styles.offerTitle} numberOfLines={1}>{item.offer.title}</Text>
        <Text style={styles.offerMeta} numberOfLines={1}>{offerMetaLine(item.offer)}</Text>
        <View style={styles.offerCardCount}>
          <Users color={item.applicants > 0 ? '#33465A' : colors.textMuted} size={15} strokeWidth={2} />
          <Text style={[styles.offerCardCountText, item.applicants > 0 && styles.offerCardCountActive]}>
            {applicantsLabel(item.applicants)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ── Escritorio: Inbox y empresa ─────────────────────────────────────────────

function InboxPreview({
  entries,
  loading,
  error,
  onRetry,
  onSeeAll,
  onOpen,
}: {
  entries: CompanyInboxEntry[];
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
            accessibilityLabel={`${entry.techDisplay}${entry.isUnread ? ', new messages' : ''}`}
          >
            {/* La identidad sigue la misma regla que el Inbox: nombre y avatar
                con iniciales sólo si la vista de empresa la trae desbloqueada. */}
            <Avatar kind="person" size={42} photoPath={entry.photoPath} anonymous={!entry.canViewProfile} name={entry.canViewProfile ? entry.techDisplay : null} />
            <View style={styles.inboxCopy}>
              <Text style={styles.inboxName} numberOfLines={1}>{entry.techDisplay}</Text>
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

function CompanyCardPanel({
  logoPath,
  name,
  memberLine,
  verificationStatus,
  memberCount,
  loading,
  onOpenProfile,
}: {
  name: string;
  logoPath?: string | null;
  memberLine: string;
  verificationStatus: string | undefined;
  memberCount: number;
  loading: boolean;
  onOpenProfile: () => void;
}) {
  const chip = verificationChip(verificationStatus);
  const tone = UI_TONES[chip.tone];
  return (
    <View style={styles.asideCard}>
      <View style={styles.companyHead}>
        <Avatar kind="company" size={48} name={name} logoPath={logoPath} />
        <View style={styles.companyCopy}>
          <Text style={styles.companyName} numberOfLines={1}>{name || ' '}</Text>
          {memberLine ? <Text style={styles.companyMember} numberOfLines={1}>{memberLine}</Text> : null}
        </View>
      </View>
      <View style={styles.chips}>
        {verificationStatus ? (
          <View style={[styles.chip, { backgroundColor: tone.bg }]}>
            {chip.tone === 'success' ? <BadgeCheck color={tone.text} size={14} strokeWidth={2.4} /> : null}
            <Text style={[styles.chipText, { color: tone.text }]}>{chip.label}</Text>
          </View>
        ) : null}
        {!loading && memberCount > 0 ? (
          <View style={[styles.chip, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={[styles.chipText, { color: '#33465A' }]}>
              {memberCount} member{memberCount === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={onOpenProfile}
        style={({ hovered }: any) => [styles.profileButton, hovered && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.profileButtonText}>Company profile</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    // Tablet: la Home de móvil en la columna centrada, como la del técnico (fase 8).
    width: '100%',
    maxWidth: MOBILE_COLUMN,
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

  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingRight: 14,
    paddingLeft: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AMBER_BORDER,
    backgroundColor: AMBER_BG,
  },
  pendingWide: {
    gap: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  pendingIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingIconWide: {
    width: 52,
    height: 52,
    borderRadius: 16,
  },
  pendingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pendingTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  pendingTitleWide: {
    fontSize: 17,
  },
  pendingSub: {
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  pendingSubWide: {
    fontSize: 14,
  },
  primaryPill: {
    height: TOUCH_TARGET,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPillWide: {
    paddingHorizontal: 22,
  },
  primaryPillText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.white,
  },

  shortcuts: {
    flexDirection: 'row',
    gap: 8,
  },
  shortcut: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  shortcutCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.notify,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutBadgeText: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    color: colors.white,
  },
  shortcutLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },

  offers: {},
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
  sectionCount: {
    fontWeight: '700',
    color: colors.textMuted,
  },
  link: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  stateBox: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 12,
  },
  stateText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  outlinePill: {
    height: TOUCH_TARGET,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlinePillText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: colors.text,
  },
  emptyBox: {
    marginTop: 8,
    padding: 18,
    borderRadius: 16,
    backgroundColor: colors.surfaceSoft,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  emptyButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },

  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  offerRowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  tile: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileCode: {
    fontFamily: fonts.display,
  },
  offerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  offerTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  offerMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  offerCount: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  newChip: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChipText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.warning,
  },

  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  offerCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 230,
    minWidth: 230,
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E1E8EE',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  offerCardHover: {
    borderColor: colors.border,
  },
  offerCardTop: {
    height: 104,
    paddingVertical: 14,
    paddingHorizontal: 16,
    justifyContent: 'flex-end',
    gap: 2,
  },
  offerCardNew: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  tileCodeBig: {
    fontFamily: fonts.display,
    lineHeight: 36,
  },
  tileType: {
    fontSize: 13,
    fontWeight: '800',
  },
  offerCardBody: {
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 4,
  },
  offerCardCount: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  offerCardCountText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  offerCardCountActive: {
    color: '#33465A',
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
  companyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  companyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  companyName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  companyMember: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipText: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  profileButton: {
    height: TOUCH_TARGET,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D9E2EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileButtonText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: colors.text,
  },
});
