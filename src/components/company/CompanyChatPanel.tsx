// Una conversación de empresa (rediseño, fase 3; maquetas W-Chat y W-D-Inbox).
//
// Es la lógica de app/company/chats/[id].tsx de antes, sin cambios, sacada a un
// componente para poder pintarla de dos formas:
//   - 'screen' (móvil): pantalla entera, con flecha de atrás y la tarjeta de
//     la oferta arriba;
//   - 'pane' (escritorio): el panel derecho del Inbox, al lado de la lista.
//
// Desde la fase 5B el dibujo vive en src/components/chat/ChatView.tsx, común
// con el técnico; aquí quedan la carga, el envío y los permisos.
//
// Reglas de siempre: el chat sólo existe con la relación aceptada; un Viewer
// no escribe ("Viewer role cannot send messages.", respuesta 20); si la cuenta
// del técnico se borró, el historial se ve pero no se envía nada.
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Avatar } from '../ui';
import { ChatHeaderLink, ChatView } from '../chat/ChatView';
import { chatRepository } from '../../repositories/v2/chatRepository';
import { offerRequestRepository } from '../../repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../../repositories/v2/offerApplicationRepository';
import { offerRepository } from '../../repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../../repositories/v2/technicianRepositoryV2';
import { activityRepository } from '../../repositories/v2/activityRepository';
import { isUnlocked } from '../../types/privacy';
import { useCompanySession } from '../../state/SessionContext';
import { canSendChatMessages } from '../../utils/companyPermissionsV2';
import { credentialLabel } from '../../constants/licenses';
import { technicianProfileHref } from '../../utils/companyNavigation';
import { notify } from '../../utils/platformAlert';
import type { ChatMessage, ChatRoom } from '../../types/chat';
import type { Offer } from '../../types/offer';
import { PillButton } from './CompanyPage';

export function CompanyChatPanel({
  roomId,
  mode,
  onBack,
  onMessageSent,
}: {
  roomId: string;
  mode: 'screen' | 'pane';
  /** Sólo en 'screen'. */
  onBack?: () => void;
  /** Para que la lista de al lado (escritorio) refresque el último mensaje. */
  onMessageSent?: () => void;
}) {
  const router = useRouter();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const companyMemberId = companySession?.companyMemberId;
  const companyMemberRole = companySession?.companyMemberRole;
  const profileId = companySession?.profileId;
  const pane = mode === 'pane';

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [headerTitle, setHeaderTitle] = useState('Chat');
  const [techLine, setTechLine] = useState('');
  const [offer, setOffer] = useState<Offer | null>(null);
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

    if (!roomId) return;
    setLocked(false);

    const r = await chatRepository.getRoom(roomId);
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

    const [techView, roomOffer, msgs] = await Promise.all([
      technicianRepositoryV2.getViewForCompany(r.technicianId, companyId),
      offerId ? offerRepository.getById(offerId) : Promise.resolve(null),
      chatRepository.getMessages(roomId),
    ]);

    // techView is null when the technician account was deleted after this
    // room was created (technician_public_view excludes non-active
    // profiles, migration 024) — message history stays visible, but
    // there's no one left to send a new message to.
    setTechnicianDeleted(!techView);
    setProfileUnlocked(Boolean(techView && isUnlocked(techView)));
    setPhotoPath(techView && isUnlocked(techView) ? techView.photoPath ?? null : null);
    const techDisplay = techView && isUnlocked(techView)
      ? `${techView.firstName} ${techView.lastName}`
      : techView
        ? techView.anonymousCode
        : '[Deleted user]';

    setHeaderTitle(techDisplay);
    setTechLine(techView
      ? [
          ...techView.licenses.slice(0, 2).map((l) => credentialLabel(l.authority, l.licenseCode)),
          techView.country,
        ].filter(Boolean).join(' · ')
      : '');
    setOffer(roomOffer);
    setMessages(msgs);
    await activityRepository.markChatRoomRead('company', companyId, roomId);
  }, [companyId, roomId]);

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
    // Un `return` mudo aqui es indistinguible de un boton roto (Fase 5.7).
    if (!profileId || !companyMemberId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    setSending(true);
    try {
      const msg = await chatRepository.sendMessage(roomId, {
        senderUserId: profileId,
        senderCompanyMemberId: companyMemberId,
        senderRole: 'company',
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

  const canSend = canSendChatMessages(companyMemberRole);
  // Abierto desde el chat: el perfil no ofrecerá "Open chat" (sería un bucle).
  const openProfile = () => {
    if (room) router.push(technicianProfileHref(room.technicianId, { fromChat: true }) as any);
  };
  const subtitle = pane && offer
    ? [techLine, `about ${offer.title}`].filter(Boolean).join(' · ')
    : techLine || (offer?.title ?? 'Accepted contact');

  return (
    <ChatView
      mode={mode}
      onBack={onBack}
      status={loading ? 'loading' : locked || !room ? 'locked' : 'ready'}
      lockedText="Chat opens after an accepted application or accepted direct offer. This conversation is only accessible for accepted contacts."
      avatar={<Avatar kind="person" size={pane ? 44 : 40} photoPath={photoPath} anonymous={!profileUnlocked} name={profileUnlocked ? headerTitle : null} />}
      title={headerTitle}
      subtitle={subtitle}
      headerRight={profileUnlocked ? (
        pane
          ? <PillButton label="View profile" variant="outline" size="sm" onPress={openProfile} />
          : <ChatHeaderLink label="Profile" onPress={openProfile} accessibilityLabel="View profile for technician" />
      ) : null}
      offer={offer}
      onOpenOffer={offer ? () => router.push(`/company/offers/${offer.id}` as any) : undefined}
      systemText={technicianDeleted
        ? "This technician's account has been deleted. Message history is kept, but you can no longer send new messages here."
        : "Identity revealed — this technician's identity and admin-verified documents are visible to your company. Messages are private between both parties."}
      messages={messages}
      isMine={(msg) => msg.senderRole === 'company'}
      composer={technicianDeleted
        ? { kind: 'blocked', text: "This technician's account has been deleted — no new messages can be sent." }
        : canSend
          ? { kind: 'input', text, onChangeText: setText, sending, onSend: handleSend }
          : { kind: 'blocked', text: 'Viewer role cannot send messages.', withLock: true }}
    />
  );
}
