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
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { activityRepository } from '../../../src/repositories/v2/activityRepository';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { ChatRoom, ChatMessage } from '../../../src/types/chat';

type RoomEntry = {
  room: ChatRoom;
  companyName: string;
  offerTitle: string | null;
  lastMessage: ChatMessage | null;
  isUnread: boolean;
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
  return `${message.senderRole === 'technician' ? 'You: ' : ''}${message.body}`;
}

export default function TechnicianChatsScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const technicianSession = useTechnicianSession();
  const technicianId = technicianSession?.technicianId;
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [entries, setEntries] = useState<RoomEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    const [rooms, unreadRoomIds] = await Promise.all([
      chatRepository.getRoomsForTechnician(technicianId),
      activityRepository.getUnreadChatRoomIds('technician', technicianId),
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

      const [company, offer, messages] = await Promise.all([
        companyRepositoryV2.getById(room.companyId),
        offerId ? offerRepository.getById(offerId) : Promise.resolve(null),
        chatRepository.getMessages(room.id),
      ]);

      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

      return {
        room,
        companyName: company?.name ?? 'Company',
        offerTitle: offer?.title ?? null,
        lastMessage,
        isUnread: unreadRoomIds.has(room.id),
      };
    }));

    built.sort((a, b) => {
      if (a.isUnread !== b.isUnread) return a.isUnread ? -1 : 1;
      const aTime = a.lastMessage?.sentAt ?? a.room.createdAt;
      const bTime = b.lastMessage?.sentAt ?? b.room.createdAt;
      return bTime.localeCompare(aTime);
    });

    setEntries(built);
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

  if (loading) {
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
      >
        <TechnicianPageHeader
          eyebrow="Messaging"
          title="Chats"
          subtitle={`${entries.length} accepted conversation${entries.length !== 1 ? 's' : ''}`}
          onBack={goBack}
        />

        {entries.length === 0 && (
          <EmptyPanel
            title="No chats yet"
            subtitle="Chat becomes available after an accepted application or accepted direct offer."
          />
        )}

        {entries.map(({ room, companyName, offerTitle, lastMessage, isUnread }) => (
          <TouchableOpacity
            key={room.id}
            style={styles.cardTouchable}
            onPress={() => router.push(`/technician/chats/${room.id}` as any)}
            activeOpacity={0.75}
          >
            <TechnicianCard style={[styles.card, isUnread && styles.cardUnread]}>
              {isUnread ? <ActivityDot /> : null}
              <View style={styles.cardTop}>
                <InitialAvatar label={companyName} size={46} />
                <View style={styles.cardBody}>
                  <View style={styles.titleRow}>
                    <Text style={styles.companyName} numberOfLines={1}>{companyName}</Text>
                    {lastMessage ? <Text style={styles.time}>{formatTime(lastMessage.sentAt)}</Text> : null}
                  </View>
                  {offerTitle ? (
                    <Text style={styles.offerLine} numberOfLines={1}>{offerTitle}</Text>
                  ) : (
                    <Text style={styles.offerLine}>Accepted contact</Text>
                  )}
                </View>
              </View>

              <View style={styles.previewRow}>
                <View style={styles.previewBlock}>
                  <Text style={styles.previewLabel}>{conversationType(room)}</Text>
                  <Text style={styles.preview} numberOfLines={2}>{messagePreview(lastMessage)}</Text>
                </View>
                <View style={styles.cardRight}>
                  <TechnicianBadge label="Open" tone="cyan" small />
                  <Text style={styles.chevron}>{'>'}</Text>
                </View>
              </View>
            </TechnicianCard>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </TechnicianScreen>
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
    borderColor: techUi.redSoft,
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
  companyName: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: techUi.text,
  },
  time: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: techUi.textMuted,
    flexShrink: 0,
  },
  offerLine: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: techUi.textSoft,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: techUi.borderSoft,
  },
  previewBlock: {
    flex: 1,
    minWidth: 0,
  },
  previewLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: techUi.accent,
    marginBottom: 3,
  },
  preview: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: techUi.textSoft,
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
    color: techUi.textMuted,
  },
});
