// Las conversaciones de un técnico, como las pinta su Inbox: con qué empresa,
// de qué oferta, el último mensaje y si hay algo sin leer. Es el equivalente de
// src/state/companyInbox.ts.
//
// La comparten el Inbox (fase 5B), el chat de escritorio, que pinta la lista al
// lado, y la vista previa del Inbox en la Home de escritorio (fase 5A), para
// que las tres digan lo mismo.
import { chatRepository } from '../repositories/v2/chatRepository';
import { offerRequestRepository } from '../repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../repositories/v2/offerApplicationRepository';
import { offerRepository } from '../repositories/v2/offerRepository';
import { companyRepositoryV2 } from '../repositories/v2/companyRepositoryV2';
import { activityRepository } from '../repositories/v2/activityRepository';
import type { ChatMessage, ChatRoom } from '../types/chat';
import type { Offer } from '../types/offer';

export type TechnicianInboxEntry = {
  room: ChatRoom;
  companyName: string;
  logoPath?: string | null;
  offerTitle: string | null;
  /** La oferta de la conversación, para su cuadrado de color. */
  offer: Offer | null;
  lastMessage: ChatMessage | null;
  isUnread: boolean;
};

/** Sin leer primero; dentro de cada grupo, lo más reciente arriba. */
export async function loadTechnicianInbox(technicianId: string): Promise<TechnicianInboxEntry[]> {
  const [rooms, unreadRoomIds] = await Promise.all([
    chatRepository.getRoomsForTechnician(technicianId),
    activityRepository.getUnreadChatRoomIds('technician', technicianId),
  ]);

  const built = await Promise.all(rooms.map(async (room): Promise<TechnicianInboxEntry> => {
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

    return {
      room,
      companyName: company?.name ?? 'Company',
      logoPath: company?.logoPath ?? null,
      offerTitle: offer?.title ?? null,
      offer: offer ?? null,
      lastMessage: messages.length > 0 ? messages[messages.length - 1] : null,
      isUnread: unreadRoomIds.has(room.id),
    };
  }));

  built.sort((a, b) => {
    if (a.isUnread !== b.isUnread) return a.isUnread ? -1 : 1;
    const aTime = a.lastMessage?.sentAt ?? a.room.createdAt;
    const bTime = b.lastMessage?.sentAt ?? b.room.createdAt;
    return bTime.localeCompare(aTime);
  });

  return built;
}
