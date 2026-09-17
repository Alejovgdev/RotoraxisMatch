-- H15, resto. La 081 estrechó licencias, habilitaciones y motores a
-- company_can_read_technician_qualifications, pero dejó con la política vieja
-- —"cualquier usuario de empresa activo"— las otras dos tablas de
-- cualificación que el mismo loadTechnicianRelations lee en lote:
-- technician_aircraft_experience y technician_profile_types. Las dos son
-- campos del contrato público (aircraftExperience, technicianTypes), así que
-- un usuario de empresa podía leerlas de perfiles que technician_public_view
-- oculta. Misma regla que las otras tres: visible en la vista pública, o con
-- una candidatura u oferta directa entre medias.
--
-- Sin pérdida de acceso para las pantallas actuales: las dos direcciones de
-- matching y la búsqueda de empresa parten de technician_public_view
-- (getPublicMatchCandidates, technicianRepositoryV2.search), y candidaturas y
-- ofertas directas entran por las dos ramas de relación. Las políticas de
-- técnico propio (tae_select_own, tpt_select_own) y de admin
-- (tae_all_admin, tpt_all_admin) no se tocan.
DROP POLICY IF EXISTS tae_select_company ON public.technician_aircraft_experience;
CREATE POLICY tae_select_company ON public.technician_aircraft_experience FOR SELECT TO authenticated
  USING (public.company_can_read_technician_qualifications(technician_id));

DROP POLICY IF EXISTS tpt_select_company ON public.technician_profile_types;
CREATE POLICY tpt_select_company ON public.technician_profile_types FOR SELECT TO authenticated
  USING (public.company_can_read_technician_qualifications(technician_id));

NOTIFY pgrst, 'reload schema';
