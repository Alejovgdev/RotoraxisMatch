import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useGoBack } from '../../../src/state/useGoBack';
import { MessageCircle } from 'lucide-react-native';
import { colors } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { ExternalLink } from '../../../src/components/ExternalLink';
import { Text } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import {
  AsideCard,
  BackLink,
  EmptyBlock,
  PageBar,
  PageBody,
  PersonHero,
  PillButton,
  Section,
  StatGrid,
  StatTile,
  StatusPill,
  StickyBar,
  TwoColumns,
  VerificationPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import { TechnicianQualifications } from '../../../src/components/company/TechnicianQualifications';
import { TechnicianDocumentList } from '../../../src/components/company/TechnicianDocuments';
import { CompanyTechnicianHistory } from '../../../src/components/company/CompanyTechnicianHistory';
import { offerApplicationRepository } from '../../../src/repositories/v2/offerApplicationRepository';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { offerRepository } from '../../../src/repositories/v2/offerRepository';
import { companyTechnicianRelations } from '../../../src/utils/companyTechnicianRelations';
import { OfferInboxRecord } from '../../../src/types/offerRequest';
import { Offer } from '../../../src/types/offer';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { getDocumentSignedUrl, openDocumentPreWindow, openDocumentUrl } from '../../../src/lib/documentStorage';
import { useCompanySession } from '../../../src/state/SessionContext';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { technicianTypeLabels } from '../../../src/constants/technicianTypes';
import { CONTRACT_TYPES } from '../../../src/constants/contractTypes';
import { isUnlocked, UnlockedTechnicianView } from '../../../src/types/privacy';
import { ChatRoom } from '../../../src/types/chat';
import { Document } from '../../../src/types/document';
import { notify } from '../../../src/utils/platformAlert';
import { formatLocation } from '../../../src/utils/formatLocation';
import { isProfileOpenedFromChat } from '../../../src/utils/companyNavigation';

// Perfil completo de un técnico (rediseño, fase 3; maquetas C-Tech y
// W-D-Tech). Sólo se abre tras un contacto aceptado, como antes (respuesta 18):
// si la vista llega sin identidad, la pantalla dice que no está disponible.

function availabilityLabel(status?: string): string {
  if (status === 'open_to_offers') return 'Open to offers';
  if (status === 'unavailable') return 'Unavailable';
  return 'Not specified';
}

function socialLabel(key: string): string {
  if (key === 'linkedin') return 'LinkedIn';
  if (key === 'instagram') return 'Instagram';
  if (key === 'website') return 'Website';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function compactUrlLabel(url: string): string {
  const display = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (display.length <= 28) return display;

  const host = display.split('/')[0].replace(/^www\./i, '');
  return `${host}/…`;
}

export default function CompanyTechnicianProfileScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  // Abierto desde un chat: sin "Open chat", para no ir de uno a otro sin fin.
  const openedFromChat = isProfileOpenedFromChat(from);
  const router = useRouter();
  const goBack = useGoBack();
  const wide = useIsWide();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const { ratingIndex } = useAircraftTypeRatingsCatalog();
  const { engineIndex } = useEnginesCatalog();

  const [profile, setProfile] = useState<UnlockedTechnicianView | null>(null);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [relations, setRelations] = useState<OfferInboxRecord[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'locked' | 'missing' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [viewingDocumentId, setViewingDocumentId] = useState<string | null>(null);
  const loadSignal = useRef<{ active: boolean }>({ active: false });

  const load = useCallback(async (signal: { active: boolean }) => {
    if (!companyId || !id) return;

    try {
      const [view, companyRooms, applications, requests, companyOffers] = await Promise.all([
        technicianRepositoryV2.getViewForCompany(id, companyId),
        chatRepository.getRoomsForCompany(companyId),
        offerApplicationRepository.getForCompany(companyId),
        offerRequestRepository.getForCompany(companyId),
        offerRepository.getForCompany(companyId),
      ]);
      if (!signal.active) return;

      if (!view) {
        setProfile(null);
        setRooms([]);
        setState('missing');
        return;
      }

      if (!isUnlocked(view)) {
        setProfile(null);
        setRooms([]);
        setState('locked');
        return;
      }

      setProfile(view);
      setRelations(companyTechnicianRelations(companyId, id, applications, requests));
      setOffers(companyOffers);
      setRooms(companyRooms.filter((room) => room.technicianId === id));
      setState('ready');
    } catch {
      if (!signal.active) return;
      setProfile(null);
      setRooms([]);
      setState('error');
    }
  }, [companyId, id]);

  useFocusEffect(
    useCallback(() => {
      const signal = { active: true };
      loadSignal.current = signal;
      setState('loading');
      load(signal);
      return () => { signal.active = false; };
    }, [load]),
  );

  const contractLabels = useMemo(() => {
    if (!profile) return [];
    return profile.availability.contractTypes.map(
      (code) => CONTRACT_TYPES.find((item) => item.code === code)?.label ?? code,
    );
  }, [profile]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(loadSignal.current);
    setRefreshing(false);
  }

  async function handleViewDocument(doc: Document) {
    const win = openDocumentPreWindow();
    setViewingDocumentId(doc.id);
    const { url, error } = await getDocumentSignedUrl(doc.storagePath, 120, false);
    setViewingDocumentId(null);
    if (!url) {
      win?.close();
      notify('Document unavailable', error ?? 'Could not generate a secure document link.');
      return;
    }
    openDocumentUrl(url, win);
  }

  if (state === 'loading') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="company" />
      </>
    );
  }

  if (state !== 'ready' || !profile) {
    const copy = state === 'locked'
      ? {
          title: 'Profile not available',
          subtitle: 'This technician profile is only available after an accepted application or direct offer.',
        }
      : state === 'missing'
        ? {
            title: 'Technician unavailable',
            subtitle: 'This technician account is no longer active, so its profile cannot be opened.',
          }
        : {
            title: 'Could not load profile',
            subtitle: 'Check your connection and try again.',
          };

    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        {!wide ? <PageBar title="Technician profile" onBack={goBack} /> : null}
        <PageBody wide={wide}>
          {wide ? <BackLink onPress={goBack} /> : null}
          <EmptyBlock
            title={copy.title}
            text={copy.subtitle}
            action={state === 'error' ? (
              <PillButton
                label="Try again"
                variant="outline"
                size="md"
                onPress={() => {
                  const signal = { active: true };
                  loadSignal.current = signal;
                  setState('loading');
                  load(signal);
                }}
              />
            ) : undefined}
          />
        </PageBody>
      </CompanyScreen>
    );
  }

  const fullName = `${profile.firstName} ${profile.lastName}`.trim();
  const socials = Object.entries(profile.socialLinks ?? {}).filter(([, url]) => Boolean(url)) as [string, string][];
  const openRoom = (room: ChatRoom) => router.push(`/company/chats/${room.id}` as any);

  const hero = (
    <PersonHero
      name={fullName}
      photoPath={profile.photoPath}
      anonymous={false}
      wide={wide}
      subtitle={[technicianTypeLabels(profile.technicianTypes, 'Technician'), formatLocation(profile.city, profile.country) || 'Location not specified'].join(' · ')}
      chips={(
        <>
          <VerificationPill status={profile.verificationStatus} large={wide} />
          <StatusPill label="Identity unlocked" tone="info" large={wide} />
        </>
      )}
    />
  );

  const contact = (
    <View style={styles.contactList}>
      <ContactRow label="Email" value={profile.email} wide={wide} onPress={() => Linking.openURL(`mailto:${profile.email}`)} />
      {profile.phone
        ? <ContactRow label="Phone" value={profile.phone} wide={wide} onPress={() => Linking.openURL(`tel:${profile.phone}`)} />
        : <ContactRow label="Phone" value="Not provided" wide={wide} />}
      {socials.map(([key, url]) => (
        <View key={key} style={wide ? styles.contactStack : styles.contactRow}>
          <Text style={styles.contactLabel}>{socialLabel(key)}</Text>
          <ExternalLink
            url={url}
            color={colors.primary}
            displayText={compactUrlLabel(url)}
            style={styles.externalLink}
            containerStyle={styles.externalLinkPressable}
          />
        </View>
      ))}
    </View>
  );

  const availabilityValue = availabilityLabel(profile.availability.status);
  const availabilityTiles = [
    { label: 'Availability', value: availabilityValue, color: profile.availability.status === 'open_to_offers' ? colors.success : undefined },
    { label: 'Available immediately', value: profile.availability.immediately ? 'Yes' : 'No', color: profile.availability.immediately ? colors.success : undefined },
    { label: 'Contract preferences', value: contractLabels.length > 0 ? contractLabels.join(' · ') : 'Not specified' },
    { label: 'Experience', value: profile.yearsExperience === undefined ? 'Not specified' : `${profile.yearsExperience} years` },
  ];

  const documents = (
    <Section title="Verified documents" wide={wide}>
      <TechnicianDocumentList
        documents={profile.documents}
        viewingId={viewingDocumentId}
        onView={handleViewDocument}
        emptyText="No verified documents available."
      />
      <Text style={styles.docNote}>Only documents verified by the platform are visible here.</Text>
    </Section>
  );

  // Una conversación: botón "Open chat". Varias (una candidatura y una oferta
  // directa aceptadas): la lista de siempre, una por relación.
  const conversations = !openedFromChat && rooms.length > 1 ? (
    <Section title="Conversations" wide={wide}>
      {rooms.map((room, index) => (
        <PillButton
          key={room.id}
          label={`${room.offerApplicationId ? 'Application chat' : 'Direct offer chat'} · ${index + 1}`}
          icon={MessageCircle}
          variant={wide ? 'primary' : 'outline'}
          size="md"
          onPress={() => openRoom(room)}
          accessibilityLabel={`Open ${room.offerApplicationId ? 'application' : 'direct offer'} chat`}
        />
      ))}
    </Section>
  ) : null;
  const singleChat = !openedFromChat && rooms.length === 1
    ? <PillButton label="Open chat" icon={MessageCircle} onPress={() => openRoom(rooms[0])} />
    : null;

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />;
  const history = <CompanyTechnicianHistory relations={relations} offers={offers} />;

  if (wide) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <PageBody wide refreshControl={refresh}>
          <BackLink onPress={goBack} />
          <TwoColumns
            main={(
              <>
                {hero}
                <TechnicianQualifications tech={profile} ratingIndex={ratingIndex} engineIndex={engineIndex} variant="sections" wide />
                {documents}
                {history}
              </>
            )}
            aside={(
              <AsideCard>
                <Text style={styles.asideTitle}>Contact details</Text>
                {contact}
                <View style={styles.divider} />
                {availabilityTiles.map((tile) => (
                  <View key={tile.label} style={styles.contactStack}>
                    <Text style={styles.contactLabel}>{tile.label}</Text>
                    <Text style={[styles.asideValue, tile.color ? { color: tile.color } : null]}>{tile.value}</Text>
                  </View>
                ))}
                {singleChat}
                {conversations}
              </AsideCard>
            )}
          />
        </PageBody>
      </CompanyScreen>
    );
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageBar title="Technician profile" onBack={goBack} />
      <PageBody wide={false} refreshControl={refresh}>
        {hero}
        <View style={styles.contactCard}>
          <Text style={styles.contactCardTitle}>Contact details</Text>
          {contact}
        </View>
        <StatGrid>
          {availabilityTiles.map((tile) => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} valueColor={tile.color} />
          ))}
        </StatGrid>
        <TechnicianQualifications tech={profile} ratingIndex={ratingIndex} engineIndex={engineIndex} variant="sections" />
        {documents}
        {history}
        {conversations}
      </PageBody>
      {singleChat ? <StickyBar>{singleChat}</StickyBar> : null}
    </CompanyScreen>
  );
}

function ContactRow({
  label,
  value,
  wide,
  onPress,
}: {
  label: string;
  value: string;
  wide: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Text style={styles.contactLabel}>{label}</Text>
      <Text style={[wide ? styles.asideValue : styles.contactValue, onPress ? styles.contactLink : !onPress && styles.contactMuted]} numberOfLines={1}>
        {value}
      </Text>
    </>
  );
  if (!onPress) return <View style={wide ? styles.contactStack : styles.contactRow}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={wide ? styles.contactStack : styles.contactRow}
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${value}`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  contactCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surfaceSoft,
    gap: 8,
  },
  contactCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  contactList: {
    gap: 8,
  },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    minHeight: 28,
  },
  contactStack: {
    gap: 2,
  },
  contactLabel: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  contactValue: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
  },
  contactLink: {
    color: colors.primary,
  },
  contactMuted: {
    color: colors.textMuted,
  },
  externalLink: {
    fontSize: 14,
    fontWeight: '700',
  },
  externalLinkPressable: {
    flexShrink: 1,
  },
  asideTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  asideValue: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },
  docNote: {
    fontSize: 12.5,
    color: colors.textMuted,
  },
});
