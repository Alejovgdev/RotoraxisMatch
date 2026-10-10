// La lista de conversaciones del Inbox del técnico (rediseño, fase 5B; mismo
// patrón que el de empresa, maquetas W-Inbox y W-D-Inbox): el logo de la
// empresa (iniciales hasta la fase 7) con el cuadrado de su oferta, la empresa,
// la oferta, el último mensaje y lo que está sin leer. El dibujo es el común de
// src/components/inbox/InboxParts.tsx.
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
import type { TechnicianInboxEntry } from '../../state/technicianInbox';
import { technicianMessagePreview } from '../../utils/technicianRelations';

export function TechnicianInboxList({
  entries,
  wide,
  selectedRoomId,
  onOpen,
}: {
  entries: TechnicianInboxEntry[];
  wide: boolean;
  selectedRoomId?: string | null;
  onOpen: (roomId: string) => void;
}) {
  return (
    <InboxRows wide={wide}>
      {entries.map((entry, i) => (
        <InboxRow
          key={entry.room.id}
          wide={wide}
          selected={entry.room.id === selectedRoomId}
          last={i === entries.length - 1}
          avatar={(
            <>
              <Avatar kind="company" size={wide ? 50 : 56} name={entry.companyName} logoPath={entry.logoPath} />
              {!wide ? <InboxOfferBadge offer={entry.offer} size={26} /> : null}
            </>
          )}
          name={entry.companyName}
          line={[entry.offerTitle ?? 'Accepted contact', conversationType(entry.room)].join(' · ')}
          preview={technicianMessagePreview(entry.lastMessage)}
          time={entry.lastMessage ? formatInboxTime(entry.lastMessage.sentAt) : null}
          isUnread={entry.isUnread}
          accessibilityLabel={`${entry.companyName}${entry.isUnread ? ', new messages' : ''}`}
          onPress={() => onOpen(entry.room.id)}
        />
      ))}
    </InboxRows>
  );
}

/** Escritorio: la lista a la izquierda y la conversación (o el aviso) a la derecha. */
export function TechnicianInboxSplit({
  entries,
  loading,
  error,
  onRetry,
  selectedRoomId,
  onOpen,
  children,
}: {
  entries: TechnicianInboxEntry[];
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
      list={<TechnicianInboxList entries={entries} wide selectedRoomId={selectedRoomId} onOpen={onOpen} />}
    >
      {children}
    </InboxSplit>
  );
}
