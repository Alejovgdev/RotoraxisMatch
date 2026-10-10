import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Text } from '../src/components/ui/Text';
import { useDesktopScrollbar } from '../src/components/ui/useDesktopScrollbar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useGoBack } from '../src/state/useGoBack';
import { AccountShell, useAccountShellRole } from '../src/components/AccountShell';
import { colors, spacing } from '../src/theme';
import { TERMS_OF_SERVICE_LAST_UPDATED } from '../src/constants/legal';

export default function TermsOfServiceScreen() {
  // Escritorio: barra de desplazamiento visible (fase 8).
  const desktopScrollbar = useDesktopScrollbar();
  const goBack = useGoBack();
  const shellRole = useAccountShellRole();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const content = (
    <>
      <Section title="1. Acceptance">
        <P>
          By creating an account or using Aviation Job Talent (the "Platform"), you agree to these Terms of Service ("Terms") and acknowledge that you have read our Privacy Policy. If you do not agree to the Terms, do not use the Platform.
        </P>
        <P>
          The Platform is operated by <Bold>[LEGAL_ENTITY_NAME]</Bold>, <Bold>[LEGAL_ADDRESS]</Bold>.
        </P>
      </Section>

      <Section title="2. Eligibility">
        <BulletList items={[
          'You must be at least 18 years old to register.',
          'Technician accounts are for qualified aviation maintenance professionals (EASA Part-66, FAA A&P, or equivalent).',
          'Company accounts are for legally registered aviation organisations.',
          'You must provide accurate, truthful information at all times.',
        ]} />
      </Section>

      <Section title="3. Account types">
        <P><Bold>Technician accounts</Bold> allow you to create a professional profile, upload credentials, browse job offers, apply to offers and communicate with companies after acceptance.</P>
        <P><Bold>Company accounts</Bold> allow you to search privacy-limited technician profiles without direct identifiers, post job offers, send direct offers to technicians and communicate with them after acceptance.</P>
        <P><Bold>Admin accounts</Bold> are internal staff accounts used for platform moderation and credential verification.</P>
      </Section>

      <Section title="4. Technician identity and privacy">
        <P>
          Your full name, email, phone and professional links are <Bold>never visible to companies</Bold> by default. They are only disclosed to the specific company with which you have an accepted connection.
        </P>
        <P>
          By accepting a connection (accepting a direct offer or having your application accepted), you consent to your identity and permitted admin-verified professional documents, such as licences, training records and resumes, being disclosed to that company.
        </P>
        <P>
          Medical certificates and identity documents (passports, national IDs) are used only for credential verification by our team and are <Bold>never shared with companies</Bold>.
        </P>
      </Section>

      <Section title="5. Documents and content">
        <P>You may only upload documents that:</P>
        <BulletList items={[
          'Belong to you and accurately represent your credentials.',
          'Do not infringe any third-party intellectual property rights.',
          'Are in PDF, JPG, PNG or WEBP format, maximum 5 MB each.',
        ]} />
        <P>Uploading false or altered credentials is grounds for immediate account termination and may constitute fraud under applicable law.</P>
      </Section>

      <Section title="6. Acceptable use">
        <P>You must not:</P>
        <BulletList items={[
          'Create accounts on behalf of other individuals without their consent.',
          'Use the Platform to spam, harass or deceive other users.',
          'Attempt to reverse-engineer, scrape or disrupt the Platform.',
          'Use automated tools to access or interact with the Platform without permission.',
          'Post content that is illegal, defamatory, obscene or discriminatory.',
          'Disclose another user\'s identity information obtained through the Platform to third parties.',
        ]} />
      </Section>

      <Section title="7. Verification">
        <P>
          All technician profiles and companies are subject to verification by our team before gaining full platform access. We reserve the right to reject or revoke verification at any time.
        </P>
        <P>
          Verification status displayed on the Platform is for informational purposes only and does not constitute a professional endorsement or employment recommendation.
        </P>
      </Section>

      <Section title="8. Connections and communications">
        <P>
          Chat between a technician and a company is only available after both parties have accepted a connection. Messages are private between the two parties and our team for moderation purposes.
        </P>
        <P>
          Aviation Job Talent is a matching and communication platform. We do not guarantee employment outcomes and are not party to any employment contract between a technician and a company.
        </P>
      </Section>

      <Section title="9. Intellectual property">
        <P>
          The Platform, its design, code and brand are owned by <Bold>[LEGAL_ENTITY_NAME]</Bold>. You retain ownership of the documents and content you upload. By uploading content, you grant us a limited licence to store and process it solely for the purposes described in our Privacy Policy.
        </P>
      </Section>

      <Section title="10. Termination">
        <P>
          You may delete your account via Settings → Delete account. A sole company administrator must first assign another administrator or contact support so the company record can be handled without being orphaned. We may suspend or terminate accounts that violate these Terms.
        </P>
        <P>
          Upon termination, your personal data is handled in accordance with our Privacy Policy (Section 8).
        </P>
      </Section>

      <Section title="11. Disclaimers and limitation of liability">
        <P>
          The Platform is provided "as is." We make no warranties about uninterrupted access, accuracy of match scores, or employment outcomes.
        </P>
        <P>
          To the maximum extent permitted by law, <Bold>[LEGAL_ENTITY_NAME]</Bold> is not liable for indirect, incidental, consequential or punitive damages arising from your use of the Platform.
        </P>
      </Section>

      <Section title="12. Governing law">
        <P>
          These Terms are governed by the laws of <Bold>[LEGAL_JURISDICTION]</Bold>. Any disputes shall be subject to the exclusive jurisdiction of the courts of <Bold>[LEGAL_JURISDICTION]</Bold>.
        </P>
      </Section>

      <Section title="13. Changes">
        <P>
          We may update these Terms. We will notify users of material changes where required and request renewed acceptance where applicable.
        </P>
      </Section>

      <Section title="14. Contact">
        <P>
          General support: <Bold>support@aviationjobtalent.com</Bold>{'\n'}
          Legal: <Bold>[LEGAL_ENTITY_NAME]</Bold>, <Bold>[LEGAL_ADDRESS]</Bold>
        </P>
      </Section>

      {/* Atribución obligatoria, no un crédito de cortesía: la CC BY 4.0 de
          GeoNames exige el reconocimiento allí donde se usan los datos.
          También aparece junto a los resultados, en CountryCityPicker.
          No la quites sin sustituir antes la fuente de datos. */}
      <Section title="15. Data sources and attribution">
        <P>
          City names and coordinates used in our location fields are derived from the <Bold>GeoNames</Bold> geographical database, served through the countries.dev API. GeoNames data is licensed under <Bold>Creative Commons Attribution 4.0 (CC BY 4.0)</Bold>.
        </P>
        <P>
          Source: geonames.org · Licence: creativecommons.org/licenses/by/4.0/
        </P>
        <P>
          Map tiles, where shown, are © <Bold>OpenStreetMap</Bold> contributors, available under the Open Database Licence (ODbL).
        </P>
      </Section>
    </>
  );

  // Escritorio con sesión de empresa o técnico: dentro del marco del área, como
  // Settings (fase 8). Sin sesión, como siempre.
  if (shellRole) {
    return (
      <AccountShell
        role={shellRole}
        active="settings"
        title="Terms of Service"
        subtitle={`Aviation Job Talent · Last updated: ${TERMS_OF_SERVICE_LAST_UPDATED}`}
      >
        {content}
      </AccountShell>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        showsVerticalScrollIndicator={desktopScrollbar}
      >
        <TouchableOpacity onPress={goBack} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.h1}>Terms of Service</Text>
        <Text style={styles.meta}>Aviation Job Talent · Last updated: {TERMS_OF_SERVICE_LAST_UPDATED}</Text>

        {content}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.p}>{children}</Text>;
}

function Bold({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bold}>{children}</Text>;
}

function BulletList({ items }: { items: string[] }) {
  return (
    <View style={styles.bulletList}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  scrollWide: {
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  back: { paddingVertical: spacing.sm, alignSelf: 'flex-start', marginBottom: spacing.sm },
  backText: { color: colors.blue, fontSize: 14, fontWeight: '500' },
  h1: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
  section: { marginBottom: spacing.xl },
  h2: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  p: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  bold: { fontWeight: '700', color: colors.text },
  bulletList: { gap: spacing.xs, marginBottom: spacing.sm },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  bulletDot: { color: colors.blue, fontSize: 14, width: 14, marginTop: 3 },
  bulletText: { flex: 1, fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
});
