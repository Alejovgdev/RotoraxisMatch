import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import { useIsWide } from '../../../src/components/company/CompanyPage';
import { CompanyChatPanel } from '../../../src/components/company/CompanyChatPanel';
import { CompanyInboxSplit } from '../../../src/components/company/CompanyInboxList';
import { useCompanySession } from '../../../src/state/SessionContext';
import { useCompanyInbox } from '../../../src/state/useCompanyInbox';

// Una conversación (rediseño, fase 3; maquetas W-Chat y W-D-Inbox). La lógica
// vive en CompanyChatPanel; esta pantalla sólo decide el marco: en móvil, el
// chat a pantalla entera; en escritorio, el Inbox con la lista al lado.
export default function CompanyChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useGoBack();
  const wide = useIsWide();

  if (!wide) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <CompanyChatPanel roomId={id ?? ''} mode="screen" onBack={goBack} />
      </CompanyScreen>
    );
  }

  return <WideChat roomId={id ?? ''} />;
}

function WideChat({ roomId }: { roomId: string }) {
  const router = useRouter();
  const companySession = useCompanySession();
  const { entries, loading, error, reload } = useCompanyInbox(companySession?.companyId);

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <CompanyInboxSplit
        entries={entries}
        loading={loading}
        error={error}
        onRetry={reload}
        selectedRoomId={roomId}
        // Cambiar de conversación sustituye a esta: "atrás" vuelve al Inbox,
        // no recorre todas las que se han mirado.
        onOpen={(other) => { if (other !== roomId) router.replace(`/company/chats/${other}` as any); }}
      >
        <CompanyChatPanel key={roomId} roomId={roomId} mode="pane" onMessageSent={reload} />
      </CompanyInboxSplit>
    </CompanyScreen>
  );
}
