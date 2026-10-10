import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { colors } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { Text } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import { EmptyBlock, ErrorBlock, useIsWide } from '../../../src/components/company/CompanyPage';
import { CompanyInboxList, CompanyInboxSplit } from '../../../src/components/company/CompanyInboxList';
import { useCompanySession } from '../../../src/state/SessionContext';
import { useCompanyInbox } from '../../../src/state/useCompanyInbox';

// Inbox (rediseño, fase 3; maquetas W-Inbox y W-D-Inbox). Es una pestaña: sin
// flecha de atrás. En escritorio, la lista a la izquierda y la conversación
// elegida a la derecha; al entrar no se abre ninguna sola (abrirla la marcaría
// como leída sin que nadie la haya mirado).
export default function CompanyChatsScreen() {
  const router = useRouter();
  const wide = useIsWide();
  const companySession = useCompanySession();
  const { entries, loading, error, reload } = useCompanyInbox(companySession?.companyId);
  const [refreshing, setRefreshing] = useState(false);
  const open = (roomId: string) => router.push(`/company/chats/${roomId}` as any);

  async function handleRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  if (wide) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <CompanyInboxSplit
          entries={entries}
          loading={loading}
          error={error}
          onRetry={reload}
          selectedRoomId={null}
          onOpen={open}
        >
          <View style={styles.placeholder}>
            <MessageCircle color={colors.textMuted} size={32} strokeWidth={1.8} />
            <Text style={styles.placeholderText}>
              {entries.length > 0 ? 'Select a conversation to read it here.' : 'Your conversations will appear here.'}
            </Text>
          </View>
        </CompanyInboxSplit>
      </CompanyScreen>
    );
  }

  if (loading && entries.length === 0) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="company" />
      </>
    );
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title} accessibilityRole="header">Inbox</Text>
        {error ? (
          <ErrorBlock text="Could not load conversations." onRetry={reload} />
        ) : entries.length === 0 ? (
          <EmptyBlock
            title="No chats yet"
            text="Chat becomes available after an accepted application or accepted direct offer."
          />
        ) : (
          <CompanyInboxList entries={entries} wide={false} onOpen={open} />
        )}
      </ScrollView>
    </CompanyScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: colors.text,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  placeholderText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
