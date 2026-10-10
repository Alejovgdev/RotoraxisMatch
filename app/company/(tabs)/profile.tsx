import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, Users } from 'lucide-react-native';
import { colors } from '../../../src/theme';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { Avatar, Text } from '../../../src/components/ui';
import { CompanyScreen } from '../../../src/components/company/CompanyUI';
import {
  CARD_BORDER,
  ErrorBlock,
  KeyValueRow,
  OutlineTag,
  PageBody,
  PillButton,
  SectionTitle,
  StatGrid,
  StatTile,
  TextLink,
  VerificationPill,
  useIsWide,
} from '../../../src/components/company/CompanyPage';
import {
  AccountLayout,
  CompanyAccountNav,
  CompanyAccountSection,
} from '../../../src/components/company/CompanyAccount';
import { useCompanySession } from '../../../src/state/SessionContext';
import { companyRepositoryV2 } from '../../../src/repositories/v2/companyRepositoryV2';
import { offerRequestRepository } from '../../../src/repositories/v2/offerRequestRepository';
import { canManageCompanyMembers, canManageCompanySettings } from '../../../src/utils/companyPermissionsV2';
import { COMPANY_TYPES } from '../../../src/constants/companyTypes';
import { directOfferActivity, teamSummaryLine } from '../../../src/utils/companyStatus';
import { formatLocation } from '../../../src/utils/formatLocation';
import type { CompanyMember, CompanyProfileView } from '../../../src/types/company';
import type { OfferRequestStatus } from '../../../src/types/enums';

// You (rediseño, fase 3; maquetas W-You y W-D-You; respuestas 8 y 21).
//   - Cabecera de la empresa, actividad de ofertas directas (enviadas,
//     aceptadas, esperando respuesta: los números de siempre), datos de la
//     empresa, la fila Team access (sólo admin) y la cuenta.
//   - Los datos de la empresa ya no se editan aquí: "Edit" (sólo admin) abre
//     /company/profile/edit, que guarda lo mismo que guardaba esta pantalla.
//   - La gestión del equipo vive en /company/team; aquí queda la fila que
//     lleva a ella.

function labelize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function companyTypeLabel(code: string): string {
  return COMPANY_TYPES.find((t) => t.code === code)?.label ?? labelize(code);
}

export default function CompanyProfileScreen() {
  const router = useRouter();
  const wide = useIsWide();
  const companySession = useCompanySession();
  const companyId = companySession?.companyId;
  const profileId = companySession?.profileId;
  const role = companySession?.companyMemberRole;
  const canEditCompany = canManageCompanySettings(role);
  const isAdmin = canManageCompanyMembers(role);

  const [company, setCompany] = useState<CompanyProfileView | null>(null);
  const [statuses, setStatuses] = useState<OfferRequestStatus[]>([]);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // Guard de CARGA, mudo a proposito (ver nota en map.tsx).
    if (!companyId) return;
    setFailed(false);
    try {
      const [profile, requests, team] = await Promise.all([
        companyRepositoryV2.getById(companyId),
        offerRequestRepository.getForCompany(companyId),
        // La fila "Signed in as" necesita el nombre propio; el resumen del
        // equipo, los roles. Un fallo aquí no tumba el resto de la pantalla.
        companyRepositoryV2.getMembers(companyId).catch(() => [] as CompanyMember[]),
      ]);
      setCompany(profile);
      setStatuses(requests.map((r) => r.status));
      setMembers(team);
      if (!profile) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Al volver de editar los datos, se leen otra vez.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingScreen color={colors.primary} role="company" />
      </>
    );
  }

  const me = members.find((m) => m.userId === profileId);
  const userName = me?.displayName?.trim() || me?.email || '';
  const activity = directOfferActivity(statuses);
  const toDirect = () => router.push('/company/direct-offers' as any);
  const toEdit = () => router.push('/company/profile/edit' as any);
  const refresh = <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />;

  if (!company) {
    const body = <ErrorBlock text={failed ? 'Could not load your company profile.' : 'Company profile not available.'} onRetry={load} />;
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        {wide ? (
          <PageBody wide refreshControl={refresh}>
            <AccountLayout nav={<CompanyAccountNav active="profile" isAdmin={isAdmin} />}>{body}</AccountLayout>
          </PageBody>
        ) : (
          <ScrollView contentContainerStyle={styles.content} refreshControl={refresh}>
            <Text style={styles.title} accessibilityRole="header">You</Text>
            {body}
            <CompanyAccountSection userName={userName} role={role} />
          </ScrollView>
        )}
      </CompanyScreen>
    );
  }

  const location = formatLocation(company.city, company.country);
  const chips = (
    <View style={styles.chips}>
      <OutlineTag label={companyTypeLabel(company.companyType)} />
      <VerificationPill status={company.verificationStatus} large={wide} />
    </View>
  );

  const activitySection = (
    <View style={styles.section}>
      <SectionTitle wide={wide}>Marketplace activity</SectionTitle>
      <StatGrid columns={3}>
        <StatTile big label="Requests sent" value={activity.sent} onPress={toDirect} />
        <StatTile big label="Accepted" value={activity.accepted} valueColor="#0B5B3A" onPress={toDirect} />
        <StatTile big label="Awaiting reply" value={activity.awaiting} onPress={toDirect} />
      </StatGrid>
    </View>
  );

  const details: { label: string; value: string; muted?: boolean }[] = [
    ...(wide ? [{ label: 'Company name', value: company.name }] : []),
    { label: 'Type', value: companyTypeLabel(company.companyType) },
    { label: 'Country', value: company.country || 'Not provided', muted: !company.country },
    { label: 'City', value: company.city || 'Not provided', muted: !company.city },
    { label: wide ? 'Contact email' : 'Email', value: company.email || 'Not provided', muted: !company.email },
    { label: 'Phone', value: company.phone || 'Not provided', muted: !company.phone },
    { label: 'Website', value: company.website || 'Not provided', muted: !company.website },
  ];

  const teamRow = isAdmin ? (
    <Pressable
      onPress={() => router.push('/company/team' as any)}
      style={({ pressed, hovered }: any) => [styles.teamRow, (pressed || hovered) && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Team access. ${teamSummaryLine(members.map((m) => m.role))}`}
    >
      <View style={styles.teamIcon}>
        <Users color="#33465A" size={22} strokeWidth={2} />
      </View>
      <View style={styles.teamCopy}>
        <Text style={styles.teamTitle}>Team access</Text>
        {members.length > 0 ? <Text style={styles.teamSub}>{teamSummaryLine(members.map((m) => m.role))}</Text> : null}
      </View>
      <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
    </Pressable>
  ) : null;

  if (wide) {
    return (
      <CompanyScreen>
        <Stack.Screen options={{ headerShown: false }} />
        <PageBody wide refreshControl={refresh}>
          <AccountLayout nav={<CompanyAccountNav active="profile" isAdmin={isAdmin} />}>
            <View style={styles.headerCard}>
              <Avatar kind="company" size={80} name={company.name} logoPath={company.logoPath} />
              <View style={styles.headerCopy}>
                <Text style={styles.nameWide} accessibilityRole="header">{company.name}</Text>
                {location ? <Text style={styles.locationWide}>{location}</Text> : null}
                {chips}
              </View>
              {canEditCompany ? <PillButton label="Edit profile" variant="outline" size="md" onPress={toEdit} /> : null}
            </View>
            {activitySection}
            <View style={styles.detailsCard}>
              {/* Sin "Edit" aquí: lo hace el botón "Edit profile" de la tarjeta de
                  arriba, que abre la misma pantalla (fase 8). En móvil, donde
                  no hay botón, el enlace sigue. */}
              <View style={styles.sectionHead}>
                <SectionTitle wide>Company details</SectionTitle>
              </View>
              <View style={styles.detailGrid}>
                {details.map((d) => (
                  <View key={d.label} style={styles.detailCell}>
                    <Text style={styles.detailLabel}>{d.label}</Text>
                    <Text style={[styles.detailValue, d.muted && styles.detailMuted]} numberOfLines={1}>{d.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          </AccountLayout>
        </PageBody>
      </CompanyScreen>
    );
  }

  return (
    <CompanyScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={refresh}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title} accessibilityRole="header">You</Text>

        <View style={styles.header}>
          <Avatar kind="company" size={68} name={company.name} logoPath={company.logoPath} />
          <View style={styles.headerCopy}>
            <Text style={styles.name}>{company.name}</Text>
            {location ? <Text style={styles.location}>{location}</Text> : null}
            {chips}
          </View>
        </View>

        {activitySection}

        <View>
          <View style={styles.sectionHead}>
            <SectionTitle>Company details</SectionTitle>
            {canEditCompany ? <TextLink label="Edit" onPress={toEdit} accessibilityLabel="Edit company details" /> : null}
          </View>
          {details.map((d, i) => (
            <KeyValueRow key={d.label} label={d.label} value={d.value} muted={d.muted} last={i === details.length - 1} />
          ))}
        </View>

        {teamRow}

        <CompanyAccountSection userName={userName} role={role} />
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
    gap: 22,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: colors.text,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerCopy: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 200,
    minWidth: 0,
    gap: 4,
  },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  location: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  section: {
    gap: 10,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDE5EC',
  },
  pressed: {
    backgroundColor: colors.surfaceSoft,
  },
  teamIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: '#E3E8EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamCopy: {
    flex: 1,
    minWidth: 0,
  },
  teamTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  teamSub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  headerCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 20,
    padding: 24,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  nameWide: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
  },
  locationWide: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  detailsCard: {
    padding: 24,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    gap: 12,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 18,
    columnGap: 24,
  },
  detailCell: {
    flexGrow: 1,
    flexBasis: '40%',
    minWidth: 0,
    gap: 2,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: 15.5,
    fontWeight: '700',
    color: colors.text,
  },
  detailMuted: {
    fontWeight: '600',
    color: colors.textMuted,
  },
});
