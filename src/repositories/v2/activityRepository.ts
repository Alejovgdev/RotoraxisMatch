import { supabase } from '../../lib/supabase';
import { ActivityItem, ActivityType } from '../../types/activity';

/**
 * Las respuestas a una candidatura que avisan al técnico: aceptada o rechazada.
 * Sin leer, son el punto rojo de su lista de candidaturas y, desde la fase 8,
 * el número de Applications (círculo de la Home y barra de escritorio).
 */
export const APPLICATION_RESPONSE_EVENTS: ActivityType[] = ['application_accepted', 'application_rejected'];

// Activity events are created by database triggers (migration 005).
// Clients only READ events and write activity_reads (mark-as-read).

export const activityRepository = {
  // No-op: triggers handle writes server-side.
  async create(fields: {
    type: ActivityType;
    recipientRole: 'technician' | 'company';
    recipientId: string;
    entityId: string;
  }): Promise<ActivityItem> {
    return { ...fields, id: '', read: false, createdAt: new Date().toISOString() };
  },

  // Returns the set of entity_ids (offer_application_id / offer_request_id / chat_room_id)
  // for which there are unread activity_events of the given types.
  async getUnreadEntityIds(
    recipientRole: 'technician' | 'company',
    recipientId: string,
    types: ActivityType[],
  ): Promise<Set<string>> {
    const scopeField = recipientRole === 'technician'
      ? 'recipient_technician_id'
      : 'recipient_company_id';

    const { data: events, error } = await supabase
      .from('activity_events')
      .select('id, entity_id')
      .eq('recipient_scope', recipientRole)
      .eq(scopeField, recipientId)
      .in('type', types);

    if (error || !events?.length) return new Set();

    // RLS on activity_reads filters to auth.uid() automatically.
    const { data: reads } = await supabase
      .from('activity_reads')
      .select('activity_event_id')
      .in('activity_event_id', events.map((e) => e.id));

    const readIds = new Set((reads ?? []).map((r: any) => r.activity_event_id as string));
    return new Set(
      events
        .filter((e) => !readIds.has(e.id))
        .map((e) => e.entity_id as string),
    );
  },

  /**
   * Las candidaturas del técnico con una respuesta (aceptada o rechazada) que
   * aún no ha visto. Es el mismo dato que el punto rojo de su lista: aplicar
   * no lo cambia (ese aviso es para la empresa), una respuesta lo sube y
   * abrirla (markRead) lo baja.
   */
  async getUnseenApplicationResponseIds(technicianId: string): Promise<Set<string>> {
    return this.getUnreadEntityIds('technician', technicianId, APPLICATION_RESPONSE_EVENTS);
  },

  async getUnreadCount(
    recipientRole: 'technician' | 'company',
    recipientId: string,
    types: ActivityType[],
  ): Promise<number> {
    const ids = await this.getUnreadEntityIds(recipientRole, recipientId, types);
    return ids.size;
  },

  // Marks all unread events for a given entityId as read for the current user.
  async markRead(
    recipientRole: 'technician' | 'company',
    recipientId: string,
    entityId: string,
  ): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    const profileId = session?.user?.id;
    if (!profileId) return;

    const scopeField = recipientRole === 'technician'
      ? 'recipient_technician_id'
      : 'recipient_company_id';

    const { data: events } = await supabase
      .from('activity_events')
      .select('id')
      .eq('recipient_scope', recipientRole)
      .eq(scopeField, recipientId)
      .eq('entity_id', entityId);

    if (!events?.length) return;

    // NO lleva comprobación de filas afectadas, y es deliberado: con
    // `ignoreDuplicates` un evento ya leído devuelve cero filas, que es
    // justamente el caso normal al reabrir algo. Exigir >= 1 aquí lanzaría un
    // error cada vez que vuelves a abrir una conversación ya vista.
    //
    // Lo que sí faltaba era mirar el error: la llamada se descartaba entera,
    // así que un fallo de RLS o de red dejaba el punto rojo encendido para
    // siempre sin que nadie se enterara. Se registra, no se lanza: marcar como
    // leído es un efecto secundario de abrir una pantalla, y reventarla por
    // esto sería peor que el badge desactualizado.
    const { error } = await supabase
      .from('activity_reads')
      .upsert(
        events.map((e) => ({ activity_event_id: e.id, profile_id: profileId })),
        { onConflict: 'activity_event_id,profile_id', ignoreDuplicates: true },
      );
    if (error) {
      console.warn('[activityRepository.markRead] Could not mark activity as read:', error.message);
    }
  },

  // Returns chat room IDs that have at least one unread message event.
  async getUnreadChatRoomIds(
    recipientRole: 'technician' | 'company',
    recipientId: string,
  ): Promise<Set<string>> {
    return this.getUnreadEntityIds(recipientRole, recipientId, ['chat_message_received']);
  },

  // Marks all unread chat_message_received events for a room as read.
  async markChatRoomRead(
    recipientRole: 'technician' | 'company',
    recipientId: string,
    chatRoomId: string,
  ): Promise<void> {
    return this.markRead(recipientRole, recipientId, chatRoomId);
  },
};
