import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { TechnicianMap } from '../../src/components/TechnicianMap';
import { useMapTechnicians } from '../../src/state/useMapTechnicians';
import { offerRequestRepository } from '../../src/repositories/v2/offerRequestRepository';
import { getOfferMatchesForTechnician, getMatchDisplayLabel } from '../../src/utils/matchingV2';
import { useCompanySession } from '../../src/state/SessionContext';
import { MapFilters, MapFilterValue } from '../../src/types/filters';
import { MapOfferMatchOption } from '../../src/types/mapOffers';
import { colors } from '../../src/theme';
import { notify } from '../../src/utils/platformAlert';
import { formatLocation } from '../../src/utils/formatLocation';

export default function MapScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const [filters, setFilters] = useState<MapFilters>({});
  const [offerMatchesByTechnician, setOfferMatchesByTechnician] = useState<Record<string, MapOfferMatchOption[]>>({});
  const [loadingOfferMatches, setLoadingOfferMatches] = useState(false);

  function handleFilterChange(key: keyof MapFilters, value: MapFilterValue) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const { technicians, loading, habilitationsById, technicianTypesById } = useMapTechnicians(filters);

  useEffect(() => {
    let active = true;

    async function loadOfferMatches() {
      // Guard de CARGA, mudo a proposito: no lo dispara el usuario, se
      // reevalua en cada render y avisar aqui seria ruido. Solo las ACCIONES
      // de usuario tienen que hablar cuando no pueden completarse.
      if (!companyId || technicians.length === 0) {
        setOfferMatchesByTechnician({});
        setLoadingOfferMatches(false);
        return;
      }

      setLoadingOfferMatches(true);
      const requests = await offerRequestRepository.getForCompany(companyId);
      const entries = await Promise.all(
        technicians.map(async (technician) => {
          const matches = await getOfferMatchesForTechnician(technician.id);
          const options: MapOfferMatchOption[] = matches
            .filter(({ offer }) => offer.companyId === companyId)
            .map(({ offer, score }) => {
              const existing = requests.find(
                (request) => request.technicianId === technician.id && request.offerId === offer.id,
              );

              return {
                offerId: offer.id,
                title: offer.title,
                contractType: offer.contractType,
                location: formatLocation(offer.locationCity, offer.locationCountry),
                score: score.total,
                label: getMatchDisplayLabel(offer, score),
                requestStatus: existing?.status,
              };
            });

          return [technician.id, options] as const;
        }),
      );

      if (!active) return;
      setOfferMatchesByTechnician(Object.fromEntries(entries));
      setLoadingOfferMatches(false);
    }

    loadOfferMatches().catch(() => {
      if (!active) return;
      setOfferMatchesByTechnician({});
      setLoadingOfferMatches(false);
    });

    return () => {
      active = false;
    };
  }, [technicians, companyId]);

  async function handleSendOfferFromMap(technicianId: string, offerId: string) {
    if (!companyId) {
      notify('Not ready yet', 'Your session is still loading. Try again in a moment.');
      return;
    }
    await offerRequestRepository.create({
      companyId,
      technicianId,
      offerId,
    });

    setOfferMatchesByTechnician((prev) => ({
      ...prev,
      [technicianId]: (prev[technicianId] ?? []).map((option) => (
        option.offerId === offerId ? { ...option, requestStatus: 'pending' } : option
      )),
    }));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <Stack.Screen options={{ headerShown: false }} />
      <TechnicianMap
        technicians={technicians}
        habilitationsById={habilitationsById}
        technicianTypesById={technicianTypesById}
        filters={filters}
        onFilterChange={handleFilterChange}
        loading={loading}
        onBack={goBack}
        offerMatchesByTechnician={offerMatchesByTechnician}
        loadingOfferMatches={loadingOfferMatches}
        onSendOffer={handleSendOfferFromMap}
        onViewProfile={(technicianId) => router.push(`/company/technician/${technicianId}` as any)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
});
