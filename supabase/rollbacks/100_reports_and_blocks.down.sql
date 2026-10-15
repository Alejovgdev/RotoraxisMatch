-- ============================================================
-- Deshace la migración 100 (denuncias y bloqueos)
-- ============================================================
-- NO es una migración: es la vuelta atrás de emergencia, a mano, desde el
-- editor SQL de Supabase o la Management API. Antes, exporta lo que quieras
-- conservar: BORRA las denuncias (content_reports) y los bloqueos
-- (contact_blocks) guardados.
--
-- Deja las cinco reglas del chat EXACTAMENTE como estaban antes de la 100
-- (las de la 034); el ensayo lo comprueba comparando el esquema antes de
-- aplicar la 100 y después de aplicarla y deshacerla
-- (node scripts/rehearseReportsAndBlocks.cjs).
--
-- Orden: primero las reglas (usan contact_blocked), después triggers,
-- funciones y tablas.
--
-- No toca el historial de migraciones. Si además se quiere que la 100 conste
-- como no aplicada, es un paso aparte y deliberado:
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '<versión de la 100>';
-- ============================================================

BEGIN;

ALTER POLICY cr_select_company ON public.chat_rooms
  USING (is_active_user() AND company_id = my_company_id());

ALTER POLICY cr_select_technician ON public.chat_rooms
  USING (is_active_user() AND technician_id = my_technician_id());

ALTER POLICY cm_msg_select_participant ON public.chat_messages
  USING (is_active_user() AND EXISTS (
    SELECT 1 FROM chat_rooms cr
     WHERE cr.id = chat_messages.chat_room_id
       AND (cr.technician_id = my_technician_id() OR cr.company_id = my_company_id())));

ALTER POLICY cm_msg_insert_company ON public.chat_messages
  WITH CHECK (is_active_user() AND sender_user_id = auth.uid() AND sender_role = 'company'::sender_role
    AND EXISTS (
      SELECT 1 FROM chat_rooms cr
        JOIN company_members mem ON mem.company_id = cr.company_id AND mem.user_id = auth.uid()
       WHERE cr.id = chat_messages.chat_room_id
         AND cr.company_id = my_company_id()
         AND can_act_for_company(cr.company_id)
         AND (chat_messages.sender_company_member_id IS NULL OR chat_messages.sender_company_member_id = mem.id)));

ALTER POLICY cm_msg_insert_technician ON public.chat_messages
  WITH CHECK (is_active_user() AND sender_user_id = auth.uid() AND sender_role = 'technician'::sender_role
    AND sender_company_member_id IS NULL
    AND EXISTS (
      SELECT 1 FROM chat_rooms cr
       WHERE cr.id = chat_messages.chat_room_id
         AND cr.technician_id = my_technician_id()));

DROP TRIGGER enforce_contact_not_blocked ON public.offer_applications;
DROP TRIGGER enforce_contact_not_blocked ON public.offer_requests;
DROP FUNCTION public.enforce_contact_not_blocked();
DROP FUNCTION public.report_content(text, uuid, text);
DROP FUNCTION public.block_contact(uuid, uuid);
DROP FUNCTION public.contact_blocked(uuid, uuid);
DROP TABLE public.content_reports;
DROP TABLE public.contact_blocks;

NOTIFY pgrst, 'reload schema';

COMMIT;
