import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { TechnicianScreen } from '../../../src/components/technician/TechnicianUI';
import { useIsWide } from '../../../src/components/company/CompanyPage';
import { TechnicianChatPanel } from '../../../src/components/technician/TechnicianChatPanel';
import { TechnicianInboxSplit } from '../../../src/components/technician/TechnicianInboxList';
import { useTechnicianSession } from '../../../src/state/SessionContext';
import { useTechnicianInbox } from '../../../src/state/useTechnicianInbox';

// Una conversación del técnico (rediseño, fase 5B; el patrón de empresa,
// maquetas W-Chat y W-D-Inbox). La lógica vive en TechnicianChatPanel; esta
// pantalla sólo decide el marco: en móvil, el chat a pantalla entera; en
// escritorio, el Inbox con la lista al lado.
export default function TechnicianChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useGoBack();
  const wide = useIsWide();

  if (!wide) {
    return (
      <TechnicianScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <TechnicianChatPanel roomId={id ?? ''} mode="screen" onBack={goBack} />
      </TechnicianScreen>
    );
  }

  return <WideChat roomId={id ?? ''} />;
}

function WideChat({ roomId }: { roomId: string }) {
  const router = useRouter();
  const technicianSession = useTechnicianSession();
  const { entries, loading, error, reload } = useTechnicianInbox(technicianSession?.technicianId);

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <TechnicianInboxSplit
        entries={entries}
        loading={loading}
        error={error}
        onRetry={reload}
        selectedRoomId={roomId}
        // Cambiar de conversación sustituye a esta: "atrás" vuelve al Inbox,
        // no recorre todas las que se han mirado.
        onOpen={(other) => { if (other !== roomId) router.replace(`/technician/chats/${other}` as never); }}
      >
        <TechnicianChatPanel key={roomId} roomId={roomId} mode="pane" onMessageSent={reload} />
      </TechnicianInboxSplit>
    </TechnicianScreen>
  );
}
