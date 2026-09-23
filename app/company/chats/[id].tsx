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
import { MessageCircle, Send, UserRound } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import {
  CompanyBadge,
  CompanyCard,
  CompanyPageHeader,
  CompanyScreen,
  EmptyPanel,
  IconBox,
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
import { canSendChatMessages } from '../../../src/utils/companyPermissionsV2';
import { ChatRoom, ChatMessage } from '../../../src/types/chat';
import { notify, confirmAction } from '../../../src/utils/platformAlert';
import { ViewTechnicianProfileButton } from '../../../src/components/company/ViewTechnicianProfileButton';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} - ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
}

export default function CompanyChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useGoBack();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const scrollRef = useRef<ScrollView>(null);
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberId = companySession?.companyMemberId;
  const companyMemberRole = companySession?.companyMemberRole;
  const profileId = companySession?.profileId;

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [headerTitle, setHeaderTitle] = useState('Chat');
  const [subTitle, setSubTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [technicianDeleted, setTechnicianDeleted] = useState(false);
  const [profileUnlocked, setProfileUnlocked] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!companyId) return;

    if (!id) return;
    setLocked(false);

    const r = await chatRepository.getRoom(id);
    if (!r) { setLocked(true); return; }
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

    if (!isAccepted) { setLocked(true); return; }

    const [techView, offer, msgs] = await Promise.all([
      technicianRepositoryV2.getViewForCompany(r.technicianId, companyId),
      offerId ? offerRepository.getById(offerId) : Promise.resolve(null),
      chatRepository.getMessages(id),
    ]);

    // techView is null when the technician account was deleted after this
    // room was created (technician_public_view excludes non-active
    // profiles, migration 024) — message history stays visible, but
    // there's no one left to send a new message to.
    setTechnicianDeleted(!techView);
    setProfileUnlocked(Boolean(techView && isUnlocked(techView)));
    const techDisplay = techView && isUnlocked(techView)
      ? `${techView.firstName} ${techView.lastName}`
      : techView
        ? techView.anonymousCode
        : '[Deleted user]';

    setHeaderTitle(techDisplay);
    setSubTitle(offer?.title ?? '');
    setMessages(msgs);
    await activityRepository.markChatRoomRead('company', companyId, id);
  }, [companyId, id]);

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
    // Un `return` mudo aqui es indistinguible de un boton roto (Fase 5.7).
    if (!profileId || !companyMemberId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    setSending(true);
    try {
      const msg = await chatRepository.sendMessage(id, {
        senderUserId: profileId,
        senderCompanyMemberId: companyMemberId,
        senderRole: 'company',
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
        <LoadingScreen color={colors.blue} role="company" />
      </>
    );
  }

  if (locked || !room) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.lockedContent, isWide && styles.contentWide]}>
          <CompanyPageHeader
            eyebrow="Chat"
            title="Chat unavailable"
            subtitle="This conversation is only accessible for accepted contacts."
            onBack={goBack}
          />
          <EmptyPanel
            title="Accepted contact required"
            subtitle="Chat opens after an accepted application or accepted direct offer."
          />
        </View>
      </CompanyScreen>
    );
  }

  const canSend = canSendChatMessages(companyMemberRole);

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={72}
      >
        <View style={[styles.headerContent, isWide && styles.contentWide]}>
          <CompanyPageHeader
            eyebrow="Chat"
            title={headerTitle}
            subtitle={subTitle || 'Accepted contact'}
            onBack={goBack}
          />

          <CompanyCard style={styles.contextCard}>
            <IconBox icon={UserRound} color={companyUi.accent} backgroundColor={companyUi.accentSoft} />
            <View style={styles.contextText}>
              <Text style={styles.contextName} numberOfLines={1}>{headerTitle}</Text>
              <Text style={styles.contextSub} numberOfLines={1}>{subTitle || 'Accepted contact'}</Text>
            </View>
            <View style={styles.contextActions}>
              <CompanyBadge label={technicianDeleted ? 'Deleted' : 'Active'} tone={technicianDeleted ? 'muted' : 'success'} small />
              {profileUnlocked ? (
                <ViewTechnicianProfileButton technicianId={room.technicianId} />
              ) : null}
            </View>
          </CompanyCard>

          <CompanyCard style={styles.privacyBanner}>
            <Text style={styles.privacyBannerText}>
              {technicianDeleted
                ? '🚫 This technician\'s account has been deleted. Message history is kept, but you can no longer send new messages here.'
                : "🔓 Identity revealed — this technician's identity and admin-verified documents are visible to your company. Messages are private between both parties."}
            </Text>
          </CompanyCard>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={[styles.messagesContent, isWide && styles.contentWide]}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 ? (
            <CompanyCard style={styles.noMessages}>
              <IconBox icon={MessageCircle} color={companyUi.accent} backgroundColor={companyUi.accentSoft} />
              <Text style={styles.noMessagesText}>No messages yet. Start the conversation when ready.</Text>
            </CompanyCard>
          ) : null}

          {messages.map((msg) => {
            const isMine = msg.senderRole === 'company';
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
          {technicianDeleted ? (
            <View style={[styles.viewerBar, isWide && styles.inputWide]}>
              <Text style={styles.viewerNote}>This technician&apos;s account has been deleted — no new messages can be sent.</Text>
            </View>
          ) : canSend ? (
            <View style={[styles.inputBar, isWide && styles.inputWide]}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder="Type a message..."
                placeholderTextColor={companyUi.textMuted}
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
                <Send color={colors.white} size={16} strokeWidth={2} />
                <Text style={styles.sendBtnText}>{sending ? 'Sending' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.viewerBar, isWide && styles.inputWide]}>
              <Text style={styles.viewerNote}>Viewer role cannot send messages.</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </CompanyScreen>
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
  contextActions: {
    alignItems: 'flex-end',
    gap: spacing.xs,
    flexShrink: 0,
  },
  contextName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: companyUi.text,
  },
  contextSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: companyUi.textSoft,
  },
  messages: { flex: 1 },
  messagesContent: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  noMessages: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  noMessagesText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: companyUi.textSoft,
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
    backgroundColor: companyUi.accent,
    borderBottomRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: companyUi.surface,
    borderWidth: 1,
    borderColor: companyUi.border,
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  bubbleTextMine: { color: colors.white },
  bubbleTextTheirs: { color: companyUi.text },
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
  bubbleTimeTheirs: { color: companyUi.textMuted },
  inputShell: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: companyUi.page,
    borderTopWidth: 1,
    borderTopColor: companyUi.border,
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
    borderColor: companyUi.border,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: companyUi.surface,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: companyUi.text,
  },
  sendBtn: {
    minHeight: 46,
    minWidth: 88,
    borderRadius: 18,
    backgroundColor: companyUi.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.white,
  },
  viewerBar: {
    minHeight: 46,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: companyUi.border,
    backgroundColor: companyUi.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  viewerNote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: companyUi.textMuted,
    textAlign: 'center',
  },
  privacyBanner: {
    marginBottom: spacing.xs,
    backgroundColor: 'rgba(16,185,129,0.08)',
    borderColor: 'rgba(16,185,129,0.25)',
  },
  privacyBannerText: {
    fontSize: 12,
    lineHeight: 18,
    color: companyUi.textSoft,
    fontWeight: '500',
  },
});
