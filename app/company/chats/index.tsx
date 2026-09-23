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
import { MessageCircle } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import {
  ActivityDot,
  CompanyBadge,
  CompanyCard,
  CompanyPageHeader,
  CompanyScreen,
  EmptyPanel,
  IconBox,
  InitialAvatar,
  companyStyles,
  companyUi,
} from '../../../src/components/company/CompanyUI';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { isUnlocked } from '../../../src/types/privacy';
import { useCompanySession } from '../../../src/state/SessionContext';
import { ChatRoom, ChatMessage } from '../../../src/types/chat';
import { ViewTechnicianProfileButton } from '../../../src/components/company/ViewTechnicianProfileButton';

type RoomEntry = {
  room: ChatRoom;
  techDisplay: string;
  offerTitle: string | null;
  lastMessage: ChatMessage | null;
  isUnread: boolean;
  canViewProfile: boolean;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function conversationType(room: ChatRoom): string {
  if (room.offerRequestId) return 'Direct offer';
  if (room.offerApplicationId) return 'Application';
  return 'Contact';
}

function messagePreview(message: ChatMessage | null): string {
  if (!message) return 'No messages yet';
  return `${message.senderRole === 'company' ? 'You: ' : ''}${message.body}`;
}

export default function CompanyChatsScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;

  const [entries, setEntries] = useState<RoomEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!companyId) return;

    const [rooms, unreadRoomIds] = await Promise.all([
      chatRepository.getRoomsForCompany(companyId),
      activityRepository.getUnreadChatRoomIds('company', companyId),
    ]);

    const built = await Promise.all(rooms.map(async (room) => {
      let offerId: string | undefined;

      if (room.offerRequestId) {
        const req = await offerRequestRepository.getById(room.offerRequestId);
        offerId = req?.offerId;
      } else if (room.offerApplicationId) {
        const app = await offerApplicationRepository.getById(room.offerApplicationId);
        offerId = app?.offerId;
      }

      const [techView, offer, messages] = await Promise.all([
        technicianRepositoryV2.getViewForCompany(room.technicianId, companyId),
        offerId ? offerRepository.getById(offerId) : Promise.resolve(null),
        chatRepository.getMessages(room.id),
      ]);

      // techView is null when the technician account was deleted after
      // this chat was created (technician_public_view excludes non-active
      // profiles, migration 024) — the room and its message history stay
      // visible, just labeled instead of falling back to a generic
      // "Technician".
      const techDisplay = techView && isUnlocked(techView)
        ? `${techView.firstName} ${techView.lastName}`
        : techView
          ? techView.anonymousCode
          : '[Deleted user]';

      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

      return {
        room,
        techDisplay,
        offerTitle: offer?.title ?? null,
        lastMessage,
        isUnread: unreadRoomIds.has(room.id),
        canViewProfile: Boolean(techView && isUnlocked(techView)),
      };
    }));

    built.sort((a, b) => {
      if (a.isUnread !== b.isUnread) return a.isUnread ? -1 : 1;
      const aTime = a.lastMessage?.sentAt ?? a.room.createdAt;
      const bTime = b.lastMessage?.sentAt ?? b.room.createdAt;
      return bTime.localeCompare(aTime);
    });

    setEntries(built);
  }, [companyId]);

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

  if (loading) {
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
          eyebrow="Messaging"
          title="Chats"
          subtitle={`${entries.length} accepted conversation${entries.length !== 1 ? 's' : ''}`}
          onBack={goBack}
        />

        {entries.length === 0 ? (
          <EmptyPanel
            title="No chats yet"
            subtitle="Chat becomes available after an accepted application or accepted direct offer."
          />
        ) : null}

        {entries.map(({ room, techDisplay, offerTitle, lastMessage, isUnread, canViewProfile }) => (
          <TouchableOpacity
            key={room.id}
            style={styles.cardTouchable}
            onPress={() => router.push(`/company/chats/${room.id}` as any)}
            activeOpacity={0.75}
          >
            <CompanyCard style={[styles.card, isUnread && styles.cardUnread]}>
              {isUnread ? <ActivityDot /> : null}
              <View style={styles.cardTop}>
                <InitialAvatar label={techDisplay} size={46} color={companyUi.navy} />
                <View style={styles.cardBody}>
                  <View style={styles.titleRow}>
                    <Text style={styles.techName} numberOfLines={1}>{techDisplay}</Text>
                    {lastMessage ? <Text style={styles.time}>{formatTime(lastMessage.sentAt)}</Text> : null}
                  </View>
                  <Text style={styles.offerLine} numberOfLines={1}>{offerTitle ?? 'Accepted contact'}</Text>
                </View>
              </View>

              <View style={styles.previewRow}>
                <View style={styles.previewBlock}>
                  <View style={styles.previewLabelRow}>
                    <IconBox icon={MessageCircle} color={companyUi.accent} backgroundColor={companyUi.accentSoft} size={15} />
                    <Text style={styles.previewLabel}>{conversationType(room)}</Text>
                  </View>
                  <Text style={styles.preview} numberOfLines={2}>{messagePreview(lastMessage)}</Text>
                </View>
                <View style={styles.cardRight}>
                  <CompanyBadge label="Open" tone="cyan" small />
                  {canViewProfile ? (
                    <ViewTechnicianProfileButton technicianId={room.technicianId} />
                  ) : null}
                  <Text style={styles.chevron}>{'>'}</Text>
                </View>
              </View>
            </CompanyCard>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </CompanyScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  cardTouchable: {
    marginBottom: spacing.sm,
  },
  card: {
    position: 'relative',
    gap: spacing.md,
  },
  cardUnread: {
    borderColor: companyUi.redSoft,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  techName: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: companyUi.text,
  },
  time: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: companyUi.textMuted,
    flexShrink: 0,
  },
  offerLine: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
  },
  previewBlock: {
    flex: 1,
    minWidth: 0,
  },
  previewLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  previewLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: companyUi.accent,
  },
  preview: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
    flexShrink: 0,
  },
  chevron: {
    fontSize: 17,
    lineHeight: 18,
    fontWeight: '600',
    color: companyUi.textMuted,
  },
});
