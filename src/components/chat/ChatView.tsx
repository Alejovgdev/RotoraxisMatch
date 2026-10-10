// El dibujo de una conversación (maquetas W-Chat y W-D-Inbox), común a empresa y
// técnico desde la fase 5B. Sale de src/components/company/CompanyChatPanel.tsx
// sin cambiar el aspecto; la lógica (cargar, enviar, permisos, quién es la otra
// parte) sigue en el panel de cada lado.
//
//   - 'screen' (móvil): pantalla entera, con flecha de atrás y la tarjeta de la
//     oferta arriba;
//   - 'pane' (escritorio): el panel derecho del Inbox, al lado de la lista.
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ChevronLeft, ChevronRight, Lock, Send } from 'lucide-react-native';
import { Text, TextInput } from '../ui';
import { EmptyBlock, OfferTileSquare, PillButton } from '../company/CompanyPage';
import { colors } from '../../theme';
import { HOVER_BG, MOBILE_COLUMN, TOUCH_TARGET } from '../../theme/ui';
import { offerMetaLine } from '../../utils/companyHome';
import type { ChatMessage } from '../../types/chat';
import type { Offer } from '../../types/offer';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} - ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
}

export type ChatComposer =
  | { kind: 'input'; text: string; onChangeText: (text: string) => void; sending: boolean; onSend: () => void }
  /** Sin poder escribir: un Viewer, o la otra cuenta ya no existe. */
  | { kind: 'blocked'; text: string; withLock?: boolean };

export function ChatView({
  mode,
  onBack,
  status,
  lockedText,
  avatar,
  title,
  subtitle,
  headerRight,
  offer,
  onOpenOffer,
  systemText,
  messages,
  isMine,
  composer,
}: {
  mode: 'screen' | 'pane';
  /** Sólo en 'screen'. */
  onBack?: () => void;
  status: 'loading' | 'locked' | 'ready';
  /** El texto bajo "Accepted contact required" cuando el chat no está disponible. */
  lockedText: string;
  avatar?: React.ReactNode;
  title?: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  /** La oferta de la conversación: tarjeta arriba en móvil. */
  offer?: Offer | null;
  onOpenOffer?: () => void;
  systemText?: string;
  messages?: ChatMessage[];
  isMine?: (message: ChatMessage) => boolean;
  composer?: ChatComposer;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const pane = mode === 'pane';
  const list = messages ?? [];
  // Pantalla entera en un tablet: las líneas y los fondos ocupan todo el ancho,
  // pero cabecera, mensajes y campo van en la columna de móvil (fase 8).
  const { width } = useWindowDimensions();
  const side = pane ? 0 : Math.max(0, Math.floor((width - MOBILE_COLUMN) / 2));
  const headerGutter = side ? { paddingLeft: 4 + side, paddingRight: 16 + side } : null;
  const bodyGutter = side ? { paddingHorizontal: 16 + side } : null;
  const offerGutter = side ? { marginHorizontal: 16 + side } : null;

  useEffect(() => {
    if (list.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    }
  }, [list]);

  const backButton = !pane && onBack ? (
    <Pressable onPress={onBack} style={({ hovered }: any) => [styles.back, hovered && styles.backHover]} hitSlop={4} accessibilityRole="button" accessibilityLabel="Back to inbox">
      <ChevronLeft color={colors.text} size={26} strokeWidth={2.2} />
    </Pressable>
  ) : null;

  if (status === 'loading') {
    return (
      <View style={styles.flex}>
        {backButton ? <View style={[styles.header, headerGutter]}>{backButton}</View> : null}
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </View>
    );
  }

  if (status === 'locked') {
    return (
      <View style={styles.flex}>
        {backButton ? <View style={[styles.header, headerGutter]}>{backButton}<Text style={styles.headerName}>Chat unavailable</Text></View> : null}
        <View style={[styles.lockedBody, bodyGutter]}>
          <EmptyBlock title="Accepted contact required" text={lockedText} />
        </View>
      </View>
    );
  }

  const draft = composer?.kind === 'input' ? composer.text.trim() : '';
  // Escritorio (web, chat en panel): Enter envía y Mayúsculas+Enter hace un
  // salto de línea (fase 8, decisión G). En móvil Enter sigue siendo salto de
  // línea. Envía lo mismo que el botón, y sólo cuando el botón lo haría.
  const enterSends = pane && Platform.OS === 'web' && composer?.kind === 'input';
  function handleKeyPress(event: any) {
    if (!enterSends || composer?.kind !== 'input') return;
    const native = event?.nativeEvent ?? {};
    if (native.key !== 'Enter' || native.shiftKey || event?.shiftKey) return;
    // Mientras se compone un carácter (teclados con acentos, IME), Enter no envía.
    if (native.isComposing || native.keyCode === 229) return;
    event.preventDefault?.();
    if (draft && !composer.sending) composer.onSend();
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={pane ? 0 : 72}
    >
      <View style={[styles.header, pane && styles.headerPane, headerGutter]}>
        {backButton}
        {avatar}
        <View style={styles.headerCopy}>
          <Text style={[styles.headerName, pane && styles.headerNamePane]} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {headerRight}
      </View>

      {!pane && offer ? (
        onOpenOffer ? (
          <Pressable
            onPress={onOpenOffer}
            style={({ pressed, hovered }: any) => [styles.offerCard, offerGutter, (pressed || hovered) && styles.offerCardPressed]}
            accessibilityRole="link"
            accessibilityLabel={`Offer: ${offer.title}`}
          >
            <OfferCardBody offer={offer} />
            <ChevronRight color={colors.textMuted} size={18} strokeWidth={2} />
          </Pressable>
        ) : (
          <View style={[styles.offerCard, offerGutter]}>
            <OfferCardBody offer={offer} />
          </View>
        )
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.messages, pane && styles.messagesPane, bodyGutter]}
        showsVerticalScrollIndicator={pane}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {systemText ? (
          <View style={styles.systemPill}>
            <Text style={styles.systemText}>{systemText}</Text>
          </View>
        ) : null}

        {list.length === 0 ? (
          <Text style={styles.noMessages}>No messages yet. Start the conversation when ready.</Text>
        ) : null}

        {list.map((msg) => {
          const mine = isMine ? isMine(msg) : false;
          return (
            <View key={msg.id} style={[styles.messageWrap, mine ? styles.mineWrap : styles.theirsWrap, pane && styles.messageWrapPane]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{msg.body}</Text>
              </View>
              <Text style={[styles.time, mine && styles.timeMine]}>{formatTime(msg.sentAt)}</Text>
            </View>
          );
        })}
      </ScrollView>

      {composer?.kind === 'input' ? (
        <View style={[styles.inputBar, pane && styles.inputBarPane, bodyGutter]}>
          <TextInput
            style={styles.input}
            value={composer.text}
            onChangeText={composer.onChangeText}
            placeholder="Write a message"
            placeholderTextColor={colors.placeholder}
            multiline
            maxLength={1000}
            returnKeyType="default"
            accessibilityLabel="Message"
            onKeyPress={enterSends ? handleKeyPress : undefined}
          />
          {pane ? (
            <PillButton
              label={composer.sending ? 'Sending' : 'Send'}
              icon={Send}
              size="md"
              onPress={composer.onSend}
              disabled={!draft || composer.sending}
            />
          ) : (
            <Pressable
              onPress={composer.onSend}
              disabled={!draft || composer.sending}
              style={[styles.sendCircle, (!draft || composer.sending) && styles.sendCircleOff]}
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: !draft || composer.sending }}
            >
              {composer.sending ? <ActivityIndicator size="small" color={colors.white} /> : <Send color={colors.white} size={20} strokeWidth={2.2} />}
            </Pressable>
          )}
        </View>
      ) : composer?.kind === 'blocked' ? (
        <View style={[styles.blockedBar, bodyGutter]}>
          {composer.withLock ? <Lock color={colors.textSecondary} size={15} strokeWidth={2.4} /> : null}
          <Text style={styles.blockedText}>{composer.text}</Text>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function OfferCardBody({ offer }: { offer: Offer }) {
  return (
    <>
      <OfferTileSquare offer={offer} size={38} />
      <View style={styles.offerCopy}>
        <Text style={styles.offerTitle} numberOfLines={1}>{offer.title}</Text>
        <Text style={styles.offerMeta} numberOfLines={1}>{offerMetaLine(offer)}</Text>
      </View>
    </>
  );
}

/** El enlace "Profile" / "Offer" de la cabecera en móvil. */
export function ChatHeaderLink({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.headerLink} accessibilityRole="link" accessibilityLabel={accessibilityLabel}>
      <Text style={styles.headerLinkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lockedBody: { padding: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 4,
    paddingRight: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  headerPane: {
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 28,
  },
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backHover: {
    backgroundColor: HOVER_BG,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  headerNamePane: {
    fontSize: 17,
  },
  headerSub: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  headerLink: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  headerLinkText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  offerCard: {
    marginTop: 10,
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
  },
  offerCardPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  offerCopy: {
    flex: 1,
    minWidth: 0,
  },
  offerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  offerMeta: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  messages: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  messagesPane: {
    paddingVertical: 24,
    paddingHorizontal: 28,
    gap: 10,
  },
  systemPill: {
    alignSelf: 'center',
    maxWidth: 520,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceSoft,
    marginBottom: 4,
  },
  systemText: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  noMessages: {
    alignSelf: 'center',
    marginVertical: 12,
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  messageWrap: {
    maxWidth: '78%',
    gap: 3,
  },
  messageWrapPane: {
    maxWidth: '62%',
  },
  mineWrap: {
    alignSelf: 'flex-end',
  },
  theirsWrap: {
    alignSelf: 'flex-start',
  },
  bubble: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceMuted,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
  },
  bubbleTextMine: {
    color: colors.white,
  },
  time: {
    fontSize: 11.5,
    color: colors.textMuted,
  },
  timeMine: {
    textAlign: 'right',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  inputBarPane: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 14,
    paddingHorizontal: 28,
    paddingBottom: 20,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    maxHeight: 112,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 23,
    backgroundColor: colors.surfaceMuted,
    fontSize: 15,
    color: colors.text,
  },
  sendCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCircleOff: {
    backgroundColor: '#A9B6C3',
  },
  blockedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: '#F7F9FB',
  },
  blockedText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
