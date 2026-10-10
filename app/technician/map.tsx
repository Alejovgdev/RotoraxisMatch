import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { StatusBar } from 'expo-status-bar';
import { OfferMap } from '../../src/components/OfferMap';
import { useMapOffers } from '../../src/state/useMapOffers';
import { OfferMapFilters } from '../../src/types/offerMap';
import { techUi } from '../../src/components/technician/TechnicianUI';

export default function TechnicianOfferMapScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const [filters, setFilters] = useState<OfferMapFilters>({});
  const {
    offers,
    loading,
    error,
    totalCount,
    unmappedCount,
    retry,
  } = useMapOffers(filters);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'right', 'bottom', 'left']}>
      <StatusBar style="dark" />
      <Stack.Screen options={{ headerShown: false }} />
      <OfferMap
        offers={offers}
        filters={filters}
        onFiltersChange={setFilters}
        loading={loading}
        error={error}
        totalCount={totalCount}
        unmappedCount={unmappedCount}
        onRetry={retry}
        onBack={goBack}
        // Rediseño, fase 5A: vuelve a la pestaña Offers que hay debajo (o la
        // abre si se llegó al mapa desde la Home), sin apilar pantallas. El
        // mapa en sí se queda como estaba (respuesta 22).
        onShowList={() => router.dismissTo('/technician/offers' as never)}
        onViewOffer={(offerId) => router.push(`/technician/offers/${offerId}` as any)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: techUi.page },
});
