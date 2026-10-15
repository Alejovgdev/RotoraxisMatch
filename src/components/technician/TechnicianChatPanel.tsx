// Una conversación del técnico (rediseño, fase 5B; mismo patrón que la de
// empresa, maquetas W-Chat y W-D-Inbox). La lógica es la de
// app/technician/chats/[id].tsx de antes, sin cambios: el chat sólo existe con
// la relación aceptada, se marca como leído al abrirlo y el técnico escribe
// como 'technician'. El dibujo es el común de src/components/chat/ChatView.tsx:
//   - 'screen' (móvil): pantalla entera, con flecha de atrás y la tarjeta de
//     la oferta arriba;
//   - 'pane' (escritorio): el panel derecho del Inbox, al lado de la lista.
//
// La tarjeta de la oferta (y "View offer" en escritorio) abre la página de la
// candidatura o de la oferta directa MARCADA como abierta desde el chat
// (?from=chat), para que esa página no ofrezca "Open chat" y no haya bucle: la
// misma regla que el perfil del técnico en empresa.
import React, { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar } from '../ui';
import { ChatHeaderActions, ChatView } from '../chat/ChatView';
import { ModerationMenu } from '../moderation/ModerationMenu';
import { ReportSheet } from '../moderation/ReportSheet';
import { PillButton } from '../company/CompanyPage';
import { chatRepository } from '../../repositories/v2/chatRepository';
import { offerRequestRepository } from '../../repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../../repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../repositories/v2/offerRepository';
import { companyRepositoryV2 } from '../../repositories/v2/companyRepositoryV2';
import { activityRepository } from '../../repositories/v2/activityRepository';
import { useTechnicianSession } from '../../state/SessionContext';
import { chatContextHref } from '../../utils/technicianNavigation';
import { notify } from '../../utils/platformAlert';
import { reportMessageHint, type ReportTarget } from '../../utils/moderation';
import type { ChatMessage, ChatRoom } from '../../types/chat';
import type { Offer } from '../../types/offer';

export function TechnicianChatPanel({
  roomId,
  mode,
  onBack,
  onMessageSent,
  onBlocked,
}: {
  roomId: string;
  mode: 'screen' | 'pane';
  /** Sólo en 'screen'. */
  onBack?: () => void;
  /** Para que la lista de al lado (escritorio) refresque el último mensaje. */
  onMessageSent?: () => void;
  /** Tras bloquear a la empresa (100): el chat ya no existe para ninguno de los dos. */
  onBlocked?: () => void;
}) {
  const router = useRouter();
  const technicianSession = useTechnicianSession();
  const profileId = technicianSession?.profileId;
  const technicianId = technicianSession?.technicianId;
  const pane = mode === 'pane';

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('Chat');
  const [offer, setOffer] = useState<Offer | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const load = useCallback(async () => {
    // Fase 5.4 — sesion sin resolver: no se dispara ninguna query con un id
    // vacio. El .finally(setLoading(false)) del efecto apaga el spinner, asi
    // que la pantalla cae en su estado vacio en vez de colgarse o crashear.
    if (!technicianId) return;

    if (!roomId) return;
    setLocked(false);

    const r = await chatRepository.getRoom(roomId);
    if (!r) {
      setRoom(null);
      setLocked(true);
      return;
    }
    setRoom(r);

    let isAccepted = false;
    let linkedOfferId: string | undefined;

    if (r.offerRequestId) {
      const req = await offerRequestRepository.getById(r.offerRequestId);
      isAccepted = req?.status === 'accepted';
      linkedOfferId = req?.offerId;
    } else if (r.offerApplicationId) {
      const app = await offerApplicationRepository.getById(r.offerApplicationId);
      isAccepted = app?.status === 'accepted';
      linkedOfferId = app?.offerId;
    }

    if (!isAccepted) {
      setLocked(true);
      return;
    }

    const [company, roomOffer, msgs] = await Promise.all([
      companyRepositoryV2.getById(r.companyId),
      linkedOfferId ? offerRepository.getById(linkedOfferId) : Promise.resolve(null),
      chatRepository.getMessages(roomId),
    ]);

    setCompanyName(company?.name ?? 'Company');
    setLogoPath(company?.logoPath ?? null);
    setOffer(roomOffer);
    setOfferId(linkedOfferId ?? null);
    setMessages(msgs);
    await activityRepository.markChatRoomRead('technician', technicianId, roomId);
  }, [roomId, technicianId]);

  useEffect(() => {
    setLoading(true);
    setText('');
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleSend() {
    const body = text.trim();
    // Cuerpo vacio: no hay nada que enviar ni nada que decir. Mudo a proposito.
    if (!body || !roomId) return;
    // Sesion sin resolver: la accion NO puede completarse, asi que lo dice.
    if (!profileId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    setSending(true);
    try {
      const msg = await chatRepository.sendMessage(roomId, {
        senderUserId: profileId,
        senderRole: 'technician',
        body,
      });
      setText('');
      setMessages((prev) => [...prev, msg]);
      onMessageSent?.();
    } catch (e: any) {
      notify('Error', e?.message ?? 'Could not send message.');
    } finally {
      setSending(false);
    }
  }

  const contextHref = room ? chatContextHref(room, offerId) : null;
  const openContext = contextHref ? () => router.push(contextHref as never) : undefined;
  const contextLabel = room?.offerRequestId ? 'View direct offer' : 'View offer';
  const subtitle = pane
    ? (offer ? `about ${offer.title}` : 'Accepted contact')
    : offer?.title ?? 'Accepted contact';

  const contextButton = pane && openContext ? <PillButton label={contextLabel} variant="outline" size="sm" onPress={openContext} /> : null;
  // Denunciar y bloquear (100).
  const moderation = room && technicianId && !loading && !locked ? (
    <ModerationMenu
      block={{ companyId: room.companyId, technicianId, counterpart: 'company', name: companyName }}
      hint={reportMessageHint(Platform.OS)}
      onBlocked={onBlocked}
    />
  ) : null;

  return (
    <>
    <ChatView
      mode={mode}
      onBack={onBack}
      status={loading ? 'loading' : locked || !room ? 'locked' : 'ready'}
      lockedText="Open chat becomes available once the related application or direct offer is accepted."
      avatar={<Avatar kind="company" size={pane ? 44 : 40} name={companyName} logoPath={logoPath} />}
      title={companyName}
      subtitle={subtitle}
      headerRight={contextButton || moderation ? <ChatHeaderActions>{contextButton}{moderation}</ChatHeaderActions> : null}
      offer={offer}
      onOpenOffer={openContext}
      systemText="Your identity is revealed to this company. Messages are private between both parties."
      messages={messages}
      isMine={(msg) => msg.senderRole === 'technician'}
      onReportMessage={(msg) => setReportTarget({ type: 'chat_message', id: msg.id })}
      composer={{ kind: 'input', text, onChangeText: setText, sending, onSend: handleSend }}
    />
    <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />
    </>
  );
}
