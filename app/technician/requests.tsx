// Legacy route kept for backward navigation only.
// TODO: Remove this screen once all deep links to /technician/requests are gone.
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useGoBack } from '../../src/state/useGoBack';
import { Button } from '../../src/components/Button';
import { colors, spacing, typography } from '../../src/theme';
import {
  TechnicianCard,
  TechnicianPageHeader,
  TechnicianScreen,
  techStyles,
} from '../../src/components/technician/TechnicianUI';

export default function TechnicianRequestsLegacy() {
  const router = useRouter();
  const goBack = useGoBack();
  return (
    <TechnicianScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <TechnicianPageHeader
          eyebrow="Requests"
          title="Where to find your requests"
          subtitle="Company outreach and your own applications each have their own space."
          onBack={goBack}
        />

        <TechnicianCard style={styles.card}>
          <Text style={[typography.h3, styles.title]}>Pick a destination</Text>
          <Text style={styles.body}>
            Offers companies sent you are under Direct Offers. Open roles you can apply
            to are under Job Offers.
          </Text>
          <Button
            label="View Direct Offers"
            onPress={() => router.replace('/technician/direct-offers' as any)}
            variant="primary"
            fullWidth
            style={styles.btn}
          />
          <Button
            label="Browse Job Offers"
            onPress={() => router.replace('/technician/offers' as any)}
            variant="outline"
            fullWidth
            style={styles.btn}
          />
        </TechnicianCard>
      </ScrollView>
    </TechnicianScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    ...techStyles.content,
    flexGrow: 1,
  },
  card: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  title: { textAlign: 'center' },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
  btn: { marginTop: spacing.xs },
});
