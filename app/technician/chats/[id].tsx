import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import {
  EmptyPanel,
  InitialAvatar,
  TechnicianBadge,
  TechnicianCard,
  TechnicianPageHeader,
  TechnicianScreen,
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
import { notify, confirmAction } from '../../../src/utils/platformAlert';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} - ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
}

export default function TechnicianChatDetailScreen() {
  const technicianSession = useTechnicianSession();
  const profileId = technicianSession?.profileId;
  const technicianId = technicianSession?.technicianId;
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useGoBack();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const scrollRef = useRef<ScrollView>(null);

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [headerTitle, setHeaderTitle] = useState('Chat');
  const [subTitle, setSubTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    if (!id) return;
    setLocked(false);

    const r = await chatRepository.getRoom(id);
    if (!r) {
      setRoom(null);
      setLocked(true);
      return;
    }
    setRoom(r);

    let isAccepted = false;
    let offerId: string | undefined;

    if (r.offerRequestId) {
      const req = await offerRequestRepository.getById(r.offerRequestId);
      isAccepted = req?.status === 'accepted';
      offerId = req?.offerId;
    } else if (r.offerApplicationId) {
      const app = await offerApplicationRepository.getById(r.offerApplicationId);
      isAccepted = app?.status === 'accepted';
      offerId = app?.offerId;
    }

    if (!isAccepted) {
      setLocked(true);
      return;
    }

    const [company, offer, msgs] = await Promise.all([
      companyRepositoryV2.getById(r.companyId),
      offerId ? offerRepository.getById(offerId) : Promise.resolve(null),
      chatRepository.getMessages(id),
    ]);

    setHeaderTitle(company?.name ?? 'Company');
    setSubTitle(offer?.title ?? '');
    setMessages(msgs);
    await activityRepository.markChatRoomRead('technician', technicianId, id);
  }, [id, technicianId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    }
  }, [messages]);

  async function handleSend() {
    const body = text.trim();
    // Cuerpo vacio: no hay nada que enviar ni nada que decir. Mudo a proposito.
    if (!body || !id) return;
    // Sesion sin resolver: la accion NO puede completarse, asi que lo dice.
    if (!profileId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    setSending(true);
    try {
      const msg = await chatRepository.sendMessage(id, {
        senderUserId: profileId,
        senderRole: 'technician',
        body,
      });
      setText('');
      setMessages((prev) => [...prev, msg]);
    } catch (e: any) {
      notify('Error', e?.message ?? 'Could not send message.');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.technician} role="technician" />
      </>
    );
  }

  if (locked || !room) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.lockedContent, isWide && styles.contentWide]}>
          <TechnicianPageHeader
            eyebrow="Chat"
            title="Chat unavailable"
            subtitle="This conversation is only accessible for accepted contacts."
            onBack={goBack}
          />
          <EmptyPanel
            title="Accepted contact required"
            subtitle="Open chat becomes available once the related application or direct offer is accepted."
          />
        </View>
      </TechnicianScreen>
    );
  }

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={72}
      >
        <View style={[styles.headerContent, isWide && styles.contentWide]}>
          <TechnicianPageHeader
            eyebrow="Chat"
            title={headerTitle}
            subtitle={subTitle || 'Accepted contact'}
            onBack={goBack}
          />

          <TechnicianCard style={styles.contextCard}>
            <InitialAvatar label={headerTitle} size={44} />
            <View style={styles.contextText}>
              <Text style={styles.contextName} numberOfLines={1}>{headerTitle}</Text>
              <Text style={styles.contextSub} numberOfLines={1}>{subTitle || 'Accepted contact'}</Text>
            </View>
            <TechnicianBadge label="Active" tone="success" small />
          </TechnicianCard>

          <TechnicianCard style={styles.privacyBanner}>
            <Text style={styles.privacyBannerText}>
              🔓 Your identity is revealed to this company. Messages are private between both parties.
            </Text>
          </TechnicianCard>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={[styles.messagesContent, isWide && styles.contentWide]}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 && (
            <TechnicianCard style={styles.noMessages}>
              <Text style={styles.noMessagesText}>No messages yet. Start the conversation when ready.</Text>
            </TechnicianCard>
          )}

          {messages.map((msg) => {
            const isMine = msg.senderRole === 'technician';
            return (
              <View key={msg.id} style={[styles.messageRow, isMine && styles.messageRowMine]}>
                <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
                    {msg.body}
                  </Text>
                  <Text style={[styles.bubbleTime, isMine ? styles.bubbleTimeMine : styles.bubbleTimeTheirs]}>
                    {formatTime(msg.sentAt)}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.inputShell}>
          <View style={[styles.inputBar, isWide && styles.inputWide]}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Type a message..."
              placeholderTextColor={techUi.textMuted}
              multiline
              maxLength={1000}
              returnKeyType="default"
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!text.trim() || sending}
              activeOpacity={0.75}
            >
              <Text style={styles.sendBtnText}>{sending ? 'Sending' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </TechnicianScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  contentWide: {
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
  },
  lockedContent: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
  },
  headerContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  contextText: {
    flex: 1,
    minWidth: 0,
  },
  contextName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: techUi.text,
  },
  contextSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: techUi.textSoft,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  noMessages: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  noMessagesText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: techUi.textSoft,
    textAlign: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: spacing.sm,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleMine: {
    backgroundColor: techUi.accent,
    borderBottomRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: techUi.surface,
    borderWidth: 1,
    borderColor: techUi.border,
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  bubbleTextMine: {
    color: colors.white,
  },
  bubbleTextTheirs: {
    color: techUi.text,
  },
  bubbleTime: {
    marginTop: 5,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
  },
  bubbleTimeMine: {
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'right',
  },
  bubbleTimeTheirs: {
    color: techUi.textMuted,
  },
  inputShell: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: techUi.page,
    borderTopWidth: 1,
    borderTopColor: techUi.border,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    width: '100%',
  },
  inputWide: {
    maxWidth: 860,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 112,
    borderWidth: 1,
    borderColor: techUi.border,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: techUi.surface,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: techUi.text,
  },
  sendBtn: {
    minHeight: 46,
    minWidth: 76,
    borderRadius: 18,
    backgroundColor: techUi.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  sendBtnText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.white,
  },
  privacyBanner: {
    marginBottom: spacing.xs,
    backgroundColor: 'rgba(0,180,216,0.08)',
    borderColor: 'rgba(0,180,216,0.2)',
  },
  privacyBannerText: {
    fontSize: 12,
    lineHeight: 18,
    color: techUi.textSoft,
    fontWeight: '500',
  },
});
