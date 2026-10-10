import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, Stack, useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { ProfileImageEditor } from '../../../src/components/ui/ProfileImageEditor';
import { useTechnicianNav } from '../../../src/state/TechnicianNavContext';
import { Text } from '../../../src/components/ui';
import { TechnicianScreen } from '../../../src/components/technician/TechnicianUI';
import { SectionTitle, VerificationPill, useIsWide } from '../../../src/components/company/CompanyPage';
import { AvailabilitySwitch, ProfileLoadGate } from '../../../src/components/technician/ProfileParts';
import { TechnicianAccountSection } from '../../../src/components/technician/TechnicianAccount';
import { useAvailabilityToggle } from '../../../src/state/useAvailabilityToggle';
import { useOwnTechnicianProfile } from '../../../src/state/useOwnTechnicianProfile';
import { useCountryCatalog } from '../../../src/state/useCountryCatalog';
import { documentRepositoryV2 } from '../../../src/repositories/v2/documentRepositoryV2';
import {
  contractTypesSummary,
  documentsSummary,
  withCountryName,
  workSummary,
  youHeaderLine,
} from '../../../src/utils/technicianWork';
import { formatLocation } from '../../../src/utils/formatLocation';
import { TECHNICIAN_DOCUMENTS_ROUTE, TECHNICIAN_PROFILE_ROUTES } from '../../../src/utils/technicianNavigation';
import { colors } from '../../../src/theme';
import type { Document } from '../../../src/types/document';
import type { EditableTechnicianProfile } from '../../../src/types/technicianProfileEdit';

// You (rediseño, fase 6A; maqueta T-You; T3, respuestas 9 y 25). La URL sigue
// siendo /technician/profile.
//
// Era el formulario entero del perfil con un solo "Save Changes". Ahora es un
// menú: cabecera (iniciales hasta las fotos, fase 7), disponibilidad —se guarda
// al tocarla—, una fila por cada parte del perfil y, al final, Account. Cada
// fila abre una pantalla que guarda sólo lo suyo (src/usecases/technicianProfile.ts).
//
// Escritorio (fase 8): sin la lista de filas, que repetía el menú lateral.
// You es una sola página, el layout de app/technician/(you): a la izquierda el
// menú (My work, Documents, Location…, Settings, Help y Log out); a la
// derecha, arriba y montadas siempre, la tarjeta del técnico y la
// disponibilidad, y debajo el apartado elegido, cada uno con su URL de
// siempre. /technician/profile lleva a My work (/technician/profile/work),
// dentro de ese layout. En móvil no cambia nada: You es el menú de siempre.
//
// Reparto de los campos de antes:
//   My work            tipos de perfil, licencias y sus fechas, habilitaciones,
//                      experiencia en aeronaves, motores, petición de catálogo
//   Documents          /technician/documents (sin cambios de lógica)
//   Location           país y ciudad
//   Contract types     tipos de contrato
//   Personal details   nombre, email (sólo lectura), teléfono, años
//   Professional links LinkedIn, Instagram, web personal
//   aquí mismo         disponibilidad; código y verificación (sólo lectura)
export default function TechnicianYouScreen() {
  const wide = useIsWide();
  if (wide) return <Redirect href={TECHNICIAN_PROFILE_ROUTES.work as never} />;
  return <YouMobile />;
}

function YouMobile() {
  const state = useOwnTechnicianProfile({ refreshOnFocus: true });
  return (
    <ProfileLoadGate state={state} title="You">
      {(profile) => <YouHub profile={profile} reload={state.reload} />}
    </ProfileLoadGate>
  );
}

function YouHub({ profile, reload }: { profile: EditableTechnicianProfile; reload: () => Promise<unknown> }) {
  const router = useRouter();
  const { reloadTechnician } = useTechnicianNav();
  const { countries } = useCountryCatalog();
  const [documents, setDocuments] = useState<Document[] | null>(null);
  // Se guarda al tocar (respuesta 25); la misma lógica que la cabecera de escritorio.
  const availability = useAvailabilityToggle(profile, reload);
  const [refreshing, setRefreshing] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      setDocuments(await documentRepositoryV2.getForTechnician(profile.id));
    } catch {
      // Sin documentos la fila enseña su texto genérico; no tumba la pantalla.
    }
  }, [profile.id]);

  useFocusEffect(useCallback(() => { void loadDocuments(); }, [loadDocuments]));

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([reload(), loadDocuments()]);
    setRefreshing(false);
  }

  const shownLocation = withCountryName(profile.location, countries);
  const place = formatLocation(shownLocation.city?.name, shownLocation.country?.name);
  const go = (href: string) => () => router.push(href as never);

  const rows: { title: string; subtitle: string; onPress: () => void }[] = [
    { title: 'My work', subtitle: workSummary(profile), onPress: go(TECHNICIAN_PROFILE_ROUTES.work) },
    {
      title: 'Documents',
      subtitle: documents ? documentsSummary(documents) : 'Licences and certificates',
      onPress: go(TECHNICIAN_DOCUMENTS_ROUTE),
    },
    { title: 'Location', subtitle: place || 'Not set', onPress: go(TECHNICIAN_PROFILE_ROUTES.location) },
    {
      title: 'Contract types',
      subtitle: contractTypesSummary(profile.availability.contractTypes),
      onPress: go(TECHNICIAN_PROFILE_ROUTES.contracts),
    },
    { title: 'Personal details', subtitle: 'Name, email, phone, years of experience', onPress: go(TECHNICIAN_PROFILE_ROUTES.personal) },
    { title: 'Professional links', subtitle: 'Private until a company accepts you', onPress: go(TECHNICIAN_PROFILE_ROUTES.links) },
  ];

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />;
  const availabilitySwitch = (
    <AvailabilitySwitch
      value={availability.availability}
      onChange={(next) => void availability.change(next)}
      disabled={availability.saving}
      error={availability.error}
    />
  );

  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title} accessibilityRole="header">You</Text>

        <View style={styles.header}>
          <ProfileImageEditor kind="technician" id={profile.id} name={profile.fullName || profile.anonymousCode}
            path={profile.photoPath} compact onChanged={() => { reloadTechnician(); void reload(); }} />
          <View style={styles.headerCopy}>
            <Text style={styles.name} numberOfLines={2}>{profile.fullName || profile.anonymousCode}</Text>
            <Text style={styles.headerLine}>{youHeaderLine(profile.anonymousCode, profile.yearsInput)}</Text>
            <View style={styles.pill}>
              <VerificationPill status={profile.verificationStatus} />
            </View>
          </View>
        </View>

        {availabilitySwitch}

        <View>
          <SectionTitle>Your profile</SectionTitle>
          {rows.map((row, i) => (
            <HubRow key={row.title} {...row} last={i === rows.length - 1} />
          ))}
        </View>

        <TechnicianAccountSection />
      </ScrollView>
    </TechnicianScreen>
  );
}

function HubRow({ title, subtitle, onPress, last }: { title: string; subtitle: string; onPress: () => void; last: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [styles.row, !last && styles.rowLine, (pressed || hovered) && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text>
      </View>
      <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
    </Pressable>
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
    gap: 20,
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
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  headerLine: {
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  pill: {
    flexDirection: 'row',
    marginTop: 2,
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
  },
  rowLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSoft,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
  },
  rowSub: {
    fontSize: 13.5,
    color: colors.textSecondary,
  },
});
