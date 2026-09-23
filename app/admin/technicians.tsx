import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { Search, UserRound } from 'lucide-react-native';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { AdminTechnicianCard } from '../../src/components/AdminTechnicianCard';
import { useAdminDashboard } from '../../src/state/useAdminDashboard';
import type { Technician, TechnicianWithRelations, VerificationStatus } from '../../src/types';
import type { UserStatus } from '../../src/types/enums';
import {
  AdminCard,
  AdminChip,
  AdminEmptyPanel,
  AdminIconBox,
  AdminPageHeader,
  AdminScreen,
  adminUi,
} from '../../src/components/admin/AdminUI';
import { spacing } from '../../src/theme';

type StatusFilter = 'all' | 'pending' | 'verified' | 'rejected';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
];

// Fase 5.3 — see the identical note in app/admin/companies.tsx:
// LegacyVerificationStatus's 'unverified' branch was unreachable both by
// the type checker (Technician.verificationStatus is VerificationStatus)
// and at runtime (technician_profiles.verification_status is a genuine
// Postgres ENUM, confirmed against rotoaxismatch-dev).
function normalizedStatus(status: VerificationStatus): StatusFilter {
  return status;
}

// Una LÁPIDA no tiene estado de verificación vigente, tiene el que TENÍA al
// borrarse. Contarla en "pending" hacía que el panel anunciara trabajo que no
// existe — y que no puede existir: admin_update_technician_verification()
// (migración 037) rechaza por excepción cualquier cambio sobre una cuenta
// borrada, así que ese "1 pendiente" no era accionable ni por error.
//
// Se quedan visibles en "All" a propósito: cuando una empresa pregunta por
// T5353F0227, el admin tiene que poder encontrarlo. Lo que se les retira es el
// sitio en la COLA (filtros de estado, recuentos, prioridad de orden).
function isTombstone(technicianId: string, accountStatusMap: Record<string, UserStatus>): boolean {
  return accountStatusMap[technicianId] === 'deleted';
}

function filterTechnicians(
  techs: Technician[],
  detailsMap: Record<string, TechnicianWithRelations>,
  accountStatusMap: Record<string, UserStatus>,
  status: StatusFilter,
  query: string,
): Technician[] {
  let result = techs;
  if (status !== 'all') {
    result = result.filter(
      (technician) =>
        !isTombstone(technician.id, accountStatusMap) &&
        normalizedStatus(technician.verificationStatus) === status,
    );
  }
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    result = result.filter((technician) => {
      const details = detailsMap[technician.id];
      const searchable = [
        technician.fullName,
        technician.anonymousCode,
        technician.city,
        technician.country,
        technician.baseAirport,
        // Fase 6 tanda A: TODOS los tipos, no el primero. Este buscador es
        // texto libre, así que la "intersección" aquí es que la consulta
        // aparezca en cualquiera de ellos — buscar "painter" tiene que
        // encontrar a un aviónico que también pinta.
        ...(details?.technicianTypes ?? []),
        ...technician.licenseCategories,
        ...technician.aircraftTypes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(q);
    });
  }
  // Las lápidas van al final sea cual sea su estado congelado: el orden de
  // esta lista es "qué tengo que mirar primero", y ahí no hay nada que mirar.
  const DELETED_RANK = 9;
  const rank = (technician: Technician): number => {
    if (isTombstone(technician.id, accountStatusMap)) return DELETED_RANK;
    const order: Record<StatusFilter, number> = { pending: 0, rejected: 1, verified: 2, all: 3 };
    return order[normalizedStatus(technician.verificationStatus)];
  };
  return [...result].sort((a, b) => rank(a) - rank(b));
}

export default function AdminTechniciansScreen() {
  const goBack = useGoBack();
  const {
    technicians,
    technicianDetailsMap,
    typeRatingLabelsMap,
    accountStatusMap,
    loading,
    refresh,
    updateTechnicianVerification,
  } = useAdminDashboard();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const filtered = useMemo(
    () => filterTechnicians(technicians, technicianDetailsMap, accountStatusMap, statusFilter, query),
    [technicians, technicianDetailsMap, accountStatusMap, statusFilter, query],
  );
  const pendingCount = technicians.filter(
    (technician) =>
      !isTombstone(technician.id, accountStatusMap) &&
      normalizedStatus(technician.verificationStatus) === 'pending',
  ).length;
  const deletedCount = technicians.filter((technician) => isTombstone(technician.id, accountStatusMap)).length;

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={adminUi.accent} role="admin" />
      </>
    );
  }

  return (
    <AdminScreen>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.topContent, isWide && styles.contentWide]}>
        <AdminPageHeader
          eyebrow="Moderation"
          title="Technician management"
          subtitle="Review identity, license coverage and operational readiness before marketplace access."
          onBack={goBack}
        />

        <AdminCard style={styles.controls}>
          <View style={styles.searchShell}>
            <Search size={18} color={adminUi.textMuted} strokeWidth={2.2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search name, code, city, license or aircraft"
              placeholderTextColor={adminUi.textMuted}
              value={query}
              onChangeText={setQuery}
              clearButtonMode="while-editing"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {STATUS_TABS.map(({ key, label }) => (
              <AdminChip
                key={key}
                label={label}
                selected={statusFilter === key}
                onPress={() => setStatusFilter(key)}
              />
            ))}
          </ScrollView>
        </AdminCard>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, isWide && styles.contentWide]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View>
              <Text style={styles.resultCount}>
                {filtered.length} technician{filtered.length !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.resultSub}>
                {pendingCount} pending verification
                {deletedCount > 0 ? ` — ${deletedCount} deleted account${deletedCount !== 1 ? 's' : ''}` : ''}
              </Text>
            </View>
            <AdminIconBox icon={UserRound} size={17} color={adminUi.accent} backgroundColor={adminUi.accentSoft} />
          </View>
        }
        ListEmptyComponent={
          <AdminEmptyPanel
            title="No technicians found"
            subtitle="Adjust the search or moderation filter to widen the queue."
          />
        }
        renderItem={({ item }) => (
          <AdminTechnicianCard
            technician={item}
            details={technicianDetailsMap[item.id]}
            typeRatingLabels={typeRatingLabelsMap[item.id]}
            accountStatus={accountStatusMap[item.id]}
            onUpdateStatus={updateTechnicianVerification}
          />
        )}
      />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  topContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  contentWide: {
    maxWidth: 920,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.lg,
  },
  controls: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  searchShell: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: adminUi.border,
    borderRadius: 14,
    backgroundColor: adminUi.surfaceSoft,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
    color: adminUi.text,
    paddingVertical: spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  resultCount: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: adminUi.text,
  },
  resultSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: adminUi.textMuted,
  },
});
