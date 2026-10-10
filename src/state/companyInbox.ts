// Las conversaciones de una empresa, como las pinta el Inbox: con quién, de qué
// oferta, el último mensaje y si hay algo sin leer. La comparten la pantalla de
// chats y la vista previa del Inbox de la Home de escritorio (rediseño, fase 2),
// para que las dos digan lo mismo — en particular, el nombre del técnico.
//
// IDENTIDAD: el nombre sólo sale si la vista de la empresa lo trae desbloqueado
// (`isUnlocked`, que es la base quien decide: technician_public_view anula la
// identidad hasta un contacto aceptado). Si no, el código anónimo; y si la
// cuenta del técnico se borró, "[Deleted user]".
import { chatRepository } from '../repositories/v2/chatRepository';
import { offerRequestRepository } from '../repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../repositories/v2/offerApplicationRepository';
import { offerRepository } from '../repositories/v2/offerRepository';
import { technicianRepositoryV2 } from '../repositories/v2/technicianRepositoryV2';
import { activityRepository } from '../repositories/v2/activityRepository';
import { isUnlocked } from '../types/privacy';
import type { ChatMessage, ChatRoom } from '../types/chat';
import type { Offer } from '../types/offer';

export type CompanyInboxEntry = {
  room: ChatRoom;
  techDisplay: string;
  photoPath?: string | null;
  offerTitle: string | null;
  /** La oferta de la conversación, para su cuadrado de color (rediseño, fase 3). */
  offer: Offer | null;
  lastMessage: ChatMessage | null;
  isUnread: boolean;
  /** true sólo con la identidad desbloqueada: entonces hay perfil completo que abrir. */
  canViewProfile: boolean;
};

/** Sin leer primero; dentro de cada grupo, lo más reciente arriba. */
export async function loadCompanyInbox(companyId: string): Promise<CompanyInboxEntry[]> {
  const [rooms, unreadRoomIds] = await Promise.all([
    chatRepository.getRoomsForCompany(companyId),
    activityRepository.getUnreadChatRoomIds('company', companyId),
  ]);

  const built = await Promise.all(rooms.map(async (room): Promise<CompanyInboxEntry> => {
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
      photoPath: techView && isUnlocked(techView) ? techView.photoPath ?? null : null,
      offerTitle: offer?.title ?? null,
      offer: offer ?? null,
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

  return built;
}
