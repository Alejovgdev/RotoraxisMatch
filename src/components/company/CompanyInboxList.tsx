// La lista de conversaciones del Inbox de empresa (rediseño, fase 3; maquetas
// W-Inbox y W-D-Inbox): avatar del técnico con el cuadrado de su oferta, nombre,
// oferta, último mensaje y lo que está sin leer.
//
// IDENTIDAD: nombre y avatar con iniciales sólo si la entrada lo trae
// desbloqueado (`canViewProfile`, que decide la base); si no, el código
// anónimo y el icono genérico. Ver src/state/companyInbox.ts.
//
// Desde la fase 5B el dibujo de la fila y del panel dividido vive en
// src/components/inbox/InboxParts.tsx, compartido con el técnico; aquí sólo se
// decide qué dice cada fila.
import React from 'react';
import { Avatar } from '../ui';
import {
  InboxOfferBadge,
  InboxRow,
  InboxRows,
  InboxSplit,
  conversationType,
  formatInboxTime,
} from '../inbox/InboxParts';
import type { CompanyInboxEntry } from '../../state/companyInbox';
import type { ChatMessage } from '../../types/chat';

export { conversationType, formatInboxTime };

export function messagePreview(message: ChatMessage | null): string {
  if (!message) return 'No messages yet';
  return `${message.senderRole === 'company' ? 'You: ' : ''}${message.body}`;
}

export function CompanyInboxRow({
  entry,
  wide,
  selected = false,
  last = false,
  onPress,
}: {
  entry: CompanyInboxEntry;
  wide: boolean;
  selected?: boolean;
  last?: boolean;
  onPress: () => void;
}) {
  const { room, techDisplay, offerTitle, lastMessage, isUnread, canViewProfile } = entry;
  const avatarSize = wide ? 50 : 56;
  return (
    <InboxRow
      wide={wide}
      selected={selected}
      last={last}
      avatar={(
        <>
          <Avatar kind="person" size={avatarSize} photoPath={entry.photoPath} anonymous={!canViewProfile} name={canViewProfile ? techDisplay : null} />
          {!wide ? <InboxOfferBadge offer={entry.offer} size={26} /> : null}
        </>
      )}
      name={techDisplay}
      line={[offerTitle ?? 'Accepted contact', conversationType(room)].join(' · ')}
      preview={messagePreview(lastMessage)}
      time={lastMessage ? formatInboxTime(lastMessage.sentAt) : null}
      isUnread={isUnread}
      accessibilityLabel={`${techDisplay}${isUnread ? ', new messages' : ''}`}
      onPress={onPress}
    />
  );
}

export function CompanyInboxList({
  entries,
  wide,
  selectedRoomId,
  onOpen,
}: {
  entries: CompanyInboxEntry[];
  wide: boolean;
  selectedRoomId?: string | null;
  onOpen: (roomId: string) => void;
}) {
  return (
    <InboxRows wide={wide}>
      {entries.map((entry, i) => (
        <CompanyInboxRow
          key={entry.room.id}
          entry={entry}
          wide={wide}
          selected={entry.room.id === selectedRoomId}
          last={i === entries.length - 1}
          onPress={() => onOpen(entry.room.id)}
        />
      ))}
    </InboxRows>
  );
}

/**
 * Escritorio: la lista a la izquierda y la conversación a la derecha
 * (documento, sección 1; maqueta W-D-Inbox). `children` es el panel derecho.
 */
export function CompanyInboxSplit({
  entries,
  loading,
  error,
  onRetry,
  selectedRoomId,
  onOpen,
  children,
}: {
  entries: CompanyInboxEntry[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  selectedRoomId: string | null;
  onOpen: (roomId: string) => void;
  children: React.ReactNode;
}) {
  return (
    <InboxSplit
      loading={loading}
      error={error}
      isEmpty={entries.length === 0}
      onRetry={onRetry}
      list={<CompanyInboxList entries={entries} wide selectedRoomId={selectedRoomId} onOpen={onOpen} />}
    >
      {children}
    </InboxSplit>
  );
}
