import { useState, useEffect, useCallback } from 'react';
import { SafeTechnicianView } from '../types';
import { indexCountriesByCode, resolveMapPin } from '../utils/locationBridge';
import { useCountryCatalog } from './useCountryCatalog';
import type { TechnicianSearchQuery } from '../utils/technicianSearchFilterMatch';
import { TechnicianHabilitation } from '../types/technician';
import { TechnicianTypeCode } from '../types/catalog';
import { technicianRepositoryV2 } from '../repositories/v2/technicianRepositoryV2';
import { offerRequestRepository } from '../repositories/v2/offerRequestRepository';
import { offerApplicationRepository } from '../repositories/v2/offerApplicationRepository';
import { catalogRepository } from '../repositories/v2/catalogRepository';
import { buildAircraftRatingIndex } from '../constants/aircraftTypeRatings';
import { canRevealIdentity } from '../utils/privacyV2';
import { isUnlocked } from '../types/privacy';
import {
  v2SafePreviewToSafeView,
  v2UnlockedViewToSafeView,
} from '../utils/v2CompatAdapters';
import { useCompanySession } from './SessionContext';

interface UseMapTechniciansReturn {
  technicians: SafeTechnicianView[];
  loading: boolean;
  // Profile trades are kept separate from the temporary V1-compatible
  // technician shape. They already arrive from technician_profile_types;
  // the map only needs to preserve them instead of discarding them.
  technicianTypesById: Record<string, TechnicianTypeCode[]>;
  // Raw habilitations per technician (from the same server-filtered
  // preview fetch, before the V1-compat flattening) — the map component
  // resolves these to catalog displayName ("Type ratings") itself, same
  // as search.tsx's TechnicianResultCard, instead of the flattened
  // technician.aircraftTypes family/legacy-code strings.
  habilitationsById: Record<string, TechnicianHabilitation[]>;
}


// Internal filter-relevance score used for result ordering only. Never
// displayed in the UI — not an offer match score. Every technician
// reaching this point already satisfies every ACTIVE filter dimension
// (filtering now happens server-side, technicianRepositoryV2.search() —
// see the Fase 3b screen 4 fix, 2026-07-22), so "does it match" is no
// longer the question for an active dimension, it's guaranteed; this only
// weights how many dimensions were actively narrowed plus a flat verified
// bonus, same ordering intent the old client-side-matchesAny version had.
function scoreMapMatch(technician: SafeTechnicianView, filters: {
  licenses: string[];
  aircraft: string[];
  availability: string[];
}): number {
  let score = 0;
  if (filters.licenses.length > 0) score += 30;
  if (filters.aircraft.length > 0) score += 30;
  if (filters.availability.length > 0) score += 15;
  if (technician.verificationStatus === 'verified') score += 10;
  return score;
}

// Rediseño, fase 3B: la consulta es la de los filtros COMPARTIDOS con la
// búsqueda (toTechnicianSearchQuery), y sólo cambia al pulsar "Show
// technicians", así que el mapa ya no recarga en cada toque del panel.
export function useMapTechnicians(query: TechnicianSearchQuery): UseMapTechniciansReturn {
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const [technicians, setTechnicians] = useState<SafeTechnicianView[]>([]);
  const [habilitationsById, setHabilitationsById] = useState<Record<string, TechnicianHabilitation[]>>({});
  const [technicianTypesById, setTechnicianTypesById] = useState<Record<string, TechnicianTypeCode[]>>({});
  const [loading, setLoading] = useState(true);
  // El catálogo de países: sin él no hay centroide al que caer cuando la
  // ciudad no vino del directorio. Comparte caché con el resto de la app.
  const { countries } = useCountryCatalog();

  const load = useCallback(async () => {
    // companyId hydrates asynchronously in SessionContext (a separate
    // company_members fetch, independent of the auth guard the layout
    // waits for) — reading it before that resolves calls getForCompany('')
    // and crashes on the Postgres UUID cast. Same guard as
    // app/company/offers/index.tsx and [id].tsx; loading stays true until
    // companyId arrives and this callback (recreated via the companyId
    // dependency below) reruns automatically.
    if (!companyId) return;
    setLoading(true);
    const selected = {
      licenses: query.licenseCodes ?? [],
      aircraft: query.aircraftFamilyKeys ?? [],
      availability: query.availabilityStatuses ?? [],
    };

    // Real server-side filtering (technicianRepositoryV2.search()) — this
    // used to call search({}) (everything, unfiltered) and post-filter
    // client-side, the same decorative-filter bug the search screen had
    // (Fase 3b screen 3 fix, 2026-07-22). Also benefits from migration 024
    // for free: deleted/blocked/suspended technicians are excluded by
    // technician_public_view itself, before this hook ever sees them.
    const [previews, offerRequests, offerApplications, ratings] = await Promise.all([
      technicianRepositoryV2.search(query),
      offerRequestRepository.getForCompany(companyId),
      offerApplicationRepository.getForCompany(companyId),
      catalogRepository.getAircraftTypeRatings(),
    ]);
    const ratingIndex = buildAircraftRatingIndex(ratings);

    const nextHabilitationsById: Record<string, TechnicianHabilitation[]> = {};
    const nextTechnicianTypesById: Record<string, TechnicianTypeCode[]> = {};
    previews.forEach((preview) => {
      nextHabilitationsById[preview.id] = preview.habilitations;
      nextTechnicianTypesById[preview.id] = preview.technicianTypes;
    });

    const views = await Promise.all(
      previews.map(async (preview) => {
        const accepted = canRevealIdentity({
          companyId,
          technicianId: preview.id,
          offerRequests,
          offerApplications,
        });

        if (!accepted) return v2SafePreviewToSafeView(preview, ratingIndex);

        const view = await technicianRepositoryV2.getViewForCompany(preview.id, companyId);
        if (!view || !isUnlocked(view)) return v2SafePreviewToSafeView(preview, ratingIndex);
        return v2UnlockedViewToSafeView(view, ratingIndex);
      }),
    );

    // ── EL PIN, POR REGLA (Fase 7 F2c) ──────────────────────────────
    //
    //   Ciudad elegida del directorio  -> sus coordenadas
    //   Ciudad a mano, o sin ciudad    -> centroide del país
    //
    // La distinción NO se re-deriva aquí: `resolveMapPin` la lee de si hay
    // coordenadas guardadas, que es lo que el CHECK de la 057 garantiza que
    // sólo ocurre cuando la ciudad vino del directorio.
    //
    // `precision` viaja hasta el mapa a propósito: un centroide dibujado
    // igual que una ciudad se lee como una dirección exacta, y el de
    // Argelia cae en mitad del Sáhara.
    const countriesByCode = indexCountriesByCode(countries);
    const scored = views
      .map((technician) => {
        const pin = resolveMapPin(
          {
            locationCountryCode: technician.locationCountryCode ?? '',
            locationCityLat: technician.latitude,
            locationCityLng: technician.longitude,
          },
          countriesByCode,
        );
        return {
          ...technician,
          latitude: pin?.latitude,
          longitude: pin?.longitude,
          locationPrecision: pin?.precision,
          matchingScore: scoreMapMatch(technician, selected),
        };
      })
      .sort((a, b) => (b.matchingScore ?? 0) - (a.matchingScore ?? 0));
    setTechnicians(scored);
    setHabilitationsById(nextHabilitationsById);
    setTechnicianTypesById(nextTechnicianTypesById);
    setLoading(false);
  }, [
    query,
    companyId,
    // El catálogo llega asíncrono: sin esta dependencia, los técnicos
    // cargados antes se quedarían para siempre sin pin de país.
    countries,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  return { technicians, loading, habilitationsById, technicianTypesById };
}
