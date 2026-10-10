import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text, TextInput } from '../../src/components/ui/Text';
import { Stack, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { FileCheck, Search } from 'lucide-react-native';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { AdminDocumentCard } from '../../src/components/AdminDocumentCard';
import { useAdminDashboard } from '../../src/state/useAdminDashboard';
import type { DocumentStatus, Technician, TechnicianDocument } from '../../src/types';
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

type StatusFilter = 'all' | DocumentStatus;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'expired', label: 'Expired' },
];

function filterDocuments(
  docs: TechnicianDocument[],
  technicianMap: Record<string, Technician>,
  status: StatusFilter,
  query: string,
): TechnicianDocument[] {
  let result = status === 'all' ? docs : docs.filter((document) => document.status === status);
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    result = result.filter((document) => {
      const technician = technicianMap[document.technicianId];
      const searchable = [
        document.type,
        document.fileName,
        document.status,
        technician?.fullName,
        technician?.anonymousCode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(q);
    });
  }
  return [...result].sort((a, b) => {
    const order: Record<DocumentStatus, number> = { pending: 0, rejected: 1, expired: 2, verified: 3 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
  });
}

export default function AdminDocumentsScreen() {
  const goBack = useGoBack();
  const {
    documents,
    documentDetailsMap,
    loading,
    refresh,
    updateDocumentStatus,
    technicianMap,
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
    () => filterDocuments(documents, technicianMap, statusFilter, query),
    [documents, technicianMap, statusFilter, query],
  );
  const pendingCount = documents.filter((document) => document.status === 'pending').length;

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
          eyebrow="Documents"
          title="Compliance review"
          subtitle="Inspect technician document metadata and keep verification states audit-friendly."
          onBack={goBack}
        />

        <AdminCard style={styles.controls}>
          <View style={styles.searchShell}>
            <Search size={18} color={adminUi.textMuted} strokeWidth={2.2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search file, owner, code or document type"
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
                {filtered.length} document{filtered.length !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.resultSub}>
                {pendingCount} pending review
              </Text>
            </View>
            <AdminIconBox icon={FileCheck} size={17} color={adminUi.accent} backgroundColor={adminUi.accentSoft} />
          </View>
        }
        ListEmptyComponent={
          <AdminEmptyPanel
            title="No documents found"
            subtitle="Adjust the document status or search terms."
          />
        }
        renderItem={({ item }) => (
          <AdminDocumentCard
            document={item}
            technicianName={technicianMap[item.technicianId]?.fullName}
            expiresAt={documentDetailsMap[item.id]?.expiresAt}
            reviewedAt={documentDetailsMap[item.id]?.reviewedAt}
            rejectionReason={documentDetailsMap[item.id]?.rejectionReason}
            storagePath={documentDetailsMap[item.id]?.storagePath}
            onUpdateStatus={updateDocumentStatus}
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
