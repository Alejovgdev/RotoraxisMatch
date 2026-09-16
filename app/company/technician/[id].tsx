import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  BadgeCheck,
  BriefcaseBusiness,
  Clock,
  Download,
  FileCheck,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plane,
  ShieldCheck,
  UserRound,
  Wrench,
} from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { ExternalLink } from '../../../src/components/ExternalLink';
import {
  CompanyBadge,
  CompanyCard,
  CompanyChip,
  CompanyPageHeader,
  CompanyScreen,
  EmptyPanel,
  IconBox,
  InitialAvatar,
  companyStyles,
  companyUi,
} from '../../../src/components/company/CompanyUI';
import { technicianRepositoryV2 } from '../../../src/repositories/v2/technicianRepositoryV2';
import { chatRepository } from '../../../src/repositories/v2/chatRepository';
import { getDocumentSignedUrl, openDocumentPreWindow, openDocumentUrl } from '../../../src/lib/documentStorage';
import { useCompanySession } from '../../../src/state/SessionContext';
import { useAircraftTypeRatingsCatalog } from '../../../src/state/useAircraftTypeRatingsCatalog';
import { useEnginesCatalog } from '../../../src/state/useEnginesCatalog';
import { getEngineLabel } from '../../../src/constants/engines';
import { credentialLabel } from '../../../src/constants/licenses';
import { getAircraftTypeRatingLabel } from '../../../src/constants/aircraftTypeRatings';
import { technicianTypeLabels } from '../../../src/constants/technicianTypes';
import { CONTRACT_TYPES } from '../../../src/constants/contractTypes';
import { isUnlocked, UnlockedTechnicianView } from '../../../src/types/privacy';
import { ChatRoom } from '../../../src/types/chat';
import { Document } from '../../../src/types/document';
import { notify } from '../../../src/utils/platformAlert';

const DOC_TYPE_LABELS: Record<string, string> = {
  license: 'License',
  medical: 'Medical',
  id: 'ID',
  training: 'Training',
  resume: 'Resume',
  other: 'Other',
};

function availabilityLabel(status?: string): string {
  if (status === 'open_to_offers') return 'Open to offers';
  if (status === 'unavailable') return 'Unavailable';
  return 'Not specified';
}

function formatDate(value?: string): string {
  if (!value) return 'Not specified';
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 760;
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const { ratingIndex } = useAircraftTypeRatingsCatalog();
  const { engineIndex } = useEnginesCatalog();

  const [profile, setProfile] = useState<UnlockedTechnicianView | null>(null);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'locked' | 'missing' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [viewingDocumentId, setViewingDocumentId] = useState<string | null>(null);
  const loadSignal = useRef<{ active: boolean }>({ active: false });

  const load = useCallback(async (signal: { active: boolean }) => {
    if (!companyId || !id) return;

    try {
      const [view, companyRooms] = await Promise.all([
        technicianRepositoryV2.getViewForCompany(id, companyId),
        chatRepository.getRoomsForCompany(companyId),
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
        <LoadingScreen color={companyUi.accent} role="company" />
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
        <View style={[companyStyles.content, isWide && companyStyles.contentWide, styles.stateContent]}>
          <CompanyPageHeader
            eyebrow="Technician profile"
            title={copy.title}
            subtitle={copy.subtitle}
            onBack={() => router.back()}
          />
          <EmptyPanel title={copy.title} subtitle={copy.subtitle} />
          {state === 'error' ? (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => {
                const signal = { active: true };
                loadSignal.current = signal;
                setState('loading');
                load(signal);
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Text style={styles.retryButtonText}>Try again</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </CompanyScreen>
    );
  }

  const fullName = `${profile.firstName} ${profile.lastName}`.trim();

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[companyStyles.content, isWide && companyStyles.contentWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <CompanyPageHeader
          eyebrow="Technician profile"
          title="Unlocked contact"
          subtitle="Full profile available to your company after an accepted connection."
          onBack={() => router.back()}
          right={isWide ? <CompanyBadge label="Identity unlocked" tone="success" /> : undefined}
        />

        <CompanyCard style={styles.heroCard}>
          <View style={[styles.heroMain, isWide && styles.heroMainWide]}>
            <InitialAvatar label={fullName} size={64} color={companyUi.accent} />
            <View style={styles.heroCopy}>
              <Text style={styles.heroName}>{fullName}</Text>
              <Text style={styles.heroRole}>{technicianTypeLabels(profile.technicianTypes, 'Technician')}</Text>
              <View style={styles.heroMeta}>
                <View style={styles.inlineMeta}>
                  <MapPin color={companyUi.textMuted} size={15} strokeWidth={2} />
                  <Text style={styles.inlineMetaText}>{profile.city || 'Location not specified'}, {profile.country}</Text>
                </View>
                <View style={styles.inlineMeta}>
                  <BriefcaseBusiness color={companyUi.textMuted} size={15} strokeWidth={2} />
                  <Text style={styles.inlineMetaText}>
                    {profile.yearsExperience === undefined ? 'Experience not specified' : `${profile.yearsExperience} years experience`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
          <View style={styles.badgeRow}>
            {!isWide ? <CompanyBadge label="Identity unlocked" tone="success" small /> : null}
            <CompanyBadge label={availabilityLabel(profile.availability.status)} tone="cyan" small />
            <CompanyBadge
              label={profile.verificationStatus === 'verified' ? 'Verified profile' : profile.verificationStatus}
              tone={profile.verificationStatus === 'verified' ? 'success' : 'warning'}
              small
            />
          </View>
        </CompanyCard>

        <View style={[styles.columns, isWide && styles.columnsWide]}>
          <View style={styles.column}>
            <ProfileSection
              icon={UserRound}
              title="Contact details"
              subtitle="Private details unlocked for your company."
            >
              <ContactRow
                icon={Mail}
                label="Email"
                value={profile.email}
                onPress={() => Linking.openURL(`mailto:${profile.email}`)}
              />
              {profile.phone ? (
                <ContactRow
                  icon={Phone}
                  label="Phone"
                  value={profile.phone}
                  onPress={() => Linking.openURL(`tel:${profile.phone}`)}
                />
              ) : (
                <DetailRow label="Phone" value="Not provided" />
              )}
              {Object.entries(profile.socialLinks ?? {}).filter(([, url]) => Boolean(url)).map(([key, url]) => (
                <View key={key} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{socialLabel(key)}</Text>
                  <View style={styles.detailValueWrap}>
                    <ExternalLink
                      url={url!}
                      color={companyUi.accent}
                      displayText={compactUrlLabel(url!)}
                      style={styles.externalLink}
                      containerStyle={styles.externalLinkPressable}
                    />
                  </View>
                </View>
              ))}
            </ProfileSection>

            <ProfileSection
              icon={Clock}
              title="Availability"
              subtitle="Current work preferences declared by the technician."
            >
              <DetailRow label="Status" value={availabilityLabel(profile.availability.status)} />
              <DetailRow label="Available immediately" value={profile.availability.immediately ? 'Yes' : 'No'} />
              <View style={styles.chipSection}>
                <Text style={styles.detailLabel}>Contract preferences</Text>
                <View style={styles.chipRow}>
                  {contractLabels.length > 0
                    ? contractLabels.map((label) => <CompanyChip key={label} label={label} />)
                    : <Text style={styles.emptyText}>Not specified</Text>}
                </View>
              </View>
            </ProfileSection>

            {rooms.length > 0 ? (
              <ProfileSection
                icon={MessageCircle}
                title="Conversations"
                subtitle="Chats created by accepted connections with this technician."
              >
                {rooms.map((room, index) => (
                  <TouchableOpacity
                    key={room.id}
                    style={styles.chatButton}
                    onPress={() => router.push(`/company/chats/${room.id}` as any)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${room.offerApplicationId ? 'application' : 'direct offer'} chat`}
                  >
                    <MessageCircle color={colors.white} size={17} strokeWidth={2.2} />
                    <View style={styles.chatButtonCopy}>
                      <Text style={styles.chatButtonTitle}>
                        {room.offerApplicationId ? 'Application chat' : 'Direct offer chat'}
                      </Text>
                      <Text style={styles.chatButtonSub}>
                        Conversation {rooms.length > 1 ? index + 1 : 'with this technician'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ProfileSection>
            ) : null}
          </View>

          <View style={styles.column}>
            <ProfileSection
              icon={BadgeCheck}
              title="Licenses"
              subtitle="Licence categories declared on the technician profile."
            >
              <View style={styles.chipRow}>
                {profile.licenses.length > 0
                  ? profile.licenses.map((license) => (
                      <CompanyChip
                        key={`${license.authority}-${license.licenseCode}`}
                        label={credentialLabel(license.authority, license.licenseCode)}
                      />
                    ))
                  : <Text style={styles.emptyText}>No licenses listed.</Text>}
              </View>
            </ProfileSection>

            <ProfileSection
              icon={ShieldCheck}
              title="Type ratings"
              subtitle="Aircraft ratings linked to a licence category."
            >
              {profile.habilitations.length > 0 ? profile.habilitations.map((habilitation) => (
                <QualificationRow
                  key={habilitation.id}
                  icon={Plane}
                  title={habilitation.aircraftTypeRatingId
                    ? getAircraftTypeRatingLabel(habilitation.aircraftTypeRatingId, ratingIndex)
                    : 'Rating not specified'}
                  meta={[
                    habilitation.licenseCode,
                    habilitation.experienceYears === undefined ? null : `${habilitation.experienceYears} yrs`,
                    habilitation.expiresAt ? `Expires ${formatDate(habilitation.expiresAt)}` : null,
                  ].filter(Boolean).join(' · ')}
                  badge={habilitation.isCurrent === false ? 'Not current' : 'Current'}
                  badgeTone={habilitation.isCurrent === false ? 'warning' : 'success'}
                />
              )) : <Text style={styles.emptyText}>No type ratings listed.</Text>}
            </ProfileSection>

            <ProfileSection
              icon={Wrench}
              title="Aircraft experience"
              subtitle="Aircraft the technician has worked on, with or without a licence."
            >
              {profile.aircraftExperience.length > 0 ? profile.aircraftExperience.map((experience) => (
                <QualificationRow
                  key={experience.id}
                  icon={Plane}
                  title={getAircraftTypeRatingLabel(experience.aircraftTypeRatingId, ratingIndex)}
                  meta={experience.years === undefined ? 'Experience duration not specified' : `${experience.years} years declared`}
                />
              )) : <Text style={styles.emptyText}>No aircraft experience listed.</Text>}
            </ProfileSection>

            {/* Paso 5b: los motores declarados. Hacen a un técnico elegible y
                bien puntuado en una oferta de motor; la empresa los ve igual
                que la experiencia en aeronaves. */}
            <ProfileSection
              icon={Wrench}
              title="Engine experience"
              subtitle="Engines the technician has declared working on."
            >
              {profile.engines.length > 0 ? profile.engines.map((engine) => (
                <QualificationRow
                  key={engine.id}
                  icon={Wrench}
                  title={getEngineLabel(engine.engineId, engineIndex)}
                  meta={engine.years === undefined ? 'Experience duration not specified' : `${engine.years} years declared`}
                />
              )) : <Text style={styles.emptyText}>No engines listed.</Text>}
            </ProfileSection>
          </View>
        </View>

        <ProfileSection
          icon={FileCheck}
          title="Verified documents"
          subtitle="Only documents verified by the platform are visible here."
        >
          {profile.documents.length > 0 ? profile.documents.map((doc) => (
            <View key={doc.id} style={styles.documentRow}>
              <View style={styles.documentCopy}>
                <Text style={styles.documentName}>{doc.fileName}</Text>
                <Text style={styles.documentMeta}>
                  {DOC_TYPE_LABELS[doc.type] ?? doc.type}
                  {doc.expiresAt ? ` · Expires ${formatDate(doc.expiresAt)}` : ''}
                </Text>
              </View>
              <CompanyBadge label="Verified" tone="success" small />
              <TouchableOpacity
                style={styles.documentButton}
                onPress={() => handleViewDocument(doc)}
                disabled={viewingDocumentId !== null}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Open ${doc.fileName}`}
              >
                {viewingDocumentId === doc.id
                  ? <ActivityIndicator color={companyUi.accent} size="small" />
                  : <Download color={companyUi.accent} size={17} strokeWidth={2.2} />}
              </TouchableOpacity>
            </View>
          )) : <Text style={styles.emptyText}>No verified documents available.</Text>}
        </ProfileSection>
      </ScrollView>
    </CompanyScreen>
  );
}

function ProfileSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentType<any>;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <CompanyCard style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <IconBox icon={icon} color={companyUi.accent} backgroundColor={companyUi.accentSoft} />
        <View style={styles.sectionHeaderCopy}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSub}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </CompanyCard>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  onPress,
}: {
  icon: React.ComponentType<any>;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.contactRow}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Icon color={companyUi.accent} size={17} strokeWidth={2.2} />
      <View style={styles.contactCopy}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={styles.contactValue}>{value}</Text>
      </View>
    </TouchableOpacity>
  );
}

function QualificationRow({
  icon: Icon,
  title,
  meta,
  badge,
  badgeTone = 'muted',
}: {
  icon: React.ComponentType<any>;
  title: string;
  meta: string;
  badge?: string;
  badgeTone?: 'success' | 'warning' | 'muted';
}) {
  return (
    <View style={styles.qualificationRow}>
      <View style={styles.qualificationIcon}>
        <Icon color={companyUi.textSoft} size={17} strokeWidth={2} />
      </View>
      <View style={styles.qualificationCopy}>
        <Text style={styles.qualificationTitle}>{title}</Text>
        <Text style={styles.qualificationMeta}>{meta}</Text>
      </View>
      {badge ? <CompanyBadge label={badge} tone={badgeTone} small /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  stateContent: { flex: 1, justifyContent: 'center' },
  retryButton: {
    minHeight: 48,
    marginTop: spacing.md,
    borderRadius: 14,
    backgroundColor: companyUi.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  heroCard: { gap: spacing.md, marginBottom: spacing.md },
  heroMain: { gap: spacing.md },
  heroMainWide: { flexDirection: 'row', alignItems: 'center' },
  heroCopy: { flex: 1, minWidth: 0 },
  heroName: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: companyUi.text },
  heroRole: { marginTop: 3, fontSize: 14, lineHeight: 20, fontWeight: '700', color: companyUi.accent },
  heroMeta: { marginTop: spacing.sm, gap: spacing.xs },
  inlineMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inlineMetaText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500', color: companyUi.textSoft },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  columns: { gap: spacing.md },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { flex: 1, gap: spacing.md, minWidth: 0 },
  sectionCard: { gap: spacing.md, marginBottom: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  sectionHeaderCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800', color: companyUi.text },
  sectionSub: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '500', color: companyUi.textSoft },
  sectionBody: { gap: spacing.sm },
  detailRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
    paddingTop: spacing.sm,
  },
  detailLabel: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700', color: companyUi.textMuted },
  detailValue: { flex: 2, fontSize: 13, lineHeight: 18, fontWeight: '600', color: companyUi.text, textAlign: 'right' },
  detailValueWrap: { flex: 2, minWidth: 0, alignItems: 'flex-end' },
  externalLink: { textAlign: 'right' },
  externalLinkPressable: { alignSelf: 'stretch', minHeight: 44, justifyContent: 'center' },
  contactRow: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: companyUi.borderSoft,
    backgroundColor: companyUi.surfaceSoft,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  contactCopy: { flex: 1, minWidth: 0 },
  contactLabel: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: companyUi.textMuted },
  contactValue: { marginTop: 2, fontSize: 13, lineHeight: 18, fontWeight: '700', color: companyUi.accent },
  chipSection: { gap: spacing.xs, borderTopWidth: 1, borderTopColor: companyUi.borderSoft, paddingTop: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  emptyText: { fontSize: 13, lineHeight: 19, fontWeight: '500', color: companyUi.textSoft },
  qualificationRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
    paddingTop: spacing.sm,
  },
  qualificationIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: companyUi.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualificationCopy: { flex: 1, minWidth: 0 },
  qualificationTitle: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: companyUi.text },
  qualificationMeta: { marginTop: 2, fontSize: 11, lineHeight: 16, fontWeight: '500', color: companyUi.textMuted },
  chatButton: {
    minHeight: 54,
    borderRadius: 15,
    backgroundColor: companyUi.accent,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chatButtonCopy: { flex: 1, minWidth: 0 },
  chatButtonTitle: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.white },
  chatButtonSub: { marginTop: 1, fontSize: 11, lineHeight: 15, fontWeight: '500', color: '#E0F2FE' },
  documentRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: companyUi.borderSoft,
    paddingTop: spacing.sm,
  },
  documentCopy: { flex: 1, minWidth: 0 },
  documentName: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: companyUi.text },
  documentMeta: { marginTop: 2, fontSize: 11, lineHeight: 16, fontWeight: '500', color: companyUi.textMuted },
  documentButton: {
    width: 44,
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: companyUi.accent,
    backgroundColor: companyUi.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
